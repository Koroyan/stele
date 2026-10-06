import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acceptanceId,
  accumulate,
  buildAcceptanceMessage,
  buildProofMessage,
  commitmentFor,
  openCommitment,
  parseCanonicalStatement,
  parseProofMessage,
  parseStatement,
  proofId,
  serializeStatement,
  statementHash,
  canonicalizeContent,
  contentHash,
  formatRfc3339,
  fromBase58,
  fromHex,
  fromUtf8,
  messageHash,
  normalizeInline,
  normalizeText,
  parseAcceptanceMessage,
  parseCanonicalContent,
  serializeContent,
  sha256Hex,
  toHex,
  utf8,
  verifyEd25519,
  versionHash,
  versionJson,
  type ContentInput,
} from "../src/index";

const dir = resolve(import.meta.dirname, "../../../spec/test-vectors");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (name: string): any => JSON.parse(readFileSync(resolve(dir, name), "utf8"));

function outcome(f: () => string): { ok: string } | { error: string } {
  try {
    return { ok: f() };
  } catch (e) {
    return { error: (e as { code: string }).code };
  }
}

describe("shared test vectors (regression guard; Rust reproduces the same bytes)", () => {
  it("anchor: SHA-256('abc')", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("text normalization", () => {
    for (const c of load("text-normalization.json").cases) {
      expect(
        outcome(() => normalizeText(c.input)),
        c.name,
      ).toEqual(c.text);
      expect(
        outcome(() => normalizeInline(c.input)),
        c.name,
      ).toEqual(c.inline);
    }
  });

  it("content canonicalization and hashing", () => {
    const v = load("content.json");
    for (const c of v.cases) {
      const canonical = canonicalizeContent(c.input as ContentInput);
      const bytes = serializeContent(canonical);
      expect(fromUtf8(bytes), c.name).toBe(c.canonical);
      expect(toHex(contentHash(bytes)), c.name).toBe(c.contentHash);
      expect(parseCanonicalContent(bytes)).toEqual(canonical);
    }
    for (const c of v.invalidCanonical) {
      expect(() => parseCanonicalContent(utf8(c.bytes)), c.name).toThrow();
    }
  });

  it("version fingerprints", () => {
    for (const c of load("version.json").cases) {
      const f = c.fields;
      const fields = {
        ...f,
        previousVersionHash: f.previousVersionHash ? fromHex(f.previousVersionHash) : null,
        contentHash: fromHex(f.contentHash),
      };
      expect(versionJson(fields), c.name).toBe(c.json);
      expect(toHex(versionHash(fields)), c.name).toBe(c.versionHash);
    }
  });

  it("network separation changes the fingerprint", () => {
    const [v1, , mainnet] = load("version.json").cases;
    expect(v1.versionHash).not.toBe(mainnet.versionHash);
  });

  it("RFC 3339", () => {
    const v = load("rfc3339.json");
    for (const c of v.cases) expect(formatRfc3339(c.timestamp)).toBe(c.formatted);
    for (const t of v.invalid) expect(() => formatRfc3339(t)).toThrow();
    expect(formatRfc3339(951_782_400)).toBe("2000-02-29T00:00:00Z");
  });

  it("acceptance messages, signatures and strict parsing", () => {
    const v = load("acceptance-message.json");
    const pub = fromHex(v.signerPublicKey, 32);
    for (const c of v.cases) {
      const f = c.fields;
      const message = buildAcceptanceMessage(
        { ...f, versionHash: fromHex(f.versionHash, 32), nonceTag: fromHex(f.nonceTag, 8) },
        c.requestDomain,
      );
      expect(message, c.name).toBe(c.message);
      expect(toHex(messageHash(message))).toBe(c.messageHash);
      expect(verifyEd25519(fromHex(c.signature, 64), utf8(message), pub)).toBe(true);
      expect(toHex(fromBase58(f.signer))).toBe(v.signerPublicKey);
      const parsed = parseAcceptanceMessage(message);
      expect(parsed.orgName).toBe(f.orgName);
      expect(parsed.orgVerifiedDomain).toBe(f.orgVerifiedDomain);
      expect(parsed.version).toBe(f.version);
      expect(parsed.requestDomain).toBe(c.requestDomain);
      // One flipped byte anywhere invalidates the signature.
      const tampered = utf8(message.replace("Version:", "Versi0n:"));
      expect(verifyEd25519(fromHex(c.signature, 64), tampered, pub)).toBe(false);
    }
  });

  it("acceptance ids and the accumulator chain", () => {
    const v = load("acceptance-id.json");
    let acc: Uint8Array = new Uint8Array(32);
    for (const step of v.chain) {
      const id = acceptanceId(
        fromHex(v.version),
        fromHex(v.signer),
        fromHex(step.messageHash),
        fromHex(step.signature),
      );
      expect(toHex(id)).toBe(step.acceptanceId);
      acc = accumulate(acc, id);
      expect(toHex(acc)).toBe(step.accumulatorAfter);
    }
  });

  it("proof anchor messages, signatures, proof ids and strict parsing", () => {
    const v = load("proof-message.json");
    const pub = fromHex(v.signerPublicKey, 32);
    for (const c of v.cases) {
      const f = c.fields;
      const message = buildProofMessage(
        { ...f, statementHash: fromHex(f.statementHash, 32), nonceTag: fromHex(f.nonceTag, 8) },
        c.requestDomain,
      );
      expect(message, c.name).toBe(c.message);
      expect(toHex(messageHash(message))).toBe(c.messageHash);
      const signature = fromHex(c.signature, 64);
      expect(verifyEd25519(signature, utf8(message), pub)).toBe(true);
      const id = proofId(
        fromBase58(f.organization),
        pub,
        fromHex(f.statementHash, 32),
        messageHash(message),
        signature,
      );
      expect(toHex(id)).toBe(c.proofId);
      const parsed = parseProofMessage(message);
      expect(parsed.proofType).toBe(f.proofType);
      expect(parsed.organization).toBe(f.organization);
      expect(parsed.chainId).toBe(f.chainId);
      expect(() => parseProofMessage(message.replace("Type: ", "Type:  "))).toThrow();
      expect(() => parseAcceptanceMessage(message)).toThrow();
    }
  });

  it("statements serialize canonically and commitments open", () => {
    const v = load("statement.json");
    const s = parseStatement(v.statement);
    expect(fromUtf8(serializeStatement(s))).toBe(v.canonical);
    expect(toHex(statementHash(s))).toBe(v.statementHash);
    expect(sha256Hex(v.canonical)).toBe(v.statementHash);
    expect(parseCanonicalStatement(utf8(v.canonical))).toEqual(s);
    // Whitespace or key order changes are rejected, not silently re-hashed.
    expect(() => parseCanonicalStatement(utf8(JSON.stringify(v.statement, null, 1)))).toThrow();
    expect(commitmentFor(v.commitment.value, v.commitment.salt)).toBe(v.commitment.commitment);
    expect(openCommitment(v.commitment.commitment, v.commitment)).toBe(true);
    expect(
      openCommitment(v.commitment.commitment, { ...v.commitment, value: "other@example.com" }),
    ).toBe(false);
  });
});
