/** Server-side helpers (React Server Components only). */
import type { NetworkInfo } from "@stele/sdk";

const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000").replace(
  /\/$/,
  "",
);

let cached: { at: number; value: NetworkInfo } | null = null;

/** Public network identity advertised by the API (cached briefly); `null` when the API is down. */
export async function getNetworkInfo(): Promise<NetworkInfo | null> {
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  try {
    const res = await fetch(`${API_INTERNAL_URL}/v1/network`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return cached?.value ?? null;
    const value = (await res.json()) as NetworkInfo;
    cached = { at: Date.now(), value };
    return value;
  } catch {
    return cached?.value ?? null;
  }
}

/** Fetches a public API resource for page metadata (never used as evidence). */
export async function getPublic<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_INTERNAL_URL}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}
