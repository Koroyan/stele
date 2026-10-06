/** API server entry point. */
import { buildApp } from "./app.js";
import { startIndexer } from "./indexer.js";
import { bootstrap, onShutdown } from "./runtime.js";
import { startWorkers } from "./workers.js";

const { deps, close } = await bootstrap("api");
let redis: { quit(): Promise<unknown> } | undefined;
if (deps.config.REDIS_URL) {
  const { Redis } = await import("ioredis");
  redis = new Redis(deps.config.REDIS_URL, { connectTimeout: 500, maxRetriesPerRequest: 1 });
}
const app = await buildApp(deps, { redis });
const stopWorkers = deps.config.RUN_WORKERS ? startWorkers(deps) : null;
const stopIndexer = deps.config.RUN_INDEXER ? startIndexer(deps) : null;

await app.listen({ host: deps.config.HOST, port: deps.config.PORT });

onShutdown(async () => {
  await app.close();
  await stopWorkers?.();
  await stopIndexer?.();
  await redis?.quit();
  await close();
});
