/**
 * Protocol constants (PROTOCOL_SPEC.md §6.1). These mirror `crates/stele-core/src/constants.rs`
 * exactly; changing any value changes the protocol.
 */

export const PROTOCOL_ID = "stele/1";
export const CANONICALIZATION_ID = "stele-canonical-v1";
export const CONTENT_FORMAT = "stele-content-v1";
export const VERSION_FORMAT = "stele-version-v1";
export const RECEIPT_FORMAT = "stele-receipt-v1";
/** Receipts of stele/2 (native passkey) acceptances (PROTOCOL_SPEC.md §17.6). */
export const RECEIPT_V2_FORMAT = "stele-receipt/2";

/** Default program address (local/devnet deployment). Override per environment. */
export const DEFAULT_PROGRAM_ADDRESS = "6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV";

export const LIMITS = {
  orgName: 40,
  verifiedDomain: 48,
  requestDomain: 48,
  title: 60,
  versionLabel: 16,
  slug: 32,
  documentType: 32,
  locale: 16,
  storageUri: 128,
  chainId: 39,
  networkLabel: 16,
} as const;

export const SHARD_CAPACITY = 65_536;
export const SHARD_BITMAP_BYTES = 8_192;
/** Account data size of a NonceShard including the 8-byte discriminator. */
export const NONCE_SHARD_ACCOUNT_SIZE = 8_320;
export const MAX_CHALLENGE_TTL = 3_600;
export const DEFAULT_CHALLENGE_TTL = 600;
export const MAX_ISSUED_AT_SKEW = 300;
export const RECOVERY_DELAY = 259_200;
export const MAX_DOMAIN_ATTESTATION = 34_560_000;
export const MAX_EFFECTIVE_AT_HORIZON = 157_680_000;
export const MAX_RFC3339_TIMESTAMP = 253_402_300_799;

export const ROLE_ADMIN = 0x01;
export const ROLE_PUBLISHER = 0x02;
export const ROLE_MASK = ROLE_ADMIN | ROLE_PUBLISHER;

export const PUBLISHER_ROLE_OWNER = 1;
export const PUBLISHER_ROLE_MEMBER = 2;

export const FROZEN_BY_NONE = 0;
export const FROZEN_BY_OWNER = 1;
export const FROZEN_BY_RECOVERY = 2;

export const DOMAIN_METHOD_DNS_TXT = 1;

export const ACCEPTANCE_ID_TAG = "stele:v1:acceptance\u0000";
export const ACCUMULATOR_TAG = "stele:v1:accumulator\u0000";

export const MESSAGE_HEADER = "Stele Protocol v1 - Accept Agreement";
export const MESSAGE_STATEMENT = "I accept the exact document version below.";
export const REQUESTED_BY_PREFIX = "Requested by: ";

// ---- Proofs (PROTOCOL_SPEC.md §12) ---------------------------------------------------------------

export const PROOF_RECEIPT_FORMAT = "stele-proof-v1";
export const STATEMENT_FORMAT = "stele-statement-v1";
export const PROOF_HEADER = "Stele Protocol v1 - Record Proof";
export const PROOF_STATEMENT_LINE = "I confirm the statement identified below.";
export const PROOF_ID_TAG = "stele:v1:proof\u0000";

// ---- Fee sponsorship (PROTOCOL_SPEC.md §13) ------------------------------------------------------

export const LAMPORTS_PER_SIGNATURE = 5_000;
export const MICRO_LAMPORTS_PER_LAMPORT = 1_000_000;
export const MAX_SPONSOR_FEE_PER_RECORD = 5_000_000;
/** Signatures a sponsored recording pays for: the relayer's and the verified user signature. */
export const SPONSORED_SIGNATURES = 2;

// ---- Passkey-protected signing keys (PROTOCOL_SPEC.md §14) ----------------------------------------

/** WebAuthn challenge for signing a Stele message: `SHA-256(tag || message)`. */
export const PASSKEY_SIGNATURE_TAG = "stele:v1:passkey-signature\u0000";
/** WebAuthn challenge endorsing a key statement (registration, added passkey, rotation). */
export const PASSKEY_STATEMENT_TAG = "stele:v1:passkey-statement\u0000";
/** HKDF info for the key that wraps a signing key under a passkey's PRF output. */
export const PASSKEY_WRAP_INFO = "stele:v1:passkey-wrap\u0000";
/** HKDF info for the key that wraps a signing key under a recovery kit. */
export const RECOVERY_WRAP_INFO = "stele:v1:recovery-wrap\u0000";
export const WRAPPED_KEY_FORMAT = "stele-wrapped-key-v1";

/** Compute-unit limit requested for acceptance transactions (measured ≈ 30k CU; 33k sponsored). */
export const ACCEPTANCE_COMPUTE_UNIT_LIMIT = 60_000;
/** Compute-unit limit requested for proof transactions (measured ≈ 37k CU). */
export const PROOF_COMPUTE_UNIT_LIMIT = 60_000;
/** Solana packet size limit for a serialized transaction. */
export const MAX_TRANSACTION_SIZE = 1_232;

/** Registered document types (PROTOCOL_SPEC.md §3.5). */
export const DOCUMENT_TYPES = [
  "terms-of-service",
  "privacy-policy",
  "cookie-policy",
  "acceptable-use-policy",
  "data-processing-agreement",
  "end-user-license-agreement",
  "service-level-agreement",
  "disclaimer",
  "contract",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  "terms-of-service": "Terms of Service",
  "privacy-policy": "Privacy Policy",
  "cookie-policy": "Cookie Policy",
  "acceptable-use-policy": "Acceptable Use Policy",
  "data-processing-agreement": "Data Processing Agreement",
  "end-user-license-agreement": "End-User License Agreement",
  "service-level-agreement": "Service Level Agreement",
  disclaimer: "Disclaimer",
  contract: "Contract",
  other: "Other",
};
