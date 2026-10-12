/**
 * Proof endpoints (purchases, refunds, consents…).
 *
 * Organization server (API key):
 *   POST /v1/proof-requests                 → statement + request ID + client token
 *   GET  /v1/proofs, GET /v1/proofs/:proofId, GET /v1/proofs/:proofId/receipt
 *
 * Customer browser (public, CORS without credentials, client token):
 *   GET  /v1/proof-requests/:id             → the statement to confirm
 *   POST /v1/proof-requests/:id/challenge   → anchor message to sign
 *   POST /v1/proof-requests/:id/submit      → record it
 *   GET  /v1/proof-requests/:id/receipt     → stele-proof-v1 receipt (verified against the chain)
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { PROOF_TYPES, type ProofTypeName } from "@stelehq/protocol";
import { proofReceiptFromReport, verifyProof } from "@stelehq/verifier";
import type { Deps } from "../deps.js";
import { ApiError, badRequest } from "../errors.js";
import { cursorParam } from "../lib/pagination.js";
import { requireApiKey } from "../plugins/auth.js";
import { requestDomainFromOrigin } from "../services/acceptance.js";
import {
  createProofRequest,
  getProofRequest,
  issueProofChallenge,
  listProofs,
  proofEvidence,
  proofEvidenceForRequest,
  submitProof,
} from "../services/proofs.js";
import { base58Address, base58Signature, hex32, passkeyAssertionBody, uuid } from "./schemas.js";

const typeNames = PROOF_TYPES.map((t) => t.name) as [ProofTypeName, ...ProofTypeName[]];
const token = z.string().min(20).max(100);

export function proofRoutes(deps: Deps): FastifyPluginAsyncZod {
  return async (app) => {
    async function receiptFor(evidence: Awaited<ReturnType<typeof proofEvidence>>) {
      const report = await verifyProof(
        {
          transactionSignature: evidence.proof.txSignature,
          proofId: evidence.proof.proofId,
          statement: evidence.statement,
          signer: evidence.signer,
        },
        {
          chain: deps.chain.verifierSource(),
          programId: deps.chain.programAddress,
          trustedRequestDomains: [deps.config.HOSTED_ACCEPT_DOMAIN],
        },
      );
      if (report.verdict !== "VALID" && report.verdict !== "VALID_WITH_WARNINGS")
        throw new ApiError(422, "verification_failed", `Evidence verdict: ${report.verdict}`, {
          report,
        });
      return { receipt: proofReceiptFromReport(report), report };
    }

    app.post(
      "/v1/proof-requests",
      {
        schema: {
          body: z.object({
            type: z.enum(typeNames),
            reference: z.string().min(1).max(128),
            summary: z.string().min(1).max(280),
            details: z.record(z.string(), z.unknown()),
            policies: z
              .array(
                z.object({
                  title: z.string().min(1).max(60),
                  version: z.number().int().positive(),
                  fingerprint: hex32,
                  acceptanceId: hex32.optional(),
                }),
              )
              .max(10)
              .optional(),
            relatesTo: hex32.optional(),
            externalUserRef: z
              .string()
              .min(1)
              .max(128)
              .regex(/^[\x21-\x7e]+$/)
              .optional(),
            ttlSeconds: z.number().int().min(60).max(86_400).default(1_800),
          }),
        },
      },
      async (req) => {
        const key = requireApiKey(req, "proofs:write");
        return createProofRequest(deps, key, req.body);
      },
    );

    app.get(
      "/v1/proof-requests/:id",
      { schema: { params: z.object({ id: uuid }) } },
      async (req) => {
        const t = req.headers["x-proof-token"];
        if (typeof t !== "string")
          throw badRequest("missing_token", "x-proof-token header required");
        return getProofRequest(deps, req.params.id, t);
      },
    );

    app.post(
      "/v1/proof-requests/:id/challenge",
      {
        config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
        schema: {
          params: z.object({ id: uuid }),
          body: z.object({
            token,
            signer: base58Address,
            signerType: z.enum(["wallet", "passkey"]).default("wallet"),
          }),
        },
      },
      async (req) =>
        issueProofChallenge(deps, req.params.id, {
          ...req.body,
          requestDomain: requestDomainFromOrigin(
            req.headers.origin,
            deps.config.HOSTED_ACCEPT_DOMAIN,
          ),
        }),
    );

    app.post(
      "/v1/proof-requests/:id/submit",
      {
        config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
        schema: {
          params: z.object({ id: uuid }),
          body: z.object({
            token,
            clientBinding: z.string().min(20).max(64),
            signature: base58Signature,
            passkeyAssertion: passkeyAssertionBody.optional(),
          }),
        },
      },
      async (req) => submitProof(deps, req.params.id, req.body),
    );

    app.get(
      "/v1/proof-requests/:id/receipt",
      { schema: { params: z.object({ id: uuid }) } },
      async (req) => {
        const t = req.headers["x-proof-token"];
        if (typeof t !== "string")
          throw badRequest("missing_token", "x-proof-token header required");
        return receiptFor(await proofEvidenceForRequest(deps, req.params.id, t));
      },
    );

    app.get(
      "/v1/proofs",
      {
        schema: {
          querystring: z.object({
            type: z.enum(typeNames).optional(),
            reference: z.string().max(128).optional(),
            externalUserRef: z.string().max(128).optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            cursor: cursorParam,
          }),
        },
      },
      async (req) => {
        const key = requireApiKey(req, "proofs:read");
        return listProofs(deps, key.organizationId, req.query);
      },
    );

    app.get(
      "/v1/proofs/:proofId",
      { schema: { params: z.object({ proofId: hex32 }) } },
      async (req) => {
        const key = requireApiKey(req, "proofs:read");
        const e = await proofEvidence(deps, req.params.proofId, key.organizationId);
        return { proof: e.proof, statement: e.statement, signer: e.signer };
      },
    );

    app.get(
      "/v1/proofs/:proofId/receipt",
      { schema: { params: z.object({ proofId: hex32 }) } },
      async (req) => {
        const key = requireApiKey(req, "proofs:read");
        return receiptFor(await proofEvidence(deps, req.params.proofId, key.organizationId));
      },
    );
  };
}
