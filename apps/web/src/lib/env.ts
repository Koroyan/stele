/**
 * Values pinned at build time. They are compared against what the API advertises, so a compromised
 * API cannot silently point the browser at another program, network or RPC provider.
 */
import { DEFAULT_PROGRAM_ADDRESS } from "@stele/protocol";

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const PINNED_PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID || DEFAULT_PROGRAM_ADDRESS;
export const PINNED_CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID || undefined;
/** RPC endpoints the browser reads from. Empty = use the list advertised by the API. */
export const PINNED_RPC_URLS = list(process.env.NEXT_PUBLIC_RPC_URLS);
/** Source repository link shown in the footer and docs (hidden when unset). */
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL || null;
