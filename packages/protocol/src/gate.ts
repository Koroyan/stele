/**
 * Stele Gate (PROTOCOL_SPEC.md §18): access passes, the requirement rule, the `stele-gate` crate's
 * error codes, and the Gate demo program (a toy prediction market protected by Stele Gate).
 *
 * Off-chain evaluation here is for user experience only — deciding whether to show the acceptance
 * modal before an action. Enforcement happens on-chain, in the protected program.
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
  decodeDocument,
  type AccessPassAccount,
  type DocumentAccount,
  ZERO_ADDRESS,
} from "./accounts";
import { BorshReader, BorshWriter } from "./borsh";
import { fetchManyAccountData, type SteleRpc } from "./client";
import { DEFAULT_PROGRAM_ADDRESS } from "./constants";
import { bytesEqual, fromBase64, utf8 } from "./encoding";
import { ProtocolError } from "./errors";
import { anchorDiscriminator } from "./hash";
import { SYSTEM_PROGRAM_ADDRESS } from "./instructions";
import { findAccessPassPda } from "./pda";

export type AccessStatus = "MISSING" | "OUTDATED" | "VALID";

/** `minVersion` 0 (default): the document's current version; `n`: version `n` or later. */
export interface AccessRequirement {
  minVersion?: number;
}

export interface AccessEvaluation {
  status: AccessStatus;
  document: Address;
  holder: Address;
  accessPass: Address;
  pass: AccessPassAccount | null;
  /** The document's current version (what a "current version" requirement asks for). */
  currentVersion: Address | null;
  currentVersionNumber: number;
  /** The version number the requirement is satisfied by (current, or the minimum). */
  requiredVersionNumber: number;
}

/** Applies the on-chain rule of `check_access` to already-fetched accounts. */
export function evaluateAccess(i: {
  document: Address;
  documentAccount: DocumentAccount;
  holder: Address;
  accessPass: Address;
  pass: AccessPassAccount | null;
  requirement?: AccessRequirement;
}): AccessEvaluation {
  const min = i.requirement?.minVersion ?? 0;
  const doc = i.documentAccount;
  const current = doc.currentVersion === ZERO_ADDRESS ? null : doc.currentVersion;
  const base = {
    document: i.document,
    holder: i.holder,
    accessPass: i.accessPass,
    pass: i.pass,
    currentVersion: current,
    currentVersionNumber: doc.versionCount,
    requiredVersionNumber: min === 0 ? doc.versionCount : min,
  };
  if (!i.pass || i.pass.document !== i.document || i.pass.holder !== i.holder) {
    return { ...base, status: "MISSING" };
  }
  const ok = min === 0 ? i.pass.version === current : i.pass.versionNumber >= min;
  return { ...base, status: ok ? "VALID" : "OUTDATED" };
}

/** Reads the document and the holder's pass from Solana and evaluates the requirement. */
export async function readAccess(
  rpc: SteleRpc,
  i: {
    document: Address;
    holder: Address;
    requirement?: AccessRequirement;
    programAddress?: Address;
  },
): Promise<AccessEvaluation> {
  const [accessPass] = await findAccessPassPda(i.document, i.holder, i.programAddress);
  const [docData, passData] = await fetchManyAccountData(rpc, [i.document, accessPass]);
  if (!docData) throw new ProtocolError("DECODE_ERROR", `policy document ${i.document} not found`);
  let pass: AccessPassAccount | null = null;
  if (passData && passData.length > 0) pass = decodeAccessPass(passData);
  return evaluateAccess({
    document: i.document,
    documentAccount: decodeDocument(docData),
    holder: i.holder,
    accessPass,
    pass,
    requirement: i.requirement,
  });
}

// ---- stele-gate crate errors (ProgramError::Custom) --------------------------------------------

export const GATE_ERRORS = [
  [7600, "PolicyMismatch", "The document is not the policy this program requires"],
  [7601, "InvalidDocument", "The document account is not a Stele document"],
  [7602, "HolderNotSigner", "The pass holder did not sign the transaction"],
  [7603, "AccessPassMissing", "The holder has not accepted this policy"],
  [7604, "AccessPassInvalid", "The account is not a Stele access pass"],
  [7605, "AccessPassMismatch", "The access pass belongs to another document or holder"],
  [7606, "AccessPassOutdated", "The access pass names an older version than required"],
  [7607, "InvalidRequirement", "The requirement names a version the document does not have"],
  [7608, "InvalidSteleProgram", "The program passed as Stele is not the Stele program"],
] as const;

export function describeGateError(code: number): { name: string; message: string } | null {
  const e = GATE_ERRORS.find(([c]) => c === code);
  return e ? { name: e[1], message: e[2] } : null;
}

// ---- Gate demo program ----------------------------------------------------------------------------

/** The Stele Gate demo market (programs/gate-demo); same address on localnet and devnet. */
export const GATE_DEMO_PROGRAM_ADDRESS = address("A6DBoANAavtbG2ARK6PihqzMjhtbcZUbLnTMAWn339uR");
export const GATE_DEMO_MARKET_SEED = "market";
export const GATE_DEMO_SIDE_NO = 0;
export const GATE_DEMO_SIDE_YES = 1;

export const GATE_DEMO_ERRORS = [
  "InvalidQuestion",
  "NotAStelePolicy",
  "InvalidSide",
  "InvalidStake",
  "Overflow",
] as const;

const encodeAddress = (a: Address) => new Uint8Array(getAddressEncoder().encode(a));

export async function findMarketPda(
  policyDocument: Address,
  programAddress: Address = GATE_DEMO_PROGRAM_ADDRESS,
) {
  return getProgramDerivedAddress({
    programAddress,
    seeds: [utf8(GATE_DEMO_MARKET_SEED), encodeAddress(policyDocument)],
  });
}

function demoInstruction(
  name: string,
  accounts: Instruction["accounts"],
  args: (w: BorshWriter) => void,
  programAddress: Address = GATE_DEMO_PROGRAM_ADDRESS,
): Instruction {
  const w = new BorshWriter().raw(anchorDiscriminator("global", name));
  args(w);
  return { programAddress, accounts, data: w.toBytes() };
}

export function createMarketInstruction(i: {
  creator: Address;
  policyDocument: Address;
  market: Address;
  question: string;
  programAddress?: Address;
}): Instruction {
  return demoInstruction(
    "create_market",
    [
      { address: i.creator, role: AccountRole.WRITABLE_SIGNER },
      { address: i.policyDocument, role: AccountRole.READONLY },
      { address: i.market, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    (w) => w.string(i.question),
    i.programAddress,
  );
}

/**
 * A bet: `strict` uses the CPI path (`place_bet_strict`), otherwise check mode (`place_bet`).
 * Builders accept any accounts — that is how the demo shows a direct bypass attempt failing.
 */
export function placeBetInstruction(i: {
  bettor: Address;
  market: Address;
  policyDocument: Address;
  accessPass: Address;
  side: number;
  stake: bigint | number;
  strict?: boolean;
  steleProgram?: Address;
  programAddress?: Address;
}): Instruction {
  const accounts: AccountMeta[] = [
    { address: i.bettor, role: AccountRole.READONLY_SIGNER },
    { address: i.market, role: AccountRole.WRITABLE },
    { address: i.policyDocument, role: AccountRole.READONLY },
    { address: i.accessPass, role: AccountRole.READONLY },
  ];
  if (i.strict) {
    accounts.push({
      address: i.steleProgram ?? address(DEFAULT_PROGRAM_ADDRESS),
      role: AccountRole.READONLY,
    });
  }
  return demoInstruction(
    i.strict ? "place_bet_strict" : "place_bet",
    accounts,
    (w) => w.u8(i.side).u64(i.stake),
    i.programAddress,
  );
}

export interface MarketAccount {
  policyDocument: Address;
  creator: Address;
  yesStake: bigint;
  noStake: bigint;
  betCount: bigint;
  createdAt: bigint;
  bump: number;
  question: string;
}

export function decodeMarket(data: Uint8Array): MarketAccount {
  if (data.length < 8 || !bytesEqual(data.subarray(0, 8), anchorDiscriminator("account", "Market")))
    throw new ProtocolError("DECODE_ERROR", "account is not a Gate demo Market");
  const r = new BorshReader(data);
  r.bytes(8);
  return {
    policyDocument: r.address(),
    creator: r.address(),
    yesStake: r.u64(),
    noStake: r.u64(),
    betCount: r.u64(),
    createdAt: r.i64(),
    bump: r.u8(),
    question: r.string(96),
  };
}

export interface BetPlacedEvent {
  market: Address;
  bettor: Address;
  policyVersion: Address;
  policyVersionNumber: number;
  stake: bigint;
  yesStake: bigint;
  noStake: bigint;
  betCount: bigint;
  slot: bigint;
  side: number;
  strict: boolean;
}

/** Decodes the demo program's `BetPlaced` events from transaction logs. */
export function decodeBetPlacedFromLogs(logs: readonly string[]): BetPlacedEvent[] {
  const disc = anchorDiscriminator("event", "BetPlaced");
  const out: BetPlacedEvent[] = [];
  for (const line of logs) {
    if (!line.startsWith("Program data: ")) continue;
    const data = fromBase64(line.slice("Program data: ".length));
    if (data.length < 8 || !bytesEqual(data.subarray(0, 8), disc)) continue;
    const r = new BorshReader(data);
    r.bytes(8);
    out.push({
      market: r.address(),
      bettor: r.address(),
      policyVersion: r.address(),
      policyVersionNumber: r.u32(),
      stake: r.u64(),
      yesStake: r.u64(),
      noStake: r.u64(),
      betCount: r.u64(),
      slot: r.u64(),
      side: r.u8(),
      strict: r.bool(),
    });
  }
  return out;
}

/**
 * Explains a failed protected action: a Stele program error (strict mode), a `stele-gate` crate
 * error (check mode), or the demo program's own error.
 */
export function explainGateFailure(
  programAddress: Address | null,
  code: number,
): { source: "stele" | "stele-gate" | "program"; name: string; message: string } | null {
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
