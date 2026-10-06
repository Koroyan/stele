/**
 * Documents, drafts and publication.
 *
 * Drafts are mutable working copies and are NOT evidence. Publication is a two-step, wallet-signed
 * process:
 *   1. `prepare` canonicalizes the draft, stores the canonical bytes content-addressed, and returns
 *      the exact content hash and version fingerprint (the publisher's browser recomputes both).
 *   2. The publisher's wallet signs `publish_version` (with `expected_version_hash`); the program
 *      recomputes the fingerprint and refuses any mismatch.
 *   3. `confirm` reads the confirmed transaction from the chain and mirrors the result.
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { address } from "@solana/kit";
import {
  acceptances,
  and,
  contentObjects,
  count,
  desc,
  documentDrafts,
  documents,
  documentVersions,
  eq,
  organizations,
} from "@stele/db";
import {
  ProtocolError,
  authoringInput,
  canonicalizeContent,
  contentWordCount,
  decodePublishVersionArgs,
  fromBase64,
  fromUtf8,
  identifyInstruction,
  preparePublication,
  serializeContent,
  toHex,
  validateTitle,
  validateVersionLabel,
} from "@stele/protocol";
import { decodeWireTransaction } from "@stele/verifier";
import type { Deps } from "../deps.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { appendAudit } from "../lib/audit.js";
import { hashIp } from "../lib/crypto.js";
import { syncDocument } from "../lib/sync.js";
import { enqueueWebhook } from "../lib/webhooks.js";
import { requireOrgRole, requireUser, type OrgRole } from "../plugins/auth.js";
import { base58Address, base58Signature, orgParams, uuid } from "./schemas.js";

const draftBody = z.object({
  title: z.string().min(1).max(200),
  versionLabel: z.string().min(1).max(16),
  effectiveAt: z.number().int().positive().nullable().optional(),
  source: z.string().min(1).max(2_000_000),
  changeSummary: z.string().max(4_000).nullable().optional(),
});

async function documentAccess(deps: Deps, req: FastifyRequest, documentId: string, min: OrgRole) {
  const [doc] = await deps.db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) throw notFound("Document");
  const access = await requireOrgRole(deps, req, doc.organizationId, min);
  return { doc, access };
}

function protocolError(e: unknown): never {
  if (e instanceof ProtocolError) throw badRequest("invalid_content", e.message);
  throw e;
}

export function documentRoutes(deps: Deps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      "/v1/organizations/:orgId/documents",
      { schema: { params: orgParams } },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "member");
        const docs = await deps.db
          .select()
          .from(documents)
          .where(eq(documents.organizationId, access.organizationId));
        const counts = await deps.db
          .select({ documentId: acceptances.documentId, n: count() })
          .from(acceptances)
          .where(eq(acceptances.organizationId, access.organizationId))
          .groupBy(acceptances.documentId);
        const versions = await deps.db
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.organizationId, access.organizationId));
        return {
          documents: docs.map((d) => {
            const current = versions.find((v) => v.address === d.currentVersionAddress) ?? null;
            return {
              ...d,
              currentVersion: current,
              acceptanceCount: counts.find((c) => c.documentId === d.id)?.n ?? 0,
            };
          }),
        };
      },
    );

    /** Mirrors a document created on-chain by the organization's wallet. */
    app.post(
      "/v1/organizations/:orgId/documents/sync",
      { schema: { params: orgParams, body: z.object({ address: base58Address }) } },
      async (req) => {
        const user = requireUser(req);
        const access = await requireOrgRole(deps, req, req.params.orgId, "publisher");
        const synced = await syncDocument(deps.db, deps.chain, req.body.address);
        if (!synced || synced.organizationId !== access.organizationId)
          throw notFound("On-chain document of this organization");
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "document.created",
          targetType: "document",
          targetId: req.body.address,
        });
        const [doc] = await deps.db.select().from(documents).where(eq(documents.id, synced.id));
        return { document: doc };
      },
    );

    app.get(
      "/v1/documents/:documentId",
      { schema: { params: z.object({ documentId: uuid }) } },
      async (req) => {
        const { doc, access } = await documentAccess(deps, req, req.params.documentId, "member");
        const versions = await deps.db
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.documentId, doc.id))
          .orderBy(desc(documentVersions.number));
        const perVersion = await deps.db
          .select({ versionAddress: acceptances.versionAddress, n: count() })
          .from(acceptances)
          .where(eq(acceptances.documentId, doc.id))
          .groupBy(acceptances.versionAddress);
        const drafts = await deps.db
          .select()
          .from(documentDrafts)
          .where(eq(documentDrafts.documentId, doc.id))
          .orderBy(desc(documentDrafts.updatedAt));
        const [org] = await deps.db
          .select()
          .from(organizations)
          .where(eq(organizations.id, doc.organizationId));
        return {
          document: doc,
          organization: {
            id: org!.id,
            address: org!.address,
            name: org!.name,
            verifiedDomain: org!.verifiedDomain,
          },
          role: access.role,
          versions: versions.map((v) => ({
            ...v,
            acceptanceCount: perVersion.find((p) => p.versionAddress === v.address)?.n ?? 0,
          })),
          drafts: drafts.filter((d) => d.status !== "abandoned"),
        };
      },
    );

    // ---- drafts (mutable, not evidence) -------------------------------------------------------

    app.post(
      "/v1/documents/:documentId/drafts",
      { schema: { params: z.object({ documentId: uuid }), body: draftBody } },
      async (req) => {
        const user = requireUser(req);
        const { doc, access } = await documentAccess(deps, req, req.params.documentId, "publisher");
        const [draft] = await deps.db
          .insert(documentDrafts)
          .values({
            documentId: doc.id,
            title: req.body.title,
            versionLabel: req.body.versionLabel,
            effectiveAt: req.body.effectiveAt ?? null,
            source: req.body.source,
            changeSummary: req.body.changeSummary ?? null,
            createdBy: user.id,
            updatedBy: user.id,
          })
          .returning();
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "draft.created",
          targetType: "draft",
          targetId: draft!.id,
        });
        return { draft };
      },
    );

    app.get(
      "/v1/drafts/:draftId",
      { schema: { params: z.object({ draftId: uuid }) } },
      async (req) => {
        const [draft] = await deps.db
          .select()
          .from(documentDrafts)
          .where(eq(documentDrafts.id, req.params.draftId));
        if (!draft) throw notFound("Draft");
        await documentAccess(deps, req, draft.documentId, "member");
        let preview: unknown;
        try {
          const content = canonicalizeContent(authoringInput(draft.source, draft.changeSummary));
          const bytes = serializeContent(content);
          preview = {
            content,
            canonical: fromUtf8(bytes),
            byteSize: bytes.length,
            wordCount: contentWordCount(content),
            error: null,
          };
        } catch (e) {
          preview = { content: null, error: e instanceof Error ? e.message : String(e) };
        }
        return { draft, preview };
      },
    );

    app.patch(
      "/v1/drafts/:draftId",
      { schema: { params: z.object({ draftId: uuid }), body: draftBody.partial() } },
      async (req) => {
        const user = requireUser(req);
        const [draft] = await deps.db
          .select()
          .from(documentDrafts)
          .where(eq(documentDrafts.id, req.params.draftId));
        if (!draft) throw notFound("Draft");
        await documentAccess(deps, req, draft.documentId, "publisher");
        if (draft.status === "published")
          throw conflict("draft_published", "Published drafts are immutable; create a new draft");
        const [updated] = await deps.db
          .update(documentDrafts)
          .set({
            ...req.body,
            effectiveAt:
              req.body.effectiveAt === undefined ? draft.effectiveAt : req.body.effectiveAt,
            // Any edit invalidates a previous preparation.
            status: "draft",
            preparedContentHash: null,
            preparedVersionHash: null,
            preparedVersionNumber: null,
            updatedBy: user.id,
            updatedAt: new Date(),
          })
          .where(eq(documentDrafts.id, draft.id))
          .returning();
        return { draft: updated };
      },
    );

    app.post(
      "/v1/drafts/:draftId/abandon",
      { schema: { params: z.object({ draftId: uuid }) } },
      async (req) => {
        const [draft] = await deps.db
          .select()
          .from(documentDrafts)
          .where(eq(documentDrafts.id, req.params.draftId));
        if (!draft) throw notFound("Draft");
        await documentAccess(deps, req, draft.documentId, "publisher");
        if (draft.status === "published")
          throw conflict("draft_published", "Published drafts cannot be abandoned");
        await deps.db
          .update(documentDrafts)
          .set({ status: "abandoned", updatedAt: new Date() })
          .where(eq(documentDrafts.id, draft.id));
        return { ok: true };
      },
    );

    // ---- publication ---------------------------------------------------------------------------

    app.post(
      "/v1/drafts/:draftId/prepare",
      { schema: { params: z.object({ draftId: uuid }) } },
      async (req) => {
        const user = requireUser(req);
        const [draft] = await deps.db
          .select()
          .from(documentDrafts)
          .where(eq(documentDrafts.id, req.params.draftId));
        if (!draft) throw notFound("Draft");
        const { doc, access } = await documentAccess(deps, req, draft.documentId, "publisher");
        if (draft.status === "published" || draft.status === "abandoned")
          throw conflict("draft_closed", `Draft is ${draft.status}`);
        try {
          validateTitle(draft.title);
          validateVersionLabel(draft.versionLabel);
        } catch (e) {
          protocolError(e);
        }
        let content;
        try {
          content = canonicalizeContent(authoringInput(draft.source, draft.changeSummary));
        } catch (e) {
          protocolError(e);
        }
        const now = await deps.chain.clusterTime();
        if (draft.effectiveAt !== null && draft.effectiveAt < now + 15 * 60) {
          throw badRequest(
            "invalid_effective_date",
            "The effective date must be at least 15 minutes in the future (or empty for 'upon publication')",
          );
        }
        const prepared = await preparePublication({
          rpc: deps.chain.rpc,
          programAddress: deps.chain.programAddress,
          organization: address(access.organizationAddress),
          document: address(doc.address),
          title: draft.title,
          versionLabel: draft.versionLabel,
          effectiveAt: draft.effectiveAt ?? 0,
          content: content!,
        });
        const stored = await deps.storage.put(prepared.contentBytes);
        await deps.db
          .insert(contentObjects)
          .values({
            contentHash: stored.contentHash,
            byteSize: prepared.contentBytes.length,
            cid: stored.cid,
            locations: [{ ...stored.location, storedAt: new Date().toISOString() }],
          })
          .onConflictDoNothing();
        await deps.db
          .update(documentDrafts)
          .set({
            status: "prepared",
            preparedVersionNumber: prepared.versionNumber,
            preparedContentHash: toHex(prepared.contentHash),
            preparedVersionHash: toHex(prepared.versionHash),
            updatedBy: user.id,
            updatedAt: new Date(),
          })
          .where(eq(documentDrafts.id, draft.id));
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "version.publication_requested",
          targetType: "document",
          targetId: doc.address,
          metadata: {
            versionNumber: prepared.versionNumber,
            versionHash: toHex(prepared.versionHash),
            contentHash: toHex(prepared.contentHash),
          },
          ipHash: hashIp(req.ip, deps.config.IP_HASH_SECRET),
        });
        return {
          publication: {
            draftId: draft.id,
            organization: access.organizationAddress,
            document: doc.address,
            programId: deps.chain.programAddress,
            chainId: prepared.chainId,
            versionNumber: prepared.versionNumber,
            versionAccount: prepared.versionAccount,
            previousVersionHash: toHex(prepared.previousVersionHash),
            title: draft.title,
            versionLabel: draft.versionLabel,
            effectiveAt: draft.effectiveAt ?? 0,
            canonicalContent: fromUtf8(prepared.contentBytes),
            contentHash: toHex(prepared.contentHash),
            storageUri: prepared.storageUri,
            versionJson: prepared.versionJson,
            versionHash: toHex(prepared.versionHash),
          },
        };
      },
    );

    /** Mirrors a confirmed publication transaction (the chain is the source of truth). */
    app.post(
      "/v1/publications/confirm",
      { schema: { body: z.object({ signature: base58Signature }) } },
      async (req) => {
        const user = requireUser(req);
        const tx = await deps.chain.rpc
          .getTransaction(req.body.signature as never, {
            encoding: "base64",
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
          })
          .send();
        if (!tx) throw notFound("Confirmed transaction");
        if (tx.meta?.err)
          throw conflict(
            "transaction_failed",
            "The transaction failed on-chain and published nothing",
          );
        const decoded = decodeWireTransaction(
          fromBase64(tx.transaction[0]),
          [...(tx.meta?.loadedAddresses?.writable ?? [])],
          [...(tx.meta?.loadedAddresses?.readonly ?? [])],
        );
        const publishes = decoded.instructions.filter(
          (ix) =>
            ix.programId === deps.chain.programAddress &&
            identifyInstruction(ix.data) === "publish_version",
        );
        if (publishes.length === 0)
          throw badRequest("not_a_publication", "The transaction does not publish a Stele version");
        const results = [];
        for (const ix of publishes) {
          const documentAddress = ix.accounts[4]!;
          const synced = await syncDocument(deps.db, deps.chain, documentAddress);
          if (!synced) continue;
          const access = await requireOrgRole(deps, req, synced.organizationId, "member");
          const versionAddress = ix.accounts[5]!;
          await deps.db
            .update(documentVersions)
            .set({ publishTx: req.body.signature })
            .where(eq(documentVersions.address, versionAddress));
          const [version] = await deps.db
            .select()
            .from(documentVersions)
            .where(eq(documentVersions.address, versionAddress));
          if (!version) continue;
          const args = decodePublishVersionArgs(ix.data);
          await deps.db
            .update(documentDrafts)
            .set({ status: "published", updatedAt: new Date() })
            .where(
              and(
                eq(documentDrafts.documentId, synced.id),
                eq(documentDrafts.preparedVersionHash, toHex(args.expectedVersionHash)),
              ),
            );
          await appendAudit(deps.db, {
            organizationId: access.organizationId,
            actorType: "user",
            actorId: user.id,
            action: "version.published",
            targetType: "version",
            targetId: versionAddress,
            metadata: {
              versionNumber: version.number,
              versionHash: version.versionHash,
              publisher: version.publisherAddress,
            },
            txSignature: req.body.signature,
          });
          await enqueueWebhook(deps.db, access.organizationId, "document.version_published", {
            document: documentAddress,
            version: versionAddress,
            versionNumber: version.number,
            versionLabel: version.versionLabel,
            fingerprint: version.versionHash,
            contentHash: version.contentHash,
            transactionSignature: req.body.signature,
            publisher: version.publisherAddress,
          });
          results.push(version);
        }
        return { versions: results };
      },
    );
  };
}
