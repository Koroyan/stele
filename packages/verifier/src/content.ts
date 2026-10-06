/**
 * Content retrieval with integrity enforcement: every candidate source is fetched, hashed and
 * compared with the on-chain commitment. A source returning different bytes is reported — never
 * silently trusted, never silently skipped.
 */
import { bytesEqual, contentHash, toHex } from "@stele/protocol";

export interface ContentAttempt {
  source: string;
  outcome: "match" | "mismatch" | "unavailable";
  detail?: string;
}

export interface ContentResult {
  bytes: Uint8Array | null;
  matchedSource: string | null;
  attempts: ContentAttempt[];
}

export interface ContentOptions {
  /** Arweave gateways (`ar://<id>` is resolved against each). */
  arweaveGateways?: string[];
  /** IPFS gateways (`ipfs://<cid>` is resolved against each). */
  ipfsGateways?: string[];
  /** Additional content-addressed mirrors: `${mirror}/${contentHashHex}` is fetched. */
  mirrors?: string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

export const DEFAULT_ARWEAVE_GATEWAYS = ["https://arweave.net"];
export const DEFAULT_IPFS_GATEWAYS = ["https://ipfs.io/ipfs", "https://dweb.link/ipfs"];

export function resolveStorageUri(uri: string, opts: ContentOptions = {}): string[] {
  if (uri.startsWith("ar://"))
    return (opts.arweaveGateways ?? DEFAULT_ARWEAVE_GATEWAYS).map((g) => `${g}/${uri.slice(5)}`);
  if (uri.startsWith("ipfs://"))
    return (opts.ipfsGateways ?? DEFAULT_IPFS_GATEWAYS).map((g) => `${g}/${uri.slice(7)}`);
  if (uri.startsWith("https://")) return [uri];
  return [];
}

async function fetchBytes(url: string, opts: ContentOptions): Promise<Uint8Array> {
  const f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await f(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > (opts.maxBytes ?? 4 * 1024 * 1024)) throw new Error("response too large");
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Finds bytes whose SHA-256 equals `expectedHash`. `embedded` (e.g. from a receipt) is tried first,
 * then the on-chain storage URI, then mirrors. Stops at the first match but records every attempt.
 */
export async function retrieveContent(
  expectedHash: Uint8Array,
  storageUri: string,
  embedded: Uint8Array | null,
  opts: ContentOptions = {},
): Promise<ContentResult> {
  const attempts: ContentAttempt[] = [];
  const check = (source: string, bytes: Uint8Array): boolean => {
    const actual = contentHash(bytes);
    if (bytesEqual(actual, expectedHash)) {
      attempts.push({ source, outcome: "match" });
      return true;
    }
    attempts.push({ source, outcome: "mismatch", detail: `sha256 ${toHex(actual)}` });
    return false;
  };
  if (embedded && check("receipt (embedded content)", embedded)) {
    return { bytes: embedded, matchedSource: "receipt (embedded content)", attempts };
  }
  const urls = [
    ...resolveStorageUri(storageUri, opts),
    ...(opts.mirrors ?? []).map((m) => `${m.replace(/\/$/, "")}/${toHex(expectedHash)}`),
  ];
  for (const url of urls) {
    try {
      const bytes = await fetchBytes(url, opts);
      if (check(url, bytes)) return { bytes, matchedSource: url, attempts };
    } catch (e) {
      attempts.push({
        source: url,
        outcome: "unavailable",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { bytes: null, matchedSource: null, attempts };
}
