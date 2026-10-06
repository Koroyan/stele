/**
 * Acceptance pipeline (relayer).
 *
 *   issueChallenge  → allocate a nonce bit, rebuild the exact message from live chain state
 *   submitChallenge → verify the user's Ed25519 signature locally, relay the transaction,
 *                     index the result from the chain, notify webhooks
 *
 * The relayer cannot forge or alter an acceptance: it never sees a private key, the program
 * re-verifies the signature and reconstructs the message on-chain, and the index is written from
 * the confirmed transaction — not from what the client sent.
 *
 * Three signer types share this pipeline:
 *   - "wallet": a self-custodied Ed25519 key (stele/1);
 *   - "passkey": a PRF-protected Ed25519 Stele key (stele/1, legacy) — a user-verified passkey
 *     assertion over the exact message is required before the relayer records anything;
 *   - "passkey_p256": a native passkey (stele/2) — the passkey's own P-256 signature, verified by
 *     the secp256r1 precompile and bound on-chain to the message, site and relying party.
 * In every case the relayer pays the fee (the user never does) and the organization's sponsored
 * shard may reimburse it on-chain.
 */
import { address } from "@solana/kit";
import {
  DEFAULT_CHALLENGE_TTL,
  SHARD_CAPACITY,
  buildAcceptanceMessageFromChain,
  buildEd25519Instruction,
  buildPasskeyAcceptanceMessageFromChain,
  ChainStateError,
  decodeNonceShard,
  explainTransactionError,
  fetchAccountData,
  findConfigPda,
  fromBase58,
  fromHex,
  acceptanceId,
  decodeDocument,
  fromBase64Url,
  isP256KeyId,
  messageHash,
  p256KeyFromId,
  passkeyAcceptanceId,
  passkeySignatureChallenge,
  toBase58,
  type EvidenceMode,
  recordAcceptanceInstruction,
  recordPasskeyAcceptanceInstruction,
  secp256r1Instruction,
  toBase64Url,
  toHex,
  type PasskeyAssertion,
  utf8,
  validateRequestDomain,
  verifyEd25519,
} from "@stele/protocol";
import {
  acceptanceChallenges,
  acceptanceSessions,
  acceptances,
  and,
  asc,
  documents,
  eq,
  gt,
  isNull,
  lt,
  nonceShards,
  organizations,
  passkeyCredentials,
  signerIdentities,
  sql,
} from "@stele/db";
import { randomBytes } from "node:crypto";
import type { Deps } from "../deps.js";
import { ApiError, badRequest, conflict, forbidden, notFound, unavailable } from "../errors.js";
import { matchesHash, randomToken, sha256Hex } from "../lib/crypto.js";
import { indexAcceptanceTransaction, syncShard } from "../lib/sync.js";
import { enqueueWebhook } from "../lib/webhooks.js";
import { queueBatchedAcceptance } from "./batches.js";
import { nativeAcceptanceChallenge, verifyNativeAssertion } from "./native-passkeys.js";
import {
  resolveSigner,
  signerEvidenceFor,
  verifySigningAssertion,
  type SignerType,
} from "./signers.js";
import { bookRecording, planSponsorship } from "./sponsorship.js";

/** Upper bound on simultaneously open (issued, unexpired) challenges per organization. */
export const MAX_OPEN_CHALLENGES_PER_ORG = 2_000;

export interface IssueChallengeInput {
  organization: string;
  document: string;
  signer: string;
  /** Host of the requesting page, derived from the Origin header (never from the body). */
  requestDomain: string;
  sessionToken?: string;
  /**
   * "wallet" (default), "passkey" (PRF-protected Stele key) or "passkey_p256" (native passkey;
   * `signer` is then `p256:<66 hex>`).
   */
  signerType?: SignerType;
}

export interface IssuedChallenge {
  challengeId: string;
  clientBinding: string;
  message: string;
  issuedAt: number;
  expiresAt: number;
  nonce: { shardId: number; index: number; tag: string };
  version: {
    address: string;
    number: number;
    label: string;
    title: string;
    fingerprint: string;
    contentHash: string;
    storageUri: string;
  };
  organization: { address: string; name: string; verifiedDomain: string | null };
  network: { label: string; chainId: string };
  signerType: SignerType;
  /** "stele/1" (Ed25519 message) or "stele/2" (native passkey message, `stele-acceptance-v2`). */
  protocol: "stele/1" | "stele/2";
  /**
   * Passkey signers: the WebAuthn challenge (SHA-256 of tag ‖ message) and allowed passkeys.
   * `kind` "native": the passkey's signature IS the acceptance; "prf": it unlocks the Stele key.
   */
  passkey: {
    kind: "native" | "prf";
    challenge: string;
    rpId: string;
    allowCredentials: string[];
  } | null;
  /** Who will pay the network fee (never the user). */
  feeSponsor: "stele" | "organization";
}

/** Derives the request domain from an Origin header (`https://app.acme.example:8443` → host). */
export function requestDomainFromOrigin(origin: string | undefined, fallback: string): string {
  if (!origin) return fallback;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    validateRequestDomain(host);
    return host;
  } catch {
    throw badRequest("invalid_origin", "The requesting origin is not a valid hostname");
  }
}

/**
 * Atomically hands out the next unused nonce index of an active shard (indices are never reused).
 * The least-used shard is tried first, so load — and Solana write locks — spread across shards.
 */
export async function allocateNonce(
  deps: Deps,
  organizationId: string,
  preferredShards: string[] = [],
): Promise<{ shardRowId: string; shardAddress: string; shardId: number; index: number }> {
  const shards = await deps.db
    .select()
    .from(nonceShards)
    .where(
      and(
        eq(nonceShards.organizationId, organizationId),
        eq(nonceShards.status, "active"),
        eq(nonceShards.relayerAddress, deps.chain.relayer.address),
      ),
    )
    .orderBy(asc(nonceShards.nextIndex), asc(nonceShards.shardId));
  if (preferredShards.length > 0) {
    // Organization-sponsored: only shards whose sponsorship can pay.
    shards.splice(0, shards.length, ...shards.filter((s) => preferredShards.includes(s.address)));
  }
  for (const shard of shards) {
    const [row] = await deps.db
      .update(nonceShards)
      .set({ nextIndex: sql`${nonceShards.nextIndex} + 1` })
      .where(and(eq(nonceShards.id, shard.id), lt(nonceShards.nextIndex, SHARD_CAPACITY)))
      .returning({ nextIndex: nonceShards.nextIndex });
    if (row)
      return {
        shardRowId: shard.id,
        shardAddress: shard.address,
        shardId: shard.shardId,
        index: row.nextIndex - 1,
      };
    await deps.db.update(nonceShards).set({ status: "full" }).where(eq(nonceShards.id, shard.id));
  }
  throw unavailable(
    "no_acceptance_capacity",
    "This organization has no active nonce shard for the Stele relayer. An administrator must create one.",
  );
}

/**
 * Allocates a nonce whose bit is still clear on-chain. The database cursor can lag the chain when
 * nonces of the same shard were consumed by a relayer instance this database did not see (a restored
 * backup, a second deployment sharing the relayer key); handing such a nonce out would let the user
 * sign a message that can only fail when relayed. A stale cursor is fast-forwarded from the bitmap.
 */
export async function allocateFreeNonce(
  deps: Deps,
  organizationId: string,
  preferredShards: string[] = [],
): ReturnType<typeof allocateNonce> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const nonce = await allocateNonce(deps, organizationId, preferredShards);
    const data = await fetchAccountData(deps.chain.rpc, address(nonce.shardAddress));
    const bitmap = data ? decodeNonceShard(data).bitmap : null;
    if (!bitmap || ((bitmap[nonce.index >> 3] ?? 0) & (1 << (nonce.index & 7))) === 0) return nonce;
    await syncShard(deps.db, deps.chain, nonce.shardAddress);
  }
  throw unavailable(
    "nonce_unavailable",
    "Could not reserve an unused acceptance nonce; please try again",
  );
}

export async function issueChallenge(
  deps: Deps,
  input: IssueChallengeInput,
): Promise<IssuedChallenge> {
  const native = input.signerType === "passkey_p256";
  if (native ? !isP256KeyId(input.signer) : !isBase58Key(input.signer))
    throw badRequest(
      "invalid_signer",
      native
        ? "A native passkey signer is p256:<66 hex> (compressed P-256 key)"
        : "Signer must be a 32-byte public key",
    );
  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.address, input.organization));
  if (!org) throw notFound("Organization");
  const [doc] = await deps.db
    .select()
    .from(documents)
    .where(and(eq(documents.organizationId, org.id), eq(documents.address, input.document)));
  if (!doc) throw notFound("Document");
  if (!doc.currentVersionAddress)
    throw conflict("no_published_version", "This document has no published version yet");

  // Organization policy: only listed sites may request signatures (when a list is configured).
  const allowedSites = org.settings.allowedRequestDomains ?? [];
  if (allowedSites.length > 0 && !allowedSites.includes(input.requestDomain)) {
    throw forbidden(
      `This organization does not accept signing requests from ${input.requestDomain}`,
    );
  }

  // Organization policy: require a server-issued acceptance session (anti-bot, user attribution).
  let sessionRow: typeof acceptanceSessions.$inferSelect | undefined;
  if (input.sessionToken) {
    [sessionRow] = await deps.db
      .select()
      .from(acceptanceSessions)
      .where(
        and(
          eq(acceptanceSessions.tokenHash, sha256Hex(input.sessionToken)),
          eq(acceptanceSessions.organizationId, org.id),
          isNull(acceptanceSessions.consumedAt),
          gt(acceptanceSessions.expiresAt, new Date()),
        ),
      );
    if (!sessionRow) throw forbidden("Invalid or expired acceptance session");
    if (sessionRow.documentId && sessionRow.documentId !== doc.id)
      throw forbidden("Acceptance session is for another document");
  } else if (
    org.settings.requireAcceptanceSessions ||
    org.settings.signingPolicy === "ACCOUNT_AND_PASSKEY"
  ) {
    throw forbidden("This organization requires an acceptance session issued by its own server");
  }

  // Organization policy: which signer types are accepted, and whose key this is.
  const signer = await resolveSigner(deps, {
    org,
    signer: input.signer,
    signerType: input.signerType ?? "wallet",
    host: input.requestDomain,
    externalUserRef: sessionRow?.externalUserRef ?? null,
  });

  // Anti-exhaustion: bound the number of open (unsigned) challenges per organization so bots cannot
  // burn nonce capacity without ever producing a signature.
  const [{ open } = { open: 0 }] = await deps.db
    .select({ open: sql<number>`count(*)::int` })
    .from(acceptanceChallenges)
    .where(
      and(
        eq(acceptanceChallenges.organizationId, org.id),
        eq(acceptanceChallenges.status, "issued"),
        gt(acceptanceChallenges.expiresAt, Math.floor(Date.now() / 1000)),
      ),
    );
  if (open >= MAX_OPEN_CHALLENGES_PER_ORG) {
    throw new ApiError(
      429,
      "too_many_open_challenges",
      "Too many pending acceptance requests for this organization; try again shortly",
    );
  }

  // Fees: decided before anyone signs (refused early when nobody can pay).
  const plan = await planSponsorship(deps, org);
  const nonce = await allocateFreeNonce(deps, org.id, plan.preferredShards);
  const now = await deps.chain.clusterTime();
  const issuedAt = now;
  const expiresAt = now + DEFAULT_CHALLENGE_TTL;
  const nonceTag = new Uint8Array(randomBytes(8));
  let built;
  try {
    const common = {
      rpc: deps.chain.rpc,
      programAddress: deps.chain.programAddress,
      organization: address(org.address),
      document: address(doc.address),
      version: address(doc.currentVersionAddress),
      nonceShard: address(nonce.shardAddress),
      issuedAt,
      expiresAt,
      nonceIndex: nonce.index,
      nonceTag,
      requestDomain: input.requestDomain,
      clusterTime: now,
    };
    built = native
      ? await buildPasskeyAcceptanceMessageFromChain({
          ...common,
          signer: p256KeyFromId(input.signer),
        })
      : await buildAcceptanceMessageFromChain({ ...common, signer: address(input.signer) });
  } catch (e) {
    if (e instanceof ChainStateError) throw conflict("chain_state", e.message);
    throw e;
  }
  // Refuse to issue a challenge whose domain status would flip during the validity window.
  if (built.fields.orgVerifiedDomain && Number(built.organization.domainExpiresAt) <= expiresAt) {
    throw conflict(
      "domain_expiring",
      "The organization's domain verification expires within the acceptance window; renew it first",
    );
  }

  const clientBinding = randomToken(32);
  const [row] = await deps.db
    .insert(acceptanceChallenges)
    .values({
      organizationId: org.id,
      documentId: doc.id,
      versionAddress: doc.currentVersionAddress,
      shardRowId: nonce.shardRowId,
      nonceIndex: nonce.index,
      nonceTag: toHex(nonceTag),
      signerAddress: input.signer,
      requestDomain: input.requestDomain,
      issuedAt,
      expiresAt,
      message: built.message,
      clientBindingHash: sha256Hex(clientBinding),
      acceptanceSessionId: sessionRow?.id ?? null,
      externalUserRef: sessionRow?.externalUserRef ?? null,
      signerType: signer.signerType,
      signerIdentityId: signer.identity?.id ?? null,
    })
    .returning({ id: acceptanceChallenges.id });

  const v = built.version;
  return {
    challengeId: row!.id,
    clientBinding,
    message: built.message,
    issuedAt,
    expiresAt,
    nonce: { shardId: nonce.shardId, index: nonce.index, tag: toHex(nonceTag) },
    version: {
      address: doc.currentVersionAddress,
      number: v.version,
      label: v.versionLabel,
      title: v.title,
      fingerprint: toHex(v.versionHash),
      contentHash: toHex(v.contentHash),
      storageUri: v.storageUri,
    },
    organization: {
      address: org.address,
      name: built.organization.name,
      verifiedDomain: built.fields.orgVerifiedDomain,
    },
    network: { label: built.config.networkLabel, chainId: built.config.chainId },
    signerType: signer.signerType,
    protocol: native ? "stele/2" : "stele/1",
    passkey:
      signer.signerType === "wallet"
        ? null
        : {
            kind: native ? "native" : "prf",
            challenge: toBase64Url(
              native
                ? nativeAcceptanceChallenge(built.message)
                : passkeySignatureChallenge(built.message),
            ),
            rpId: signer.identity!.rpId,
            allowCredentials: signer.credentials,
          },
    feeSponsor: plan.sponsor,
  };
}

function isBase58Key(value: string): boolean {
  try {
    return fromBase58(value).length === 32;
  } catch {
    return false;
  }
}

export interface SubmitResult {
  acceptanceId: string;
  /** Null while a MERKLE_BATCHED acceptance waits for its batch anchor. */
  transactionSignature: string | null;
  slot: number | null;
  status: "confirmed" | "pending_batch";
  evidenceMode: EvidenceMode;
  signerType: SignerType;
  fee: {
    payer: string;
    lamports: number;
    sponsor: "stele" | "organization";
    reimbursedLamports: number | null;
  } | null;
}

export async function submitChallenge(
  deps: Deps,
  challengeId: string,
  clientBinding: string,
  /** Ed25519 signature (wallet and PRF signers); unused for native passkeys. */
  signatureBase58: string | undefined,
  passkeyAssertion?: PasskeyAssertion,
): Promise<SubmitResult> {
  const [ch] = await deps.db
    .select()
    .from(acceptanceChallenges)
    .where(eq(acceptanceChallenges.id, challengeId));
  if (!ch || !matchesHash(clientBinding, ch.clientBindingHash)) throw notFound("Challenge");
  if (ch.status === "confirmed" || ch.status === "finalized") {
    return {
      acceptanceId: ch.acceptanceId!,
      transactionSignature: ch.txSignature!,
      slot: 0,
      status: "confirmed",
      evidenceMode: ch.txSignature ? await evidenceModeOfRecord(deps, ch) : "DIRECT_ONCHAIN",
      signerType: ch.signerType as SignerType,
      fee: null,
    };
  }
  if (ch.status === "submitted" && ch.acceptanceId && !ch.txSignature) {
    // Already verified and queued for a batch anchor.
    return {
      acceptanceId: ch.acceptanceId,
      transactionSignature: null,
      slot: null,
      status: "pending_batch",
      evidenceMode: "MERKLE_BATCHED",
      signerType: ch.signerType as SignerType,
      fee: null,
    };
  }
  if (ch.status !== "issued") throw conflict("challenge_not_open", `Challenge is ${ch.status}`);
  if (ch.signerType === "passkey_p256") return submitNativeChallenge(deps, ch, passkeyAssertion);
  if (!signatureBase58)
    throw badRequest("invalid_signature", "The Ed25519 signature over the message is required");
  const signature = fromBase58(signatureBase58);
  if (signature.length !== 64) throw badRequest("invalid_signature", "Signature must be 64 bytes");
  const signer = fromBase58(ch.signerAddress);
  if (!verifyEd25519(signature, utf8(ch.message), signer)) {
    throw badRequest(
      "invalid_signature",
      "The signature does not match the challenge message and account",
    );
  }
  const now = await deps.chain.clusterTime();
  if (now > ch.expiresAt) {
    await deps.db
      .update(acceptanceChallenges)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(acceptanceChallenges.id, ch.id));
    throw conflict("challenge_expired", "The challenge expired; request a new one");
  }
  // Passkey-protected keys: the passkey must have approved exactly this message, with user
  // verification, on the requesting site. A stolen unlocked key alone cannot get anything recorded.
  if (ch.signerType === "passkey") {
    await verifySigningAssertion(deps, {
      identityId: ch.signerIdentityId!,
      assertion: passkeyAssertion,
      message: ch.message,
      host: ch.requestDomain,
    });
  }
  // Claim the challenge (single submission even under concurrent requests).
  const [claimed] = await deps.db
    .update(acceptanceChallenges)
    .set({
      status: "submitted",
      passkeyAssertion: ch.signerType === "passkey" ? passkeyAssertion! : null,
      updatedAt: new Date(),
    })
    .where(and(eq(acceptanceChallenges.id, ch.id), eq(acceptanceChallenges.status, "issued")))
    .returning({ id: acceptanceChallenges.id });
  if (!claimed) throw conflict("challenge_not_open", "Challenge already submitted");

  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, ch.organizationId));
  if (org!.settings.evidenceMode === "MERKLE_BATCHED") {
    await assertVersionStillCurrent(deps, ch);
    const id = acceptanceId(
      fromBase58(ch.versionAddress),
      signer,
      messageHash(utf8(ch.message)),
      signature,
    );
    return batched(
      deps,
      ch,
      await queueBatchedAcceptance(deps, ch, {
        protocol: "stele/1",
        acceptanceId: toHex(id),
        versionAddress: ch.versionAddress,
        message: ch.message,
        signature: toBase58(signature),
        signer: {
          type: "ED25519_KEY",
          algorithm: "Ed25519",
          publicKey: ch.signerAddress,
          evidence: await signerEvidenceFor(deps, {
            signerType: ch.signerType,
            passkeyAssertion: passkeyAssertion ?? null,
          }),
        },
      }),
    );
  }
  const [doc] = await deps.db.select().from(documents).where(eq(documents.id, ch.documentId));
  const [shard] = await deps.db.select().from(nonceShards).where(eq(nonceShards.id, ch.shardRowId));
  const [config] = await findConfigPda(deps.chain.programAddress);
  const recordInstruction = recordAcceptanceInstruction({
    programAddress: deps.chain.programAddress,
    relayer: deps.chain.relayer,
    config,
    organization: address(org!.address),
    document: address(doc!.address),
    version: address(ch.versionAddress),
    nonceShard: address(shard!.address),
    nonceIndex: ch.nonceIndex,
    nonceTag: fromHex(ch.nonceTag, 8),
    issuedAt: ch.issuedAt,
    expiresAt: ch.expiresAt,
  });
  const ed = buildEd25519Instruction(signer, signature, utf8(ch.message));

  return relayAndIndex(deps, ch, { org: org!, doc: doc!, shard: shard! }, ed, recordInstruction);
}

type Challenge = typeof acceptanceChallenges.$inferSelect;

/**
 * Native passkey (stele/2): verify the P-256 assertion as the program will, then relay
 * [secp256r1 verify, record_passkey_acceptance]. Nothing the browser sends is trusted beyond the
 * signed bytes, which the precompile and the program check again.
 */
async function submitNativeChallenge(
  deps: Deps,
  ch: Challenge,
  assertion: PasskeyAssertion | undefined,
): Promise<SubmitResult> {
  if (!assertion)
    throw badRequest(
      "passkey_assertion_required",
      "A passkey assertion over this message is required",
    );
  const [row] = await deps.db
    .select({ c: passkeyCredentials, i: signerIdentities })
    .from(passkeyCredentials)
    .innerJoin(signerIdentities, eq(signerIdentities.id, passkeyCredentials.identityId))
    .where(eq(passkeyCredentials.credentialId, assertion.credentialId));
  if (
    !row ||
    row.i.id !== ch.signerIdentityId ||
    row.i.publicKey !== ch.signerAddress ||
    row.c.revokedAt ||
    row.i.status !== "active"
  )
    throw forbidden("The assertion was not made with an active passkey of this signer");
  const key = p256KeyFromId(ch.signerAddress);
  const verified = verifyNativeAssertion(assertion, {
    key,
    challenge: nativeAcceptanceChallenge(ch.message),
    requestDomain: ch.requestDomain,
    rpId: row.i.rpId,
    previousSignCount: row.c.signCount,
  });
  const now = await deps.chain.clusterTime();
  if (now > ch.expiresAt) {
    await deps.db
      .update(acceptanceChallenges)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(acceptanceChallenges.id, ch.id));
    throw conflict("challenge_expired", "The challenge expired; request a new one");
  }
  const [claimed] = await deps.db
    .update(acceptanceChallenges)
    .set({ status: "submitted", passkeyAssertion: assertion, updatedAt: new Date() })
    .where(and(eq(acceptanceChallenges.id, ch.id), eq(acceptanceChallenges.status, "issued")))
    .returning({ id: acceptanceChallenges.id });
  if (!claimed) throw conflict("challenge_not_open", "Challenge already submitted");
  await deps.db
    .update(passkeyCredentials)
    .set({ signCount: verified.signCount, lastUsedAt: new Date() })
    .where(eq(passkeyCredentials.id, row.c.id));

  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, ch.organizationId));
  if (org!.settings.evidenceMode === "MERKLE_BATCHED") {
    await assertVersionStillCurrent(deps, ch);
    const id = passkeyAcceptanceId(
      fromBase58(ch.versionAddress),
      key,
      messageHash(utf8(ch.message)),
      verified.signature,
    );
    return batched(
      deps,
      ch,
      await queueBatchedAcceptance(deps, ch, {
        protocol: "stele/2",
        acceptanceId: toHex(id),
        versionAddress: ch.versionAddress,
        message: ch.message,
        signature: null,
        signer: {
          type: "NATIVE_PASSKEY",
          algorithm: "ES256",
          publicKey: toHex(key),
          enrollment:
            row.i.enrollmentAddress && row.i.accountCommitment
              ? { address: row.i.enrollmentAddress, accountCommitment: row.i.accountCommitment }
              : null,
        },
        webauthn: {
          authenticatorData: toBase64Url(fromBase64Url(assertion.authenticatorData)),
          clientDataJSON: toBase64Url(verified.clientData),
          signature: toHex(verified.signature),
          rpId: row.i.rpId,
        },
      }),
    );
  }
  const [doc] = await deps.db.select().from(documents).where(eq(documents.id, ch.documentId));
  const [shard] = await deps.db.select().from(nonceShards).where(eq(nonceShards.id, ch.shardRowId));
  const [config] = await findConfigPda(deps.chain.programAddress);
  const record = recordPasskeyAcceptanceInstruction({
    programAddress: deps.chain.programAddress,
    relayer: deps.chain.relayer,
    config,
    organization: address(org!.address),
    document: address(doc!.address),
    version: address(ch.versionAddress),
    nonceShard: address(shard!.address),
    // Account-bound signers: the program checks the enrollment is active, for this key and RP.
    enrollment: row.i.enrollmentAddress ? address(row.i.enrollmentAddress) : null,
    nonceIndex: ch.nonceIndex,
    nonceTag: fromHex(ch.nonceTag, 8),
    issuedAt: ch.issuedAt,
    expiresAt: ch.expiresAt,
    assertion: {
      requestDomain: ch.requestDomain,
      rpId: row.i.rpId,
      clientDataJson: verified.clientData,
    },
  });
  const precompile = secp256r1Instruction(key, verified.signature, verified.signed);
  return relayAndIndex(deps, ch, { org: org!, doc: doc!, shard: shard! }, precompile, record);
}

/**
 * MERKLE_BATCHED: the program will not check that the version is current when the batch is
 * anchored, so the relayer checks it now, from the chain (verifiers check it again).
 */
async function assertVersionStillCurrent(deps: Deps, ch: Challenge): Promise<void> {
  const [doc] = await deps.db.select().from(documents).where(eq(documents.id, ch.documentId));
  const data = await fetchAccountData(deps.chain.rpc, address(doc!.address));
  if (!data || decodeDocument(data).currentVersion !== ch.versionAddress)
    throw conflict(
      "version_superseded",
      "A newer version was published; review it and accept again",
    );
}

function batched(
  _deps: Deps,
  ch: Challenge,
  queued: { acceptanceId: string; status: "pending_batch" },
): SubmitResult {
  return {
    acceptanceId: queued.acceptanceId,
    transactionSignature: null,
    slot: null,
    status: "pending_batch",
    evidenceMode: "MERKLE_BATCHED",
    signerType: ch.signerType as SignerType,
    fee: null,
  };
}

async function evidenceModeOfRecord(deps: Deps, ch: Challenge): Promise<EvidenceMode> {
  const [row] = await deps.db
    .select({ mode: acceptances.evidenceMode })
    .from(acceptances)
    .where(eq(acceptances.acceptanceId, ch.acceptanceId!));
  return row?.mode ?? "DIRECT_ONCHAIN";
}

/** Relays the recording, indexes it from the confirmed transaction, books and notifies. */
async function relayAndIndex(
  deps: Deps,
  ch: Challenge,
  ctx: {
    org: typeof organizations.$inferSelect;
    doc: typeof documents.$inferSelect;
    shard: typeof nonceShards.$inferSelect;
  },
  precompile: Parameters<Deps["chain"]["sendRecord"]>[0],
  recordInstruction: Parameters<Deps["chain"]["sendRecord"]>[1],
): Promise<SubmitResult> {
  const { doc, shard } = ctx;
  let txSignature: string;
  try {
    txSignature = await deps.chain.sendRecord(precompile, recordInstruction);
  } catch (e) {
    const reason = describeFailure(e);
    await deps.db
      .update(acceptanceChallenges)
      .set({ status: "failed", failureReason: reason, updatedAt: new Date() })
      .where(eq(acceptanceChallenges.id, ch.id));
    deps.logger.error({ challengeId: ch.id, reason }, "acceptance relay failed");
    // The nonce was consumed elsewhere after it was handed out: fast-forward the cursor.
    if (/NonceAlreadyUsed/.test(reason))
      await syncShard(deps.db, deps.chain, shard.address).catch(() => undefined);
    throw new ApiError(502, "relay_failed", `The acceptance could not be recorded: ${reason}`);
  }

  // Index from the confirmed transaction itself (not from request data).
  const recorded = await indexAcceptanceTransaction(deps.db, deps.chain, txSignature, {
    challengeId: ch.id,
    externalUserRef: ch.externalUserRef,
    signerType: ch.signerType as SignerType,
    message: ch.message,
  });
  const mine = recorded.find(
    (r) => r.versionAddress === ch.versionAddress && r.signer === ch.signerAddress,
  );
  if (!mine) {
    await deps.db
      .update(acceptanceChallenges)
      .set({
        status: "failed",
        failureReason: "transaction did not contain the expected acceptance",
        txSignature,
        updatedAt: new Date(),
      })
      .where(eq(acceptanceChallenges.id, ch.id));
    throw new ApiError(
      502,
      "relay_inconsistent",
      "The confirmed transaction did not contain the expected acceptance",
    );
  }
  await deps.db
    .update(acceptanceChallenges)
    .set({
      status: "confirmed",
      txSignature,
      acceptanceId: mine.acceptanceId,
      updatedAt: new Date(),
    })
    .where(eq(acceptanceChallenges.id, ch.id));
  if (ch.acceptanceSessionId) {
    await deps.db
      .update(acceptanceSessions)
      .set({ consumedAt: new Date() })
      .where(eq(acceptanceSessions.id, ch.acceptanceSessionId));
  }
  await bookRecording(deps, {
    organizationId: ch.organizationId,
    txSignature,
    recordKind: "acceptance",
    recordId: mine.acceptanceId,
    shardAddress: mine.shardAddress,
    fee: mine.fee,
  });
  const fee = {
    payer: mine.fee.feePayer,
    lamports: mine.fee.feeLamports,
    sponsor: mine.fee.reimbursedLamports !== null ? ("organization" as const) : ("stele" as const),
    reimbursedLamports: mine.fee.reimbursedLamports,
  };
  await enqueueWebhook(deps.db, ch.organizationId, "agreement.accepted", {
    acceptanceId: mine.acceptanceId,
    transactionSignature: txSignature,
    slot: mine.slot,
    commitment: "confirmed",
    signer: ch.signerAddress,
    document: doc.address,
    documentSlug: doc.slug,
    version: ch.versionAddress,
    versionNumber: mine.versionNumber,
    externalUserRef: ch.externalUserRef,
    signerType: ch.signerType,
    protocol: mine.protocol,
    fee,
    receiptUrl: `${deps.config.APP_ORIGIN}/receipt/${mine.acceptanceId}`,
    verify:
      "Verify independently: the transaction signature and acceptance ID are sufficient. Do not treat this webhook as proof.",
  });
  return {
    acceptanceId: mine.acceptanceId,
    transactionSignature: txSignature,
    slot: mine.slot,
    status: "confirmed",
    evidenceMode: "DIRECT_ONCHAIN",
    signerType: ch.signerType as SignerType,
    fee,
  };
}

function describeFailure(e: unknown): string {
  return explainTransactionError(e).message.slice(0, 300);
}

export async function getChallengeStatus(deps: Deps, challengeId: string, clientBinding: string) {
  const [ch] = await deps.db
    .select()
    .from(acceptanceChallenges)
    .where(eq(acceptanceChallenges.id, challengeId));
  if (!ch || !matchesHash(clientBinding, ch.clientBindingHash)) throw notFound("Challenge");
  return {
    status: ch.status,
    expiresAt: ch.expiresAt,
    transactionSignature: ch.txSignature,
    acceptanceId: ch.acceptanceId,
    failureReason: ch.failureReason,
  };
}
