/**
 * Public, unauthenticated endpoints used by acceptance pages, receipts, the verifier and SDKs.
 * They expose only public on-chain facts and content. Everything here is also derivable from the
 * chain; these endpoints are a convenience, never a trust anchor.
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  acceptanceBatches,
  acceptanceChallenges,
  acceptances,
  and,
  asc,
  count,
  documents,
  documentVersions,
  eq,
  organizations,
} from "@stele/db";
import {
  parseCanonicalContent,
  type PasskeyAssertion,
  type Receipt,
  type ReceiptV2,
} from "@stelehq/protocol";
import {
  receiptFromReport,
  receiptV2FromReport,
  verifyAcceptance,
  type VerificationReport,
} from "@stelehq/verifier";
import { leafEvidence } from "../services/batches.js";
import type { Deps } from "../deps.js";
import { conflict, notFound } from "../errors.js";
import { signerEvidenceFor } from "../services/signers.js";
import { base58Address, base58Signature, hex32, slug } from "./schemas.js";

/** Small in-memory cache for receipts (verification costs several RPC round trips). */
const receiptCache = new Map<
  string,
  { at: number; body: VerifiedReceipt; challengeId: string | null }
>();
const RECEIPT_TTL_MS = 60_000;

export function publicRoutes(deps: Deps): FastifyPluginAsyncZod {
  async function resolveOrg(ref: string) {
    const [org] = await deps.db
      .select()
      .from(organizations)
      .where(
        /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ref)
          ? eq(organizations.address, ref)
          : eq(organizations.verifiedDomain, ref.toLowerCase()),
      );
    if (!org) throw notFound("Organization");
    return org;
  }

  const publicOrg = (o: typeof organizations.$inferSelect) => ({
    address: o.address,
    name: o.name,
    verifiedDomain: o.verifiedDomain,
    domainExpiresAt: o.domainExpiresAt,
    frozen: o.frozen,
    /** How visitors may sign (a hint for widgets; the API enforces it). */
    signingPolicy: o.settings.signingPolicy ?? "WALLET_ONLY",
    /** Sessions issued by the organization are required (its own accounts). */
    requiresSession:
      Boolean(o.settings.requireAcceptanceSessions) ||
      o.settings.signingPolicy === "ACCOUNT_AND_PASSKEY",
  });

  return async (app) => {
    app.get(
      "/v1/public/organizations/:ref",
      { schema: { params: z.object({ ref: z.string().max(64) }) } },
      async (req) => {
        const org = await resolveOrg(req.params.ref);
        const docs = await deps.db
          .select()
          .from(documents)
          .where(eq(documents.organizationId, org.id));
        const versions = await deps.db
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.organizationId, org.id));
        return {
          organization: publicOrg(org),
          documents: docs
            .filter((d) => d.currentVersionAddress)
            .map((d) => {
              const v = versions.find((x) => x.address === d.currentVersionAddress)!;
              return {
                address: d.address,
                slug: d.slug,
                documentType: d.documentType,
                locale: d.locale,
                versionCount: d.versionCount,
                current: v && {
                  address: v.address,
                  number: v.number,
                  label: v.versionLabel,
                  title: v.title,
                  publishedAt: v.publishedAt,
                },
              };
            }),
        };
      },
    );

    app.get(
      "/v1/public/organizations/:ref/documents/:slug",
      { schema: { params: z.object({ ref: z.string().max(64), slug }) } },
      async (req) => {
        const org = await resolveOrg(req.params.ref);
        const [doc] = await deps.db
          .select()
          .from(documents)
          .where(and(eq(documents.organizationId, org.id), eq(documents.slug, req.params.slug)));
        if (!doc) throw notFound("Document");
        const versions = await deps.db
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.documentId, doc.id))
          .orderBy(asc(documentVersions.number));
        const counts = await deps.db
          .select({ versionAddress: acceptances.versionAddress, n: count() })
          .from(acceptances)
          .where(eq(acceptances.documentId, doc.id))
          .groupBy(acceptances.versionAddress);
        return {
          organization: publicOrg(org),
          document: {
            address: doc.address,
            slug: doc.slug,
            documentType: doc.documentType,
            locale: doc.locale,
            versionCount: doc.versionCount,
            currentVersionAddress: doc.currentVersionAddress,
          },
          versions: versions.map((v) => ({
            address: v.address,
            number: v.number,
            label: v.versionLabel,
            title: v.title,
            fingerprint: v.versionHash,
            contentHash: v.contentHash,
            previousFingerprint: v.previousVersionHash,
            effectiveAt: v.effectiveAt,
            publishedAt: v.publishedAt,
            publishedSlot: v.publishedSlot,
            publisher: v.publisherAddress,
            publisherRole: v.publisherRole === 1 ? "owner" : "member",
            storageUri: v.storageUri,
            publishTransaction: v.publishTx,
            acceptanceCount: counts.find((c) => c.versionAddress === v.address)?.n ?? 0,
          })),
        };
      },
    );

    /** Canonical content bytes, served only after re-hashing them against the requested hash. */
    app.get(
      "/v1/public/content/:hash",
      { schema: { params: z.object({ hash: hex32 }) } },
      async (req, reply) => {
        const bytes = await deps.storage.get(req.params.hash);
        if (!bytes) throw notFound("Content");
        return reply
          .header("content-type", "application/json; charset=utf-8")
          .header("cache-control", "public, max-age=31536000, immutable")
          .header("x-content-sha256", req.params.hash)
          .header("access-control-allow-origin", "*")
          .send(Buffer.from(bytes));
      },
    );

    /** Parsed content (convenience for renderers); integrity identical to the raw endpoint. */
    app.get(
      "/v1/public/content/:hash/parsed",
      { schema: { params: z.object({ hash: hex32 }) } },
      async (req) => {
        const bytes = await deps.storage.get(req.params.hash);
        if (!bytes) throw notFound("Content");
        return { contentHash: req.params.hash, content: parseCanonicalContent(bytes) };
      },
    );

    app.get(
      "/v1/public/acceptances/:acceptanceId",
      { schema: { params: z.object({ acceptanceId: hex32 }) } },
      async (req) => {
        const [a] = await deps.db
          .select()
          .from(acceptances)
          .where(eq(acceptances.acceptanceId, req.params.acceptanceId));
        if (!a) throw notFound("Acceptance");
        const [doc] = await deps.db.select().from(documents).where(eq(documents.id, a.documentId));
        const [org] = await deps.db
          .select()
          .from(organizations)
          .where(eq(organizations.id, a.organizationId));
        return {
          acceptance: {
            acceptanceId: a.acceptanceId,
            transactionSignature: a.txSignature,
            slot: a.slot,
            blockTime: a.blockTime,
            signer: a.signerAddress,
            versionAddress: a.versionAddress,
            versionNumber: a.versionNumber,
            requestDomain: a.requestDomain,
            commitment: a.commitment,
          },
          document: { address: doc!.address, slug: doc!.slug, documentType: doc!.documentType },
          organization: publicOrg(org!),
        };
      },
    );

    app.get(
      "/v1/public/transactions/:signature/acceptance",
      { schema: { params: z.object({ signature: base58Signature }) } },
      async (req) => {
        const [a] = await deps.db
          .select({ acceptanceId: acceptances.acceptanceId })
          .from(acceptances)
          .where(eq(acceptances.txSignature, req.params.signature));
        if (!a) throw notFound("Acceptance");
        return a;
      },
    );

    /**
     * Receipt bundle generated by running the independent verifier against the chain — never from
     * database rows alone. Clients should verify the receipt themselves as well.
     */
    app.get(
      "/v1/public/acceptances/:acceptanceId/receipt",
      { schema: { params: z.object({ acceptanceId: hex32 }) } },
      async (req, reply) => {
        const result = await verifiedReceipt(deps, req.params.acceptanceId);
        if (result.status === "invalid") {
          req.log.error(
            { acceptanceId: req.params.acceptanceId, verdict: result.report.verdict },
            "indexed acceptance failed verification",
          );
          return reply.code(422).send({
            error: {
              code: "verification_failed",
              message: `Evidence verdict: ${result.report.verdict}`,
            },
            report: result.report,
          });
        }
        return result.body;
      },
    );

    /**
     * A batch manifest: every leaf's evidence and inclusion proof, as published to the content store
     * (hash-addressed — anyone can mirror it and check it against the anchored root).
     */
    app.get(
      "/v1/public/batches/:root",
      { schema: { params: z.object({ root: hex32 }) } },
      async (req, reply) => {
        const [batch] = await deps.db
          .select()
          .from(acceptanceBatches)
          .where(
            and(
              eq(acceptanceBatches.root, req.params.root),
              eq(acceptanceBatches.status, "anchored"),
            ),
          );
        if (!batch?.manifestHash) throw notFound("Batch");
        const bytes = await deps.storage.get(batch.manifestHash);
        if (!bytes) throw notFound("Batch manifest");
        return reply
          .header("content-type", "application/json; charset=utf-8")
          .header("x-content-sha256", batch.manifestHash)
          .header("x-batch-transaction", batch.txSignature ?? "")
          .header("access-control-allow-origin", "*")
          .send(Buffer.from(bytes));
      },
    );

    app.get(
      "/v1/public/versions/:address",
      { schema: { params: z.object({ address: base58Address }) } },
      async (req) => {
        const [v] = await deps.db
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.address, req.params.address));
        if (!v) throw notFound("Version");
        const [doc] = await deps.db.select().from(documents).where(eq(documents.id, v.documentId));
        const [org] = await deps.db
          .select()
          .from(organizations)
          .where(eq(organizations.id, v.organizationId));
        return { version: v, document: doc, organization: publicOrg(org!) };
      },
    );
  };
}

export interface VerifiedReceipt {
  receipt: Receipt | ReceiptV2;
  report: VerificationReport;
  /** The signer's time zone from the off-chain audit trail (never the IP). */
  signerContext: { timeZone: string; utcOffsetMinutes: number | null } | null;
}

/**
 * The receipt bundle for an acceptance, produced by running the independent verifier against the
 * chain — never from database rows alone. Cached briefly (verification costs RPC round trips).
 */
export async function verifiedReceipt(
  deps: Deps,
  acceptanceId: string,
): Promise<
  | { status: "ok"; body: VerifiedReceipt; challengeId: string | null }
  | { status: "invalid"; report: VerificationReport }
> {
  const cached = receiptCache.get(acceptanceId);
  if (cached && Date.now() - cached.at < RECEIPT_TTL_MS)
    return { status: "ok", body: cached.body, challengeId: cached.challengeId };
  const [a] = await deps.db
    .select()
    .from(acceptances)
    .where(eq(acceptances.acceptanceId, acceptanceId));
  if (!a) throw notFound("Acceptance");
  // Signer-type evidence (passkey signers) is verified by the verifier like everything else.
  const [challenge] = a.challengeId
    ? await deps.db
        .select()
        .from(acceptanceChallenges)
        .where(eq(acceptanceChallenges.id, a.challengeId))
    : [];
  const signer = await signerEvidenceFor(deps, {
    signerType: a.signerType,
    passkeyAssertion: (challenge?.passkeyAssertion as PasskeyAssertion | null) ?? null,
  });
  // MERKLE_BATCHED: the evidence is off-chain (the leaf + its inclusion proof); the verifier
  // checks every part of it against the anchored root before a receipt is issued.
  const batched =
    a.evidenceMode === "MERKLE_BATCHED" ? await leafEvidence(deps, a.acceptanceId) : null;
  if (a.evidenceMode === "MERKLE_BATCHED" && !batched)
    throw conflict("pending_batch", "This acceptance is not anchored yet");
  const report = await verifyAcceptance(
    {
      transactionSignature: a.txSignature,
      acceptanceId: a.acceptanceId,
      signer,
      // stele/2: only the hash is on-chain; the verifier accepts the text only if it matches.
      message: a.signedMessage ?? undefined,
      batched: batched?.evidence,
    },
    {
      chain: deps.chain.verifierSource(),
      programId: deps.chain.programAddress,
      content: { mirrors: [deps.config.PUBLIC_CONTENT_BASE_URL] },
      fetchImpl: storageBackedFetch(deps),
      trustedRequestDomains: [deps.config.HOSTED_ACCEPT_DOMAIN],
    },
  );
  if (report.verdict !== "VALID" && report.verdict !== "VALID_WITH_WARNINGS")
    return { status: "invalid", report };
  const receipt =
    report.facts.acceptance?.protocol === "stele/2" ||
    report.facts.acceptance?.evidenceMode === "MERKLE_BATCHED"
      ? receiptV2FromReport(report, { includeContent: true })
      : receiptFromReport(report, { includeContent: true });
  // Not part of the receipt: the audit trail is not evidence the verifier checks.
  const signerContext = challenge?.signerTimeZone
    ? { timeZone: challenge.signerTimeZone, utcOffsetMinutes: challenge.signerUtcOffsetMinutes }
    : null;
  const body: VerifiedReceipt = { receipt, report, signerContext };
  receiptCache.set(acceptanceId, { at: Date.now(), body, challengeId: a.challengeId });
  if (receiptCache.size > 5_000) receiptCache.delete(receiptCache.keys().next().value!);
  return { status: "ok", body, challengeId: a.challengeId };
}

/** Lets the in-process verifier read our own content store for the content mirror URL. */
function storageBackedFetch(deps: Deps): typeof fetch {
  const prefix = `${deps.config.PUBLIC_CONTENT_BASE_URL.replace(/\/$/, "")}/`;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(prefix)) {
      const hash = url.slice(prefix.length);
      if (/^[0-9a-f]{64}$/.test(hash)) {
        const bytes = await deps.storage.get(hash);
        return bytes
          ? new Response(Buffer.from(bytes), { status: 200 })
          : new Response("not found", { status: 404 });
      }
    }
    return fetch(input, init);
  }) as typeof fetch;
}
