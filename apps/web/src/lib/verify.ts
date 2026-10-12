/** Browser verifier configuration: the user's RPC choices, pinned program, explicit content sources. */
import type { NetworkInfo } from "@stelehq/sdk";
import { chainFromUrls, type VerifierOptions } from "@stelehq/verifier";
import { PINNED_CHAIN_ID, PINNED_PROGRAM_ID } from "./env";
import { rpcUrls } from "./chain";

export interface VerifySettings {
  rpcUrls: string[];
  programId: string;
  /** Required network (CAIP-2). Empty = accept whatever network the RPC serves (reported in the result). */
  expectedChainId: string;
  ipfsGateways: boolean;
  liveDns: boolean;
}

export const DEFAULT_IPFS_GATEWAYS = ["https://ipfs.io/ipfs", "https://dweb.link/ipfs"];

export function defaultSettings(network: NetworkInfo): VerifySettings {
  return {
    rpcUrls: rpcUrls(network),
    programId: PINNED_PROGRAM_ID,
    expectedChainId: PINNED_CHAIN_ID ?? network.chainId,
    ipfsGateways: false,
    liveDns: false,
  };
}

export function verifierOptions(network: NetworkInfo, s: VerifySettings): VerifierOptions {
  return {
    chain: chainFromUrls(s.rpcUrls),
    programId: s.programId,
    expectedChainId: s.expectedChainId || undefined,
    content: {
      // Content is accepted only if its SHA-256 matches the on-chain commitment, whatever the source.
      mirrors: [`${window.location.origin}/api/v1/public/content`],
      ipfsGateways: s.ipfsGateways ? DEFAULT_IPFS_GATEWAYS : [],
      arweaveGateways: s.ipfsGateways ? ["https://arweave.net"] : [],
      timeoutMs: 10_000,
    },
    trustedRequestDomains: [network.hostedAcceptDomain],
    liveDnsCheck: s.liveDns,
  };
}

export function rpcHosts(urls: string[]): string {
  return urls
    .map((u) => {
      try {
        return new URL(u).host;
      } catch {
        return u;
      }
    })
    .join(" + ");
}

/** Equivalent CLI invocation, so users can reproduce the check outside the browser. */
export function cliCommand(
  s: VerifySettings,
  target: { tx?: string; receipt?: boolean; version?: string; fingerprint?: string },
): string {
  const parts = ["npx @stelehq/verifier"];
  for (const u of s.rpcUrls) parts.push(`--rpc ${u}`);
  if (s.programId) parts.push(`--program ${s.programId}`);
  if (s.expectedChainId) parts.push(`--expect-chain ${s.expectedChainId}`);
  if (s.liveDns) parts.push("--dns");
  if (target.tx) parts.push(`--tx ${target.tx}`);
  if (target.receipt) parts.push("--receipt receipt.json");
  if (target.version) parts.push(`--version ${target.version}`);
  if (target.fingerprint) parts.push(`--fingerprint ${target.fingerprint}`);
  return parts.join(" \\\n  ");
}
