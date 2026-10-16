/**
 * Webhooks: transactional outbox + signed deliveries.
 *
 * Signature header (Stripe-style, replay-resistant):
 *   Stele-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 * Receivers must verify the HMAC with a constant-time comparison and reject timestamps older than
 * 5 minutes. Webhooks POINT TO evidence (transaction signature, acceptance ID, receipt URL); they are
 * not evidence themselves — receivers should verify independently before relying on them.
 */
import {
  and,
  asc,
  eq,
  inArray,
  lte,
  sql,
  webhookDeliveries,
  webhookEndpoints,
  type Database,
} from "@stele/db";
import { decrypt, hmacSha256Hex, randomToken } from "./crypto.js";
import { safePost, validateOutboundUrl, type UrlPolicy } from "./ssrf.js";

export const WEBHOOK_EVENTS = [
  "agreement.accepted",
  "agreement.finalized",
  "document.version_published",
  "gate.program_verification_changed",
  "organization.domain_verified",
  "organization.member_changed",
  "proof.recorded",
  "signer.registered",
  "signer.changed",
  "sponsorship.low_balance",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const MAX_ATTEMPTS = 10;
/** Backoff schedule (seconds) after attempt n (1-based). */
export const BACKOFF = [60, 300, 900, 3_600, 7_200, 14_400, 28_800, 43_200, 86_400];

export function signPayload(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

export function newWebhookSecret(): string {
  return `whsec_${randomToken(32)}`;
}

/** Enqueues an event for every active endpoint of the organization subscribed to it. */
export async function enqueueWebhook(
  db: Database,
  organizationId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
  eventId = `evt_${randomToken(16)}`,
): Promise<number> {
  const endpoints = await db
    .select({ id: webhookEndpoints.id, events: webhookEndpoints.events })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.organizationId, organizationId),
        eq(webhookEndpoints.status, "active"),
      ),
    );
  const targets = endpoints.filter((e) => e.events.includes(event) || e.events.includes("*"));
  if (targets.length === 0) return 0;
  const payload = {
    id: eventId,
    type: event,
    createdAt: new Date().toISOString(),
    organizationId,
    data,
  };
  await db
    .insert(webhookDeliveries)
    .values(targets.map((t) => ({ endpointId: t.id, eventId, eventType: event, payload })))
    .onConflictDoNothing();
  return targets.length;
}

export interface DispatchOptions {
  encryptionKey: Buffer;
  urlPolicy: UrlPolicy;
  batchSize?: number;
  now?: () => Date;
  post?: typeof safePost;
}

/** Delivers due webhooks once. Safe to run concurrently (rows are claimed with SKIP LOCKED). */
export async function dispatchDueWebhooks(
  db: Database,
  opts: DispatchOptions,
): Promise<{ delivered: number; failed: number }> {
  const now = opts.now?.() ?? new Date();
  const post = opts.post ?? safePost;
  const claimed = await db.transaction(async (tx) => {
    const due = await tx
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(
        and(
          inArray(webhookDeliveries.status, ["pending", "failed"]),
          lte(webhookDeliveries.nextAttemptAt, now),
        ),
      )
      .orderBy(asc(webhookDeliveries.nextAttemptAt))
      .limit(opts.batchSize ?? 25)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];
    // Push the visibility timeout forward so another worker does not pick these up meanwhile.
    await tx
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date(now.getTime() + 120_000) })
      .where(
        inArray(
          webhookDeliveries.id,
          due.map((d) => d.id),
        ),
      );
    return due.map((d) => d.id);
  });

  let delivered = 0;
  let failed = 0;
  for (const id of claimed) {
    const [row] = await db
      .select({ d: webhookDeliveries, e: webhookEndpoints })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .where(eq(webhookDeliveries.id, id));
    if (!row) continue;
    const { d, e } = row;
    const attempts = d.attempts + 1;
    if (e.status !== "active") {
      await db
        .update(webhookDeliveries)
        .set({ status: "dead", attempts, lastError: "endpoint disabled" })
        .where(eq(webhookDeliveries.id, id));
      continue;
    }
    const body = JSON.stringify(d.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    let status = 0;
    let error: string | null = null;
    try {
      const url = validateOutboundUrl(e.url, opts.urlPolicy);
      const secret = decrypt(e.secretCiphertext, opts.encryptionKey);
      const res = await post(
        url,
        body,
        {
          "user-agent": "Stele-Webhooks/1.0",
          "stele-event": d.eventType,
          "stele-event-id": d.eventId,
          "stele-delivery-id": d.id,
          "stele-signature": signPayload(secret, timestamp, body),
        },
        opts.urlPolicy,
      );
      status = res.status;
      if (status < 200 || status >= 300) error = `HTTP ${status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    if (!error) {
      delivered++;
      await db
        .update(webhookDeliveries)
        .set({
          status: "delivered",
          attempts,
          lastResponseStatus: status,
          lastError: null,
          deliveredAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, id));
      await db
        .update(webhookEndpoints)
        .set({ consecutiveFailures: 0 })
        .where(eq(webhookEndpoints.id, e.id));
    } else {
      failed++;
      const dead = attempts >= MAX_ATTEMPTS;
      const delay = BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)]!;
      await db
        .update(webhookDeliveries)
        .set({
          status: dead ? "dead" : "failed",
          attempts,
          lastResponseStatus: status || null,
          lastError: error.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + delay * 1000),
        })
        .where(eq(webhookDeliveries.id, id));
      await db
        .update(webhookEndpoints)
        .set({ consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1` })
        .where(eq(webhookEndpoints.id, e.id));
    }
  }
  return { delivered, failed };
}
