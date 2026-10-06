/**
 * Billing: every organization may record a free number of acceptances and proofs per calendar month,
 * then uses prepaid credits (one per recording) bought in SOL.
 *
 * Payments go from the buyer's wallet straight to the treasury address on-chain; the API knows only
 * that address, never a key. A purchase is credited only after the API itself finds a successful,
 * confirmed transaction whose System Program transfer pays at least the invoice's amount to the
 * treasury and carries the invoice's unique reference (Solana Pay style) — never because a browser
 * says it paid. Each invoice and each transaction can be credited once.
 */
import { randomBytes } from "node:crypto";
import { address } from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS, fromBase64, toBase58 } from "@stele/protocol";
import { decodeWireTransaction, type DecodedTransaction } from "@stele/verifier";
import {
  and,
  billingInvoices,
  creditLedger,
  desc,
  eq,
  gte,
  sponsoredTransactions,
  sql,
} from "@stele/db";
import type { Deps } from "../deps.js";
import { ApiError, badRequest, conflict, notFound } from "../errors.js";
import { appendAudit } from "../lib/audit.js";

/** How long an invoice is offered for payment (a late payment that matches is still credited). */
export const INVOICE_TTL_MS = 30 * 60_000;

type Invoice = typeof billingInvoices.$inferSelect;

/** What is on sale on this Stele app (public: the pricing page shows it). */
export function billingInfo(deps: Deps) {
  const { treasury, packs } = deps.config.billing;
  return {
    enabled: treasury !== null && packs.length > 0,
    treasury,
    network: { cluster: deps.config.network.cluster, label: deps.config.network.label },
    freeRecordsPerMonth: deps.config.STELE_FREE_RECORDS_PER_MONTH,
    packs: packs.map((p) => ({ ...p })),
  };
}

function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Recordings (acceptances and proofs, whoever paid the network fee) this calendar month (UTC). A
 * batch anchor counts every acceptance it carries.
 */
export async function recordsThisMonth(deps: Deps, organizationId: string): Promise<number> {
  const [{ n } = { n: 0 }] = await deps.db
    .select({ n: sql<number>`coalesce(sum(${sponsoredTransactions.recordCount}), 0)::int` })
    .from(sponsoredTransactions)
    .where(
      and(
        eq(sponsoredTransactions.organizationId, organizationId),
        gte(sponsoredTransactions.createdAt, monthStart()),
      ),
    );
  return n;
}

export async function creditBalance(deps: Deps, organizationId: string): Promise<number> {
  const [{ balance } = { balance: 0 }] = await deps.db
    .select({ balance: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` })
    .from(creditLedger)
    .where(eq(creditLedger.organizationId, organizationId));
  return balance;
}

/**
 * Refuses a recording — before anyone is asked to sign — when the free allowance is used up and no
 * credits are left. Concurrent in-flight recordings may take the balance slightly below zero.
 */
export async function assertCanRecord(deps: Deps, organizationId: string): Promise<void> {
  if ((await recordsThisMonth(deps, organizationId)) < deps.config.STELE_FREE_RECORDS_PER_MONTH)
    return;
  if ((await creditBalance(deps, organizationId)) > 0) return;
  throw new ApiError(
    402,
    "credits_exhausted",
    billingInfo(deps).enabled
      ? "This organization has used its free recordings for this month and has no credits left; an admin can buy credits under Billing. Nothing was signed."
      : "This organization has used its free recordings for this month. Nothing was signed.",
  );
}

/** Charges one credit for a newly booked recording beyond the free monthly allowance. */
export async function chargeRecording(
  deps: Deps,
  organizationId: string,
  recordId: string,
): Promise<void> {
  await chargeRecordings(deps, organizationId, [recordId]);
}

/**
 * Charges one credit for each of `recordIds` (just booked, in order) that lies beyond the free
 * monthly allowance. Idempotent per record.
 */
export async function chargeRecordings(
  deps: Deps,
  organizationId: string,
  recordIds: string[],
): Promise<void> {
  const over =
    (await recordsThisMonth(deps, organizationId)) - deps.config.STELE_FREE_RECORDS_PER_MONTH;
  if (over <= 0) return;
  const charged = recordIds.slice(Math.max(0, recordIds.length - over));
  if (charged.length === 0) return;
  await deps.db
    .insert(creditLedger)
    .values(
      charged.map((reference) => ({
        organizationId,
        delta: -1,
        kind: "recording",
        reference,
      })),
    )
    .onConflictDoNothing();
}

// ---- payments ----------------------------------------------------------------------------------------

/** The System Program transfer in `tx` that pays `expected`, or null. Top-level instructions only. */
export function matchPayment(
  tx: Pick<DecodedTransaction, "instructions">,
  expected: { treasury: string; reference: string; lamports: number },
): { payer: string; lamports: bigint } | null {
  for (const ix of tx.instructions) {
    if (ix.programId !== SYSTEM_PROGRAM_ADDRESS || ix.data.length !== 12) continue;
    const view = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);
    if (view.getUint32(0, true) !== 2) continue; // SystemInstruction::Transfer
    const lamports = view.getBigUint64(4, true);
    const [payer, destination, ...extra] = ix.accounts;
    if (!payer || destination !== expected.treasury) continue;
    if (!extra.includes(expected.reference)) continue;
    if (lamports < BigInt(expected.lamports)) continue;
    return { payer, lamports };
  }
  return null;
}

/** A successful, confirmed transaction, decoded from its wire bytes; null otherwise. */
async function fetchConfirmed(deps: Deps, signature: string): Promise<DecodedTransaction | null> {
  const tx = await deps.chain.rpc
    .getTransaction(signature as never, {
      encoding: "base64",
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    })
    .send();
  if (!tx || tx.meta?.err) return null;
  return decodeWireTransaction(
    fromBase64(tx.transaction[0]),
    [...(tx.meta?.loadedAddresses?.writable ?? [])],
    [...(tx.meta?.loadedAddresses?.readonly ?? [])],
  );
}

export function invoiceView(i: Invoice) {
  return {
    id: i.id,
    pack: i.pack,
    credits: i.credits,
    lamports: i.lamports,
    treasury: i.treasury,
    reference: i.reference,
    status: i.status,
    transactionSignature: i.txSignature,
    payer: i.payer,
    createdAt: i.createdAt,
    expiresAt: i.expiresAt,
    paidAt: i.paidAt,
  };
}

export async function createInvoice(
  deps: Deps,
  organizationId: string,
  packId: string,
  actor: { userId: string; walletAddress: string },
) {
  const info = billingInfo(deps);
  if (!info.enabled || !info.treasury)
    throw conflict("billing_unavailable", "Credit purchases are not enabled on this Stele app");
  const pack = info.packs.find((p) => p.id === packId);
  if (!pack) throw badRequest("invalid_pack", "Unknown credit pack");
  const [invoice] = await deps.db
    .insert(billingInvoices)
    .values({
      organizationId,
      pack: pack.id,
      credits: pack.credits,
      lamports: pack.lamports,
      treasury: info.treasury,
      // A fresh random address that only this invoice's payment will reference.
      reference: toBase58(randomBytes(32)),
      createdBy: actor.walletAddress,
      expiresAt: new Date(Date.now() + INVOICE_TTL_MS),
    })
    .returning();
  await appendAudit(deps.db, {
    organizationId,
    actorType: "user",
    actorId: actor.userId,
    action: "billing.invoice_created",
    targetType: "invoice",
    targetId: invoice!.id,
    metadata: { credits: pack.credits, lamports: pack.lamports },
  });
  return invoiceView(invoice!);
}

/**
 * Credits an invoice once its payment is confirmed on-chain. With `signature`, checks that
 * transaction; without, looks for transactions referencing the invoice (the browser may have closed).
 */
export async function confirmInvoice(
  deps: Deps,
  organizationId: string,
  invoiceId: string,
  signature: string | undefined,
  actor: { userId: string },
) {
  const [invoice] = await deps.db
    .select()
    .from(billingInvoices)
    .where(
      and(eq(billingInvoices.id, invoiceId), eq(billingInvoices.organizationId, organizationId)),
    );
  if (!invoice) throw notFound("Invoice");
  if (invoice.status === "paid") return invoiceView(invoice);

  const candidates = signature
    ? [signature]
    : (
        await deps.chain.rpc
          .getSignaturesForAddress(address(invoice.reference), {
            limit: 20,
            commitment: "confirmed",
          })
          .send()
      )
        .filter((s) => s.err === null)
        .map((s) => s.signature as string);

  for (const candidate of candidates) {
    const tx = await fetchConfirmed(deps, candidate);
    const paid = tx && matchPayment(tx, invoice);
    if (!paid) continue;
    const credited = await deps.db.transaction(async (db) => {
      const [updated] = await db
        .update(billingInvoices)
        .set({ status: "paid", txSignature: candidate, payer: paid.payer, paidAt: new Date() })
        .where(and(eq(billingInvoices.id, invoice.id), eq(billingInvoices.status, "open")))
        .returning();
      if (!updated) return null; // credited concurrently
      await db
        .insert(creditLedger)
        .values({ organizationId, delta: invoice.credits, kind: "purchase", reference: invoice.id })
        .onConflictDoNothing();
      return updated;
    });
    if (credited) {
      await appendAudit(deps.db, {
        organizationId,
        actorType: "user",
        actorId: actor.userId,
        action: "billing.credits_purchased",
        targetType: "invoice",
        targetId: invoice.id,
        txSignature: candidate,
        metadata: { credits: invoice.credits, lamports: Number(paid.lamports), payer: paid.payer },
      });
      return invoiceView(credited);
    }
    const [current] = await deps.db
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.id, invoice.id));
    return invoiceView(current!);
  }
  throw conflict(
    "payment_not_found",
    signature
      ? "That transaction is not a confirmed payment of this invoice (amount, treasury or reference differ)."
      : "No confirmed payment for this invoice yet. If you just paid, try again in a few seconds.",
  );
}

/** Dashboard view: allowance, balance, packs and recent invoices. */
export async function billingOverview(deps: Deps, organizationId: string) {
  const info = billingInfo(deps);
  const used = await recordsThisMonth(deps, organizationId);
  const invoices = await deps.db
    .select()
    .from(billingInvoices)
    .where(eq(billingInvoices.organizationId, organizationId))
    .orderBy(desc(billingInvoices.createdAt))
    .limit(20);
  return {
    ...info,
    usedThisMonth: used,
    freeRemaining: Math.max(0, info.freeRecordsPerMonth - used),
    credits: await creditBalance(deps, organizationId),
    invoices: invoices.map(invoiceView),
  };
}
