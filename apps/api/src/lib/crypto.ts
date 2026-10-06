/** Server-side cryptographic helpers (Node `crypto`). */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** URL-safe random token with `bytes` of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Constant-time comparison of two secrets via their SHA-256 digests (length-independent). */
export function secretsEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

/** Constant-time comparison of a presented secret with a stored SHA-256 hex digest. */
export function matchesHash(presented: string, storedHex: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = Buffer.from(storedHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hmacSha256Hex(key: string | Uint8Array, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

/** Keyed hash of an IP address: lets us rate-limit and correlate abuse without storing IPs. */
export function hashIp(ip: string | undefined, secret: string): string | null {
  return ip ? hmacSha256Hex(secret, ip).slice(0, 32) : null;
}

/** AES-256-GCM: returns base64(iv ‖ ciphertext ‖ tag). */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString("base64");
}

export function decrypt(payload: string, key: Buffer): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < 12 + 16) throw new Error("ciphertext too short");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
