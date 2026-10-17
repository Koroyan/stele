/**
 * Insights: people are counted once (their user ID, else their key), coverage is each person's
 * latest version, and the re-acceptance list is a safe CSV.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptances, documents, organizations } from "@stele/db";
import { toBase58 } from "@stelehq/protocol";
import { keypairBytes, login, makeApp, type Session, type TestApp } from "./helpers.js";

const addr = () => toBase58(new Uint8Array(randomBytes(32)));
let t: TestApp;
let owner: Session;
let orgId: string;
let docId: string;

beforeAll(async () => {
  t = await makeApp();
  owner = await login(t.app, keypairBytes());
  const [org] = await t.deps.db
    .insert(organizations)
    .values({
      address: addr(),
      creatorAddress: owner.address,
      name: "Insight Co",
      ownerAddress: owner.address,
    })
    .returning();
  orgId = org!.id;
  const [doc] = await t.deps.db
    .insert(documents)
    .values({
      organizationId: orgId,
      address: addr(),
      slug: "terms",
      documentType: "terms-of-service",
      locale: "en",
      versionCount: 2,
      currentVersionAddress: addr(),
    })
    .returning();
  docId = doc!.id;
  let n = 0;
  const accept = (version: number, signer: string, userRef: string | null, type = "wallet") =>
    t.deps.db.insert(acceptances).values({
      acceptanceId: randomBytes(32).toString("hex"),
      organizationId: orgId,
      documentId: docId,
      versionAddress: addr(),
      versionNumber: version,
      signerAddress: signer,
      txSignature: `sig${n++}`,
      slot: n,
      issuedAt: 1,
      expiresAt: 2,
      nonceShardAddress: addr(),
      nonceIndex: n,
      messageHash: "00",
      requestDomain: version === 2 ? "shop.example" : "old.example",
      externalUserRef: userRef,
      signerType: type,
      feeLamports: 10_000,
    });
  // nino: v1 then v2 with two different keys (one person by user ID) → on the current version.
  await accept(1, addr(), "nino");
  await accept(2, addr(), "nino", "passkey");
  // gio: v1 only → must accept again. A key without a user ID: v1 only.
  await accept(1, addr(), '=HYPERLINK("http://evil")');
  await accept(1, "KeyOnly1111111111111111111111111111111111111", null);
});
afterAll(async () => {
  await t.close();
});

describe("insights", () => {
  it("counts people once and shows who is on the current version", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: `/v1/organizations/${orgId}/analytics?days=7`,
      headers: owner.headers,
    });
    expect(res.statusCode, res.body).toBe(200);
    const a = res.json();
    expect(a.totals).toMatchObject({ acceptances: 4, people: 3, feeLamports: 40_000 });
    expect(a.methods).toEqual({ wallet: 3, passkey: 1 });
    expect(a.domains[0]).toEqual({ label: "old.example", count: 3 });
    expect(a.coverage).toEqual([
      expect.objectContaining({
        currentVersion: 2,
        people: 3,
        onCurrent: 1,
        needsReacceptance: 2,
        versions: [
          { number: 2, people: 1 },
          { number: 1, people: 2 },
        ],
      }),
    ]);
    expect(a.daily).toHaveLength(7);
  });

  it("exports who must accept again as a CSV that spreadsheets cannot execute", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: `/v1/organizations/${orgId}/analytics/reacceptance?documentId=${docId}&format=csv`,
      headers: owner.headers,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.body.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(res.body).not.toContain('"nino"');
    expect(res.body).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(res.body).toContain('"KeyOnly1111111111111111111111111111111111111"');
  });

  it("is for the organization's members only", async () => {
    const stranger = await login(t.app, keypairBytes());
    const res = await t.app.inject({
      method: "GET",
      url: `/v1/organizations/${orgId}/analytics`,
      headers: stranger.headers,
    });
    expect(res.statusCode).toBe(404);
  });
});
