/**
 * `stele-version-v1` — version JSON and the document fingerprint (PROTOCOL_SPEC.md §5).
 * Mirrors `crates/stele-core/src/version.rs`; the program computes the same bytes on-chain.
 */
import { VERSION_FORMAT } from "./constants";
import { toHex, utf8 } from "./encoding";
import { ProtocolError } from "./errors";
import { sha256 } from "./hash";

export interface VersionFields {
  chainId: string;
  /** Base58 addresses. */
  program: string;
  organization: string;
  document: string;
  documentType: string;
  locale: string;
  version: number;
  /** `null` exactly for version 1. */
  previousVersionHash: Uint8Array | null;
  title: string;
  versionLabel: string;
  /** Unix seconds; `0` (or `0n`) = effective upon publication → `null` in JSON. */
  effectiveAt: number | bigint;
  contentHash: Uint8Array;
}

const str = (s: string) => JSON.stringify(s);

/** Canonical version JSON (members in JCS order, no whitespace). */
export function versionJson(f: VersionFields): string {
  if (!Number.isInteger(f.version) || f.version < 1 || f.version > 0xffffffff) {
    throw new ProtocolError("INVALID_FORMAT", "version must be an integer in [1, 2^32-1]");
  }
  if (f.version > 1 && (f.previousVersionHash === null || f.previousVersionHash.length !== 32)) {
    throw new ProtocolError(
      "INVALID_FORMAT",
      "versions after 1 must commit to a 32-byte predecessor",
    );
  }
  if (f.contentHash.length !== 32)
    throw new ProtocolError("INVALID_FORMAT", "content hash must be 32 bytes");
  const effective = BigInt(f.effectiveAt) === 0n ? "null" : BigInt(f.effectiveAt).toString();
  const previous = f.version === 1 ? "null" : str(toHex(f.previousVersionHash!));
  return (
    `{"chainId":${str(f.chainId)}` +
    `,"contentHash":${str(toHex(f.contentHash))}` +
    `,"document":${str(f.document)}` +
    `,"documentType":${str(f.documentType)}` +
    `,"effectiveAt":${effective}` +
    `,"format":${str(VERSION_FORMAT)}` +
    `,"locale":${str(f.locale)}` +
    `,"organization":${str(f.organization)}` +
    `,"previousVersionHash":${previous}` +
    `,"program":${str(f.program)}` +
    `,"title":${str(f.title)}` +
    `,"version":${f.version}` +
    `,"versionLabel":${str(f.versionLabel)}}`
  );
}

/** The document fingerprint: SHA-256 of the canonical version JSON. */
export function versionHash(f: VersionFields): Uint8Array {
  return sha256(utf8(versionJson(f)));
}

export function versionHashHex(f: VersionFields): string {
  return toHex(versionHash(f));
}

/** Short display form of a fingerprint, e.g. `9f86d0…0a08`. */
export function shortFingerprint(hex: string, head = 6, tail = 4): string {
  return hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/** Groups a 64-char fingerprint into 16 blocks of 4 for careful human comparison. */
export function groupedFingerprint(hex: string): string {
  return hex.match(/.{1,4}/g)?.join(" ") ?? hex;
}
