/**
 * Network switcher configuration (server only).
 *
 * Every Solana network is a separate Stele deployment: its own API, database, relayer and attestor
 * keys, and web address (for example `https://devnet.app.stele.example`). Evidence never mixes
 * across networks: each network's chain ID is committed into every fingerprint and acceptance. The
 * switcher links between deployments; it never points one deployment at another network's data.
 *
 *   STELE_NETWORKS=mainnet=https://app.stele.example,devnet=https://devnet.app.stele.example,testnet=
 *
 * Order is display order. An entry without a URL is listed as "not available". To stop offering a
 * network (for example testnet in production), remove its entry. The current network always comes
 * from the API this deployment talks to.
 */
import { getNetworkInfo } from "./server";

export const CLUSTERS = ["mainnet", "devnet", "testnet", "localnet"] as const;
export type Cluster = (typeof CLUSTERS)[number];

const LABELS: Record<Cluster, string> = {
  mainnet: "Solana Mainnet",
  devnet: "Solana Devnet",
  testnet: "Solana Testnet",
  localnet: "Solana Localnet",
};

export interface NetworkChoice {
  cluster: string;
  label: string;
  /** Origin of that network's Stele app, or `null` when it is not available. */
  url: string | null;
  current: boolean;
  /** Not production: documents and acceptances there are for testing. */
  test: boolean;
}

export interface NetworkMenu {
  current: NetworkChoice;
  choices: NetworkChoice[];
}

function isCluster(value: string): value is Cluster {
  return (CLUSTERS as readonly string[]).includes(value);
}

/** Parses `cluster=url` pairs; unknown clusters and malformed URLs are ignored. */
export function parseNetworks(raw: string | undefined): { cluster: Cluster; url: string | null }[] {
  const out: { cluster: Cluster; url: string | null }[] = [];
  for (const entry of (raw ?? "").split(",")) {
    const [name = "", ...rest] = entry.trim().split("=");
    const cluster = name.trim().toLowerCase();
    if (!isCluster(cluster) || out.some((n) => n.cluster === cluster)) continue;
    const value = rest.join("=").trim();
    let url: string | null = null;
    if (value) {
      try {
        const parsed = new URL(value);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") url = parsed.origin;
      } catch {
        // malformed: listed as not available
      }
    }
    out.push({ cluster, url });
  }
  return out;
}

/** The networks to offer, with the one this deployment serves marked current. */
export async function getNetworkMenu(): Promise<NetworkMenu | null> {
  const info = await getNetworkInfo();
  if (!info) return null;
  const configured = parseNetworks(process.env.STELE_NETWORKS);
  const toChoice = (cluster: string, url: string | null): NetworkChoice => {
    const current = cluster === info.cluster;
    return {
      cluster,
      label: current ? info.label : isCluster(cluster) ? LABELS[cluster] : cluster,
      url: current ? null : url,
      current,
      test: cluster !== "mainnet",
    };
  };
  const choices = configured.map((n) => toChoice(n.cluster, n.url));
  if (!choices.some((c) => c.current)) choices.unshift(toChoice(info.cluster, null));
  return { current: choices.find((c) => c.current)!, choices };
}
