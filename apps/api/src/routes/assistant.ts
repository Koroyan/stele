/**
 * The AI assistant:
 *
 *   POST /v1/assistant/chat → Server-Sent Events: `delta` (answer text), `searching` (the model
 *                             searches the documentation), `done`, `error`
 *
 * Anyone may ask. A signed-in member who names their organization also gets answers that use a
 * summary of its configuration (requires the member role, like every organization read).
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Deps } from "../deps.js";
import { ApiError } from "../errors.js";
import { hashIp } from "../lib/crypto.js";
import { requireOrgRole } from "../plugins/auth.js";
import {
  admitQuestion,
  answer,
  assistantEnabled,
  organizationContext,
  type AssistantEvent,
} from "../services/assistant.js";

const chatBody = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(24)
    .refine((m) => m.at(-1)?.role === "user", "The last message must be the user's question"),
  page: z
    .string()
    .max(200)
    .regex(/^\/[\w\-/[\]]*$/)
    .optional(),
  organizationId: z.string().uuid().optional(),
});

export function assistantRoutes(deps: Deps): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      "/v1/assistant/chat",
      {
        schema: { body: chatBody },
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      },
      async (req, reply) => {
        if (!assistantEnabled(deps))
          throw new ApiError(503, "assistant_unavailable", "The assistant is not enabled here.");
        const organization =
          req.body.organizationId && req.user
            ? await requireOrgRole(deps, req, req.body.organizationId, "member").then((a) =>
                organizationContext(deps, a.organizationId, a.role),
              )
            : undefined;
        admitQuestion(deps, hashIp(req.ip, deps.config.IP_HASH_SECRET) ?? "unknown");

        // Recent turns only: older ones cost tokens and rarely matter.
        const messages = req.body.messages.slice(-12);
        reply.hijack();
        const res = reply.raw;
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
          connection: "keep-alive",
        });
        const abort = new AbortController();
        res.on("close", () => abort.abort());
        const send = (e: AssistantEvent | { type: "error"; message: string }) => {
          if (!res.writableEnded) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
        };
        try {
          await answer(deps, { messages, page: req.body.page, organization }, send, {
            signal: abort.signal,
          });
        } catch (e) {
          if (!abort.signal.aborted) {
            if (!(e instanceof ApiError)) req.log.error({ err: e }, "assistant failed");
            send({
              type: "error",
              message: e instanceof ApiError ? e.message : "The assistant could not answer.",
            });
          }
        } finally {
          res.end();
        }
      },
    );
  };
}
