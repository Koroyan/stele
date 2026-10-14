/**
 * Stele Gate codecs: the access-pass and policy layouts, the requirement rule (the same one
 * `stele_gate::require_current` applies on-chain), instruction encodings, and the `stele-gate`
 * crate's error table — checked against the Rust sources so the two cannot drift apart.
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
  GATE_POLICY_ACCOUNT_SIZE,
  INSTRUCTION_DISCRIMINATORS,
  anchorDiscriminator,
  createPolicyInstruction,
  decodeAccessPass,
  decodeDepositedFromLogs,
  decodePassportDepositedFromLogs,
  decodeGatePolicy,
  decodeRecordAcceptanceArgs,
  depositInstruction,
  evaluateAccess,
  findAccessPassPda,
  findPolicyPda,
  programErrorCode,
  recordGatedAcceptanceInstruction,
  setPolicyRequirementInstruction,
  toBase64,
  type AccessPassAccount,
  type GatePolicyAccount,
} from "../src";

// Distinct, valid addresses.
const DOC = address("DaYu7vm4jHXpgzKoNnEDeUh6tHLg2S6zrqN1HwbvduAk");
const V1 = address("62MUTiTEn3TZ7saEEMfuxN9Jmdfvy9sp8a4TgVCcakni");
const V2 = address("J7PSmEZuiAHPU2yxXXmu14Pe1tfA9XFvmnoajytgbDnq");
const ORG = address("G6yAicQw734JiFyJJP6HFyEwpJVhwrFRFDZp3YwhN61Q");
const ALICE = address("C6q9uiQsmxy5E2hx3hjv1i36i98vXvtBF35Hfq54GJ4p");
const MALLORY = address("EdLvTmdNWYU4fy4nWKcqB6s5jrDcGbqKsjpyYXg8Zg1f");
const H1 = new Uint8Array(32).fill(1);
const H2 = new Uint8Array(32).fill(2);

function crateSource(): string {
  return readFileSync(new URL("../../../crates/stele-gate/src/lib.rs", import.meta.url), "utf8");
}

function crateBytes(name: string): number[] | undefined {
  const m = crateSource().match(new RegExp(`${name}: \\[u8; 8\\] = \\[([^\\]]+)\\]`));
  return m?.[1]?.split(",").map((x) => Number(x.trim()));
}

function policy(required: number, hash: Uint8Array): GatePolicyAccount {
  return {
    organization: ORG,
    document: DOC,
    requiredVersionHash: hash,
    updatedBy: ALICE,
    createdAt: 1n,
    updatedAt: 2n,
    requiredVersion: required,
    bump: 255,
  };
}

function pass(
  versionNumber: number,
  versionHash: Uint8Array,
  holder: Address = ALICE,
  version: Address = V1,
): AccessPassAccount {
  return {
    organization: ORG,
    document: DOC,
    holder,
    version,
    versionHash,
    acceptanceId: new Uint8Array(32).fill(7),
    acceptedAt: 10n,
    firstAcceptedAt: 10n,
    acceptedSlot: 5n,
    versionNumber,
    acceptanceCount: 1,
    bump: 254,
  };
}

describe("accounts", () => {
  it("decodes the access pass layout (233 bytes)", () => {
    expect(ACCESS_PASS_ACCOUNT_SIZE).toBe(233);
    const bytes = new BorshWriter()
      .raw(ACCOUNT_DISCRIMINATORS.AccessPass)
      .address(ORG)
      .address(DOC)
      .address(MALLORY)
      .address(V2)
      .fixed(H2, 32)
      .fixed(new Uint8Array(32).fill(9), 32)
      .i64(1_790_000_100)
      .i64(1_790_000_000)
      .u64(42)
      .u32(2)
      .u32(3)
      .u8(253)
      .toBytes();
    expect(bytes.length).toBe(ACCESS_PASS_ACCOUNT_SIZE);
    expect(decodeAccessPass(bytes)).toMatchObject({
      organization: ORG,
      document: DOC,
      holder: MALLORY,
      version: V2,
      versionHash: H2,
      acceptedAt: 1_790_000_100n,
      versionNumber: 2,
      acceptanceCount: 3,
      bump: 253,
    });
    expect(crateBytes("ACCESS_PASS_DISCRIMINATOR")).toEqual([...ACCOUNT_DISCRIMINATORS.AccessPass]);
    expect(crateSource()).toContain(`ACCESS_PASS_LEN: usize = ${ACCESS_PASS_ACCOUNT_SIZE};`);
  });

  it("decodes the policy layout (157 bytes)", () => {
    expect(GATE_POLICY_ACCOUNT_SIZE).toBe(157);
    const bytes = new BorshWriter()
      .raw(ACCOUNT_DISCRIMINATORS.GatePolicy)
      .address(ORG)
      .address(DOC)
      .fixed(H2, 32)
      .address(ALICE)
      .i64(100)
      .i64(200)
      .u32(2)
      .u8(250)
      .toBytes();
    expect(bytes.length).toBe(GATE_POLICY_ACCOUNT_SIZE);
    expect(decodeGatePolicy(bytes)).toMatchObject({
      organization: ORG,
      document: DOC,
      requiredVersionHash: H2,
      requiredVersion: 2,
      bump: 250,
    });
    expect(crateBytes("POLICY_DISCRIMINATOR")).toEqual([...ACCOUNT_DISCRIMINATORS.GatePolicy]);
    expect(crateSource()).toContain(`POLICY_LEN: usize = ${GATE_POLICY_ACCOUNT_SIZE};`);
    expect(() => decodeGatePolicy(new Uint8Array(157))).toThrow();
  });
});

describe("the requirement rule (require_current)", () => {
  it("matches the program's decisions", async () => {
    const [accessPass] = await findAccessPassPda(DOC, ALICE);
    const [policyAddress] = await findPolicyPda(DOC);
    const ev = (p: GatePolicyAccount, a: AccessPassAccount | null, holder: Address = ALICE) =>
      evaluateAccess({ policy: policyAddress, policyAccount: p, holder, accessPass, pass: a })
        .status;
    expect(ev(policy(1, H1), null)).toBe("MISSING");
    expect(ev(policy(1, H1), pass(1, H1))).toBe("VALID");
    // A newer accepted version satisfies an older requirement.
    expect(ev(policy(1, H1), pass(2, H2, ALICE, V2))).toBe("VALID");
    // The organization requires v2: the v1 pass is outdated.
    expect(ev(policy(2, H2), pass(1, H1))).toBe("OUTDATED");
    // Same number, different fingerprint: not the required text.
    expect(ev(policy(2, H2), pass(2, H1, ALICE, V2))).toBe("OUTDATED");
    // Someone else's pass is no pass at all.
    expect(ev(policy(1, H1), pass(1, H1, MALLORY), ALICE)).toBe("MISSING");
  });
});

describe("instructions", () => {
  it("encodes record_gated_acceptance with the record_acceptance arguments", async () => {
    const [accessPass] = await findAccessPassPda(DOC, ALICE);
    const ix = recordGatedAcceptanceInstruction({
      relayer: MALLORY,
      config: V1,
      organization: ORG,
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
    expect(decodeRecordAcceptanceArgs(new Uint8Array(ix.data!))).toMatchObject({ nonceIndex: 7 });
  });

  it("encodes the policy instructions (no arguments)", async () => {
    const [policyAddress] = await findPolicyPda(DOC);
    const common = {
      authority: ALICE,
      membership: null,
      config: V1,
      organization: ORG,
      document: DOC,
      version: V2,
      policy: policyAddress,
    };
    const create = createPolicyInstruction({ ...common, payer: ALICE });
    expect([...create.data!]).toEqual([...INSTRUCTION_DISCRIMINATORS.create_policy]);
    expect(create.accounts).toHaveLength(9);
    const set = setPolicyRequirementInstruction(common);
    expect([...set.data!]).toEqual([...INSTRUCTION_DISCRIMINATORS.set_policy_requirement]);
    expect(set.accounts).toHaveLength(7);
  });

  it("builds the demo vault's deposit", () => {
    const ix = depositInstruction({
      investor: ALICE,
      vault: V1,
      policy: V2,
      accessPass: DOC,
      amount: 5_000_000_000n,
    });
    expect(ix.programAddress).toBe(GATE_DEMO_PROGRAM_ADDRESS);
    expect(ix.accounts).toHaveLength(4);
    expect([...ix.data!.subarray(0, 8)]).toEqual([...anchorDiscriminator("global", "deposit")]);
    expect(ix.data!.length).toBe(8 + 8);
  });

  it("decodes Deposited events from logs", () => {
    const data = new BorshWriter()
      .raw(anchorDiscriminator("event", "Deposited"))
      .address(V1)
      .address(ALICE)
      .u64(5_000_000_000)
      .u64(5_000_000_000)
      .u64(1)
      .address(V2)
      .u32(2)
      .fixed(H2, 32)
      .fixed(H1, 32)
      .u64(77)
      .toBytes();
    expect(
      decodeDepositedFromLogs([
        "Program log: Instruction: Deposit",
        `Program data: ${toBase64(data)}`,
      ]),
    ).toEqual([
      expect.objectContaining({ investor: ALICE, termsVersionNumber: 2, amount: 5_000_000_000n }),
    ]);
  });

  it("decodes PassportDeposited events from logs, and only those", () => {
    const data = new BorshWriter()
      .raw(anchorDiscriminator("event", "PassportDeposited"))
      .address(V1)
      .address(ALICE)
      .u64(5_000_000_000)
      .u64(10_000_000_000)
      .u64(2)
      .u32(3)
      .i64(1_790_000_000)
      .toBytes();
    const logs = [
      "Program log: Instruction: DepositWithPassport",
      `Program data: ${toBase64(data)}`,
    ];
    expect(decodePassportDepositedFromLogs(logs)).toEqual([
      {
        vault: V1,
        investor: ALICE,
        amount: 5_000_000_000n,
        totalDeposited: 10_000_000_000n,
        depositCount: 2n,
        termsVersionNumber: 3,
        acceptedAt: 1_790_000_000n,
      },
    ]);
    expect(decodeDepositedFromLogs(logs)).toEqual([]);
  });
});

describe("errors", () => {
  it("lists the stele-gate crate's error codes", () => {
    const [, body = ""] = crateSource().split(/pub enum GateError\s*\{/);
    const entries = [...body.matchAll(/^\s*(\w+)\s*=\s*(\d+),/gm)].map((m) => [Number(m[2]), m[1]]);
    expect(entries.length).toBe(7);
    expect(GATE_ERRORS.map(([code, name]) => [code, name])).toEqual(entries);
  });

  it("gives the Gate program errors stable codes", () => {
    expect(programErrorCode("AccessPassMismatch")).toBeGreaterThan(6000);
    expect(programErrorCode("InvalidPolicyRequirement")).toBe(
      programErrorCode("AccessPassMismatch") + 1,
    );
  });
});
