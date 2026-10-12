/**
 * MERKLE_BATCHED evidence mode (PROTOCOL_SPEC.md §17.9).
 *
 * In this mode the relayer verifies each acceptance's signature itself (exactly as for direct
 * recording: Ed25519 over the message, or the passkey's WebAuthn P-256 signature with its full
 * binding), queues it, and anchors the Merkle root of many acceptances in one transaction. The
 * program verifies no signature for a batch; every verifier re-checks each leaf off-chain.
 *
 * Evidence availability: a leaf is provable only with its evidence (message, signature, WebAuthn
 * data, inclusion proof). It goes to the organization (webhook), into the user's receipt, and into a
 * per-batch manifest published in the content store — never only into this database.
 */
import { address } from "@solana/kit";
import {
  BATCH_MANIFEST_FORMAT,
  anchorAcceptanceBatchInstruction,
  batchLeafHash,
  decodeEventsFromLogs,
  findConfigPda,
  fromBase64,
  fromHex,
  merkleProof,
  merkleRoot,
  sha256,
  toHex,
  utf8,
  type BatchManifest,
  type BatchedEvidence,
} from "@stelehq/protocol";
import { decodeWireTransaction } from "@stelehq/verifier";
import {
  acceptanceBatches,
  acceptanceChallenges,
  acceptanceSessions,
  acceptances,
  and,
  asc,
  batchLeaves,
  documentVersions,
  eq,
  lt,
  nonceShards,
  organizations,
} from "@stele/db";
import type { Deps } from "../deps.js";
import { enqueueWebhook } from "../lib/webhooks.js";
import { bookRecording, feeFacts } from "./sponsorship.js";

/** Leaves per anchored batch (the program allows 65,536; smaller batches anchor sooner). */
export const BATCH_MAX_LEAVES = 1_024;
/** Must match the verifier: a batch anchored later than this after a window closes is refused. */
const BATCH_GRACE_SECONDS = 60;

export type LeafEvidence = Omit<BatchedEvidence, "batch">;

type Challenge = typeof acceptanceChallenges.$inferSelect;

/** Queues a verified acceptance for the next batch (idempotent per acceptance ID). */
export async function queueBatchedAcceptance(
  deps: Deps,
  ch: Challenge,
  evidence: LeafEvidence,
): Promise<{ acceptanceId: string; status: "pending_batch" }> {
  const leafHash = batchLeafHash(
    evidence.protocol === "stele/2" ? 2 : 1,
    fromHex(evidence.acceptanceId, 32),
  );
  await deps.db
    .insert(batchLeaves)
    .values({
      organizationId: ch.organizationId,
      challengeId: ch.id,
      shardRowId: ch.shardRowId,
      acceptanceId: evidence.acceptanceId,
      leafHash: toHex(leafHash),
      evidence: evidence as unknown as Record<string, unknown>,
      expiresAt: ch.expiresAt,
    })
    .onConflictDoNothing();
  await deps.db
    .update(acceptanceChallenges)
    .set({ acceptanceId: evidence.acceptanceId, updatedAt: new Date() })
    .where(eq(acceptanceChallenges.id, ch.id));
  return { acceptanceId: evidence.acceptanceId, status: "pending_batch" };
}

/** The inclusion proof of an anchored leaf, recomputed from the batch's stored leaf hashes. */
export async function leafEvidence(
  deps: Deps,
  acceptanceId: string,
): Promise<{ evidence: BatchedEvidence; txSignature: string } | null> {
  const [leaf] = await deps.db
    .select()
    .from(batchLeaves)
    .where(eq(batchLeaves.acceptanceId, acceptanceId));
  if (!leaf?.batchId || leaf.leafIndex === null) return null;
  const [batch] = await deps.db
    .select()
    .from(acceptanceBatches)
    .where(eq(acceptanceBatches.id, leaf.batchId));
  if (!batch || batch.status !== "anchored" || !batch.txSignature || !batch.onchainBatchId)
    return null;
  const hashes = (
    await deps.db
      .select({ h: batchLeaves.leafHash })
      .from(batchLeaves)
      .where(eq(batchLeaves.batchId, batch.id))
      .orderBy(asc(batchLeaves.leafIndex))
  ).map((r) => fromHex(r.h, 32));
  return {
    txSignature: batch.txSignature,
    evidence: {
      ...(leaf.evidence as unknown as LeafEvidence),
      batch: {
        root: batch.root,
        batchId: batch.onchainBatchId,
        leafIndex: leaf.leafIndex,
        leafCount: batch.leafCount,
        proof: merkleProof(hashes, leaf.leafIndex).map(toHex),
      },
    },
  };
}

/**
 * Anchors every shard's pending leaves (oldest first, up to {@link BATCH_MAX_LEAVES} per batch).
 * Returns the number of batches anchored. Failed anchors leave their leaves pending for the next
 * round; leaves whose signed window closed are expired (never anchored late).
 */
export async function anchorPendingBatches(deps: Deps): Promise<number> {
  const now = await deps.chain.clusterTime();
  const expired = await deps.db
    .update(batchLeaves)
    .set({ status: "expired" })
    .where(
      and(
        eq(batchLeaves.status, "pending"),
        lt(batchLeaves.expiresAt, now - BATCH_GRACE_SECONDS + 5),
      ),
    )
    .returning({ challengeId: batchLeaves.challengeId });
  for (const e of expired)
    if (e.challengeId)
      await deps.db
        .update(acceptanceChallenges)
        .set({
          status: "failed",
          failureReason: "the batch could not be anchored within the signed window",
          updatedAt: new Date(),
        })
        .where(eq(acceptanceChallenges.id, e.challengeId));

  const shards = await deps.db
    .selectDistinct({ shardRowId: batchLeaves.shardRowId })
    .from(batchLeaves)
    .where(eq(batchLeaves.status, "pending"));
  let anchored = 0;
  for (const { shardRowId } of shards) {
    try {
      if (await anchorShard(deps, shardRowId)) anchored++;
    } catch (e) {
      deps.logger.error({ err: e, shardRowId }, "batch anchoring failed");
    }
  }
  return anchored;
}

async function anchorShard(deps: Deps, shardRowId: string): Promise<boolean> {
  const leaves = await deps.db
    .select()
    .from(batchLeaves)
    .where(and(eq(batchLeaves.status, "pending"), eq(batchLeaves.shardRowId, shardRowId)))
    .orderBy(asc(batchLeaves.createdAt), asc(batchLeaves.acceptanceId))
    .limit(BATCH_MAX_LEAVES);
  if (leaves.length === 0) return false;
  const [shard] = await deps.db.select().from(nonceShards).where(eq(nonceShards.id, shardRowId));
  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, shard!.organizationId));
  const hashes = leaves.map((l) => fromHex(l.leafHash, 32));
  const root = merkleRoot(hashes);
  const [batch] = await deps.db
    .insert(acceptanceBatches)
    .values({
      organizationId: org!.id,
      shardRowId,
      root: toHex(root),
      leafCount: leaves.length,
    })
    .returning();
  const [config] = await findConfigPda(deps.chain.programAddress);
  let txSignature: string;
  try {
    txSignature = await deps.chain.sendBatchAnchor(
      anchorAcceptanceBatchInstruction({
        programAddress: deps.chain.programAddress,
        relayer: deps.chain.relayer,
        config,
        organization: address(org!.address),
        nonceShard: address(shard!.address),
        batchRoot: root,
        leafCount: leaves.length,
      }),
    );
  } catch (e) {
    await deps.db
      .update(acceptanceBatches)
      .set({ status: "failed", failureReason: String((e as Error).message).slice(0, 300) })
      .where(eq(acceptanceBatches.id, batch!.id));
    throw e;
  }

  // Read the anchor back from the confirmed transaction (the chain decides what was anchored).
  const tx = await deps.chain.rpc
    .getTransaction(txSignature as never, {
      encoding: "base64",
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    })
    .send();
  const logs = tx?.meta?.logMessages ?? [];
  const event = decodeEventsFromLogs(logs, deps.chain.programAddress)
    .flatMap((e) => (e.name === "AcceptanceBatchAnchored" ? [e.data] : []))
    .find((e) => toHex(e.batchRoot) === toHex(root) && e.leafCount === leaves.length);
  if (!tx || tx.meta?.err || !event) {
    await deps.db
      .update(acceptanceBatches)
      .set({ status: "failed", txSignature, failureReason: "anchor not found in the transaction" })
      .where(eq(acceptanceBatches.id, batch!.id));
    return false;
  }
  const batchIdHex = toHex(event.batchId);
  const blockTime = tx.blockTime ? new Date(Number(tx.blockTime) * 1000) : null;

  // Publish the manifest: every leaf's evidence and inclusion proof.
  const evidence: BatchedEvidence[] = leaves.map((l, i) => ({
    ...(l.evidence as unknown as LeafEvidence),
    batch: {
      root: toHex(root),
      batchId: batchIdHex,
      leafIndex: i,
      leafCount: leaves.length,
      proof: merkleProof(hashes, i).map(toHex),
    },
  }));
  const manifest: BatchManifest = {
    format: BATCH_MANIFEST_FORMAT,
    organization: org!.address,
    nonceShard: shard!.address,
    root: toHex(root),
    leafCount: leaves.length,
    leaves: evidence,
  };
  const stored = await deps.storage.put(utf8(JSON.stringify(manifest))).catch((e: unknown) => {
    deps.logger.error({ err: e, batch: batch!.id }, "batch manifest not stored");
    return null;
  });
  await deps.db
    .update(acceptanceBatches)
    .set({
      status: "anchored",
      txSignature,
      slot: Number(tx.slot),
      onchainBatchId: batchIdHex,
      manifestHash: stored?.contentHash ?? null,
      anchoredAt: new Date(),
    })
    .where(eq(acceptanceBatches.id, batch!.id));

  const decoded = decodeWireTransaction(fromBase64(tx.transaction[0]), [], []);
  const fee = feeFacts(
    { accountKeys: decoded.accountKeys, fee: Number(tx.meta?.fee ?? 0), logs },
    deps.chain.programAddress,
    batchIdHex,
  );
  for (const [i, l] of leaves.entries()) {
    await deps.db
      .update(batchLeaves)
      .set({ status: "anchored", batchId: batch!.id, leafIndex: i })
      .where(eq(batchLeaves.id, l.id));
    const ev = l.evidence as unknown as LeafEvidence;
    const [ch] = l.challengeId
      ? await deps.db
          .select()
          .from(acceptanceChallenges)
          .where(eq(acceptanceChallenges.id, l.challengeId))
      : [];
    if (!ch) continue;
    const [version] = await deps.db
      .select({ number: documentVersions.number })
      .from(documentVersions)
      .where(eq(documentVersions.address, ev.versionAddress));
    await deps.db
      .insert(acceptances)
      .values({
        acceptanceId: ev.acceptanceId,
        organizationId: org!.id,
        documentId: ch.documentId,
        versionAddress: ev.versionAddress,
        versionNumber: version?.number ?? 0,
        signerAddress: ch.signerAddress,
        txSignature,
        slot: Number(tx.slot),
        blockTime,
        issuedAt: ch.issuedAt,
        expiresAt: ch.expiresAt,
        nonceShardAddress: shard!.address,
        nonceIndex: ch.nonceIndex,
        messageHash: toHex(sha256(utf8(ev.message))),
        requestDomain: ch.requestDomain,
        challengeId: ch.id,
        externalUserRef: ch.externalUserRef,
        signerType: ch.signerType,
        signedMessage: ev.message,
        signerEvidence: evidence[i] as unknown as Record<string, unknown>,
        enrollmentAddress:
          ev.signer.type === "NATIVE_PASSKEY" ? (ev.signer.enrollment?.address ?? null) : null,
        evidenceMode: "MERKLE_BATCHED",
        batchId: batch!.id,
        leafIndex: i,
        feePayer: fee.feePayer,
      })
      .onConflictDoNothing();
    await deps.db
      .update(acceptanceChallenges)
      .set({ status: "confirmed", txSignature, updatedAt: new Date() })
      .where(eq(acceptanceChallenges.id, ch.id));
    if (ch.acceptanceSessionId)
      await deps.db
        .update(acceptanceSessions)
        .set({ consumedAt: new Date() })
        .where(eq(acceptanceSessions.id, ch.acceptanceSessionId));
    await enqueueWebhook(deps.db, org!.id, "agreement.accepted", {
      acceptanceId: ev.acceptanceId,
      transactionSignature: txSignature,
      slot: Number(tx.slot),
      commitment: "confirmed",
      signer: ch.signerAddress,
      version: ev.versionAddress,
      versionNumber: version?.number ?? null,
      externalUserRef: ch.externalUserRef,
      signerType: ch.signerType,
      evidenceMode: "MERKLE_BATCHED",
      // The leaf's full evidence: keep it — it is what proves this acceptance.
      evidence: evidence[i],
      receiptUrl: `${deps.config.APP_ORIGIN}/receipt/${ev.acceptanceId}`,
      verify:
        "Verify independently with the evidence above and the transaction. Do not treat this webhook as proof.",
    });
  }
  await bookRecording(deps, {
    organizationId: org!.id,
    txSignature,
    recordKind: "acceptance_batch",
    recordId: batchIdHex,
    shardAddress: shard!.address,
    fee,
    recordIds: leaves.map((l) => l.acceptanceId),
  });
  deps.logger.info(
    { batch: batch!.id, leaves: leaves.length, txSignature },
    "acceptance batch anchored",
  );
  return true;
}
