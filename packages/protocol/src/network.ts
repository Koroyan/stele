/**
 * Network identities. `chainId` is CAIP-2 (genesis-hash derived) and is committed into every
 * version fingerprint; `label` appears in every acceptance message. Together they make devnet
 * evidence unusable on mainnet and vice versa.
 */
/** Devnet for testing, Mainnet for production; Localnet only on a developer's machine. */
export type ClusterName = "mainnet" | "devnet" | "localnet";

export interface NetworkPreset {
  cluster: ClusterName;
  chainId: string;
  label: string;
  /** Wallet Standard chain identifier. */
  walletChain: `solana:${string}`;
  /** Full genesis hash, when known (localnets vary). */
  genesisHash: string | null;
  defaultRpcUrl: string;
  explorerCluster: string | null;
}

export const NETWORKS: Record<ClusterName, NetworkPreset> = {
  mainnet: {
    cluster: "mainnet",
    chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    label: "Solana Mainnet",
    walletChain: "solana:mainnet",
    genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    defaultRpcUrl: "https://api.mainnet-beta.solana.com",
    explorerCluster: null,
  },
  devnet: {
    cluster: "devnet",
    chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    label: "Solana Devnet",
    walletChain: "solana:devnet",
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    defaultRpcUrl: "https://api.devnet.solana.com",
    explorerCluster: "devnet",
  },
  localnet: {
    cluster: "localnet",
    chainId: "solana:localnet",
    label: "Solana Localnet",
    walletChain: "solana:localnet",
    genesisHash: null,
    defaultRpcUrl: "http://127.0.0.1:8899",
    explorerCluster: "custom",
  },
};

/** CAIP-2 chain id for a genesis hash: `solana:` + first 32 base58 characters. */
export function chainIdFromGenesisHash(genesisHash: string): string {
  return `solana:${genesisHash.slice(0, 32)}`;
}

export function networkByChainId(chainId: string): NetworkPreset | null {
  return Object.values(NETWORKS).find((n) => n.chainId === chainId) ?? null;
}

export function explorerTxUrl(signature: string, network: NetworkPreset, rpcUrl?: string): string {
  const base = `https://explorer.solana.com/tx/${signature}`;
  if (network.cluster === "mainnet") return base;
  if (network.cluster === "localnet")
    return `${base}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl ?? network.defaultRpcUrl)}`;
  return `${base}?cluster=${network.explorerCluster}`;
}

export function explorerAddressUrl(addr: string, network: NetworkPreset, rpcUrl?: string): string {
  const base = `https://explorer.solana.com/address/${addr}`;
  if (network.cluster === "mainnet") return base;
  if (network.cluster === "localnet")
    return `${base}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl ?? network.defaultRpcUrl)}`;
  return `${base}?cluster=${network.explorerCluster}`;
}
