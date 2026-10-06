/** Public network information so clients can verify independently (no secrets). */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { fetchProtocolConfig } from "@stele/protocol";
import type { Deps } from "../deps.js";

export function networkRoutes(deps: Deps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get("/health", { config: { rateLimit: false } }, async () => ({ status: "ok" }));

    app.get("/ready", { config: { rateLimit: false } }, async (_req, reply) => {
      try {
        await deps.chain.rpc.getSlot({ commitment: "confirmed" }).send();
        return { status: "ready" };
      } catch {
        return reply.code(503).send({ status: "degraded", reason: "rpc unavailable" });
      }
    });

    // The network identity advertised to clients is read from the program's immutable on-chain
    // configuration (genesis-derived chain ID), never from static presets.
    let onChain: { chainId: string; networkLabel: string } | null = null;
    async function protocolIdentity() {
      if (!onChain) {
        const { config } = await fetchProtocolConfig(deps.chain.rpc, deps.chain.programAddress);
        onChain = { chainId: config.chainId, networkLabel: config.networkLabel };
      }
      return onChain;
    }

    app.get("/v1/network", async () => ({
      cluster: deps.config.network.cluster,
      chainId: (await protocolIdentity()).chainId,
      label: (await protocolIdentity()).networkLabel,
      walletChain: deps.config.network.walletChain,
      programId: deps.chain.programAddress,
      relayer: deps.chain.relayer.address,
      attestor: deps.chain.attestor.address,
      hostedAcceptDomain: deps.config.HOSTED_ACCEPT_DOMAIN,
      publicRpcUrls:
        deps.config.PUBLIC_RPC_URLS ??
        (deps.config.network.cluster === "localnet"
          ? deps.config.SOLANA_RPC_URLS
          : [deps.config.network.defaultRpcUrl]),
      contentMirror: deps.config.PUBLIC_CONTENT_BASE_URL,
    }));
  };
}
