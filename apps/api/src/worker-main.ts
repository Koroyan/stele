/** Standalone worker process (webhooks, finality, expiry, domain renewal) for scaled deployments. */
import { bootstrap, onShutdown } from "./runtime.js";
import { startWorkers } from "./workers.js";

const { deps, close } = await bootstrap("worker");
const stop = startWorkers(deps);
onShutdown(async () => {
  await stop();
  await close();
});
