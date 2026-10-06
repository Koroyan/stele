/**
 * stele/2 native passkeys (P-256): the shared vectors from the TypeScript side (Rust checks the
 * same file), plus the edge cases of every helper the relayer and verifiers rely on.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { p256 } from "@noble/curves/nist.js";
import { describe, expect, it } from "vitest";
import {
  PASSKEY_ACCEPTANCE_TAG,
  PasskeyCheckFailure,
  RECEIPT_V2_FORMAT,
  buildPasskeyAcceptanceMessage,
  checkAuthenticatorData,
  checkClientData,
  checkPasskeyAssertion,
  compressP256PublicKey,
  concatBytes,
  describeFinding,
  fromHex,
  inspectContent,
  isP256KeyId,
  p256KeyFromId,
  p256KeyId,
  p256SignatureFromDer,
  parseAnyReceipt,
  parsePasskeyAcceptanceMessage,
  parseSecp256r1Instruction,
  passkeyAcceptanceId,
  secp256r1Instruction,
  sha256,
  toHex,
  utf8,
  verifyP256,
  webauthnChallenge,
} from "../src/index";

const dir = resolve(import.meta.dirname, "../../../spec/test-vectors");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vectors: any = JSON.parse(readFileSync(resolve(dir, "passkey-p256.json"), "utf8"));
const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

const code = (f: () => unknown): string => {
  try {
    f();
    return "ok";
  } catch (e) {
    return e instanceof PasskeyCheckFailure ? e.code : (e as Error).message;
  }
};

describe("stele/2 vectors (TypeScript side)", () => {
  it("messages, challenges, signatures and acceptance ids", () => {
    const signer = fromHex(vectors.signerPublicKey, 33);
    for (const c of vectors.acceptances) {
      const message = buildPasskeyAcceptanceMessage(
        {
          ...c.fields,
          versionHash: fromHex(c.fields.versionHash, 32),
          nonceTag: fromHex(c.fields.nonceTag, 8),
          signer,
        },
        c.requestDomain,
      );
      expect(message, c.name).toBe(c.message);
      const parsed = parsePasskeyAcceptanceMessage(message);
      expect(parsed.signer).toBe(vectors.signerPublicKey);
      expect(parsed.requestDomain).toBe(c.requestDomain);
      const challenge = webauthnChallenge(PASSKEY_ACCEPTANCE_TAG, message);
      expect(toHex(challenge)).toBe(c.challenge);
      const signed = fromHex(c.signedBytes, c.signedBytes.length / 2);
      expect(verifyP256(signer, fromHex(c.signature, 64), signed), c.name).toBe(true);
      const rpId = c.requestDomain === "localhost" ? "localhost" : vectors.rpId;
      const facts = checkPasskeyAssertion({
        signed,
        clientData: utf8(c.clientDataJSON),
        challenge,
        requestDomain: c.requestDomain,
        rpId,
      });
      expect(facts.origin).toBe(c.origin);
      expect(
        toHex(
          passkeyAcceptanceId(
            fromHex(c.versionAccount, 32),
            signer,
            sha256(utf8(message)),
            fromHex(c.signature, 64),
          ),
        ),
      ).toBe(c.acceptanceId);
    }
  });

  it("client data and authenticator data rules", () => {
    const checks = vectors.clientDataChecks;
    for (const c of checks.cases) {
      const outcome = code(() =>
        checkClientData(
          utf8(c.clientDataJSON),
          fromHex(checks.challenge, 32),
          checks.requestDomain,
        ),
      );
      expect(outcome, c.name).toBe(c.expected.ok !== undefined ? "ok" : c.expected.error);
    }
    for (const c of vectors.authenticatorDataChecks.cases) {
      const outcome = code(() =>
        checkAuthenticatorData(
          fromHex(c.authenticatorData, c.authenticatorData.length / 2),
          vectors.authenticatorDataChecks.rpId,
        ),
      );
      expect(outcome, c.name).toBe(c.expected.ok !== undefined ? "ok" : c.expected.error);
    }
  });
});

describe("stele/2 helpers", () => {
  const sk = p256.utils.randomSecretKey();
  const pub = p256.getPublicKey(sk, true);

  it("normalizes WebAuthn DER signatures to compact low-S, which the precompile requires", () => {
    const msg = utf8("authenticatorData ‖ clientDataHash");
    for (let i = 0; i < 16; i++) {
      const sig = p256.Signature.fromBytes(
        p256.sign(msg, sk, { prehash: true, lowS: true, format: "compact" }),
        "compact",
      );
      const high = new p256.Signature(sig.r, P256_ORDER - sig.s);
      for (const der of [sig.toBytes("der"), high.toBytes("der")]) {
        const compact = p256SignatureFromDer(der);
        expect(verifyP256(pub, compact, msg)).toBe(true);
        expect(p256.Signature.fromBytes(compact, "compact").hasHighS()).toBe(false);
      }
      // The high-S form itself is refused, as by the precompile.
      expect(verifyP256(pub, high.toBytes("compact"), msg)).toBe(false);
    }
    expect(() => p256SignatureFromDer(new Uint8Array(70))).toThrow();
  });

  it("compresses SPKI, uncompressed and compressed keys, and rejects points off the curve", () => {
    const spkiPrefix = fromHex("3059301306072a8648ce3d020106082a8648ce3d030107034200", 26);
    const uncompressed = p256.getPublicKey(sk, false);
    expect(compressP256PublicKey(concatBytes(spkiPrefix, uncompressed))).toEqual(pub);
    expect(compressP256PublicKey(uncompressed)).toEqual(pub);
    expect(compressP256PublicKey(pub)).toEqual(pub);
    const off = Uint8Array.from(uncompressed);
    off[64] = off[64]! ^ 1;
    expect(() => compressP256PublicKey(off)).toThrow();
    expect(() => compressP256PublicKey(concatBytes(new Uint8Array(26), uncompressed))).toThrow();
  });

  it("builds and parses only the canonical single-signature precompile layout", () => {
    const sig = new Uint8Array(64).fill(1);
    const message = utf8("signed bytes");
    const ix = secp256r1Instruction(pub, sig, message);
    const data = Uint8Array.from(ix.data!);
    expect(parseSecp256r1Instruction(data)).toEqual({ publicKey: pub, signature: sig, message });
    for (const [offset, value] of [
      [0, 2], // two signatures
      [1, 1], // padding
      [2, 50], // signature offset
      [4, 0], // signature from another instruction
      [8, 0], // key from another instruction
      [14, 0], // message from another instruction
    ] as const) {
      const bad = Uint8Array.from(data);
      bad[offset] = value;
      expect(parseSecp256r1Instruction(bad), `byte ${offset}`).toBeNull();
    }
    expect(parseSecp256r1Instruction(concatBytes(data, Uint8Array.of(0)))).toBeNull();
    expect(() => secp256r1Instruction(new Uint8Array(33), sig, message)).toThrow();
  });

  it("names P-256 signers unambiguously (never a Solana address)", () => {
    const id = p256KeyId(pub);
    expect(isP256KeyId(id)).toBe(true);
    expect(p256KeyFromId(id)).toEqual(pub);
    expect(isP256KeyId(`p256:04${toHex(pub).slice(2)}`)).toBe(false);
    expect(isP256KeyId("4N83mYciYoXGBTsQAvGHJZdYMcekHaucvuzJNkNkYuv7")).toBe(false);
  });

  it("parses stele-acceptance-v2 strictly (canonical form only)", () => {
    const c = vectors.acceptances[0];
    const ok = c.message as string;
    expect(() => parsePasskeyAcceptanceMessage(`${ok}\n`)).toThrow();
    expect(() =>
      parsePasskeyAcceptanceMessage(ok.replace("Signer: passkey-p256 ", "Signer: passkey-p256  ")),
    ).toThrow();
    expect(() =>
      parsePasskeyAcceptanceMessage(ok.replace("Stele Protocol v2", "Stele Protocol v1")),
    ).toThrow();
    expect(() =>
      parsePasskeyAcceptanceMessage(ok.replace(/Nonce: \S+/, "Nonce: 0-01-0123456789abcdef")),
    ).toThrow();
  });

  it("parses receipts of either format and rejects unknown fields", () => {
    expect(() => parseAnyReceipt({ format: RECEIPT_V2_FORMAT })).toThrow(/invalid receipt/);
    expect(() => parseAnyReceipt({ format: "stele-receipt-v1" })).toThrow(/invalid receipt/);
  });
});

describe("display safety of canonical content", () => {
  const content = (text: string) => ({
    blocks: [{ type: "paragraph" as const, text }],
    changeSummary: null,
  });
  it("reports invisible marks, look-alike words, links and pinned references", () => {
    const fp = "ab".repeat(32);
    const findings = inspectContent(
      content(
        `Pay ‏100 USD to Pаypal (see https://acme.example/fees.) and stele:version:${fp} with‍me`,
      ),
    );
    expect(findings.map((f) => f.kind)).toEqual([
      "BIDI_MARK",
      "JOINER",
      "MIXED_SCRIPT_WORD",
      "EXTERNAL_LINK",
      "PINNED_REFERENCE",
    ]);
    expect(findings[2]!.value).toBe("Pаypal");
    expect(findings[3]!.value).toBe("https://acme.example/fees");
    expect(findings[4]!.value).toBe(fp);
    expect(describeFinding(findings[0]!)).toContain("U+200F");
  });
  it("finds nothing in plain text of any script", () => {
    for (const text of ["Plain English terms.", "ქართული ტექსტი", "Русский текст", "日本語"])
      expect(inspectContent(content(text))).toEqual([]);
  });
});
