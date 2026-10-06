/**
 * Fee sponsorship (PROTOCOL_SPEC.md §13). The user never pays: every recording is relayed and paid
 * by the Stele relayer, and either
 *
 *   - Stele absorbs the fee (Stele-sponsored), or
 *   - the organization's sponsored nonce shard reimburses the relayer on-chain, in the same
 *     transaction, under limits the organization set on-chain (organization-sponsored).
 *
 * Who paid is read back from the confirmed transaction (fee, fee payer, `SponsorReimbursed`
 * event), never assumed. Nothing here can change what a user signed. Whether the organization may
 * record at all (free allowance, then credits) is billing's concern (services/billing.ts).
 */
import { address } from "@solana/kit";
import {
  decodeEventsFromLogs,
  decodeShardSponsorship,
  fetchAccountData,
  fromBase64,
  NONCE_SHARD_ACCOUNT_SIZE,
  recordingFee,
  toHex,
  ACCEPTANCE_COMPUTE_UNIT_LIMIT,
} from "@stele/protocol";
import {
  and,
  desc,
  eq,
  nonceShards,
  organizations,
  sponsoredTransactions,
  type ShardSponsorshipMirror,
} from "@stele/db";
import type { Deps } from "../deps.js";
import { ApiError } from "../errors.js";
import { enqueueWebhook } from "../lib/webhooks.js";
import { assertCanRecord, chargeRecordings, creditBalance, recordsThisMonth } from "./billing.js";

type Organization = typeof organizations.$inferSelect;

const utcDay = (unix: number) => Math.floor(unix / 86_400);

/** Reads a shard's sponsorship trailer and balance from the chain and mirrors it. */
export async function refreshShardSponsorship(
  deps: Deps,
  shardAddress: string,
): Promise<ShardSponsorshipMirror | null> {
  const { value } = await deps.chain.rpc
    .getAccountInfo(address(shardAddress), { encoding: "base64", commitment: "confirmed" })
    .send();
  if (!value) return null;
  const data = fromBase64(value.data[0]);
  const trailer = decodeShardSponsorship(data);
  let mirror: ShardSponsorshipMirror | null = null;
  if (trailer) {
    const rent = await deps.chain.rpc.getMinimumBalanceForRentExemption(BigInt(data.length)).send();
    mirror = {
      paused: trailer.paused,
      maxFeePerRecord: Number(trailer.maxFeePerRecord),
      dailyLimit: Number(trailer.dailyLimit),
      spentToday: Number(trailer.spentToday),
      currentDay: Number(trailer.currentDay),
      totalReimbursed: Number(trailer.totalReimbursed),
      reimbursedCount: Number(trailer.reimbursedCount),
      totalWithdrawn: Number(trailer.totalWithdrawn),
      balanceLamports: Number(value.lamports),
      rentExemptLamports: Number(rent),
    };
  }
  await deps.db
    .update(nonceShards)
    .set({ sponsorship: mirror, sponsorshipSyncedAt: new Date() })
    .where(eq(nonceShards.address, shardAddress));
  return mirror;
}

/** Whether a sponsored shard can pay one more recording now (same rules as the program). */
export function canSponsor(m: ShardSponsorshipMirror | null, nowUnix: number): boolean {
  if (!m || m.paused) return false;
  const spent = m.currentDay === utcDay(nowUnix) ? m.spentToday : 0;
  const spendable = m.balanceLamports - m.rentExemptLamports;
  return spendable >= m.maxFeePerRecord && spent + m.maxFeePerRecord <= m.dailyLimit;
}

export function estimatedFeePerRecord(deps: Deps): number {
  return Number(
    recordingFee({
      computeUnitLimit: ACCEPTANCE_COMPUTE_UNIT_LIMIT,
      priorityFeeMicroLamports: deps.config.PRIORITY_FEE_MICROLAMPORTS,
    }),
  );
}

export interface SponsorshipPlan {
  sponsor: "stele" | "organization";
  /** Shards to allocate from first (sponsored shards able to pay). */
  preferredShards: string[];
}

/**
 * Decides, before a user is asked to sign, whether the organization may record (free allowance,
 * then credits) and who will pay the fee — and refuses early when not (so a user never signs
 * something that cannot be recorded).
 */
export async function planSponsorship(deps: Deps, org: Organization): Promise<SponsorshipPlan> {
  await assertCanRecord(deps, org.id);
  const mode = org.settings.feeSponsor ?? "stele";
  if (mode === "organization") {
    const shards = await deps.db
      .select()
      .from(nonceShards)
      .where(
        and(
          eq(nonceShards.organizationId, org.id),
          eq(nonceShards.status, "active"),
          eq(nonceShards.relayerAddress, deps.chain.relayer.address),
        ),
      );
    const now = await deps.chain.clusterTime();
    const ready: string[] = [];
    for (const s of shards) {
      const m = await refreshShardSponsorship(deps, s.address);
      if (canSponsor(m, now)) ready.push(s.address);
    }
    if (ready.length > 0) return { sponsor: "organization", preferredShards: ready };
    if (org.settings.sponsorFallbackToStele) return { sponsor: "stele", preferredShards: [] };
    throw new ApiError(
      402,
      "sponsorship_unavailable",
      "The organization's fee sponsorship cannot pay right now (paused, daily limit reached or balance too low). Nothing was signed.",
    );
  }
  return { sponsor: "stele", preferredShards: [] };
}

export interface FeeFacts {
  feePayer: string;
  feeLamports: number;
  reimbursedLamports: number | null;
}

/** Fee facts of a confirmed recording, read from the transaction itself. */
export function feeFacts(
  tx: { accountKeys: readonly string[]; fee: number; logs: readonly string[] },
  programAddress: string,
  recordId: string,
): FeeFacts {
  const reimbursed = decodeEventsFromLogs(tx.logs, programAddress).find(
    (e) => e.name === "SponsorReimbursed" && toHex(e.data.recordId) === recordId,
  );
  return {
    feePayer: tx.accountKeys[0]!,
    feeLamports: tx.fee,
    reimbursedLamports:
      reimbursed && reimbursed.name === "SponsorReimbursed" ? Number(reimbursed.data.amount) : null,
  };
}

/**
 * Books a recording's fee, charges a credit when it is beyond the free monthly allowance, and raises
 * a low-balance alert for a sponsored shard when needed.
 */
export async function bookRecording(
  deps: Deps,
  input: {
    organizationId: string;
    txSignature: string;
    recordKind:
      "acceptance" | "proof" | "passkey_enrollment" | "passkey_rotation" | "acceptance_batch";
    recordId: string;
    shardAddress: string;
    fee: FeeFacts;
    /** Batch anchors: the acceptances carried (each is counted and charged). */
    recordIds?: string[];
  },
): Promise<void> {
  const booked = await deps.db
    .insert(sponsoredTransactions)
    .values({
      txSignature: input.txSignature,
      organizationId: input.organizationId,
      recordKind: input.recordKind,
      recordId: input.recordId,
      feePayer: input.fee.feePayer,
      feeLamports: input.fee.feeLamports,
      sponsor: input.fee.reimbursedLamports !== null ? "organization" : "stele",
      reimbursedLamports: input.fee.reimbursedLamports ?? 0,
      nonceShardAddress: input.shardAddress,
      recordCount: input.recordIds?.length ?? 1,
    })
    .onConflictDoNothing()
    .returning({ txSignature: sponsoredTransactions.txSignature });
  // Only a newly booked recording is charged (re-submissions are idempotent).
  if (booked.length > 0)
    await chargeRecordings(deps, input.organizationId, input.recordIds ?? [input.recordId]);
  if (input.fee.reimbursedLamports === null) return;
  const m = await refreshShardSponsorship(deps, input.shardAddress).catch(() => null);
  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, input.organizationId));
  const threshold = org?.settings.sponsorLowBalanceLamports;
  if (m && threshold !== undefined && m.balanceLamports - m.rentExemptLamports < threshold) {
    await enqueueWebhook(deps.db, input.organizationId, "sponsorship.low_balance", {
      nonceShard: input.shardAddress,
      depositAddress: input.shardAddress,
      spendableLamports: m.balanceLamports - m.rentExemptLamports,
      thresholdLamports: threshold,
      estimatedRecordsLeft: Math.floor(
        (m.balanceLamports - m.rentExemptLamports) / Math.max(1, m.maxFeePerRecord),
      ),
    });
  }
}

/** Dashboard view: sponsorship state, estimates and history. */
export async function sponsorshipOverview(deps: Deps, org: Organization) {
  const shards = await deps.db
    .select()
    .from(nonceShards)
    .where(eq(nonceShards.organizationId, org.id));
  const now = await deps.chain.clusterTime();
  const feePerRecord = estimatedFeePerRecord(deps);
  const shardViews = [];
  for (const s of shards) {
    const m = await refreshShardSponsorship(deps, s.address).catch(() => s.sponsorship ?? null);
    const data = m
      ? null
      : await fetchAccountData(deps.chain.rpc, address(s.address)).catch(() => null);
    const spendable = m ? Math.max(0, m.balanceLamports - m.rentExemptLamports) : 0;
    shardViews.push({
      address: s.address,
      shardId: s.shardId,
      relayer: s.relayerAddress,
      relayedByStele: s.relayerAddress === deps.chain.relayer.address,
      enabled: m !== null,
      sponsorship: m,
      spendableLamports: spendable,
      estimatedRecords: m
        ? Math.floor(spendable / Math.max(1, Math.min(m.maxFeePerRecord, feePerRecord)))
        : 0,
      canPayNow: canSponsor(m, now),
      lowBalance:
        m !== null &&
        org.settings.sponsorLowBalanceLamports !== undefined &&
        spendable < org.settings.sponsorLowBalanceLamports,
      accountSize: m ? null : (data?.length ?? NONCE_SHARD_ACCOUNT_SIZE),
    });
  }
  const history = await deps.db
    .select()
    .from(sponsoredTransactions)
    .where(eq(sponsoredTransactions.organizationId, org.id))
    .orderBy(desc(sponsoredTransactions.createdAt))
    .limit(50);
  return {
    mode: org.settings.feeSponsor ?? "stele",
    fallbackToStele: org.settings.sponsorFallbackToStele ?? false,
    lowBalanceLamports: org.settings.sponsorLowBalanceLamports ?? null,
    estimatedFeePerRecordLamports: feePerRecord,
    plan: {
      freeRecordsPerMonth: deps.config.STELE_FREE_RECORDS_PER_MONTH,
      usedThisMonth: await recordsThisMonth(deps, org.id),
      credits: await creditBalance(deps, org.id),
    },
    relayer: deps.chain.relayer.address as string,
    shards: shardViews,
    history: history.map((h) => ({
      transactionSignature: h.txSignature,
      recordKind: h.recordKind,
      recordId: h.recordId,
      feePayer: h.feePayer,
      feeLamports: h.feeLamports,
      sponsor: h.sponsor,
      reimbursedLamports: h.reimbursedLamports,
      nonceShard: h.nonceShardAddress,
      createdAt: h.createdAt,
    })),
  };
}
