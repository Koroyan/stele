/**
 * Devnet smoke test of the stele/2 demo path (opt-in: STELE_DEVNET_SMOKE=1). Uses the real Devnet
 * program, the Devnet relayer, and an existing organization/document/shard; a software WebAuthn
 * authenticator stands in for the user's device. Writes the receipt it obtains to
 * STELE_DEVNET_RECEIPT_OUT (if set) for the demo's CLI and forgery steps.
 *
 *   STELE_DEVNET_SMOKE=1 STELE_DEVNET_RELAYER=<relayer.json> STELE_DEVNET_ATTESTOR=<attestor.json> \
 *   STELE_DEVNET_ORG=<address> STELE_DEVNET_DOC=<address> STELE_DEVNET_SHARD=<address> \
 *   [STELE_DEVNET_RPC_URLS=<url,url>] pnpm --filter @stele/api exec vitest run test/devnet.smoke.test.ts
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, organizations } from "@stele/db";
import { fromBase64Url, toBase58, utf8 } from "@stele/protocol";
import { SoftPasskey } from "@stele/protocol/testing";
import { chainFromUrls, verifyAcceptance } from "@stele/verifier";
import { FilesystemContentStore } from "../src/lib/storage.js";
import { syncDocument, syncOrganization, syncShard } from "../src/lib/sync.js";
import { anchorPendingBatches } from "../src/services/batches.js";
import { REPO_ROOT, makeApp, realChain, testConfig, type TestApp } from "./helpers.js";

const enabled = process.env.STELE_DEVNET_SMOKE === "1";
const RPCS = (process.env.STELE_DEVNET_RPC_URLS ?? "https://api.devnet.solana.com").split(",");
const PROGRAM = "6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV";
const ORIGIN = "http://localhost:3000";
const headers = { origin: ORIGIN };

describe.skipIf(!enabled)("stele/2 on Solana Devnet (smoke)", () => {
  let t: TestApp;
  const org = process.env.STELE_DEVNET_ORG!;
  const doc = process.env.STELE_DEVNET_DOC!;
  const inject = (method: "GET" | "POST", url: string, payload?: unknown) =>
    t.app.inject({ method, url, payload: payload as never, headers });
  const verifierOptions = () => ({
    chain: chainFromUrls(RPCS),
    programId: PROGRAM,
    expectedChainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    fetchImpl: (async (input: RequestInfo | URL) => {
      const hash = String(input).split("/").pop()!;
      const bytes = /^[0-9a-f]{64}$/.test(hash) ? await t.deps.storage.get(hash) : null;
      return bytes
        ? new Response(Buffer.from(bytes), { status: 200 })
        : new Response("not found", { status: 404 });
    }) as typeof fetch,
    content: { mirrors: ["http://localhost:4000/v1/public/content"] },
    trustedRequestDomains: ["localhost"],
  });
  async function setSettings(settings: Record<string, unknown>) {
    const [row] = await t.deps.db
      .select()
      .from(organizations)
      .where(eq(organizations.address, org));
    await t.deps.db
      .update(organizations)
      .set({ settings: { ...row!.settings, ...settings } })
      .where(eq(organizations.id, row!.id));
  }
  async function passkeyAccept() {
    const o = (
      await inject("POST", "/v1/passkeys/native/options", {
        organization: org,
        purpose: "register",
      })
    ).json();
    const passkey = await SoftPasskey.create(o.rpId);
    const reg = (
      await inject("POST", "/v1/passkeys/native/register", {
        challengeId: o.challengeId,
        credential: passkey.register({ challenge: fromBase64Url(o.challenge), origin: ORIGIN }),
      })
    ).json();
    const proof = await passkey.assert({
      challenge: fromBase64Url(reg.confirm.challenge),
      origin: ORIGIN,
    });
    const confirmed = await inject("POST", "/v1/passkeys/native/confirm", {
      challengeId: reg.confirm.challengeId,
      assertion: proof.assertion,
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const ch = (
      await inject("POST", "/v1/acceptance/challenges", {
        organization: org,
        document: doc,
        signer: reg.identity,
        signerType: "passkey_p256",
      })
    ).json();
    const { assertion } = await passkey.assert({
      challenge: fromBase64Url(ch.passkey.challenge),
      origin: ORIGIN,
    });
    return inject("POST", `/v1/acceptance/challenges/${ch.challengeId}/submit`, {
      clientBinding: ch.clientBinding,
      passkeyAssertion: assertion,
    });
  }
  async function walletAccept() {
    const secret = ed25519.utils.randomSecretKey();
    const ch = (
      await inject("POST", "/v1/acceptance/challenges", {
        organization: org,
        document: doc,
        signer: toBase58(ed25519.getPublicKey(secret)),
      })
    ).json();
    return inject("POST", `/v1/acceptance/challenges/${ch.challengeId}/submit`, {
      clientBinding: ch.clientBinding,
      signature: toBase58(ed25519.sign(utf8(ch.message), secret)),
    });
  }

  beforeAll(async () => {
    const cfg = testConfig({
      SOLANA_CLUSTER: "devnet",
      SOLANA_RPC_URLS: RPCS.join(","),
      PROGRAM_ID: PROGRAM,
      RELAYER_KEYPAIR: process.env.STELE_DEVNET_RELAYER!,
      ATTESTOR_KEYPAIR: process.env.STELE_DEVNET_ATTESTOR!,
      HOSTED_ACCEPT_DOMAIN: "localhost",
      PRIORITY_FEE_MICROLAMPORTS: "10000",
    });
    t = await makeApp({
      config: cfg,
      chain: await realChain(cfg),
      storage: new FilesystemContentStore(resolve(REPO_ROOT, ".data/storage")),
    });
    await syncOrganization(t.deps.db, t.deps.chain, org);
    await syncDocument(t.deps.db, t.deps.chain, doc);
    await syncShard(t.deps.db, t.deps.chain, process.env.STELE_DEVNET_SHARD!);
    await setSettings({ signingPolicy: "WALLET_OR_PASSKEY", evidenceMode: "DIRECT_ONCHAIN" });
  }, 120_000);
  afterAll(async () => {
    await t?.close();
  });

  it("records a native passkey acceptance on Devnet and verifies it independently", async () => {
    const res = await passkeyAccept();
    expect(res.statusCode, res.body).toBe(200);
    const out = res.json();
    console.log(`devnet stele/2 acceptance ${out.acceptanceId} tx ${out.transactionSignature}`);
    const r = await inject("GET", `/v1/public/acceptances/${out.acceptanceId}/receipt`);
    expect(r.statusCode, r.body).toBe(200);
    const { receipt } = r.json();
    expect(receipt.format).toBe("stele-receipt/2");
    if (process.env.STELE_DEVNET_RECEIPT_OUT)
      writeFileSync(process.env.STELE_DEVNET_RECEIPT_OUT, JSON.stringify(receipt, null, 2));
    const v = await verifyAcceptance({ receipt }, verifierOptions());
    expect(v.verdict, JSON.stringify(v.checks)).toMatch(/^VALID/);

    // Demo step 13 on Devnet (key-only signer: forged signature and replay).
    const file = resolve(REPO_ROOT, ".data", `devnet-forgery-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(receipt));
    const demo = spawnSync(`pnpm --filter @stele/localnet forgery-demo -- --receipt "${file}"`, {
      cwd: REPO_ROOT,
      shell: true,
      encoding: "utf8",
      env: { ...process.env, STELE_RPC_URL: RPCS[0], STELE_PROGRAM_ID: PROGRAM },
    });
    console.log(demo.stdout);
    expect(demo.status, demo.stderr).toBe(0);
  }, 300_000);

  it("anchors a Merkle batch on Devnet and verifies its leaves", async () => {
    await setSettings({ evidenceMode: "MERKLE_BATCHED" });
    const queued = [await walletAccept(), await passkeyAccept()];
    for (const q of queued) expect(q.json().status, q.body).toBe("pending_batch");
    expect(await anchorPendingBatches(t.deps)).toBe(1);
    for (const q of queued) {
      const r = await inject("GET", `/v1/public/acceptances/${q.json().acceptanceId}/receipt`);
      expect(r.statusCode, r.body).toBe(200);
      const v = await verifyAcceptance({ receipt: r.json().receipt }, verifierOptions());
      expect(v.verdict, JSON.stringify(v.checks)).toMatch(/^VALID/);
      console.log(
        `devnet batched ${r.json().receipt.protocol} acceptance ${q.json().acceptanceId} in ${r.json().receipt.transaction.signature}`,
      );
    }
    await setSettings({ evidenceMode: "DIRECT_ONCHAIN" });
  }, 300_000);
});
