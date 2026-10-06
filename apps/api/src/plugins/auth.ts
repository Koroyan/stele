/**
 * Authentication and authorization.
 *
 * * Dashboard sessions: random 256-bit token in an HttpOnly cookie; only SHA-256(token) is stored.
 *   Idle and absolute expiry. Sessions can never sign transactions — on-chain actions always
 *   require the user's wallet.
 * * CSRF: state-changing cookie-authenticated requests must come from an allowed Origin AND carry
 *   `x-csrf-token` matching the session's CSRF secret (double submit, hash compared in constant time).
 * * API keys (server-to-server): `Authorization: Bearer stl_<env>_<id>_<secret>`, scoped, hashed,
 *   revocable. API keys cannot authorize on-chain actions.
 * * Organization roles come from the chain-mirrored membership table, never from the client.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  and,
  apiKeys,
  eq,
  gt,
  isNull,
  organizationMembers,
  organizations,
  sessions,
  users,
} from "@stele/db";
import type { Deps } from "../deps.js";
import { ApiError, forbidden, notFound, unauthorized } from "../errors.js";
import { matchesHash, sha256Hex } from "../lib/crypto.js";

export const SESSION_COOKIE = "stele_session";
export const CSRF_COOKIE = "stele_csrf";

export function sessionCookieName(production: boolean): string {
  // `__Host-` cookies must be Secure, Path=/ and host-only: they cannot be set by subdomains.
  return production ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
}

export interface AuthUser {
  id: string;
  walletAddress: string;
  sessionId: string;
  csrfTokenHash: string;
  reauthenticatedAt: Date;
}

export interface AuthApiKey {
  id: string;
  organizationId: string;
  scopes: string[];
  prefix: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
    apiKey: AuthApiKey | null;
  }
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const API_KEY_SCOPES = [
  "acceptances:read",
  "acceptances:write",
  "documents:read",
  "proofs:read",
  "proofs:write",
  "signers:read",
  "signers:write",
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** Resolves the session cookie or API key on every request. Never throws for anonymous requests. */
export function authHook(deps: Deps) {
  return async (req: FastifyRequest): Promise<void> => {
    req.user = null;
    req.apiKey = null;

    const authz = req.headers.authorization;
    if (authz?.startsWith("Bearer ")) {
      const key = authz.slice(7).trim();
      const m = /^(stl_(?:live|test)_[0-9a-f]{8})_[A-Za-z0-9_-]{43}$/.exec(key);
      if (!m) throw unauthorized("Malformed API key");
      const [row] = await deps.db.select().from(apiKeys).where(eq(apiKeys.prefix, m[1]!));
      if (
        !row ||
        row.revokedAt ||
        (row.expiresAt && row.expiresAt <= new Date()) ||
        !matchesHash(key, row.secretHash)
      ) {
        throw unauthorized("Invalid API key");
      }
      req.apiKey = {
        id: row.id,
        organizationId: row.organizationId,
        scopes: row.scopes,
        prefix: row.prefix,
      };
      // Coarse last-used tracking (best effort).
      if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
        await deps.db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
      }
      return;
    }

    const token = req.cookies[sessionCookieName(deps.config.isProduction)];
    if (!token) return;
    const now = new Date();
    const [row] = await deps.db
      .select({ s: sessions, u: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, sha256Hex(token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
        ),
      );
    if (!row) return;
    const idleMs = deps.config.SESSION_IDLE_HOURS * 3_600_000;
    if (now.getTime() - row.s.lastSeenAt.getTime() > idleMs) return;
    req.user = {
      id: row.u.id,
      walletAddress: row.u.walletAddress,
      sessionId: row.s.id,
      csrfTokenHash: row.s.csrfTokenHash,
      reauthenticatedAt: row.s.reauthenticatedAt,
    };
    if (now.getTime() - row.s.lastSeenAt.getTime() > 300_000) {
      await deps.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.s.id));
    }
  };
}

/** CSRF protection for cookie-authenticated unsafe requests. */
export function csrfHook(deps: Deps) {
  return async (req: FastifyRequest): Promise<void> => {
    if (!req.user || !UNSAFE.has(req.method)) return;
    const origin = req.headers.origin;
    const fetchSite = req.headers["sec-fetch-site"];
    const originOk = origin ? deps.config.appOrigins.includes(origin) : fetchSite === "same-origin";
    if (!originOk) throw forbidden("Cross-site request rejected");
    const header = req.headers["x-csrf-token"];
    if (typeof header !== "string" || !matchesHash(header, req.user.csrfTokenHash))
      throw forbidden("Missing or invalid CSRF token");
  };
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Sensitive actions (API keys, webhooks, settings) require a recent wallet signature. */
export function requireRecentAuth(req: FastifyRequest, deps: Deps): AuthUser {
  const user = requireUser(req);
  if (Date.now() - user.reauthenticatedAt.getTime() > deps.config.STEP_UP_MINUTES * 60_000) {
    throw new ApiError(
      403,
      "reauthentication_required",
      "Re-authenticate with your wallet to perform this action",
    );
  }
  return user;
}

export function requireApiKey(req: FastifyRequest, scope: ApiKeyScope): AuthApiKey {
  if (!req.apiKey) throw unauthorized("API key required");
  if (!req.apiKey.scopes.includes(scope)) throw forbidden(`API key lacks the ${scope} scope`);
  return req.apiKey;
}

export type OrgRole = "owner" | "admin" | "publisher" | "member";
const RANK: Record<OrgRole, number> = { member: 0, publisher: 1, admin: 2, owner: 3 };

export interface OrgAccess {
  organizationId: string;
  organizationAddress: string;
  role: OrgRole;
}

/**
 * Resolves the caller's role in an organization from chain-mirrored data. `min` = minimum role.
 * Returns 404 (not 403) for organizations the caller cannot see, to avoid leaking existence.
 */
export async function requireOrgRole(
  deps: Deps,
  req: FastifyRequest,
  organizationId: string,
  min: OrgRole,
): Promise<OrgAccess> {
  const user = requireUser(req);
  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!org) throw notFound("Organization");
  let role: OrgRole | null = null;
  if (org.ownerAddress === user.walletAddress) role = "owner";
  else {
    const [m] = await deps.db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.memberAddress, user.walletAddress),
          eq(organizationMembers.active, true),
        ),
      );
    if (m) role = m.roles & 1 ? "admin" : m.roles & 2 ? "publisher" : "member";
  }
  if (!role) throw notFound("Organization");
  if (RANK[role] < RANK[min]) throw forbidden(`This action requires the ${min} role`);
  return { organizationId, organizationAddress: org.address, role };
}

export function setSessionCookies(
  reply: FastifyReply,
  deps: Deps,
  sessionToken: string,
  csrfToken: string,
  maxAgeSeconds: number,
): void {
  const secure = deps.config.isProduction;
  reply.setCookie(sessionCookieName(secure), sessionToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
  reply.setCookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookies(reply: FastifyReply, deps: Deps): void {
  const secure = deps.config.isProduction;
  reply.clearCookie(sessionCookieName(secure), {
    path: "/",
    secure,
    httpOnly: true,
    sameSite: "lax",
  });
  reply.clearCookie(CSRF_COOKIE, { path: "/", secure, sameSite: "lax" });
}
