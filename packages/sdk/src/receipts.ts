/**
 * Receipt helpers for browsers: download a receipt file and build verification links. A receipt is
 * an unsigned convenience bundle; anyone can verify it against Solana (`/verify`, or the
 * `@stelehq/verifier` CLI) without trusting Stele.
 */
import type { SteleClient } from "./client";

/** Saves `stele-receipt-<id>.json` (acceptances) or `stele-proof-<id>.json` (proofs). */
export function downloadJson(filename: string, value: unknown): void {
  downloadBlob(
    filename,
    new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }),
  );
}

/** Saves a file the page already holds (e.g. a PDF receipt fetched by the client). */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Fetches the verified receipt of an acceptance and saves it. */
export async function downloadAcceptanceReceipt(
  client: SteleClient,
  acceptanceId: string,
): Promise<unknown> {
  const { receipt } = await client.getReceipt(acceptanceId);
  downloadJson(`stele-receipt-${acceptanceId.slice(0, 16)}.json`, receipt);
  return receipt;
}

/** Fetches the verified receipt of a proof (needs the request's client token) and saves it. */
export async function downloadProofReceipt(
  client: SteleClient,
  requestId: string,
  token: string,
  proofId: string,
): Promise<unknown> {
  const { receipt } = await client.getProofReceipt(requestId, token);
  downloadJson(`stele-proof-${proofId.slice(0, 16)}.json`, receipt);
  return receipt;
}

/** A link to the public verification page for an acceptance. */
export function verificationLink(appUrl: string, acceptanceId: string): string {
  return `${appUrl.replace(/\/$/, "")}/verify?acceptance=${acceptanceId}`;
}
