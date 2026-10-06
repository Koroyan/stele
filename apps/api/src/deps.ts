import type { FastifyBaseLogger } from "fastify";
import type { Database } from "@stele/db";
import type { Config } from "./config.js";
import type { ChainService } from "./lib/chain.js";
import type { ContentStore } from "./lib/storage.js";

/** Everything a request handler may use. Constructed once in `main.ts` (or by tests). */
export interface Deps {
  config: Config;
  db: Database;
  chain: ChainService;
  storage: ContentStore;
  logger: FastifyBaseLogger;
  encryptionKey: Buffer;
}
