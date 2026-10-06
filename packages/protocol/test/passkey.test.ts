import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import {
  buildKeyStatement,
  COSE_EDDSA,
  COSE_ES256,
  COSE_RS256,
  decodeRecoveryKit,
  encodeRecoveryKit,
  fromBase64Url,
  newRecoverySecret,
  originMatchesHost,
  parseKeyStatement,
  passkeySignatureChallenge,
  passkeyStatementChallenge,
  recoveryKitId,
  toBase58,
  toBase64Url,
  unwrapSigningSeed,
  verifyPasskeyAssertion,
  wrapSigningSeed,
} from "../src/index";
import { SoftPasskey } from "../src/testing";

const HOST = "shop.example";
const ORIGIN = `https://${HOST}`;
const message = "Stele Protocol v1 - Accept Agreement\n...example";

describe("passkey assertions", () => {
  for (const alg of [COSE_ES256, COSE_EDDSA, COSE_RS256]) {
    it(`verifies a user-verified assertion (COSE ${alg})`, async () => {
      const pk = await SoftPasskey.create(HOST, alg);
      const challenge = passkeySignatureChallenge(message);
      const { assertion } = await pk.assert({ challenge, origin: ORIGIN });
      const res = await verifyPasskeyAssertion(assertion, pk.credential, { challenge, host: HOST });
      expect(res).toMatchObject({ ok: true, origin: ORIGIN, signCount: 1 });
    });
  }

  it("rejects every deviation", async () => {
    const pk = await SoftPasskey.create(HOST);
    const challenge = passkeySignatureChallenge(message);
    const check = async (
      opts: Partial<Parameters<SoftPasskey["assert"]>[0]>,
      expect_: { host?: string; challenge?: Uint8Array; previousSignCount?: number } = {},
    ) => {
      const { assertion } = await pk.assert({ challenge, origin: ORIGIN, ...opts });
      return verifyPasskeyAssertion(assertion, pk.credential, {
        challenge: expect_.challenge ?? challenge,
        host: expect_.host ?? HOST,
        previousSignCount: expect_.previousSignCount,
      });
    };
    const reason = async (p: ReturnType<typeof check>) => {
      const r = await p;
      return r.ok ? "ok" : r.reason;
    };
    expect(await reason(check({ userVerified: false }))).toMatch(/user verification/);
    expect(await reason(check({ userPresent: false }))).toMatch(/presence/);
    expect(await reason(check({ origin: "https://evil.example" }))).toMatch(/evil\.example/);
    expect(await reason(check({ origin: `http://${HOST}` }))).toMatch(/not shop\.example/);
    expect(await reason(check({ crossOrigin: true }))).toMatch(/cross-origin/);
    expect(await reason(check({ type: "webauthn.create" }))).toMatch(/not an authentication/);
    expect(await reason(check({ rpId: "evil.example" }))).toMatch(/different relying party/);
    expect(
      await reason(check({}, { challenge: passkeySignatureChallenge(`${message}!`) })),
    ).toMatch(/different challenge/);
    expect(await reason(check({}, { host: "other.example" }))).toMatch(/not other\.example/);
    expect(await reason(check({}, { previousSignCount: 1_000 }))).toMatch(/counter/);

    // Tampered signature / authenticator data.
    const { assertion } = await pk.assert({ challenge, origin: ORIGIN });
    const sig = fromBase64Url(assertion.signature);
    sig[sig.length - 1] = sig[sig.length - 1]! ^ 1;
    const bad = { ...assertion, signature: toBase64Url(sig) };
    expect(
      await verifyPasskeyAssertion(bad, pk.credential, { challenge, host: HOST }),
    ).toMatchObject({ ok: false });
    // An assertion by another passkey.
    const other = await SoftPasskey.create(HOST);
    const foreign = (await other.assert({ challenge, origin: ORIGIN })).assertion;
    expect(
      await verifyPasskeyAssertion(
        { ...foreign, credentialId: assertion.credentialId },
        pk.credential,
        {
          challenge,
          host: HOST,
        },
      ),
    ).toMatchObject({ ok: false, reason: "passkey signature does not verify" });
  });

  it("accepts synced passkeys that always report a zero counter", async () => {
    const pk = await SoftPasskey.create(HOST);
    pk.zeroCounter = true;
    const challenge = passkeySignatureChallenge(message);
    const { assertion } = await pk.assert({ challenge, origin: ORIGIN });
    expect(
      await verifyPasskeyAssertion(assertion, pk.credential, {
        challenge,
        host: HOST,
        previousSignCount: 0,
      }),
    ).toMatchObject({ ok: true, signCount: 0 });
  });

  it("allows http only on localhost", () => {
    expect(originMatchesHost("http://localhost:4300", "localhost")).toBe(true);
    expect(originMatchesHost("http://shop.localhost:4300", "shop.localhost")).toBe(true);
    expect(originMatchesHost("http://shop.example", "shop.example")).toBe(false);
    expect(originMatchesHost("https://shop.example.evil.com", "shop.example")).toBe(false);
    expect(originMatchesHost("https://shop.example/path", "shop.example")).toBe(false);
  });
});

describe("key statements", () => {
  it("are canonical and bind the passkey's public key", async () => {
    const pk = await SoftPasskey.create(HOST);
    const seed = ed25519.utils.randomSecretKey();
    const key = toBase58(ed25519.getPublicKey(seed));
    const statement = buildKeyStatement({
      action: "REGISTER",
      organization: "D51xeCtimX5oJ8aMC3GxqVmmYa7xMnLUGgzq7WJVvdLF",
      key,
      passkey: {
        credentialId: pk.credential.credentialId,
        publicKey: pk.credential.publicKey,
        rpId: HOST,
      },
      chainId: "solana:localnet",
      issuedAt: 1_790_000_000,
    });
    const parsed = parseKeyStatement(statement);
    expect(parsed).toMatchObject({
      action: "REGISTER",
      key,
      rpId: HOST,
      credentialId: pk.credential.credentialId,
    });
    expect(() => parseKeyStatement(statement.replace("Key: ", "Key:  "))).toThrow();
    expect(() => parseKeyStatement(`${statement}\nKey: ${key}`)).toThrow();
    // Endorsement challenge is domain-separated from message signing.
    expect(toBase64Url(passkeyStatementChallenge(statement))).not.toBe(
      toBase64Url(passkeySignatureChallenge(statement)),
    );
    const rotation = buildKeyStatement({
      action: "ROTATE",
      organization: "D51xeCtimX5oJ8aMC3GxqVmmYa7xMnLUGgzq7WJVvdLF",
      key,
      previousKey: "11111111111111111111111111111111",
      passkey: {
        credentialId: pk.credential.credentialId,
        publicKey: pk.credential.publicKey,
        rpId: HOST,
      },
      chainId: "solana:localnet",
      issuedAt: 1_790_000_000,
    });
    expect(parseKeyStatement(rotation).previousKey).toBe("11111111111111111111111111111111");
  });
});

describe("key wrapping", () => {
  it("round-trips under the passkey PRF and fails closed otherwise", async () => {
    const pk = await SoftPasskey.create(HOST);
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const seed = ed25519.utils.randomSecretKey();
    const publicKey = ed25519.getPublicKey(seed);
    const bind = { purpose: "passkey" as const, publicKey, bindingId: pk.credentialId };
    const wrapped = await wrapSigningSeed(pk.prf(salt), seed, bind);
    expect(wrapped.ciphertext).not.toContain(toBase64Url(seed).slice(0, 10));
    expect(await unwrapSigningSeed(pk.prf(salt), wrapped, bind)).toEqual(seed);

    const otherPasskey = await SoftPasskey.create(HOST);
    await expect(unwrapSigningSeed(otherPasskey.prf(salt), wrapped, bind)).rejects.toThrow();
    await expect(
      unwrapSigningSeed(pk.prf(crypto.getRandomValues(new Uint8Array(32))), wrapped, bind),
    ).rejects.toThrow();
    // Re-attributing the blob to another credential or identity fails authentication.
    await expect(
      unwrapSigningSeed(pk.prf(salt), wrapped, { ...bind, bindingId: otherPasskey.credentialId }),
    ).rejects.toThrow();
    await expect(
      unwrapSigningSeed(pk.prf(salt), wrapped, {
        ...bind,
        publicKey: ed25519.getPublicKey(ed25519.utils.randomSecretKey()),
      }),
    ).rejects.toThrow();
    const ct = fromBase64Url(wrapped.ciphertext);
    ct[0] = ct[0]! ^ 1;
    await expect(
      unwrapSigningSeed(pk.prf(salt), { ...wrapped, ciphertext: toBase64Url(ct) }, bind),
    ).rejects.toThrow();
    // Passkey and recovery wraps use different key derivations.
    await expect(
      unwrapSigningSeed(pk.prf(salt), wrapped, { ...bind, purpose: "recovery" }),
    ).rejects.toThrow();
  });

  it("recovery kits encode, decode and detect typos", async () => {
    const secret = newRecoverySecret();
    const kit = encodeRecoveryKit(secret);
    expect(kit).toMatch(/^stele-rk1-([a-z2-7]{4}-){13}[a-z2-7]$/);
    expect(decodeRecoveryKit(kit)).toEqual(secret);
    expect(decodeRecoveryKit(` ${kit.toUpperCase()} `)).toEqual(secret);
    const typo = kit.slice(0, 12) + (kit[12] === "a" ? "b" : "a") + kit.slice(13);
    expect(() => decodeRecoveryKit(typo)).toThrow(/checksum|length/);
    expect(recoveryKitId(secret)).toMatch(/^[0-9a-f]{32}$/);

    const seed = ed25519.utils.randomSecretKey();
    const publicKey = ed25519.getPublicKey(seed);
    const bind = {
      purpose: "recovery" as const,
      publicKey,
      bindingId: Uint8Array.from(Buffer.from(recoveryKitId(secret), "hex")),
    };
    const wrapped = await wrapSigningSeed(secret, seed, bind);
    expect(await unwrapSigningSeed(decodeRecoveryKit(kit), wrapped, bind)).toEqual(seed);
  });
});
