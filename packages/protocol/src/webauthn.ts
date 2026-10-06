/**
 * Passkey (WebAuthn) evidence for passkey-protected Stele signing keys (PROTOCOL_SPEC.md §14).
 *
 * A walletless signer's Ed25519 key lives encrypted under its passkey's PRF output. Two kinds of
 * WebAuthn assertions make the passkey's role verifiable by anyone:
 *
 * * a **key statement** (registration, added passkey, rotation) is signed by the Ed25519 key and
 *   endorsed by an assertion over `SHA-256(PASSKEY_STATEMENT_TAG || statement)`;
 * * every **signed message** (acceptance or proof) carries an assertion over
 *   `SHA-256(PASSKEY_SIGNATURE_TAG || message)`, made with user verification at the requesting
 *   site's origin. The same ceremony releases the PRF output that unlocks the key.
 *
 * Verification here needs no CBOR: the credential public key is the SubjectPublicKeyInfo the browser
 * reports (`getPublicKey()`), and it is accepted only once an assertion verifies under it.
 * Supported algorithms: ES256 (-7), EdDSA/Ed25519 (-8), RS256 (-257).
 */
import { buf } from "./internal";
import { ed25519 } from "@noble/curves/ed25519.js";
import { p256 } from "@noble/curves/nist.js";
import { PASSKEY_SIGNATURE_TAG, PASSKEY_STATEMENT_TAG } from "./constants";
import {
  bytesEqual,
  concatBytes,
  fromBase64Url,
  fromUtf8,
  toBase64Url,
  toHex,
  utf8,
} from "./encoding";
import { ProtocolError } from "./errors";
import { sha256, sha256v } from "./hash";
import { formatRfc3339, parseRfc3339 } from "./time";
import { validateChainId, validateRequestDomain } from "./validate";

export const COSE_ES256 = -7;
export const COSE_EDDSA = -8;
export const COSE_RS256 = -257;
export const SUPPORTED_PASSKEY_ALGORITHMS = [COSE_ES256, COSE_EDDSA, COSE_RS256] as const;
export type PasskeyAlgorithm = (typeof SUPPORTED_PASSKEY_ALGORITHMS)[number];

/** Signer types recorded in receipts. Only the second one is provable beyond the key itself. */
export type SignerType = "WALLET" | "PASSKEY_PROTECTED_STELE_KEY";

/** The WebAuthn challenge for signing a Stele message (acceptance or proof). */
export function passkeySignatureChallenge(message: string | Uint8Array): Uint8Array {
  return sha256v(
    utf8(PASSKEY_SIGNATURE_TAG),
    typeof message === "string" ? utf8(message) : message,
  );
}

/** The WebAuthn challenge endorsing a key statement. */
export function passkeyStatementChallenge(statement: string): Uint8Array {
  return sha256v(utf8(PASSKEY_STATEMENT_TAG), utf8(statement));
}

/** A WebAuthn assertion as transported in Stele evidence (all fields base64url). */
export interface PasskeyAssertion {
  credentialId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

/** A passkey as registered: id, SubjectPublicKeyInfo, COSE algorithm and relying-party ID. */
export interface PasskeyCredential {
  credentialId: string;
  publicKey: string;
  algorithm: number;
  rpId: string;
}

export interface AuthenticatorData {
  rpIdHash: Uint8Array;
  userPresent: boolean;
  userVerified: boolean;
  backupEligible: boolean;
  backedUp: boolean;
  signCount: number;
}

export function parseAuthenticatorData(bytes: Uint8Array): AuthenticatorData {
  if (bytes.length < 37) throw new ProtocolError("DECODE_ERROR", "authenticator data too short");
  const flags = bytes[32]!;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    rpIdHash: bytes.slice(0, 32),
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    backupEligible: (flags & 0x08) !== 0,
    backedUp: (flags & 0x10) !== 0,
    signCount: view.getUint32(33, false),
  };
}

export interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

export function parseClientData(bytes: Uint8Array): ClientData {
  let json: unknown;
  try {
    json = JSON.parse(fromUtf8(bytes));
  } catch {
    throw new ProtocolError("DECODE_ERROR", "clientDataJSON is not JSON");
  }
  const c = json as Partial<ClientData>;
  if (typeof c !== "object" || c === null || typeof c.type !== "string")
    throw new ProtocolError("DECODE_ERROR", "clientDataJSON lacks a type");
  if (typeof c.challenge !== "string" || typeof c.origin !== "string")
    throw new ProtocolError("DECODE_ERROR", "clientDataJSON lacks challenge or origin");
  return {
    type: c.type,
    challenge: c.challenge,
    origin: c.origin,
    crossOrigin: c.crossOrigin === true,
  };
}

const isLocalHost = (host: string) => host === "localhost" || host.endsWith(".localhost");

/**
 * Whether a WebAuthn origin belongs to `host`: `https://host[:port]`, or `http://` for localhost
 * (browsers treat localhost as a secure context).
 */
export function originMatchesHost(origin: string, host: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin || url.hostname !== host) return false;
  return url.protocol === "https:" || (url.protocol === "http:" && isLocalHost(host));
}

/** WebAuthn: the RP ID must equal the origin's host or be a parent domain of it. */
export function rpIdCoversHost(rpId: string, host: string): boolean {
  return host === rpId || host.endsWith(`.${rpId}`);
}

// ---- signature verification -------------------------------------------------------------------------

const P256_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
  0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);
const ED25519_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

function spkiTail(spki: Uint8Array, prefix: Uint8Array, length: number): Uint8Array {
  if (
    spki.length !== prefix.length + length ||
    !bytesEqual(spki.subarray(0, prefix.length), prefix)
  )
    throw new ProtocolError("DECODE_ERROR", "unexpected public key encoding");
  return spki.slice(prefix.length);
}

/** Checks that a SubjectPublicKeyInfo is usable with the declared COSE algorithm. */
export async function checkPasskeyPublicKey(spki: Uint8Array, algorithm: number): Promise<void> {
  if (algorithm === COSE_ES256) {
    p256.Point.fromBytes(spkiTail(spki, P256_SPKI_PREFIX, 65)).assertValidity();
  } else if (algorithm === COSE_EDDSA) {
    ed25519.Point.fromBytes(spkiTail(spki, ED25519_SPKI_PREFIX, 32));
  } else if (algorithm === COSE_RS256) {
    const key = await crypto.subtle.importKey(
      "spki",
      buf(spki),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const bits = (key.algorithm as unknown as { modulusLength: number }).modulusLength;
    if (bits < 2048) throw new ProtocolError("INVALID_FORMAT", "RSA passkeys need ≥ 2048 bits");
  } else {
    throw new ProtocolError("INVALID_FORMAT", `unsupported passkey algorithm ${algorithm}`);
  }
}

async function verifySignature(
  algorithm: number,
  spki: Uint8Array,
  signed: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    if (algorithm === COSE_ES256) {
      // WebAuthn ECDSA signatures are DER-encoded and may be high-S.
      return p256.verify(signature, signed, spkiTail(spki, P256_SPKI_PREFIX, 65), {
        format: "der",
        lowS: false,
        prehash: true,
      });
    }
    if (algorithm === COSE_EDDSA) {
      return ed25519.verify(signature, signed, spkiTail(spki, ED25519_SPKI_PREFIX, 32), {
        zip215: false,
      });
    }
    if (algorithm === COSE_RS256) {
      const key = await crypto.subtle.importKey(
        "spki",
        buf(spki),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, buf(signature), buf(signed));
    }
  } catch {
    return false;
  }
  return false;
}

export interface AssertionExpectations {
  /** The exact challenge bytes the assertion must sign. */
  challenge: Uint8Array;
  /** The host the ceremony must have run on (the message's `Requested by` domain). */
  host: string;
  /** Stored signature counter; a non-zero counter must increase. */
  previousSignCount?: number;
}

export type AssertionCheck =
  | { ok: true; signCount: number; origin: string; backedUp: boolean }
  | { ok: false; reason: string };

/**
 * Verifies a WebAuthn assertion against a registered passkey: type, challenge, origin, RP ID,
 * user presence **and user verification**, signature, and counter regression.
 */
export async function verifyPasskeyAssertion(
  assertion: PasskeyAssertion,
  credential: PasskeyCredential,
  expect: AssertionExpectations,
): Promise<AssertionCheck> {
  let authData: Uint8Array, clientDataBytes: Uint8Array, signature: Uint8Array, spki: Uint8Array;
  try {
    authData = fromBase64Url(assertion.authenticatorData);
    clientDataBytes = fromBase64Url(assertion.clientDataJSON);
    signature = fromBase64Url(assertion.signature);
    spki = fromBase64Url(credential.publicKey);
  } catch {
    return { ok: false, reason: "assertion fields are not valid base64url" };
  }
  if (assertion.credentialId !== credential.credentialId)
    return { ok: false, reason: "assertion was made with a different passkey" };
  let client: ClientData, auth: AuthenticatorData;
  try {
    client = parseClientData(clientDataBytes);
    auth = parseAuthenticatorData(authData);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  if (client.type !== "webauthn.get")
    return { ok: false, reason: "not an authentication assertion" };
  if (client.challenge !== toBase64Url(expect.challenge))
    return { ok: false, reason: "assertion signs a different challenge" };
  if (client.crossOrigin) return { ok: false, reason: "cross-origin assertions are not accepted" };
  if (!originMatchesHost(client.origin, expect.host))
    return { ok: false, reason: `assertion was made on ${client.origin}, not ${expect.host}` };
  if (!rpIdCoversHost(credential.rpId, expect.host))
    return { ok: false, reason: `passkey belongs to ${credential.rpId}, not ${expect.host}` };
  if (!bytesEqual(auth.rpIdHash, sha256(utf8(credential.rpId))))
    return { ok: false, reason: "authenticator data is for a different relying party" };
  if (!auth.userPresent) return { ok: false, reason: "user presence was not confirmed" };
  if (!auth.userVerified) return { ok: false, reason: "user verification was not performed" };
  const signed = concatBytes(authData, sha256(clientDataBytes));
  if (!(await verifySignature(credential.algorithm, spki, signed, signature)))
    return { ok: false, reason: "passkey signature does not verify" };
  const previous = expect.previousSignCount ?? 0;
  if ((auth.signCount !== 0 || previous !== 0) && auth.signCount <= previous)
    return {
      ok: false,
      reason: "signature counter did not increase (possible cloned authenticator)",
    };
  return { ok: true, signCount: auth.signCount, origin: client.origin, backedUp: auth.backedUp };
}

/** The parts of a `navigator.credentials.create()` response Stele checks (base64url fields). */
export interface PasskeyRegistrationResponse {
  credentialId: string;
  /** `AuthenticatorAttestationResponse.getPublicKey()` (SubjectPublicKeyInfo). */
  publicKey: string;
  /** `getPublicKeyAlgorithm()`. */
  algorithm: number;
  clientDataJSON: string;
  /** `getAuthenticatorData()`. */
  authenticatorData: string;
}

/**
 * Checks a registration ceremony (attestation format "none": the authenticator's make and model are
 * not verified — Stele does not need them). The credential public key is only *trusted* once an
 * assertion verifies under it, which registration also requires (the key statement endorsement).
 */
export async function verifyPasskeyRegistration(
  r: PasskeyRegistrationResponse,
  expect: { challenge: Uint8Array; host: string; rpId: string },
): Promise<{ ok: true; backedUp: boolean } | { ok: false; reason: string }> {
  let client: ClientData, auth: AuthenticatorData, flags: number;
  try {
    client = parseClientData(fromBase64Url(r.clientDataJSON));
    const authBytes = fromBase64Url(r.authenticatorData);
    auth = parseAuthenticatorData(authBytes);
    flags = authBytes[32]!;
    if (!/^[A-Za-z0-9_-]{16,1366}$/.test(r.credentialId)) throw new Error("credential id");
    await checkPasskeyPublicKey(fromBase64Url(r.publicKey), r.algorithm);
  } catch (e) {
    return { ok: false, reason: `malformed registration: ${(e as Error).message}` };
  }
  if (client.type !== "webauthn.create") return { ok: false, reason: "not a registration" };
  if (client.challenge !== toBase64Url(expect.challenge))
    return { ok: false, reason: "registration answers a different challenge" };
  if (client.crossOrigin)
    return { ok: false, reason: "cross-origin registrations are not accepted" };
  if (!originMatchesHost(client.origin, expect.host))
    return { ok: false, reason: `registration was made on ${client.origin}, not ${expect.host}` };
  if (!rpIdCoversHost(expect.rpId, expect.host))
    return { ok: false, reason: "relying party does not cover the signing site" };
  if (!bytesEqual(auth.rpIdHash, sha256(utf8(expect.rpId))))
    return { ok: false, reason: "registration is for a different relying party" };
  if (!auth.userPresent || !auth.userVerified)
    return { ok: false, reason: "registration requires user verification" };
  if ((flags & 0x40) === 0) return { ok: false, reason: "no attested credential data" };
  return { ok: true, backedUp: auth.backedUp };
}

// ---- key statements ---------------------------------------------------------------------------------

export const KEY_STATEMENT_HEADER = "Stele Protocol v1 - Signing Key Statement";

export type KeyStatementAction =
  "REGISTER" | "ADD_PASSKEY" | "ADD_RECOVERY_KIT" | "REVOKE_PASSKEY" | "ROTATE";

const ACTION_TEXT: Record<KeyStatementAction, string> = {
  REGISTER: "Register this key, protected by the passkey below.",
  ADD_PASSKEY: "Allow the passkey below to unlock this key.",
  ADD_RECOVERY_KIT: "Allow the recovery kit below to unlock this key.",
  REVOKE_PASSKEY: "The passkey below may no longer unlock this key.",
  ROTATE: "Replace my previous key with this key.",
};

export interface KeyStatementFields {
  action: KeyStatementAction;
  /** Base58 organization address the identity belongs to. */
  organization: string;
  /** Base58 Ed25519 public key the statement is about. */
  key: string;
  /** For ROTATE: the key being replaced. */
  previousKey?: string;
  /** For REGISTER / ADD_PASSKEY / ROTATE: the passkey (REVOKE_PASSKEY: only its credential ID). */
  passkey?: { credentialId: string; publicKey?: string; rpId?: string };
  /** For ADD_RECOVERY_KIT: the kit identifier (hex). */
  recoveryKitId?: string;
  chainId: string;
  issuedAt: number;
}

const BASE58_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CREDENTIAL_ID = /^[A-Za-z0-9_-]{16,1366}$/;

const passes = (validator: (s: string) => void, value: string) => {
  try {
    validator(value);
    return true;
  } catch {
    return false;
  }
};

function checkValue(label: string, value: string): void {
  const rules: Record<string, (v: string) => boolean> = {
    "Organization ID": (v) => BASE58_KEY.test(v),
    Key: (v) => BASE58_KEY.test(v),
    "Previous key": (v) => BASE58_KEY.test(v),
    Passkey: (v) => CREDENTIAL_ID.test(v),
    "Passkey key": (v) => /^[0-9a-f]{64}$/.test(v),
    "Recovery kit": (v) => /^[0-9a-f]{32}$/.test(v),
    "Relying party": (v) => passes(validateRequestDomain, v),
    Chain: (v) => passes(validateChainId, v),
    Issued: () => true,
  };
  const rule = rules[label];
  if (!rule || !rule(value))
    throw new ProtocolError("INVALID_FORMAT", `invalid ${label} in key statement`);
}

/** The canonical statement text. Every value is validated, so each line is unambiguous. */
export function buildKeyStatement(f: KeyStatementFields): string {
  const lines = [KEY_STATEMENT_HEADER, ACTION_TEXT[f.action], `Organization ID: ${f.organization}`];
  if (f.action === "ROTATE") {
    if (!f.previousKey)
      throw new ProtocolError("INVALID_FORMAT", "rotation needs the previous key");
    lines.push(`Previous key: ${f.previousKey}`);
  }
  lines.push(`Key: ${f.key}`);
  if (f.action === "ADD_RECOVERY_KIT") {
    if (!f.recoveryKitId || !/^[0-9a-f]{32}$/.test(f.recoveryKitId))
      throw new ProtocolError("INVALID_FORMAT", "recovery kit id must be 16 bytes of hex");
    lines.push(`Recovery kit: ${f.recoveryKitId}`);
  } else if (f.action === "REVOKE_PASSKEY") {
    if (!f.passkey) throw new ProtocolError("INVALID_FORMAT", "statement needs a passkey");
    lines.push(`Passkey: ${f.passkey.credentialId}`);
  } else {
    if (!f.passkey?.publicKey || !f.passkey.rpId)
      throw new ProtocolError("INVALID_FORMAT", "statement needs a passkey");
    lines.push(
      `Passkey: ${f.passkey.credentialId}`,
      `Passkey key: ${toHex(sha256(fromBase64Url(f.passkey.publicKey)))}`,
      `Relying party: ${f.passkey.rpId}`,
    );
  }
  lines.push(`Chain: ${f.chainId}`, `Issued: ${formatRfc3339(f.issuedAt)}`);
  for (const line of lines.slice(2)) {
    const i = line.indexOf(": ");
    checkValue(line.slice(0, i), line.slice(i + 2));
  }
  return lines.join("\n");
}

/** Parses the fields that can be read back from a statement (and checks canonical form). */
export function parseKeyStatement(text: string): {
  action: KeyStatementAction;
  organization: string;
  key: string;
  previousKey: string | null;
  credentialId: string | null;
  passkeyKeyHash: string | null;
  rpId: string | null;
  recoveryKitId: string | null;
  chainId: string;
  issuedAt: number;
} {
  const lines = text.split("\n");
  const action = (Object.keys(ACTION_TEXT) as KeyStatementAction[]).find(
    (a) => ACTION_TEXT[a] === lines[1],
  );
  if (lines[0] !== KEY_STATEMENT_HEADER || !action)
    throw new ProtocolError("MESSAGE_MISMATCH", "not a Stele key statement");
  const map = new Map<string, string>();
  for (const line of lines.slice(2)) {
    const i = line.indexOf(": ");
    if (i < 1) throw new ProtocolError("MESSAGE_MISMATCH", "malformed statement line");
    const label = line.slice(0, i);
    if (map.has(label)) throw new ProtocolError("MESSAGE_MISMATCH", `duplicate ${label}`);
    try {
      checkValue(label, line.slice(i + 2));
    } catch {
      throw new ProtocolError("MESSAGE_MISMATCH", `invalid ${label} in key statement`);
    }
    map.set(label, line.slice(i + 2));
  }
  const get = (label: string) => map.get(label) ?? null;
  const out = {
    action,
    organization: get("Organization ID") ?? "",
    key: get("Key") ?? "",
    previousKey: get("Previous key"),
    credentialId: get("Passkey"),
    passkeyKeyHash: get("Passkey key"),
    rpId: get("Relying party"),
    recoveryKitId: get("Recovery kit"),
    chainId: get("Chain") ?? "",
    issuedAt: parseRfc3339(get("Issued") ?? ""),
  };
  // Canonical form: rebuilding from the parsed fields must give the same text. The passkey public
  // key is represented by its hash, so the rebuilt passkey line is compared line by line.
  const expectedLabels = [
    "Organization ID",
    ...(action === "ROTATE" ? ["Previous key"] : []),
    "Key",
    ...(action === "ADD_RECOVERY_KIT"
      ? ["Recovery kit"]
      : action === "REVOKE_PASSKEY"
        ? ["Passkey"]
        : ["Passkey", "Passkey key", "Relying party"]),
    "Chain",
    "Issued",
  ];
  const labels = lines.slice(2).map((l) => l.slice(0, l.indexOf(": ")));
  if (JSON.stringify(labels) !== JSON.stringify(expectedLabels))
    throw new ProtocolError("MESSAGE_MISMATCH", "statement lines are not in canonical order");
  if (formatRfc3339(out.issuedAt) !== get("Issued"))
    throw new ProtocolError("MESSAGE_MISMATCH", "non-canonical time");
  return out;
}

/** Verifies the statement key's Ed25519 signature over the UTF-8 statement. */
export function verifyKeyStatementSignature(
  statement: string,
  keySignature: string,
  key: Uint8Array,
): boolean {
  try {
    return ed25519.verify(fromBase64Url(keySignature), utf8(statement), key, { zip215: false });
  } catch {
    return false;
  }
}

/** Evidence that a key statement was signed by its key and endorsed by a passkey. */
export interface EndorsedKeyStatement {
  statement: string;
  /** Base64url Ed25519 signature by the statement's key over the UTF-8 statement. */
  keySignature: string;
  /** Assertion over `passkeyStatementChallenge(statement)` (absent for recovery-kit statements). */
  passkeyAssertion?: PasskeyAssertion;
}
