/**
 * Stele's own pages and inbox:
 *
 *   GET   /v1/public/platform      → Stele's organization, its Terms and Privacy Policy, the assistant
 *   POST  /v1/public/contact       → a message from the website's contact form
 *   GET   /v1/admin/contact        → the inbox (Stele staff: STELE_PLATFORM_ADMINS)
 *   PATCH /v1/admin/contact/:id    → mark read / replied / archived, add a note (staff)
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Deps } from "../deps.js";
import { hashIp } from "../lib/crypto.js";
import { requireUser } from "../plugins/auth.js";
import { assistantEnabled } from "../services/assistant.js";
import {
  CONTACT_TOPICS,
  listContact,
  platformDocuments,
  requirePlatformAdmin,
  submitContact,
  updateContact,
} from "../services/platform.js";

const text = (max: number) => z.string().trim().max(max);

const contactBody = z.object({
  topic: z.enum(CONTACT_TOPICS),
  name: text(120).min(1),
  email: text(254).email(),
  company: text(120).nullish(),
  website: text(200).nullish(),
  message: text(5000).min(10, "Tell us a little more (at least 10 characters)"),
  /** A field people never see: bots fill it in. */
  fax: z.string().max(200).optional(),
});

export function platformRoutes(deps: Deps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get("/v1/public/platform", async () => {
      const platform = await platformDocuments(deps);
      return {
        organization: platform?.organization ?? null,
        terms: platform?.terms ?? null,
        privacy: platform?.privacy ?? null,
        assistant: { enabled: assistantEnabled(deps) },
      };
    });

    app.post(
      "/v1/public/contact",
      {
        schema: { body: contactBody },
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      },
      async (req) => {
        // A bot filled in the hidden field: answer as usual, store nothing.
        if (req.body.fax) return { ok: true };
        await submitContact(
          deps,
          req.body,
          hashIp(req.ip, deps.config.IP_HASH_SECRET) ?? "unknown",
        );
        return { ok: true };
      },
    );

    app.get(
      "/v1/admin/contact",
      {
        schema: {
          querystring: z.object({
            status: z.enum(["new", "read", "replied", "archived"]).optional(),
          }),
        },
      },
      async (req) => {
        requirePlatformAdmin(deps, requireUser(req).walletAddress);
        return listContact(deps, req.query.status);
      },
    );

    app.patch(
      "/v1/admin/contact/:id",
      {
        schema: {
          params: z.object({ id: z.string().uuid() }),
          body: z.object({
            status: z.enum(["new", "read", "replied", "archived"]).optional(),
            note: text(2000).nullish(),
          }),
        },
      },
      async (req) => {
        requirePlatformAdmin(deps, requireUser(req).walletAddress);
        return updateContact(deps, req.params.id, req.body);
      },
    );
  };
}
