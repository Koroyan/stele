/**
 * Minimal typed client for Stele's public REST API. Responses are treated as CLAIMS: the
 * acceptance flow re-verifies everything that matters against Solana before a user signs.
 */
import type { PasskeyAssertion, Statement, WrappedKey } from "@stelehq/protocol";

/**
 * "wallet" (self-custodied Ed25519), "passkey_p256" (native passkey, stele/2 — the passkey's own key
 * signs) or "passkey" (stele/1: an Ed25519 Stele key unlocked by the passkey's PRF; legacy).
 */
export type SignerType = "wallet" | "passkey" | "passkey_p256";
export type SigningPolicy =
  "WALLET_ONLY" | "PASSKEY_ONLY" | "WALLET_OR_PASSKEY" | "ACCOUNT_AND_PASSKEY";

export interface NetworkInfo {
  cluster: string;
  chainId: string;
  label: string;
  walletChain: string;
  programId: string;
  relayer: string;
  hostedAcceptDomain: string;
  publicRpcUrls: string[];
  contentMirror: string;
}

export interface PublicVersion {
  address: string;
  number: number;
  label: string;
  title: string;
  fingerprint: string;
  contentHash: string;
  previousFingerprint: string | null;
  effectiveAt: number | null;
  publishedAt: string;
  publishedSlot: number;
  publisher: string;
  publisherRole: "owner" | "member";
  storageUri: string;
  publishTransaction: string | null;
  acceptanceCount: number;
}

export interface PublicDocument {
  organization: {
    address: string;
    name: string;
    verifiedDomain: string | null;
    domainExpiresAt: string | null;
    frozen: boolean;
    /** How visitors may sign (the API enforces it). Absent on older servers = WALLET_ONLY. */
    signingPolicy?: SigningPolicy;
    requiresSession?: boolean;
  };
  document: {
    address: string;
    slug: string;
    documentType: string;
    locale: string;
    versionCount: number;
    currentVersionAddress: string | null;
  };
  versions: PublicVersion[];
}

export interface Challenge {
  challengeId: string;
  clientBinding: string;
  message: string;
  issuedAt: number;
  expiresAt: number;
  nonce: { shardId: number; index: number; tag: string };
  version: {
    address: string;
    number: number;
    label: string;
    title: string;
    fingerprint: string;
    contentHash: string;
    storageUri: string;
  };
  organization: { address: string; name: string; verifiedDomain: string | null };
  network: { label: string; chainId: string };
  signerType?: SignerType;
  /** "stele/2" for native passkeys (absent on older servers = "stele/1"). */
  protocol?: "stele/1" | "stele/2";
  /**
   * Passkey signers: the WebAuthn challenge (SHA-256 of tag ‖ message) and allowed passkeys. The SDK
   * recomputes the challenge from the message itself and never signs the server's copy blindly.
   */
  passkey?: {
    kind?: "native" | "prf";
    challenge: string;
    rpId: string;
    allowCredentials: string[];
  } | null;
  /** Who will pay the network fee — never the user. */
  feeSponsor?: "stele" | "organization";
}

/** `navigator.credentials.create()` options for a native passkey signer. */
export interface NativeCreationOptions {
  challengeId: string;
  challenge: string;
  rpId: string;
  rpName: string;
  organization: string;
  user: { id: string; name: string; displayName: string };
  /** ES256 only (the secp256r1 precompile's curve). */
  algorithms: number[];
  excludeCredentials: string[];
  accountBound: boolean;
}

/** What the passkey must sign next: its enrollment statement, or (rotation) the current passkey. */
export interface NativeConfirmation {
  challengeId: string;
  challenge: string;
  rpId: string;
  allowCredentials: string[];
  kind: "enroll" | "rotate" | "recover";
  statement: string;
}

export interface NativeConfirmResult {
  identity: string;
  status: "active" | "awaiting_organization";
  enrollment: string | null;
  transactionSignature: string | null;
  recovery: {
    enrollment: string;
    newSigner: string;
    newCredentialIdHash: string;
    rpIdHash: string;
  } | null;
}

export interface FeeInfo {
  payer: string;
  lamports: number;
  sponsor: "stele" | "organization";
  reimbursedLamports: number | null;
}

export interface SubmitResult {
  acceptanceId: string;
  /** Null while a MERKLE_BATCHED acceptance waits for its batch anchor (status "pending_batch"). */
  transactionSignature: string | null;
  slot: number | null;
  status: string;
  /** How the acceptance is anchored (absent on older servers = DIRECT_ONCHAIN). */
  evidenceMode?: "DIRECT_ONCHAIN" | "MERKLE_BATCHED";
  signerType?: SignerType;
  fee?: FeeInfo | null;
  /** Off-chain audit trail recorded with the signature (absent on older servers). */
  audit?: SignerAudit;
}

/**
 * What Stele's server recorded when the signature was submitted. Off-chain and not evidence the
 * verifier checks: the IP address it came from and the browser's time zone.
 */
export interface SignerAudit {
  ip: string | null;
  timeZone: string | null;
  /** Minutes east of UTC (Tbilisi: 240). */
  utcOffsetMinutes: number | null;
}

/** The browser's time zone, sent with each signature for the audit trail. */
function browserTimeZone(): { timeZone?: string; utcOffsetMinutes?: number } {
  try {
    return {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
    };
  } catch {
    return {};
  }
}

export interface CeremonyOptions {
  challengeId: string;
  challenge: string;
  rpId: string;
  rpName: string;
  organization: string;
  chainId: string;
  user: { id: string; name: string; displayName: string };
  excludeCredentials: string[];
}

export interface KeyMaterial {
  identity: string;
  rpId: string;
  status: string;
  credentialId: string;
  prfSalt: string;
  wrappedKey: WrappedKey;
  credentials: { credentialId: string; prfSalt: string }[];
}

export interface ProofRequestView {
  requestId: string;
  status: string;
  type: string;
  statement: Statement;
  statementHash: string;
  lines: string[];
  organization: { address: string; name: string; verifiedDomain: string | null };
  signingPolicy: SigningPolicy;
  expiresAt: string;
  proofId: string | null;
  transactionSignature: string | null;
}

export interface ProofChallenge {
  requestId: string;
  clientBinding: string;
  message: string;
  statementHash: string;
  issuedAt: number;
  expiresAt: number;
  nonce: { shardId: number; index: number; tag: string };
  organization: { address: string; name: string; verifiedDomain: string | null };
  network: { label: string; chainId: string };
  signerType: SignerType;
  passkey: { challenge: string; rpId: string; allowCredentials: string[] } | null;
  feeSponsor: "stele" | "organization";
}

export class SteleApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SteleApiError";
  }
}

export interface SteleClientOptions {
  /** Base URL of the Stele API, e.g. `https://stele.site/api` (no trailing slash). */
  apiBaseUrl: string;
  fetch?: typeof fetch;
}

export class SteleClient {
  readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SteleClientOptions) {
    this.apiBaseUrl = opts.apiBaseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      ...init,
      // Public endpoints need no credentials. Never attach ambient cookies: on Stele's own origin a
      // dashboard session would otherwise turn these into cookie-authenticated (CSRF-checked) calls.
      credentials: "omit",
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
      throw new SteleApiError(
        res.status,
        err?.code ?? "http_error",
        err?.message ?? `HTTP ${res.status}`,
      );
    }
    return body as T;
  }

  getNetwork(): Promise<NetworkInfo> {
    return this.request("/v1/network");
  }

  getPublicDocument(organization: string, slug: string): Promise<PublicDocument> {
    return this.request(
      `/v1/public/organizations/${encodeURIComponent(organization)}/documents/${encodeURIComponent(slug)}`,
    );
  }

  /** Raw content bytes (the caller MUST hash-check them; `loadVerifiedDocument` does). */
  async getContentBytes(contentHash: string): Promise<Uint8Array> {
    const res = await this.fetchImpl(`${this.apiBaseUrl}/v1/public/content/${contentHash}`, {
      credentials: "omit",
    });
    if (!res.ok)
      throw new SteleApiError(res.status, "content_unavailable", "Content is unavailable");
    return new Uint8Array(await res.arrayBuffer());
  }

  createChallenge(input: {
    organization: string;
    document: string;
    signer: string;
    sessionToken?: string;
    signerType?: SignerType;
  }): Promise<Challenge> {
    return this.request("/v1/acceptance/challenges", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  submitChallenge(
    challengeId: string,
    clientBinding: string,
    /** Ed25519 signature (base58); native passkeys send only `passkeyAssertion`. */
    signature: string | undefined,
    passkeyAssertion?: PasskeyAssertion,
  ): Promise<SubmitResult> {
    return this.request(`/v1/acceptance/challenges/${challengeId}/submit`, {
      method: "POST",
      body: JSON.stringify({ clientBinding, signature, passkeyAssertion, ...browserTimeZone() }),
    });
  }

  // ---- passkey-protected signers ----------------------------------------------------------------

  passkeyOptions(input: {
    organization: string;
    purpose: "register" | "add_passkey" | "identify";
    sessionToken?: string;
    identity?: string;
  }): Promise<CeremonyOptions> {
    return this.request("/v1/passkeys/options", { method: "POST", body: JSON.stringify(input) });
  }

  registerPasskey(
    input: Record<string, unknown>,
  ): Promise<{ identity: string; credentialId: string; status: string }> {
    return this.request("/v1/passkeys/register", { method: "POST", body: JSON.stringify(input) });
  }

  identifyPasskey(input: {
    challengeId: string;
    assertion: PasskeyAssertion;
  }): Promise<KeyMaterial> {
    return this.request("/v1/passkeys/identify", { method: "POST", body: JSON.stringify(input) });
  }

  passkeyKeyMaterial(input: { organization: string; credentialId: string }): Promise<KeyMaterial> {
    return this.request("/v1/passkeys/key-material", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  lookupRecoveryKit(input: {
    organization: string;
    kitId: string;
  }): Promise<{ identity: string; rpId: string; wrappedKey: WrappedKey }> {
    return this.request("/v1/passkeys/recovery-kits/lookup", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  // ---- native passkeys (stele/2) ----------------------------------------------------------------

  nativePasskeyOptions(input: {
    organization: string;
    purpose: "register" | "rotate" | "recover";
    sessionToken?: string;
    identity?: string;
  }): Promise<NativeCreationOptions> {
    return this.request("/v1/passkeys/native/options", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  registerNativePasskey(input: {
    challengeId: string;
    credential: Record<string, unknown>;
    label?: string;
  }): Promise<{ identity: string; status: "pending"; confirm: NativeConfirmation }> {
    return this.request("/v1/passkeys/native/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  confirmNativePasskey(input: {
    challengeId: string;
    assertion: PasskeyAssertion;
  }): Promise<NativeConfirmResult> {
    return this.request("/v1/passkeys/native/confirm", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** Names the signer of a discoverable passkey (native or PRF-protected). */
  identifySigner(input: {
    challengeId: string;
    assertion: PasskeyAssertion;
  }): Promise<{ identity: string; credentialId: string; rpId: string; algorithm: string }> {
    return this.request("/v1/passkeys/native/identify", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  // ---- proofs -----------------------------------------------------------------------------------

  getProofRequest(requestId: string, token: string): Promise<ProofRequestView> {
    return this.request(`/v1/proof-requests/${requestId}`, { headers: { "x-proof-token": token } });
  }

  createProofChallenge(
    requestId: string,
    input: { token: string; signer: string; signerType: SignerType },
  ): Promise<ProofChallenge> {
    return this.request(`/v1/proof-requests/${requestId}/challenge`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  submitProof(
    requestId: string,
    input: {
      token: string;
      clientBinding: string;
      signature: string;
      passkeyAssertion?: PasskeyAssertion;
    },
  ): Promise<{ proofId: string; transactionSignature: string; status: string }> {
    return this.request(`/v1/proof-requests/${requestId}/submit`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getProofReceipt(
    requestId: string,
    token: string,
  ): Promise<{ receipt: unknown; report: unknown }> {
    return this.request(`/v1/proof-requests/${requestId}/receipt`, {
      headers: { "x-proof-token": token },
    });
  }

  /** The signer's PDF certificate (any language; the JSON receipt is attached inside). */
  async signerReceiptPdf(access: { challengeId: string; clientBinding: string }): Promise<Blob> {
    const res = await this.fetchImpl(
      `${this.apiBaseUrl}/v1/acceptance/challenges/${access.challengeId}/receipt.pdf`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientBinding: access.clientBinding }),
      },
    );
    if (!res.ok) throw new Error(`The PDF receipt could not be produced (HTTP ${res.status}).`);
    return res.blob();
  }

  getReceipt(acceptanceId: string): Promise<{
    receipt: unknown;
    report: unknown;
    /** The signer's time zone from the audit trail (never the IP), when recorded. */
    signerContext?: { timeZone: string; utcOffsetMinutes: number | null } | null;
  }> {
    return this.request(`/v1/public/acceptances/${acceptanceId}/receipt`);
  }
}
