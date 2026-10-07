/**
 * Chain → database synchronization. The database is populated ONLY by reading Solana: client
 * claims ("I created this organization", "I published this version") are never trusted — the API
 * re-reads the accounts or transactions and mirrors what the chain says. The same functions power
 * the indexer, so the index can be rebuilt from scratch.
 */
import { address, type Address } from "@solana/kit";
import {
  ACCOUNT_DISCRIMINATORS,
  PASSKEY_ACCEPTANCE_TAG,
  PASSKEY_KIND_ROTATED,
  PASSKEY_STATUS_REVOKED,
  ROLE_ADMIN,
  ROLE_PUBLISHER,
  SECP256R1_PROGRAM_ADDRESS,
  acceptanceId,
  buildPasskeyAcceptanceMessage,
  bytesEqual,
  checkPasskeyAssertion,
  decodeEventsFromLogs,
  decodePasskeySigner,
  decodeProtocolConfig,
  decodeRecordPasskeyAcceptanceArgs,
  findConfigPda,
  p256KeyId,
  parseSecp256r1Instruction,
  passkeyAcceptanceId,
  sha256,
  toBase64Url,
  utf8,
  verifiedDomainAt,
  verifyP256,
  webauthnChallenge,
  type SteleEvent,
  decodeDocument,
  decodeGatePolicy,
  decodeDocumentVersion,
  decodeMember,
  decodeNonceShard,
  decodeOrganization,
  decodeRecordAcceptanceArgs,
  decodeRecordProofArgs,
  ED25519_PROGRAM_ADDRESS,
  fetchAccountData,
  fetchManyAccountData,
  findVersionPda,
  fromBase58,
  fromBase64,
  fromUtf8,
  identifyInstruction,
  messageHash,
  parseAcceptanceMessage,
  parseCanonicalEd25519Data,
  parseProofMessage,
  proofId,
  proofTypeByCode,
  toBase58,
  toHex,
  verifyEd25519,
} from "@stele/protocol";
import { decodeWireTransaction } from "@stele/verifier";
import {
  accessPasses,
  acceptances,
  gatePolicies,
  and,
  documents,
  documentVersions,
  eq,
  ne,
  nonceShards,
  organizationMembers,
  organizations,
  proofs,
  signerIdentities,
  sql,
  type Database,
} from "@stele/db";
import { feeFacts, type FeeFacts } from "../services/sponsorship.js";
import type { ChainService } from "./chain.js";
import { enqueueWebhook } from "./webhooks.js";

const seconds = (s: bigint) => new Date(Number(s) * 1000);

export async function syncOrganization(
  db: Database,
  chain: ChainService,
  orgAddress: string,
): Promise<{ id: string } | null> {
  const data = await fetchAccountData(chain.rpc, address(orgAddress));
  if (!data) return null;
  const org = decodeOrganization(data);
  const values = {
    address: orgAddress,
    creatorAddress: org.creator,
    name: org.name,
    ownerAddress: org.owner,
    recoveryAddress: org.recovery,
    verifiedDomain: org.verifiedDomain,
    domainVerifiedAt: org.verifiedDomain ? seconds(org.domainVerifiedAt) : null,
    domainExpiresAt: org.verifiedDomain ? seconds(org.domainExpiresAt) : null,
    frozen: org.frozen,
    frozenBy: org.frozenBy,
    chainSyncedAt: new Date(),
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(organizations)
    .values(values)
    .onConflictDoUpdate({ target: organizations.address, set: values })
    .returning({ id: organizations.id });
  await syncMembers(db, chain, row!.id, orgAddress);
  return row!;
}

/** Mirrors every on-chain Member account of the organization. */
export async function syncMembers(
  db: Database,
  chain: ChainService,
  organizationId: string,
  orgAddress: string,
): Promise<void> {
  const accounts = await chain.rpc
    .getProgramAccounts(chain.programAddress, {
      encoding: "base64",
      commitment: "confirmed",
      filters: [
        {
          memcmp: {
            offset: 0n,
            bytes: toBase58(ACCOUNT_DISCRIMINATORS.Member) as never,
            encoding: "base58",
          },
        },
        { memcmp: { offset: 8n, bytes: orgAddress as never, encoding: "base58" } },
      ],
    })
    .send();
  const existing = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organizationId));
  for (const acc of accounts) {
    const m = decodeMember(fromBase64(acc.account.data[0]));
    const values = {
      organizationId,
      memberAddress: m.member,
      roles: m.roles & (ROLE_ADMIN | ROLE_PUBLISHER),
      active: m.revokedAt === 0n,
      compromisedSince: m.compromisedSince === 0n ? null : seconds(m.compromisedSince),
      updatedAt: new Date(),
    };
    const before = existing.find((e) => e.memberAddress === m.member);
    const changed =
      !before ||
      before.roles !== values.roles ||
      before.active !== values.active ||
      (before.compromisedSince?.getTime() ?? null) !== (values.compromisedSince?.getTime() ?? null);
    await db
      .insert(organizationMembers)
      .values(values)
      .onConflictDoUpdate({
        target: [organizationMembers.organizationId, organizationMembers.memberAddress],
        set: values,
      });
    if (changed) {
      await enqueueWebhook(db, organizationId, "organization.member_changed", {
        member: m.member,
        memberAccount: acc.pubkey,
        roles: {
          admin: (values.roles & ROLE_ADMIN) !== 0,
          publisher: (values.roles & ROLE_PUBLISHER) !== 0,
        },
        active: values.active,
        compromisedSince: values.compromisedSince?.toISOString() ?? null,
        change: !before
          ? "added"
          : !values.active && before.active
            ? "revoked"
            : values.compromisedSince && !before.compromisedSince
              ? "compromise_reported"
              : "updated",
      });
    }
  }
}

export async function syncDocument(
  db: Database,
  chain: ChainService,
  documentAddress: string,
): Promise<{ id: string; organizationId: string } | null> {
  const data = await fetchAccountData(chain.rpc, address(documentAddress));
  if (!data) return null;
  const doc = decodeDocument(data);
  let [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.address, doc.organization));
  if (!org) org = (await syncOrganization(db, chain, doc.organization)) ?? undefined;
  if (!org) return null;
  const values = {
    organizationId: org.id,
    address: documentAddress,
    slug: doc.slug,
    documentType: doc.documentType,
    locale: doc.locale,
    versionCount: doc.versionCount,
    headHash: doc.versionCount > 0 ? toHex(doc.headHash) : null,
    currentVersionAddress: doc.currentVersion,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(documents)
    .values(values)
    .onConflictDoUpdate({ target: documents.address, set: values })
    .returning({ id: documents.id });

  // Mirror every version (immutable on-chain; inserts are idempotent).
  if (doc.versionCount > 0) {
    const addrs: Address[] = [];
    for (let n = 1; n <= doc.versionCount; n++)
      addrs.push((await findVersionPda(address(documentAddress), n, chain.programAddress))[0]);
    const datas = await fetchManyAccountData(chain.rpc, addrs);
    for (let i = 0; i < addrs.length; i++) {
      const d = datas[i];
      if (!d) continue;
      const v = decodeDocumentVersion(d);
      await db
        .insert(documentVersions)
        .values({
          documentId: row!.id,
          organizationId: org.id,
          address: addrs[i]!,
          number: v.version,
          versionHash: toHex(v.versionHash),
          contentHash: toHex(v.contentHash),
          previousVersionHash: v.version === 1 ? null : toHex(v.previousVersionHash),
          title: v.title,
          versionLabel: v.versionLabel,
          effectiveAt: v.effectiveAt === 0n ? null : Number(v.effectiveAt),
          publishedAt: seconds(v.publishedAt),
          publishedSlot: Number(v.publishedSlot),
          publisherAddress: v.publisher,
          publisherRole: v.publisherRole,
          storageUri: v.storageUri,
        })
        .onConflictDoNothing();
    }
  }
  return { id: row!.id, organizationId: org.id };
}

export async function syncShard(
  db: Database,
  chain: ChainService,
  shardAddress: string,
): Promise<void> {
  const data = await fetchAccountData(chain.rpc, address(shardAddress));
  if (!data) return;
  const s = decodeNonceShard(data);
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.address, s.organization));
  if (!org) return;
  // Rebuild the allocation cursor from the on-chain bitmap (DB loss, pre-used shards): never hand
  // out an index at or below the highest consumed bit. The cursor only ever moves forward.
  let highest = -1;
  for (let byte = s.bitmap.length - 1; byte >= 0 && highest < 0; byte--) {
    const b = s.bitmap[byte]!;
    if (b !== 0) highest = byte * 8 + (31 - Math.clz32(b));
  }
  const floor = highest + 1;
  await db
    .insert(nonceShards)
    .values({
      organizationId: org.id,
      address: shardAddress,
      shardId: s.shardId,
      relayerAddress: s.relayer ?? "",
      nextIndex: floor,
    })
    .onConflictDoUpdate({
      target: nonceShards.address,
      set: {
        relayerAddress: s.relayer ?? "",
        nextIndex: sql`greatest(${nonceShards.nextIndex}, ${floor})`,
      },
    });
}

export interface RecordedAcceptance {
  acceptanceId: string;
  /** "stele/1" (Ed25519) or "stele/2" (native passkey, secp256r1). */
  protocol: "stele/1" | "stele/2";
  organizationId: string;
  documentId: string;
  versionAddress: string;
  versionNumber: number;
  signer: string;
  slot: number;
  blockTime: Date | null;
  shardAddress: string;
  fee: FeeFacts;
}

/**
 * Polls until `fetch` returns a value or `timeoutMs` passes. A transaction confirmed through its
 * signature status can take a moment before `getTransaction` serves it (the node writes
 * transaction statuses asynchronously), so callers that just confirmed one wait here.
 */
export async function untilAvailable<T>(
  fetch: () => Promise<T | null | undefined>,
  timeoutMs = 8_000,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fetch();
    if (value || Date.now() >= deadline) return value ?? null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function fetchRecordingTransaction(chain: ChainService, signature: string) {
  const tx = await chain.rpc
    .getTransaction(signature as never, {
      encoding: "base64",
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    })
    .send();
  if (!tx || tx.meta?.err) return null;
  const decoded = decodeWireTransaction(
    fromBase64(tx.transaction[0]),
    [...(tx.meta?.loadedAddresses?.writable ?? [])],
    [...(tx.meta?.loadedAddresses?.readonly ?? [])],
  );
  return {
    tx,
    decoded,
    feeSource: {
      accountKeys: decoded.accountKeys,
      fee: Number(tx.meta?.fee ?? 0),
      logs: tx.meta?.logMessages ?? [],
    },
  };
}

/**
 * Indexes every acceptance in a transaction. The transaction must have succeeded; each signature
 * is re-verified locally and each message strictly parsed before anything is written.
 */
export async function indexAcceptanceTransaction(
  db: Database,
  chain: ChainService,
  signature: string,
  extras: {
    challengeId?: string | null;
    externalUserRef?: string | null;
    signerType?: "wallet" | "passkey" | "passkey_p256";
    /** stele/2: the message the relayer issued (kept only if it hashes to the on-chain hash). */
    message?: string | null;
  } = {},
): Promise<RecordedAcceptance[]> {
  const fetched = await fetchRecordingTransaction(chain, signature);
  if (!fetched) return [];
  const { tx, decoded, feeSource } = fetched;
  const out: RecordedAcceptance[] = [];
  let events: SteleEvent[] | null = null;
  for (const ix of decoded.instructions) {
    if (ix.programId !== chain.programAddress) continue;
    const name = identifyInstruction(ix.data);
    if (name === "record_passkey_acceptance") {
      events ??= decodeEventsFromLogs(feeSource.logs, chain.programAddress);
      const recorded = await indexPasskeyAcceptance(db, chain, {
        signature,
        tx,
        ix,
        prev: decoded.instructions[ix.index - 1],
        events,
        feeSource,
        extras,
      });
      if (recorded) out.push(recorded);
      continue;
    }
    if (name !== "record_acceptance" && name !== "record_gated_acceptance") continue;
    const prev = decoded.instructions[ix.index - 1];
    if (!prev || prev.programId !== ED25519_PROGRAM_ADDRESS) continue;
    const ed = parseCanonicalEd25519Data(prev.data);
    if (!verifyEd25519(ed.signature, ed.message, ed.publicKey)) continue;
    const message = parseAcceptanceMessage(fromUtf8(ed.message));
    const args = decodeRecordAcceptanceArgs(ix.data);
    const [, , orgAddr, docAddr, versionAddr, shardAddr] = ix.accounts;
    const doc = await syncDocument(db, chain, docAddr!);
    if (!doc) continue;
    const id = toHex(
      acceptanceId(fromBase58(versionAddr!), ed.publicKey, messageHash(ed.message), ed.signature),
    );
    const blockTime = tx.blockTime ? new Date(Number(tx.blockTime) * 1000) : null;
    const fee = feeFacts(feeSource, chain.programAddress, id);
    await db
      .insert(acceptances)
      .values({
        acceptanceId: id,
        organizationId: doc.organizationId,
        documentId: doc.id,
        versionAddress: versionAddr!,
        versionNumber: message.version,
        signerAddress: toBase58(ed.publicKey),
        txSignature: signature,
        slot: Number(tx.slot),
        blockTime,
        issuedAt: Number(args.issuedAt),
        expiresAt: Number(args.expiresAt),
        nonceShardAddress: shardAddr!,
        nonceIndex: args.nonceIndex,
        messageHash: toHex(messageHash(ed.message)),
        requestDomain: message.requestDomain,
        challengeId: extras.challengeId ?? null,
        externalUserRef: extras.externalUserRef ?? null,
        signerType: extras.signerType ?? "wallet",
        feePayer: fee.feePayer,
        feeLamports: fee.feeLamports,
        reimbursedLamports: fee.reimbursedLamports,
      })
      .onConflictDoUpdate({
        target: acceptances.acceptanceId,
        set: {
          challengeId: sql`coalesce(${acceptances.challengeId}, excluded.challenge_id)`,
          externalUserRef: sql`coalesce(${acceptances.externalUserRef}, excluded.external_user_ref)`,
          signerType: extras.signerType
            ? sql`excluded.signer_type`
            : sql`${acceptances.signerType}`,
          feePayer: sql`excluded.fee_payer`,
          feeLamports: sql`excluded.fee_lamports`,
          reimbursedLamports: sql`excluded.reimbursed_lamports`,
        },
      });
    void orgAddr;
    // Whoever relayed it, this nonce is consumed: never hand it out (cursor only moves forward).
    await db
      .update(nonceShards)
      .set({ nextIndex: sql`greatest(${nonceShards.nextIndex}, ${args.nonceIndex + 1})` })
      .where(eq(nonceShards.address, shardAddr!));
    if (name === "record_gated_acceptance") {
      events ??= decodeEventsFromLogs(feeSource.logs, chain.programAddress);
      await indexAccessPass(db, events, {
        organizationId: doc.organizationId,
        documentId: doc.id,
        acceptanceId: id,
        signature,
      });
    }
    out.push({
      acceptanceId: id,
      protocol: "stele/1",
      organizationId: doc.organizationId,
      documentId: doc.id,
      versionAddress: versionAddr!,
      versionNumber: message.version,
      signer: toBase58(ed.publicKey),
      slot: Number(tx.slot),
      blockTime,
      shardAddress: shardAddr!,
      fee,
    });
  }
  return out;
}

type RecordingTransaction = NonNullable<Awaited<ReturnType<typeof fetchRecordingTransaction>>>;
type DecodedInstruction = RecordingTransaction["decoded"]["instructions"][number];

/**
 * Rebuilds a stele/2 message from chain state as of its recording (version and shard are immutable;
 * the organization's name and the network label can change later, so a rebuild may not match —
 * the caller keeps it only if it hashes to the on-chain message hash).
 */
async function rebuildPasskeyMessage(
  chain: ChainService,
  i: {
    organization: string;
    version: string;
    shard: string;
    signer: Uint8Array;
    recordedAt: bigint;
    args: ReturnType<typeof decodeRecordPasskeyAcceptanceArgs>;
  },
): Promise<string | null> {
  const [cfg] = await findConfigPda(chain.programAddress);
  const [cfgData, orgData, verData, shardData] = await fetchManyAccountData(chain.rpc, [
    cfg,
    address(i.organization),
    address(i.version),
    address(i.shard),
  ]);
  if (!cfgData || !orgData || !verData || !shardData) return null;
  const org = decodeOrganization(orgData);
  const version = decodeDocumentVersion(verData);
  try {
    return buildPasskeyAcceptanceMessage(
      {
        orgName: org.name,
        orgVerifiedDomain: verifiedDomainAt(org, Number(i.recordedAt)),
        title: version.title,
        versionLabel: version.versionLabel,
        version: version.version,
        versionHash: version.versionHash,
        signer: i.signer,
        networkLabel: decodeProtocolConfig(cfgData).networkLabel,
        issuedAt: i.args.issuedAt,
        expiresAt: i.args.expiresAt,
        shardId: decodeNonceShard(shardData).shardId,
        nonceIndex: i.args.nonceIndex,
        nonceTag: i.args.nonceTag,
      },
      i.args.assertion.requestDomain,
    );
  } catch {
    return null;
  }
}

/** The browser-reported origin of a clientDataJSON (informational when the message is unknown). */
function clientDataOrigin(clientData: Uint8Array): string | null {
  try {
    const origin = (JSON.parse(fromUtf8(clientData)) as { origin?: unknown }).origin;
    return typeof origin === "string" ? origin : null;
  } catch {
    return null;
  }
}

/**
 * Indexes one `record_passkey_acceptance` (stele/2). The transaction succeeded, so the precompile
 * verified the P-256 signature and the program bound it to the message; the index re-checks what it
 * can locally (signature, event, acceptance ID and — when the message text is known — the whole
 * WebAuthn binding) and stores evidence read from the transaction, never from the client.
 */
async function indexPasskeyAcceptance(
  db: Database,
  chain: ChainService,
  i: {
    signature: string;
    tx: RecordingTransaction["tx"];
    ix: DecodedInstruction;
    prev: DecodedInstruction | undefined;
    events: SteleEvent[];
    feeSource: RecordingTransaction["feeSource"];
    extras: {
      challengeId?: string | null;
      externalUserRef?: string | null;
      message?: string | null;
    };
  },
): Promise<RecordedAcceptance | null> {
  if (!i.prev || i.prev.programId !== SECP256R1_PROGRAM_ADDRESS) return null;
  const p256 = parseSecp256r1Instruction(i.prev.data);
  if (!p256 || !verifyP256(p256.publicKey, p256.signature, p256.message)) return null;
  const args = decodeRecordPasskeyAcceptanceArgs(i.ix.data);
  const [, , orgAddr, docAddr, versionAddr, shardAddr] = i.ix.accounts;
  const found = i.events.find(
    (e) =>
      e.name === "PasskeyAcceptanceRecorded" &&
      e.data.nonceShard === shardAddr &&
      e.data.nonceIndex === args.nonceIndex,
  );
  if (!found || found.name !== "PasskeyAcceptanceRecorded") return null;
  const ev = found.data;
  if (!bytesEqual(ev.signerKey, p256.publicKey) || ev.version !== versionAddr) return null;
  const idBytes = passkeyAcceptanceId(
    fromBase58(versionAddr!),
    p256.publicKey,
    ev.messageHash,
    p256.signature,
  );
  if (!bytesEqual(idBytes, ev.acceptanceId)) return null;
  const doc = await syncDocument(db, chain, docAddr!);
  if (!doc) return null;
  const [ver] = await db
    .select({ number: documentVersions.number })
    .from(documentVersions)
    .where(eq(documentVersions.address, versionAddr!));
  if (!ver) return null;

  const clientData = args.assertion.clientDataJson;
  const hashesToEvent = (m: string | null | undefined): m is string =>
    typeof m === "string" && bytesEqual(sha256(utf8(m)), ev.messageHash);
  let message: string | null = hashesToEvent(i.extras.message) ? i.extras.message : null;
  if (!message) {
    const rebuilt = await rebuildPasskeyMessage(chain, {
      organization: orgAddr!,
      version: versionAddr!,
      shard: shardAddr!,
      signer: p256.publicKey,
      recordedAt: ev.recordedAt,
      args,
    });
    message = hashesToEvent(rebuilt) ? rebuilt : null;
  }
  // With the text known, re-check the WebAuthn binding exactly as the program did.
  const origin = message
    ? checkPasskeyAssertion({
        signed: p256.message,
        clientData,
        challenge: webauthnChallenge(PASSKEY_ACCEPTANCE_TAG, message),
        requestDomain: args.assertion.requestDomain,
        rpId: args.assertion.rpId,
      }).origin
    : clientDataOrigin(clientData);

  const id = toHex(idBytes);
  const signer = p256KeyId(p256.publicKey);
  const blockTime = i.tx.blockTime ? new Date(Number(i.tx.blockTime) * 1000) : null;
  const fee = feeFacts(i.feeSource, chain.programAddress, id);
  const evidence = {
    format: "webauthn-es256/1",
    publicKey: toHex(p256.publicKey),
    signature: toHex(p256.signature),
    authenticatorData: toBase64Url(p256.message.subarray(0, p256.message.length - 32)),
    clientDataJSON: toBase64Url(clientData),
    origin,
    rpId: args.assertion.rpId,
    authenticatorFlags: ev.authenticatorFlags,
    messageHash: toHex(ev.messageHash),
  };
  await db
    .insert(acceptances)
    .values({
      acceptanceId: id,
      organizationId: doc.organizationId,
      documentId: doc.id,
      versionAddress: versionAddr!,
      versionNumber: ver.number,
      signerAddress: signer,
      txSignature: i.signature,
      slot: Number(i.tx.slot),
      blockTime,
      issuedAt: Number(args.issuedAt),
      expiresAt: Number(args.expiresAt),
      nonceShardAddress: shardAddr!,
      nonceIndex: args.nonceIndex,
      messageHash: toHex(ev.messageHash),
      requestDomain: args.assertion.requestDomain,
      challengeId: i.extras.challengeId ?? null,
      externalUserRef: i.extras.externalUserRef ?? null,
      signerType: "passkey_p256",
      signedMessage: message,
      signerEvidence: evidence,
      enrollmentAddress: ev.enrollment,
      feePayer: fee.feePayer,
      feeLamports: fee.feeLamports,
      reimbursedLamports: fee.reimbursedLamports,
    })
    .onConflictDoUpdate({
      target: acceptances.acceptanceId,
      set: {
        challengeId: sql`coalesce(${acceptances.challengeId}, excluded.challenge_id)`,
        externalUserRef: sql`coalesce(${acceptances.externalUserRef}, excluded.external_user_ref)`,
        signedMessage: sql`coalesce(${acceptances.signedMessage}, excluded.signed_message)`,
        signerEvidence: sql`excluded.signer_evidence`,
        feePayer: sql`excluded.fee_payer`,
        feeLamports: sql`excluded.fee_lamports`,
        reimbursedLamports: sql`excluded.reimbursed_lamports`,
      },
    });
  await db
    .update(nonceShards)
    .set({ nextIndex: sql`greatest(${nonceShards.nextIndex}, ${args.nonceIndex + 1})` })
    .where(eq(nonceShards.address, shardAddr!));
  return {
    acceptanceId: id,
    protocol: "stele/2",
    organizationId: doc.organizationId,
    documentId: doc.id,
    versionAddress: versionAddr!,
    versionNumber: ver.number,
    signer,
    slot: Number(i.tx.slot),
    blockTime,
    shardAddress: shardAddr!,
    fee,
  };
}

/**
 * Mirrors an on-chain passkey enrollment (PasskeySigner) into the signer identities: the enrolled
 * key is the account's active signer; a key it replaced becomes "rotated" (endorsed by that key) or
 * "revoked" (organization recovery — NOT endorsed by the previous key); a revoked enrollment
 * revokes its key. The chain decides; the database follows.
 */
export async function syncPasskeySigner(
  db: Database,
  chain: ChainService,
  enrollmentAddress: string,
): Promise<{
  signer: string;
  status: "active" | "revoked";
  kind: number;
  changed: boolean;
} | null> {
  const data = await fetchAccountData(chain.rpc, address(enrollmentAddress));
  if (!data) return null;
  const e = decodePasskeySigner(data);
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.address, e.organization));
  if (!org) return null;
  const signer = p256KeyId(e.signerKey);
  const commitment = toHex(e.accountCommitment);
  const revoked = e.status === PASSKEY_STATUS_REVOKED;
  const now = new Date();
  const [current] = await db
    .select()
    .from(signerIdentities)
    .where(
      and(eq(signerIdentities.publicKey, signer), eq(signerIdentities.organizationId, org.id)),
    );
  if (current && current.accountCommitment !== null && current.accountCommitment !== commitment)
    return null;
  let changed = false;
  if (current) {
    const status = revoked ? "revoked" : "active";
    if (current.status !== status || current.enrollmentAddress !== enrollmentAddress) {
      changed = true;
      await db
        .update(signerIdentities)
        .set({
          status,
          enrollmentAddress,
          accountCommitment: commitment,
          statusChangedAt: now,
          ...(revoked ? { revokedReason: "enrollment revoked on-chain by the organization" } : {}),
        })
        .where(eq(signerIdentities.id, current.id));
    }
  }
  // Every other active key of this enrollment is no longer the account's signer.
  const others = await db
    .select({ id: signerIdentities.id })
    .from(signerIdentities)
    .where(
      and(
        eq(signerIdentities.organizationId, org.id),
        eq(signerIdentities.accountCommitment, commitment),
        ne(signerIdentities.publicKey, signer),
        eq(signerIdentities.status, "active"),
      ),
    );
  for (const o of others) {
    changed = true;
    const endorsed = e.kind === PASSKEY_KIND_ROTATED;
    await db
      .update(signerIdentities)
      .set({
        status: endorsed ? "rotated" : "revoked",
        statusChangedAt: now,
        ...(endorsed ? {} : { revokedReason: "replaced on-chain by organization recovery" }),
      })
      .where(eq(signerIdentities.id, o.id));
  }
  return { signer, status: revoked ? "revoked" : "active", kind: e.kind, changed };
}

export interface RecordedProof {
  proofId: string;
  organizationId: string;
  proofType: string;
  statementHash: string;
  signer: string;
  slot: number;
  blockTime: Date | null;
  shardAddress: string;
  fee: FeeFacts;
}

/**
 * Indexes every proof in a transaction (same rules as acceptances: the transaction succeeded, the
 * signature is re-verified, the anchor message strictly parsed and matched to the instruction).
 */
export async function indexProofTransaction(
  db: Database,
  chain: ChainService,
  signature: string,
  extras: {
    proofRequestId?: string | null;
    externalUserRef?: string | null;
    reference?: string | null;
    signerType?: "wallet" | "passkey";
  } = {},
): Promise<RecordedProof[]> {
  const fetched = await fetchRecordingTransaction(chain, signature);
  if (!fetched) return [];
  const { tx, decoded, feeSource } = fetched;
  const out: RecordedProof[] = [];
  for (const ix of decoded.instructions) {
    if (ix.programId !== chain.programAddress || identifyInstruction(ix.data) !== "record_proof")
      continue;
    const prev = decoded.instructions[ix.index - 1];
    if (!prev || prev.programId !== ED25519_PROGRAM_ADDRESS) continue;
    const ed = parseCanonicalEd25519Data(prev.data);
    if (!verifyEd25519(ed.signature, ed.message, ed.publicKey)) continue;
    const message = parseProofMessage(fromUtf8(ed.message));
    const args = decodeRecordProofArgs(ix.data);
    const [, , orgAddr, shardAddr] = ix.accounts;
    if (message.organization !== orgAddr || toHex(args.statementHash) !== message.statementHash)
      continue;
    let [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.address, orgAddr!));
    if (!org) org = (await syncOrganization(db, chain, orgAddr!)) ?? undefined;
    if (!org) continue;
    const id = toHex(
      proofId(
        fromBase58(orgAddr!),
        ed.publicKey,
        args.statementHash,
        messageHash(ed.message),
        ed.signature,
      ),
    );
    const blockTime = tx.blockTime ? new Date(Number(tx.blockTime) * 1000) : null;
    const fee = feeFacts(feeSource, chain.programAddress, id);
    const type = proofTypeByCode(args.proofType)!.name;
    await db
      .insert(proofs)
      .values({
        proofId: id,
        organizationId: org.id,
        proofType: type,
        statementHash: message.statementHash,
        reference: extras.reference ?? null,
        signerAddress: toBase58(ed.publicKey),
        signerType: extras.signerType ?? "wallet",
        txSignature: signature,
        slot: Number(tx.slot),
        blockTime,
        issuedAt: Number(args.issuedAt),
        expiresAt: Number(args.expiresAt),
        nonceShardAddress: shardAddr!,
        nonceIndex: args.nonceIndex,
        messageHash: toHex(messageHash(ed.message)),
        requestDomain: message.requestDomain,
        proofRequestId: extras.proofRequestId ?? null,
        externalUserRef: extras.externalUserRef ?? null,
        feePayer: fee.feePayer,
        feeLamports: fee.feeLamports,
        reimbursedLamports: fee.reimbursedLamports,
      })
      .onConflictDoUpdate({
        target: proofs.proofId,
        set: {
          proofRequestId: sql`coalesce(${proofs.proofRequestId}, excluded.proof_request_id)`,
          reference: sql`coalesce(${proofs.reference}, excluded.reference)`,
          externalUserRef: sql`coalesce(${proofs.externalUserRef}, excluded.external_user_ref)`,
        },
      });
    await db
      .update(nonceShards)
      .set({ nextIndex: sql`greatest(${nonceShards.nextIndex}, ${args.nonceIndex + 1})` })
      .where(eq(nonceShards.address, shardAddr!));
    out.push({
      proofId: id,
      organizationId: org.id,
      proofType: type,
      statementHash: message.statementHash,
      signer: toBase58(ed.publicKey),
      slot: Number(tx.slot),
      blockTime,
      shardAddress: shardAddr!,
      fee,
    });
  }
  return out;
}

/**
 * Stele Gate: mirrors the access pass a gated acceptance created or advanced, from the program's own
 * `AccessPassUpdated` event in the confirmed transaction. A cache for the dashboard — protected
 * programs read the pass account on Solana.
 */
async function indexAccessPass(
  db: Database,
  events: SteleEvent[],
  i: { organizationId: string; documentId: string; acceptanceId: string; signature: string },
): Promise<void> {
  for (const e of events) {
    if (e.name !== "AccessPassUpdated") continue;
    const p = e.data;
    if (toHex(p.acceptanceId) !== i.acceptanceId) continue;
    const row = {
      organizationId: i.organizationId,
      documentId: i.documentId,
      address: p.accessPass,
      holder: p.holder,
      versionAddress: p.version,
      versionNumber: p.versionNumber,
      versionHash: toHex(p.versionHash),
      acceptanceId: i.acceptanceId,
      acceptanceCount: p.acceptanceCount,
      acceptedAt: new Date(Number(p.acceptedAt) * 1000),
      firstAcceptedAt: new Date(Number(p.acceptedAt) * 1000),
      slot: Number(p.slot),
      txSignature: i.signature,
    };
    await db
      .insert(accessPasses)
      .values(row)
      .onConflictDoUpdate({
        target: accessPasses.address,
        // Events can be replayed out of order by a rebuild: only a newer slot moves the pass.
        set: {
          versionAddress: sql`case when excluded.slot >= ${accessPasses.slot} then excluded.version_address else ${accessPasses.versionAddress} end`,
          versionNumber: sql`case when excluded.slot >= ${accessPasses.slot} then excluded.version_number else ${accessPasses.versionNumber} end`,
          versionHash: sql`case when excluded.slot >= ${accessPasses.slot} then excluded.version_hash else ${accessPasses.versionHash} end`,
          acceptanceId: sql`case when excluded.slot >= ${accessPasses.slot} then excluded.acceptance_id else ${accessPasses.acceptanceId} end`,
          acceptanceCount: sql`greatest(${accessPasses.acceptanceCount}, excluded.acceptance_count)`,
          acceptedAt: sql`greatest(${accessPasses.acceptedAt}, excluded.accepted_at)`,
          firstAcceptedAt: sql`least(${accessPasses.firstAcceptedAt}, excluded.first_accepted_at)`,
          txSignature: sql`case when excluded.slot >= ${accessPasses.slot} then excluded.tx_signature else ${accessPasses.txSignature} end`,
          slot: sql`greatest(${accessPasses.slot}, excluded.slot)`,
          updatedAt: new Date(),
        },
      });
  }
}

/**
 * Stele Gate: mirrors a policy account (and marks its document as a Gate policy, so wallet
 * acceptances are recorded with `record_gated_acceptance` and create access passes).
 */
export async function syncPolicy(
  db: Database,
  chain: ChainService,
  policyAddress: string,
): Promise<{ id: string; documentId: string; requiredVersion: number } | null> {
  const data = await fetchAccountData(chain.rpc, address(policyAddress));
  if (!data) return null;
  const policy = decodeGatePolicy(data);
  const doc = await syncDocument(db, chain, policy.document);
  if (!doc) return null;
  const values = {
    organizationId: doc.organizationId,
    documentId: doc.id,
    address: policyAddress,
    requiredVersion: policy.requiredVersion,
    requiredVersionHash: toHex(policy.requiredVersionHash),
    updatedBy: policy.updatedBy,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(gatePolicies)
    .values(values)
    .onConflictDoUpdate({ target: gatePolicies.address, set: values })
    .returning({ id: gatePolicies.id });
  await db.update(documents).set({ gated: true }).where(eq(documents.id, doc.id));
  return { id: row!.id, documentId: doc.id, requiredVersion: policy.requiredVersion };
}
