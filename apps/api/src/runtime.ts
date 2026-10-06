/** Shared process bootstrap for the API, worker and indexer entry points. */
import { resolve } from "node:path";
import { createDb, migrateDb } from "@stele/db";
import { loadConfig, type Config } from "./config.js";
import type { Deps } from "./deps.js";
import { createChainService } from "./lib/chain.js";
import { FilesystemContentStore, S3ContentStore, type ContentStore } from "./lib/storage.js";
import { createLogger } from "./logger.js";

export function createStorage(config: Config): ContentStore {
  if (config.STORAGE_PROVIDER === "s3")
    return new S3ContentStore(
      config.S3_BUCKET!,
      config.S3_PREFIX,
      config.S3_REGION,
      config.S3_ENDPOINT,
    );
  return new FilesystemContentStore(resolve(process.cwd(), config.STORAGE_DIR));
}

export async function bootstrap(
  service: string,
): Promise<{ deps: Deps; close: () => Promise<void> }> {
  const config = loadConfig();
  // `service` is the application (stele-api); `process` distinguishes api / worker / indexer.
  const logger = createLogger(config.LOG_LEVEL).child({ process: service });
  let handle;
  if (config.DATABASE_URL.startsWith("pglite:")) {
    // Local development without a PostgreSQL server: embedded, migrated on open (config forbids it in production).
    const { openPglite } = await import("@stele/db/testing");
    handle = await openPglite(
      resolve(process.cwd(), config.DATABASE_URL.slice("pglite:".length) || ".data/pglite"),
    );
    logger.warn("using the embedded PGlite database (development only; single process)");
  } else {
    if (process.env.MIGRATE_ON_START === "true") {
      await migrateDb(config.DATABASE_URL);
      logger.info("database migrations applied");
    }
    handle = createDb(config.DATABASE_URL);
  }
  const { db, close } = handle;
  const chain = await createChainService(config);
  const deps: Deps = {
    config,
    db,
    chain,
    storage: createStorage(config),
    logger,
    encryptionKey: Buffer.from(config.ENCRYPTION_KEY, "base64"),
  };
  logger.info(
    {
      cluster: config.network.cluster,
      program: chain.programAddress,
      relayer: chain.relayer.address,
    },
    "bootstrapped",
  );
  return { deps, close };
}

export function onShutdown(fn: () => Promise<void>): void {
  let closing = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      if (closing) return;
      closing = true;
      fn()
        .catch(() => undefined)
        .finally(() => process.exit(0));
    });
  }
}
