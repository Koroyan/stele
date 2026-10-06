import { describe, expect, it } from "vitest";
import { parseReceipt } from "../src/index";

const hex = (c: string) => c.repeat(64);
const b58 = "6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV";

const valid = {
  format: "stele-receipt-v1",
  acceptanceId: hex("a"),
  network: { chainId: "solana:localnet", label: "Solana Localnet", programId: b58 },
  transaction: { signature: "5".repeat(87), slot: 10, blockTime: 1_790_000_000 },
  acceptance: {
    signer: b58,
    message: "Stele Protocol v1 - Accept Agreement",
    messageHash: hex("b"),
    signature: "4".repeat(87),
    issuedAt: 1,
    expiresAt: 2,
    nonce: { shardId: 0, index: 1, tag: "0123456789abcdef" },
    requestDomain: "app.acme.example",
  },
  organization: { address: b58, name: "Acme Inc.", verifiedDomain: null },
  document: { address: b58, slug: "terms", documentType: "terms-of-service", locale: "en" },
  version: {
    address: b58,
    number: 1,
    label: "1.0",
    title: "Terms",
    versionHash: hex("c"),
    contentHash: hex("d"),
    previousVersionHash: null,
    effectiveAt: null,
    publishedAt: 1,
    publishedSlot: 1,
    storageUri: "ar://x",
  },
  generatedAt: "2026-09-28T00:00:00Z",
};

describe("receipt schema", () => {
  it("accepts a well-formed receipt", () => {
    expect(parseReceipt(valid).acceptanceId).toBe(hex("a"));
  });

  it("rejects unknown fields, bad hashes and wrong formats", () => {
    expect(() => parseReceipt({ ...valid, extra: 1 })).toThrow();
    expect(() => parseReceipt({ ...valid, acceptanceId: "XYZ" })).toThrow(/acceptanceId/);
    expect(() => parseReceipt({ ...valid, format: "stele-receipt-v0" })).toThrow(/format/);
  });
});
