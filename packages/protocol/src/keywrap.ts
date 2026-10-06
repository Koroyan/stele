/**
 * Wrapping of a walletless signer's Ed25519 seed (PROTOCOL_SPEC.md §14.1).
 *
 *   wrapping key = HKDF-SHA256(ikm = secret, salt = 32 random bytes, info = purpose tag)
 *   blob         = AES-256-GCM(wrapping key, iv = 12 random bytes, seed, aad)
 *   aad          = "stele-wrapped-key-v1" || public key || binding id
 *
 * `secret` is either a passkey's WebAuthn PRF output (32 bytes, released only after user
 * verification) or a recovery kit's 32-byte secret. The binding id (credential ID or kit ID) and the
 * public key are authenticated, so a blob cannot be re-attributed to another passkey or identity,
 * and unwrapping re-derives the public key to detect a wrong secret or tampering.
 *
 * Everything runs in WebCrypto; the wrapping key is non-extractable. Callers must drop the seed as
 * soon as they have signed (`seed.fill(0)`), and never persist or transmit it.
 */
import { buf } from "./internal";
import { ed25519 } from "@noble/curves/ed25519.js";
import { PASSKEY_WRAP_INFO, RECOVERY_WRAP_INFO, WRAPPED_KEY_FORMAT } from "./constants";
import { bytesEqual, concatBytes, fromBase64Url, toBase64Url, toHex, utf8 } from "./encoding";
import { ProtocolError } from "./errors";
import { sha256v } from "./hash";

export interface WrappedKey {
  format: typeof WRAPPED_KEY_FORMAT;
  salt: string;
  iv: string;
  ciphertext: string;
}

export type WrapPurpose = "passkey" | "recovery";

const info = (purpose: WrapPurpose) =>
  utf8(purpose === "passkey" ? PASSKEY_WRAP_INFO : RECOVERY_WRAP_INFO);

async function wrappingKey(
  secret: Uint8Array,
  salt: Uint8Array,
  purpose: WrapPurpose,
  usage: "encrypt" | "decrypt",
): Promise<Awaited<ReturnType<typeof crypto.subtle.deriveKey>>> {
  if (secret.length !== 32)
    throw new ProtocolError("INVALID_FORMAT", "wrapping secret must be 32 bytes");
  const ikm = await crypto.subtle.importKey("raw", buf(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: buf(salt),
      info: buf(info(purpose)),
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

const aad = (publicKey: Uint8Array, bindingId: Uint8Array) =>
  concatBytes(utf8(WRAPPED_KEY_FORMAT), publicKey, bindingId);

/** Encrypts a 32-byte Ed25519 seed under `secret`. */
export async function wrapSigningSeed(
  secret: Uint8Array,
  seed: Uint8Array,
  bind: { purpose: WrapPurpose; publicKey: Uint8Array; bindingId: Uint8Array },
): Promise<WrappedKey> {
  if (seed.length !== 32) throw new ProtocolError("INVALID_FORMAT", "seed must be 32 bytes");
  if (!bytesEqual(ed25519.getPublicKey(seed), bind.publicKey))
    throw new ProtocolError("INVALID_FORMAT", "seed does not match the public key");
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await wrappingKey(secret, salt, bind.purpose, "encrypt");
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: buf(iv),
        additionalData: buf(aad(bind.publicKey, bind.bindingId)),
      },
      key,
      buf(seed),
    ),
  );
  return {
    format: WRAPPED_KEY_FORMAT,
    salt: toBase64Url(salt),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(ciphertext),
  };
}

/** Decrypts a wrapped seed and checks that it belongs to `publicKey`. Throws on any mismatch. */
export async function unwrapSigningSeed(
  secret: Uint8Array,
  wrapped: WrappedKey,
  bind: { purpose: WrapPurpose; publicKey: Uint8Array; bindingId: Uint8Array },
): Promise<Uint8Array> {
  if (wrapped.format !== WRAPPED_KEY_FORMAT)
    throw new ProtocolError("INVALID_FORMAT", "unknown wrapped key format");
  const key = await wrappingKey(secret, fromBase64Url(wrapped.salt), bind.purpose, "decrypt");
  let seed: Uint8Array;
  try {
    seed = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: buf(fromBase64Url(wrapped.iv)),
          additionalData: buf(aad(bind.publicKey, bind.bindingId)),
        },
        key,
        buf(fromBase64Url(wrapped.ciphertext)),
      ),
    );
  } catch {
    throw new ProtocolError(
      "INVALID_FORMAT",
      "the key could not be unlocked with this passkey or kit",
    );
  }
  if (seed.length !== 32 || !bytesEqual(ed25519.getPublicKey(seed), bind.publicKey)) {
    seed.fill(0);
    throw new ProtocolError("INVALID_FORMAT", "unlocked key does not match the identity");
  }
  return seed;
}

// ---- signing keys -------------------------------------------------------------------------------------

/** A new Ed25519 seed from the platform CSPRNG (browser or Node WebCrypto). */
export function generateSigningSeed(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function publicKeyFromSeed(seed: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(seed);
}

/** Ed25519 signature (RFC 8032, deterministic). */
export function signWithSeed(message: Uint8Array, seed: Uint8Array): Uint8Array {
  return ed25519.sign(message, seed);
}

// ---- recovery kits ------------------------------------------------------------------------------------

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const KIT_PREFIX = "stele-rk1";

/** A new 32-byte recovery secret (shown to the user once; Stele stores only what it wraps). */
export function newRecoverySecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Public identifier of a kit (16 bytes, hex): lets the server find the wrap without the secret. */
export function recoveryKitId(secret: Uint8Array): string {
  return toHex(sha256v(utf8("stele:v1:recovery-kit-id\u0000"), secret).slice(0, 16));
}

/** `stele-rk1-xxxx-xxxx-…` with a 2-character checksum, for printing or saving. */
export function encodeRecoveryKit(secret: Uint8Array): string {
  if (secret.length !== 32)
    throw new ProtocolError("INVALID_FORMAT", "kit secret must be 32 bytes");
  const check = sha256v(utf8("stele:v1:recovery-kit-check\u0000"), secret)[0]!;
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of concatBytes(secret, Uint8Array.of(check))) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return [KIT_PREFIX, ...(out.match(/.{1,4}/g) ?? [])].join("-");
}

export function decodeRecoveryKit(text: string): Uint8Array {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, "");
  if (!normalized.startsWith(`${KIT_PREFIX}-`))
    throw new ProtocolError("INVALID_FORMAT", "not a Stele recovery kit");
  const body = normalized.slice(KIT_PREFIX.length + 1).replace(/-/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of body) {
    const v = BASE32.indexOf(ch);
    if (v < 0)
      throw new ProtocolError("INVALID_FORMAT", "recovery kit contains an invalid character");
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (bytes.length !== 33)
    throw new ProtocolError("INVALID_FORMAT", "recovery kit has the wrong length");
  const secret = Uint8Array.from(bytes.slice(0, 32));
  const check = sha256v(utf8("stele:v1:recovery-kit-check\u0000"), secret)[0]!;
  if (bytes[32] !== check)
    throw new ProtocolError("INVALID_FORMAT", "recovery kit checksum mismatch (typo?)");
  return secret;
}
