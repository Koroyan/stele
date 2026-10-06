/**
 * Idempotency for unsafe requests (`Idempotency-Key` header).
 *
 * A retried POST/PATCH/DELETE carrying the same key and the same request returns the stored
 * response instead of acting twice; the same key with a different request is rejected (422).
 * Keys are scoped to the authenticated caller (API key or dashboard user) and expire after 24 h.
 *
 * Stored responses may contain secrets (API keys, webhook secrets, session tokens), so they are
 * kept ONLY encrypted (AES-256-GCM with the server's encryption key) — never in plaintext.
 * Concurrent first attempts with the same key are not serialized; every endpoint is safe to repeat.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, gt, idempotencyKeys } from "@stele/db";
import type { Deps } from "../deps.js";
import { ApiError, badRequest } from "../errors.js";
import { canonicalJson } from "../lib/audit.js";
import { decrypt, encrypt, sha256Hex } from "../lib/crypto.js";

const UNSAFE = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const KEY_FORMAT = /^[\x21-\x7e]{1,255}$/;
export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;

interface Pending {
  scope: string;
  key: string;
  requestHash: string;
}

declare module "fastify" {
  interface FastifyRequest {
    idempotency?: Pending;
  }
}

function scopeOf(req: FastifyRequest): string | null {
  if (req.apiKey) return `api_key:${req.apiKey.id}`;
  if (req.user) return `user:${req.user.id}`;
  return null;
}

export function registerIdempotency(app: FastifyInstance, deps: Deps): void {
  app.addHook("preHandler", async (req, reply) => {
    if (!UNSAFE.has(req.method)) return;
    const header = req.headers["idempotency-key"];
    if (header === undefined) return;
    if (typeof header !== "string" || !KEY_FORMAT.test(header)) {
      throw badRequest(
        "invalid_idempotency_key",
        "Idempotency-Key must be 1–255 printable ASCII characters",
      );
    }
    const scope = scopeOf(req);
    // Anonymous endpoints (acceptance challenges) are idempotent by construction.
    if (!scope) return;
    const requestHash = sha256Hex(`${req.method}\n${req.url}\n${canonicalJson(req.body ?? null)}`);
    const [row] = await deps.db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.scope, scope),
          eq(idempotencyKeys.key, header),
          gt(idempotencyKeys.expiresAt, new Date()),
        ),
      );
    if (row) {
      if (row.requestHash !== requestHash) {
        throw new ApiError(
          422,
          "idempotency_key_reused",
          "This Idempotency-Key was already used for a different request",
        );
      }
      const stored = row.responseBody as { enc?: string };
      if (typeof stored.enc !== "string")
        throw new ApiError(500, "internal_error", "Unreadable idempotent response");
      reply.header("idempotent-replayed", "true");
      return reply
        .code(row.responseStatus)
        .type("application/json; charset=utf-8")
        .send(decrypt(stored.enc, deps.encryptionKey));
    }
    req.idempotency = { scope, key: header, requestHash };
    return undefined;
  });

  app.addHook("onSend", async (req, reply, payload) => {
    const pending = req.idempotency;
    // Only definitive outcomes are remembered; server errors may be retried for real.
    if (!pending || reply.statusCode >= 500 || reply.getHeader("idempotent-replayed"))
      return payload;
    if (typeof payload !== "string") return payload;
    await deps.db
      .insert(idempotencyKeys)
      .values({
        scope: pending.scope,
        key: pending.key,
        requestHash: pending.requestHash,
        responseStatus: reply.statusCode,
        responseBody: { enc: encrypt(payload, deps.encryptionKey) },
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      })
      .onConflictDoNothing();
    return payload;
  });
}
