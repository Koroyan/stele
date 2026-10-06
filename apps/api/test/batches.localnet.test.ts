/**
 * MERKLE_BATCHED evidence mode against a REAL local validator (skipped without a seeded localnet
 * running the batch-capable program). Wallet and native-passkey acceptances are verified by the
 * relayer, queued, and anchored as one Merkle root; every receipt is then verified independently
 * (chain + receipt only), and any altered claim — text, proof, position — fails.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { address } from "@solana/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptanceBatches, eq, sponsoredTransactions } from "@stele/db";
import {
  PASSKEY_ACCEPTANCE_TAG,
  SECP256R1_PROGRAM_ADDRESS,
  createRpc,
  fromBase64,
  fromBase64Url,
  identifyInstruction,
  toBase58,
  toBase64Url,
  utf8,
  webauthnChallenge,
} from "@stele/protocol";
import { SoftPasskey } from "@stele/protocol/testing";
import { chainFromUrls, decodeWireTransaction, verifyAcceptance } from "@stele/verifier";
import { FilesystemContentStore } from "../src/lib/storage.js";
import { syncDocument, syncShard } from "../src/lib/sync.js";
import { anchorPendingBatches } from "../src/services/batches.js";
import { REPO_ROOT, login, makeApp, realChain, testConfig, type TestApp } from "./helpers.js";

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
/** The batch instruction exists from the 786 KB build on. */
async function programHasBatches(url: string, program: string) {
  const rpc = createRpc(url);
  const info = await rpc.getAccountInfo(address(program), { encoding: "base64" }).send();
  if (!info.value) return false;
  const programData = address(toBase58(fromBase64(info.value.data[0]).subarray(4, 36)));
  const data = await rpc
    .getAccountInfo(programData, { encoding: "base64", dataSlice: { offset: 0, length: 0 } })
    .send();
  return Number(data.value?.space ?? 0) > 780_000;
}
const available =
  state !== null &&
  (await rpcUp(state.rpcUrl)) &&
  (await programHasBatches(state.rpcUrl, state.programId));

const ORIGIN = "http://localhost:3000";
const headers = { origin: ORIGIN };

describe.skipIf(!available)("MERKLE_BATCHED acceptances (real validator)", () => {
  let t: TestApp;
  let orgId: string;
  let owner: Awaited<ReturnType<typeof login>>;
  const org = () => state.organization as string;
  const doc = () => state.documents.terms.address as string;
  const inject = (method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
    t.app.inject({ method, url, payload: payload as never, headers });

  const verifierOptions = () => ({
    chain: chainFromUrls([state.rpcUrl]),
    programId: state.programId,
    content: { mirrors: ["http://localhost:4000/v1/public/content"] },
    fetchImpl: (async (input: RequestInfo | URL) => {
      const hash = String(input).split("/").pop()!;
      const bytes = /^[0-9a-f]{64}$/.test(hash) ? await t.deps.storage.get(hash) : null;
      return bytes
        ? new Response(Buffer.from(bytes), { status: 200 })
        : new Response("not found", { status: 404 });
    }) as typeof fetch,
    trustedRequestDomains: ["localhost"],
  });

  async function setSettings(settings: Record<string, unknown>) {
    const res = await t.app.inject({
      method: "PATCH",
      url: `/v1/organizations/${orgId}/settings`,
      headers: owner.headers,
      payload: settings,
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function walletAccept() {
    const secret = ed25519.utils.randomSecretKey();
    const ch = (
      await inject("POST", "/v1/acceptance/challenges", {
        organization: org(),
        document: doc(),
        signer: toBase58(ed25519.getPublicKey(secret)),
      })
    ).json();
    return inject("POST", `/v1/acceptance/challenges/${ch.challengeId}/submit`, {
      clientBinding: ch.clientBinding,
      signature: toBase58(ed25519.sign(utf8(ch.message), secret)),
    });
  }

  async function passkeyAccept() {
    const o = (
      await inject("POST", "/v1/passkeys/native/options", {
        organization: org(),
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
        organization: org(),
        document: doc(),
        signer: reg.identity,
        signerType: "passkey_p256",
      })
    ).json();
    expect(ch.passkey.challenge).toBe(
      toBase64Url(webauthnChallenge(PASSKEY_ACCEPTANCE_TAG, ch.message)),
    );
    const { assertion } = await passkey.assert({
      challenge: fromBase64Url(ch.passkey.challenge),
      origin: ORIGIN,
    });
    return inject("POST", `/v1/acceptance/challenges/${ch.challengeId}/submit`, {
      clientBinding: ch.clientBinding,
      passkeyAssertion: assertion,
    });
  }

  beforeAll(async () => {
    const cfg = testConfig({
      SOLANA_RPC_URLS: state.rpcUrl,
      PROGRAM_ID: state.programId,
      RELAYER_KEYPAIR: resolve(DATA, "relayer.json"),
      ATTESTOR_KEYPAIR: resolve(DATA, "attestor.json"),
      HOSTED_ACCEPT_DOMAIN: "localhost",
      PUBLIC_CONTENT_BASE_URL: "http://localhost:4000/v1/public/content",
    });
    t = await makeApp({
      config: cfg,
      chain: await realChain(cfg),
      storage: new FilesystemContentStore(resolve(REPO_ROOT, ".data/storage")),
    });
    owner = await login(t.app, keypair("owner"));
    const synced = await t.app.inject({
      method: "POST",
      url: "/v1/organizations/sync",
      headers: owner.headers,
      payload: { address: org() },
    });
    expect(synced.statusCode, synced.body).toBe(200);
    orgId = synced.json().organization.id;
    await syncDocument(t.deps.db, t.deps.chain, doc());
    await syncShard(t.deps.db, t.deps.chain, state.shard);
    await setSettings({
      signingPolicy: "WALLET_OR_PASSKEY",
      evidenceMode: "MERKLE_BATCHED",
      feeSponsor: "stele",
      sponsorFallbackToStele: false,
    });
  });
  afterAll(async () => {
    await t?.close();
  });

  it("verifies off-chain, anchors one root for many acceptances, and every receipt verifies independently", async () => {
    const submitted = [await walletAccept(), await passkeyAccept(), await passkeyAccept()];
    for (const res of submitted) {
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({
        status: "pending_batch",
        evidenceMode: "MERKLE_BATCHED",
        transactionSignature: null,
      });
    }
    const ids = submitted.map((r) => r.json().acceptanceId as string);
    // Nothing is provable before the anchor.
    expect((await inject("GET", `/v1/public/acceptances/${ids[0]}/receipt`)).statusCode).toBe(404);

    expect(await anchorPendingBatches(t.deps)).toBe(1);
    const [batch] = await t.deps.db
      .select()
      .from(acceptanceBatches)
      .where(eq(acceptanceBatches.status, "anchored"));
    expect(batch!.leafCount).toBe(3);

    // One transaction for three acceptances: no precompile, only the anchor; the relayer paid.
    const tx = await createRpc(state.rpcUrl)
      .getTransaction(batch!.txSignature! as never, {
        encoding: "base64",
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      })
      .send();
    const decoded = decodeWireTransaction(fromBase64(tx!.transaction[0]), [], []);
    const steleIxs = decoded.instructions.filter((ix) => ix.programId === state.programId);
    expect(steleIxs.map((ix) => identifyInstruction(ix.data))).toEqual(["anchor_acceptance_batch"]);
    expect(decoded.instructions.some((ix) => ix.programId === SECP256R1_PROGRAM_ADDRESS)).toBe(
      false,
    );
    expect(decoded.accountKeys[0]).toBe(t.deps.chain.relayer.address);
    const [booked] = await t.deps.db
      .select()
      .from(sponsoredTransactions)
      .where(eq(sponsoredTransactions.txSignature, batch!.txSignature!));
    expect(booked!.recordCount).toBe(3);

    for (const [i, id] of ids.entries()) {
      const r = await inject("GET", `/v1/public/acceptances/${id}/receipt`);
      expect(r.statusCode, r.body).toBe(200);
      const { receipt, report } = r.json();
      expect(receipt).toMatchObject({
        format: "stele-receipt/2",
        protocol: i === 0 ? "stele/1" : "stele/2",
        evidenceMode: "MERKLE_BATCHED",
        batch: { leafCount: 3, root: batch!.root },
      });
      expect(report.checks.find((c: { id: string }) => c.id === "nonce.consumed").status).toBe(
        "skip",
      );
      // Independent: chain + receipt only.
      const v = await verifyAcceptance({ receipt }, verifierOptions());
      expect(v.verdict, JSON.stringify(v.checks)).toMatch(/^VALID/);
      for (const tamper of [
        (x: typeof receipt) => (x.acceptance.message = `${x.acceptance.message} `),
        (x: typeof receipt) => (x.batch.leafIndex = (x.batch.leafIndex + 1) % 3),
        (x: typeof receipt) => (x.batch.proof[0] = "00".repeat(32)),
        (x: typeof receipt) => (x.batch.leafCount = 4),
        (x: typeof receipt) => (x.acceptance.nonce.index += 1),
      ]) {
        const forged = structuredClone(receipt);
        tamper(forged);
        const bad = await verifyAcceptance({ receipt: forged }, verifierOptions());
        expect(bad.verdict).not.toMatch(/^VALID/);
      }
    }

    // The manifest alone (no API) proves every leaf.
    const m = await inject("GET", `/v1/public/batches/${batch!.root}`);
    expect(m.statusCode).toBe(200);
    const manifest = m.json();
    expect(manifest.leaves).toHaveLength(3);
    for (const leaf of manifest.leaves) {
      const v = await verifyAcceptance(
        { transactionSignature: batch!.txSignature!, batched: leaf },
        verifierOptions(),
      );
      expect(v.verdict, JSON.stringify(v.checks)).toMatch(/^VALID/);
    }

    // Back to direct recording: nothing else changes.
    await setSettings({ evidenceMode: "DIRECT_ONCHAIN" });
    const direct = await walletAccept();
    expect(direct.statusCode, direct.body).toBe(200);
    expect(direct.json()).toMatchObject({ status: "confirmed", evidenceMode: "DIRECT_ONCHAIN" });
  });
});
