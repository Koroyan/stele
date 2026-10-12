/**
 * Native passkey signers (stele/2, PROTOCOL_SPEC.md §17).
 *
 * The passkey's own ES256 (P-256) key signs every acceptance. Its private key never leaves the
 * authenticator: no wrapped key, no PRF, nothing Stele or the organization could use to sign. The
 * secp256r1 precompile verifies each signature on-chain and the Stele program binds it to the
 * message, the requesting site and the relying party.
 *
 * Lifecycle (every step needs a user-verified WebAuthn ceremony on the requesting site):
 *
 *   options(register)  → create()  → register   → the new passkey signs an ENROLL statement (get())
 *                                                → confirm: possession proved; in account mode the
 *                                                  enrollment is anchored on-chain (PasskeySigner,
 *                                                  salted account commitment, no personal data)
 *   options(rotate)    → create()  → register   → the CURRENT passkey signs a ROTATE statement naming
 *                                                  the new key → confirm: rotated on-chain
 *   options(recover)   → create()  → register   → the new passkey signs an ENROLL statement (proof of
 *                                                  possession) → the organization's admin wallet
 *                                                  signs recover_passkey_signer: a visibly different,
 *                                                  NOT key-endorsed event
 *
 * The relayer only pays fees and rent; it cannot produce any of these signatures.
 */
import { randomBytes } from "node:crypto";
import { address } from "@solana/kit";
import {
  PASSKEY_ACCEPTANCE_TAG,
  PASSKEY_ENROLL_TAG,
  PASSKEY_ROTATE_TAG,
  PasskeyCheckFailure,
  accountCommitment,
  buildEnrollmentStatement,
  buildRotationStatement,
  checkPasskeyAssertion,
  compressP256PublicKey,
  concatBytes,
  decodePasskeySigner,
  enrollPasskeySignerInstruction,
  fetchAccountData,
  fetchProtocolConfig,
  findConfigPda,
  findPasskeySignerPda,
  fromBase64Url,
  fromHex,
  p256KeyFromId,
  p256KeyId,
  p256SignatureFromDer,
  rotatePasskeySignerInstruction,
  secp256r1Instruction,
  sha256,
  toBase64Url,
  toHex,
  utf8,
  verifyP256,
  verifyPasskeyAssertion,
  verifyPasskeyRegistration,
  webauthnChallenge,
  type PasskeyAssertion,
  type PasskeyRegistrationResponse,
} from "@stelehq/protocol";
import {
  and,
  eq,
  gte,
  isNull,
  isNotNull,
  nonceShards,
  organizations,
  passkeyChallenges,
  passkeyCredentials,
  signerIdentities,
  sponsoredTransactions,
  sql,
} from "@stele/db";
import type { Deps } from "../deps.js";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../errors.js";
import { enqueueWebhook } from "../lib/webhooks.js";
import { syncPasskeySigner } from "../lib/sync.js";
import {
  CEREMONY_TTL_MS,
  assertPasskeysAllowed,
  assertSiteAllowed,
  audit,
  openSession,
  orgByAddress,
  signingPolicy,
  takeCeremony,
} from "./signers.js";
import { assertCanRecord } from "./billing.js";
import { bookRecording, feeFacts } from "./sponsorship.js";

type Organization = typeof organizations.$inferSelect;
type Identity = typeof signerIdentities.$inferSelect;

export const COSE_ES256 = -7;
/** Validity of enrollment / rotation statements (cluster seconds). */
const STATEMENT_TTL_S = 600;
const ZERO_COMMITMENT = new Uint8Array(32);

export type NativePurpose = "register" | "rotate" | "recover";

// ---- assertions ---------------------------------------------------------------------------------------

export interface VerifiedNativeAssertion {
  /** Compact, low-S `r ‖ s` (what the precompile verifies). */
  signature: Uint8Array;
  /** `authenticatorData ‖ SHA-256(clientDataJSON)`. */
  signed: Uint8Array;
  clientData: Uint8Array;
  origin: string;
  flags: number;
  signCount: number;
}

const invalid = (reason: string) => new ApiError(400, "invalid_passkey_assertion", reason);

/**
 * Checks a native passkey assertion exactly as the program will: the P-256 signature over
 * `authenticatorData ‖ SHA-256(clientDataJSON)`, then the WebAuthn binding (challenge, origin =
 * requesting site, no cross-origin frame, relying party, user presence AND verification). Refusing
 * here means the relayer never pays for a transaction the program would reject.
 */
export function verifyNativeAssertion(
  assertion: PasskeyAssertion,
  i: {
    key: Uint8Array;
    challenge: Uint8Array;
    requestDomain: string;
    rpId: string;
    previousSignCount: number;
  },
): VerifiedNativeAssertion {
  let authenticatorData: Uint8Array, clientData: Uint8Array, der: Uint8Array;
  try {
    authenticatorData = fromBase64Url(assertion.authenticatorData);
    clientData = fromBase64Url(assertion.clientDataJSON);
    der = fromBase64Url(assertion.signature);
  } catch {
    throw invalid("assertion fields are not valid base64url");
  }
  let signature: Uint8Array;
  try {
    signature = p256SignatureFromDer(der);
  } catch {
    throw invalid("the passkey did not return an ES256 signature");
  }
  const signed = concatBytes(authenticatorData, sha256(clientData));
  if (!verifyP256(i.key, signature, signed))
    throw invalid("the passkey signature does not verify under this signer's key");
  let facts;
  try {
    facts = checkPasskeyAssertion({
      signed,
      clientData,
      challenge: i.challenge,
      requestDomain: i.requestDomain,
      rpId: i.rpId,
    });
  } catch (e) {
    if (e instanceof PasskeyCheckFailure) throw invalid(`${e.code}: ${e.message}`);
    throw e;
  }
  const signCount = new DataView(
    authenticatorData.buffer,
    authenticatorData.byteOffset + 33,
    4,
  ).getUint32(0, false);
  // A counter that stops increasing hints at a cloned authenticator (synced passkeys report 0).
  if ((i.previousSignCount > 0 || signCount > 0) && signCount <= i.previousSignCount)
    throw invalid("the authenticator's signature counter did not increase");
  return { signature, signed, clientData, origin: facts.origin, flags: facts.flags, signCount };
}

// ---- helpers ------------------------------------------------------------------------------------------

const credentialIdHash = (credentialId: string) => sha256(fromBase64Url(credentialId));

function isAccountBound(org: Organization): boolean {
  return signingPolicy(org) === "ACCOUNT_AND_PASSKEY";
}

async function accountIdentities(deps: Deps, org: Organization, externalUserRef: string) {
  return deps.db
    .select()
    .from(signerIdentities)
    .where(
      and(
        eq(signerIdentities.organizationId, org.id),
        eq(signerIdentities.externalUserRef, externalUserRef),
        eq(signerIdentities.algorithm, "p256-native"),
      ),
    );
}

async function identityById(deps: Deps, id: string | null): Promise<Identity> {
  if (!id) throw notFound("Signer");
  const [row] = await deps.db.select().from(signerIdentities).where(eq(signerIdentities.id, id));
  if (!row) throw notFound("Signer");
  return row;
}

async function activeCredentialIds(deps: Deps, identityId: string): Promise<string[]> {
  const rows = await deps.db
    .select({ id: passkeyCredentials.credentialId })
    .from(passkeyCredentials)
    .where(
      and(eq(passkeyCredentials.identityId, identityId), isNull(passkeyCredentials.revokedAt)),
    );
  return rows.map((r) => r.id);
}

/** A shard of the organization relayed by Stele (the program checks the relayer on enrollment). */
async function relayerShard(deps: Deps, org: Organization): Promise<string> {
  const [shard] = await deps.db
    .select({ address: nonceShards.address })
    .from(nonceShards)
    .where(
      and(
        eq(nonceShards.organizationId, org.id),
        eq(nonceShards.relayerAddress, deps.chain.relayer.address),
      ),
    )
    .limit(1);
  if (!shard)
    throw new ApiError(
      503,
      "no_acceptance_capacity",
      "This organization has no nonce shard relayed by Stele. An administrator must create one.",
    );
  return shard.address;
}

/** Bounds the rent the Stele relayer spends on enrollments per organization (sponsor hardening). */
async function assertEnrollmentBudget(deps: Deps, org: Organization): Promise<void> {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [{ n } = { n: 0 }] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(sponsoredTransactions)
    .where(
      and(
        eq(sponsoredTransactions.organizationId, org.id),
        eq(sponsoredTransactions.recordKind, "passkey_enrollment"),
        gte(sponsoredTransactions.createdAt, month),
      ),
    );
  if (n >= deps.config.STELE_MAX_ENROLLMENTS_PER_MONTH)
    throw new ApiError(
      429,
      "enrollment_limit",
      "This organization reached its monthly limit of on-chain passkey enrollments. Nothing was signed.",
    );
  await assertCanRecord(deps, org.id);
}

// ---- creation options ---------------------------------------------------------------------------------

export interface NativeCreationOptions {
  challengeId: string;
  /** Random registration challenge (base64url). */
  challenge: string;
  rpId: string;
  rpName: string;
  organization: string;
  user: { id: string; name: string; displayName: string };
  /** ES256 only: the key must be usable by the secp256r1 precompile. */
  algorithms: [typeof COSE_ES256];
  excludeCredentials: string[];
  /** Account mode: the passkey is enrolled on-chain under a salted account commitment. */
  accountBound: boolean;
}

/** Options for `navigator.credentials.create()` of a native passkey signer. */
export async function nativeCreationOptions(
  deps: Deps,
  input: {
    organization: string;
    purpose: NativePurpose;
    host: string;
    sessionToken?: string;
    /** rotate: the current signer (`p256:…`). */
    identity?: string;
  },
): Promise<NativeCreationOptions> {
  const org = await orgByAddress(deps, input.organization);
  assertPasskeysAllowed(org);
  assertSiteAllowed(org, input.host);
  const session = await openSession(deps, org, input.sessionToken);
  const accountBound = isAccountBound(org);
  const externalUserRef = session?.externalUserRef ?? null;
  if (accountBound && !externalUserRef)
    throw forbidden(
      "This organization binds passkeys to its own accounts: an acceptance session for your account is required",
    );
  if (!accountBound && input.purpose !== "register")
    throw badRequest(
      "not_account_bound",
      "Rotation and recovery apply to account-bound passkeys; register a new passkey instead",
    );

  const existing = externalUserRef ? await accountIdentities(deps, org, externalUserRef) : [];
  const enrolled = existing.find((i) => i.enrollmentAddress !== null);
  let previous: Identity | undefined;
  let salt: string | null = null;
  if (accountBound) {
    // One enrollment (PDA) per account: its salt, hence its commitment, is reused forever.
    salt = existing.find((i) => i.accountSalt)?.accountSalt ?? toHex(randomBytes(32));
    if (input.purpose === "register" && existing.some((i) => i.status === "active"))
      throw conflict(
        "identity_exists",
        "This account already has a passkey signer; rotate it (or ask the organization to recover it)",
      );
    if (input.purpose === "register" && enrolled)
      throw conflict(
        "identity_exists",
        "This account's enrollment exists on-chain; recover it through the organization",
      );
    if (input.purpose === "rotate") {
      if (!input.identity) throw badRequest("missing_identity", "identity is required");
      previous = existing.find((i) => i.publicKey === input.identity);
      if (!previous || previous.status !== "active" || !previous.enrollmentAddress)
        throw notFound("Signer");
    }
    if (input.purpose === "recover") {
      if (!enrolled) throw notFound("Enrollment");
      previous = existing.find((i) => i.status === "active") ?? enrolled;
    }
  }

  const exclude: string[] = [];
  for (const i of existing) exclude.push(...(await activeCredentialIds(deps, i.id)));
  const challenge = new Uint8Array(randomBytes(32));
  const [row] = await deps.db
    .insert(passkeyChallenges)
    .values({
      organizationId: org.id,
      purpose: `native_${input.purpose}`,
      challenge: toBase64Url(challenge),
      rpId: input.host,
      externalUserRef,
      acceptanceSessionId: session?.id ?? null,
      identityId: previous?.id ?? null,
      details: { accountSalt: salt },
      expiresAt: new Date(Date.now() + CEREMONY_TTL_MS),
    })
    .returning({ id: passkeyChallenges.id });
  return {
    challengeId: row!.id,
    challenge: toBase64Url(challenge),
    rpId: input.host,
    rpName: org.name,
    organization: org.address,
    // Random user handle: links nothing across sites and holds no personal data.
    user: {
      id: toBase64Url(new Uint8Array(randomBytes(16))),
      name: `${org.name} signer`,
      displayName: `${org.name} signer`,
    },
    algorithms: [COSE_ES256],
    excludeCredentials: exclude,
    accountBound,
  };
}

// ---- registration -------------------------------------------------------------------------------------

export interface NativeConfirmation {
  challengeId: string;
  /** WebAuthn challenge (base64url) = SHA-256(tag ‖ statement). */
  challenge: string;
  rpId: string;
  /** Which passkey must sign: the new one (enroll, recover) or the current one (rotate). */
  allowCredentials: string[];
  kind: "enroll" | "rotate" | "recover";
  statement: string;
}

export interface NativeRegistration {
  identity: string;
  status: "pending";
  confirm: NativeConfirmation;
}

/** Registers a native passkey (pending) and returns the statement it (or the current one) signs. */
export async function registerNativePasskey(
  deps: Deps,
  input: { challengeId: string; credential: PasskeyRegistrationResponse; label?: string },
  host: string,
): Promise<NativeRegistration> {
  const [pending] = await deps.db
    .select()
    .from(passkeyChallenges)
    .where(eq(passkeyChallenges.id, input.challengeId));
  const purpose = pending?.purpose.replace(/^native_/, "") as NativePurpose | undefined;
  if (!pending || !purpose || !["register", "rotate", "recover"].includes(purpose))
    throw badRequest("invalid_ceremony", "Unknown passkey request");
  const ceremony = await takeCeremony(deps, input.challengeId, pending.purpose, host);
  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, ceremony.organizationId));
  assertPasskeysAllowed(org!);

  if (input.credential.algorithm !== COSE_ES256)
    throw badRequest(
      "unsupported_algorithm",
      "Native passkey signing needs an ES256 (P-256) passkey",
    );
  const reg = await verifyPasskeyRegistration(input.credential, {
    challenge: fromBase64Url(ceremony.challenge),
    host,
    rpId: ceremony.rpId,
  });
  if (!reg.ok) throw badRequest("invalid_registration", reg.reason);
  const key = compressP256PublicKey(fromBase64Url(input.credential.publicKey));
  const keyId = p256KeyId(key);

  const [taken] = await deps.db
    .select({ id: passkeyCredentials.id })
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.credentialId, input.credential.credentialId));
  if (taken) throw conflict("passkey_exists", "This passkey is already registered");
  const [keyTaken] = await deps.db
    .select({ id: signerIdentities.id })
    .from(signerIdentities)
    .where(eq(signerIdentities.publicKey, keyId));
  if (keyTaken) throw conflict("identity_exists", "This key is already registered");

  const salt = (ceremony.details?.accountSalt as string | null | undefined) ?? null;
  const commitment =
    salt && ceremony.externalUserRef
      ? accountCommitment(address(org!.address), fromHex(salt, 32), ceremony.externalUserRef)
      : null;
  const previous = ceremony.identityId ? await identityById(deps, ceremony.identityId) : null;
  const [identity] = await deps.db
    .insert(signerIdentities)
    .values({
      organizationId: org!.id,
      publicKey: keyId,
      algorithm: "p256-native",
      rpId: ceremony.rpId,
      externalUserRef: ceremony.externalUserRef,
      status: "pending",
      accountSalt: salt,
      accountCommitment: commitment ? toHex(commitment) : null,
      rotatedFromId: purpose === "register" ? null : (previous?.id ?? null),
      rotationKind:
        purpose === "rotate" ? "endorsed" : purpose === "recover" ? "account_authorized" : null,
    })
    .returning();
  await deps.db.insert(passkeyCredentials).values({
    identityId: identity!.id,
    credentialId: input.credential.credentialId,
    publicKey: input.credential.publicKey,
    algorithm: COSE_ES256,
    rpId: ceremony.rpId,
    backedUp: reg.backedUp,
    label: input.label ?? null,
  });

  const { config } = await fetchProtocolConfig(deps.chain.rpc, deps.chain.programAddress);
  const issuedAt = await deps.chain.clusterTime();
  const expiresAt = issuedAt + STATEMENT_TTL_S;
  let statement: string;
  let tag: Uint8Array;
  let allow: string[];
  if (purpose === "rotate") {
    statement = buildRotationStatement({
      organization: address(org!.address),
      accountCommitment: commitment!,
      previous: p256KeyFromId(previous!.publicKey),
      next: key,
      networkLabel: config.networkLabel,
      issuedAt,
      expiresAt,
    });
    tag = PASSKEY_ROTATE_TAG;
    allow = await activeCredentialIds(deps, previous!.id);
  } else {
    statement = buildEnrollmentStatement({
      organization: address(org!.address),
      accountCommitment: commitment ?? ZERO_COMMITMENT,
      signer: key,
      rpId: ceremony.rpId,
      networkLabel: config.networkLabel,
      issuedAt,
      expiresAt,
    });
    tag = PASSKEY_ENROLL_TAG;
    allow = [input.credential.credentialId];
  }
  const kind = purpose === "register" ? "enroll" : purpose;
  const challenge = webauthnChallenge(tag, statement);
  const [next] = await deps.db
    .insert(passkeyChallenges)
    .values({
      organizationId: org!.id,
      purpose: `native_confirm_${kind}`,
      challenge: toBase64Url(challenge),
      rpId: ceremony.rpId,
      externalUserRef: ceremony.externalUserRef,
      acceptanceSessionId: ceremony.acceptanceSessionId,
      identityId: identity!.id,
      statement,
      details: { issuedAt, expiresAt, previousIdentityId: previous?.id ?? null },
      expiresAt: new Date(Date.now() + STATEMENT_TTL_S * 1000),
    })
    .returning({ id: passkeyChallenges.id });
  return {
    identity: keyId,
    status: "pending",
    confirm: {
      challengeId: next!.id,
      challenge: toBase64Url(challenge),
      rpId: ceremony.rpId,
      allowCredentials: allow,
      kind,
      statement,
    },
  };
}

// ---- confirmation -------------------------------------------------------------------------------------

export interface NativeConfirmResult {
  identity: string;
  status: "active" | "awaiting_organization";
  enrollment: string | null;
  transactionSignature: string | null;
  /** recover: what the organization's admin wallet must sign (recover_passkey_signer). */
  recovery: {
    enrollment: string;
    newSigner: string;
    newCredentialIdHash: string;
    rpIdHash: string;
  } | null;
}

/**
 * Completes a registration with the passkey's signature over its statement: proves possession,
 * and anchors (account mode) the enrollment or rotation on-chain.
 */
export async function confirmNativePasskey(
  deps: Deps,
  input: { challengeId: string; assertion: PasskeyAssertion },
  host: string,
): Promise<NativeConfirmResult> {
  const [pending] = await deps.db
    .select()
    .from(passkeyChallenges)
    .where(eq(passkeyChallenges.id, input.challengeId));
  const kind = pending?.purpose.replace(/^native_confirm_/, "") as
    "enroll" | "rotate" | "recover" | undefined;
  if (!pending || !kind || !["enroll", "rotate", "recover"].includes(kind))
    throw badRequest("invalid_ceremony", "Unknown passkey request");
  const ceremony = await takeCeremony(deps, input.challengeId, pending.purpose, host);
  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, ceremony.organizationId));
  assertPasskeysAllowed(org!);
  const identity = await identityById(deps, ceremony.identityId);
  if (identity.status !== "pending")
    throw conflict("challenge_not_open", "This passkey registration was already completed");
  const details = ceremony.details as {
    issuedAt: number;
    expiresAt: number;
    previousIdentityId: string | null;
  };
  const previous = details.previousIdentityId
    ? await identityById(deps, details.previousIdentityId)
    : null;

  // Who signs: the new passkey (enroll, recover) or the account's current one (rotate).
  const signerIdentity = kind === "rotate" ? previous! : identity;
  if (
    kind === "rotate" &&
    (signerIdentity.status !== "active" || !signerIdentity.enrollmentAddress)
  )
    throw forbidden("The current signer of this account changed; start again");
  const [credential] = await deps.db
    .select()
    .from(passkeyCredentials)
    .where(
      and(
        eq(passkeyCredentials.credentialId, input.assertion.credentialId),
        eq(passkeyCredentials.identityId, signerIdentity.id),
        isNull(passkeyCredentials.revokedAt),
      ),
    );
  if (!credential) throw forbidden("The assertion was not made with the expected passkey");
  const verified = verifyNativeAssertion(input.assertion, {
    key: p256KeyFromId(signerIdentity.publicKey),
    challenge: fromBase64Url(ceremony.challenge),
    requestDomain: host,
    rpId: identity.rpId,
    previousSignCount: credential.signCount,
  });
  if ((await deps.chain.clusterTime()) > details.expiresAt)
    throw conflict("challenge_expired", "The statement expired; start again");
  await deps.db
    .update(passkeyCredentials)
    .set({ signCount: verified.signCount, lastUsedAt: new Date() })
    .where(eq(passkeyCredentials.id, credential.id));

  const evidence = { statement: ceremony.statement!, assertion: input.assertion };
  const newKey = p256KeyFromId(identity.publicKey);
  const [newCredential] = await deps.db
    .select({ credentialId: passkeyCredentials.credentialId })
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.identityId, identity.id));
  const newCredentialHash = credentialIdHash(newCredential!.credentialId);
  const assertionArgs = {
    requestDomain: host,
    rpId: identity.rpId,
    clientDataJson: verified.clientData,
  };
  const precompile = secp256r1Instruction(
    p256KeyFromId(signerIdentity.publicKey),
    verified.signature,
    verified.signed,
  );
  const [config] = await findConfigPda(deps.chain.programAddress);

  // Key-only (no account): the possession proof is the whole registration.
  if (!identity.accountCommitment) {
    await activate(deps, org!, identity, { ...evidence, txSignature: null }, "registered");
    return {
      identity: identity.publicKey,
      status: "active",
      enrollment: null,
      transactionSignature: null,
      recovery: null,
    };
  }
  const commitment = fromHex(identity.accountCommitment, 32);
  const [enrollment] = await findPasskeySignerPda(
    address(org!.address),
    commitment,
    deps.chain.programAddress,
  );

  if (kind === "recover") {
    // Possession proved; the organization's admin wallet authorizes the replacement on-chain.
    await deps.db
      .update(signerIdentities)
      .set({ enrollmentEvidence: { ...evidence, txSignature: null } })
      .where(eq(signerIdentities.id, identity.id));
    await audit(deps, org!, "signer.recovery_requested", identity.publicKey, {
      enrollment,
      previous: previous?.publicKey ?? null,
    });
    await enqueueWebhook(deps.db, org!.id, "signer.changed", {
      signer: identity.publicKey,
      change: "recovery_requested",
      externalUserRef: identity.externalUserRef,
      enrollment,
    });
    return {
      identity: identity.publicKey,
      status: "awaiting_organization",
      enrollment,
      transactionSignature: null,
      recovery: {
        enrollment,
        newSigner: toHex(newKey),
        newCredentialIdHash: toHex(newCredentialHash),
        rpIdHash: toHex(sha256(utf8(identity.rpId))),
      },
    };
  }

  let record;
  if (kind === "enroll") {
    await assertEnrollmentBudget(deps, org!);
    record = enrollPasskeySignerInstruction({
      programAddress: deps.chain.programAddress,
      relayer: deps.chain.relayer,
      config,
      organization: address(org!.address),
      nonceShard: address(await relayerShard(deps, org!)),
      enrollment,
      accountCommitment: commitment,
      credentialIdHash: newCredentialHash,
      issuedAt: details.issuedAt,
      expiresAt: details.expiresAt,
      assertion: assertionArgs,
    });
  } else {
    if (previous!.enrollmentAddress !== enrollment)
      throw conflict("enrollment_mismatch", "The current signer is enrolled elsewhere");
    record = rotatePasskeySignerInstruction({
      programAddress: deps.chain.programAddress,
      relayer: deps.chain.relayer,
      config,
      organization: address(org!.address),
      enrollment,
      newSigner: newKey,
      newCredentialIdHash: newCredentialHash,
      issuedAt: details.issuedAt,
      expiresAt: details.expiresAt,
      assertion: assertionArgs,
    });
  }
  let txSignature: string;
  try {
    txSignature = await deps.chain.sendRecord(precompile, record);
  } catch (e) {
    deps.logger.error({ err: e, kind }, "passkey enrollment relay failed");
    throw new ApiError(
      502,
      "relay_failed",
      `The passkey ${kind === "enroll" ? "enrollment" : "rotation"} could not be recorded`,
    );
  }
  await deps.db
    .update(signerIdentities)
    .set({
      enrollmentEvidence: { ...evidence, txSignature },
      ...(kind === "rotate" ? { rotationStatement: ceremony.statement } : {}),
    })
    .where(eq(signerIdentities.id, identity.id));
  // The chain decides: mirror the enrollment (activates the new key, retires the old one).
  await syncPasskeySigner(deps.db, deps.chain, enrollment);
  const after = await identityById(deps, identity.id);
  if (after.status !== "active")
    throw new ApiError(502, "relay_inconsistent", "The enrollment did not take effect on-chain");
  await bookEnrollment(deps, org!, txSignature, kind, enrollment);
  await audit(
    deps,
    org!,
    kind === "enroll" ? "signer.registered" : "signer.rotated",
    identity.publicKey,
    {
      enrollment,
      txSignature,
      ...(kind === "rotate" ? { previous: previous!.publicKey, kind: "endorsed" } : {}),
    },
  );
  await enqueueWebhook(
    deps.db,
    org!.id,
    kind === "enroll" ? "signer.registered" : "signer.changed",
    {
      signer: identity.publicKey,
      change: kind === "enroll" ? "registered" : "rotated",
      externalUserRef: identity.externalUserRef,
      enrollment,
      transactionSignature: txSignature,
      rotation: kind === "rotate" ? { kind: "endorsed", previous: previous!.publicKey } : null,
    },
  );
  return {
    identity: identity.publicKey,
    status: "active",
    enrollment,
    transactionSignature: txSignature,
    recovery: null,
  };
}

async function activate(
  deps: Deps,
  org: Organization,
  identity: Identity,
  evidence: { statement: string; assertion: PasskeyAssertion; txSignature: string | null },
  change: string,
) {
  await deps.db
    .update(signerIdentities)
    .set({ status: "active", statusChangedAt: new Date(), enrollmentEvidence: evidence })
    .where(eq(signerIdentities.id, identity.id));
  await audit(deps, org, "signer.registered", identity.publicKey, { algorithm: "p256-native" });
  await enqueueWebhook(deps.db, org.id, "signer.registered", {
    signer: identity.publicKey,
    change,
    externalUserRef: identity.externalUserRef,
    rotation: null,
  });
}

/** Enrollment and rotation transactions count as recordings (fee, rent and billing visibility). */
async function bookEnrollment(
  deps: Deps,
  org: Organization,
  txSignature: string,
  kind: "enroll" | "rotate",
  enrollment: string,
) {
  const tx = await deps.chain.rpc
    .getTransaction(txSignature as never, {
      encoding: "json",
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    })
    .send()
    .catch(() => null);
  const fee = feeFacts(
    {
      accountKeys: [deps.chain.relayer.address],
      fee: Number(tx?.meta?.fee ?? 0),
      logs: [],
    },
    deps.chain.programAddress,
    enrollment,
  );
  await bookRecording(deps, {
    organizationId: org.id,
    txSignature,
    recordKind: kind === "enroll" ? "passkey_enrollment" : "passkey_rotation",
    recordId: enrollment,
    shardAddress: await relayerShard(deps, org),
    fee,
  });
}

// ---- organization recovery (wallet-signed) ------------------------------------------------------------

/** Pending recoveries the organization's admin wallet can authorize (dashboard). */
export async function pendingRecoveries(deps: Deps, organizationId: string) {
  const rows = await deps.db
    .select()
    .from(signerIdentities)
    .where(
      and(
        eq(signerIdentities.organizationId, organizationId),
        eq(signerIdentities.status, "pending"),
        eq(signerIdentities.rotationKind, "account_authorized"),
        isNotNull(signerIdentities.enrollmentEvidence),
      ),
    );
  const out = [];
  for (const r of rows) {
    const [cred] = await deps.db
      .select({ credentialId: passkeyCredentials.credentialId })
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.identityId, r.id));
    const [org] = await deps.db
      .select({ address: organizations.address })
      .from(organizations)
      .where(eq(organizations.id, r.organizationId));
    const [enrollment] = await findPasskeySignerPda(
      address(org!.address),
      fromHex(r.accountCommitment!, 32),
      deps.chain.programAddress,
    );
    out.push({
      identity: r.publicKey,
      externalUserRef: r.externalUserRef,
      requestedAt: r.createdAt,
      enrollment,
      newSigner: toHex(p256KeyFromId(r.publicKey)),
      newCredentialIdHash: cred ? toHex(credentialIdHash(cred.credentialId)) : null,
      rpIdHash: toHex(sha256(utf8(r.rpId))),
      possessionProof: r.enrollmentEvidence,
    });
  }
  return out;
}

/**
 * After the organization's wallet signed `recover_passkey_signer` / `revoke_passkey_signer`: mirror
 * the enrollment from the chain (the transaction itself is the authorization; nothing here trusts
 * the caller).
 */
export async function refreshEnrollment(
  deps: Deps,
  organizationId: string,
  enrollment: string,
): Promise<{ signer: string; status: string; kind: number }> {
  const data = await fetchAccountData(deps.chain.rpc, address(enrollment));
  const [org] = await deps.db
    .select({ address: organizations.address })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!data || !org || decodePasskeySigner(data).organization !== org.address)
    throw notFound("Enrollment");
  const result = await syncPasskeySigner(deps.db, deps.chain, enrollment);
  if (!result) throw notFound("Enrollment");
  return { signer: result.signer, status: result.status, kind: result.kind };
}

/**
 * A returning visitor on a device without the local hint: a discoverable assertion (purpose
 * "identify" from /v1/passkeys/options) names the passkey signer — native or PRF-protected (the
 * latter then fetches its key material). Nothing is signed or recorded.
 */
export async function identifySigner(
  deps: Deps,
  input: { challengeId: string; assertion: PasskeyAssertion; host: string },
): Promise<{ identity: string; credentialId: string; rpId: string; algorithm: string }> {
  const ceremony = await takeCeremony(deps, input.challengeId, "identify", input.host);
  const [row] = await deps.db
    .select({ c: passkeyCredentials, i: signerIdentities })
    .from(passkeyCredentials)
    .innerJoin(signerIdentities, eq(signerIdentities.id, passkeyCredentials.identityId))
    .where(eq(passkeyCredentials.credentialId, input.assertion.credentialId));
  if (
    !row ||
    row.i.organizationId !== ceremony.organizationId ||
    row.c.revokedAt ||
    row.i.status !== "active"
  )
    throw notFound("Passkey");
  const check = await verifyPasskeyAssertion(input.assertion, row.c, {
    challenge: fromBase64Url(ceremony.challenge),
    host: input.host,
    previousSignCount: row.c.signCount,
  });
  if (!check.ok) throw badRequest("invalid_assertion", check.reason);
  await deps.db
    .update(passkeyCredentials)
    .set({ signCount: check.signCount, lastUsedAt: new Date() })
    .where(eq(passkeyCredentials.id, row.c.id));
  return {
    identity: row.i.publicKey,
    credentialId: row.c.credentialId,
    rpId: row.i.rpId,
    algorithm: row.i.algorithm,
  };
}

/** The current challenge for a native acceptance message (shared with the acceptance service). */
export const nativeAcceptanceChallenge = (message: string) =>
  webauthnChallenge(PASSKEY_ACCEPTANCE_TAG, message);
