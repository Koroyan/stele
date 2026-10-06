/**
 * The website's live demo (same-origin only; devnet/localnet). Real transactions on the configured
 * cluster, budgeted per day and per IP address — see services/demo.ts.
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Deps } from "../deps.js";
import { hashIp } from "../lib/crypto.js";
import {
  createDemoSession,
  demoSessionState,
  demoStatus,
  publishDemoVersion,
  relayDemoBet,
} from "../services/demo.js";

const token = z.string().min(20).max(128);

export function demoRoutes(deps: Deps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get("/v1/demo", async () => demoStatus(deps));

    app.post(
      "/v1/demo/sessions",
      {
        schema: { body: z.object({ kind: z.enum(["gate", "proof"]) }) },
        config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
      },
      async (req) =>
        createDemoSession(deps, {
          kind: req.body.kind,
          ipHash: hashIp(req.ip, deps.config.IP_HASH_SECRET) ?? "unknown",
        }),
    );

    app.post("/v1/demo/sessions/current", { schema: { body: z.object({ token }) } }, async (req) =>
      demoSessionState(deps, req.body.token),
    );

    app.post(
      "/v1/demo/sessions/publish",
      {
        schema: { body: z.object({ token }) },
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      },
      async (req) => publishDemoVersion(deps, req.body.token),
    );

    app.post(
      "/v1/demo/sessions/bet",
      {
        schema: { body: z.object({ token, transaction: z.string().min(100).max(2_000) }) },
        config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      },
      async (req) => relayDemoBet(deps, req.body.token, req.body.transaction),
    );
  };
}
