/** In-process PostgreSQL (PGlite, real Postgres compiled to WASM) with all migrations applied. */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { MIGRATIONS_DIR, type Database, type DbHandle } from "./index";
import * as schema from "./schema";

export async function createTestDb(): Promise<DbHandle> {
  return openPglite();
}

/**
 * Embedded database for local development (`DATABASE_URL=pglite:<directory>`), persisted to disk.
 * Single process only: run the API with RUN_WORKERS=true. Never used in production.
 */
export async function openPglite(dataDir?: string): Promise<DbHandle> {
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db: db as unknown as Database, close: () => client.close() };
}
