/**
 * `stele-acceptance-v1` — acceptance message construction and strict parsing, acceptance IDs,
 * the shard accumulator and nonce bitmap (PROTOCOL_SPEC.md §7–§8).
 * Mirrors `crates/stele-core/src/{message,acceptance}.rs`.
 */
import {
  ACCEPTANCE_ID_TAG,
  ACCUMULATOR_TAG,
  MESSAGE_HEADER,
  MESSAGE_STATEMENT,
  REQUESTED_BY_PREFIX,
  SHARD_CAPACITY,
} from "./constants";
import { fromHex, toHex, utf8 } from "./encoding";
import { ProtocolError } from "./errors";
import { sha256, sha256v } from "./hash";
import { formatRfc3339, parseRfc3339 } from "./time";
import { validateRequestDomain } from "./validate";

export interface AcceptanceMessageFields {
  orgName: string;
  /** Verified domain if valid at recording time, else `null` (→ "unverified"). */
  orgVerifiedDomain: string | null;
  title: string;
  versionLabel: string;
  version: number;
  /** 32-byte fingerprint. */
  versionHash: Uint8Array;
  /** Base58 public key of the signer. */
  signer: string;
  networkLabel: string;
  issuedAt: number | bigint;
  expiresAt: number | bigint;
  shardId: number;
  nonceIndex: number;
  /** 8 bytes. */
  nonceTag: Uint8Array;
}

/** Everything before the request domain (lines 1–11 and `Requested by: `). */
export function acceptanceMessagePrefix(f: AcceptanceMessageFields): string {
  if (f.nonceTag.length !== 8)
    throw new ProtocolError("INVALID_FORMAT", "nonce tag must be 8 bytes");
  if (f.versionHash.length !== 32)
    throw new ProtocolError("INVALID_FORMAT", "version hash must be 32 bytes");
  const status = f.orgVerifiedDomain ? `verified: ${f.orgVerifiedDomain}` : "unverified";
  return [
    MESSAGE_HEADER,
    MESSAGE_STATEMENT,
    `Organization: ${f.orgName} (${status})`,
    `Document: ${f.title}`,
    `Version: ${f.versionLabel} (#${f.version})`,
    `Fingerprint: ${toHex(f.versionHash)}`,
    `Account: ${f.signer}`,
    `Network: ${f.networkLabel}`,
    `Issued: ${formatRfc3339(f.issuedAt)}`,
    `Expires: ${formatRfc3339(f.expiresAt)}`,
    `Nonce: ${f.shardId}-${f.nonceIndex}-${toHex(f.nonceTag)}`,
    REQUESTED_BY_PREFIX,
  ].join("\n");
}

export function buildAcceptanceMessage(f: AcceptanceMessageFields, requestDomain: string): string {
  validateRequestDomain(requestDomain);
  return acceptanceMessagePrefix(f) + requestDomain;
}

export interface ParsedAcceptanceMessage {
  orgName: string;
  orgVerifiedDomain: string | null;
  title: string;
  versionLabel: string;
  version: number;
  versionHash: string;
  signer: string;
  networkLabel: string;
  issuedAt: number;
  expiresAt: number;
  shardId: number;
  nonceIndex: number;
  nonceTag: string;
  requestDomain: string;
}

function field(line: string | undefined, label: string): string {
  const prefix = `${label}: `;
  if (line === undefined || !line.startsWith(prefix)) {
    throw new ProtocolError("MESSAGE_MISMATCH", `expected line "${label}: …"`);
  }
  return line.slice(prefix.length);
}

/**
 * Strictly parses a message. Callers MUST additionally rebuild the message from the parsed fields
 * (or from chain data) and compare bytes — parsing alone proves nothing.
 */
export function parseAcceptanceMessage(text: string): ParsedAcceptanceMessage {
  const lines = text.split("\n");
  if (lines.length !== 12)
    throw new ProtocolError("MESSAGE_MISMATCH", `expected 12 lines, found ${lines.length}`);
  if (lines[0] !== MESSAGE_HEADER)
    throw new ProtocolError("MESSAGE_MISMATCH", "not a Stele v1 acceptance message");
  if (lines[1] !== MESSAGE_STATEMENT)
    throw new ProtocolError("MESSAGE_MISMATCH", "unexpected statement line");

  const org = field(lines[2], "Organization");
  const open = org.lastIndexOf(" (");
  if (open < 1 || !org.endsWith(")"))
    throw new ProtocolError("MESSAGE_MISMATCH", "malformed organization line");
  const orgName = org.slice(0, open);
  const status = org.slice(open + 2, -1);
  let orgVerifiedDomain: string | null = null;
  if (status.startsWith("verified: ")) orgVerifiedDomain = status.slice("verified: ".length);
  else if (status !== "unverified")
    throw new ProtocolError("MESSAGE_MISMATCH", "malformed verification status");

  const title = field(lines[3], "Document");
  const versionLine = /^(\S+) \(#([1-9][0-9]*)\)$/.exec(field(lines[4], "Version"));
  if (!versionLine) throw new ProtocolError("MESSAGE_MISMATCH", "malformed version line");
  const versionHash = field(lines[5], "Fingerprint");
  if (!/^[0-9a-f]{64}$/.test(versionHash))
    throw new ProtocolError("MESSAGE_MISMATCH", "malformed fingerprint");
  const signer = field(lines[6], "Account");
  const networkLabel = field(lines[7], "Network");
  const issuedAt = parseRfc3339(field(lines[8], "Issued"));
  const expiresAt = parseRfc3339(field(lines[9], "Expires"));
  const nonce = /^(0|[1-9][0-9]*)-(0|[1-9][0-9]*)-([0-9a-f]{16})$/.exec(field(lines[10], "Nonce"));
  if (!nonce) throw new ProtocolError("MESSAGE_MISMATCH", "malformed nonce");
  const requestDomain = field(lines[11], "Requested by");
  validateRequestDomain(requestDomain);

  const parsed: ParsedAcceptanceMessage = {
    orgName,
    orgVerifiedDomain,
    title,
    versionLabel: versionLine[1]!,
    version: Number(versionLine[2]),
    versionHash,
    signer,
    networkLabel,
    issuedAt,
    expiresAt,
    shardId: Number(nonce[1]),
    nonceIndex: Number(nonce[2]),
    nonceTag: nonce[3]!,
    requestDomain,
  };
  // Canonical-form check: the parsed fields must rebuild exactly the same bytes.
  const rebuilt = buildAcceptanceMessage(
    {
      ...parsed,
      versionHash: fromHex(parsed.versionHash, 32),
      nonceTag: fromHex(parsed.nonceTag, 8),
    },
    parsed.requestDomain,
  );
  if (rebuilt !== text)
    throw new ProtocolError("MESSAGE_MISMATCH", "message is not in canonical form");
  return parsed;
}

export function messageHash(message: string | Uint8Array): Uint8Array {
  return sha256(typeof message === "string" ? utf8(message) : message);
}

/** `H("stele:v1:acceptance\0" || version || signer || message_hash || signature)`. */
export function acceptanceId(
  version: Uint8Array,
  signer: Uint8Array,
  msgHash: Uint8Array,
  signature: Uint8Array,
): Uint8Array {
  if (
    version.length !== 32 ||
    signer.length !== 32 ||
    msgHash.length !== 32 ||
    signature.length !== 64
  ) {
    throw new ProtocolError("INVALID_FORMAT", "acceptanceId: invalid input lengths");
  }
  return sha256v(utf8(ACCEPTANCE_ID_TAG), version, signer, msgHash, signature);
}

/** `H("stele:v1:accumulator\0" || accumulator || acceptance_id)`. */
export function accumulate(accumulator: Uint8Array, id: Uint8Array): Uint8Array {
  return sha256v(utf8(ACCUMULATOR_TAG), accumulator, id);
}

export function isNonceConsumed(bitmap: Uint8Array, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= SHARD_CAPACITY) return true;
  const byte = bitmap[index >> 3];
  return byte === undefined || (byte & (1 << (index & 7))) !== 0;
}

/** Indices of unconsumed nonces in `[from, to)` — used to rebuild allocator state from chain. */
export function freeNonces(
  bitmap: Uint8Array,
  from = 0,
  to = SHARD_CAPACITY,
  max = Infinity,
): number[] {
  const out: number[] = [];
  for (let i = from; i < to && out.length < max; i++) if (!isNonceConsumed(bitmap, i)) out.push(i);
  return out;
}
