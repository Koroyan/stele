/**
 * @stele/verifier — independent verification of Stele evidence.
 *
 * Talks only to Solana RPC endpoints you choose and to content storage; never to a Stele server.
 *
 * ```ts
 * import { JsonRpcSource, ConsensusSource, verifyAcceptance } from "@stele/verifier";
 * const chain = new ConsensusSource([new JsonRpcSource(rpcA), new JsonRpcSource(rpcB)]);
 * const report = await verifyAcceptance({ transactionSignature }, { chain });
 * console.log(report.verdict); // "VALID" | "VALID_WITH_WARNINGS" | "INVALID" | "INCONCLUSIVE"
 * ```
 */
export * from "./content";
export * from "./receipt";
export * from "./report";
export * from "./rpc";
export * from "./verify";
export * from "./wire";

import { ConsensusSource, JsonRpcSource, type ChainSource } from "./rpc";

/** Builds a chain source from one or more RPC URLs (all must agree). */
export function chainFromUrls(urls: string[], fetchImpl?: typeof fetch): ChainSource {
  const sources = urls.map((u) => new JsonRpcSource(u, fetchImpl));
  return sources.length === 1 ? sources[0]! : new ConsensusSource(sources);
}
