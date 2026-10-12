/** Verification report model. */
import type { SignerEvidence, Statement } from "@stelehq/protocol";

export type CheckStatus = "pass" | "fail" | "warn" | "skip" | "error";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  /** Whether a non-pass outcome invalidates the evidence. */
  critical: boolean;
  detail: string;
}

export type Verdict = "VALID" | "VALID_WITH_WARNINGS" | "INVALID" | "INCONCLUSIVE";

export interface VerifiedVersionFacts {
  address: string;
  number: number;
  label: string;
  title: string;
  fingerprint: string;
  contentHash: string;
  previousFingerprint: string | null;
  effectiveAt: number | null;
  publishedAt: number;
  publishedSlot: number;
  publisher: string;
  publisherRole: "owner" | "member";
  storageUri: string;
  publicationTransaction: string | null;
  superseded: boolean;
}

export interface VerifiedFacts {
  network?: { chainId: string; label: string; programId: string; genesisHash: string | null };
  organization?: {
    address: string;
    name: string;
    verifiedDomain: string | null;
    domainExpiresAt: number | null;
    owner: string;
    /**
     * Why the organization is associated with its domain — auditable on-chain evidence, not a
     * database flag: the DomainRecord account the attestor wrote after checking DNS.
     */
    domainAttestation?: {
      record: string;
      attestor: string;
      /** Whether the attestor is the protocol's current domain attestor. */
      currentAttestor: boolean;
      method: "DNS_TXT";
      /** The DNS record anyone can re-check: `_stele.<domain>` TXT `stele-org=<organization>`. */
      dnsName: string;
      dnsValue: string;
      verifiedAt: number;
      expiresAt: number;
      liveDnsChecked: boolean;
    };
  };
  document?: {
    address: string;
    slug: string;
    documentType: string;
    locale: string;
    versionCount: number;
  };
  version?: VerifiedVersionFacts;
  history?: { number: number; fingerprint: string; address: string }[];
  content?: { canonical: string; source: string };
  acceptance?: {
    /** "stele/1": Ed25519 over the message; "stele/2": native passkey (P-256 WebAuthn). */
    protocol: "stele/1" | "stele/2";
    /**
     * DIRECT_ONCHAIN: the program verified the signature in this transaction. MERKLE_BATCHED: the
     * transaction anchors a root; the signature was verified off-chain by this verifier.
     */
    evidenceMode: "DIRECT_ONCHAIN" | "MERKLE_BATCHED";
    acceptanceId: string;
    /** Base58 key (stele/1) or `p256:<hex>` (stele/2). */
    signer: string;
    /**
     * The signed text. stele/1: from the transaction. stele/2: only its hash is on-chain — null when
     * it was neither supplied nor rebuildable from current chain data.
     */
    message: string | null;
    messageHash: string;
    /** Base58 Ed25519 signature (stele/1) or hex compact P-256 signature (stele/2). */
    signature: string;
    issuedAt: number;
    expiresAt: number;
    requestDomain: string;
    nonce: { shardId: number; index: number; tag: string };
    transaction: string;
    slot: number;
    blockTime: number | null;
    commitment: "finalized" | "confirmed";
    /** stele/2: the WebAuthn challenge SHA-256(tag ‖ message) (hex), when the text is known. */
    challenge?: string | null;
    /** stele/2: what the secp256r1 precompile verified (besides the signature). */
    webauthn?: { authenticatorData: string; clientDataJSON: string; rpId: string };
  };
  proof?: {
    proofId: string;
    type: string;
    signer: string;
    message: string;
    messageHash: string;
    signature: string;
    statementHash: string;
    issuedAt: number;
    expiresAt: number;
    requestDomain: string;
    nonce: { shardId: number; index: number; tag: string };
    transaction: string;
    slot: number;
    blockTime: number | null;
    commitment: "finalized" | "confirmed";
  };
  /** The off-chain statement, when supplied and matching the signed hash. */
  statement?: Statement;
  /** How the signing key was controlled (verified evidence only). */
  signer?: {
    type: "WALLET" | "PASSKEY_PROTECTED_STELE_KEY" | "NATIVE_PASSKEY" | "UNSPECIFIED";
    evidence?: SignerEvidence;
    passkey?: { credentialId: string; rpId: string; origin: string; keyRegisteredAt: number };
    /** stele/2: the passkey's own key signed (verified on-chain by the secp256r1 precompile). */
    native?: {
      publicKey: string;
      keyId: string;
      algorithm: "ES256";
      rpId: string;
      origin: string;
      userPresent: true;
      userVerified: true;
      backupEligible: boolean;
      backedUp: boolean;
      signCount: number;
      enrollment: {
        address: string;
        accountCommitment: string;
        generation: number;
        kind: "ENROLLED" | "ROTATED" | "ORGANIZATION_RECOVERY";
        status: "ACTIVE" | "REVOKED";
        currentSigner: string;
      } | null;
    };
  };
  /** MERKLE_BATCHED: the verified inclusion proof (leaf count read from the chain). */
  batch?: { root: string; batchId: string; leafIndex: number; leafCount: number; proof: string[] };
  /**
   * Who vouches for the requesting site. BROWSER_ATTESTED: the browser wrote the origin into
   * WebAuthn client data that the key signed. MERCHANT_CLAIMED: the relaying server wrote the site
   * name into the message (signed, so unalterable afterwards, but not browser-attested).
   */
  origin?: {
    requestDomain: string;
    attestation: "BROWSER_ATTESTED" | "MERCHANT_CLAIMED";
    origin: string | null;
  };
  /** Who paid the network fee (from the transaction itself). */
  fees?: {
    payer: string;
    feeLamports: number | null;
    sponsor: "STELE" | "ORGANIZATION";
    reimbursedLamports: number | null;
    signerPaid: boolean;
  };
}

export interface VerificationReport {
  subject: { kind: "acceptance" | "version" | "proof"; reference: string };
  verdict: Verdict;
  summary: string;
  checks: Check[];
  facts: VerifiedFacts;
  sources: { chain: string; content: { source: string; outcome: string; detail?: string }[] };
  startedAt: string;
  finishedAt: string;
  verifierVersion: string;
}

export const VERIFIER_VERSION = "2.0.0";

export class ReportBuilder {
  readonly checks: Check[] = [];
  readonly facts: VerifiedFacts = {};
  readonly contentAttempts: { source: string; outcome: string; detail?: string }[] = [];
  private readonly startedAt = new Date().toISOString();

  constructor(private readonly subject: VerificationReport["subject"]) {}

  add(
    id: string,
    label: string,
    status: CheckStatus,
    detail: string,
    critical = true,
  ): CheckStatus {
    this.checks.push({ id, label, status, detail, critical });
    return status;
  }

  pass(id: string, label: string, detail: string, critical = true) {
    return this.add(id, label, "pass", detail, critical);
  }
  fail(id: string, label: string, detail: string, critical = true) {
    return this.add(id, label, "fail", detail, critical);
  }
  warn(id: string, label: string, detail: string) {
    return this.add(id, label, "warn", detail, false);
  }
  error(id: string, label: string, detail: string, critical = true) {
    return this.add(id, label, "error", detail, critical);
  }
  skip(id: string, label: string, detail: string, critical = false) {
    return this.add(id, label, "skip", detail, critical);
  }

  /** `cond ? pass : fail` */
  expect(
    cond: boolean,
    id: string,
    label: string,
    ok: string,
    bad: string,
    critical = true,
  ): boolean {
    this.add(id, label, cond ? "pass" : "fail", cond ? ok : bad, critical);
    return cond;
  }

  get failed(): boolean {
    return this.checks.some((c) => c.critical && c.status === "fail");
  }

  build(chain: string): VerificationReport {
    const criticalFail = this.checks.some((c) => c.critical && c.status === "fail");
    const criticalUnknown = this.checks.some(
      (c) => c.critical && (c.status === "error" || c.status === "skip"),
    );
    const warnings = this.checks.some(
      (c) => c.status === "warn" || (!c.critical && (c.status === "fail" || c.status === "error")),
    );
    const verdict: Verdict = criticalFail
      ? "INVALID"
      : criticalUnknown
        ? "INCONCLUSIVE"
        : warnings
          ? "VALID_WITH_WARNINGS"
          : "VALID";
    const summary =
      verdict === "VALID"
        ? "All checks passed. The evidence is consistent with the Solana ledger and the committed content."
        : verdict === "VALID_WITH_WARNINGS"
          ? "All critical checks passed; review the warnings."
          : verdict === "INVALID"
            ? "At least one critical check failed. Do not rely on this evidence."
            : "Verification could not be completed (data unavailable or sources disagree). This is not a pass.";
    return {
      subject: this.subject,
      verdict,
      summary,
      checks: this.checks,
      facts: this.facts,
      sources: { chain, content: this.contentAttempts },
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      verifierVersion: VERIFIER_VERSION,
    };
  }
}
