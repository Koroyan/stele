/**
 * Fee arithmetic for sponsored recordings (PROTOCOL_SPEC.md §13). Mirrors
 * `crates/stele-core/src/fees.rs`: the Sponsor Vault reimburses exactly
 *
 *   5,000 lamports × 2 signatures + ceil(compute-unit limit × price / 1,000,000)
 *
 * capped by the organization's per-record limit. The same function estimates what Stele pays when
 * it sponsors fees itself.
 */
import {
  LAMPORTS_PER_SIGNATURE,
  MICRO_LAMPORTS_PER_LAMPORT,
  SPONSORED_SIGNATURES,
} from "./constants";

export interface FeeInput {
  computeUnitLimit: number;
  /** Micro-lamports per compute unit; 0 or absent = no priority fee. */
  priorityFeeMicroLamports?: bigint | number;
  /** Total signatures the runtime charges for (transaction + precompile). Default 2. */
  signatures?: number;
}

/** The network fee of a recording transaction, in lamports (what the fee payer is charged). */
export function recordingFee(i: FeeInput): bigint {
  const base = BigInt(LAMPORTS_PER_SIGNATURE) * BigInt(i.signatures ?? SPONSORED_SIGNATURES);
  const price = BigInt(i.priorityFeeMicroLamports ?? 0);
  if (price === 0n) return base;
  const micro = BigInt(i.computeUnitLimit) * price;
  const unit = BigInt(MICRO_LAMPORTS_PER_LAMPORT);
  return base + (micro + unit - 1n) / unit;
}

/** What a Sponsor Vault pays for one recording. */
export function vaultReimbursement(fee: bigint, maxFeePerRecord: bigint): bigint {
  return fee < maxFeePerRecord ? fee : maxFeePerRecord;
}

/** How many recordings a balance can sponsor (above the vault's rent-exempt minimum). */
export function estimatedRecordings(
  balanceLamports: bigint,
  rentExemptMinimum: bigint,
  feePerRecord: bigint,
): bigint {
  if (feePerRecord <= 0n || balanceLamports <= rentExemptMinimum) return 0n;
  return (balanceLamports - rentExemptMinimum) / feePerRecord;
}

export const LAMPORTS_PER_SOL = 1_000_000_000n;

export function formatSol(lamports: bigint, digits = 6): string {
  const sign = lamports < 0n ? "-" : "";
  const abs = lamports < 0n ? -lamports : lamports;
  const whole = abs / LAMPORTS_PER_SOL;
  const frac = (abs % LAMPORTS_PER_SOL).toString().padStart(9, "0").slice(0, digits);
  return `${sign}${whole}.${frac}`.replace(/\.?0+$/, "") || "0";
}
