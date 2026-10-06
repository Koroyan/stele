import {
  getBase58Decoder,
  getBase58Encoder,
  getBase64Decoder,
  getBase64Encoder,
} from "@solana/kit";
import { ProtocolError } from "./errors";

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function utf8(s: string): Uint8Array {
  return utf8Encoder.encode(s);
}

/** Strict UTF-8 decoding: invalid sequences throw instead of becoming U+FFFD. */
export function fromUtf8(bytes: Uint8Array): string {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    throw new ProtocolError("DECODE_ERROR", "invalid UTF-8");
  }
}

export function utf8Length(s: string): number {
  return utf8Encoder.encode(s).length;
}

const HEX = "0123456789abcdef";

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX[b >> 4]! + HEX[b & 0x0f]!;
  return out;
}

export function isHex(s: string, byteLength?: number): boolean {
  if (!/^[0-9a-f]*$/.test(s) || s.length % 2 !== 0) return false;
  return byteLength === undefined || s.length === byteLength * 2;
}

export function fromHex(s: string, byteLength?: number): Uint8Array {
  if (!isHex(s, byteLength)) {
    throw new ProtocolError(
      "DECODE_ERROR",
      `expected lowercase hex${byteLength ? ` of ${byteLength} bytes` : ""}`,
    );
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toBase58(bytes: Uint8Array): string {
  return getBase58Decoder().decode(bytes);
}

export function fromBase58(s: string): Uint8Array {
  return new Uint8Array(getBase58Encoder().encode(s));
}

export function toBase64(bytes: Uint8Array): string {
  return getBase64Decoder().decode(bytes);
}

export function fromBase64(s: string): Uint8Array {
  return new Uint8Array(getBase64Encoder().encode(s));
}

/** Unpadded base64url (RFC 4648 §5), as used by WebAuthn. */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Strict unpadded base64url decoding. */
export function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error("invalid base64url");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = fromBase64(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  if (toBase64Url(bytes) !== s) throw new Error("non-canonical base64url");
  return bytes;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
