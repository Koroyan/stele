/**
 * Stele Gate codecs: the access-pass layout, the requirement rule (the same one `check_access`
 * applies on-chain), instruction encodings, and the `stele-gate` crate's error table — checked
 * against the Rust sources so the two cannot drift apart.
 */
import { readFileSync } from "node:fs";
import { address, type Address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  ACCESS_PASS_ACCOUNT_SIZE,
  ACCOUNT_DISCRIMINATORS,
  BorshWriter,
  GATE_DEMO_PROGRAM_ADDRESS,
  GATE_ERRORS,
  INSTRUCTION_DISCRIMINATORS,
  checkAccessInstruction,
  decodeAccessPass,
  decodeBetPlacedFromLogs,
  decodeRecordAcceptanceArgs,
  evaluateAccess,
  findAccessPassPda,
  placeBetInstruction,
  programErrorCode,
  recordGatedAcceptanceInstruction,
  toBase64,
  anchorDiscriminator,
  type AccessPassAccount,
  type DocumentAccount,
} from "../src";

// Deterministic distinct addresses from well-known base58 strings.
const DOC = address("DaYu7vm4jHXpgzKoNnEDeUh6tHLg2S6zrqN1HwbvduAk");
const V1 = address("62MUTiTEn3TZ7saEEMfuxN9Jmdfvy9sp8a4TgVCcakni");
const V2 = address("J7PSmEZuiAHPU2yxXXmu14Pe1tfA9XFvmnoajytgbDnq");
const ALICE = address("C6q9uiQsmxy5E2hx3hjv1i36i98vXvtBF35Hfq54GJ4p");
const MALLORY = address("EdLvTmdNWYU4fy4nWKcqB6s5jrDcGbqKsjpyYXg8Zg1f");

function crateSource(): string {
  return readFileSync(new URL("../../../crates/stele-gate/src/lib.rs", import.meta.url), "utf8");
}

function documentAccount(current: Address, count: number): DocumentAccount {
  return {
    organization: ALICE,
    createdBy: ALICE,
    headHash: new Uint8Array(32),
    currentVersion: current,
    createdAt: 0n,
    lastPublishedAt: 0n,
    versionCount: count,
    bump: 255,
    slug: "risk",
    documentType: "risk-disclosure",
    locale: "en-US",
  } as DocumentAccount;
}

function pass(version: Address, versionNumber: number, holder: Address = ALICE): AccessPassAccount {
  return {
    organization: ALICE,
    document: DOC,
    holder,
    version,
    acceptanceId: new Uint8Array(32).fill(7),
    acceptedAt: 10n,
    firstAcceptedAt: 10n,
    acceptedSlot: 5n,
    versionNumber,
    acceptanceCount: 1,
    bump: 254,
  };
}

describe("access passes", () => {
  it("decodes the program's layout (201 bytes)", () => {
    expect(ACCESS_PASS_ACCOUNT_SIZE).toBe(201);
    const w = new BorshWriter()
      .raw(ACCOUNT_DISCRIMINATORS.AccessPass)
      .address(ALICE)
      .address(DOC)
      .address(MALLORY)
      .address(V2)
      .fixed(new Uint8Array(32).fill(9), 32)
      .i64(1_790_000_100)
      .i64(1_790_000_000)
      .u64(42)
      .u32(2)
      .u32(3)
      .u8(253);
    const bytes = w.toBytes();
    expect(bytes.length).toBe(ACCESS_PASS_ACCOUNT_SIZE);
    const p = decodeAccessPass(bytes);
    expect(p).toMatchObject({
      organization: ALICE,
      document: DOC,
      holder: MALLORY,
      version: V2,
      acceptedAt: 1_790_000_100n,
      firstAcceptedAt: 1_790_000_000n,
      acceptedSlot: 42n,
      versionNumber: 2,
      acceptanceCount: 3,
      bump: 253,
    });
    // The discriminator matches the stele-gate crate's constant.
    const crate = crateSource();
    const m = crate.match(/ACCESS_PASS_DISCRIMINATOR: \[u8; 8\] = \[([^\]]+)\]/);
    expect(m?.[1]?.split(",").map((x) => Number(x.trim()))).toEqual([
      ...ACCOUNT_DISCRIMINATORS.AccessPass,
    ]);
    expect(() => decodeAccessPass(new Uint8Array(201))).toThrow();
  });

  it("applies the current-version rule exactly like check_access", async () => {
    const [accessPass] = await findAccessPassPda(DOC, ALICE);
    const base = { document: DOC, holder: ALICE, accessPass };
    // Never accepted.
    expect(
      evaluateAccess({ ...base, documentAccount: documentAccount(V1, 1), pass: null }).status,
    ).toBe("MISSING");
    // Accepted v1 while v1 is current.
    expect(
      evaluateAccess({ ...base, documentAccount: documentAccount(V1, 1), pass: pass(V1, 1) })
        .status,
    ).toBe("VALID");
    // v2 published: the v1 pass is outdated — unless the requirement is "v1 or later".
    const afterV2 = { ...base, documentAccount: documentAccount(V2, 2), pass: pass(V1, 1) };
    expect(evaluateAccess(afterV2).status).toBe("OUTDATED");
    expect(evaluateAccess({ ...afterV2, requirement: { minVersion: 1 } }).status).toBe("VALID");
    expect(evaluateAccess({ ...afterV2, requirement: { minVersion: 2 } }).status).toBe("OUTDATED");
    expect(evaluateAccess(afterV2).requiredVersionNumber).toBe(2);
    // Someone else's pass is no pass at all.
    expect(
      evaluateAccess({
        ...base,
        documentAccount: documentAccount(V1, 1),
        pass: pass(V1, 1, MALLORY),
      }).status,
    ).toBe("MISSING");
  });
});

describe("Gate instructions", () => {
  it("encodes record_gated_acceptance with the record_acceptance arguments", async () => {
    const [accessPass] = await findAccessPassPda(DOC, ALICE);
    const ix = recordGatedAcceptanceInstruction({
      relayer: MALLORY,
      config: V1,
      organization: V2,
      document: DOC,
      version: V1,
      nonceShard: V2,
      holder: ALICE,
      accessPass,
      nonceIndex: 7,
      nonceTag: new Uint8Array(8).fill(0x5a),
      issuedAt: 1_790_000_000,
      expiresAt: 1_790_000_600,
    });
    expect([...ix.data!.subarray(0, 8)]).toEqual([
      ...INSTRUCTION_DISCRIMINATORS.record_gated_acceptance,
    ]);
    expect(ix.accounts).toHaveLength(10);
    expect(ix.accounts![6]!.address).toBe(ALICE);
    expect(ix.accounts![7]!.address).toBe(accessPass);
    expect(decodeRecordAcceptanceArgs(ix.data!)).toMatchObject({ nonceIndex: 7 });
  });

  it("encodes check_access like the stele-gate crate", () => {
    const ix = checkAccessInstruction({
      document: DOC,
      accessPass: V1,
      holder: ALICE,
      minVersion: 4,
    });
    const crate = crateSource();
    const m = crate.match(/CHECK_ACCESS_DISCRIMINATOR: \[u8; 8\] = \[([^\]]+)\]/);
    expect([...ix.data!.subarray(0, 8)]).toEqual(m?.[1]?.split(",").map((x) => Number(x.trim())));
    expect([...ix.data!.subarray(8)]).toEqual([4, 0, 0, 0]);
    expect(ix.accounts!.map((a) => a.role)).toEqual([0, 0, 2]); // readonly, readonly, readonly signer
  });

  it("builds both bet paths of the demo program", () => {
    const check = placeBetInstruction({
      bettor: ALICE,
      market: V1,
      policyDocument: DOC,
      accessPass: V2,
      side: 1,
      stake: 100,
    });
    expect(check.programAddress).toBe(GATE_DEMO_PROGRAM_ADDRESS);
    expect(check.accounts).toHaveLength(4);
    expect([...check.data!.subarray(0, 8)]).toEqual([
      ...anchorDiscriminator("global", "place_bet"),
    ]);
    const strict = placeBetInstruction({
      bettor: ALICE,
      market: V1,
      policyDocument: DOC,
      accessPass: V2,
      side: 0,
      stake: 5,
      strict: true,
    });
    expect(strict.accounts).toHaveLength(5);
    expect([...strict.data!.subarray(0, 8)]).toEqual([
      ...anchorDiscriminator("global", "place_bet_strict"),
    ]);
    // side u8 + stake u64
    expect(strict.data!.length).toBe(8 + 1 + 8);
  });

  it("decodes BetPlaced events from logs", () => {
    const data = new BorshWriter()
      .raw(anchorDiscriminator("event", "BetPlaced"))
      .address(V1)
      .address(ALICE)
      .address(V2)
      .u32(2)
      .u64(100)
      .u64(100)
      .u64(0)
      .u64(1)
      .u64(77)
      .u8(1)
      .bool(true)
      .toBytes();
    const events = decodeBetPlacedFromLogs([
      "Program log: Instruction: PlaceBetStrict",
      `Program data: ${toBase64(data)}`,
    ]);
    expect(events).toEqual([
      expect.objectContaining({ bettor: ALICE, policyVersionNumber: 2, stake: 100n, strict: true }),
    ]);
  });
});

describe("errors", () => {
  it("lists the stele-gate crate's error codes", () => {
    const crate = crateSource();
    const [, body = ""] = crate.split(/pub enum GateError\s*\{/);
    const entries = [...body.matchAll(/^\s*(\w+)\s*=\s*(\d+),/gm)].map((m) => [Number(m[2]), m[1]]);
    expect(entries.length).toBe(9);
    expect(GATE_ERRORS.map(([code, name]) => [code, name])).toEqual(entries);
  });

  it("gives the Gate program errors stable codes", () => {
    expect(programErrorCode("AccessPassMissing")).toBeGreaterThan(6000);
    expect(programErrorCode("AccessPassOutdated")).toBe(programErrorCode("AccessPassMissing") + 1);
  });
});
