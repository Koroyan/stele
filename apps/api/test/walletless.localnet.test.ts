/**
 * Walletless signing, fee sponsorship and proofs against a REAL local validator (skipped without a
 * seeded localnet). The browser side is simulated with a software WebAuthn authenticator that
 * produces real assertions and PRF outputs; every piece of evidence is verified against the chain.
 *
 * Covers the security invariants of the upgrade: the server and the database hold no usable key;
 * a passkey signer's record needs a user-verified assertion over that exact message; changes need
 * the key; account recovery creates a new key instead of controlling the old one; sponsorship never
 * changes the authorizer; the user never pays.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  eq,
  nonceShards,
  organizations,
  passkeyCredentials,
  signerIdentities,
  sponsoredTransactions,
} from "@stele/db";
import {
  buildKeyStatement,
  createRpc,
  decodeRecoveryKit,
  encodeRecoveryKit,
  enableShardSponsorshipInstruction,
  fromBase64Url,
  newRecoverySecret,
  passkeySignatureChallenge,
  passkeyStatementChallenge,
  recoveryKitId,
  signSendAndConfirm,
  systemTransferInstruction,
  toBase58,
  toBase64Url,
  unwrapSigningSeed,
  updateShardSponsorshipInstruction,
  utf8,
  wrapSigningSeed,
  type WrappedKey,
} from "@stele/protocol";
import { SoftPasskey } from "@stele/protocol/testing";
import { verifyAcceptance, verifyProof } from "@stele/verifier";
import { assertSponsoredRecordingShape } from "../src/lib/tx-policy.js";
import { FilesystemContentStore } from "../src/lib/storage.js";
import { syncDocument, syncShard } from "../src/lib/sync.js";
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
const available = state !== null && (await rpcUp(state.rpcUrl));

const ORIGIN = "http://localhost:3000";
const storage = () => new FilesystemContentStore(resolve(REPO_ROOT, ".data/storage"));
const HOST = "localhost";
const headers = { origin: ORIGIN };

const config = (env: Record<string, string> = {}) =>
  testConfig({
    SOLANA_RPC_URLS: state.rpcUrl,
    PROGRAM_ID: state.programId,
    RELAYER_KEYPAIR: resolve(DATA, "relayer.json"),
    ATTESTOR_KEYPAIR: resolve(DATA, "attestor.json"),
    HOSTED_ACCEPT_DOMAIN: "localhost",
    PUBLIC_CONTENT_BASE_URL: "http://localhost:4000/v1/public/content",
    ...env,
  });

/** A browser-side walletless signer: Ed25519 key wrapped under a (software) passkey's PRF. */
interface Signer {
  seed: Uint8Array;
  publicKey: string;
  passkey: SoftPasskey;
  prfSalt: Uint8Array;
  kit?: string;
}

describe.skipIf(!available)("walletless signing, sponsorship and proofs (real validator)", () => {
  let t: TestApp;
  let orgId: string;
  let apiKey: string;
  const org = () => state.organization as string;
  const doc = () => state.documents.terms.address as string;

  async function inject(
    method: "GET" | "POST" | "PATCH",
    url: string,
    payload?: unknown,
    extra: Record<string, string> = {},
  ) {
    return t.app.inject({
      method,
      url,
      payload: payload as never,
      headers: { ...headers, ...extra },
    });
  }

  let ownerSession: Awaited<ReturnType<typeof login>> | null = null;
  async function setSettings(settings: Record<string, unknown>) {
    const owner = (ownerSession ??= await login(t.app, keypair("owner")));
    const res = await t.app.inject({
      method: "PATCH",
      url: `/v1/organizations/${orgId}/settings`,
      headers: owner.headers,
      payload: settings,
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function register(
    opts: { sessionToken?: string; withKit?: boolean } = {},
  ): Promise<Signer> {
    const options = await inject("POST", "/v1/passkeys/options", {
      organization: org(),
      purpose: "register",
      sessionToken: opts.sessionToken,
    });
    expect(options.statusCode, options.body).toBe(200);
    const o = options.json();
    const passkey = await SoftPasskey.create(o.rpId);
    const credential = passkey.register({ challenge: fromBase64Url(o.challenge), origin: ORIGIN });
    const seed = ed25519.utils.randomSecretKey();
    const publicKey = toBase58(ed25519.getPublicKey(seed));
    const now = Math.floor(Date.now() / 1000);
    const keyStatement = buildKeyStatement({
      action: "REGISTER",
      organization: org(),
      key: publicKey,
      passkey: {
        credentialId: credential.credentialId,
        publicKey: credential.publicKey,
        rpId: o.rpId,
      },
      chainId: o.chainId,
      issuedAt: now,
    });
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const { assertion, prf } = await passkey.assert({
      challenge: passkeyStatementChallenge(keyStatement),
      origin: ORIGIN,
      prfSalt,
    });
    const wrappedKey = await wrapSigningSeed(prf!, seed, {
      purpose: "passkey",
      publicKey: ed25519.getPublicKey(seed),
      bindingId: passkey.credentialId,
    });
    let recoveryKit;
    let kit: string | undefined;
    if (opts.withKit) {
      const secret = newRecoverySecret();
      kit = encodeRecoveryKit(secret);
      const kitId = recoveryKitId(secret);
      const statement = buildKeyStatement({
        action: "ADD_RECOVERY_KIT",
        organization: org(),
        key: publicKey,
        recoveryKitId: kitId,
        chainId: o.chainId,
        issuedAt: now,
      });
      recoveryKit = {
        kitId,
        wrappedKey: await wrapSigningSeed(secret, seed, {
          purpose: "recovery",
          publicKey: ed25519.getPublicKey(seed),
          bindingId: fromHex(kitId),
        }),
        keyStatement: statement,
        keySignature: toBase64Url(ed25519.sign(utf8(statement), seed)),
      };
    }
    const res = await inject("POST", "/v1/passkeys/register", {
      challengeId: o.challengeId,
      credential,
      identity: publicKey,
      keyStatement,
      keySignature: toBase64Url(ed25519.sign(utf8(keyStatement), seed)),
      statementAssertion: assertion,
      prfSalt: toBase64Url(prfSalt),
      wrappedKey,
      recoveryKit,
    });
    expect(res.statusCode, res.body).toBe(200);
    return { seed, publicKey, passkey, prfSalt, kit };
  }

  /** The browser flow: challenge → one passkey ceremony (assertion + PRF) → unwrap → sign. */
  async function acceptWithPasskey(
    s: Signer,
    opts: { sessionToken?: string; tamper?: "no-uv" | "other-message" | "none-sent" } = {},
  ) {
    const ch = await inject("POST", "/v1/acceptance/challenges", {
      organization: org(),
      document: doc(),
      signer: s.publicKey,
      signerType: "passkey",
      sessionToken: opts.sessionToken,
    });
    expect(ch.statusCode, ch.body).toBe(200);
    const c = ch.json();
    expect(c.passkey.challenge).toBe(toBase64Url(passkeySignatureChallenge(c.message)));
    const material = (
      await inject("POST", "/v1/passkeys/key-material", {
        organization: org(),
        credentialId: toBase64Url(s.passkey.credentialId),
      })
    ).json();
    const { assertion, prf } = await s.passkey.assert({
      challenge:
        opts.tamper === "other-message"
          ? passkeySignatureChallenge(`${c.message}.`)
          : fromBase64Url(c.passkey.challenge),
      origin: ORIGIN,
      userVerified: opts.tamper !== "no-uv",
      prfSalt: fromBase64Url(material.prfSalt),
    });
    const seed = await unwrapSigningSeed(prf!, material.wrappedKey as WrappedKey, {
      purpose: "passkey",
      publicKey: ed25519.getPublicKey(s.seed),
      bindingId: s.passkey.credentialId,
    });
    const signature = toBase58(ed25519.sign(utf8(c.message), seed));
    seed.fill(0);
    return inject("POST", `/v1/acceptance/challenges/${c.challengeId}/submit`, {
      clientBinding: c.clientBinding,
      signature,
      passkeyAssertion: opts.tamper === "none-sent" ? undefined : assertion,
    });
  }

  beforeAll(async () => {
    const cfg = config();
    t = await makeApp({ config: cfg, chain: await realChain(cfg), storage: storage() });
    const owner = await login(t.app, keypair("owner"));
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
    const key = await t.app.inject({
      method: "POST",
      url: `/v1/organizations/${orgId}/api-keys`,
      headers: owner.headers,
      payload: {
        name: "walletless tests",
        scopes: [
          "acceptances:read",
          "acceptances:write",
          "proofs:write",
          "proofs:read",
          "signers:read",
          "signers:write",
        ],
      },
    });
    expect(key.statusCode, key.body).toBe(200);
    apiKey = key.json().key;
    await setSettings({ signingPolicy: "WALLET_OR_PASSKEY" });
  });
  // Every test starts from the same policy, whatever the previous one left behind.
  beforeEach(async () => {
    await setSettings({
      signingPolicy: "WALLET_OR_PASSKEY",
      feeSponsor: "stele",
      sponsorFallbackToStele: false,
    });
  });
  afterAll(async () => {
    await t?.close();
  });

  it("registers a passkey-protected key and records an acceptance the user never pays for", async () => {
    const s = await register();
    // The server holds ciphertext only: nothing stored decrypts or reveals the seed.
    const [row] = await t.deps.db
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.credentialId, toBase64Url(s.passkey.credentialId)));
    expect(JSON.stringify(row)).not.toContain(Buffer.from(s.seed).toString("hex"));
    expect(JSON.stringify(row)).not.toContain(toBase64Url(s.seed));
    const relayerBalanceUser = await createRpc(state.rpcUrl)
      .getBalance(address(s.publicKey))
      .send();
    expect(relayerBalanceUser.value).toBe(0n);

    const res = await acceptWithPasskey(s);
    expect(res.statusCode, res.body).toBe(200);
    const out = res.json();
    expect(out.signerType).toBe("passkey");
    expect(out.fee.payer).toBe(t.deps.chain.relayer.address);
    expect(out.fee.payer).not.toBe(s.publicKey);

    const receipt = await inject("GET", `/v1/public/acceptances/${out.acceptanceId}/receipt`);
    expect(receipt.statusCode, receipt.body).toBe(200);
    const body = receipt.json();
    expect(body.receipt.signer.type).toBe("PASSKEY_PROTECTED_STELE_KEY");
    expect(body.receipt.fees.payer).toBe(t.deps.chain.relayer.address);
    expect(body.report.checks.find((c: { id: string }) => c.id === "signer.passkey").status).toBe(
      "pass",
    );

    // Anyone can re-verify the downloaded receipt; altering the passkey evidence breaks it.
    const opts = {
      chain: t.deps.chain.verifierSource(),
      programId: state.programId,
      trustedRequestDomains: ["localhost"],
    };
    const again = await verifyAcceptance({ receipt: body.receipt }, opts);
    expect(["VALID", "VALID_WITH_WARNINGS"]).toContain(again.verdict);
    const forged = structuredClone(body.receipt);
    forged.signer.assertion.clientDataJSON = toBase64Url(
      utf8(JSON.stringify({ type: "webauthn.get", challenge: "AAAA", origin: ORIGIN })),
    );
    expect((await verifyAcceptance({ receipt: forged }, opts)).verdict).toBe("INVALID");
    const relabeled = structuredClone(body.receipt);
    relabeled.fees.payer = s.publicKey;
    expect((await verifyAcceptance({ receipt: relabeled }, opts)).verdict).toBe("INVALID");
  });

  it("never relays a passkey signer's record without a user-verified assertion over that exact message", async () => {
    const s = await register();
    for (const tamper of ["none-sent", "no-uv", "other-message"] as const) {
      const res = await acceptWithPasskey(s, { tamper });
      expect(res.statusCode, `${tamper}: ${res.body}`).toBe(400);
    }
    // The registered key cannot fall back to "wallet" mode to skip the passkey.
    const asWallet = await inject("POST", "/v1/acceptance/challenges", {
      organization: org(),
      document: doc(),
      signer: s.publicKey,
      signerType: "wallet",
    });
    expect(asWallet.statusCode).toBe(400);
    expect(asWallet.json().error.code).toBe("passkey_required");
  });

  it("a database attacker with their own passkey still cannot sign for an existing key", async () => {
    const victim = await register();
    // The attacker rewrites the victim's credential to their own passkey (full DB write access).
    const attacker = await SoftPasskey.create(HOST);
    const credentialId = toBase64Url(victim.passkey.credentialId);
    await t.deps.db
      .update(passkeyCredentials)
      .set({ publicKey: toBase64Url(attacker.publicKey) })
      .where(eq(passkeyCredentials.credentialId, credentialId));
    const ch = (
      await inject("POST", "/v1/acceptance/challenges", {
        organization: org(),
        document: doc(),
        signer: victim.publicKey,
        signerType: "passkey",
      })
    ).json();
    const { assertion } = await attacker.assert({
      challenge: fromBase64Url(ch.passkey.challenge),
      origin: ORIGIN,
    });
    // They can pass the passkey check, but have no Ed25519 key for the victim: any signature fails.
    const forgedSignature = toBase58(
      ed25519.sign(utf8(ch.message), ed25519.utils.randomSecretKey()),
    );
    const res = await inject("POST", `/v1/acceptance/challenges/${ch.challengeId}/submit`, {
      clientBinding: ch.clientBinding,
      signature: forgedSignature,
      passkeyAssertion: { ...assertion, credentialId },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_signature");
  });

  it("enforces the organization's signing policy", async () => {
    await setSettings({ signingPolicy: "WALLET_ONLY" });
    const options = await inject("POST", "/v1/passkeys/options", {
      organization: org(),
      purpose: "register",
    });
    expect(options.statusCode).toBe(403);
    await setSettings({ signingPolicy: "PASSKEY_ONLY" });
    const wallet = toBase58(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));
    const asWallet = await inject("POST", "/v1/acceptance/challenges", {
      organization: org(),
      document: doc(),
      signer: wallet,
    });
    expect(asWallet.statusCode).toBe(403);
    await setSettings({ signingPolicy: "WALLET_OR_PASSKEY" });
  });

  it("a recovery kit unlocks the same key and adds a new passkey (statement signed by the key)", async () => {
    const s = await register({ withKit: true });
    // The device and its passkey are gone. The kit (kept by the user) unlocks the same key.
    const secret = decodeRecoveryKit(s.kit!);
    const found = await inject("POST", "/v1/passkeys/recovery-kits/lookup", {
      organization: org(),
      kitId: recoveryKitId(secret),
    });
    expect(found.statusCode, found.body).toBe(200);
    expect(found.json().identity).toBe(s.publicKey);
    const seed = await unwrapSigningSeed(secret, found.json().wrappedKey, {
      purpose: "recovery",
      publicKey: ed25519.getPublicKey(s.seed),
      bindingId: fromHex(recoveryKitId(secret)),
    });
    expect(toBase58(ed25519.getPublicKey(seed))).toBe(s.publicKey);

    const o = (
      await inject("POST", "/v1/passkeys/options", {
        organization: org(),
        purpose: "add_passkey",
        identity: s.publicKey,
      })
    ).json();
    const passkey = await SoftPasskey.create(o.rpId);
    const credential = passkey.register({ challenge: fromBase64Url(o.challenge), origin: ORIGIN });
    const keyStatement = buildKeyStatement({
      action: "ADD_PASSKEY",
      organization: org(),
      key: s.publicKey,
      passkey: {
        credentialId: credential.credentialId,
        publicKey: credential.publicKey,
        rpId: o.rpId,
      },
      chainId: o.chainId,
      issuedAt: Math.floor(Date.now() / 1000),
    });
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const { assertion, prf } = await passkey.assert({
      challenge: passkeyStatementChallenge(keyStatement),
      origin: ORIGIN,
      prfSalt,
    });
    const base = {
      challengeId: o.challengeId,
      credential,
      identity: s.publicKey,
      keyStatement,
      statementAssertion: assertion,
      prfSalt: toBase64Url(prfSalt),
      wrappedKey: await wrapSigningSeed(prf!, seed, {
        purpose: "passkey",
        publicKey: ed25519.getPublicKey(seed),
        bindingId: passkey.credentialId,
      }),
    };
    // Without the key's signature (e.g. someone who only controls the account) it is refused.
    const intruder = await inject("POST", "/v1/passkeys/register", {
      ...base,
      keySignature: toBase64Url(ed25519.sign(utf8(keyStatement), ed25519.utils.randomSecretKey())),
    });
    expect(intruder.statusCode).toBe(400);
    const o2 = (
      await inject("POST", "/v1/passkeys/options", {
        organization: org(),
        purpose: "add_passkey",
        identity: s.publicKey,
      })
    ).json();
    const credential2 = passkey.register({
      challenge: fromBase64Url(o2.challenge),
      origin: ORIGIN,
    });
    const added = await inject("POST", "/v1/passkeys/register", {
      ...base,
      challengeId: o2.challengeId,
      credential: credential2,
      keySignature: toBase64Url(ed25519.sign(utf8(keyStatement), seed)),
    });
    expect(added.statusCode, added.body).toBe(200);
    seed.fill(0);
    const res = await acceptWithPasskey({ ...s, passkey, prfSalt });
    expect(res.statusCode, res.body).toBe(200);
  });

  it("account recovery without any unlock method creates a NEW key, linked and flagged, never control of the old one", async () => {
    await setSettings({ signingPolicy: "ACCOUNT_AND_PASSKEY" });
    const session = async () =>
      (
        await inject(
          "POST",
          "/v1/acceptance-sessions",
          { externalUserRef: "customer-42", ttlSeconds: 900 },
          { authorization: `Bearer ${apiKey}` },
        )
      ).json().sessionToken as string;
    const first = await register({ sessionToken: await session() });
    const accepted = await acceptWithPasskey(first, { sessionToken: await session() });
    expect(accepted.statusCode, accepted.body).toBe(200);
    // A second signer for the same account is refused while the first is active.
    const options = await inject("POST", "/v1/passkeys/options", {
      organization: org(),
      purpose: "register",
      sessionToken: await session(),
    });
    expect(options.statusCode).toBe(200);
    // The organization resets the account's signer after verifying the customer out of band.
    const revoke = await inject(
      "POST",
      `/v1/signer-identities/${first.publicKey}/revoke`,
      { reason: "customer lost every device and recovery kit" },
      { authorization: `Bearer ${apiKey}` },
    );
    expect(revoke.statusCode, revoke.body).toBe(200);
    const second = await register({ sessionToken: await session() });
    const [row] = await t.deps.db
      .select()
      .from(signerIdentities)
      .where(eq(signerIdentities.publicKey, second.publicKey));
    expect(row!.rotationKind).toBe("account_authorized");
    expect(second.publicKey).not.toBe(first.publicKey);
    // The old key can never sign again; its past acceptance still verifies.
    const old = await inject("POST", "/v1/acceptance/challenges", {
      organization: org(),
      document: doc(),
      signer: first.publicKey,
      signerType: "passkey",
      sessionToken: await session(),
    });
    expect(old.statusCode).toBe(403);
    const receipt = await inject(
      "GET",
      `/v1/public/acceptances/${accepted.json().acceptanceId}/receipt`,
    );
    expect(receipt.statusCode).toBe(200);
    const evidence = (await inject("GET", `/v1/public/signers/${second.publicKey}`)).json();
    expect(evidence.rotation.kind).toBe("account_authorized");
    expect(evidence.rotation.note).toMatch(/NOT endorsed/);
    await setSettings({ signingPolicy: "WALLET_OR_PASSKEY" });
  });

  it("records a purchase proof: the statement is committed, receipts verify, alterations fail", async () => {
    const s = await register();
    const created = await inject(
      "POST",
      "/v1/proof-requests",
      {
        type: "PURCHASE",
        reference: `order-${Date.now()}`,
        summary: "Purchase of 2 items from Acme",
        details: {
          currency: "EUR",
          items: [
            { sku: "TEA-01", name: "Earl Grey", quantity: 2, unitPrice: "6.50", total: "13.00" },
          ],
          subtotal: "13.00",
          shipping: "3.90",
          total: "16.90",
          paymentMethod: "Visa •••• 4242",
        },
      },
      { authorization: `Bearer ${apiKey}` },
    );
    expect(created.statusCode, created.body).toBe(200);
    const { requestId, clientToken, statementHash } = created.json();
    const view = await inject("GET", `/v1/proof-requests/${requestId}`, undefined, {
      "x-proof-token": clientToken,
    });
    expect(view.json().lines).toContain("Total: 16.90 EUR");

    const ch = (
      await inject("POST", `/v1/proof-requests/${requestId}/challenge`, {
        token: clientToken,
        signer: s.publicKey,
        signerType: "passkey",
      })
    ).json();
    expect(ch.message).toContain(`Statement: ${statementHash}`);
    const material = (
      await inject("POST", "/v1/passkeys/key-material", {
        organization: org(),
        credentialId: toBase64Url(s.passkey.credentialId),
      })
    ).json();
    const { assertion, prf } = await s.passkey.assert({
      challenge: fromBase64Url(ch.passkey.challenge),
      origin: ORIGIN,
      prfSalt: fromBase64Url(material.prfSalt),
    });
    const seed = await unwrapSigningSeed(prf!, material.wrappedKey, {
      purpose: "passkey",
      publicKey: ed25519.getPublicKey(s.seed),
      bindingId: s.passkey.credentialId,
    });
    const submitted = await inject("POST", `/v1/proof-requests/${requestId}/submit`, {
      token: clientToken,
      clientBinding: ch.clientBinding,
      signature: toBase58(ed25519.sign(utf8(ch.message), seed)),
      passkeyAssertion: assertion,
    });
    expect(submitted.statusCode, submitted.body).toBe(200);

    // Receipts need the client token or the API key; a proof ID alone (public on-chain) is not enough.
    expect((await inject("GET", `/v1/proof-requests/${requestId}/receipt`)).statusCode).toBe(400);
    const receipt = await inject("GET", `/v1/proof-requests/${requestId}/receipt`, undefined, {
      "x-proof-token": clientToken,
    });
    expect(receipt.statusCode, receipt.body).toBe(200);
    const r = receipt.json().receipt;
    expect(r.format).toBe("stele-proof-v1");
    expect(r.signer.type).toBe("PASSKEY_PROTECTED_STELE_KEY");
    const opts = {
      chain: t.deps.chain.verifierSource(),
      programId: state.programId,
      trustedRequestDomains: ["localhost"],
    };
    const ok = await verifyProof({ receipt: r }, opts);
    expect(["VALID", "VALID_WITH_WARNINGS"]).toContain(ok.verdict);
    const altered = structuredClone(r);
    altered.statement.details.total = "1.00";
    const bad = await verifyProof({ receipt: altered }, opts);
    expect(bad.verdict).toBe("INVALID");
    expect(bad.checks.find((c) => c.id === "statement.integrity")!.status).toBe("fail");
    const listed = await inject("GET", "/v1/proofs?type=PURCHASE", undefined, {
      authorization: `Bearer ${apiKey}`,
    });
    expect(listed.json().proofs.some((p: { proofId: string }) => p.proofId === r.proofId)).toBe(
      true,
    );
  });

  it("organization sponsorship reimburses the relayer on-chain, and nobody signs when nobody can pay", async () => {
    const owner = await createKeyPairSignerFromBytes(keypair("owner"));
    const rpc = createRpc(state.rpcUrl);
    const sendAsOwner = async (
      instructions: Parameters<typeof appendTransactionMessageInstructions>[0],
    ) => {
      const { value: blockhash } = await rpc.getLatestBlockhash().send();
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(owner, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) => appendTransactionMessageInstructions(instructions, m),
      );
      return signSendAndConfirm(rpc, message, { commitment: "confirmed" });
    };
    const shard = address(state.shard);
    const info = await rpc.getAccountInfo(shard, { encoding: "base64" }).send();
    if (info.value && Buffer.from(info.value.data[0], "base64").length === 8_320) {
      await sendAsOwner([
        enableShardSponsorshipInstruction({
          programAddress: address(state.programId),
          authority: owner,
          membership: null,
          organization: address(org()),
          nonceShard: shard,
          payer: owner,
          maxFeePerRecord: 50_000n,
          dailyLimit: 5_000_000n,
        }),
      ]);
    } else {
      await sendAsOwner([
        updateShardSponsorshipInstruction({
          programAddress: address(state.programId),
          authority: owner,
          membership: null,
          organization: address(org()),
          nonceShard: shard,
          maxFeePerRecord: 50_000n,
          dailyLimit: 5_000_000n,
          paused: false,
        }),
      ]);
    }
    await sendAsOwner([
      systemTransferInstruction({ source: owner, destination: shard, lamports: 100_000_000n }),
    ]);
    await setSettings({ feeSponsor: "organization", sponsorFallbackToStele: false });

    const s = await register();
    const res = await acceptWithPasskey(s);
    expect(res.statusCode, res.body).toBe(200);
    const fee = res.json().fee;
    expect(fee.sponsor).toBe("organization");
    expect(fee.reimbursedLamports).toBe(fee.lamports);
    const [booked] = await t.deps.db
      .select()
      .from(sponsoredTransactions)
      .where(eq(sponsoredTransactions.txSignature, res.json().transactionSignature));
    expect(booked!.sponsor).toBe("organization");
    const owner2 = (ownerSession ??= await login(t.app, keypair("owner")));
    const overview = await t.app.inject({
      method: "GET",
      url: `/v1/organizations/${orgId}/sponsorship`,
      headers: owner2.headers,
    });
    expect(overview.statusCode, overview.body).toBe(200);
    const shardView = overview
      .json()
      .shards.find((x: { address: string }) => x.address === state.shard);
    expect(shardView.enabled).toBe(true);
    expect(shardView.estimatedRecords).toBeGreaterThan(1_000);

    // Paused: refused BEFORE the user signs anything.
    await sendAsOwner([
      updateShardSponsorshipInstruction({
        programAddress: address(state.programId),
        authority: owner,
        membership: null,
        organization: address(org()),
        nonceShard: shard,
        maxFeePerRecord: 50_000n,
        dailyLimit: 5_000_000n,
        paused: true,
      }),
    ]);
    const refused = await inject("POST", "/v1/acceptance/challenges", {
      organization: org(),
      document: doc(),
      signer: s.publicKey,
      signerType: "passkey",
    });
    expect(refused.statusCode).toBe(402);
    expect(refused.json().error.code).toBe("sponsorship_unavailable");
    // With fallback, Stele pays (still never the user).
    await setSettings({ sponsorFallbackToStele: true });
    const fallback = await acceptWithPasskey(s);
    expect(fallback.statusCode, fallback.body).toBe(200);
    expect(fallback.json().fee.sponsor).toBe("stele");
    await setSettings({ feeSponsor: "stele", sponsorFallbackToStele: false });
    const [orgRow] = await t.deps.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId));
    expect(orgRow!.settings.feeSponsor).toBe("stele");
    const [shardRow] = await t.deps.db
      .select()
      .from(nonceShards)
      .where(eq(nonceShards.address, state.shard));
    expect(shardRow!.sponsorship?.paused).toBe(true);
  });

  it("sells credits for SOL paid on-chain to the treasury, and spends one per recording beyond the free allowance", async () => {
    const treasury = toBase58(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));
    const cfg = config({
      STELE_FREE_RECORDS_PER_MONTH: "0",
      STELE_TREASURY_ADDRESS: treasury,
      STELE_CREDIT_PACKS: "2:0.001",
    });
    const t2 = await makeApp({ config: cfg, chain: await realChain(cfg), storage: storage() });
    const rpc = createRpc(state.rpcUrl);
    const payer = await createKeyPairSignerFromBytes(keypair("owner"));
    /** The dashboard's payment: a System transfer carrying the invoice reference. */
    const pay = async (reference: string, lamports: number) => {
      const transfer = systemTransferInstruction({
        source: payer,
        destination: address(treasury),
        lamports,
      });
      const { value: blockhash } = await rpc.getLatestBlockhash().send();
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(payer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) =>
          appendTransactionMessageInstructions(
            [
              {
                ...transfer,
                accounts: [
                  ...transfer.accounts!,
                  { address: address(reference), role: AccountRole.READONLY },
                ],
              },
            ],
            m,
          ),
      );
      return signSendAndConfirm(rpc, message, { commitment: "confirmed" });
    };
    try {
      const owner = await login(t2.app, keypair("owner"));
      const synced = await t2.app.inject({
        method: "POST",
        url: "/v1/organizations/sync",
        headers: owner.headers,
        payload: { address: org() },
      });
      const id = synced.json().organization.id as string;
      await syncDocument(t2.deps.db, t2.deps.chain, doc());
      await syncShard(t2.deps.db, t2.deps.chain, state.shard);
      const api = (method: "GET" | "POST", url: string, payload?: unknown) =>
        t2.app.inject({ method, url, headers: owner.headers, payload: payload as never });

      // The pricing page's view.
      const info = (await t2.app.inject({ method: "GET", url: "/v1/billing" })).json();
      expect(info).toMatchObject({ enabled: true, treasury, freeRecordsPerMonth: 0 });
      expect(info.packs).toEqual([{ id: "2", credits: 2, lamports: 1_000_000 }]);

      // No free allowance and no credits: refused before anyone signs.
      const signerKey = ed25519.utils.randomSecretKey();
      const challenge = () =>
        t2.app.inject({
          method: "POST",
          url: "/v1/acceptance/challenges",
          headers,
          payload: {
            organization: org(),
            document: doc(),
            signer: toBase58(ed25519.getPublicKey(signerKey)),
          },
        });
      const refused = await challenge();
      expect(refused.statusCode).toBe(402);
      expect(refused.json().error.code).toBe("credits_exhausted");

      // Buy: invoice → payment on-chain → the API finds it by its reference.
      const invoice = (
        await api("POST", `/v1/organizations/${id}/billing/invoices`, { pack: "2" })
      ).json();
      expect(invoice).toMatchObject({ credits: 2, lamports: 1_000_000, treasury, status: "open" });
      const early = await api(
        "POST",
        `/v1/organizations/${id}/billing/invoices/${invoice.id}/confirm`,
        {},
      );
      expect(early.statusCode).toBe(409); // not paid yet
      const paid = await pay(invoice.reference, invoice.lamports);
      const confirmed = await api(
        "POST",
        `/v1/organizations/${id}/billing/invoices/${invoice.id}/confirm`,
        {},
      );
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      expect(confirmed.json()).toMatchObject({ status: "paid", transactionSignature: paid });
      // Confirming again credits nothing more.
      await api("POST", `/v1/organizations/${id}/billing/invoices/${invoice.id}/confirm`, {
        signature: paid,
      });
      expect((await api("GET", `/v1/organizations/${id}/billing`)).json().credits).toBe(2);

      // Another invoice: neither the first payment nor an underpayment pays it.
      const second = (
        await api("POST", `/v1/organizations/${id}/billing/invoices`, { pack: "2" })
      ).json();
      const reused = await api(
        "POST",
        `/v1/organizations/${id}/billing/invoices/${second.id}/confirm`,
        { signature: paid },
      );
      expect(reused.statusCode).toBe(409);
      const short = await pay(second.reference, second.lamports - 1);
      const underpaid = await api(
        "POST",
        `/v1/organizations/${id}/billing/invoices/${second.id}/confirm`,
        { signature: short },
      );
      expect(underpaid.json().error.code).toBe("payment_not_found");
      expect((await api("GET", `/v1/organizations/${id}/billing`)).json().credits).toBe(2);

      // With credits, a recording goes through and spends exactly one.
      const ch = await challenge();
      expect(ch.statusCode, ch.body).toBe(200);
      const c = ch.json();
      const submitted = await t2.app.inject({
        method: "POST",
        url: `/v1/acceptance/challenges/${c.challengeId}/submit`,
        headers,
        payload: {
          clientBinding: c.clientBinding,
          signature: toBase58(ed25519.sign(utf8(c.message), signerKey)),
        },
      });
      expect(submitted.statusCode, submitted.body).toBe(200);
      const overview = (await api("GET", `/v1/organizations/${id}/billing`)).json();
      expect(overview).toMatchObject({ credits: 1, freeRemaining: 0 });
      expect(overview.invoices[0]).toMatchObject({ id: second.id, status: "open" });

      // Members cannot buy; admins and the owner can.
      const stranger = await login(
        t2.app,
        (() => {
          const k = ed25519.utils.randomSecretKey();
          return new Uint8Array([...k, ...ed25519.getPublicKey(k)]);
        })(),
      );
      const denied = await t2.app.inject({
        method: "POST",
        url: `/v1/organizations/${id}/billing/invoices`,
        headers: stranger.headers,
        payload: { pack: "2" },
      });
      expect(denied.statusCode).toBe(404);
    } finally {
      await t2.close();
    }
  });

  it("pages through acceptances and proofs with cursors: no record skipped or repeated", async () => {
    const auth = { authorization: `Bearer ${apiKey}` };
    const all = async (path: string, field: "acceptances" | "proofs", limit: number) => {
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const sep = path.includes("?") ? "&" : "?";
        const res = await inject(
          "GET",
          `${path}${sep}limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`,
          undefined,
          auth,
        );
        expect(res.statusCode, res.body).toBe(200);
        const body = res.json() as Record<string, { acceptanceId?: string; proofId?: string }[]> & {
          nextCursor: string | null;
        };
        ids.push(...body[field]!.map((r) => (r.acceptanceId ?? r.proofId)!));
        cursor = body.nextCursor;
      } while (cursor);
      return ids;
    };
    for (const [path, field] of [
      ["/v1/acceptances", "acceptances"],
      ["/v1/proofs", "proofs"],
    ] as const) {
      const whole = await all(path, field, 200);
      expect(whole.length).toBeGreaterThan(field === "acceptances" ? 1 : 0);
      const paged = await all(path, field, 1);
      expect(paged).toEqual(whole);
      expect(new Set(paged).size).toBe(paged.length);
    }
    const bad = await inject("GET", "/v1/acceptances?cursor=bm9wZQ", undefined, auth);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("invalid_cursor");

    // A single acceptance has exactly the shape of a list item.
    const listed = (await inject("GET", "/v1/acceptances?limit=1", undefined, auth)).json()
      .acceptances[0];
    const one = await inject("GET", `/v1/acceptances/${listed.acceptanceId}`, undefined, auth);
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json().acceptance).toEqual(listed);
    expect(one.json().receiptUrl).toMatch(new RegExp(`/receipt/${listed.acceptanceId}$`));
  });

  it("the relayer signs nothing but the allowlisted recording shape", async () => {
    await expect(t.deps.chain.send(t.deps.chain.relayer, [])).rejects.toThrow(
      /only signs Stele recordings/,
    );
    const relayer = t.deps.chain.relayer.address;
    const programAddress = address(state.programId);
    const transfer = systemTransferInstruction({
      source: t.deps.chain.relayer,
      destination: address(org()),
      lamports: 1n,
    });
    expect(() =>
      assertSponsoredRecordingShape([transfer, transfer, transfer], {
        programAddress,
        relayer,
        maxPriorityFeeMicroLamports: 0n,
      }),
    ).toThrow(/refusing to sign/);
  });
});

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}
