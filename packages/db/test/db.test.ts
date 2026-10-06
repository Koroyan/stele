import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, eq, organizations, users } from "../src/index";
import { createTestDb } from "../src/testing";
import type { DbHandle } from "../src/index";

let h: DbHandle;

beforeAll(async () => {
  h = await createTestDb();
});

afterAll(async () => {
  await h.close();
});

describe("schema and migrations (PGlite)", () => {
  it("applies migrations and enforces uniqueness", async () => {
    await h.db.insert(users).values({ walletAddress: "WalletA" });
    await expect(h.db.insert(users).values({ walletAddress: "WalletA" })).rejects.toThrow();
  });

  it("makes the audit log append-only at the database level", async () => {
    const [org] = await h.db
      .insert(organizations)
      .values({ address: "OrgA", creatorAddress: "C", name: "Acme", ownerAddress: "O" })
      .returning();
    const [entry] = await h.db
      .insert(auditLog)
      .values({
        organizationId: org!.id,
        sequence: 1,
        actorType: "system",
        actorId: "test",
        action: "test.created",
        createdAt: new Date(),
        prevHash: "0".repeat(64),
        entryHash: "1".repeat(64),
      })
      .returning();
    // Drizzle wraps driver errors ("Failed query: …"); the trigger's message is in `cause`.
    const reason = async (p: Promise<unknown>) => {
      try {
        await p;
        return "no error";
      } catch (e) {
        return `${String(e)} ${String((e as { cause?: unknown }).cause)}`;
      }
    };
    expect(
      await reason(
        h.db.update(auditLog).set({ action: "tampered" }).where(eq(auditLog.id, entry!.id)),
      ),
    ).toMatch(/append-only/);
    expect(await reason(h.db.delete(auditLog).where(eq(auditLog.id, entry!.id)))).toMatch(
      /append-only/,
    );
  });
});
