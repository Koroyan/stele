/**
 * Acceptance endpoints.
 *
 * Browser flow (hosted page or embedded SDK; public, CORS-enabled, no cookies):
 *   POST /v1/acceptance/challenges              → message to sign + client binding secret
 *   POST /v1/acceptance/challenges/:id/submit   → relay the signed acceptance
 *   GET  /v1/acceptance/challenges/:id          → status
 *
 * Server-to-server (API key): acceptance sessions (gating + attribution) and acceptance queries.
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  acceptanceChallenges,
  acceptanceSessions,
  acceptances,
  and,
  desc,
  documents,
  documentVersions,
  eq,
  gte,
  isNull,
  lt,
  lte,
  organizations,
} from "@stele/db";
import type { Deps } from "../deps.js";
import { badRequest, notFound } from "../errors.js";
import { decrypt, encrypt, randomToken, sha256Hex } from "../lib/crypto.js";
import { afterCursor, cursorParam, page } from "../lib/pagination.js";
import {
  getChallengeStatus,
  issueChallenge,
  requestDomainFromOrigin,
  submitChallenge,
} from "../services/acceptance.js";
import { requireApiKey, requireOrgRole } from "../plugins/auth.js";
import {
  base58Address,
  base58Signature,
  hex32,
  orgParams,
  passkeyAssertionBody,
  signerKey,
  slug,
  uuid,
} from "./schemas.js";

export function acceptanceRoutes(deps: Deps): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      "/v1/acceptance/challenges",
      {
        config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
        schema: {
          body: z.object({
            organization: base58Address,
            document: base58Address,
            signer: signerKey,
            sessionToken: z.string().max(128).optional(),
            signerType: z.enum(["wallet", "passkey", "passkey_p256"]).default("wallet"),
          }),
        },
      },
      async (req) => {
        // The requesting site comes from the browser's Origin header, not from the request body.
        const requestDomain = requestDomainFromOrigin(
          req.headers.origin,
          deps.config.HOSTED_ACCEPT_DOMAIN,
        );
        return issueChallenge(deps, { ...req.body, requestDomain });
      },
    );

    app.post(
      "/v1/acceptance/challenges/:challengeId/submit",
      {
        config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
        schema: {
          params: z.object({ challengeId: uuid }),
          body: z.object({
            clientBinding: z.string().min(20).max(64),
            /** Ed25519 signature (wallet / PRF signers); native passkeys send only the assertion. */
            signature: base58Signature.optional(),
            passkeyAssertion: passkeyAssertionBody.optional(),
            /** The browser's IANA time zone and UTC offset, for the off-chain audit trail. */
            timeZone: z
              .string()
              .max(64)
              .regex(/^[A-Za-z0-9_+\-/]+$/)
              .optional(),
            utcOffsetMinutes: z.number().int().min(-840).max(840).optional(),
          }),
        },
      },
      async (req) => {
        const result = await submitChallenge(
          deps,
          req.params.challengeId,
          req.body.clientBinding,
          req.body.signature,
          req.body.passkeyAssertion,
        );
        // Off-chain audit trail, written only after the client binding was checked, and once:
        // the IP address the signature came from (encrypted) and the signer's time zone.
        const audit = {
          ip: req.ip ?? null,
          timeZone: req.body.timeZone ?? null,
          utcOffsetMinutes: req.body.utcOffsetMinutes ?? null,
        };
        await deps.db
          .update(acceptanceChallenges)
          .set({
            signerIpCiphertext: audit.ip ? encrypt(audit.ip, deps.encryptionKey) : null,
            signerTimeZone: audit.timeZone,
            signerUtcOffsetMinutes: audit.utcOffsetMinutes,
          })
          .where(
            and(
              eq(acceptanceChallenges.id, req.params.challengeId),
              isNull(acceptanceChallenges.signerIpCiphertext),
            ),
          );
        return { ...result, audit };
      },
    );

    app.get(
      "/v1/acceptance/challenges/:challengeId",
      { schema: { params: z.object({ challengeId: uuid }) } },
      async (req) => {
        const binding = req.headers["x-client-binding"];
        if (typeof binding !== "string")
          throw badRequest("missing_binding", "x-client-binding header required");
        return getChallengeStatus(deps, req.params.challengeId, binding);
      },
    );

    // ---- server-to-server ----------------------------------------------------------------------

    app.post(
      "/v1/acceptance-sessions",
      {
        schema: {
          body: z.object({
            document: z.union([base58Address, slug]).optional(),
            externalUserRef: z
              .string()
              .min(1)
              .max(128)
              .regex(/^[\x21-\x7e]+$/, "printable ASCII without spaces")
              .optional(),
            ttlSeconds: z.number().int().min(60).max(3_600).default(900),
          }),
        },
      },
      async (req) => {
        const key = requireApiKey(req, "acceptances:write");
        let documentId: string | null = null;
        if (req.body.document) {
          const [doc] = await deps.db
            .select()
            .from(documents)
            .where(
              and(
                eq(documents.organizationId, key.organizationId),
                /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(req.body.document)
                  ? eq(documents.address, req.body.document)
                  : eq(documents.slug, req.body.document),
              ),
            );
          if (!doc) throw notFound("Document");
          documentId = doc.id;
        }
        const token = `stls_${randomToken(32)}`;
        const expiresAt = new Date(Date.now() + req.body.ttlSeconds * 1000);
        await deps.db.insert(acceptanceSessions).values({
          organizationId: key.organizationId,
          documentId,
          tokenHash: sha256Hex(token),
          externalUserRef: req.body.externalUserRef ?? null,
          createdByApiKeyId: key.id,
          expiresAt,
        });
        return { sessionToken: token, expiresAt: expiresAt.toISOString() };
      },
    );

    const acceptanceQuery = z.object({
      document: base58Address.optional(),
      version: base58Address.optional(),
      signer: base58Address.optional(),
      externalUserRef: z.string().max(128).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      before: z.coerce.date().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      cursor: cursorParam,
    });

    /** The acceptance record served to integrations (list items and single lookups alike). */
    const record = {
      acceptanceId: acceptances.acceptanceId,
      transactionSignature: acceptances.txSignature,
      slot: acceptances.slot,
      blockTime: acceptances.blockTime,
      signer: acceptances.signerAddress,
      signerType: acceptances.signerType,
      versionAddress: acceptances.versionAddress,
      versionNumber: acceptances.versionNumber,
      requestDomain: acceptances.requestDomain,
      externalUserRef: acceptances.externalUserRef,
      commitment: acceptances.commitment,
      documentSlug: documents.slug,
      feePayer: acceptances.feePayer,
      feeLamports: acceptances.feeLamports,
      reimbursedLamports: acceptances.reimbursedLamports,
      signerIpCiphertext: acceptanceChallenges.signerIpCiphertext,
      signerTimeZone: acceptanceChallenges.signerTimeZone,
      signerUtcOffsetMinutes: acceptanceChallenges.signerUtcOffsetMinutes,
    };

    /** The organization's own audit trail for an acceptance (off-chain; the IP decrypted). */
    function withAudit<
      T extends {
        signerIpCiphertext: string | null;
        signerTimeZone: string | null;
        signerUtcOffsetMinutes: number | null;
      },
    >(row: T) {
      const { signerIpCiphertext, signerTimeZone, signerUtcOffsetMinutes, ...rest } = row;
      let ip: string | null;
      try {
        ip = signerIpCiphertext ? decrypt(signerIpCiphertext, deps.encryptionKey) : null;
      } catch {
        ip = null;
      }
      return {
        ...rest,
        audit: { ip, timeZone: signerTimeZone, utcOffsetMinutes: signerUtcOffsetMinutes },
      };
    }

    async function listAcceptances(organizationId: string, q: z.infer<typeof acceptanceQuery>) {
      const conditions = [eq(acceptances.organizationId, organizationId)];
      if (q.document) {
        const [doc] = await deps.db
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.address, q.document));
        if (!doc) return { acceptances: [], nextCursor: null };
        conditions.push(eq(acceptances.documentId, doc.id));
      }
      if (q.version) conditions.push(eq(acceptances.versionAddress, q.version));
      if (q.signer) conditions.push(eq(acceptances.signerAddress, q.signer));
      if (q.externalUserRef) conditions.push(eq(acceptances.externalUserRef, q.externalUserRef));
      if (q.from) conditions.push(gte(acceptances.blockTime, q.from));
      if (q.to) conditions.push(lte(acceptances.blockTime, q.to));
      if (q.before) conditions.push(lt(acceptances.blockTime, q.before));
      if (q.cursor)
        conditions.push(afterCursor(q.cursor, acceptances.slot, acceptances.acceptanceId));
      const rows = await deps.db
        .select(record)
        .from(acceptances)
        .innerJoin(documents, eq(documents.id, acceptances.documentId))
        .leftJoin(acceptanceChallenges, eq(acceptanceChallenges.id, acceptances.challengeId))
        .where(and(...conditions))
        .orderBy(desc(acceptances.slot), desc(acceptances.acceptanceId))
        .limit(q.limit + 1);
      const { items, nextCursor } = page(rows, q.limit, (r) => ({
        slot: r.slot,
        id: r.acceptanceId,
      }));
      return { acceptances: items.map(withAudit), nextCursor };
    }

    app.get("/v1/acceptances", { schema: { querystring: acceptanceQuery } }, async (req) => {
      const key = requireApiKey(req, "acceptances:read");
      return listAcceptances(key.organizationId, req.query);
    });

    app.get(
      "/v1/organizations/:orgId/acceptances",
      { schema: { params: orgParams, querystring: acceptanceQuery } },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "member");
        return listAcceptances(access.organizationId, req.query);
      },
    );

    app.get(
      "/v1/acceptances/:acceptanceId",
      { schema: { params: z.object({ acceptanceId: hex32 }) } },
      async (req) => {
        const key = requireApiKey(req, "acceptances:read");
        const [a] = await deps.db
          .select(record)
          .from(acceptances)
          .innerJoin(documents, eq(documents.id, acceptances.documentId))
          .leftJoin(acceptanceChallenges, eq(acceptanceChallenges.id, acceptances.challengeId))
          .where(
            and(
              eq(acceptances.acceptanceId, req.params.acceptanceId),
              eq(acceptances.organizationId, key.organizationId),
            ),
          );
        if (!a) throw notFound("Acceptance");
        return {
          acceptance: withAudit(a),
          receiptUrl: `${deps.config.APP_ORIGIN}/receipt/${a.acceptanceId}`,
        };
      },
    );

    /** Latest version of a document, for server-side "has this user accepted the current terms?" checks. */
    app.get(
      "/v1/documents/by-slug/:slug/latest",
      { schema: { params: z.object({ slug }) } },
      async (req) => {
        const key = requireApiKey(req, "documents:read");
        const [doc] = await deps.db
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.organizationId, key.organizationId),
              eq(documents.slug, req.params.slug),
            ),
          );
        if (!doc?.currentVersionAddress) throw notFound("Published document");
        const [v] = await deps.db
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.address, doc.currentVersionAddress));
        const [org] = await deps.db
          .select()
          .from(organizations)
          .where(eq(organizations.id, key.organizationId));
        return {
          organization: org!.address,
          document: doc.address,
          version: {
            address: v!.address,
            number: v!.number,
            label: v!.versionLabel,
            title: v!.title,
            fingerprint: v!.versionHash,
            effectiveAt: v!.effectiveAt,
          },
        };
      },
    );
  };
}
