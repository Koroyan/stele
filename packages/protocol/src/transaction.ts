/**
 * Acceptance transaction assembly (legacy format: no lookup tables are needed, and it is 2 bytes
 * smaller than v0 — the worst-case transaction is size-critical):
 *   [SetComputeUnitLimit] [SetComputeUnitPrice?] [signature precompile] [Stele instruction]
 *
 * The precompile is Ed25519 (stele/1: wallets, PRF-protected keys) or secp256r1 (stele/2: native
 * passkeys); the Stele instruction reads it through the instructions sysvar.
 */
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { ACCEPTANCE_COMPUTE_UNIT_LIMIT } from "./constants";

export interface AcceptanceTransactionInput {
  feePayer: TransactionSigner;
  /** The signature precompile (Ed25519 or secp256r1) immediately preceding the Stele instruction. */
  precompileInstruction?: Instruction;
  /** @deprecated use `precompileInstruction` (kept for stele/1 callers). */
  ed25519Instruction?: Instruction;
  recordInstruction: Instruction;
  latestBlockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint };
  /** Priority fee in micro-lamports per compute unit (0/undefined = none). */
  priorityFeeMicroLamports?: bigint | number;
  computeUnitLimit?: number;
}

export function buildAcceptanceTransactionMessage(i: AcceptanceTransactionInput) {
  const instructions: Instruction[] = [
    getSetComputeUnitLimitInstruction({
      units: i.computeUnitLimit ?? ACCEPTANCE_COMPUTE_UNIT_LIMIT,
    }),
  ];
  if (i.priorityFeeMicroLamports && BigInt(i.priorityFeeMicroLamports) > 0n) {
    instructions.push(
      getSetComputeUnitPriceInstruction({ microLamports: BigInt(i.priorityFeeMicroLamports) }),
    );
  }
  const precompile = i.precompileInstruction ?? i.ed25519Instruction;
  if (!precompile) throw new Error("a signature precompile instruction is required");
  instructions.push(precompile, i.recordInstruction);
  return pipe(
    createTransactionMessage({ version: "legacy" }),
    (m) => setTransactionMessageFeePayerSigner(i.feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(i.latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
}

/** Wire size of the compiled (unsigned) transaction — signatures are counted as 64-byte slots. */
export function compiledTransactionSize(message: Parameters<typeof compileTransaction>[0]): number {
  return getTransactionEncoder().encode(compileTransaction(message)).length;
}
