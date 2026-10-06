/**
 * End-to-end API flows against a REAL local validator seeded by `@stele/localnet`. Skipped when no
 * seeded localnet is reachable. Every assertion about evidence is checked against the chain.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { address, createKeyPairSignerFromBytes } from "@solana/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptances,
  auditLog,
  documentVersions,
  eq,
  nonceShards,
  organizations,
  webhookDeliveries,
} from "@stele/db";
import { createTestDb } from "@stele/db/testing";
import {
  canonicalizeContent,
  contentHash,
  findConfigPda,
  fromHex,
  parseCanonicalContent,
  publishVersionInstruction,
  toBase58,
  toHex,
  utf8,
  versionHash,
} from "@stele/protocol";
import { pino } from "pino";
import type { Deps } from "../src/deps.js";
import { indexOnce } from "../src/indexer.js";
import { verifyAuditChain } from "../src/lib/audit.js";
import { FilesystemContentStore } from "../src/lib/storage.js";
import {
  APP_ORIGIN,
  REPO_ROOT,
  login,
  makeApp,
  realChain,
  testConfig,
  type TestApp,
} from "./helpers.js";

const DATA = resolve(REPO_ROOT, ".data/localnet");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state: any = existsSync(resolve(DATA, "state.json"))
  ? JSON.parse(readFileSync(resolve(DATA, "state.json"), "utf8"))
  : null;
const keypair = (role: string) =>
  Uint8Array.from(JSON.parse(readFileSync(resolve(DATA, `${role}.json`), "utf8")) as number[]);

async function rpcUp(url: string) {
  try {
    return (
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"jsonrpc":"2.0","id":1,"method":"getHealth"}',
      })
    ).ok;
  } catch {
    return false;
  }
}
const available = state !== null && (await rpcUp(state.rpcUrl));

const config = () =>
  testConfig({
    SOLANA_RPC_URLS: state.rpcUrl,
    PROGRAM_ID: state.programId,
    RELAYER_KEYPAIR: resolve(DATA, "relayer.json"),
    ATTESTOR_KEYPAIR: resolve(DATA, "attestor.json"),
    HOSTED_ACCEPT_DOMAIN: "localhost",
    PUBLIC_CONTENT_BASE_URL: "http://localhost:4000/v1/public/content",
  });

describe.skipIf(!available)("API against a real local validator", () => {
  let t: TestApp;
  let orgId: string;
  const storage = () => new FilesystemContentStore(resolve(REPO_ROOT, ".data/storage"));

  beforeAll(async () => {
    const cfg = config();
    t = await makeApp({ config: cfg, chain: await realChain(cfg), storage: storage() });
  });
  afterAll(async () => {
    await t?.close();
  });

  it("mirrors an on-chain organization only for its on-chain owner or members", async () => {
    const stranger = await login(
      t.app,
      (() => {
        const s = ed25519.utils.randomSecretKey();
        const kp = new Uint8Array(64);
        kp.set(s);
        kp.set(ed25519.getPublicKey(s), 32);
        return kp;
      })(),
    );
    const denied = await t.app.inject({
      method: "POST",
      url: "/v1/organizations/sync",
      headers: stranger.headers,
      payload: { address: state.organization },
    });
    expect(denied.statusCode).toBe(403);

    const owner = await login(t.app, keypair("owner"));
    const res = await t.app.inject({
      method: "POST",
      url: "/v1/organizations/sync",
      headers: owner.headers,
      payload: { address: state.organization },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("owner");
    orgId = res.json().organization.id;
    const [org] = await t.deps.db.select().from(organizations).where(eq(organizations.id, orgId));
    expect(org!.verifiedDomain).toBe("acme.example");

    for (const doc of [state.documents.terms.address, state.documents.privacy.address]) {
      const r = await t.app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/documents/sync`,
        headers: owner.headers,
        payload: { address: doc },
      });
      expect(r.statusCode).toBe(200);
    }
    const shard = await t.app.inject({
      method: "POST",
      url: `/v1/organizations/${orgId}/shards/sync`,
      headers: owner.headers,
      payload: { address: state.shard },
    });
    expect(shard.statusCode).toBe(200);
    // The allocator resumes after the highest nonce consumed on-chain (never re-issues a used bit).
    const [row] = await t.deps.db
      .select()
      .from(nonceShards)
      .where(eq(nonceShards.address, state.shard));
    expect(row!.nextIndex).toBeGreaterThanOrEqual(3);
  });

  async function challenge(signer: Uint8Array, document = state.documents.terms.address) {
    const res = await t.app.inject({
      method: "POST",
      url: "/v1/acceptance/challenges",
      headers: { origin: APP_ORIGIN },
      payload: { organization: state.organization, document, signer: toBase58(signer.slice(32)) },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as {
      challengeId: string;
      clientBinding: string;
      message: string;
      nonce: { index: number };
    };
  }

  it("never hands out a nonce already consumed on-chain, even with a stale database cursor", async () => {
    // A database restored from an old backup (or nonces consumed by another relayer instance):
    // the cursor lags the chain. The seeded acceptances consumed nonces 0-2 of this shard.
    await t.deps.db.update(nonceShards).set({ nextIndex: 0 });
    const secret = ed25519.utils.randomSecretKey();
    const user = new Uint8Array([...secret, ...ed25519.getPublicKey(secret)]);
    const ch = await challenge(user);
    expect(ch.nonce.index).toBeGreaterThanOrEqual(3);
    const ok = await t.app.inject({
      method: "POST",
      url: `/v1/acceptance/challenges/${ch.challengeId}/submit`,
      payload: {
        clientBinding: ch.clientBinding,
        signature: toBase58(ed25519.sign(utf8(ch.message), secret)),
      },
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("relays a user's signed acceptance and issues a verified receipt", async () => {
    const user = keypair("user-2");
    const ch = await challenge(user);
    expect(ch.message).toContain("Organization: Acme Inc. (verified: acme.example)");
    expect(ch.message.endsWith("Requested by: localhost")).toBe(true);

    // A signature over a different message is refused before anything is sent on-chain.
    const forged = toBase58(
      ed25519.sign(utf8(ch.message.replace("Acme", "Acne")), user.slice(0, 32)),
    );
    const bad = await t.app.inject({
      method: "POST",
      url: `/v1/acceptance/challenges/${ch.challengeId}/submit`,
      payload: { clientBinding: ch.clientBinding, signature: forged },
    });
    expect(bad.statusCode).toBe(400);

    const signature = toBase58(ed25519.sign(utf8(ch.message), user.slice(0, 32)));
    const ok = await t.app.inject({
      method: "POST",
      url: `/v1/acceptance/challenges/${ch.challengeId}/submit`,
      payload: { clientBinding: ch.clientBinding, signature },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const { acceptanceId, transactionSignature } = ok.json() as {
      acceptanceId: string;
      transactionSignature: string;
    };
    expect(acceptanceId).toMatch(/^[0-9a-f]{64}$/);

    // Idempotent re-submission.
    const again = await t.app.inject({
      method: "POST",
      url: `/v1/acceptance/challenges/${ch.challengeId}/submit`,
      payload: { clientBinding: ch.clientBinding, signature },
    });
    expect(again.json().acceptanceId).toBe(acceptanceId);

    const [row] = await t.deps.db
      .select()
      .from(acceptances)
      .where(eq(acceptances.acceptanceId, acceptanceId));
    expect(row!.txSignature).toBe(transactionSignature);
    expect(row!.signerAddress).toBe(toBase58(user.slice(32)));

    const receipt = await t.app.inject({
      method: "GET",
      url: `/v1/public/acceptances/${acceptanceId}/receipt`,
    });
    expect(receipt.statusCode, receipt.body).toBe(200);
    const body = receipt.json();
    expect(["VALID", "VALID_WITH_WARNINGS"]).toContain(body.report.verdict);
    expect(body.receipt.acceptanceId).toBe(acceptanceId);
    expect(body.receipt.content.format).toBe("stele-content-v1");
  });

  it("publishes a new version: server prepares, the client recomputes independently, the wallet signs", async () => {
    const owner = await login(t.app, keypair("owner"));
    const [doc] = await t.deps.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.address, state.documents.terms.versions[0].address));
    // Register a webhook to observe the publication event.
    const hook = await t.app.inject({
      method: "POST",
      url: `/v1/organizations/${orgId}/webhooks`,
      headers: owner.headers,
      payload: {
        url: "https://hooks.example.com/stele",
        events: ["document.version_published", "agreement.accepted"],
      },
    });
    expect(hook.statusCode, hook.body).toBe(200);

    const source =
      "# Acme Terms of Service\n\nVersion 3 clarifies data retention.\n\n## 1. Retention\n\n- We keep logs for 30 days.";
    const draft = await t.app.inject({
      method: "POST",
      url: `/v1/documents/${doc!.documentId}/drafts`,
      headers: owner.headers,
      payload: {
        title: "Terms of Service",
        versionLabel: "3.0",
        source,
        changeSummary: "Clarified retention.",
      },
    });
    expect(draft.statusCode, draft.body).toBe(200);
    const draftId = draft.json().draft.id;
    const prep = await t.app.inject({
      method: "POST",
      url: `/v1/drafts/${draftId}/prepare`,
      headers: owner.headers,
    });
    expect(prep.statusCode, prep.body).toBe(200);
    const p = prep.json().publication;

    // Independent recomputation (what the publisher's browser does before prompting the wallet).
    const canonical = parseCanonicalContent(utf8(p.canonicalContent));
    expect(
      canonicalizeContent({ blocks: canonical.blocks, changeSummary: canonical.changeSummary }),
    ).toEqual(canonical);
    expect(toHex(contentHash(utf8(p.canonicalContent)))).toBe(p.contentHash);
    const recomputed = versionHash({
      chainId: p.chainId,
      program: p.programId,
      organization: p.organization,
      document: p.document,
      documentType: "terms-of-service",
      locale: "en-US",
      version: p.versionNumber,
      previousVersionHash: fromHex(p.previousVersionHash),
      title: p.title,
      versionLabel: p.versionLabel,
      effectiveAt: p.effectiveAt,
      contentHash: fromHex(p.contentHash),
    });
    expect(toHex(recomputed)).toBe(p.versionHash);

    // The owner's wallet signs publish_version with the reviewed fingerprint.
    const ownerSigner = await createKeyPairSignerFromBytes(keypair("owner"));
    const [config] = await findConfigPda(address(state.programId));
    const tx = await t.deps.chain.send(ownerSigner, [
      publishVersionInstruction({
        programAddress: address(state.programId),
        authority: ownerSigner,
        membership: null,
        config,
        organization: address(p.organization),
        document: address(p.document),
        versionAccount: address(p.versionAccount),
        payer: ownerSigner,
        version: p.versionNumber,
        previousVersionHash: fromHex(p.previousVersionHash),
        contentHash: fromHex(p.contentHash),
        title: p.title,
        versionLabel: p.versionLabel,
        effectiveAt: p.effectiveAt,
        storageUri: p.storageUri,
        expectedVersionHash: fromHex(p.versionHash),
      }),
    ]);
    const confirm = await t.app.inject({
      method: "POST",
      url: "/v1/publications/confirm",
      headers: owner.headers,
      payload: { signature: tx },
    });
    expect(confirm.statusCode, confirm.body).toBe(200);
    const [mirrored] = await t.deps.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.address, p.versionAccount));
    expect(mirrored!.versionHash).toBe(p.versionHash);
    expect(mirrored!.publishTx).toBe(tx);

    const deliveries = await t.deps.db.select().from(webhookDeliveries);
    expect(deliveries.some((d) => d.eventType === "document.version_published")).toBe(true);
    const audit = await verifyAuditChain(t.deps.db, orgId);
    expect(audit.valid).toBe(true);
    const actions = (
      await t.deps.db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.organizationId, orgId))
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "version.publication_requested",
        "version.published",
        "webhook.created",
      ]),
    );
  });

  it("rejects on-chain an acceptance whose version was superseded after the challenge", async () => {
    const user = keypair("user-3");
    const ch = await challenge(user);
    // Publish another version while the user is reviewing.
    const owner = await login(t.app, keypair("owner"));
    const [anyVersion] = await t.deps.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.address, state.documents.terms.versions[0].address));
    const draft = await t.app.inject({
      method: "POST",
      url: `/v1/documents/${anyVersion!.documentId}/drafts`,
      headers: owner.headers,
      payload: {
        title: "Terms of Service",
        versionLabel: "3.1",
        source: "# Terms\n\nMinor wording update.",
      },
    });
    const prep = (
      await t.app.inject({
        method: "POST",
        url: `/v1/drafts/${draft.json().draft.id}/prepare`,
        headers: owner.headers,
      })
    ).json().publication;
    const ownerSigner = await createKeyPairSignerFromBytes(keypair("owner"));
    const [config] = await findConfigPda(address(state.programId));
    await t.deps.chain.send(ownerSigner, [
      publishVersionInstruction({
        programAddress: address(state.programId),
        authority: ownerSigner,
        membership: null,
        config,
        organization: address(prep.organization),
        document: address(prep.document),
        versionAccount: address(prep.versionAccount),
        payer: ownerSigner,
        version: prep.versionNumber,
        previousVersionHash: fromHex(prep.previousVersionHash),
        contentHash: fromHex(prep.contentHash),
        title: prep.title,
        versionLabel: prep.versionLabel,
        effectiveAt: 0,
        storageUri: prep.storageUri,
        expectedVersionHash: fromHex(prep.versionHash),
      }),
    ]);
    const signature = toBase58(ed25519.sign(utf8(ch.message), user.slice(0, 32)));
    const res = await t.app.inject({
      method: "POST",
      url: `/v1/acceptance/challenges/${ch.challengeId}/submit`,
      payload: { clientBinding: ch.clientBinding, signature },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toMatch(/VersionNotCurrent/);
  });

  it("rebuilds the entire index from the chain into an empty database", async () => {
    const fresh = await createTestDb();
    try {
      const deps: Deps = { ...t.deps, db: fresh.db, logger: pino({ level: "silent" }) };
      const processed = await indexOnce(deps, { rebuild: true });
      expect(processed).toBeGreaterThan(5);
      const [org] = await fresh.db
        .select()
        .from(organizations)
        .where(eq(organizations.address, state.organization));
      expect(org?.name).toBe("Acme Inc.");
      const rebuilt = await fresh.db.select().from(acceptances);
      const original = await t.deps.db.select().from(acceptances);
      for (const a of original)
        expect(rebuilt.map((r) => r.acceptanceId)).toContain(a.acceptanceId);
      expect(rebuilt.length).toBeGreaterThanOrEqual(state.acceptances.length);
    } finally {
      await fresh.close();
    }
  });
});
