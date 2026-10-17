/**
 * Insights for an organization's members: acceptances, completion, timing, version coverage and
 * the list of people who still have to accept the current version (JSON or CSV).
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Deps } from "../deps.js";
import { notFound } from "../errors.js";
import { requireOrgRole } from "../plugins/auth.js";
import { organizationAnalytics, reacceptanceList } from "../services/analytics.js";
import { orgParams, uuid } from "./schemas.js";

/** A CSV cell: quoted, and never read as a formula by a spreadsheet. */
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function analyticsRoutes(deps: Deps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      "/v1/organizations/:orgId/analytics",
      {
        schema: {
          params: orgParams,
          querystring: z.object({
            days: z.coerce.number().int().min(1).max(365).default(30),
            documentId: uuid.optional(),
          }),
        },
        config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "member");
        return organizationAnalytics(deps, access.organizationId, req.query);
      },
    );

    app.get(
      "/v1/organizations/:orgId/analytics/reacceptance",
      {
        schema: {
          params: orgParams,
          querystring: z.object({
            documentId: uuid,
            format: z.enum(["json", "csv"]).default("json"),
          }),
        },
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      },
      async (req, reply) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "member");
        const list = await reacceptanceList(deps, access.organizationId, req.query.documentId);
        if (!list) throw notFound("Document");
        if (req.query.format === "json") return list;
        const lines = [
          ["user_ref", "signer", "accepted_version", "current_version", "last_accepted_at"],
          ...list.people.map((p) => [
            p.userRef,
            p.signer,
            p.acceptedVersion,
            list.currentVersion,
            p.lastAcceptedAt,
          ]),
        ].map((r) => r.map(cell).join(","));
        reply
          .type("text/csv; charset=utf-8")
          .header(
            "content-disposition",
            `attachment; filename="${list.document}-needs-reacceptance.csv"`,
          );
        return `${lines.join("\r\n")}\r\n`;
      },
    );
  };
}
