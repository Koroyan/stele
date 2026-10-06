/** Shared request schemas. Every external input is validated before use. */
import { z } from "zod";

export const base58Address = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "expected a base58 Solana address");
export const base58Signature = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/, "expected a base58 signature");
export const hex32 = z.string().regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hex characters");
/** A native passkey signer: `p256:` + compressed P-256 key (66 lowercase hex). */
export const p256SignerId = z
  .string()
  .regex(/^p256:0[23][0-9a-f]{64}$/, "expected p256:<66 hex> (compressed P-256 key)");
/** Any signer key: a base58 Ed25519 key or a native passkey's `p256:…` key. */
export const signerKey = z.union([base58Address, p256SignerId]);
export const uuid = z.string().uuid();
export const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(32);

export const orgParams = z.object({ orgId: uuid });
export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});

export const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const b64url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/, "base64url");

export const passkeyAssertionBody = z
  .object({
    credentialId: b64url(1366),
    authenticatorData: b64url(4096),
    clientDataJSON: b64url(4096),
    signature: b64url(1024),
  })
  .strict();

export const wrappedKeyBody = z
  .object({
    format: z.literal("stele-wrapped-key-v1"),
    salt: b64url(64),
    iv: b64url(32),
    ciphertext: b64url(128),
  })
  .strict();

export const base64url = b64url;
