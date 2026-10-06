/**
 * Content addressing. The default on-chain storage URI is an IPFS CIDv1 (raw codec, sha2-256)
 * derived from the content hash itself: `ipfs://bafkrei…`. Anyone holding the canonical bytes can
 * serve or pin them, any gateway can resolve them, and the URI commits to the same SHA-256 as the
 * on-chain `content_hash` — the pointer never needs to be trusted.
 */
import { ProtocolError } from "./errors";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** RFC 4648 base32, lowercase, no padding. */
export function base32Lower(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]!;
  return out;
}

/** CIDv1 (raw codec 0x55, multihash sha2-256 0x12) in multibase base32 (`b` prefix). */
export function contentCid(contentHash: Uint8Array): string {
  if (contentHash.length !== 32)
    throw new ProtocolError("INVALID_FORMAT", "content hash must be 32 bytes");
  const cid = new Uint8Array(4 + 32);
  cid.set([0x01, 0x55, 0x12, 0x20]);
  cid.set(contentHash, 4);
  return `b${base32Lower(cid)}`;
}

/** Canonical storage URI for content with this hash. */
export function contentStorageUri(contentHash: Uint8Array): string {
  return `ipfs://${contentCid(contentHash)}`;
}

/** Extracts the SHA-256 from a raw-codec CIDv1 storage URI, or `null` if it is not one. */
export function contentHashFromStorageUri(uri: string): Uint8Array | null {
  if (!uri.startsWith("ipfs://b")) return null;
  const s = uri.slice("ipfs://b".length);
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const v = BASE32.indexOf(ch);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length !== 36 || out[0] !== 0x01 || out[1] !== 0x55 || out[2] !== 0x12 || out[3] !== 0x20)
    return null;
  return Uint8Array.from(out.slice(4));
}
