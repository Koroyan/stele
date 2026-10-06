/**
 * Server-side helpers (Node 18+): webhook signature verification and an API-key client for
 * acceptance sessions, acceptance queries, proof requests and walletless signers. Never expose API
 * keys to browsers.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProofTypeName } from "@stele/protocol";

export interface WebhookEvent<T = Record<string, unknown>> {
  id: string;
  type: string;
  createdAt: string;
  organizationId: string;
  data: T;
}

export class WebhookVerificationError extends Error {}

/**
 * Verifies `Stele-Signature: t=<ts>,v1=<hex>` over the RAW request body and returns the parsed
 * event. Rejects signatures older than `toleranceSeconds` (replay protection).
 */
export function verifyWebhook<T = Record<string, unknown>>(
  secret: string,
  signatureHeader: string | undefined,
  rawBody: string | Buffer,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000),
): WebhookEvent<T> {
  if (!signatureHeader) throw new WebhookVerificationError("missing Stele-Signature header");
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.trim().split("=", 2) as [string, string]),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1))
    throw new WebhookVerificationError("malformed signature header");
  if (Math.abs(now - t) > toleranceSeconds)
    throw new WebhookVerificationError("signature timestamp outside tolerance");
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const given = Buffer.from(v1, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw new WebhookVerificationError("invalid signature");
  return JSON.parse(body) as WebhookEvent<T>;
}

export interface AcceptanceRecord {
  acceptanceId: string;
  transactionSignature: string;
  slot: number;
  blockTime: string | null;
  signer: string;
  signerType: "wallet" | "passkey";
  versionAddress: string;
  versionNumber: number;
  requestDomain: string;
  externalUserRef: string | null;
  commitment: "confirmed" | "finalized";
  documentSlug: string;
  feePayer: string | null;
  feeLamports: number | null;
  reimbursedLamports: number | null;
}

/** A proof recorded for your organization (from `listProofs`). */
export interface ProofRecord {
  proofId: string;
  type: ProofTypeName;
  reference: string | null;
  statementHash: string;
  signer: string;
  signerType: "wallet" | "passkey";
  transactionSignature: string;
  slot: number;
  blockTime: string | null;
  externalUserRef: string | null;
  feePayer: string | null;
  feeLamports: number | null;
  reimbursedLamports: number | null;
}

/** A walletless (passkey-protected) signer of your organization. */
export interface SignerRecord {
  publicKey: string;
  rpId: string;
  externalUserRef: string | null;
  status: "active" | "rotated" | "revoked";
  createdAt: string;
  rotation: { kind: "endorsed" | "account_authorized"; previous: string | null } | null;
  passkeys: {
    credentialId: string;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
    backedUp: boolean;
  }[];
  recoveryKits: {
    kitId: string;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
  }[];
}

function searchParams(params: Record<string, string | number | undefined>): URLSearchParams {
  return new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
}

export class SteleServerClient {
  private readonly base: string;
  constructor(private readonly opts: { apiBaseUrl: string; apiKey: string; fetch?: typeof fetch }) {
    this.base = opts.apiBaseUrl.replace(/\/$/, "");
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const f = this.opts.fetch ?? fetch;
    const res = await f(`${this.base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.opts.apiKey}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    const body = (await res.json()) as T & { error?: { message: string } };
    if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
    return body;
  }

  /** Short-lived token binding an acceptance to your user ID (kept off-chain). */
  createAcceptanceSession(input: {
    document?: string;
    externalUserRef?: string;
    ttlSeconds?: number;
  }) {
    return this.call<{ sessionToken: string; expiresAt: string }>("/v1/acceptance-sessions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  latestVersion(slug: string) {
    return this.call<{
      organization: string;
      document: string;
      version: {
        address: string;
        number: number;
        label: string;
        title: string;
        fingerprint: string;
        effectiveAt: number | null;
      };
    }>(`/v1/documents/by-slug/${encodeURIComponent(slug)}/latest`);
  }

  /**
   * Your acceptances, newest first. Pass `nextCursor` back as `cursor` for the next page; it is
   * `null` on the last page.
   */
  listAcceptances(
    query: {
      externalUserRef?: string;
      /** Document address. */
      document?: string;
      /** Version address. */
      version?: string;
      signer?: string;
      /** ISO 8601 date-times bounding the block time. */
      from?: string;
      to?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ) {
    return this.call<{ acceptances: AcceptanceRecord[]; nextCursor: string | null }>(
      `/v1/acceptances?${searchParams(query)}`,
    );
  }

  /** One of your acceptances (404 for other organizations' acceptances). */
  getAcceptance(acceptanceId: string) {
    return this.call<{ acceptance: AcceptanceRecord; receiptUrl: string }>(
      `/v1/acceptances/${encodeURIComponent(acceptanceId)}`,
    );
  }

  // ---- proofs (purchases, refunds, consents…) ----------------------------------------------------

  /**
   * Creates a statement for your customer to confirm. Send `requestId` and `clientToken` to the
   * customer's browser (`Stele.mountProof`, or the hosted `confirmUrl`); keep the API key here.
   */
  createProofRequest(input: {
    type: ProofTypeName;
    reference: string;
    summary: string;
    details: Record<string, unknown>;
    policies?: { title: string; version: number; fingerprint: string; acceptanceId?: string }[];
    relatesTo?: string;
    externalUserRef?: string;
    ttlSeconds?: number;
  }) {
    return this.call<{
      requestId: string;
      clientToken: string;
      statement: Record<string, unknown>;
      statementHash: string;
      expiresAt: string;
      confirmUrl: string;
    }>("/v1/proof-requests", { method: "POST", body: JSON.stringify(input) });
  }

  /** Your proofs, newest first; paged like `listAcceptances`. */
  listProofs(
    query: {
      type?: ProofTypeName;
      reference?: string;
      externalUserRef?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ) {
    return this.call<{ proofs: ProofRecord[]; nextCursor: string | null }>(
      `/v1/proofs?${searchParams(query)}`,
    );
  }

  /** A verified `stele-proof-v1` receipt (includes the statement — keep it as private as the order). */
  getProofReceipt(proofId: string) {
    return this.call<{ receipt: Record<string, unknown>; report: Record<string, unknown> }>(
      `/v1/proofs/${proofId}/receipt`,
    );
  }

  // ---- walletless signers ---------------------------------------------------------------------

  listSigners(externalUserRef?: string) {
    const qs = externalUserRef ? `?externalUserRef=${encodeURIComponent(externalUserRef)}` : "";
    return this.call<{ signers: SignerRecord[] }>(`/v1/signer-identities${qs}`);
  }

  /**
   * Last resort when a customer lost every passkey and recovery kit: retires their signing key
   * (after you verified them through your own account recovery). Their next registration is a NEW
   * key, recorded as authorized by your account system — never control of the old key.
   */
  revokeSigner(publicKey: string, reason: string) {
    return this.call<{ identity: string; status: "revoked" }>(
      `/v1/signer-identities/${publicKey}/revoke`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  }

  /** Whether `externalUserRef` has accepted the CURRENT version of the document. */
  async hasAcceptedLatest(externalUserRef: string, slug: string): Promise<AcceptanceRecord | null> {
    const latest = await this.latestVersion(slug);
    const { acceptances } = await this.listAcceptances({
      externalUserRef,
      version: latest.version.address,
      limit: 1,
    });
    return acceptances[0] ?? null;
  }
}
