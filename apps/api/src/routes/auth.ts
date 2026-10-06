/**
 * Wallet sign-in (SIWS). Nonces are single-use and short-lived; the signed message must name this
 * application's domain, URI and network. Login never authorizes on-chain actions.
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, authChallenges, eq, isNull, sessions, users } from "@stele/db";
import { fromBase64, fromBase58 } from "@stele/protocol";
import type { Deps } from "../deps.js";
import { badRequest, unauthorized } from "../errors.js";
import { appendAudit } from "../lib/audit.js";
import { hashIp, randomToken, sha256Hex } from "../lib/crypto.js";
import {
  SIWS_STATEMENT,
  buildSiwsMessage,
  parseSiwsMessage,
  siwsNonce,
  verifySiwsSignature,
} from "../lib/siws.js";
import { clearSessionCookies, requireUser, setSessionCookies } from "../plugins/auth.js";
import { base58Address, base58Signature } from "./schemas.js";

const CHALLENGE_TTL_MS = 10 * 60_000;

export function authRoutes(deps: Deps): FastifyPluginAsyncZod {
  const chainId = deps.config.network.walletChain.split(":")[1]!;
  return async (app) => {
    app.post(
      "/v1/auth/challenge",
      {
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
        schema: { body: z.object({ address: base58Address }) },
      },
      async (req) => {
        if (fromBase58(req.body.address).length !== 32)
          throw badRequest("invalid_address", "Address must be 32 bytes");
        const nonce = siwsNonce();
        const issuedAt = new Date();
        const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
        const fields = {
          domain: deps.config.appHost,
          address: req.body.address,
          statement: SIWS_STATEMENT,
          uri: deps.config.APP_ORIGIN,
          version: "1",
          chainId,
          nonce,
          issuedAt: issuedAt.toISOString(),
          expirationTime: expiresAt.toISOString(),
        };
        const message = buildSiwsMessage(fields);
        await deps.db
          .insert(authChallenges)
          .values({ walletAddress: req.body.address, nonce, message, issuedAt, expiresAt });
        return { message, signInInput: fields };
      },
    );

    app.post(
      "/v1/auth/verify",
      {
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
        schema: {
          body: z.object({
            address: base58Address,
            /** The exact bytes the wallet signed (base64). */
            signedMessage: z.string().max(4096),
            signature: base58Signature,
          }),
        },
      },
      async (req, reply) => {
        const { address, signature } = req.body;
        let messageBytes: Uint8Array;
        let fields;
        try {
          messageBytes = fromBase64(req.body.signedMessage);
          fields = parseSiwsMessage(new TextDecoder("utf-8", { fatal: true }).decode(messageBytes));
        } catch {
          throw unauthorized("Invalid sign-in message");
        }
        const now = Date.now();
        const reject = (why: string) => {
          req.log.warn({ reason: why }, "sign-in rejected");
          return unauthorized("Sign-in could not be verified");
        };
        if (fields.domain !== deps.config.appHost) throw reject("domain mismatch");
        if (fields.address !== address) throw reject("address mismatch");
        if (new URL(fields.uri).origin !== new URL(deps.config.APP_ORIGIN).origin)
          throw reject("uri mismatch");
        if (fields.version !== "1" || fields.chainId !== chainId)
          throw reject("version/chain mismatch");
        if (fields.statement !== SIWS_STATEMENT) throw reject("statement mismatch");
        if (!fields.expirationTime || Date.parse(fields.expirationTime) < now)
          throw reject("expired");
        if (Math.abs(Date.parse(fields.issuedAt) - now) > CHALLENGE_TTL_MS)
          throw reject("issued-at out of range");
        if (!verifySiwsSignature(messageBytes, signature, address)) throw reject("bad signature");

        // Consume the nonce atomically (prevents replay of a captured signature).
        const [challenge] = await deps.db
          .update(authChallenges)
          .set({ consumedAt: new Date() })
          .where(
            and(
              eq(authChallenges.nonce, fields.nonce),
              eq(authChallenges.walletAddress, address),
              isNull(authChallenges.consumedAt),
            ),
          )
          .returning();
        if (!challenge || challenge.expiresAt.getTime() < now)
          throw reject("unknown, consumed or expired nonce");

        const [user] = await deps.db
          .insert(users)
          .values({ walletAddress: address, lastLoginAt: new Date() })
          .onConflictDoUpdate({ target: users.walletAddress, set: { lastLoginAt: new Date() } })
          .returning();

        // Rotate: a fresh session for every sign-in (prevents session fixation).
        if (req.user)
          await deps.db
            .update(sessions)
            .set({ revokedAt: new Date() })
            .where(eq(sessions.id, req.user.sessionId));
        const sessionToken = randomToken(32);
        const csrfToken = randomToken(32);
        const ttl = deps.config.SESSION_TTL_HOURS * 3600;
        await deps.db.insert(sessions).values({
          userId: user!.id,
          tokenHash: sha256Hex(sessionToken),
          csrfTokenHash: sha256Hex(csrfToken),
          expiresAt: new Date(now + ttl * 1000),
          ipHash: hashIp(req.ip, deps.config.IP_HASH_SECRET),
          userAgent: req.headers["user-agent"]?.slice(0, 256) ?? null,
        });
        setSessionCookies(reply, deps, sessionToken, csrfToken, ttl);
        await appendAudit(deps.db, {
          organizationId: null,
          actorType: "user",
          actorId: user!.id,
          action: "auth.signed_in",
          metadata: { wallet: address },
          ipHash: hashIp(req.ip, deps.config.IP_HASH_SECRET),
        });
        return {
          user: {
            id: user!.id,
            walletAddress: user!.walletAddress,
            displayName: user!.displayName,
          },
          csrfToken,
        };
      },
    );

    app.post("/v1/auth/logout", async (req, reply) => {
      if (req.user)
        await deps.db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.id, req.user.sessionId));
      clearSessionCookies(reply, deps);
      return { ok: true };
    });

    app.get("/v1/auth/me", async (req) => {
      const user = requireUser(req);
      const [row] = await deps.db.select().from(users).where(eq(users.id, user.id));
      return {
        user: { id: row!.id, walletAddress: row!.walletAddress, displayName: row!.displayName },
        recentlyAuthenticated:
          Date.now() - user.reauthenticatedAt.getTime() < deps.config.STEP_UP_MINUTES * 60_000,
      };
    });
  };
}
