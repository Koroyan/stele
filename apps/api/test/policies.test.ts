/**
 * Idempotency keys, step-up authentication and organization acceptance policies.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptances,
  acceptanceSessions,
  documents,
  eq,
  idempotencyKeys,
  organizations,
  sessions,
  sql,
} from "@stele/db";
import { toBase58 } from "@stele/protocol";
import { APP_ORIGIN, keypairBytes, login, makeApp, type Session, type TestApp } from "./helpers.js";

const randomAddress = () => toBase58(new Uint8Array(randomBytes(32)));

let t: TestApp;

beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

async function orgFor(owner: Session, settings: Record<string, unknown> = {}) {
  const [org] = await t.deps.db
    .insert(organizations)
    .values({
      address: randomAddress(),
      creatorAddress: owner.address,
      name: "Policy Co",
      ownerAddress: owner.address,
      settings,
    })
    .returning();
  return org!;
}

async function apiKeyFor(owner: Session, orgId: string, scopes: string[]) {
  const res = await t.app.inject({
    method: "POST",
    url: `/v1/organizations/${orgId}/api-keys`,
    headers: owner.headers,
    payload: { name: "k", scopes },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { key: string }).key;
}

describe("Idempotency-Key", () => {
  it("replays the first response, rejects reuse with a different request, and stores responses encrypted", async () => {
    const owner = await login(t.app, keypairBytes());
    const org = await orgFor(owner);
    const key = await apiKeyFor(owner, org.id, ["acceptances:write"]);
    const headers = { authorization: `Bearer ${key}`, "idempotency-key": "create-session-0001" };

    const first = await t.app.inject({
      method: "POST",
      url: "/v1/acceptance-sessions",
      headers,
      payload: { ttlSeconds: 600, externalUserRef: "user-42" },
    });
    expect(first.statusCode).toBe(200);
    const token = (first.json() as { sessionToken: string }).sessionToken;

    const replay = await t.app.inject({
      method: "POST",
      url: "/v1/acceptance-sessions",
      headers,
      payload: { ttlSeconds: 600, externalUserRef: "user-42" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect((replay.json() as { sessionToken: string }).sessionToken).toBe(token);
    const rows = await t.deps.db
      .select()
      .from(acceptanceSessions)
      .where(eq(acceptanceSessions.organizationId, org.id));
    expect(rows).toHaveLength(1);

    const conflict = await t.app.inject({
      method: "POST",
      url: "/v1/acceptance-sessions",
      headers,
      payload: { ttlSeconds: 900, externalUserRef: "user-42" },
    });
    expect(conflict.statusCode).toBe(422);
    expect(conflict.json().error.code).toBe("idempotency_key_reused");

    // The stored response contains the session token only in encrypted form.
    const stored = await t.deps.db.select().from(idempotencyKeys);
    expect(stored.length).toBeGreaterThan(0);
    expect(JSON.stringify(stored)).not.toContain(token);

    // Keys are scoped per caller: another API key with the same Idempotency-Key acts independently.
    const other = await apiKeyFor(owner, org.id, ["acceptances:write"]);
    const independent = await t.app.inject({
      method: "POST",
      url: "/v1/acceptance-sessions",
      headers: { authorization: `Bearer ${other}`, "idempotency-key": "create-session-0001" },
      payload: { ttlSeconds: 600, externalUserRef: "user-42" },
    });
    expect(independent.statusCode).toBe(200);
    expect((independent.json() as { sessionToken: string }).sessionToken).not.toBe(token);

    const malformed = await t.app.inject({
      method: "POST",
      url: "/v1/acceptance-sessions",
      headers: { ...headers, "idempotency-key": "has spaces" },
      payload: { ttlSeconds: 600 },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("invalid_idempotency_key");
  });
});

describe("step-up authentication", () => {
  it("requires a recent wallet signature for credential creation, with a dedicated error code", async () => {
    const owner = await login(t.app, keypairBytes());
    const org = await orgFor(owner);
    // Age the session's last wallet signature beyond the step-up window.
    await t.deps.db.update(sessions).set({ reauthenticatedAt: new Date(Date.now() - 60 * 60_000) });
    const res = await t.app.inject({
      method: "POST",
      url: `/v1/organizations/${org.id}/api-keys`,
      headers: owner.headers,
      payload: { name: "k", scopes: ["documents:read"] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("reauthentication_required");
  });
});

describe("acceptance policy", () => {
  it("refuses signing requests from sites outside the organization's allow-list", async () => {
    const owner = await login(t.app, keypairBytes());
    const org = await orgFor(owner, { allowedRequestDomains: ["app.acme.example"] });
    const [doc] = await t.deps.db
      .insert(documents)
      .values({
        organizationId: org.id,
        address: randomAddress(),
        slug: "terms",
        documentType: "terms-of-service",
        locale: "en",
        versionCount: 1,
        currentVersionAddress: randomAddress(),
      })
      .returning();
    const body = { organization: org.address, document: doc!.address, signer: randomAddress() };

    const foreign = await t.app.inject({
      method: "POST",
      url: "/v1/acceptance/challenges",
      payload: body,
      headers: { origin: "https://phish.example" },
    });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error.message).toContain("phish.example");

    // An allowed site passes the policy (and then fails only because this org has no nonce shard).
    const allowed = await t.app.inject({
      method: "POST",
      url: "/v1/acceptance/challenges",
      payload: body,
      headers: { origin: "https://app.acme.example" },
    });
    expect(allowed.statusCode).toBe(503);
    expect(allowed.json().error.code).toBe("no_acceptance_capacity");

    // Without an Origin header the hosted acceptance domain applies — not on the list either.
    const hosted = await t.app.inject({
      method: "POST",
      url: "/v1/acceptance/challenges",
      payload: body,
    });
    expect(hosted.statusCode).toBe(403);
    expect(APP_ORIGIN).toContain("localhost");
  });
});

describe("dashboard statistics", () => {
  it("buckets acceptances by UTC day whatever the database session's time zone", async () => {
    const owner = await login(t.app, keypairBytes());
    const org = await orgFor(owner);
    const [doc] = await t.deps.db
      .insert(documents)
      .values({
        organizationId: org.id,
        address: randomAddress(),
        slug: "terms",
        documentType: "terms-of-service",
        locale: "en",
      })
      .returning();
    const now = new Date();
    // 22:30 UTC yesterday is already "today" in UTC+4.
    const late = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 22, 30),
    );
    await t.deps.db.insert(acceptances).values({
      acceptanceId: "a".repeat(64),
      organizationId: org.id,
      documentId: doc!.id,
      versionAddress: randomAddress(),
      versionNumber: 1,
      signerAddress: randomAddress(),
      txSignature: "5".repeat(87),
      slot: 1,
      blockTime: late,
      issuedAt: Math.floor(late.getTime() / 1000) - 60,
      expiresAt: Math.floor(late.getTime() / 1000) + 540,
      nonceShardAddress: randomAddress(),
      nonceIndex: 0,
      messageHash: "b".repeat(64),
      requestDomain: "localhost",
    });
    await t.deps.db.execute(sql`SET TIME ZONE 'Asia/Dubai'`);
    try {
      const res = await t.app.inject({
        method: "GET",
        url: `/v1/organizations/${org.id}/stats`,
        headers: { cookie: owner.cookie },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { daily: { day: string; n: number }[] }).daily).toEqual([
        { day: late.toISOString().slice(0, 10), n: 1 },
      ]);
    } finally {
      await t.deps.db.execute(sql`SET TIME ZONE 'UTC'`);
    }
  });
});
