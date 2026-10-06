/**
 * Stele Gate routes (PROTOCOL_SPEC.md §18). The public access check is a convenience for SDKs that
 * decide whether to show the acceptance modal; protected programs never rely on it.
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
  registerProgram,
  removeProgram,
  runProbes,
  setDocumentGate,
} from "../services/gate.js";
import { base58Address, orgParams, uuid } from "./schemas.js";

export function gateRoutes(deps: Deps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      "/v1/public/gate/access",
      {
        schema: {
          querystring: z.object({
            document: base58Address,
            holder: base58Address,
            minVersion: z.coerce.number().int().min(0).max(1_000_000).optional(),
          }),
        },
        config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      },
      async (req) => accessStatus(deps, req.query),
    );

    app.get("/v1/organizations/:orgId/gate", { schema: { params: orgParams } }, async (req) => {
      const access = await requireOrgRole(deps, req, req.params.orgId, "member");
      return gateOverview(deps, access.organizationId);
    });

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

    app.patch(
      "/v1/organizations/:orgId/documents/:documentId/gate",
      {
        schema: {
          params: orgParams.extend({ documentId: uuid }),
          body: z.object({ gated: z.boolean() }),
        },
      },
      async (req) => {
        const user = requireUser(req);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        const result = await setDocumentGate(
          deps,
          access.organizationId,
          req.params.documentId,
          req.body.gated,
        );
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: req.body.gated ? "gate.policy_enabled" : "gate.policy_disabled",
          targetType: "document",
          targetId: req.params.documentId,
          ipHash: hashIp(req.ip, deps.config.IP_HASH_SECRET),
        });
        return result;
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
              .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, "an instruction name such as place_bet"),
            policyDocumentId: uuid,
            mode: z.enum(["check", "strict"]),
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
          metadata: { action: req.body.action, mode: req.body.mode },
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
