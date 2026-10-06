/**
 * Security behaviour of the HTTP layer: authentication, CSRF, CORS, headers, IDOR, API key scopes,
 * rate limiting, input validation and error hygiene.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiKeys, organizations, organizationMembers } from "@stele/db";
import { toBase58, toBase64, utf8 } from "@stele/protocol";
import { sha256Hex } from "../src/lib/crypto.js";
import { APP_ORIGIN, keypairBytes, login, makeApp, type TestApp } from "./helpers.js";

let t: TestApp;

beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

async function signIn(kp = keypairBytes()) {
  return login(t.app, kp);
}

describe("wallet sign-in", () => {
  it("issues a session for a valid signature and identifies the user", async () => {
    const s = await signIn();
    const me = await t.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: s.cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.walletAddress).toBe(s.address);
  });

  it("rejects replayed nonces, foreign keys and tampered messages", async () => {
    const kp = keypairBytes();
    const address = toBase58(kp.slice(32));
    const ch = await t.app.inject({
      method: "POST",
      url: "/v1/auth/challenge",
      payload: { address },
    });
    const { message } = ch.json() as { message: string };
    const sign = (m: string, secret = kp.slice(0, 32)) => toBase58(ed25519.sign(utf8(m), secret));
    const verify = (m: string, signature: string) =>
      t.app.inject({
        method: "POST",
        url: "/v1/auth/verify",
        payload: { address, signedMessage: toBase64(utf8(m)), signature },
      });

    // Signed by a different key.
    expect((await verify(message, sign(message, keypairBytes().slice(0, 32)))).statusCode).toBe(
      401,
    );
    // Tampered domain (phishing site reusing our nonce).
    const phished = message.replace("localhost:3000 wants you", "evil.example wants you");
    expect((await verify(phished, sign(phished))).statusCode).toBe(401);
    // Valid once…
    expect((await verify(message, sign(message))).statusCode).toBe(200);
    // …never twice.
    expect((await verify(message, sign(message))).statusCode).toBe(401);
  });

  it("issues sign-in messages wallets accept (alphanumeric nonce, SIWS field order)", async () => {
    // Wallets parse SIWS messages and refuse to display malformed ones; a base64url nonce with
    // `-` or `_` made Phantom reject about half of all sign-in requests.
    const address = toBase58(keypairBytes().slice(32));
    const ch = await t.app.inject({
      method: "POST",
      url: "/v1/auth/challenge",
      payload: { address },
    });
    const lines = (ch.json() as { message: string }).message.split("\n");
    expect(lines.slice(0, 3)).toEqual([
      "localhost:3000 wants you to sign in with your Solana account:",
      address,
      "",
    ]);
    expect(lines.slice(5).map((l) => l.split(": ")[0])).toEqual([
      "URI",
      "Version",
      "Chain ID",
      "Nonce",
      "Issued At",
      "Expiration Time",
    ]);
    expect(lines.find((l) => l.startsWith("Nonce: "))).toMatch(/^Nonce: [A-Za-z0-9]{8,}$/);
  });

  it("revokes the session on logout", async () => {
    const s = await signIn();
    expect(
      (await t.app.inject({ method: "POST", url: "/v1/auth/logout", headers: s.headers }))
        .statusCode,
    ).toBe(200);
    expect(
      (await t.app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: s.cookie } }))
        .statusCode,
    ).toBe(401);
  });
});

describe("CSRF", () => {
  it("rejects state-changing cookie requests without a valid token or from foreign origins", async () => {
    const s = await signIn();
    const url = "/v1/organizations/00000000-0000-4000-8000-000000000000/refresh";
    const noToken = await t.app.inject({
      method: "POST",
      url,
      headers: { cookie: s.cookie, origin: APP_ORIGIN },
    });
    expect(noToken.statusCode).toBe(403);
    const foreign = await t.app.inject({
      method: "POST",
      url,
      headers: { ...s.headers, origin: "https://evil.example" },
    });
    expect(foreign.statusCode).toBe(403);
    const wrongToken = await t.app.inject({
      method: "POST",
      url,
      headers: { ...s.headers, "x-csrf-token": "x".repeat(43) },
    });
    expect(wrongToken.statusCode).toBe(403);
    // Valid token and origin pass CSRF and reach authorization (404: org not visible).
    const ok = await t.app.inject({ method: "POST", url, headers: s.headers });
    expect(ok.statusCode).toBe(404);
  });
});

describe("authorization (IDOR)", () => {
  it("hides other organizations behind 404 and enforces roles", async () => {
    const alice = await signIn();
    const bob = await signIn();
    const [org] = await t.deps.db
      .insert(organizations)
      .values({
        address: "OrgAlice11111111111111111111111111111111111",
        creatorAddress: alice.address,
        name: "Alice Co",
        ownerAddress: alice.address,
      })
      .returning();
    const asAlice = await t.app.inject({
      method: "GET",
      url: `/v1/organizations/${org!.id}`,
      headers: { cookie: alice.cookie },
    });
    expect(asAlice.statusCode).toBe(200);
    expect(asAlice.json().role).toBe("owner");
    const asBob = await t.app.inject({
      method: "GET",
      url: `/v1/organizations/${org!.id}`,
      headers: { cookie: bob.cookie },
    });
    expect(asBob.statusCode).toBe(404);

    // A publisher cannot manage API keys (admin+), even with a fresh signature.
    await t.deps.db
      .insert(organizationMembers)
      .values({ organizationId: org!.id, memberAddress: bob.address, roles: 2, active: true });
    const create = await t.app.inject({
      method: "POST",
      url: `/v1/organizations/${org!.id}/api-keys`,
      headers: bob.headers,
      payload: { name: "x", scopes: ["acceptances:read"] },
    });
    expect(create.statusCode).toBe(403);
  });
});

describe("API keys", () => {
  it("are shown once, stored hashed, scoped and revocable", async () => {
    const owner = await signIn();
    const [org] = await t.deps.db
      .insert(organizations)
      .values({
        address: "OrgKeys111111111111111111111111111111111111",
        creatorAddress: owner.address,
        name: "Keys Co",
        ownerAddress: owner.address,
      })
      .returning();
    const res = await t.app.inject({
      method: "POST",
      url: `/v1/organizations/${org!.id}/api-keys`,
      headers: owner.headers,
      payload: { name: "Backend", scopes: ["documents:read"] },
    });
    expect(res.statusCode).toBe(200);
    const { key, apiKey } = res.json() as { key: string; apiKey: { id: string } };
    expect(key).toMatch(/^stl_test_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
    const [stored] = await t.deps.db.select().from(apiKeys);
    expect(stored!.secretHash).toBe(sha256Hex(key));
    expect(JSON.stringify(stored)).not.toContain(key.slice(-43));

    const bearer = (k: string) => ({ authorization: `Bearer ${k}` });
    expect(
      (
        await t.app.inject({
          method: "GET",
          url: "/v1/acceptances",
          headers: bearer("stl_test_garbage"),
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await t.app.inject({ method: "GET", url: "/v1/acceptances", headers: bearer(key) }))
        .statusCode,
    ).toBe(403); // wrong scope
    expect(
      (
        await t.app.inject({
          method: "GET",
          url: "/v1/documents/by-slug/terms/latest",
          headers: bearer(key),
        })
      ).statusCode,
    ).toBe(404); // scope ok

    const revoke = await t.app.inject({
      method: "DELETE",
      url: `/v1/organizations/${org!.id}/api-keys/${apiKey.id}`,
      headers: owner.headers,
    });
    expect(revoke.statusCode).toBe(200);
    expect(
      (
        await t.app.inject({
          method: "GET",
          url: "/v1/documents/by-slug/terms/latest",
          headers: bearer(key),
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe("HTTP hardening", () => {
  it("sends strict security headers", async () => {
    const res = await t.app.inject({ method: "GET", url: "/health" });
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("describes itself at the address developers call (OpenAPI servers)", async () => {
    const res = await t.app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(res.statusCode).toBe(200);
    expect(res.json().servers).toEqual([
      { url: `${APP_ORIGIN}/api`, description: "This Stele app" },
    ]);
  });

  it("allows public endpoints cross-origin without credentials, and dashboard endpoints only for the app", async () => {
    const pub = await t.app.inject({
      method: "OPTIONS",
      url: "/v1/network",
      headers: { origin: "https://customer.example", "access-control-request-method": "GET" },
    });
    expect(pub.headers["access-control-allow-origin"]).toBe("https://customer.example");
    expect(pub.headers["access-control-allow-credentials"]).toBeUndefined();
    const dash = await t.app.inject({
      method: "OPTIONS",
      url: "/v1/organizations",
      headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
    });
    expect(dash.headers["access-control-allow-origin"]).toBeUndefined();
    const app = await t.app.inject({
      method: "OPTIONS",
      url: "/v1/organizations",
      headers: { origin: APP_ORIGIN, "access-control-request-method": "GET" },
    });
    expect(app.headers["access-control-allow-origin"]).toBe(APP_ORIGIN);
    expect(app.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("validates input and never leaks internals", async () => {
    const bad = await t.app.inject({
      method: "POST",
      url: "/v1/auth/challenge",
      payload: { address: "not-a-key'; drop table users;--" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("invalid_request");
    const missing = await t.app.inject({ method: "GET", url: "/v1/nope" });
    expect(missing.statusCode).toBe(404);
    expect(missing.body).not.toMatch(/at .*\.ts/);
  });

  it("rate-limits sign-in challenges", async () => {
    const kp = keypairBytes();
    const address = toBase58(kp.slice(32));
    let limited = false;
    for (let i = 0; i < 25; i++) {
      const res = await t.app.inject({
        method: "POST",
        url: "/v1/auth/challenge",
        payload: { address },
        remoteAddress: "203.0.113.9",
      });
      if (res.statusCode === 429) limited = true;
    }
    expect(limited).toBe(true);
  });
});

describe("public CORS for walletless signing and proofs", () => {
  it("lets any site call passkey and proof endpoints without credentials, and nothing else", async () => {
    for (const [url, headers] of [
      ["/v1/proof-requests/00000000-0000-4000-8000-000000000000", "x-proof-token"],
      ["/v1/passkeys/options", "content-type"],
    ] as const) {
      const res = await t.app.inject({
        method: "OPTIONS",
        url,
        headers: {
          origin: "https://shop.example",
          "access-control-request-method": "GET",
          "access-control-request-headers": headers,
        },
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe("https://shop.example");
      expect(String(res.headers["access-control-allow-headers"])).toContain(headers);
      expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    }
    // Dashboard endpoints stay closed to foreign origins.
    const res = await t.app.inject({
      method: "OPTIONS",
      url: "/v1/organizations",
      headers: { origin: "https://shop.example", "access-control-request-method": "GET" },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
