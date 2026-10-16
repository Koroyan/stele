/**
 * Stele Gate routes (PROTOCOL_SPEC.md §18). The public access check is a convenience for SDKs that
 * decide whether to show the acceptance modal; protected programs never rely on it. Policies are
 * created and changed on-chain by the organization's own wallet; the API only mirrors them.
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Deps } from "../deps.js";
import { appendAudit } from "../lib/audit.js";
import { hashIp } from "../lib/crypto.js";
import { requireOrgRole, requireUser } from "../plugins/auth.js";
import {
  accessStatus,
  gateOverview,
  listAccessPasses,
  programActivity,
  refreshPolicy,
  registerProgram,
  removeProgram,
  runProbes,
} from "../services/gate.js";
import {
  ownershipMemo,
  programAndOrg,
  proveOwnership,
  saveProbeTemplate,
  verifiedView,
  verifyRegisteredProgram,
} from "../services/verification.js";
import { badgeSvg } from "../lib/badge-svg.js";
import { base58Address, orgParams, uuid } from "./schemas.js";

const probeTemplate = z.object({
  data: z
    .string()
    .max(2048)
    .regex(/^([0-9a-fA-F]{2})*$/, "hex bytes"),
  accounts: z
    .array(
      z.object({
        role: z.enum(["user", "passport", "accessPass", "policy", "address"]),
        address: base58Address.optional(),
        signer: z.boolean(),
        writable: z.boolean(),
      }),
    )
    .min(2)
    .max(32),
});
const programParams = orgParams.extend({ programId: uuid });

export function gateRoutes(deps: Deps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      "/v1/public/gate/access",
      {
        schema: {
          querystring: z.object({ policy: base58Address, holder: base58Address }),
        },
        config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      },
      async (req) => accessStatus(deps, req.query),
    );

    /** Stele Verified: what anyone may see about a program's verification. */
    app.get(
      "/v1/public/verified/:program",
      {
        schema: { params: z.object({ program: base58Address }) },
        config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      },
      async (req, reply) => {
        reply.header("cache-control", "public, max-age=30");
        return verifiedView(deps, req.params.program);
      },
    );

    /** The badge as an image, for READMEs and pages without JavaScript. */
    app.get(
      "/v1/public/verified/:program/badge.svg",
      {
        schema: {
          params: z.object({ program: base58Address }),
          querystring: z.object({ theme: z.enum(["dark", "light"]).default("dark") }),
        },
        config: { rateLimit: { max: 240, timeWindow: "1 minute" } },
      },
      async (req, reply) => {
        const view = await verifiedView(deps, req.params.program).catch(() => null);
        reply
          .type("image/svg+xml; charset=utf-8")
          .header("cache-control", "public, max-age=60")
          .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'");
        return badgeSvg(view?.status ?? "unverified", req.query.theme);
      },
    );

    app.get("/v1/organizations/:orgId/gate", { schema: { params: orgParams } }, async (req) => {
      const access = await requireOrgRole(deps, req, req.params.orgId, "member");
      return gateOverview(deps, access.organizationId);
    });

    /** After the organization's wallet created or changed a policy: mirror it from Solana. */
    app.post(
      "/v1/organizations/:orgId/gate/policies/:policy/refresh",
      { schema: { params: orgParams.extend({ policy: base58Address }) } },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "member");
        return refreshPolicy(deps, access.organizationId, req.params.policy);
      },
    );

    app.get(
      "/v1/organizations/:orgId/gate/passes",
      {
        schema: {
          params: orgParams,
          querystring: z.object({
            documentId: uuid.optional(),
            status: z.enum(["current", "outdated"]).optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            offset: z.coerce.number().int().min(0).default(0),
          }),
        },
      },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "member");
        return listAccessPasses(deps, access.organizationId, req.query);
      },
    );

    app.post(
      "/v1/organizations/:orgId/gate/programs",
      {
        schema: {
          params: orgParams,
          body: z.object({
            programAddress: base58Address,
            label: z.string().trim().min(1).max(64),
            action: z
              .string()
              .trim()
              .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, "an instruction name such as deposit"),
            policyDocumentId: uuid,
          }),
        },
      },
      async (req) => {
        const user = requireUser(req);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        const program = await registerProgram(deps, access.organizationId, req.body);
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "gate.program_registered",
          targetType: "program",
          targetId: req.body.programAddress,
          metadata: { action: req.body.action },
          ipHash: hashIp(req.ip, deps.config.IP_HASH_SECRET),
        });
        return { program };
      },
    );

    app.delete(
      "/v1/organizations/:orgId/gate/programs/:programId",
      { schema: { params: orgParams.extend({ programId: uuid }) } },
      async (req) => {
        const user = requireUser(req);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        const result = await removeProgram(deps, access.organizationId, req.params.programId);
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "gate.program_removed",
          targetType: "program",
          targetId: req.params.programId,
          ipHash: hashIp(req.ip, deps.config.IP_HASH_SECRET),
        });
        return result;
      },
    );

    app.get(
      "/v1/organizations/:orgId/gate/programs/:programId/activity",
      { schema: { params: orgParams.extend({ programId: uuid }) } },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "member");
        return programActivity(deps, access.organizationId, req.params.programId);
      },
    );

    /** How the protected instruction is called, for the verification probes. */
    app.put(
      "/v1/organizations/:orgId/gate/programs/:programId/probe",
      { schema: { params: programParams, body: probeTemplate } },
      async (req) => {
        const user = requireUser(req);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        await saveProbeTemplate(deps, access.organizationId, req.params.programId, req.body);
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "gate.program_probe_saved",
          targetType: "program",
          targetId: req.params.programId,
          ipHash: hashIp(req.ip, deps.config.IP_HASH_SECRET),
        });
        return { ok: true };
      },
    );

    /** Runs the verification probes now (the monitor also re-runs them after every upgrade). */
    app.post(
      "/v1/organizations/:orgId/gate/programs/:programId/verify",
      {
        schema: { params: programParams },
        config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
      },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "member");
        return {
          verification: await verifyRegisteredProgram(
            deps,
            req.params.programId,
            access.organizationId,
          ),
        };
      },
    );

    /** The memo the program's upgrade authority signs to prove ownership. */
    app.get(
      "/v1/organizations/:orgId/gate/programs/:programId/ownership",
      { schema: { params: programParams } },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "member");
        const { programAddress, organization } = await programAndOrg(
          deps,
          access.organizationId,
          req.params.programId,
        );
        return { memo: ownershipMemo(programAddress, organization) };
      },
    );

    app.post(
      "/v1/organizations/:orgId/gate/programs/:programId/ownership",
      {
        schema: {
          params: programParams,
          body: z.object({ signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/) }),
        },
        config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
      },
      async (req) => {
        const user = requireUser(req);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        const ownership = await proveOwnership(
          deps,
          access.organizationId,
          req.params.programId,
          req.body.signature,
        );
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "gate.program_ownership_proven",
          targetType: "program",
          targetId: req.params.programId,
          metadata: { authority: ownership.authority, signature: ownership.signature },
          ipHash: hashIp(req.ip, deps.config.IP_HASH_SECRET),
        });
        return { ownership };
      },
    );

    app.post(
      "/v1/organizations/:orgId/gate/programs/:programId/test",
      {
        schema: { params: orgParams.extend({ programId: uuid }) },
        config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
      },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "member");
        return runProbes(deps, access.organizationId, req.params.programId);
      },
    );
  };
}
