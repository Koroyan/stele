/**
 * Tamper-evident audit log. Entries are append-only (enforced by a database trigger) and
 * hash-chained per organization:
 *
 *   entry_hash = SHA-256( prev_hash ‖ "\n" ‖ canonical_json(entry) )
 *
 * Any edit, deletion or reordering breaks every later hash. `verifyAuditChain` recomputes the chain;
 * exporting the head hash periodically (or anchoring it on-chain) bounds undetectable truncation.
 */
import { and, asc, auditLog, desc, eq, isNull, sql, type Database } from "@stele/db";
import { sha256Hex } from "./crypto.js";

export const GENESIS_HASH = "0".repeat(64);

export interface AuditEntryInput {
  organizationId: string | null;
  actorType: "user" | "api_key" | "system";
  actorId: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  txSignature?: string | null;
  ipHash?: string | null;
}

/** Deterministic JSON (sorted keys) for hashing. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

function entryHash(
  prevHash: string,
  e: { sequence: number; createdAt: Date } & Omit<AuditEntryInput, "ipHash">,
): string {
  return sha256Hex(
    `${prevHash}\n${canonicalJson({
      sequence: e.sequence,
      organizationId: e.organizationId,
      actorType: e.actorType,
      actorId: e.actorId,
      action: e.action,
      targetType: e.targetType ?? null,
      targetId: e.targetId ?? null,
      metadata: e.metadata ?? {},
      txSignature: e.txSignature ?? null,
      createdAt: e.createdAt.toISOString(),
    })}`,
  );
}

const orgFilter = (organizationId: string | null) =>
  organizationId === null
    ? isNull(auditLog.organizationId)
    : eq(auditLog.organizationId, organizationId);

/** Appends an entry; serialized per organization with a transaction-scoped advisory lock. */
export async function appendAudit(db: Database, input: AuditEntryInput): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.organizationId ?? "platform"}`}, 0))`,
    );
    const [last] = await tx
      .select({ sequence: auditLog.sequence, entryHash: auditLog.entryHash })
      .from(auditLog)
      .where(orgFilter(input.organizationId))
      .orderBy(desc(auditLog.sequence))
      .limit(1);
    const sequence = (last?.sequence ?? 0) + 1;
    const prevHash = last?.entryHash ?? GENESIS_HASH;
    // Millisecond precision so the stored timestamp round-trips exactly.
    const createdAt = new Date(Math.floor(Date.now()));
    await tx.insert(auditLog).values({
      organizationId: input.organizationId,
      sequence,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? {},
      txSignature: input.txSignature ?? null,
      ipHash: input.ipHash ?? null,
      createdAt,
      prevHash,
      entryHash: entryHash(prevHash, { ...input, sequence, createdAt }),
    });
  });
}

export interface AuditChainReport {
  valid: boolean;
  entries: number;
  headHash: string;
  brokenAtSequence: number | null;
  reason: string | null;
}

export async function verifyAuditChain(
  db: Database,
  organizationId: string | null,
): Promise<AuditChainReport> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(orgFilter(organizationId)))
    .orderBy(asc(auditLog.sequence));
  let prev = GENESIS_HASH;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const fail = (reason: string): AuditChainReport => ({
      valid: false,
      entries: rows.length,
      headHash: prev,
      brokenAtSequence: r.sequence,
      reason,
    });
    if (r.sequence !== i + 1) return fail("sequence gap (entries missing or reordered)");
    if (r.prevHash !== prev) return fail("previous-hash link mismatch");
    const recomputed = entryHash(prev, {
      sequence: r.sequence,
      organizationId: r.organizationId,
      actorType: r.actorType,
      actorId: r.actorId,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadata,
      txSignature: r.txSignature,
      createdAt: r.createdAt,
    });
    if (recomputed !== r.entryHash) return fail("entry content does not match its hash");
    prev = r.entryHash;
  }
  return {
    valid: true,
    entries: rows.length,
    headHash: prev,
    brokenAtSequence: null,
    reason: null,
  };
}
