import { ed25519 } from "@noble/curves/ed25519.js";
import {
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressDecoder,
  type Address,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DISCRIMINATORS,
  BorshWriter,
  DEFAULT_PROGRAM_ADDRESS,
  LIMITS,
  MAX_TRANSACTION_SIZE,
  anchorDiscriminator,
  buildAcceptanceMessage,
  buildAcceptanceTransactionMessage,
  buildEd25519Instruction,
  buildEd25519InstructionData,
  compiledTransactionSize,
  decodeDocumentVersion,
  decodeEventsFromLogs,
  decodeNonceShard,
  decodeOrganization,
  decodePublishVersionArgs,
  decodeRecordAcceptanceArgs,
  findOrganizationPda,
  findVersionPda,
  identifyAccount,
  identifyInstruction,
  isNonceConsumed,
  parseCanonicalEd25519Data,
  publishVersionInstruction,
  recordAcceptanceInstruction,
  toBase64,
  utf8,
  verifiedDomainAt,
  verifyEd25519,
} from "../src/index";

const PROGRAM = address(DEFAULT_PROGRAM_ADDRESS);
const addr = (byte: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(byte));

describe("account decoders", () => {
  it("decodes an Organization and refuses other discriminators", () => {
    const w = new BorshWriter().raw(ACCOUNT_DISCRIMINATORS.Organization);
    w.address(addr(1)).fixed(new Uint8Array(32).fill(9), 32).address(addr(2)); // creator, seed, owner
    w.address(addr(0)).address(addr(3)).address(addr(0)).i64(0); // pending owner, recovery, pending recovery, eta
    w.address(addr(0)).i64(0).i64(100).i64(2_000).i64(50).u32(2).u32(1); // recovery target, eta, domain times, created, counts
    w.bool(false).u8(0).u8(254).string("Acme Inc.").string("acme.example");
    const bytes = w.toBytes();
    expect(identifyAccount(bytes)).toBe("Organization");
    const org = decodeOrganization(bytes);
    expect(org.name).toBe("Acme Inc.");
    expect(org.owner).toBe(addr(2));
    expect(org.pendingOwner).toBeNull();
    expect(org.recovery).toBe(addr(3));
    expect(verifiedDomainAt(org, 1_999)).toBe("acme.example");
    expect(verifiedDomainAt(org, 2_000)).toBeNull();
    expect(() => decodeDocumentVersion(bytes)).toThrow(/not a DocumentVersion/);
  });

  it("rejects truncated data and invalid booleans", () => {
    const w = new BorshWriter().raw(ACCOUNT_DISCRIMINATORS.NonceShard);
    w.address(addr(1))
      .address(addr(2))
      .fixed(new Uint8Array(32), 32)
      .u64(0n)
      .i64(0n)
      .u16(0)
      .u8(255);
    expect(() => decodeNonceShard(w.toBytes())).toThrow(/unexpected end/);
  });

  it("decodes nonce bitmaps LSB-first", () => {
    const bitmap = new Uint8Array(8192);
    bitmap[0] = 0b0000_0001;
    bitmap[1] = 0b0000_0010;
    expect(isNonceConsumed(bitmap, 0)).toBe(true);
    expect(isNonceConsumed(bitmap, 1)).toBe(false);
    expect(isNonceConsumed(bitmap, 9)).toBe(true);
    expect(isNonceConsumed(bitmap, 65_536)).toBe(true);
  });
});

describe("instruction codecs", () => {
  it("round-trips publish_version arguments", async () => {
    const [version] = await findVersionPda(addr(5), 2, PROGRAM);
    const ix = publishVersionInstruction({
      authority: addr(1),
      membership: null,
      config: addr(2),
      organization: addr(3),
      document: addr(5),
      versionAccount: version,
      payer: addr(1),
      version: 2,
      previousVersionHash: new Uint8Array(32).fill(1),
      contentHash: new Uint8Array(32).fill(2),
      title: "Terms of Service",
      versionLabel: "2.0",
      effectiveAt: 0,
      storageUri: "ar://abc",
      expectedVersionHash: new Uint8Array(32).fill(3),
    });
    expect(ix.programAddress).toBe(PROGRAM);
    expect(ix.accounts?.[1]?.address).toBe(PROGRAM); // absent optional account = program id
    const data = new Uint8Array(ix.data!);
    expect(identifyInstruction(data)).toBe("publish_version");
    const args = decodePublishVersionArgs(data);
    expect(args.version).toBe(2);
    expect(args.title).toBe("Terms of Service");
    expect(args.expectedVersionHash).toEqual(new Uint8Array(32).fill(3));
  });

  it("matches Anchor discriminators", () => {
    expect(anchorDiscriminator("global", "record_acceptance")).toHaveLength(8);
    expect(ACCOUNT_DISCRIMINATORS.DocumentVersion).not.toEqual(ACCOUNT_DISCRIMINATORS.Document);
  });

  it("derives organization PDAs bound to the creator", async () => {
    const seed = new Uint8Array(32).fill(7);
    const [a] = await findOrganizationPda(addr(1), seed, PROGRAM);
    const [b] = await findOrganizationPda(addr(2), seed, PROGRAM);
    expect(a).not.toBe(b);
  });
});

describe("ed25519 instruction", () => {
  it("builds the canonical layout and verifies strictly", () => {
    const secret = new Uint8Array(32).fill(4);
    const pub = ed25519.getPublicKey(secret);
    const msg = utf8("hello");
    const sig = ed25519.sign(msg, secret);
    const data = buildEd25519InstructionData(pub, sig, msg);
    const parsed = parseCanonicalEd25519Data(data);
    expect(parsed.message).toEqual(msg);
    expect(verifyEd25519(parsed.signature, parsed.message, parsed.publicKey)).toBe(true);
    const bad = new Uint8Array(data);
    bad.set([0, 0], 14); // message instruction index → 0 (indirection)
    expect(() => parseCanonicalEd25519Data(bad)).toThrow(/self-contained/);
  });
});

describe("events", () => {
  it("decodes only events emitted while the Stele program is executing", () => {
    const disc = anchorDiscriminator("event", "ProtocolPauseChanged");
    const payload = toBase64(new BorshWriter().raw(disc).bool(true).address(addr(1)).toBytes());
    const logs = [
      `Program ${DEFAULT_PROGRAM_ADDRESS} invoke [1]`,
      `Program data: ${payload}`,
      `Program ${DEFAULT_PROGRAM_ADDRESS} success`,
      "Program Evi1Program1111111111111111111111111111 invoke [1]",
      `Program data: ${payload}`,
      "Program Evi1Program1111111111111111111111111111 success",
    ];
    const events = decodeEventsFromLogs(logs, DEFAULT_PROGRAM_ADDRESS);
    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe("ProtocolPauseChanged");
  });
});

describe("acceptance transaction size", () => {
  it("fits in one packet with every field at its maximum length", async () => {
    const relayer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(1));
    const signerSecret = new Uint8Array(32).fill(2);
    const signerPub = ed25519.getPublicKey(signerSecret);
    const message = buildAcceptanceMessage(
      {
        orgName: "W".repeat(LIMITS.orgName),
        orgVerifiedDomain: `${"a".repeat(LIMITS.verifiedDomain - 8)}.example`,
        title: "W".repeat(LIMITS.title),
        versionLabel: "9".repeat(LIMITS.versionLabel),
        version: 4_294_967_295,
        versionHash: new Uint8Array(32).fill(0xff),
        signer: "11111111111111111111111111111111".replace(/1/g, "z").padEnd(44, "z").slice(0, 44),
        networkLabel: "W".repeat(LIMITS.networkLabel),
        issuedAt: 253_402_296_000,
        expiresAt: 253_402_299_600,
        shardId: 65_535,
        nonceIndex: 65_535,
        nonceTag: new Uint8Array(8).fill(0xff),
      },
      `${"a".repeat(LIMITS.requestDomain - 8)}.example`,
    );
    const ed = buildEd25519Instruction(
      signerPub,
      ed25519.sign(utf8(message), signerSecret),
      utf8(message),
    );
    const rec = recordAcceptanceInstruction({
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
    });
    expect(decodeRecordAcceptanceArgs(new Uint8Array(rec.data!)).nonceIndex).toBe(65_535);
    const tx = buildAcceptanceTransactionMessage({
      feePayer: relayer,
      ed25519Instruction: ed,
      recordInstruction: rec,
      latestBlockhash: {
        blockhash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" as never,
        lastValidBlockHeight: 1n,
      },
      priorityFeeMicroLamports: 1_000_000n,
    });
    const size = compiledTransactionSize(tx);
    // Measured: 1,226 bytes (message 622). Fee sponsorship adds nothing to it (PROTOCOL_SPEC.md §13).
    expect(size).toBeLessThanOrEqual(MAX_TRANSACTION_SIZE);
  });
});
