/**
 * Keyset pagination for on-chain records, newest first, ordered by (slot, id). Unlike a timestamp
 * cursor it never skips records that share a slot or a block time, and records added while a client
 * pages never shift the pages it has not read yet.
 */
import { z } from "zod";
import { and, eq, lt, or } from "@stele/db";
import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { badRequest } from "../errors.js";

export const cursorParam = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,160}$/)
  .optional()
  .describe("`nextCursor` from the previous page");

export function encodeCursor(slot: number, id: string): string {
  return Buffer.from(`${slot}.${id}`).toString("base64url");
}

/** Rows strictly after the cursor in (slot DESC, id DESC) order. */
export function afterCursor(cursor: string, slot: AnyPgColumn, id: AnyPgColumn): SQL {
  const m = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!m)
    throw badRequest("invalid_cursor", "Invalid cursor: pass nextCursor from a previous page");
  const at = Number(m[1]);
  return or(lt(slot, at), and(eq(slot, at), lt(id, m[2]!)))!;
}

/** Splits `limit + 1` fetched rows into one page and the cursor of the next (or `null`). */
export function page<T>(
  rows: T[],
  limit: number,
  key: (row: T) => { slot: number; id: string },
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  const last = key(items[items.length - 1]!);
  return { items, nextCursor: encodeCursor(last.slot, last.id) };
}
