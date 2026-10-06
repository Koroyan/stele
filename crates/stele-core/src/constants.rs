//! Protocol constants (PROTOCOL_SPEC.md §6.1). Changing any value here changes the protocol.

/// Protocol identifier.
pub const PROTOCOL_ID: &str = "stele/1";
/// Canonicalization identifier.
pub const CANONICALIZATION_ID: &str = "stele-canonical-v1";
/// Content object format identifier.
pub const CONTENT_FORMAT: &str = "stele-content-v1";
/// Version JSON format identifier.
pub const VERSION_FORMAT: &str = "stele-version-v1";
/// Receipt bundle format identifier.
pub const RECEIPT_FORMAT: &str = "stele-receipt-v1";

// ---- Field limits (bytes of UTF-8) -------------------------------------------------------------

pub const MAX_ORG_NAME_LEN: usize = 40;
pub const MAX_VERIFIED_DOMAIN_LEN: usize = 48;
pub const MAX_REQUEST_DOMAIN_LEN: usize = 48;
pub const MAX_TITLE_LEN: usize = 60;
pub const MAX_VERSION_LABEL_LEN: usize = 16;
pub const MAX_SLUG_LEN: usize = 32;
pub const MAX_DOCUMENT_TYPE_LEN: usize = 32;
pub const MAX_LOCALE_LEN: usize = 16;
pub const MAX_STORAGE_URI_LEN: usize = 128;
/// `solana:` + up to 32 base58 characters.
pub const MAX_CHAIN_ID_LEN: usize = 39;
pub const MAX_NETWORK_LABEL_LEN: usize = 16;

// ---- Acceptance --------------------------------------------------------------------------------

/// Nonces per shard (one bit each).
pub const SHARD_CAPACITY: u32 = 65_536;
/// Bitmap size in bytes.
pub const SHARD_BITMAP_BYTES: usize = 8_192;
/// Maximum `expires_at - issued_at`.
pub const MAX_CHALLENGE_TTL: i64 = 3_600;
/// Maximum amount `issued_at` may exceed the cluster clock.
pub const MAX_ISSUED_AT_SKEW: i64 = 300;

// ---- Organization authority --------------------------------------------------------------------

/// Time lock for recovery-initiated owner replacement and for replacing an existing recovery key.
pub const RECOVERY_DELAY: i64 = 259_200;
/// Maximum validity of a domain attestation (400 days).
pub const MAX_DOMAIN_ATTESTATION: i64 = 34_560_000;
/// Maximum distance of an effective date into the future (5 years).
pub const MAX_EFFECTIVE_AT_HORIZON: i64 = 157_680_000;

pub const ROLE_ADMIN: u8 = 0x01;
pub const ROLE_PUBLISHER: u8 = 0x02;
pub const ROLE_MASK: u8 = ROLE_ADMIN | ROLE_PUBLISHER;

pub const PUBLISHER_ROLE_OWNER: u8 = 1;
pub const PUBLISHER_ROLE_MEMBER: u8 = 2;

pub const FROZEN_BY_NONE: u8 = 0;
pub const FROZEN_BY_OWNER: u8 = 1;
pub const FROZEN_BY_RECOVERY: u8 = 2;

pub const DOMAIN_METHOD_DNS_TXT: u8 = 1;

// ---- Time --------------------------------------------------------------------------------------

/// 9999-12-31T23:59:59Z — largest timestamp representable with a 4-digit year.
pub const MAX_RFC3339_TIMESTAMP: i64 = 253_402_300_799;

// ---- Domain separation tags --------------------------------------------------------------------

pub const ACCEPTANCE_ID_TAG: &[u8] = b"stele:v1:acceptance\x00";
pub const ACCUMULATOR_TAG: &[u8] = b"stele:v1:accumulator\x00";

// ---- Acceptance message (PROTOCOL_SPEC.md §7.1) -----------------------------------------------

pub const MESSAGE_HEADER: &str = "Stele Protocol v1 - Accept Agreement";
pub const MESSAGE_STATEMENT: &str = "I accept the exact document version below.";
pub const REQUESTED_BY_PREFIX: &str = "Requested by: ";

// ---- Proofs (PROTOCOL_SPEC.md §12) -------------------------------------------------------------

/// Proof receipt bundle format identifier.
pub const PROOF_RECEIPT_FORMAT: &str = "stele-proof-v1";
/// Off-chain statement format identifier.
pub const STATEMENT_FORMAT: &str = "stele-statement-v1";
pub const PROOF_HEADER: &str = "Stele Protocol v1 - Record Proof";
pub const PROOF_STATEMENT_LINE: &str = "I confirm the statement identified below.";
pub const PROOF_ID_TAG: &[u8] = b"stele:v1:proof\x00";

// ---- Fee sponsorship (PROTOCOL_SPEC.md §13) ----------------------------------------------------

/// Base fee per signature charged by the runtime.
pub const LAMPORTS_PER_SIGNATURE: u64 = 5_000;
pub const MICRO_LAMPORTS_PER_LAMPORT: u64 = 1_000_000;
/// Upper bound an organization may set for the reimbursement of a single recording.
pub const MAX_SPONSOR_FEE_PER_RECORD: u64 = 5_000_000;
