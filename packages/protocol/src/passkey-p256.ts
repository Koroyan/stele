/**
 * `stele/2` native passkey signatures (PROTOCOL_SPEC.md §17): a WebAuthn ES256 (P-256) credential
 * signs through the platform authenticator and its private key never leaves it. Solana's
 * secp256r1 precompile verifies the signature; the Stele program and every verifier bind it to an
 * acceptance with exactly these rules. Mirrors `crates/stele-core/src/passkey.rs` byte for byte.
 */
import { p256 } from "@noble/curves/nist.js";
import { address, getAddressEncoder, type Address, type Instruction } from "@solana/kit";
import { MESSAGE_STATEMENT, REQUESTED_BY_PREFIX } from "./constants";
import { bytesEqual, concatBytes, fromHex, fromUtf8, toBase64Url, toHex, utf8 } from "./encoding";
import { ProtocolError } from "./errors";
import { sha256, sha256v } from "./hash";
import { formatRfc3339, parseRfc3339 } from "./time";
import { validateHostname, validateRequestDomain } from "./validate";
import { LIMITS } from "./constants";

export const SECP256R1_PROGRAM_ADDRESS = address("Secp256r1SigVerify1111111111111111111111111");

export const P256_PUBLIC_KEY_LENGTH = 33;
export const P256_SIGNATURE_LENGTH = 64;
export const MAX_CLIENT_DATA_LENGTH = 512;
export const AUTHENTICATOR_DATA_MIN_LENGTH = 37;

export const FLAG_USER_PRESENT = 0x01;
export const FLAG_USER_VERIFIED = 0x04;
export const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;
export const FLAG_EXTENSION_DATA = 0x80;

export const PASSKEY_MESSAGE_HEADER = "Stele Protocol v2 - Accept Agreement";
export const P256_SIGNER_LABEL = "passkey-p256";
export const ENROLL_HEADER = "Stele Protocol v2 - Enroll Passkey Signer";
export const ROTATE_HEADER = "Stele Protocol v2 - Rotate Passkey Signer";

export const PASSKEY_ACCEPTANCE_TAG = utf8("stele:v2:passkey-acceptance\u0000");
export const PASSKEY_ACCEPTANCE_ID_TAG = utf8("stele:v2:passkey-acceptance-id\u0000");
export const PASSKEY_ENROLL_TAG = utf8("stele:v2:passkey-enroll\u0000");
export const PASSKEY_ROTATE_TAG = utf8("stele:v2:passkey-rotate\u0000");
/** Domain tag of salted account commitments in enrollments. */
export const ACCOUNT_COMMITMENT_TAG = utf8("stele:v2:account\u0000");

/** P-256 group order (for low-S normalization). */
const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/** The signer as messages name it: `passkey-p256 <66 hex>`. */
export function p256SignerLabel(publicKey: Uint8Array): string {
  if (publicKey.length !== P256_PUBLIC_KEY_LENGTH)
    throw new ProtocolError("INVALID_FORMAT", "P-256 signer keys are 33-byte compressed points");
  return `${P256_SIGNER_LABEL} ${toHex(publicKey)}`;
}

export function isCompressedP256Key(key: Uint8Array): boolean {
  return key.length === P256_PUBLIC_KEY_LENGTH && (key[0] === 0x02 || key[0] === 0x03);
}

export interface PasskeyAcceptanceFields {
  orgName: string;
  orgVerifiedDomain: string | null;
  title: string;
  versionLabel: string;
  version: number;
  versionHash: Uint8Array;
  /** 33-byte compressed P-256 public key. */
  signer: Uint8Array;
  networkLabel: string;
  issuedAt: number | bigint;
  expiresAt: number | bigint;
  shardId: number;
  nonceIndex: number;
  nonceTag: Uint8Array;
}

/** The `stele-acceptance-v2` message (PROTOCOL_SPEC.md §17.2). */
export function buildPasskeyAcceptanceMessage(
  f: PasskeyAcceptanceFields,
  requestDomain: string,
): string {
  validateRequestDomain(requestDomain);
  if (f.nonceTag.length !== 8)
    throw new ProtocolError("INVALID_FORMAT", "nonce tag must be 8 bytes");
  if (f.versionHash.length !== 32)
    throw new ProtocolError("INVALID_FORMAT", "version hash must be 32 bytes");
  const status = f.orgVerifiedDomain ? `verified: ${f.orgVerifiedDomain}` : "unverified";
  return [
    PASSKEY_MESSAGE_HEADER,
    MESSAGE_STATEMENT,
    `Organization: ${f.orgName} (${status})`,
    `Document: ${f.title}`,
    `Version: ${f.versionLabel} (#${f.version})`,
    `Fingerprint: ${toHex(f.versionHash)}`,
    `Signer: ${p256SignerLabel(f.signer)}`,
    `Network: ${f.networkLabel}`,
    `Issued: ${formatRfc3339(f.issuedAt)}`,
    `Expires: ${formatRfc3339(f.expiresAt)}`,
    `Nonce: ${f.shardId}-${f.nonceIndex}-${toHex(f.nonceTag)}`,
    REQUESTED_BY_PREFIX + requestDomain,
  ].join("\n");
}

export interface ParsedPasskeyAcceptanceMessage {
  orgName: string;
  orgVerifiedDomain: string | null;
  title: string;
  versionLabel: string;
  version: number;
  /** Hex. */
  versionHash: string;
  /** Compressed P-256 key, hex (66). */
  signer: string;
  networkLabel: string;
  issuedAt: number;
  expiresAt: number;
  shardId: number;
  nonceIndex: number;
  /** Hex (16). */
  nonceTag: string;
  requestDomain: string;
}

function line(text: string | undefined, label: string): string {
  const prefix = `${label}: `;
  if (text === undefined || !text.startsWith(prefix))
    throw new ProtocolError("MESSAGE_MISMATCH", `expected line "${label}: …"`);
  return text.slice(prefix.length);
}

/**
 * Strictly parses a `stele-acceptance-v2` message and requires canonical form (the parsed fields
 * must rebuild the same bytes). Parsing alone proves nothing: callers compare with chain data.
 */
export function parsePasskeyAcceptanceMessage(text: string): ParsedPasskeyAcceptanceMessage {
  const lines = text.split("\n");
  if (lines.length !== 12)
    throw new ProtocolError("MESSAGE_MISMATCH", `expected 12 lines, found ${lines.length}`);
  if (lines[0] !== PASSKEY_MESSAGE_HEADER)
    throw new ProtocolError("MESSAGE_MISMATCH", "not a Stele v2 acceptance message");
  if (lines[1] !== MESSAGE_STATEMENT)
    throw new ProtocolError("MESSAGE_MISMATCH", "unexpected statement line");
  const org = line(lines[2], "Organization");
  const open = org.lastIndexOf(" (");
  if (open < 1 || !org.endsWith(")"))
    throw new ProtocolError("MESSAGE_MISMATCH", "malformed organization line");
  const status = org.slice(open + 2, -1);
  let orgVerifiedDomain: string | null = null;
  if (status.startsWith("verified: ")) orgVerifiedDomain = status.slice("verified: ".length);
  else if (status !== "unverified")
    throw new ProtocolError("MESSAGE_MISMATCH", "malformed verification status");
  const versionLine = /^(\S+) \(#([1-9][0-9]*)\)$/.exec(line(lines[4], "Version"));
  if (!versionLine) throw new ProtocolError("MESSAGE_MISMATCH", "malformed version line");
  const versionHash = line(lines[5], "Fingerprint");
  if (!/^[0-9a-f]{64}$/.test(versionHash))
    throw new ProtocolError("MESSAGE_MISMATCH", "malformed fingerprint");
  const signer = /^passkey-p256 (0[23][0-9a-f]{64})$/.exec(line(lines[6], "Signer"));
  if (!signer) throw new ProtocolError("MESSAGE_MISMATCH", "malformed signer");
  const nonce = /^(0|[1-9][0-9]*)-(0|[1-9][0-9]*)-([0-9a-f]{16})$/.exec(line(lines[10], "Nonce"));
  if (!nonce) throw new ProtocolError("MESSAGE_MISMATCH", "malformed nonce");
  if (!lines[11]!.startsWith(REQUESTED_BY_PREFIX))
    throw new ProtocolError("MESSAGE_MISMATCH", "missing requesting site");
  const parsed: ParsedPasskeyAcceptanceMessage = {
    orgName: org.slice(0, open),
    orgVerifiedDomain,
    title: line(lines[3], "Document"),
    versionLabel: versionLine[1]!,
    version: Number(versionLine[2]),
    versionHash,
    signer: signer[1]!,
    networkLabel: line(lines[7], "Network"),
    issuedAt: parseRfc3339(line(lines[8], "Issued")),
    expiresAt: parseRfc3339(line(lines[9], "Expires")),
    shardId: Number(nonce[1]),
    nonceIndex: Number(nonce[2]),
    nonceTag: nonce[3]!,
    requestDomain: lines[11]!.slice(REQUESTED_BY_PREFIX.length),
  };
  const rebuilt = buildPasskeyAcceptanceMessage(
    {
      ...parsed,
      versionHash: fromHex(parsed.versionHash, 32),
      signer: fromHex(parsed.signer, 33),
      nonceTag: fromHex(parsed.nonceTag, 8),
    },
    parsed.requestDomain,
  );
  if (rebuilt !== text)
    throw new ProtocolError("MESSAGE_MISMATCH", "message is not in canonical form");
  return parsed;
}

export function validateRpId(rpId: string): void {
  validateHostname("relying party", rpId, LIMITS.requestDomain, true);
}

/** Statement a new passkey signs to enroll under an organization and an account commitment. */
export function buildEnrollmentStatement(i: {
  organization: Address;
  accountCommitment: Uint8Array;
  signer: Uint8Array;
  rpId: string;
  networkLabel: string;
  issuedAt: number | bigint;
  expiresAt: number | bigint;
}): string {
  validateRpId(i.rpId);
  return [
    ENROLL_HEADER,
    `Organization: ${i.organization}`,
    `Account commitment: ${toHex(i.accountCommitment)}`,
    `Signer: ${p256SignerLabel(i.signer)}`,
    `Relying party: ${i.rpId}`,
    `Network: ${i.networkLabel}`,
    `Issued: ${formatRfc3339(i.issuedAt)}`,
    `Expires: ${formatRfc3339(i.expiresAt)}`,
  ].join("\n");
}

/** Statement the current passkey signs to hand its enrollment to a new key. */
export function buildRotationStatement(i: {
  organization: Address;
  accountCommitment: Uint8Array;
  previous: Uint8Array;
  next: Uint8Array;
  networkLabel: string;
  issuedAt: number | bigint;
  expiresAt: number | bigint;
}): string {
  return [
    ROTATE_HEADER,
    `Organization: ${i.organization}`,
    `Account commitment: ${toHex(i.accountCommitment)}`,
    `Previous signer: ${p256SignerLabel(i.previous)}`,
    `New signer: ${p256SignerLabel(i.next)}`,
    `Network: ${i.networkLabel}`,
    `Issued: ${formatRfc3339(i.issuedAt)}`,
    `Expires: ${formatRfc3339(i.expiresAt)}`,
  ].join("\n");
}

/** WebAuthn challenge for `message` under a statement-kind tag. */
export function webauthnChallenge(tag: Uint8Array, message: string | Uint8Array): Uint8Array {
  return sha256v(tag, typeof message === "string" ? utf8(message) : message);
}

export function passkeyAcceptanceId(
  version: Uint8Array,
  signer: Uint8Array,
  messageHash: Uint8Array,
  signature: Uint8Array,
): Uint8Array {
  return sha256v(PASSKEY_ACCEPTANCE_ID_TAG, version, signer, messageHash, signature);
}

/**
 * Salted commitment to an organization's account identifier: never personal data on-chain, and not
 * brute-forceable from public data (the 32-byte salt is secret to the organization's Stele app).
 */
export function accountCommitment(
  organization: Address,
  salt: Uint8Array,
  externalUserRef: string,
): Uint8Array {
  if (salt.length !== 32) throw new ProtocolError("INVALID_FORMAT", "salt must be 32 bytes");
  return sha256v(
    ACCOUNT_COMMITMENT_TAG,
    new Uint8Array(getAddressEncoder().encode(organization)),
    salt,
    utf8(externalUserRef),
  );
}

export function rpIdCovers(rpId: string, requestDomain: string): boolean {
  if (rpId === requestDomain) return true;
  return (
    requestDomain.length > rpId.length + 1 &&
    requestDomain.endsWith(rpId) &&
    requestDomain[requestDomain.length - rpId.length - 1] === "."
  );
}

/** `https://<domain>`, or `http://localhost[:port]` for local development. */
export function passkeyOriginMatches(origin: string, requestDomain: string): boolean {
  if (origin.startsWith("https://")) return origin.slice(8) === requestDomain;
  if (requestDomain === "localhost" && origin.startsWith("http://localhost")) {
    const rest = origin.slice("http://localhost".length);
    if (rest === "") return true;
    const port = rest.startsWith(":") ? rest.slice(1) : null;
    return port !== null && /^[1-9][0-9]{0,4}$/.test(port);
  }
  return false;
}

export type PasskeyCheckError =
  | "INVALID_CLIENT_DATA"
  | "ORIGIN_MISMATCH"
  | "CROSS_ORIGIN_CEREMONY"
  | "INVALID_AUTHENTICATOR_DATA"
  | "RELYING_PARTY_MISMATCH"
  | "USER_NOT_VERIFIED"
  | "CLIENT_DATA_HASH_MISMATCH";

export class PasskeyCheckFailure extends Error {
  constructor(
    readonly code: PasskeyCheckError,
    message: string,
  ) {
    super(message);
  }
}

const fail = (code: PasskeyCheckError, message: string): never => {
  throw new PasskeyCheckFailure(code, message);
};

/** Checks assertion `clientDataJSON` as the program does; returns the browser-attested origin. */
export function checkClientData(
  clientData: Uint8Array,
  challenge: Uint8Array,
  requestDomain: string,
): string {
  if (clientData.length > MAX_CLIENT_DATA_LENGTH)
    fail("INVALID_CLIENT_DATA", "client data is too long");
  let text: string;
  try {
    text = fromUtf8(clientData);
  } catch {
    return fail("INVALID_CLIENT_DATA", "client data is not UTF-8");
  }
  const expected = `{"type":"webauthn.get","challenge":"${toBase64Url(challenge)}","origin":"`;
  if (!text.startsWith(expected))
    fail("INVALID_CLIENT_DATA", "client data is not an assertion for this challenge");
  const rest = text.slice(expected.length);
  const end = rest.indexOf('"');
  if (end < 0) fail("INVALID_CLIENT_DATA", "unterminated origin");
  const origin = rest.slice(0, end);
  if (origin.includes("\\") || !passkeyOriginMatches(origin, requestDomain))
    fail("ORIGIN_MISMATCH", `origin ${origin} is not the requesting site ${requestDomain}`);
  const tail = rest.slice(end + 1);
  if (!(tail === "}" || tail.startsWith(",")))
    fail("INVALID_CLIENT_DATA", "unexpected bytes after the origin");
  if (tail.startsWith(',"crossOrigin":') && !tail.slice(15).startsWith("false"))
    fail("CROSS_ORIGIN_CEREMONY", "the ceremony ran in a cross-origin frame");
  if (tail.includes('"topOrigin"') || tail.includes('"crossOrigin":true'))
    fail("CROSS_ORIGIN_CEREMONY", "the ceremony ran in a cross-origin frame");
  return origin;
}

/** Checks assertion authenticator data; returns the flags. */
export function checkAuthenticatorData(authenticatorData: Uint8Array, rpId: string): number {
  if (authenticatorData.length < AUTHENTICATOR_DATA_MIN_LENGTH)
    fail("INVALID_AUTHENTICATOR_DATA", "authenticator data is too short");
  if (!bytesEqual(authenticatorData.subarray(0, 32), sha256(utf8(rpId))))
    fail("RELYING_PARTY_MISMATCH", `authenticator data is not for relying party ${rpId}`);
  const flags = authenticatorData[32]!;
  if (!(flags & FLAG_USER_PRESENT) || !(flags & FLAG_USER_VERIFIED))
    fail("USER_NOT_VERIFIED", "the authenticator did not verify the user");
  if (flags & FLAG_ATTESTED_CREDENTIAL_DATA)
    fail("INVALID_AUTHENTICATOR_DATA", "attested credential data in an assertion");
  const hasExtensions = authenticatorData.length > AUTHENTICATOR_DATA_MIN_LENGTH;
  if (hasExtensions !== Boolean(flags & FLAG_EXTENSION_DATA))
    fail("INVALID_AUTHENTICATOR_DATA", "extension data does not match its flag");
  return flags;
}

export interface AssertionFacts {
  authenticatorData: Uint8Array;
  clientDataHash: Uint8Array;
  origin: string;
  flags: number;
}

/**
 * Binds the precompile-verified bytes (`authenticatorData ‖ SHA-256(clientDataJSON)`) to the
 * challenge, the requesting site and the relying party (the program's rules).
 */
export function checkPasskeyAssertion(i: {
  signed: Uint8Array;
  clientData: Uint8Array;
  challenge: Uint8Array;
  requestDomain: string;
  rpId: string;
}): AssertionFacts {
  validateRequestDomain(i.requestDomain);
  validateRpId(i.rpId);
  if (!rpIdCovers(i.rpId, i.requestDomain))
    fail("RELYING_PARTY_MISMATCH", `${i.rpId} does not cover ${i.requestDomain}`);
  if (i.signed.length < AUTHENTICATOR_DATA_MIN_LENGTH + 32)
    fail("INVALID_AUTHENTICATOR_DATA", "signed bytes are too short");
  const authenticatorData = i.signed.subarray(0, i.signed.length - 32);
  const clientDataHash = sha256(i.clientData);
  if (!bytesEqual(i.signed.subarray(i.signed.length - 32), clientDataHash))
    fail("CLIENT_DATA_HASH_MISMATCH", "client data does not match the signed hash");
  const origin = checkClientData(i.clientData, i.challenge, i.requestDomain);
  const flags = checkAuthenticatorData(authenticatorData, i.rpId);
  return { authenticatorData, clientDataHash, origin, flags };
}

// ---- keys and signatures --------------------------------------------------------------------------

const P256_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
  0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

/**
 * The compressed 33-byte key of a P-256 public key given as SPKI DER (what
 * `AuthenticatorAttestationResponse.getPublicKey()` returns), an uncompressed 65-byte point, or an
 * already compressed point. Rejects anything that is not a point on the curve.
 */
export function compressP256PublicKey(key: Uint8Array): Uint8Array {
  let point = key;
  if (key.length === P256_SPKI_PREFIX.length + 65) {
    if (!bytesEqual(key.subarray(0, P256_SPKI_PREFIX.length), P256_SPKI_PREFIX))
      throw new ProtocolError("INVALID_FORMAT", "not a P-256 SubjectPublicKeyInfo");
    point = key.subarray(P256_SPKI_PREFIX.length);
  }
  try {
    return p256.Point.fromBytes(point).toBytes(true);
  } catch {
    throw new ProtocolError("INVALID_FORMAT", "not a P-256 public key");
  }
}

/** A WebAuthn ES256 signature (ASN.1 DER) as the precompile wants it: compact `r ‖ s`, low-S. */
export function p256SignatureFromDer(der: Uint8Array): Uint8Array {
  let sig: ReturnType<typeof p256.Signature.fromBytes>;
  try {
    sig = p256.Signature.fromBytes(der, "der");
  } catch {
    throw new ProtocolError("INVALID_FORMAT", "not an ASN.1 DER ECDSA signature");
  }
  if (sig.hasHighS()) sig = new p256.Signature(sig.r, P256_ORDER - sig.s);
  return sig.toBytes("compact");
}

/** What the precompile checks: low-S ECDSA P-256 over SHA-256(`message`). */
export function verifyP256(
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): boolean {
  try {
    return p256.verify(signature, message, publicKey, {
      prehash: true,
      lowS: true,
      format: "compact",
    });
  } catch {
    return false;
  }
}

/**
 * The canonical single-signature secp256r1 precompile instruction (self-contained offsets), the
 * only layout the Stele program accepts.
 */
export function secp256r1Instruction(
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): Instruction {
  if (!isCompressedP256Key(publicKey))
    throw new ProtocolError("INVALID_FORMAT", "expected a 33-byte compressed P-256 key");
  if (signature.length !== P256_SIGNATURE_LENGTH)
    throw new ProtocolError("INVALID_FORMAT", "expected a 64-byte compact signature");
  if (message.length > 0xffff) throw new ProtocolError("INVALID_FORMAT", "message too long");
  const header = new Uint8Array(16);
  const view = new DataView(header.buffer);
  header[0] = 1;
  header[1] = 0;
  const offsets = [49, 0xffff, 16, 0xffff, 113, message.length, 0xffff];
  offsets.forEach((v, i) => view.setUint16(2 + i * 2, v, true));
  return {
    programAddress: SECP256R1_PROGRAM_ADDRESS,
    accounts: [],
    data: concatBytes(header, publicKey, signature, message),
  };
}

export interface ParsedSecp256r1 {
  publicKey: Uint8Array;
  signature: Uint8Array;
  message: Uint8Array;
}

/** Parses a canonical secp256r1 instruction exactly as the program does (null otherwise). */
export function parseSecp256r1Instruction(data: Uint8Array): ParsedSecp256r1 | null {
  if (data.length <= 113 || data[0] !== 1 || data[1] !== 0) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (o: number) => view.getUint16(o, true);
  if (u16(2) !== 49 || u16(6) !== 16 || u16(10) !== 113) return null;
  if (u16(4) !== 0xffff || u16(8) !== 0xffff || u16(14) !== 0xffff) return null;
  if (data.length !== 113 + u16(12)) return null;
  return {
    publicKey: data.slice(16, 49),
    signature: data.slice(49, 113),
    message: data.slice(113),
  };
}

/**
 * Text identifier of a P-256 signer in APIs and databases: `p256:` + 66 hex characters. Never
 * confusable with a Solana address (base58, 32 bytes).
 */
export function p256KeyId(publicKey: Uint8Array): string {
  if (!isCompressedP256Key(publicKey))
    throw new ProtocolError("INVALID_FORMAT", "expected a 33-byte compressed P-256 key");
  return `p256:${toHex(publicKey)}`;
}

export function isP256KeyId(s: string): boolean {
  return /^p256:0[23][0-9a-f]{64}$/.test(s);
}

export function p256KeyFromId(id: string): Uint8Array {
  if (!isP256KeyId(id)) throw new ProtocolError("INVALID_FORMAT", "not a p256: signer id");
  return fromHex(id.slice(5));
}
