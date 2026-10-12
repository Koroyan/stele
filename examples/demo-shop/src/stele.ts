/**
 * Everything this shop does with Stele: the server SDK (sessions and acceptance checks), the REST
 * API (network, documents, single acceptances, receipts) and the independent verifier. Every call to
 * Stele is recorded for the "API log" page.
 */
import { SteleServerClient, type AcceptanceRecord } from "@stelehq/sdk/server";
import { chainFromUrls, verifyAcceptance, type VerificationReport } from "@stelehq/verifier";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Run \`pnpm localnet:demo\` to set up the demo and its .env.`);
    process.exit(1);
  }
  return value;
}

export const APP_URL = required("STELE_APP_URL").replace(/\/$/, "");
export const API_URL = required("STELE_API_URL").replace(/\/$/, "");
export const ORGANIZATION = required("STELE_ORGANIZATION");
/** On-chain address of the organization (passkey signers are scoped to it). */
export const ORGANIZATION_ADDRESS = process.env.STELE_ORGANIZATION_ADDRESS ?? "";
export const WEBHOOK_SECRET = required("STELE_WEBHOOK_SECRET");
const API_KEY = required("STELE_API_KEY");
const RPC_URLS = required("STELE_RPC_URLS").split(",");

export interface ApiCall {
  at: Date;
  method: string;
  path: string;
  status: number | "error";
  ms: number;
  auth: "API key" | "public";
}
export const apiLog: ApiCall[] = [];

/** fetch that records every call to the Stele API. */
const recordingFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );
  const started = performance.now();
  const entry: ApiCall = {
    at: new Date(),
    method: init?.method ?? "GET",
    path: url.pathname.replace(/^\/api/, "") + url.search,
    status: "error",
    ms: 0,
    auth: new Headers(init?.headers).has("authorization") ? "API key" : "public",
  };
  apiLog.unshift(entry);
  apiLog.length = Math.min(apiLog.length, 200);
  try {
    const res = await fetch(input, init);
    entry.status = res.status;
    return res;
  } finally {
    entry.ms = Math.round(performance.now() - started);
  }
};

export const stele = new SteleServerClient({
  apiBaseUrl: API_URL,
  apiKey: API_KEY,
  fetch: recordingFetch,
});

export const DOCUMENTS = [
  { slug: "terms-of-service", title: "Terms of Service" },
  { slug: "privacy-policy", title: "Privacy Policy" },
] as const;

export interface NetworkInfo {
  label: string;
  chainId: string;
  programId: string;
}

/** GET /v1/network (public). */
export async function network(): Promise<NetworkInfo> {
  return (await (await recordingFetch(`${API_URL}/v1/network`)).json()) as NetworkInfo;
}

export interface PublicDocument {
  document: { versionCount: number };
  versions: {
    number: number;
    label: string;
    fingerprint: string;
    acceptanceCount: number;
    publishedAt: string;
  }[];
}

/** GET /v1/public/organizations/{org}/documents/{slug} (public): full version history. */
export async function publicDocument(slug: string): Promise<PublicDocument | null> {
  const res = await recordingFetch(
    `${API_URL}/v1/public/organizations/${encodeURIComponent(ORGANIZATION)}/documents/${slug}`,
  );
  return res.ok ? ((await res.json()) as PublicDocument) : null;
}

/** GET /v1/acceptances/{id} (API key): one of our acceptances, with its receipt URL. */
export async function acceptanceById(id: string): Promise<{
  acceptance: { transactionSignature: string; externalUserRef: string | null };
  receiptUrl: string;
} | null> {
  const res = await recordingFetch(`${API_URL}/v1/acceptances/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${API_KEY}` },
  });
  return res.ok ? ((await res.json()) as never) : null;
}

/** GET /v1/public/acceptances/{id}/receipt (public): the receipt file. */
export async function receipt(id: string): Promise<string | null> {
  const res = await recordingFetch(
    `${API_URL}/v1/public/acceptances/${encodeURIComponent(id)}/receipt`,
  );
  return res.ok
    ? JSON.stringify(((await res.json()) as { receipt: unknown }).receipt, null, 2)
    : null;
}

/** Independent verification: reads Solana directly, trusts no Stele server for the verdict. */
export function verifyIndependently(transactionSignature: string): Promise<VerificationReport> {
  return verifyAcceptance(
    { transactionSignature },
    {
      chain: chainFromUrls(RPC_URLS),
      // Text copies are accepted only if their SHA-256 matches the on-chain commitment.
      content: { mirrors: [`${API_URL}/v1/public/content`], fetchImpl: recordingFetch },
    },
  );
}

export type { AcceptanceRecord };
