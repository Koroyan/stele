/**
 * Chain indexer. Tails every transaction of the Stele program and mirrors the resulting state into
 * PostgreSQL by READING THE CHAIN (accounts and transactions), so the database can always be rebuilt
 * from scratch after loss or tampering:
 *
 *   pnpm --filter @stele/api start:indexer            # follow
 *   STELE_INDEXER_REBUILD=1 pnpm … start:indexer      # replay from the program's first transaction
 */
import {
  acceptances,
  and,
  documentVersions,
  eq,
  indexerState,
  isNull,
  organizations,
} from "@stele/db";
import { fromBase64, identifyInstruction, type InstructionName } from "@stele/protocol";
import { decodeWireTransaction } from "@stele/verifier";
import type { Deps } from "./deps.js";
import {
  indexAcceptanceTransaction,
  syncDocument,
  syncOrganization,
  syncPasskeySigner,
  syncShard,
  syncPolicy,
} from "./lib/sync.js";
import { enqueueWebhook } from "./lib/webhooks.js";

const STATE_ID = "program";

/** Account index (within the instruction) of the organization / document / shard each instruction touches. */
const ORG_ACCOUNT: Partial<Record<InstructionName, number>> = {
  create_organization: 2,
  update_organization: 1,
  propose_owner: 1,
  accept_ownership: 1,
  cancel_owner_transfer: 1,
  propose_recovery: 1,
  apply_recovery_change: 1,
  cancel_recovery_change: 1,
  freeze_organization: 1,
  unfreeze_organization: 1,
  initiate_owner_recovery: 1,
  cancel_owner_recovery: 1,
  execute_owner_recovery: 1,
  add_member: 2,
  update_member: 2,
  revoke_member: 2,
  report_key_compromise: 2,
  attest_domain: 2,
  renew_domain: 2,
  revoke_domain: 2,
};

/** Account index of the PasskeySigner enrollment each native-passkey instruction changes. */
const ENROLLMENT_ACCOUNT: Partial<Record<InstructionName, number>> = {
  enroll_passkey_signer: 4,
  rotate_passkey_signer: 3,
  recover_passkey_signer: 3,
  revoke_passkey_signer: 3,
};

async function processTransaction(deps: Deps, signature: string): Promise<void> {
  const tx = await deps.chain.rpc
    .getTransaction(signature as never, {
      encoding: "base64",
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    })
    .send();
  if (!tx || tx.meta?.err) return;
  const decoded = decodeWireTransaction(
    fromBase64(tx.transaction[0]),
    [...(tx.meta?.loadedAddresses?.writable ?? [])],
    [...(tx.meta?.loadedAddresses?.readonly ?? [])],
  );
  let sawAcceptance = false;
  for (const ix of decoded.instructions) {
    if (ix.programId !== deps.chain.programAddress) continue;
    const name = identifyInstruction(ix.data);
    if (!name) continue;
    const orgIndex = ORG_ACCOUNT[name];
    if (orgIndex !== undefined) await syncOrganization(deps.db, deps.chain, ix.accounts[orgIndex]!);
    else if (name === "create_document" || name === "publish_version") {
      await syncDocument(deps.db, deps.chain, ix.accounts[4]!);
      // Remember which transaction published the version (also for publications made outside Stele).
      if (name === "publish_version") {
        await deps.db
          .update(documentVersions)
          .set({ publishTx: signature })
          .where(
            and(eq(documentVersions.address, ix.accounts[5]!), isNull(documentVersions.publishTx)),
          );
      }
    } else if (name === "create_nonce_shard") await syncShard(deps.db, deps.chain, ix.accounts[4]!);
    else if (name === "set_shard_relayer") await syncShard(deps.db, deps.chain, ix.accounts[3]!);
    else if (
      name === "record_acceptance" ||
      name === "record_gated_acceptance" ||
      name === "record_passkey_acceptance"
    )
      sawAcceptance = true;
    else if (name === "create_policy" || name === "set_policy_requirement")
      await syncPolicy(deps.db, deps.chain, ix.accounts[6]!);
    else if (ENROLLMENT_ACCOUNT[name] !== undefined) {
      const changed = await syncPasskeySigner(
        deps.db,
        deps.chain,
        ix.accounts[ENROLLMENT_ACCOUNT[name]!]!,
      );
      if (changed?.changed) {
        const [org] = await deps.db
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.address, ix.accounts[2]!));
        if (org)
          await enqueueWebhook(deps.db, org.id, "signer.changed", {
            signer: changed.signer,
            change: name.replace("_passkey_signer", ""),
            enrollment: ix.accounts[ENROLLMENT_ACCOUNT[name]!],
            status: changed.status,
            transactionSignature: signature,
          });
      }
    }
  }
  if (sawAcceptance) {
    const existing = await deps.db
      .select({ id: acceptances.acceptanceId })
      .from(acceptances)
      .where(eq(acceptances.txSignature, signature));
    const recorded = await indexAcceptanceTransaction(deps.db, deps.chain, signature);
    if (existing.length === 0) {
      // Acceptances not relayed by this API (e.g. open shards) still notify integrators.
      for (const r of recorded) {
        await enqueueWebhook(deps.db, r.organizationId, "agreement.accepted", {
          acceptanceId: r.acceptanceId,
          transactionSignature: signature,
          slot: r.slot,
          commitment: "confirmed",
          signer: r.signer,
          version: r.versionAddress,
          versionNumber: r.versionNumber,
          receiptUrl: `${deps.config.APP_ORIGIN}/receipt/${r.acceptanceId}`,
        });
      }
    }
  }
}

/** Processes all program transactions newer than the cursor (oldest first). Returns the count. */
export async function indexOnce(deps: Deps, opts: { rebuild?: boolean } = {}): Promise<number> {
  const [state] = await deps.db.select().from(indexerState).where(eq(indexerState.id, STATE_ID));
  const until = opts.rebuild ? undefined : (state?.lastSignature ?? undefined);
  const pending: { signature: string; slot: number; failed: boolean }[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await deps.chain.rpc
      .getSignaturesForAddress(deps.chain.programAddress, {
        limit: 1000,
        commitment: "confirmed",
        ...(before ? { before: before as never } : {}),
        ...(until ? { until: until as never } : {}),
      })
      .send();
    for (const s of page)
      pending.push({ signature: s.signature, slot: Number(s.slot), failed: s.err !== null });
    if (page.length < 1000) break;
    before = page[page.length - 1]!.signature;
  }
  pending.reverse();
  for (const p of pending) {
    if (!p.failed) {
      try {
        await processTransaction(deps, p.signature);
      } catch (e) {
        // Leave the cursor before this transaction so it is retried next round.
        deps.logger.error(
          { err: e, signature: p.signature },
          "indexer failed to process transaction",
        );
        return pending.indexOf(p);
      }
    }
    await deps.db
      .insert(indexerState)
      .values({ id: STATE_ID, lastSignature: p.signature, lastSlot: p.slot, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: indexerState.id,
        set: { lastSignature: p.signature, lastSlot: p.slot, updatedAt: new Date() },
      });
  }
  return pending.length;
}

/** Runs the indexer inside this process until stopped (single-node deployments, local development). */
export function startIndexer(deps: Deps, everyMs = 2_000): () => Promise<void> {
  let stopped = false;
  let running: Promise<unknown> = Promise.resolve();
  let timer: NodeJS.Timeout;
  const tick = async () => {
    if (stopped) return;
    running = indexOnce(deps)
      .then((n) => {
        if (n > 0) deps.logger.info({ transactions: n }, "indexed");
      })
      .catch((e: unknown) => deps.logger.error({ err: e }, "indexer round failed"));
    await running;
    if (!stopped) timer = setTimeout(tick, everyMs);
  };
  timer = setTimeout(tick, 500);
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}
