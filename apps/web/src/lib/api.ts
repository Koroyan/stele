/**
 * Browser client for the Stele API (same-origin `/api` rewrite; session cookie + CSRF header).
 * API responses describe database mirrors and are never treated as cryptographic proof — pages
 * that show evidence verify it against Solana themselves.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function csrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const m = /(?:^|;\s*)stele_csrf=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]!) : null;
}

export interface ApiRequest {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, req: ApiRequest = {}): Promise<T> {
  const method = req.method ?? (req.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = { accept: "application/json" };
  if (req.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") {
    const token = csrfToken();
    if (token) headers["x-csrf-token"] = token;
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      signal: req.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(
      0,
      "network_error",
      "The Stele API is unreachable. Check your connection and try again.",
    );
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "http_error",
      err?.message ?? `Request failed (HTTP ${res.status})`,
    );
  }
  return body as T;
}

export const isReauthError = (e: unknown) =>
  e instanceof ApiError && e.code === "reauthentication_required";

/** Wallets refuse requests bound to another network than the one they are set to (correctly so). */
const WALLET_NETWORK_MISMATCH =
  /chain ?id\b.*\b(does not|doesn't) match|(network|chain|cluster) mismatch|wrong (network|chain|cluster)/i;

export function errorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (WALLET_NETWORK_MISMATCH.test(message)) {
    return `${message} Your wallet is set to a different Solana network than this site. Switch it to the network shown on this page (wallets list test networks under their developer or testnet settings), then try again.`;
  }
  return message;
}
