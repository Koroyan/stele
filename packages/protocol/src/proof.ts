/**
 * `stele-proof-v1` anchor messages and proof identifiers (PROTOCOL_SPEC.md §12).
 * Mirrors `crates/stele-core/src/proof.rs`.
 */
import { PROOF_HEADER, PROOF_ID_TAG, PROOF_STATEMENT_LINE, REQUESTED_BY_PREFIX } from "./constants";
import { fromHex, toHex, utf8 } from "./encoding";
import { ProtocolError } from "./errors";
import { sha256v } from "./hash";
import { formatRfc3339, parseRfc3339 } from "./time";
import { validateRequestDomain } from "./validate";

/** Proof types (`0` is document acceptance, recorded by `record_acceptance`). Never renumbered. */
export const PROOF_TYPES = [
  { code: 1, name: "PURCHASE", label: "Purchase" },
  { code: 2, name: "SALE", label: "Sale" },
  { code: 3, name: "ORDER", label: "Order" },
  { code: 4, name: "PAYMENT", label: "Payment" },
  { code: 5, name: "RECEIPT", label: "Receipt" },
  { code: 6, name: "INVOICE", label: "Invoice" },
  { code: 7, name: "REFUND", label: "Refund" },
  { code: 8, name: "CANCELLATION", label: "Cancellation" },
  { code: 9, name: "DELIVERY", label: "Delivery" },
  { code: 10, name: "RETURN", label: "Return" },
  { code: 11, name: "WARRANTY", label: "Warranty" },
  { code: 12, name: "SUBSCRIPTION_START", label: "Subscription start" },
  { code: 13, name: "SUBSCRIPTION_CANCEL", label: "Subscription cancellation" },
  { code: 14, name: "QUOTE_ACCEPTANCE", label: "Quote acceptance" },
  { code: 15, name: "CONTRACT", label: "Contract" },
  { code: 16, name: "CONSENT", label: "Consent" },
  { code: 17, name: "POLICY_ACCEPTANCE", label: "Policy acceptance" },
] as const;

export type ProofTypeName = (typeof PROOF_TYPES)[number]["name"];
/** Every kind of record Stele can anchor, including document acceptance. */
export type RecordKind = "DOCUMENT_ACCEPTANCE" | ProofTypeName;

export function proofTypeByName(name: string): (typeof PROOF_TYPES)[number] | undefined {
  return PROOF_TYPES.find((t) => t.name === name);
}

export function proofTypeByCode(code: number): (typeof PROOF_TYPES)[number] | undefined {
  return PROOF_TYPES.find((t) => t.code === code);
}

export interface ProofMessageFields {
  proofType: number;
  orgName: string;
  /** Verified domain if valid at recording time, else `null` (→ "unverified"). */
  orgVerifiedDomain: string | null;
  /** Base58 organization address. */
  organization: string;
  /** SHA-256 of the canonical statement (32 bytes). */
  statementHash: Uint8Array;
  /** Base58 public key of the signer. */
  signer: string;
  networkLabel: string;
  chainId: string;
  issuedAt: number | bigint;
  expiresAt: number | bigint;
  shardId: number;
  nonceIndex: number;
  nonceTag: Uint8Array;
}

/** Everything before the request domain (lines 1–12 and `Requested by: `). */
export function proofMessagePrefix(f: ProofMessageFields): string {
  const type = proofTypeByCode(f.proofType);
  if (!type) throw new ProtocolError("INVALID_FORMAT", `unknown proof type ${f.proofType}`);
  if (f.nonceTag.length !== 8)
    throw new ProtocolError("INVALID_FORMAT", "nonce tag must be 8 bytes");
  if (f.statementHash.length !== 32)
    throw new ProtocolError("INVALID_FORMAT", "statement hash must be 32 bytes");
  const status = f.orgVerifiedDomain ? `verified: ${f.orgVerifiedDomain}` : "unverified";
  return [
    PROOF_HEADER,
    PROOF_STATEMENT_LINE,
    `Type: ${type.label}`,
    `Organization: ${f.orgName} (${status})`,
    `Organization ID: ${f.organization}`,
    `Statement: ${toHex(f.statementHash)}`,
    `Account: ${f.signer}`,
    `Network: ${f.networkLabel}`,
    `Chain: ${f.chainId}`,
    `Issued: ${formatRfc3339(f.issuedAt)}`,
    `Expires: ${formatRfc3339(f.expiresAt)}`,
    `Nonce: ${f.shardId}-${f.nonceIndex}-${toHex(f.nonceTag)}`,
    REQUESTED_BY_PREFIX,
  ].join("\n");
}

export function buildProofMessage(f: ProofMessageFields, requestDomain: string): string {
  validateRequestDomain(requestDomain);
  return proofMessagePrefix(f) + requestDomain;
}

export interface ParsedProofMessage {
  proofType: number;
  orgName: string;
  orgVerifiedDomain: string | null;
  organization: string;
  statementHash: string;
  signer: string;
  networkLabel: string;
  chainId: string;
  issuedAt: number;
  expiresAt: number;
  shardId: number;
  nonceIndex: number;
  nonceTag: string;
  requestDomain: string;
}

function field(line: string | undefined, label: string): string {
  const prefix = `${label}: `;
  if (line === undefined || !line.startsWith(prefix))
    throw new ProtocolError("MESSAGE_MISMATCH", `expected line "${label}: …"`);
  return line.slice(prefix.length);
}

/** Strict parse + canonical rebuild (parsing alone proves nothing; callers compare with chain data). */
export function parseProofMessage(text: string): ParsedProofMessage {
  const lines = text.split("\n");
  if (lines.length !== 13)
    throw new ProtocolError("MESSAGE_MISMATCH", `expected 13 lines, found ${lines.length}`);
  if (lines[0] !== PROOF_HEADER || lines[1] !== PROOF_STATEMENT_LINE)
    throw new ProtocolError("MESSAGE_MISMATCH", "not a Stele v1 proof message");
  const type = PROOF_TYPES.find((t) => t.label === field(lines[2], "Type"));
  if (!type) throw new ProtocolError("MESSAGE_MISMATCH", "unknown proof type");
  const org = field(lines[3], "Organization");
  const open = org.lastIndexOf(" (");
  if (open < 1 || !org.endsWith(")"))
    throw new ProtocolError("MESSAGE_MISMATCH", "malformed organization line");
  const status = org.slice(open + 2, -1);
  let orgVerifiedDomain: string | null = null;
  if (status.startsWith("verified: ")) orgVerifiedDomain = status.slice("verified: ".length);
  else if (status !== "unverified")
    throw new ProtocolError("MESSAGE_MISMATCH", "malformed verification status");
  const statementHash = field(lines[5], "Statement");
  if (!/^[0-9a-f]{64}$/.test(statementHash))
    throw new ProtocolError("MESSAGE_MISMATCH", "malformed statement hash");
  const nonce = /^(0|[1-9][0-9]*)-(0|[1-9][0-9]*)-([0-9a-f]{16})$/.exec(field(lines[11], "Nonce"));
  if (!nonce) throw new ProtocolError("MESSAGE_MISMATCH", "malformed nonce");
  const parsed: ParsedProofMessage = {
    proofType: type.code,
    orgName: org.slice(0, open),
    orgVerifiedDomain,
    organization: field(lines[4], "Organization ID"),
    statementHash,
    signer: field(lines[6], "Account"),
    networkLabel: field(lines[7], "Network"),
    chainId: field(lines[8], "Chain"),
    issuedAt: parseRfc3339(field(lines[9], "Issued")),
    expiresAt: parseRfc3339(field(lines[10], "Expires")),
    shardId: Number(nonce[1]),
    nonceIndex: Number(nonce[2]),
    nonceTag: nonce[3]!,
    requestDomain: field(lines[12], "Requested by"),
  };
  const rebuilt = buildProofMessage(
    {
      ...parsed,
      statementHash: fromHex(parsed.statementHash, 32),
      nonceTag: fromHex(parsed.nonceTag, 8),
    },
    parsed.requestDomain,
  );
  if (rebuilt !== text)
    throw new ProtocolError("MESSAGE_MISMATCH", "message is not in canonical form");
  return parsed;
}

/** `H("stele:v1:proof\0" || organization || signer || statement_hash || message_hash || signature)`. */
export function proofId(
  organization: Uint8Array,
  signer: Uint8Array,
  statementHash: Uint8Array,
  msgHash: Uint8Array,
  signature: Uint8Array,
): Uint8Array {
  if (
    organization.length !== 32 ||
    signer.length !== 32 ||
    statementHash.length !== 32 ||
    msgHash.length !== 32 ||
    signature.length !== 64
  ) {
    throw new ProtocolError("INVALID_FORMAT", "proofId: invalid input lengths");
  }
  return sha256v(utf8(PROOF_ID_TAG), organization, signer, statementHash, msgHash, signature);
}
