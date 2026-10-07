/**
 * Stele Gate (PROTOCOL_SPEC.md §18): policies, access passes, the requirement rule that
 * `stele_gate::require_current` applies on-chain, its error codes, and the Atlas vault demo program.
 *
 * Off-chain evaluation here is for user experience only — deciding whether to show the acceptance
 * modal before an action. Enforcement happens on-chain, inside the protected program.
 */
import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type AccountMeta,
  type Address,
  type Instruction,
} from "@solana/kit";
import {
  decodeAccessPass,
  decodeGatePolicy,
  type AccessPassAccount,
  type GatePolicyAccount,
} from "./accounts";
import { BorshReader, BorshWriter } from "./borsh";
import { fetchManyAccountData, type SteleRpc } from "./client";
import { bytesEqual, fromBase64, utf8 } from "./encoding";
import { ProtocolError } from "./errors";
import { anchorDiscriminator } from "./hash";
import { SYSTEM_PROGRAM_ADDRESS } from "./instructions";
import { findAccessPassPda } from "./pda";

export type AccessStatus = "MISSING" | "OUTDATED" | "VALID";

export interface AccessEvaluation {
  status: AccessStatus;
  policy: Address;
  document: Address;
  holder: Address;
  accessPass: Address;
  pass: AccessPassAccount | null;
  /** The version number the policy requires (a later accepted version also satisfies it). */
  requiredVersion: number;
}

/** The rule of `stele_gate::require_current`, applied to already-fetched accounts. */
export function evaluateAccess(i: {
  policy: Address;
  policyAccount: GatePolicyAccount;
  holder: Address;
  accessPass: Address;
  pass: AccessPassAccount | null;
}): AccessEvaluation {
  const p = i.policyAccount;
  const base = {
    policy: i.policy,
    document: p.document,
    holder: i.holder,
    accessPass: i.accessPass,
    pass: i.pass,
    requiredVersion: p.requiredVersion,
  };
  const pass = i.pass;
  if (
    !pass ||
    pass.document !== p.document ||
    pass.holder !== i.holder ||
    pass.organization !== p.organization
  ) {
    return { ...base, status: "MISSING" };
  }
  if (pass.versionNumber < p.requiredVersion) return { ...base, status: "OUTDATED" };
  if (
    pass.versionNumber === p.requiredVersion &&
    !bytesEqual(pass.versionHash, p.requiredVersionHash)
  )
    return { ...base, status: "OUTDATED" };
  return { ...base, status: "VALID" };
}

/** Reads a policy and the holder's pass from Solana and evaluates the requirement. */
export async function readAccess(
  rpc: SteleRpc,
  i: { policy: Address; holder: Address; programAddress?: Address },
): Promise<AccessEvaluation & { policyAccount: GatePolicyAccount }> {
  const [policyData] = await fetchManyAccountData(rpc, [i.policy]);
  if (!policyData) throw new ProtocolError("DECODE_ERROR", `policy ${i.policy} not found`);
  const policyAccount = decodeGatePolicy(policyData);
  const [accessPass] = await findAccessPassPda(policyAccount.document, i.holder, i.programAddress);
  const [passData] = await fetchManyAccountData(rpc, [accessPass]);
  const pass = passData && passData.length > 0 ? decodeAccessPass(passData) : null;
  return {
    ...evaluateAccess({ policy: i.policy, policyAccount, holder: i.holder, accessPass, pass }),
    policyAccount,
  };
}

// ---- stele-gate crate errors (ProgramError::Custom) --------------------------------------------

export const GATE_ERRORS = [
  [7600, "InvalidPolicy", "The policy is not a Stele policy at its canonical address"],
  [7601, "UserNotSigner", "The user did not sign the transaction"],
  [7602, "AccessPassMissing", "The user has not accepted the required terms"],
  [7603, "AccessPassInvalid", "The account is not a Stele access pass at its canonical address"],
  [7604, "AccessPassMismatch", "The access pass belongs to another wallet or document"],
  [7605, "AccessPassOutdated", "The access pass names an older version than the policy requires"],
  [
    7606,
    "FingerprintMismatch",
    "The access pass names the required version with another fingerprint",
  ],
] as const;

export function describeGateError(code: number): { name: string; message: string } | null {
  const e = GATE_ERRORS.find(([c]) => c === code);
  return e ? { name: e[1], message: e[2] } : null;
}

// ---- Atlas vault demo program --------------------------------------------------------------------------

/** The Stele Gate demo vault (programs/gate-demo); same address on localnet and devnet. */
export const GATE_DEMO_PROGRAM_ADDRESS = address("A6DBoANAavtbG2ARK6PihqzMjhtbcZUbLnTMAWn339uR");
export const GATE_DEMO_VAULT_SEED = "vault";
/** Demo USDC has 6 decimals. */
export const DEMO_USDC_DECIMALS = 6;

export const GATE_DEMO_ERRORS = [
  "InvalidName",
  "NotAStelePolicy",
  "WrongPolicy",
  "InvalidAmount",
  "Overflow",
] as const;

const encodeAddress = (a: Address) => new Uint8Array(getAddressEncoder().encode(a));

export async function findVaultPda(
  policy: Address,
  programAddress: Address = GATE_DEMO_PROGRAM_ADDRESS,
) {
  return getProgramDerivedAddress({
    programAddress,
    seeds: [utf8(GATE_DEMO_VAULT_SEED), encodeAddress(policy)],
  });
}

function demoInstruction(
  name: string,
  accounts: AccountMeta[],
  args: (w: BorshWriter) => void,
  programAddress: Address = GATE_DEMO_PROGRAM_ADDRESS,
): Instruction {
  const w = new BorshWriter().raw(anchorDiscriminator("global", name));
  args(w);
  return { programAddress, accounts, data: w.toBytes() };
}

export function createVaultInstruction(i: {
  manager: Address;
  policy: Address;
  vault: Address;
  name: string;
  programAddress?: Address;
}): Instruction {
  return demoInstruction(
    "create_vault",
    [
      { address: i.manager, role: AccountRole.WRITABLE_SIGNER },
      { address: i.policy, role: AccountRole.READONLY },
      { address: i.vault, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    (w) => w.string(i.name),
    i.programAddress,
  );
}

/**
 * `deposit(amount)` of the demo vault. The builder accepts any accounts — that is how the demo shows
 * a direct bypass attempt failing on-chain.
 */
export function depositInstruction(i: {
  investor: Address;
  vault: Address;
  policy: Address;
  accessPass: Address;
  /** Demo USDC base units (6 decimals). */
  amount: bigint | number;
  programAddress?: Address;
}): Instruction {
  return demoInstruction(
    "deposit",
    [
      { address: i.investor, role: AccountRole.READONLY_SIGNER },
      { address: i.vault, role: AccountRole.WRITABLE },
      { address: i.policy, role: AccountRole.READONLY },
      { address: i.accessPass, role: AccountRole.READONLY },
    ],
    (w) => w.u64(i.amount),
    i.programAddress,
  );
}

export interface VaultAccount {
  policy: Address;
  manager: Address;
  totalDeposited: bigint;
  depositCount: bigint;
  createdAt: bigint;
  bump: number;
  name: string;
}

export function decodeVault(data: Uint8Array): VaultAccount {
  if (data.length < 8 || !bytesEqual(data.subarray(0, 8), anchorDiscriminator("account", "Vault")))
    throw new ProtocolError("DECODE_ERROR", "account is not a demo Vault");
  const r = new BorshReader(data);
  r.bytes(8);
  return {
    policy: r.address(),
    manager: r.address(),
    totalDeposited: r.u64(),
    depositCount: r.u64(),
    createdAt: r.i64(),
    bump: r.u8(),
    name: r.string(64),
  };
}

export interface DepositedEvent {
  vault: Address;
  investor: Address;
  amount: bigint;
  totalDeposited: bigint;
  depositCount: bigint;
  termsVersion: Address;
  termsVersionNumber: number;
  termsFingerprint: Uint8Array;
  acceptanceId: Uint8Array;
  slot: bigint;
}

/** Decodes the demo vault's `Deposited` events from transaction logs. */
export function decodeDepositedFromLogs(logs: readonly string[]): DepositedEvent[] {
  const disc = anchorDiscriminator("event", "Deposited");
  const out: DepositedEvent[] = [];
  for (const line of logs) {
    if (!line.startsWith("Program data: ")) continue;
    const data = fromBase64(line.slice("Program data: ".length));
    if (data.length < 8 || !bytesEqual(data.subarray(0, 8), disc)) continue;
    const r = new BorshReader(data);
    r.bytes(8);
    out.push({
      vault: r.address(),
      investor: r.address(),
      amount: r.u64(),
      totalDeposited: r.u64(),
      depositCount: r.u64(),
      termsVersion: r.address(),
      termsVersionNumber: r.u32(),
      termsFingerprint: r.bytes(32),
      acceptanceId: r.bytes(32),
      slot: r.u64(),
    });
  }
  return out;
}

/** Explains a failed protected action: a `stele-gate` error, or the demo vault's own error. */
export function explainGateFailure(
  programAddress: Address | null,
  code: number,
): { source: "stele-gate" | "program"; name: string; message: string } | null {
  const gate = describeGateError(code);
  if (gate) return { source: "stele-gate", ...gate };
  if (
    programAddress === GATE_DEMO_PROGRAM_ADDRESS &&
    code >= 6000 &&
    code < 6000 + GATE_DEMO_ERRORS.length
  ) {
    const name = GATE_DEMO_ERRORS[code - 6000]!;
    return { source: "program", name, message: name };
  }
  return null;
}
