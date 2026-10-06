import { ed25519 } from "@noble/curves/ed25519.js";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressDecoder,
  type Address,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  buildAcceptanceMessage,
  buildAcceptanceTransactionMessage,
  buildEd25519Instruction,
  buildProofMessage,
  checkCommerceTotals,
  compiledTransactionSize,
  decodeRecordProofArgs,
  decodeShardSponsorship,
  estimatedRecordings,
  formatSol,
  LIMITS,
  MAX_TRANSACTION_SIZE,
  parseStatement,
  PROOF_TYPES,
  recordAcceptanceInstruction,
  recordingFee,
  recordProofInstruction,
  NONCE_SHARD_ACCOUNT_SIZE,
  SPONSORED_NONCE_SHARD_ACCOUNT_SIZE,
  statementHash,
  utf8,
  vaultReimbursement,
  parseCommerceDetails,
} from "../src/index";

const addr = (byte: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(byte));
const blockhash = {
  blockhash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" as never,
  lastValidBlockHeight: 1n,
};
const longSigner = "z".repeat(44);
const longDomain = `${"a".repeat(LIMITS.requestDomain - 8)}.example`;

describe("worst-case transaction sizes", () => {
  it("the worst-case acceptance fits in one packet (sponsorship adds no account)", async () => {
    const relayer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(1));
    const secret = new Uint8Array(32).fill(2);
    const message = buildAcceptanceMessage(
      {
        orgName: "W".repeat(LIMITS.orgName),
        orgVerifiedDomain: `${"a".repeat(LIMITS.verifiedDomain - 8)}.example`,
        title: "W".repeat(LIMITS.title),
        versionLabel: "9".repeat(LIMITS.versionLabel),
        version: 4_294_967_295,
        versionHash: new Uint8Array(32).fill(0xff),
        signer: longSigner,
        networkLabel: "W".repeat(LIMITS.networkLabel),
        issuedAt: 253_402_296_000,
        expiresAt: 253_402_299_600,
        shardId: 65_535,
        nonceIndex: 65_535,
        nonceTag: new Uint8Array(8).fill(0xff),
      },
      longDomain,
    );
    const tx = buildAcceptanceTransactionMessage({
      feePayer: relayer,
      ed25519Instruction: buildEd25519Instruction(
        ed25519.getPublicKey(secret),
        ed25519.sign(utf8(message), secret),
        utf8(message),
      ),
      recordInstruction: recordAcceptanceInstruction({
        relayer,
        config: addr(2),
        organization: addr(3),
        document: addr(4),
        version: addr(5),
        nonceShard: addr(6),
        nonceIndex: 65_535,
        nonceTag: new Uint8Array(8),
        issuedAt: 0n,
        expiresAt: 0n,
      }),
      latestBlockhash: blockhash,
      priorityFeeMicroLamports: 1_000_000n,
    });
    const size = compiledTransactionSize(tx);
    expect(size).toBeLessThanOrEqual(MAX_TRANSACTION_SIZE);
  });

  it("the longest proof transaction fits, sponsored and with a priority fee", async () => {
    const relayer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(1));
    const secret = new Uint8Array(32).fill(2);
    const longest = PROOF_TYPES.reduce((a, b) => (b.label.length > a.label.length ? b : a));
    const message = buildProofMessage(
      {
        proofType: longest.code,
        orgName: "W".repeat(LIMITS.orgName),
        orgVerifiedDomain: `${"a".repeat(LIMITS.verifiedDomain - 8)}.example`,
        organization: longSigner,
        statementHash: new Uint8Array(32).fill(0xff),
        signer: longSigner,
        networkLabel: "W".repeat(LIMITS.networkLabel),
        chainId: `solana:${"z".repeat(32)}`,
        issuedAt: 253_402_296_000,
        expiresAt: 253_402_299_600,
        shardId: 65_535,
        nonceIndex: 65_535,
        nonceTag: new Uint8Array(8).fill(0xff),
      },
      longDomain,
    );
    const rec = recordProofInstruction({
      relayer,
      config: addr(2),
      organization: addr(3),
      nonceShard: addr(6),
      proofType: longest.code,
      statementHash: new Uint8Array(32).fill(0xff),
      nonceIndex: 65_535,
      nonceTag: new Uint8Array(8),
      issuedAt: 1n,
      expiresAt: 2n,
    });
    expect(decodeRecordProofArgs(new Uint8Array(rec.data!))).toMatchObject({
      proofType: longest.code,
      nonceIndex: 65_535,
    });
    const tx = buildAcceptanceTransactionMessage({
      feePayer: relayer,
      ed25519Instruction: buildEd25519Instruction(
        ed25519.getPublicKey(secret),
        ed25519.sign(utf8(message), secret),
        utf8(message),
      ),
      recordInstruction: rec,
      latestBlockhash: blockhash,
      priorityFeeMicroLamports: 1_000_000n,
    });
    expect(compiledTransactionSize(tx)).toBeLessThanOrEqual(MAX_TRANSACTION_SIZE);
  });
});

describe("fees", () => {
  it("matches the program's reimbursement formula", () => {
    expect(recordingFee({ computeUnitLimit: 60_000 })).toBe(10_000n);
    expect(recordingFee({ computeUnitLimit: 60_000, priorityFeeMicroLamports: 10_000 })).toBe(
      10_600n,
    );
    expect(recordingFee({ computeUnitLimit: 60_000, priorityFeeMicroLamports: 1 })).toBe(10_001n);
    expect(vaultReimbursement(10_600n, 6_000n)).toBe(6_000n);
    expect(estimatedRecordings(1_000_000_000n + 1_670_400n, 1_670_400n, 10_000n)).toBe(100_000n);
    expect(estimatedRecordings(1_000n, 1_670_400n, 10_000n)).toBe(0n);
    expect(formatSol(1_000_000_000n)).toBe("1");
    expect(formatSol(10_600n)).toBe("0.00001");
    expect(formatSol(0n)).toBe("0");
  });

  it("decodes the shard sponsorship trailer", () => {
    const plain = new Uint8Array(NONCE_SHARD_ACCOUNT_SIZE);
    expect(decodeShardSponsorship(plain)).toBeNull();
    const data = new Uint8Array(SPONSORED_NONCE_SHARD_ACCOUNT_SIZE);
    const t = NONCE_SHARD_ACCOUNT_SIZE;
    data.set(utf8("stelesp1"), t);
    const view = new DataView(data.buffer);
    view.setBigUint64(t + 40, 50_000n, true); // max_fee_per_record
    view.setBigUint64(t + 48, 1_000_000n, true); // daily_limit
    data[t + 112] = 1; // paused
    expect(decodeShardSponsorship(data)).toMatchObject({
      maxFeePerRecord: 50_000n,
      dailyLimit: 1_000_000n,
      paused: true,
    });
    data[t] = 0;
    expect(() => decodeShardSponsorship(data)).toThrow(/trailer/);
    expect(() => decodeShardSponsorship(new Uint8Array(t + 5))).toThrow(/size/);
  });
});

describe("statements", () => {
  const base = {
    format: "stele-statement-v1",
    type: "PURCHASE",
    network: {
      chainId: "solana:localnet",
      programId: "6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV",
    },
    organization: {
      address: "D51xeCtimX5oJ8aMC3GxqVmmYa7xMnLUGgzq7WJVvdLF",
      name: "Northwind Shop",
      domain: null,
    },
    reference: "order-1",
    createdAt: "2026-10-04T10:00:00Z",
    summary: "Purchase",
    details: {
      currency: "USD",
      items: [{ name: "Tea", quantity: 3, unitPrice: "2.50", total: "7.50" }],
      subtotal: "7.50",
      tax: "0.60",
      total: "8.10",
    },
    salt: "ab".repeat(32),
  };

  it("validates commerce details and totals", () => {
    const s = parseStatement(base);
    expect(checkCommerceTotals(parseCommerceDetails(s.details))).toBeNull();
    expect(checkCommerceTotals({ ...parseCommerceDetails(s.details), total: "8.11" })).toMatch(
      /total/,
    );
    expect(() => parseStatement({ ...base, details: { ...base.details, total: 8.1 } })).toThrow(
      /expected string/,
    );
    expect(() =>
      parseStatement({ ...base, details: { ...base.details, currency: "usd" } }),
    ).toThrow();
    expect(() => parseStatement({ ...base, type: "DOCUMENT_ACCEPTANCE" })).toThrow();
    expect(() => parseStatement({ ...base, extra: 1 })).toThrow();
    expect(() => parseStatement({ ...base, salt: "00" })).toThrow();
    // Non-commerce types carry free-form (but canonical) details.
    expect(
      parseStatement({
        ...base,
        type: "CONSENT",
        details: { purpose: "newsletter", granted: true },
      }).type,
    ).toBe("CONSENT");
    expect(() => parseStatement({ ...base, type: "CONSENT", details: { ratio: 0.5 } })).toThrow(
      /integers/,
    );
  });

  it("hashes differently for any change, including the salt", () => {
    const a = statementHash(parseStatement(base));
    const b = statementHash(parseStatement({ ...base, salt: "cd".repeat(32) }));
    const c = statementHash(parseStatement({ ...base, reference: "order-2" }));
    expect(new Set([a, b, c].map((x) => Buffer.from(x).toString("hex"))).size).toBe(3);
  });
});
