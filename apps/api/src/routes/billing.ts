/**
 * Billing endpoints.
 *
 *   GET  /v1/billing                                          → what is on sale (public: pricing page)
 *   GET  /v1/organizations/:orgId/billing                     → allowance, credits, invoices (member)
 *   POST /v1/organizations/:orgId/billing/invoices            → an invoice to pay on-chain (admin)
 *   POST /v1/organizations/:orgId/billing/invoices/:id/confirm → credit it once paid (admin)
 *
 * The dashboard has the admin's wallet pay the invoice; the API credits it only after finding the
 * payment on-chain (services/billing.ts).
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Deps } from "../deps.js";
import { requireOrgRole, requireUser } from "../plugins/auth.js";
import {
  billingInfo,
  billingOverview,
  confirmInvoice,
  createInvoice,
} from "../services/billing.js";
import { base58Signature, orgParams, uuid } from "./schemas.js";

export function billingRoutes(deps: Deps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get("/v1/billing", async () => billingInfo(deps));

    app.get("/v1/organizations/:orgId/billing", { schema: { params: orgParams } }, async (req) => {
      const access = await requireOrgRole(deps, req, req.params.orgId, "member");
      return billingOverview(deps, access.organizationId);
    });

    app.post(
      "/v1/organizations/:orgId/billing/invoices",
      {
        schema: {
          params: orgParams,
          body: z.object({ pack: z.string().regex(/^\d{1,9}$/) }),
        },
      },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        const user = requireUser(req);
        return createInvoice(deps, access.organizationId, req.body.pack, {
          userId: user.id,
          walletAddress: user.walletAddress,
        });
      },
    );

    app.post(
      "/v1/organizations/:orgId/billing/invoices/:invoiceId/confirm",
      {
        config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
        schema: {
          params: orgParams.extend({ invoiceId: uuid }),
          body: z.object({ signature: base58Signature.optional() }).default({}),
        },
      },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        const user = requireUser(req);
        return confirmInvoice(
          deps,
          access.organizationId,
          req.params.invoiceId,
          req.body.signature,
          { userId: user.id },
        );
      },
    );
  };
}
