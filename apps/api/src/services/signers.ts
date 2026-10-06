/**
 * Walletless signers: passkey-protected Stele keys (PROTOCOL_SPEC.md §14).
 *
 * The browser generates the Ed25519 key, encrypts it under the passkey's WebAuthn PRF output and
 * sends Stele only the ciphertext. This service therefore never sees a private key or anything that
 * can decrypt one. It checks and stores *evidence*:
 *
 *   - registration: a WebAuthn registration (user-verified) plus a key statement signed by the new
 *     key and endorsed by an assertion of the new passkey;
 *   - every acceptance/proof: a user-verified assertion over that exact message, required before
 *     the relayer will record it;
 *   - every change (added passkey, recovery kit, revocation, rotation): a statement signed by the
 *     key, i.e. by someone who unlocked it with an existing passkey or recovery kit. Losing every
 *     method leads to a *new* key linked to the old one by the organization's account system, never
 *     to silent control of the old key.
 */
import { randomBytes } from "node:crypto";
import {
  buildKeyStatement,
  fetchProtocolConfig,
  fromBase58,
  fromBase64Url,
  parseKeyStatement,
  passkeySignatureChallenge,
  passkeyStatementChallenge,
  rpIdCoversHost,
  sha256,
  toBase64Url,
  toHex,
  verifyKeyStatementSignature,
  verifyPasskeyAssertion,
  verifyPasskeyRegistration,
  type PasskeyAssertion,
  type PasskeyRegistrationResponse,
  type SignerEvidence,
  type WrappedKey,
} from "@stele/protocol";
import {
  acceptanceSessions,
  and,
  desc,
  eq,
  gt,
  isNull,
  organizations,
  passkeyChallenges,
  passkeyCredentials,
  recoveryKits,
  signerIdentities,
  type SigningPolicy,
} from "@stele/db";
import type { Deps } from "../deps.js";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../errors.js";
import { appendAudit } from "../lib/audit.js";
import { sha256Hex } from "../lib/crypto.js";
import { enqueueWebhook } from "../lib/webhooks.js";

/**
 * "wallet" (self-custodied Ed25519), "passkey" (stele/1: Ed25519 key unlocked by the passkey PRF —
 * kept for existing identities) or "passkey_p256" (stele/2: the passkey itself signs, P-256).
 */
export type SignerType = "wallet" | "passkey" | "passkey_p256";
type Organization = typeof organizations.$inferSelect;
type Identity = typeof signerIdentities.$inferSelect;
type Credential = typeof passkeyCredentials.$inferSelect;

export const CEREMONY_TTL_MS = 10 * 60_000;
/** Key statements must be fresh when they are submitted (clock skew allowance). */
const STATEMENT_MAX_AGE_S = 15 * 60;

// ---- policy -----------------------------------------------------------------------------------------

export function signingPolicy(org: Organization): SigningPolicy {
  return org.settings.signingPolicy ?? "WALLET_ONLY";
}

export function allowedSignerTypes(policy: SigningPolicy): SignerType[] {
  switch (policy) {
    case "WALLET_ONLY":
      return ["wallet"];
    case "PASSKEY_ONLY":
    case "ACCOUNT_AND_PASSKEY":
      return ["passkey", "passkey_p256"];
    case "WALLET_OR_PASSKEY":
      return ["wallet", "passkey", "passkey_p256"];
  }
}

export function assertPasskeysAllowed(org: Organization): void {
  if (!allowedSignerTypes(signingPolicy(org)).includes("passkey"))
    throw forbidden("This organization does not accept passkey signing");
}

export function assertSiteAllowed(org: Organization, host: string): void {
  const sites = org.settings.allowedRequestDomains ?? [];
  if (sites.length > 0 && !sites.includes(host))
    throw forbidden(`This organization does not accept signing requests from ${host}`);
}

let chainIdCache: { program: string; chainId: string } | null = null;
export async function chainId(deps: Deps): Promise<string> {
  if (chainIdCache?.program !== deps.chain.programAddress) {
    const { config } = await fetchProtocolConfig(deps.chain.rpc, deps.chain.programAddress);
    chainIdCache = { program: deps.chain.programAddress, chainId: config.chainId };
  }
  return chainIdCache.chainId;
}

export async function orgByAddress(deps: Deps, address: string): Promise<Organization> {
  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.address, address));
  if (!org) throw notFound("Organization");
  return org;
}

export async function openSession(deps: Deps, org: Organization, token: string | undefined) {
  if (!token) return null;
  const [row] = await deps.db
    .select()
    .from(acceptanceSessions)
    .where(
      and(
        eq(acceptanceSessions.tokenHash, sha256Hex(token)),
        eq(acceptanceSessions.organizationId, org.id),
        isNull(acceptanceSessions.consumedAt),
        gt(acceptanceSessions.expiresAt, new Date()),
      ),
    );
  if (!row) throw forbidden("Invalid or expired acceptance session");
  return row;
}

export const audit = (
  deps: Deps,
  org: Organization,
  action: string,
  identity: string,
  metadata: Record<string, unknown> = {},
) =>
  appendAudit(deps.db, {
    organizationId: org.id,
    actorType: "system",
    actorId: `signer:${identity}`,
    action,
    targetType: "signer_identity",
    targetId: identity,
    metadata,
  });

// ---- ceremonies -----------------------------------------------------------------------------------

export interface CeremonyOptions {
  challengeId: string;
  challenge: string;
  rpId: string;
  rpName: string;
  organization: string;
  chainId: string;
  user: { id: string; name: string; displayName: string };
  /** Passkeys already registered for this identity (to exclude on registration). */
  excludeCredentials: string[];
}

/**
 * Options for `navigator.credentials.create()` (purpose "register" | "add_passkey") or for a
 * discoverable `get()` that identifies a returning signer on a new device ("identify").
 */
export async function ceremonyOptions(
  deps: Deps,
  input: {
    organization: string;
    purpose: "register" | "add_passkey" | "identify";
    host: string;
    sessionToken?: string;
    identity?: string;
  },
): Promise<CeremonyOptions> {
  const org = await orgByAddress(deps, input.organization);
  assertPasskeysAllowed(org);
  assertSiteAllowed(org, input.host);
  const session = await openSession(deps, org, input.sessionToken);
  const policy = signingPolicy(org);
  let externalUserRef: string | null = session?.externalUserRef ?? null;
  if (policy === "ACCOUNT_AND_PASSKEY" && input.purpose === "register" && !externalUserRef)
    throw forbidden(
      "This organization binds passkeys to its own accounts: an acceptance session for your account is required",
    );

  let identity: Identity | undefined;
  let exclude: string[] = [];
  if (input.purpose === "add_passkey") {
    if (!input.identity) throw badRequest("missing_identity", "identity is required");
    [identity] = await deps.db
      .select()
      .from(signerIdentities)
      .where(
        and(
          eq(signerIdentities.publicKey, input.identity),
          eq(signerIdentities.organizationId, org.id),
        ),
      );
    if (!identity || identity.status !== "active") throw notFound("Signer");
    if (identity.algorithm !== "ed25519-prf")
      throw badRequest(
        "native_passkey",
        "A native passkey is its own key: register another passkey or rotate this one instead",
      );
    if (!rpIdCoversHost(identity.rpId, input.host))
      throw forbidden(`This signer's passkeys belong to ${identity.rpId}`);
    externalUserRef = identity.externalUserRef;
    exclude = (
      await deps.db
        .select({ id: passkeyCredentials.credentialId })
        .from(passkeyCredentials)
        .where(eq(passkeyCredentials.identityId, identity.id))
    ).map((r) => r.id);
  }

  const challenge = new Uint8Array(randomBytes(32));
  const [row] = await deps.db
    .insert(passkeyChallenges)
    .values({
      organizationId: org.id,
      purpose: input.purpose,
      challenge: toBase64Url(challenge),
      rpId: input.host,
      externalUserRef,
      acceptanceSessionId: session?.id ?? null,
      identityId: identity?.id ?? null,
      expiresAt: new Date(Date.now() + CEREMONY_TTL_MS),
    })
    .returning({ id: passkeyChallenges.id });
  return {
    challengeId: row!.id,
    challenge: toBase64Url(challenge),
    rpId: input.host,
    rpName: org.name,
    organization: org.address,
    chainId: await chainId(deps),
    // The WebAuthn user handle is random: it links nothing across sites and holds no personal data.
    user: {
      id: toBase64Url(new Uint8Array(randomBytes(16))),
      name: `${org.name} signer`,
      displayName: `${org.name} signer`,
    },
    excludeCredentials: exclude,
  };
}

export async function takeCeremony(
  deps: Deps,
  challengeId: string,
  purpose: string,
  host: string,
): Promise<typeof passkeyChallenges.$inferSelect> {
  const [row] = await deps.db
    .update(passkeyChallenges)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(passkeyChallenges.id, challengeId),
        eq(passkeyChallenges.purpose, purpose),
        isNull(passkeyChallenges.consumedAt),
        gt(passkeyChallenges.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row)
    throw badRequest(
      "invalid_ceremony",
      "This passkey request expired or was already used; start again",
    );
  if (row.rpId !== host) throw forbidden("The passkey ceremony belongs to another site");
  return row;
}

// ---- registration -----------------------------------------------------------------------------------

export interface RegistrationInput {
  challengeId: string;
  credential: PasskeyRegistrationResponse;
  identity: string;
  keyStatement: string;
  keySignature: string;
  statementAssertion: PasskeyAssertion;
  prfSalt: string;
  wrappedKey: WrappedKey;
  label?: string;
  recoveryKit?: {
    kitId: string;
    wrappedKey: WrappedKey;
    keyStatement: string;
    keySignature: string;
  };
  /** Endorsed rotation: the previous key's signature over the ROTATE statement. */
  previousKeySignature?: string;
}

function checkWrappedKey(w: WrappedKey): void {
  try {
    if (
      w.format !== "stele-wrapped-key-v1" ||
      fromBase64Url(w.salt).length !== 32 ||
      fromBase64Url(w.iv).length !== 12 ||
      fromBase64Url(w.ciphertext).length !== 48
    )
      throw new Error();
  } catch {
    throw badRequest("invalid_wrapped_key", "Malformed wrapped key");
  }
}

async function checkStatement(
  deps: Deps,
  org: Organization,
  statement: string,
  keySignature: string,
  key: string,
) {
  let parsed;
  try {
    parsed = parseKeyStatement(statement);
  } catch (e) {
    throw badRequest("invalid_statement", (e as Error).message);
  }
  if (parsed.organization !== org.address)
    throw badRequest("invalid_statement", "Statement is for another organization");
  if (parsed.key !== key) throw badRequest("invalid_statement", "Statement is about another key");
  if (parsed.chainId !== (await chainId(deps)))
    throw badRequest("invalid_statement", "Statement is for another network");
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.issuedAt) > STATEMENT_MAX_AGE_S)
    throw badRequest("invalid_statement", "Statement is not fresh");
  if (!verifyKeyStatementSignature(statement, keySignature, fromBase58(key)))
    throw badRequest("invalid_statement", "The key's signature over the statement does not verify");
  return parsed;
}

/**
 * Registers a passkey: a new identity (purpose "register") or another passkey for an existing one
 * ("add_passkey", which needs a statement signed by the identity key).
 */
export async function registerPasskey(
  deps: Deps,
  input: RegistrationInput,
  host: string,
): Promise<{ identity: string; credentialId: string; status: "active" }> {
  const [pending] = await deps.db
    .select()
    .from(passkeyChallenges)
    .where(eq(passkeyChallenges.id, input.challengeId));
  if (!pending || (pending.purpose !== "register" && pending.purpose !== "add_passkey"))
    throw badRequest("invalid_ceremony", "Unknown passkey request");
  const ceremony = await takeCeremony(deps, input.challengeId, pending.purpose, host);
  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, ceremony.organizationId));
  assertPasskeysAllowed(org!);

  if (fromBase58(input.identity).length !== 32)
    throw badRequest("invalid_identity", "Identity must be a 32-byte public key");
  checkWrappedKey(input.wrappedKey);
  try {
    if (fromBase64Url(input.prfSalt).length !== 32) throw new Error();
  } catch {
    throw badRequest("invalid_prf_salt", "PRF salt must be 32 bytes");
  }

  // 1. The WebAuthn registration itself (user-verified, this site, this ceremony).
  const reg = await verifyPasskeyRegistration(input.credential, {
    challenge: fromBase64Url(ceremony.challenge),
    host,
    rpId: ceremony.rpId,
  });
  if (!reg.ok) throw badRequest("invalid_registration", reg.reason);

  // 2. The key statement: signed by the new key, about this passkey.
  const statement = await checkStatement(
    deps,
    org!,
    input.keyStatement,
    input.keySignature,
    input.identity,
  );
  const expectedAction =
    ceremony.purpose === "add_passkey" ? ["ADD_PASSKEY"] : ["REGISTER", "ROTATE"];
  if (!expectedAction.includes(statement.action))
    throw badRequest("invalid_statement", `Expected a ${expectedAction.join(" or ")} statement`);
  if (
    statement.credentialId !== input.credential.credentialId ||
    statement.passkeyKeyHash !== toHex(sha256(fromBase64Url(input.credential.publicKey))) ||
    statement.rpId !== ceremony.rpId
  )
    throw badRequest("invalid_statement", "Statement does not describe this passkey");

  // 3. The passkey endorses the statement (and proves the public key reported at registration).
  const credential = {
    credentialId: input.credential.credentialId,
    publicKey: input.credential.publicKey,
    algorithm: input.credential.algorithm,
    rpId: ceremony.rpId,
  };
  const endorsement = await verifyPasskeyAssertion(input.statementAssertion, credential, {
    challenge: passkeyStatementChallenge(input.keyStatement),
    host,
  });
  if (!endorsement.ok) throw badRequest("invalid_endorsement", endorsement.reason);

  // 4. Recovery kit (optional): a statement signed by the key.
  if (input.recoveryKit) {
    checkWrappedKey(input.recoveryKit.wrappedKey);
    const kit = await checkStatement(
      deps,
      org!,
      input.recoveryKit.keyStatement,
      input.recoveryKit.keySignature,
      input.identity,
    );
    if (kit.action !== "ADD_RECOVERY_KIT" || kit.recoveryKitId !== input.recoveryKit.kitId)
      throw badRequest("invalid_statement", "Recovery kit statement does not match the kit");
  }

  const [existingCredential] = await deps.db
    .select({ id: passkeyCredentials.id })
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.credentialId, input.credential.credentialId));
  if (existingCredential) throw conflict("passkey_exists", "This passkey is already registered");

  let identity: Identity;
  if (ceremony.purpose === "add_passkey") {
    const [row] = await deps.db
      .select()
      .from(signerIdentities)
      .where(eq(signerIdentities.id, ceremony.identityId!));
    if (!row || row.status !== "active" || row.publicKey !== input.identity)
      throw forbidden("This passkey request was issued for another signer");
    identity = row;
  } else {
    const [taken] = await deps.db
      .select({ id: signerIdentities.id })
      .from(signerIdentities)
      .where(eq(signerIdentities.publicKey, input.identity));
    if (taken) throw conflict("identity_exists", "This key is already registered");
    // Account-bound policy: one active signer per account; a replacement is linked to its predecessor.
    let previous: Identity | undefined;
    if (ceremony.externalUserRef) {
      const history = await deps.db
        .select()
        .from(signerIdentities)
        .where(
          and(
            eq(signerIdentities.organizationId, org!.id),
            eq(signerIdentities.externalUserRef, ceremony.externalUserRef),
          ),
        )
        .orderBy(desc(signerIdentities.createdAt));
      if (history.some((h) => h.status === "active") && statement.action !== "ROTATE")
        throw conflict(
          "identity_exists",
          "This account already has a signer; add a passkey to it instead",
        );
      previous = history[0];
    }
    let rotationKind: string | null = null;
    if (statement.action === "ROTATE") {
      const [old] = await deps.db
        .select()
        .from(signerIdentities)
        .where(
          and(
            eq(signerIdentities.publicKey, statement.previousKey!),
            eq(signerIdentities.organizationId, org!.id),
          ),
        );
      if (!old || old.status !== "active" || old.externalUserRef !== ceremony.externalUserRef)
        throw badRequest(
          "invalid_rotation",
          "The previous key is not an active signer of this account",
        );
      if (
        !input.previousKeySignature ||
        !verifyKeyStatementSignature(
          input.keyStatement,
          input.previousKeySignature,
          fromBase58(old.publicKey),
        )
      )
        throw badRequest("invalid_rotation", "The previous key must sign the rotation statement");
      previous = old;
      rotationKind = "endorsed";
    } else if (previous && previous.status !== "active") {
      // The organization reset this account's signer (all unlock methods lost). The new key is NOT
      // endorsed by the old one; receipts and the identity history say so.
      rotationKind = "account_authorized";
    }
    const [row] = await deps.db
      .insert(signerIdentities)
      .values({
        organizationId: org!.id,
        publicKey: input.identity,
        rpId: ceremony.rpId,
        externalUserRef: ceremony.externalUserRef,
        rotatedFromId: rotationKind ? previous!.id : null,
        rotationKind,
        rotationStatement: rotationKind === "endorsed" ? input.keyStatement : null,
        rotationPreviousSignature: rotationKind === "endorsed" ? input.previousKeySignature! : null,
      })
      .returning();
    identity = row!;
    if (rotationKind === "endorsed")
      await deps.db
        .update(signerIdentities)
        .set({ status: "rotated", statusChangedAt: new Date() })
        .where(eq(signerIdentities.id, previous!.id));
    if (rotationKind)
      await audit(deps, org!, "signer.rotated", identity.publicKey, {
        previous: previous!.publicKey,
        kind: rotationKind,
      });
  }

  await deps.db.insert(passkeyCredentials).values({
    identityId: identity.id,
    credentialId: input.credential.credentialId,
    publicKey: input.credential.publicKey,
    algorithm: input.credential.algorithm,
    rpId: ceremony.rpId,
    signCount: endorsement.signCount,
    prfSalt: input.prfSalt,
    wrappedKey: input.wrappedKey,
    keyStatement: input.keyStatement,
    keySignature: input.keySignature,
    statementAssertion: input.statementAssertion,
    backedUp: reg.backedUp,
    label: input.label ?? null,
  });
  if (input.recoveryKit) {
    await deps.db.insert(recoveryKits).values({
      identityId: identity.id,
      kitId: input.recoveryKit.kitId,
      wrappedKey: input.recoveryKit.wrappedKey,
      keyStatement: input.recoveryKit.keyStatement,
      keySignature: input.recoveryKit.keySignature,
    });
  }
  const action = ceremony.purpose === "add_passkey" ? "signer.passkey_added" : "signer.registered";
  await audit(deps, org!, action, identity.publicKey, {
    credentialId: input.credential.credentialId,
    rpId: ceremony.rpId,
    recoveryKit: Boolean(input.recoveryKit),
  });
  await enqueueWebhook(
    deps.db,
    org!.id,
    ceremony.purpose === "add_passkey" ? "signer.changed" : "signer.registered",
    {
      signer: identity.publicKey,
      change: ceremony.purpose === "add_passkey" ? "passkey_added" : "registered",
      externalUserRef: identity.externalUserRef,
      rotation: identity.rotationKind ? { kind: identity.rotationKind } : null,
    },
  );
  return {
    identity: identity.publicKey,
    credentialId: input.credential.credentialId,
    status: "active",
  };
}

// ---- unlocking ----------------------------------------------------------------------------------------

export interface KeyMaterial {
  identity: string;
  rpId: string;
  status: string;
  credentialId: string;
  prfSalt: string;
  wrappedKey: WrappedKey;
  /** Every active passkey of the identity (for `allowCredentials`). */
  credentials: { credentialId: string; prfSalt: string }[];
}

async function keyMaterialFor(
  deps: Deps,
  identity: Identity,
  credential: Credential,
): Promise<KeyMaterial> {
  const all = await deps.db
    .select()
    .from(passkeyCredentials)
    .where(
      and(eq(passkeyCredentials.identityId, identity.id), isNull(passkeyCredentials.revokedAt)),
    );
  if (identity.algorithm !== "ed25519-prf" || !credential.prfSalt || !credential.wrappedKey)
    throw notFound("Passkey");
  return {
    identity: identity.publicKey,
    rpId: identity.rpId,
    status: identity.status,
    credentialId: credential.credentialId,
    prfSalt: credential.prfSalt,
    wrappedKey: credential.wrappedKey as WrappedKey,
    credentials: all.flatMap((c) =>
      c.prfSalt ? [{ credentialId: c.credentialId, prfSalt: c.prfSalt }] : [],
    ),
  };
}

/**
 * The encrypted key for a passkey. Ciphertext only: it can be opened solely with the PRF output of
 * that passkey (256-bit, released by the authenticator after user verification).
 */
export async function getKeyMaterial(
  deps: Deps,
  input: { organization: string; credentialId: string; host: string },
): Promise<KeyMaterial> {
  const org = await orgByAddress(deps, input.organization);
  const [row] = await deps.db
    .select({ c: passkeyCredentials, i: signerIdentities })
    .from(passkeyCredentials)
    .innerJoin(signerIdentities, eq(signerIdentities.id, passkeyCredentials.identityId))
    .where(eq(passkeyCredentials.credentialId, input.credentialId));
  if (!row || row.i.organizationId !== org.id || row.c.revokedAt || row.i.status !== "active")
    throw notFound("Passkey");
  if (!rpIdCoversHost(row.c.rpId, input.host)) throw notFound("Passkey");
  return keyMaterialFor(deps, row.i, row.c);
}

/** A returning signer on a new device: a discoverable assertion identifies the passkey. */
export async function identify(
  deps: Deps,
  input: { challengeId: string; assertion: PasskeyAssertion; host: string },
): Promise<KeyMaterial> {
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
  return keyMaterialFor(deps, row.i, row.c);
}

// ---- recovery kits and revocation -----------------------------------------------------------------------

async function identityOf(deps: Deps, org: Organization, publicKey: string): Promise<Identity> {
  const [identity] = await deps.db
    .select()
    .from(signerIdentities)
    .where(
      and(eq(signerIdentities.publicKey, publicKey), eq(signerIdentities.organizationId, org.id)),
    );
  if (!identity || identity.status !== "active") throw notFound("Signer");
  return identity;
}

export async function addRecoveryKit(
  deps: Deps,
  input: {
    organization: string;
    identity: string;
    kitId: string;
    wrappedKey: WrappedKey;
    keyStatement: string;
    keySignature: string;
  },
): Promise<{ kitId: string }> {
  const org = await orgByAddress(deps, input.organization);
  const identity = await identityOf(deps, org, input.identity);
  checkWrappedKey(input.wrappedKey);
  const s = await checkStatement(
    deps,
    org,
    input.keyStatement,
    input.keySignature,
    identity.publicKey,
  );
  if (s.action !== "ADD_RECOVERY_KIT" || s.recoveryKitId !== input.kitId)
    throw badRequest("invalid_statement", "Recovery kit statement does not match the kit");
  const [taken] = await deps.db
    .select({ id: recoveryKits.id })
    .from(recoveryKits)
    .where(eq(recoveryKits.kitId, input.kitId));
  if (taken) throw conflict("kit_exists", "This recovery kit is already registered");
  await deps.db.insert(recoveryKits).values({
    identityId: identity.id,
    kitId: input.kitId,
    wrappedKey: input.wrappedKey,
    keyStatement: input.keyStatement,
    keySignature: input.keySignature,
  });
  await audit(deps, org, "signer.recovery_kit_added", identity.publicKey, { kitId: input.kitId });
  await enqueueWebhook(deps.db, org.id, "signer.changed", {
    signer: identity.publicKey,
    change: "recovery_kit_added",
    externalUserRef: identity.externalUserRef,
  });
  return { kitId: input.kitId };
}

/** The encrypted key for a recovery kit (found by the kit's public ID, derived from its secret). */
export async function lookupRecoveryKit(
  deps: Deps,
  input: { organization: string; kitId: string },
): Promise<{ identity: string; rpId: string; wrappedKey: WrappedKey }> {
  const org = await orgByAddress(deps, input.organization);
  const [row] = await deps.db
    .select({ k: recoveryKits, i: signerIdentities })
    .from(recoveryKits)
    .innerJoin(signerIdentities, eq(signerIdentities.id, recoveryKits.identityId))
    .where(eq(recoveryKits.kitId, input.kitId));
  if (!row || row.i.organizationId !== org.id || row.k.revokedAt || row.i.status !== "active")
    throw notFound("Recovery kit");
  await deps.db
    .update(recoveryKits)
    .set({ lastUsedAt: new Date() })
    .where(eq(recoveryKits.id, row.k.id));
  await audit(deps, org, "signer.recovery_kit_used", row.i.publicKey, { kitId: input.kitId });
  return {
    identity: row.i.publicKey,
    rpId: row.i.rpId,
    wrappedKey: row.k.wrappedKey as WrappedKey,
  };
}

export async function revokePasskey(
  deps: Deps,
  input: {
    organization: string;
    identity: string;
    credentialId: string;
    keyStatement: string;
    keySignature: string;
  },
): Promise<{ revoked: string }> {
  const org = await orgByAddress(deps, input.organization);
  const identity = await identityOf(deps, org, input.identity);
  const s = await checkStatement(
    deps,
    org,
    input.keyStatement,
    input.keySignature,
    identity.publicKey,
  );
  if (s.action !== "REVOKE_PASSKEY" || s.credentialId !== input.credentialId)
    throw badRequest("invalid_statement", "Revocation statement does not match the passkey");
  const [row] = await deps.db
    .update(passkeyCredentials)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(passkeyCredentials.identityId, identity.id),
        eq(passkeyCredentials.credentialId, input.credentialId),
        isNull(passkeyCredentials.revokedAt),
      ),
    )
    .returning({ id: passkeyCredentials.id });
  if (!row) throw notFound("Passkey");
  await audit(deps, org, "signer.passkey_revoked", identity.publicKey, {
    credentialId: input.credentialId,
  });
  await enqueueWebhook(deps.db, org.id, "signer.changed", {
    signer: identity.publicKey,
    change: "passkey_revoked",
    externalUserRef: identity.externalUserRef,
  });
  return { revoked: input.credentialId };
}

/**
 * The organization resets an account's signer (the user lost every passkey and recovery kit). The
 * old key can never be used again; a new key registered for the account is recorded as
 * "account_authorized" — explicitly NOT endorsed by the old key.
 */
export async function revokeIdentity(
  deps: Deps,
  input: {
    organizationId: string;
    identity: string;
    reason: string;
    actor: { type: "user" | "api_key"; id: string };
  },
): Promise<{
  identity: string;
  status: "revoked";
  /** Native account-bound passkeys: the on-chain enrollment still to revoke with an admin wallet. */
  onChain: { enrollment: string; instruction: "revoke_passkey_signer"; note: string } | null;
}> {
  const [identity] = await deps.db
    .select()
    .from(signerIdentities)
    .where(
      and(
        eq(signerIdentities.publicKey, input.identity),
        eq(signerIdentities.organizationId, input.organizationId),
      ),
    );
  if (!identity) throw notFound("Signer");
  const onChain = identity.enrollmentAddress
    ? {
        enrollment: identity.enrollmentAddress,
        instruction: "revoke_passkey_signer" as const,
        note: "Stele's relayer now refuses this signer. The on-chain enrollment stays active until an owner or admin wallet signs revoke_passkey_signer; until then another relayer could still record with it.",
      }
    : null;
  if (identity.status === "revoked")
    return { identity: identity.publicKey, status: "revoked", onChain };
  await deps.db
    .update(signerIdentities)
    .set({ status: "revoked", revokedReason: input.reason, statusChangedAt: new Date() })
    .where(eq(signerIdentities.id, identity.id));
  await appendAudit(deps.db, {
    organizationId: input.organizationId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    action: "signer.revoked_by_organization",
    targetType: "signer_identity",
    targetId: identity.publicKey,
    metadata: { reason: input.reason, externalUserRef: identity.externalUserRef },
  });
  await enqueueWebhook(deps.db, input.organizationId, "signer.changed", {
    signer: identity.publicKey,
    change: "revoked",
    externalUserRef: identity.externalUserRef,
  });
  return { identity: identity.publicKey, status: "revoked", onChain };
}

export async function listIdentities(deps: Deps, organizationId: string, externalUserRef?: string) {
  const conditions = [eq(signerIdentities.organizationId, organizationId)];
  if (externalUserRef) conditions.push(eq(signerIdentities.externalUserRef, externalUserRef));
  const rows = await deps.db
    .select()
    .from(signerIdentities)
    .where(and(...conditions))
    .orderBy(desc(signerIdentities.createdAt))
    .limit(200);
  const out = [];
  for (const i of rows) {
    const creds = await deps.db
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.identityId, i.id));
    const kits = await deps.db.select().from(recoveryKits).where(eq(recoveryKits.identityId, i.id));
    const previous = i.rotatedFromId
      ? (
          await deps.db
            .select({ publicKey: signerIdentities.publicKey })
            .from(signerIdentities)
            .where(eq(signerIdentities.id, i.rotatedFromId))
        )[0]
      : undefined;
    out.push({
      publicKey: i.publicKey,
      algorithm: i.algorithm,
      rpId: i.rpId,
      externalUserRef: i.externalUserRef,
      enrollment: i.enrollmentAddress,
      accountCommitment: i.accountCommitment,
      status: i.status,
      createdAt: i.createdAt,
      statusChangedAt: i.statusChangedAt,
      revokedReason: i.revokedReason,
      rotation: i.rotationKind
        ? { kind: i.rotationKind, previous: previous?.publicKey ?? null }
        : null,
      passkeys: creds.map((c) => ({
        credentialId: c.credentialId,
        algorithm: c.algorithm,
        backedUp: c.backedUp,
        label: c.label,
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt,
        revokedAt: c.revokedAt,
      })),
      recoveryKits: kits.map((k) => ({
        kitId: k.kitId,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        revokedAt: k.revokedAt,
      })),
    });
  }
  return out;
}

/** Public, self-authenticating evidence about a signer key (statements, signatures, endorsements). */
export async function publicIdentityEvidence(deps: Deps, publicKey: string) {
  const [i] = await deps.db
    .select()
    .from(signerIdentities)
    .where(eq(signerIdentities.publicKey, publicKey));
  if (!i) throw notFound("Signer");
  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, i.organizationId));
  const creds = await deps.db
    .select()
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.identityId, i.id));
  const previous = i.rotatedFromId
    ? (
        await deps.db
          .select({ publicKey: signerIdentities.publicKey })
          .from(signerIdentities)
          .where(eq(signerIdentities.id, i.rotatedFromId))
      )[0]
    : undefined;
  return {
    publicKey: i.publicKey,
    algorithm: i.algorithm,
    organization: org!.address,
    rpId: i.rpId,
    status: i.status,
    /**
     * Native passkeys: the on-chain enrollment (account mode) and the statement the passkey signed to
     * enroll — the account commitment is salted, so it reveals nothing about the account.
     */
    enrollment: i.enrollmentAddress,
    accountCommitment: i.accountCommitment,
    enrollmentEvidence: i.enrollmentEvidence,
    createdAt: i.createdAt,
    statusChangedAt: i.statusChangedAt,
    rotation: i.rotationKind
      ? {
          kind: i.rotationKind,
          previous: previous?.publicKey ?? null,
          statement: i.rotationStatement,
          previousKeySignature: i.rotationPreviousSignature,
          note:
            i.rotationKind === "account_authorized"
              ? "Authorized by the organization's account system after the previous key's unlock methods were lost. NOT endorsed by the previous key."
              : "Endorsed by the previous key.",
        }
      : null,
    passkeys: creds.map((c) => ({
      credentialId: c.credentialId,
      publicKey: c.publicKey,
      algorithm: c.algorithm,
      rpId: c.rpId,
      keyStatement: c.keyStatement,
      keySignature: c.keySignature,
      statementAssertion: c.statementAssertion,
      createdAt: c.createdAt,
      revokedAt: c.revokedAt,
    })),
  };
}

// ---- signing with a passkey-protected key ------------------------------------------------------------------

/**
 * Decides whether `signer` may sign for this organization in the requested mode. A key registered
 * as a passkey identity always signs in passkey mode (so every record it makes carries passkey
 * evidence).
 */
export async function resolveSigner(
  deps: Deps,
  input: {
    org: Organization;
    signer: string;
    signerType: SignerType;
    host: string;
    externalUserRef: string | null;
  },
): Promise<{ signerType: SignerType; identity: Identity | null; credentials: string[] }> {
  const allowed = allowedSignerTypes(signingPolicy(input.org));
  const [identity] = await deps.db
    .select()
    .from(signerIdentities)
    .where(eq(signerIdentities.publicKey, input.signer));
  if (identity) {
    const expected: SignerType = identity.algorithm === "p256-native" ? "passkey_p256" : "passkey";
    if (input.signerType !== expected)
      throw badRequest(
        "passkey_required",
        expected === "passkey_p256"
          ? "This key is a native passkey; sign with signerType passkey_p256"
          : "This key is a passkey-protected signer; sign with its passkey",
      );
  }
  if (!allowed.includes(input.signerType))
    throw forbidden(
      input.signerType === "wallet"
        ? "This organization accepts passkey signing only"
        : "This organization accepts wallet signing only",
    );
  if (input.signerType === "wallet")
    return { signerType: "wallet", identity: null, credentials: [] };
  if (!identity || identity.organizationId !== input.org.id) throw notFound("Signer");
  if (identity.status === "pending")
    throw forbidden("This passkey has not completed its registration");
  if (identity.status !== "active")
    throw forbidden(`This signer was ${identity.status}; use the current signer for this account`);
  if (!rpIdCoversHost(identity.rpId, input.host))
    throw forbidden(`This signer's passkeys belong to ${identity.rpId}`);
  if (signingPolicy(input.org) === "ACCOUNT_AND_PASSKEY") {
    if (!input.externalUserRef || identity.externalUserRef !== input.externalUserRef)
      throw forbidden("This signer does not belong to the account of this acceptance session");
    if (identity.algorithm === "p256-native" && !identity.enrollmentAddress)
      throw forbidden("This passkey is not enrolled for the account on-chain");
  }
  const creds = await deps.db
    .select({ id: passkeyCredentials.credentialId })
    .from(passkeyCredentials)
    .where(
      and(eq(passkeyCredentials.identityId, identity.id), isNull(passkeyCredentials.revokedAt)),
    );
  if (creds.length === 0) throw forbidden("This signer has no active passkey");
  return {
    signerType: identity.algorithm === "p256-native" ? "passkey_p256" : "passkey",
    identity,
    credentials: creds.map((c) => c.id),
  };
}

/**
 * Enforced before relaying any passkey-mode record: a user-verified assertion by an active passkey
 * of the signer, over exactly this message, made on the requesting site.
 */
export async function verifySigningAssertion(
  deps: Deps,
  input: {
    identityId: string;
    assertion: PasskeyAssertion | undefined;
    message: string;
    host: string;
  },
): Promise<void> {
  if (!input.assertion)
    throw badRequest(
      "passkey_assertion_required",
      "A passkey assertion over this message is required",
    );
  const [row] = await deps.db
    .select({ c: passkeyCredentials, i: signerIdentities })
    .from(passkeyCredentials)
    .innerJoin(signerIdentities, eq(signerIdentities.id, passkeyCredentials.identityId))
    .where(eq(passkeyCredentials.credentialId, input.assertion.credentialId));
  if (
    !row ||
    row.i.id !== input.identityId ||
    row.i.algorithm !== "ed25519-prf" ||
    row.c.revokedAt ||
    row.i.status !== "active"
  )
    throw forbidden("The assertion was not made with an active passkey of this signer");
  const check = await verifyPasskeyAssertion(input.assertion, row.c, {
    challenge: passkeySignatureChallenge(input.message),
    host: input.host,
    previousSignCount: row.c.signCount,
  });
  if (!check.ok) throw new ApiError(400, "invalid_passkey_assertion", check.reason);
  await deps.db
    .update(passkeyCredentials)
    .set({ signCount: check.signCount, lastUsedAt: new Date() })
    .where(eq(passkeyCredentials.id, row.c.id));
}

/** Receipt evidence for a passkey-mode record (verified again by every verifier). */
export async function signerEvidenceFor(
  deps: Deps,
  record: { signerType: string; passkeyAssertion: PasskeyAssertion | null },
): Promise<SignerEvidence> {
  if (record.signerType !== "passkey" || !record.passkeyAssertion) return { type: "WALLET" };
  const [c] = await deps.db
    .select()
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.credentialId, record.passkeyAssertion.credentialId));
  if (!c || !c.keyStatement || !c.keySignature || !c.statementAssertion) return { type: "WALLET" };
  return {
    type: "PASSKEY_PROTECTED_STELE_KEY",
    passkey: {
      credentialId: c.credentialId,
      publicKey: c.publicKey,
      algorithm: c.algorithm,
      rpId: c.rpId,
    },
    keyStatement: {
      statement: c.keyStatement,
      keySignature: c.keySignature,
      passkeyAssertion: c.statementAssertion as PasskeyAssertion,
    },
    assertion: record.passkeyAssertion,
  };
}

export { buildKeyStatement };
