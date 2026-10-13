/**
 * PDF receipts ("Certificate of Acceptance"). The receipt inside is always the verified one (see
 * verifiedReceipt); what differs is how much of the off-chain audit trail is shown:
 *
 *   GET  /v1/public/acceptances/:acceptanceId/receipt.pdf                 public: time zone only
 *   POST /v1/acceptance/challenges/:challengeId/receipt.pdf  {clientBinding}  the signer: + IP
 *   GET  /v1/organizations/:orgId/acceptances/:acceptanceId/receipt.pdf   the organization: + IP
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { acceptanceChallenges, acceptances, and, eq } from "@stele/db";
import type { Deps } from "../deps.js";
import { ApiError, notFound } from "../errors.js";
import { decrypt, matchesHash } from "../lib/crypto.js";
import { requireOrgRole } from "../plugins/auth.js";
import { receiptPdf, type ReceiptAudit } from "../services/receipt-pdf.js";
import { verifiedReceipt } from "./public.js";
import { hex32, orgParams, uuid } from "./schemas.js";

/** Public certificates are the same for everyone: keep a few rendered ones. */
const publicPdfCache = new Map<string, { at: number; pdf: Uint8Array }>();
const PUBLIC_PDF_TTL_MS = 10 * 60_000;
const rateLimit = { rateLimit: { max: 10, timeWindow: "1 minute" } };

export function receiptPdfRoutes(deps: Deps): FastifyPluginAsyncZod {
  async function certificate(
    acceptanceId: string,
    audit: (challengeId: string | null) => Promise<ReceiptAudit | null>,
  ) {
    const result = await verifiedReceipt(deps, acceptanceId);
    if (result.status === "invalid")
      throw new ApiError(422, "verification_failed", `Evidence verdict: ${result.report.verdict}`);
    return receiptPdf(deps, result.body.receipt, await audit(result.challengeId));
  }

  /** The audit trail of a challenge, with the IP decrypted. */
  async function fullAudit(challengeId: string | null): Promise<ReceiptAudit | null> {
    if (!challengeId) return null;
    const [ch] = await deps.db
      .select()
      .from(acceptanceChallenges)
      .where(eq(acceptanceChallenges.id, challengeId));
    if (!ch) return null;
    let ip: string | null;
    try {
      ip = ch.signerIpCiphertext ? decrypt(ch.signerIpCiphertext, deps.encryptionKey) : null;
    } catch {
      ip = null;
    }
    return { ip, timeZone: ch.signerTimeZone, utcOffsetMinutes: ch.signerUtcOffsetMinutes };
  }

  function send(
    reply: FastifyReply,
    acceptanceId: string,
    pdf: Uint8Array,
    cache: "public" | "private",
  ) {
    return reply
      .header("content-type", "application/pdf")
      .header(
        "content-disposition",
        `attachment; filename="stele-receipt-${acceptanceId.slice(0, 16)}.pdf"`,
      )
      .header("cache-control", cache === "public" ? "public, max-age=600" : "private, no-store")
      .send(Buffer.from(pdf));
  }

  return async (app) => {
    app.get(
      "/v1/public/acceptances/:acceptanceId/receipt.pdf",
      { config: rateLimit, schema: { params: z.object({ acceptanceId: hex32 }) } },
      async (req, reply) => {
        const id = req.params.acceptanceId;
        const cached = publicPdfCache.get(id);
        if (cached && Date.now() - cached.at < PUBLIC_PDF_TTL_MS)
          return send(reply, id, cached.pdf, "public");
        // Public: the signer's time zone only, never the IP address.
        const pdf = await certificate(id, async (challengeId) => {
          const a = await fullAudit(challengeId);
          return a ? { timeZone: a.timeZone, utcOffsetMinutes: a.utcOffsetMinutes } : null;
        });
        publicPdfCache.set(id, { at: Date.now(), pdf });
        if (publicPdfCache.size > 200) publicPdfCache.delete(publicPdfCache.keys().next().value!);
        return send(reply, id, pdf, "public");
      },
    );

    app.post(
      "/v1/acceptance/challenges/:challengeId/receipt.pdf",
      {
        config: rateLimit,
        schema: {
          params: z.object({ challengeId: uuid }),
          body: z.object({ clientBinding: z.string().min(20).max(64) }),
        },
      },
      async (req, reply) => {
        // The signer's own certificate, with the full audit trail: proven by the client binding
        // secret that only the browser which made this acceptance holds.
        const [ch] = await deps.db
          .select()
          .from(acceptanceChallenges)
          .where(eq(acceptanceChallenges.id, req.params.challengeId));
        if (!ch || !matchesHash(req.body.clientBinding, ch.clientBindingHash) || !ch.acceptanceId)
          throw notFound("Acceptance");
        const pdf = await certificate(ch.acceptanceId, fullAudit);
        return send(reply, ch.acceptanceId, pdf, "private");
      },
    );

    app.get(
      "/v1/organizations/:orgId/acceptances/:acceptanceId/receipt.pdf",
      { config: rateLimit, schema: { params: orgParams.extend({ acceptanceId: hex32 }) } },
      async (req, reply) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "member");
        const [a] = await deps.db
          .select({ id: acceptances.acceptanceId })
          .from(acceptances)
          .where(
            and(
              eq(acceptances.acceptanceId, req.params.acceptanceId),
              eq(acceptances.organizationId, access.organizationId),
            ),
          );
        if (!a) throw notFound("Acceptance");
        const pdf = await certificate(a.id, fullAudit);
        return send(reply, a.id, pdf, "private");
      },
    );
  };
}
