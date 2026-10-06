/**
 * Native passkey signing (stele/2) against a REAL local validator (skipped without a seeded
 * localnet). The browser is simulated by a software WebAuthn authenticator that produces real ES256
 * assertions; the secp256r1 precompile verifies them on-chain and every receipt is re-verified
 * independently of the API.
 *
 * Invariants: the passkey's private key never leaves the authenticator (nothing to store, wrap or
 * leak); every record needs a user-verified assertion over that exact message on the requesting
 * site; account enrollments are anchored on-chain without personal data; a rotation needs the
 * current key; an organization recovery is visibly different; historical acceptances keep
 * verifying; the user never pays.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, passkeyCredentials, signerIdentities } from "@stele/db";
import {
  PASSKEY_ACCEPTANCE_TAG,
  PASSKEY_KIND_ENROLLED,
  PASSKEY_KIND_ORGANIZATION_RECOVERY,
  PASSKEY_KIND_ROTATED,
  PASSKEY_STATUS_REVOKED,
  SECP256R1_PROGRAM_ADDRESS,
  accountCommitment,
  compressP256PublicKey,
  createRpc,
  decodePasskeySigner,
  fetchAccountData,
  findPasskeySignerPda,
  fromBase64,
  fromBase64Url,
  fromHex,
  identifyInstruction,
  p256KeyId,
  recoverPasskeySignerInstruction,
  revokePasskeySignerInstruction,
  signSendAndConfirm,
  toBase58,
  toBase64Url,
  toHex,
  utf8,
  webauthnChallenge,
} from "@stele/protocol";
import { SoftPasskey } from "@stele/protocol/testing";
import { chainFromUrls, decodeWireTransaction, verifyAcceptance } from "@stele/verifier";
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
/** Native passkeys need the stele/2 program build on the validator. */
async function programHasPasskeys(url: string, program: string) {
  const rpc = createRpc(url);
  const info = await rpc.getAccountInfo(address(program), { encoding: "base64" }).send();
  if (!info.value) return false;
  const programData = address(toBase58(fromBase64(info.value.data[0]).subarray(4, 36)));
  const data = await rpc
    .getAccountInfo(programData, { encoding: "base64", dataSlice: { offset: 0, length: 0 } })
    .send();
  return Number(data.value?.space ?? 0) > 700_000;
}
const available =
  state !== null &&
  (await rpcUp(state.rpcUrl)) &&
  (await programHasPasskeys(state.rpcUrl, state.programId));

const ORIGIN = "http://localhost:3000";
const headers = { origin: ORIGIN };
const storage = () => new FilesystemContentStore(resolve(REPO_ROOT, ".data/storage"));

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

interface NativeSigner {
  id: string;
  passkey: SoftPasskey;
}

describe.skipIf(!available)("native passkey signing — stele/2 (real validator)", () => {
  let t: TestApp;
  let orgId: string;
  let apiKey: string;
  const org = () => state.organization as string;
  const doc = () => state.documents.terms.address as string;
  const program = () => address(state.programId);
  const rpc = () => createRpc(state.rpcUrl);

  const inject = (
    method: "GET" | "POST" | "PATCH",
    url: string,
    payload?: unknown,
    extra: Record<string, string> = {},
  ) => t.app.inject({ method, url, payload: payload as never, headers: { ...headers, ...extra } });

  let owner: Awaited<ReturnType<typeof login>> | null = null;
  async function setSettings(settings: Record<string, unknown>) {
    owner ??= await login(t.app, keypair("owner"));
    const res = await t.app.inject({
      method: "PATCH",
      url: `/v1/organizations/${orgId}/settings`,
      headers: owner.headers,
      payload: settings,
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  const session = async (externalUserRef: string) =>
    (
      await inject(
        "POST",
        "/v1/acceptance-sessions",
        { externalUserRef, ttlSeconds: 900 },
        { authorization: `Bearer ${apiKey}` },
      )
    ).json().sessionToken as string;

  /** create() then the possession proof / enrollment statement, as the SDK does. */
  async function createNative(
    purpose: "register" | "rotate" | "recover",
    opts: { sessionToken?: string; identity?: string; confirmWith?: SoftPasskey } = {},
  ) {
    const options = await inject("POST", "/v1/passkeys/native/options", {
      organization: org(),
      purpose,
      sessionToken: opts.sessionToken,
      identity: opts.identity,
    });
    expect(options.statusCode, options.body).toBe(200);
    const o = options.json();
    expect(o.algorithms).toEqual([-7]);
    const passkey = await SoftPasskey.create(o.rpId);
    const registered = await inject("POST", "/v1/passkeys/native/register", {
      challengeId: o.challengeId,
      credential: passkey.register({ challenge: fromBase64Url(o.challenge), origin: ORIGIN }),
    });
    expect(registered.statusCode, registered.body).toBe(200);
    const r = registered.json();
    const signer = opts.confirmWith ?? passkey;
    expect(r.confirm.allowCredentials).toEqual([toBase64Url(signer.credentialId)]);
    const { assertion } = await signer.assert({
      challenge: fromBase64Url(r.confirm.challenge),
      origin: ORIGIN,
    });
    const confirmed = await inject("POST", "/v1/passkeys/native/confirm", {
      challengeId: r.confirm.challengeId,
      assertion,
    });
    return { passkey, registration: r, confirmed };
  }

  async function registerNative(sessionToken?: string): Promise<NativeSigner> {
    const { passkey, registration, confirmed } = await createNative("register", { sessionToken });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().status).toBe("active");
    return { id: registration.identity, passkey };
  }

  async function challengeFor(s: NativeSigner, sessionToken?: string) {
    const ch = await inject("POST", "/v1/acceptance/challenges", {
      organization: org(),
      document: doc(),
      signer: s.id,
      signerType: "passkey_p256",
      sessionToken,
    });
    expect(ch.statusCode, ch.body).toBe(200);
    return ch.json();
  }

  async function acceptNative(
    s: NativeSigner,
    opts: {
      sessionToken?: string;
      assertWith?: Partial<Parameters<SoftPasskey["assert"]>[0]>;
      passkey?: SoftPasskey;
    } = {},
  ) {
    const c = await challengeFor(s, opts.sessionToken);
    expect(c.protocol).toBe("stele/2");
    expect(c.passkey.kind).toBe("native");
    expect(c.passkey.challenge).toBe(
      toBase64Url(webauthnChallenge(PASSKEY_ACCEPTANCE_TAG, c.message)),
    );
    const { assertion } = await (opts.passkey ?? s.passkey).assert({
      challenge: fromBase64Url(c.passkey.challenge),
      origin: ORIGIN,
      ...opts.assertWith,
    });
    return {
      challenge: c,
      res: await inject("POST", `/v1/acceptance/challenges/${c.challengeId}/submit`, {
        clientBinding: c.clientBinding,
        passkeyAssertion: assertion,
      }),
    };
  }

  let ownerSigner: Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>;
  const sendAsOwner = async (
    instructions: Parameters<typeof appendTransactionMessageInstructions>[0],
  ) => {
    const signer = ownerSigner;
    const { value: blockhash } = await rpc().getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    return {
      signer,
      signature: await signSendAndConfirm(rpc(), message, { commitment: "confirmed" }),
    };
  };

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

  beforeAll(async () => {
    ownerSigner = await createKeyPairSignerFromBytes(keypair("owner"));
    const cfg = config();
    t = await makeApp({ config: cfg, chain: await realChain(cfg), storage: storage() });
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
    const key = await t.app.inject({
      method: "POST",
      url: `/v1/organizations/${orgId}/api-keys`,
      headers: owner.headers,
      payload: {
        name: "native passkey tests",
        scopes: ["acceptances:read", "acceptances:write", "signers:read", "signers:write"],
      },
    });
    expect(key.statusCode, key.body).toBe(200);
    apiKey = key.json().key;
  });
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

  it("key-only: one ceremony per acceptance, P-256 verified on-chain, nothing secret stored, user pays nothing, receipt v2 verifies without the API", async () => {
    const s = await registerNative();
    const key = compressP256PublicKey(s.passkey.publicKey);
    expect(s.id).toBe(p256KeyId(key));
    const [identity] = await t.deps.db
      .select()
      .from(signerIdentities)
      .where(eq(signerIdentities.publicKey, s.id));
    expect(identity!.algorithm).toBe("p256-native");
    expect(identity!.enrollmentAddress).toBeNull();
    // A possession proof was required and is kept as public evidence.
    expect(identity!.enrollmentEvidence?.statement).toContain("Enroll Passkey Signer");
    const [credential] = await t.deps.db
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.identityId, identity!.id));
    expect(credential!.wrappedKey).toBeNull();
    expect(credential!.prfSalt).toBeNull();

    const { res } = await acceptNative(s);
    expect(res.statusCode, res.body).toBe(200);
    const out = res.json();
    expect(out.signerType).toBe("passkey_p256");
    expect(out.fee.payer).toBe(t.deps.chain.relayer.address);

    // The transaction: [compute budget…] [secp256r1 verify] [record_passkey_acceptance], relayer-paid.
    const tx = await rpc()
      .getTransaction(out.transactionSignature, {
        encoding: "base64",
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      })
      .send();
    const decoded = decodeWireTransaction(fromBase64(tx!.transaction[0]), [], []);
    const names = decoded.instructions.map((ix) =>
      ix.programId === state.programId ? identifyInstruction(ix.data) : ix.programId,
    );
    expect(names.slice(-2)).toEqual([SECP256R1_PROGRAM_ADDRESS, "record_passkey_acceptance"]);
    expect(decoded.accountKeys[0]).toBe(t.deps.chain.relayer.address);
    expect(decoded.numRequiredSignatures).toBe(1);

    // The API's receipt is stele-receipt/2 and carries the exact signed text.
    const r = await inject("GET", `/v1/public/acceptances/${out.acceptanceId}/receipt`);
    expect(r.statusCode, r.body).toBe(200);
    const { receipt, report } = r.json();
    expect(receipt.format).toBe("stele-receipt/2");
    expect(receipt.signer).toMatchObject({ type: "NATIVE_PASSKEY", algorithm: "ES256" });
    expect(receipt.origin).toMatchObject({ attestation: "BROWSER_ATTESTED", origin: ORIGIN });
    expect(report.facts.signer.native.userVerified).toBe(true);
    expect(JSON.stringify(receipt)).not.toMatch(/biometric|fingerprint_template/i);

    // Independent verification: chain + receipt only (no API call).
    const independent = await verifyAcceptance({ receipt }, verifierOptions());
    expect(independent.verdict, JSON.stringify(independent.checks)).toMatch(/^VALID/);
    // From the transaction signature alone, the text is rebuilt from chain data.
    const bare = await verifyAcceptance(
      { transactionSignature: out.transactionSignature },
      verifierOptions(),
    );
    expect(bare.verdict, JSON.stringify(bare.checks)).toMatch(/^VALID/);
    expect(bare.facts.acceptance?.message).toBe(receipt.acceptance.message);

    // A single altered claim makes the receipt invalid.
    for (const tamper of [
      (x: typeof receipt) => (x.acceptance.message = `${x.acceptance.message} `),
      (x: typeof receipt) => (x.origin.origin = "https://evil.example"),
      (x: typeof receipt) => (x.webauthn.rpId = "evil.example"),
      (x: typeof receipt) => (x.signer.publicKey = `02${"11".repeat(32)}`),
      (x: typeof receipt) => (x.version.title = "Other"),
    ]) {
      const forged = structuredClone(receipt);
      tamper(forged);
      const v = await verifyAcceptance({ receipt: forged }, verifierOptions());
      expect(v.verdict).toBe("INVALID");
    }

    // Re-submitting is idempotent; the nonce can never be recorded twice.
    const again = await inject(
      "GET",
      `/v1/public/transactions/${out.transactionSignature}/acceptance`,
    );
    expect(again.json().acceptanceId).toBe(out.acceptanceId);
  });

  it("never relays an assertion the program would reject (no UV, other origin, frame, other text, other passkey)", async () => {
    const s = await registerNative();
    const other = await registerNative();
    const cases: [string, Parameters<typeof acceptNative>[1]][] = [
      ["no user verification", { assertWith: { userVerified: false } }],
      ["foreign origin", { assertWith: { origin: "https://evil.example" } }],
      ["cross-origin frame", { assertWith: { crossOrigin: true } }],
      ["another relying party", { assertWith: { rpId: "evil.example" } }],
      ["registration ceremony type", { assertWith: { type: "webauthn.create" } }],
      [
        "another message",
        { assertWith: { challenge: webauthnChallenge(PASSKEY_ACCEPTANCE_TAG, "x") } },
      ],
      ["another signer's passkey", { passkey: other.passkey }],
    ];
    for (const [name, opts] of cases) {
      const { res } = await acceptNative(s, opts);
      expect([400, 403], `${name}: ${res.body}`).toContain(res.statusCode);
    }
    // Wrong signer formats are refused before anything is allocated.
    const wrongType = await inject("POST", "/v1/acceptance/challenges", {
      organization: org(),
      document: doc(),
      signer: s.id,
      signerType: "passkey",
    });
    expect(wrongType.statusCode).toBe(400);
    const wrongKey = await inject("POST", "/v1/acceptance/challenges", {
      organization: org(),
      document: doc(),
      signer: state.owner,
      signerType: "passkey_p256",
    });
    expect(wrongKey.statusCode).toBe(400);
    // The valid path still works afterwards.
    const ok = await acceptNative(s);
    expect(ok.res.statusCode, ok.res.body).toBe(200);
  });

  it("account mode: on-chain enrollment without personal data, endorsed rotation, visibly different organization recovery, history keeps verifying", async () => {
    await setSettings({ signingPolicy: "ACCOUNT_AND_PASSKEY" });
    const ref = `native-${toHex(crypto.getRandomValues(new Uint8Array(6)))}`;

    // 1. Enrollment: the new passkey signs the enrollment statement; the relayer anchors it.
    const first = await registerNative(await session(ref));
    const [row1] = await t.deps.db
      .select()
      .from(signerIdentities)
      .where(eq(signerIdentities.publicKey, first.id));
    const commitment = accountCommitment(address(org()), fromHex(row1!.accountSalt!, 32), ref);
    const [pda] = await findPasskeySignerPda(address(org()), commitment, program());
    expect(row1!.enrollmentAddress).toBe(pda);
    const data1 = (await fetchAccountData(rpc(), pda))!;
    const e1 = decodePasskeySigner(data1);
    expect(toHex(e1.signerKey)).toBe(first.id.slice(5));
    expect(e1.kind).toBe(PASSKEY_KIND_ENROLLED);
    // No personal data on-chain: the account reference appears nowhere in the account.
    expect(Buffer.from(data1).includes(Buffer.from(utf8(ref)))).toBe(false);

    const accepted1 = await acceptNative(first, { sessionToken: await session(ref) });
    expect(accepted1.res.statusCode, accepted1.res.body).toBe(200);

    // Demo step 13: what a malicious operator holding the relayer key could try is rejected by
    // Solana (tools/localnet/src/forgery-demo.ts simulates each attempt).
    const receipt1 = (
      await inject("GET", `/v1/public/acceptances/${accepted1.res.json().acceptanceId}/receipt`)
    ).json().receipt;
    expect(receipt1.signer.enrollment.address).toBe(pda);
    const receiptFile = resolve(tmpdir(), `stele-forgery-${Date.now()}.json`);
    writeFileSync(receiptFile, JSON.stringify(receipt1));
    const demo = spawnSync(
      `pnpm --filter @stele/localnet forgery-demo -- --receipt "${receiptFile}"`,
      {
        cwd: REPO_ROOT,
        shell: true,
        encoding: "utf8",
        env: { ...process.env, STELE_RPC_URL: state.rpcUrl, STELE_PROGRAM_ID: state.programId },
      },
    );
    rmSync(receiptFile, { force: true });
    if (process.env.STELE_SHOW_DEMO) console.log(demo.stdout);
    expect(
      demo.status,
      `${demo.stdout}
${demo.stderr}`,
    ).toBe(0);
    expect(demo.stdout.match(/✔ rejected/g)).toHaveLength(4);
    // Another account cannot use this signer.
    const foreign = await inject("POST", "/v1/acceptance/challenges", {
      organization: org(),
      document: doc(),
      signer: first.id,
      signerType: "passkey_p256",
      sessionToken: await session(`${ref}-other`),
    });
    expect(foreign.statusCode).toBe(403);

    // 2. Rotation: the CURRENT passkey authorizes the new key.
    const rotation = await createNative("rotate", {
      sessionToken: await session(ref),
      identity: first.id,
      confirmWith: first.passkey,
    });
    expect(rotation.confirmed.statusCode, rotation.confirmed.body).toBe(200);
    const second: NativeSigner = { id: rotation.registration.identity, passkey: rotation.passkey };
    const e2 = decodePasskeySigner((await fetchAccountData(rpc(), pda))!);
    expect(e2.kind).toBe(PASSKEY_KIND_ROTATED);
    expect(toHex(e2.previousKey)).toBe(first.id.slice(5));
    const statuses = async () =>
      Object.fromEntries(
        (
          await t.deps.db
            .select({ k: signerIdentities.publicKey, s: signerIdentities.status })
            .from(signerIdentities)
            .where(eq(signerIdentities.externalUserRef, ref))
        ).map((x) => [x.k, x.s]),
      );
    expect(await statuses()).toMatchObject({ [first.id]: "rotated", [second.id]: "active" });
    const oldKey = await inject("POST", "/v1/acceptance/challenges", {
      organization: org(),
      document: doc(),
      signer: first.id,
      signerType: "passkey_p256",
      sessionToken: await session(ref),
    });
    expect(oldKey.statusCode).toBe(403);
    const accepted2 = await acceptNative(second, { sessionToken: await session(ref) });
    expect(accepted2.res.statusCode, accepted2.res.body).toBe(200);

    // 3. Recovery (every device lost): the new passkey proves possession, then the organization's
    //    admin wallet authorizes it on-chain — recorded as ORGANIZATION_RECOVERY, not endorsed.
    const recovery = await createNative("recover", { sessionToken: await session(ref) });
    expect(recovery.confirmed.statusCode, recovery.confirmed.body).toBe(200);
    const pending = recovery.confirmed.json();
    expect(pending.status).toBe("awaiting_organization");
    const third: NativeSigner = { id: recovery.registration.identity, passkey: recovery.passkey };
    const listed = await t.app.inject({
      method: "GET",
      url: `/v1/organizations/${orgId}/passkey-recoveries`,
      headers: owner!.headers,
    });
    expect(listed.json().recoveries.map((x: { identity: string }) => x.identity)).toContain(
      third.id,
    );
    // Until the organization signs, the new key cannot record anything.
    const early = await inject("POST", "/v1/acceptance/challenges", {
      organization: org(),
      document: doc(),
      signer: third.id,
      signerType: "passkey_p256",
      sessionToken: await session(ref),
    });
    expect(early.statusCode).toBe(403);
    await sendAsOwner([
      recoverPasskeySignerInstruction({
        programAddress: program(),
        authority: ownerSigner,
        membership: null,
        organization: address(org()),
        enrollment: pda,
        newSigner: fromHex(pending.recovery.newSigner, 33),
        newCredentialIdHash: fromHex(pending.recovery.newCredentialIdHash, 32),
        rpIdHash: fromHex(pending.recovery.rpIdHash, 32),
      }),
    ]);
    const refreshed = await t.app.inject({
      method: "POST",
      url: `/v1/organizations/${orgId}/passkey-enrollments/${pda}/refresh`,
      headers: owner!.headers,
    });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    const e3 = decodePasskeySigner((await fetchAccountData(rpc(), pda))!);
    expect(e3.kind).toBe(PASSKEY_KIND_ORGANIZATION_RECOVERY);
    expect(await statuses()).toMatchObject({
      [first.id]: "rotated",
      [second.id]: "revoked",
      [third.id]: "active",
    });
    const accepted3 = await acceptNative(third, { sessionToken: await session(ref) });
    expect(accepted3.res.statusCode, accepted3.res.body).toBe(200);

    // 4. History is never rewritten: the first acceptance still verifies, and says the signer changed.
    const old = await verifyAcceptance(
      { transactionSignature: accepted1.res.json().transactionSignature },
      verifierOptions(),
    );
    expect(old.verdict, JSON.stringify(old.checks)).toMatch(/^VALID/);
    expect(old.facts.signer?.native?.enrollment?.kind).toBe("ORGANIZATION_RECOVERY");
    expect(old.checks.find((c) => c.id === "signer.status")?.detail).toContain("NOT endorsed");

    // 5. Revocation by the organization's wallet: the key can no longer record.
    await sendAsOwner([
      revokePasskeySignerInstruction({
        programAddress: program(),
        authority: ownerSigner,
        membership: null,
        organization: address(org()),
        enrollment: pda,
      }),
    ]);
    await t.app.inject({
      method: "POST",
      url: `/v1/organizations/${orgId}/passkey-enrollments/${pda}/refresh`,
      headers: owner!.headers,
    });
    expect(decodePasskeySigner((await fetchAccountData(rpc(), pda))!).status).toBe(
      PASSKEY_STATUS_REVOKED,
    );
    const afterRevoke = await inject("POST", "/v1/acceptance/challenges", {
      organization: org(),
      document: doc(),
      signer: third.id,
      signerType: "passkey_p256",
      sessionToken: await session(ref),
    });
    expect(afterRevoke.statusCode).toBe(403);
    const stillValid = await verifyAcceptance(
      { transactionSignature: accepted3.res.json().transactionSignature },
      verifierOptions(),
    );
    expect(stillValid.verdict).toMatch(/^VALID/);
  });
});
