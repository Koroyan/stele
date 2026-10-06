/** Chain indexer process. `STELE_INDEXER_REBUILD=1` replays the program's full history once. */
import { indexOnce } from "./indexer.js";
import { bootstrap, onShutdown } from "./runtime.js";

const { deps, close } = await bootstrap("indexer");
let stopped = false;
onShutdown(async () => {
  stopped = true;
  await close();
});

if (process.env.STELE_INDEXER_REBUILD === "1") {
  const n = await indexOnce(deps, { rebuild: true });
  deps.logger.info({ transactions: n }, "rebuild complete");
}
while (!stopped) {
  try {
    const n = await indexOnce(deps);
    if (n > 0) deps.logger.info({ transactions: n }, "indexed");
  } catch (e) {
    deps.logger.error({ err: e }, "indexer round failed");
  }
  await new Promise((r) => setTimeout(r, 2_000));
}
