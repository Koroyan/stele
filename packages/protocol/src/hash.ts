import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { concatBytes, toHex, utf8 } from "./encoding";

/** SHA-256 (FIPS 180-4). Synchronous and identical in browsers and Node. */
export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}

/** SHA-256 of the concatenation of `parts` (no separators). */
export function sha256v(...parts: Uint8Array[]): Uint8Array {
  return nobleSha256(concatBytes(...parts));
}

export function sha256Hex(data: Uint8Array | string): string {
  return toHex(sha256(typeof data === "string" ? utf8(data) : data));
}

/** Seed hash of a `DomainRecord` address: SHA-256 of the domain's UTF-8 bytes. */
export function domainHash(domain: string): Uint8Array {
  return sha256(utf8(domain));
}

/** Anchor 8-byte discriminator: first 8 bytes of SHA-256(`${namespace}:${name}`). */
export function anchorDiscriminator(
  namespace: "account" | "global" | "event",
  name: string,
): Uint8Array {
  return sha256(utf8(`${namespace}:${name}`)).slice(0, 8);
}
