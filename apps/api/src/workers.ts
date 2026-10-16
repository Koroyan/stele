/**
 * Background workers: webhook delivery, finality tracking, challenge expiry and domain-attestation
 * renewal. Each loop is independent, idempotent and safe to run in several processes.
 */
import { address } from "@solana/kit";
import {
  acceptanceChallenges,
  acceptances,
  and,
  documentVersions,
  eq,
  idempotencyKeys,
  inArray,
  isNotNull,
  lt,
  organizations,
} from "@stele/db";
import {
  fetchManyAccountData,
  findConfigPda,
  findDomainRecordPda,
  renewDomainInstruction,
} from "@stelehq/protocol";
import type { Deps } from "./deps.js";
import { appendAudit } from "./lib/audit.js";
import { checkDomainControl } from "./lib/dns.js";
import { syncOrganization } from "./lib/sync.js";
import { dispatchDueWebhooks, enqueueWebhook } from "./lib/webhooks.js";
import { anchorPendingBatches } from "./services/batches.js";
import { monitorVerifiedPrograms } from "./services/verification.js";

type Stop = () => Promise<void>;

function loop(name: string, everyMs: number, deps: Deps, fn: () => Promise<void>): Stop {
  let stopped = false;
  let running: Promise<void> = Promise.resolve();
  const tick = async () => {
    if (stopped) return;
    running = fn().catch((e) =>
      deps.logger.error({ err: e, worker: name }, "worker iteration failed"),
    );
    await running;
    if (!stopped) timer = setTimeout(tick, everyMs);
  };
  let timer: NodeJS.Timeout = setTimeout(tick, Math.min(everyMs, 2_000));
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}

/** Marks published versions finalized once their account exists at `finalized` commitment. */
export async function trackVersionFinality(deps: Deps): Promise<number> {
  const pending = await deps.db
    .select({ address: documentVersions.address })
    .from(documentVersions)
    .where(eq(documentVersions.finalized, false))
    .limit(100);
  if (pending.length === 0) return 0;
  const datas = await fetchManyAccountData(
    deps.chain.rpc,
    pending.map((p) => address(p.address)),
    "finalized",
  );
  let finalized = 0;
  for (let i = 0; i < pending.length; i++) {
    if (!datas[i]) continue;
    await deps.db
      .update(documentVersions)
      .set({ finalized: true })
      .where(eq(documentVersions.address, pending[i]!.address));
    finalized++;
  }
  return finalized;
}

/** Promotes confirmed acceptances to finalized once the cluster finalizes them. */
export async function trackFinality(deps: Deps): Promise<number> {
  const pending = await deps.db
    .select({
      acceptanceId: acceptances.acceptanceId,
      txSignature: acceptances.txSignature,
      organizationId: acceptances.organizationId,
      slot: acceptances.slot,
    })
    .from(acceptances)
    .where(eq(acceptances.commitment, "confirmed"))
    .limit(256);
  if (pending.length === 0) return 0;
  const { value } = await deps.chain.rpc
    .getSignatureStatuses(
      pending.map((p) => p.txSignature as never),
      { searchTransactionHistory: true },
    )
    .send();
  let finalized = 0;
  for (let i = 0; i < pending.length; i++) {
    const s = value[i];
    if (s?.confirmationStatus !== "finalized" || s.err) continue;
    const p = pending[i]!;
    await deps.db
      .update(acceptances)
      .set({ commitment: "finalized" })
      .where(eq(acceptances.acceptanceId, p.acceptanceId));
    await deps.db
      .update(acceptanceChallenges)
      .set({ status: "finalized", updatedAt: new Date() })
      .where(eq(acceptanceChallenges.acceptanceId, p.acceptanceId));
    await enqueueWebhook(deps.db, p.organizationId, "agreement.finalized", {
      acceptanceId: p.acceptanceId,
      transactionSignature: p.txSignature,
      slot: p.slot,
      commitment: "finalized",
    });
    finalized++;
  }
  return finalized;
}

export async function expireChallenges(deps: Deps): Promise<void> {
  const now = await deps.chain.clusterTime();
  await deps.db
    .update(acceptanceChallenges)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        inArray(acceptanceChallenges.status, ["issued"]),
        lt(acceptanceChallenges.expiresAt, now),
      ),
    );
  // Stored idempotent responses are encrypted, but there is no reason to keep them past expiry.
  await deps.db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date()));
}

/** Re-checks DNS for attestations expiring within 30 days and renews them on-chain. */
export async function renewDomains(deps: Deps): Promise<void> {
  const horizon = new Date(Date.now() + 30 * 86_400_000);
  const orgs = await deps.db
    .select()
    .from(organizations)
    .where(
      and(isNotNull(organizations.verifiedDomain), lt(organizations.domainExpiresAt, horizon)),
    );
  for (const org of orgs) {
    if (!org.verifiedDomain) continue;
    const check = await checkDomainControl(
      org.verifiedDomain,
      org.address,
      deps.config.DOH_RESOLVERS,
    );
    if (!check.verified) {
      deps.logger.warn(
        { organization: org.address, domain: org.verifiedDomain },
        "domain renewal skipped: DNS record missing",
      );
      continue;
    }
    const now = await deps.chain.clusterTime();
    const [config] = await findConfigPda(deps.chain.programAddress);
    const [domainRecord] = await findDomainRecordPda(org.verifiedDomain, deps.chain.programAddress);
    const tx = await deps.chain.send(deps.chain.attestor, [
      renewDomainInstruction({
        programAddress: deps.chain.programAddress,
        attestor: deps.chain.attestor,
        config,
        organization: address(org.address),
        domainRecord,
        expiresAt: now + 365 * 86_400,
      }),
    ]);
    await syncOrganization(deps.db, deps.chain, org.address);
    await appendAudit(deps.db, {
      organizationId: org.id,
      actorType: "system",
      actorId: "domain-renewal",
      action: "domain.renewed",
      targetType: "domain",
      targetId: org.verifiedDomain,
      txSignature: tx,
    });
  }
}

export function startWorkers(deps: Deps): Stop {
  const urlPolicy = { allowInsecureLoopback: !deps.config.isProduction };
  const stops = [
    loop("webhooks", 2_000, deps, async () => {
      await dispatchDueWebhooks(deps.db, { encryptionKey: deps.encryptionKey, urlPolicy });
    }),
    loop("finality", 15_000, deps, async () => {
      await trackFinality(deps);
      await trackVersionFinality(deps);
    }),
    loop("challenge-expiry", 60_000, deps, () => expireChallenges(deps)),
    // MERKLE_BATCHED organizations: anchor queued acceptances well inside their signed windows.
    loop("batches", 10_000, deps, async () => {
      await anchorPendingBatches(deps);
    }),
    loop("domain-renewal", 6 * 3_600_000, deps, () => renewDomains(deps)),
    // Stele Verified: re-check a program after every upgrade (cheap header read each minute).
    loop("program-verification", 60_000, deps, async () => {
      await monitorVerifiedPrograms(deps);
    }),
  ];
  return async () => {
    await Promise.all(stops.map((s) => s()));
  };
}
