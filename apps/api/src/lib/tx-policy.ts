/**
 * Transaction allowlist for the sponsoring relayer. The relayer key pays fees, so it must never sign
 * anything but the exact shape of a Stele recording:
 *
 *   [SetComputeUnitLimit ≤ cap] [SetComputeUnitPrice ≤ cap]? [precompile, canonical] [Stele ix]
 *
 * with the relayer as the only signer and fee payer, and exactly these precompile / instruction
 * pairs:
 *
 *   Ed25519    → record_acceptance | record_gated_acceptance | record_proof         (stele/1)
 *   secp256r1  → record_passkey_acceptance | enroll_passkey_signer | rotate_passkey_signer (stele/2)
 *
 * or a batch anchor, which carries no signature to verify on-chain (MERKLE_BATCHED):
 *
 *   [SetComputeUnitLimit ≤ cap] [SetComputeUnitPrice ≤ cap]? [anchor_acceptance_batch]
 *
 * There is no API that signs anything else; this check is the last line of defence against a bug
 * that would assemble something different. (Organization recovery and revocation of passkey
 * signers are signed by the organization's own wallet, never by the relayer.)
 */
import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from "@solana-program/compute-budget";
import type { Address, Instruction } from "@solana/kit";
import {
  ED25519_PROGRAM_ADDRESS,
  identifyInstruction,
  parseCanonicalEd25519Data,
  parseSecp256r1Instruction,
  SECP256R1_PROGRAM_ADDRESS,
  type InstructionName,
} from "@stelehq/protocol";

/** Stele instructions the relayer may sign, by the precompile that must precede them. */
const ALLOWED: Record<string, readonly InstructionName[]> = {
  [ED25519_PROGRAM_ADDRESS]: ["record_acceptance", "record_gated_acceptance", "record_proof"],
  [SECP256R1_PROGRAM_ADDRESS]: [
    "record_passkey_acceptance",
    "enroll_passkey_signer",
    "rotate_passkey_signer",
  ],
};

export const MAX_SPONSORED_COMPUTE_UNITS = 100_000;

export class TransactionPolicyError extends Error {
  constructor(message: string) {
    super(`refusing to sign: ${message}`);
    this.name = "TransactionPolicyError";
  }
}

export function assertSponsoredRecordingShape(
  instructions: readonly Instruction[],
  opts: { programAddress: Address; relayer: Address; maxPriorityFeeMicroLamports: bigint },
): void {
  const fail = (why: string): never => {
    throw new TransactionPolicyError(why);
  };
  const record = instructions[instructions.length - 1];
  const isAnchor =
    record?.programAddress === opts.programAddress &&
    identifyInstruction(new Uint8Array(record.data ?? [])) === "anchor_acceptance_batch";
  const fixed = isAnchor ? 1 : 2;
  if (instructions.length < fixed + 1 || instructions.length > fixed + 2)
    fail("unexpected instruction count");
  const budget = instructions.slice(0, -fixed);
  checkBudget(budget, opts, fail);
  if (isAnchor) {
    const signers = (record!.accounts ?? []).filter((a) => a.role >= 2);
    if (signers.length !== 1 || signers[0]!.address !== opts.relayer)
      fail("the relayer must be the only signer");
    return;
  }
  const precompile = instructions[instructions.length - 2]!;

  checkPrecompileAndRecord(record!, precompile, opts, fail);
}

function checkBudget(
  budget: readonly Instruction[],
  opts: { maxPriorityFeeMicroLamports: bigint },
  fail: (why: string) => never,
): void {
  // Compute budget: a limit, then optionally a price; nothing else.
  budget.forEach((ix, i) => {
    if (ix.programAddress !== COMPUTE_BUDGET_PROGRAM_ADDRESS) fail("unexpected program");
    if (ix.accounts && ix.accounts.length > 0) fail("compute-budget instruction with accounts");
    const data = ix.data ?? new Uint8Array();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (i === 0) {
      if (data.length !== 5 || data[0] !== 2)
        fail("first instruction must set the compute-unit limit");
      if (view.getUint32(1, true) > MAX_SPONSORED_COMPUTE_UNITS)
        fail("compute-unit limit too high");
    } else {
      if (data.length !== 9 || data[0] !== 3)
        fail("second instruction must set the compute-unit price");
      if (view.getBigUint64(1, true) > opts.maxPriorityFeeMicroLamports)
        fail("priority fee too high");
    }
  });
}

function checkPrecompileAndRecord(
  record: Instruction,
  precompile: Instruction,
  opts: { programAddress: Address; relayer: Address },
  fail: (why: string) => never,
): void {
  // Exactly one canonical, self-contained signature verification.
  const allowed = ALLOWED[precompile.programAddress];
  if (!allowed) fail("missing signature verification");
  if (precompile.accounts && precompile.accounts.length > 0)
    fail("precompile instruction with accounts");
  const data = new Uint8Array(precompile.data ?? []);
  if (precompile.programAddress === ED25519_PROGRAM_ADDRESS) {
    try {
      parseCanonicalEd25519Data(data);
    } catch {
      fail("non-canonical Ed25519 instruction");
    }
  } else if (!parseSecp256r1Instruction(data)) {
    fail("non-canonical secp256r1 instruction");
  }

  // The Stele instruction, of a kind this precompile may authorize, signed only by the relayer.
  if (record.programAddress !== opts.programAddress)
    fail("last instruction is not a Stele instruction");
  const name = identifyInstruction(new Uint8Array(record.data ?? []));
  if (!name || !allowed!.includes(name)) fail(`instruction ${name} is not allowed`);
  const signers = (record.accounts ?? []).filter((a) => a.role >= 2);
  if (signers.length !== 1 || signers[0]!.address !== opts.relayer)
    fail("the relayer must be the only signer");
}
