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
  decodePassport,
  passportEntry,
  type AccessPassAccount,
  type GatePolicyAccount,
  type PassportAccount,
  type PassportEntry,
} from "./accounts";
import { BorshReader, BorshWriter } from "./borsh";
import { fetchManyAccountData, type SteleRpc } from "./client";
import { bytesEqual, fromBase64, utf8 } from "./encoding";
import { ProtocolError } from "./errors";
import { anchorDiscriminator } from "./hash";
import { SYSTEM_PROGRAM_ADDRESS } from "./instructions";
import { findAccessPassPda, findPassportPda } from "./pda";

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
  /** The holder's passport address and its entry for the policy's document (Gate v3). */
  passport?: Address;
  passportEntry?: PassportEntry | null;
  /** Which account satisfies (or comes closest to satisfying) the policy. */
  storage?: "pass" | "passport" | null;
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

/** The rule of `stele_gate::require_current_passport`, applied to an already-fetched passport. */
export function evaluatePassport(i: {
  policyAccount: GatePolicyAccount;
  holder: Address;
  passport: PassportAccount | null;
}): { status: AccessStatus; entry: PassportEntry | null } {
  const entry =
    i.passport && i.passport.holder === i.holder
      ? passportEntry(i.passport, i.policyAccount.document)
      : null;
  if (!entry) return { status: "MISSING", entry: null };
  return {
    status: entry.versionNumber >= i.policyAccount.requiredVersion ? "VALID" : "OUTDATED",
    entry,
  };
}

const RANK: Record<AccessStatus, number> = { MISSING: 0, OUTDATED: 1, VALID: 2 };

/**
 * Reads a policy, the holder's access pass and the holder's passport from Solana and evaluates
 * the requirement: VALID if either satisfies it (the passport is preferred).
 */
export async function readAccess(
  rpc: SteleRpc,
  i: { policy: Address; holder: Address; programAddress?: Address },
): Promise<AccessEvaluation & { policyAccount: GatePolicyAccount }> {
  const [policyData] = await fetchManyAccountData(rpc, [i.policy]);
  if (!policyData) throw new ProtocolError("DECODE_ERROR", `policy ${i.policy} not found`);
  const policyAccount = decodeGatePolicy(policyData);
  const [accessPass] = await findAccessPassPda(policyAccount.document, i.holder, i.programAddress);
  const [passport] = await findPassportPda(i.holder, i.programAddress);
  const [passData, passportData] = await fetchManyAccountData(rpc, [accessPass, passport]);
  const pass = passData && passData.length > 0 ? decodeAccessPass(passData) : null;
  let decodedPassport: PassportAccount | null;
  try {
    decodedPassport = passportData && passportData.length > 0 ? decodePassport(passportData) : null;
  } catch {
    decodedPassport = null;
  }
  const byPass = evaluateAccess({
    policy: i.policy,
    policyAccount,
    holder: i.holder,
    accessPass,
    pass,
  });
  const byPassport = evaluatePassport({
    policyAccount,
    holder: i.holder,
    passport: decodedPassport,
  });
  const status = RANK[byPassport.status] >= RANK[byPass.status] ? byPassport.status : byPass.status;
  const storage =
    status === "MISSING"
      ? null
      : RANK[byPassport.status] >= RANK[byPass.status]
        ? "passport"
        : "pass";
  return {
    ...byPass,
    status,
    passport,
    passportEntry: byPassport.entry,
    storage,
    policyAccount,
  };
}

// ---- stele-gate crate errors (ProgramError::Custom) --------------------------------------------

export const GATE_ERRORS = [
  [7600, "InvalidPolicy", "The policy is not a Stele policy at its canonical address"],
  [7601, "UserNotSigner", "The user did not sign the transaction"],
  [7602, "AccessPassMissing", "The user has not accepted the required terms"],
  [
    7603,
    "AccessPassInvalid",
    "The account is not a Stele passport or access pass at its canonical address",
  ],
  [7604, "AccessPassMismatch", "The passport or access pass belongs to another wallet or document"],
  [7605, "AccessPassOutdated", "The accepted version is older than the policy requires"],
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

/** `deposit_with_passport(amount)` of the demo vault: admitted by the investor's passport. */
export function depositWithPassportInstruction(i: {
  investor: Address;
  vault: Address;
  policy: Address;
  passport: Address;
  /** Demo USDC base units (6 decimals). */
  amount: bigint | number;
  programAddress?: Address;
}): Instruction {
  return demoInstruction(
    "deposit_with_passport",
    [
      { address: i.investor, role: AccountRole.READONLY_SIGNER },
      { address: i.vault, role: AccountRole.WRITABLE },
      { address: i.policy, role: AccountRole.READONLY },
      { address: i.passport, role: AccountRole.READONLY },
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

export interface PassportDepositedEvent {
  vault: Address;
  investor: Address;
  amount: bigint;
  totalDeposited: bigint;
  depositCount: bigint;
  /** The version of the offering terms the investor's passport names. */
  termsVersionNumber: number;
  /** When the investor accepted that version (Unix seconds). */
  acceptedAt: bigint;
}

/** Decodes the demo vault's `PassportDeposited` events (`deposit_with_passport`) from logs. */
export function decodePassportDepositedFromLogs(logs: readonly string[]): PassportDepositedEvent[] {
  const disc = anchorDiscriminator("event", "PassportDeposited");
  const out: PassportDepositedEvent[] = [];
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
      termsVersionNumber: r.u32(),
      acceptedAt: r.i64(),
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
