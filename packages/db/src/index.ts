import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { PgDatabase } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

export * as schema from "./schema";
export * from "./schema";
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

/**
 * SQL migrations: next to the package sources (`packages/db/drizzle`) or, when this module is inlined
 * into a bundle, shipped alongside it (`dist/drizzle`). STELE_MIGRATIONS_DIR overrides both.
 */
function findMigrations(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, "../drizzle"), resolve(here, "drizzle")];
  return candidates.find((dir) => existsSync(join(dir, "meta", "_journal.json"))) ?? candidates[0]!;
}

export const MIGRATIONS_DIR = process.env.STELE_MIGRATIONS_DIR ?? findMigrations();

/** Any Drizzle Postgres database over this schema (postgres-js in production, PGlite in tests). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = PgDatabase<any, typeof schema>;

export interface DbHandle {
  db: Database;
  close(): Promise<void>;
}

/** Production client (postgres-js). TLS is enforced unless the URL targets localhost. */
export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
  const local = /@(localhost|127\.0\.0\.1|postgres)(:|\/)/.test(url);
  const client = postgres(url, {
    max: opts.max ?? 10,
    ssl: local ? false : "require",
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: true,
  });
  const db = drizzlePg(client, { schema }) as unknown as Database;
  return { db, close: () => client.end({ timeout: 5 }) };
}

export async function migrateDb(url: string): Promise<void> {
  const client = postgres(url, {
    max: 1,
    ssl: /@(localhost|127\.0\.0\.1|postgres)(:|\/)/.test(url) ? false : "require",
  });
  try {
    await migratePg(drizzlePg(client), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await client.end({ timeout: 5 });
  }
}
