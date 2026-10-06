//! Events (`Program data:` logs). Indexing convenience only — verifiers derive facts from
//! instruction data and accounts (PROTOCOL_SPEC.md §9).

use anchor_lang::prelude::*;

#[event]
pub struct ProtocolInitialized {
    pub admin: Pubkey,
    pub domain_attestor: Pubkey,
    pub chain_id: String,
    pub network_label: String,
}

#[event]
pub struct ProtocolPauseChanged {
    pub paused: bool,
    pub admin: Pubkey,
}

#[event]
pub struct DomainAttestorChanged {
    pub previous: Pubkey,
    pub attestor: Pubkey,
}

#[event]
pub struct ProtocolAdminProposed {
    pub admin: Pubkey,
    pub proposed: Pubkey,
}

#[event]
pub struct ProtocolAdminChanged {
    pub previous: Pubkey,
    pub admin: Pubkey,
}

#[event]
pub struct OrganizationCreated {
    pub organization: Pubkey,
    pub creator: Pubkey,
    pub owner: Pubkey,
    pub recovery: Pubkey,
    pub name: String,
    pub timestamp: i64,
}

#[event]
pub struct OrganizationRenamed {
    pub organization: Pubkey,
    pub name: String,
    pub timestamp: i64,
}

/// `kind`: 1 owner proposed, 2 ownership accepted, 3 owner transfer cancelled,
/// 4 recovery change proposed, 5 recovery changed, 6 recovery change cancelled,
/// 7 owner recovery initiated, 8 owner recovery cancelled, 9 owner recovery executed.
#[event]
pub struct AuthorityChanged {
    pub organization: Pubkey,
    pub kind: u8,
    pub actor: Pubkey,
    pub subject: Pubkey,
    pub eta: i64,
    pub timestamp: i64,
}

#[event]
pub struct OrganizationFreezeChanged {
    pub organization: Pubkey,
    pub frozen: bool,
    pub frozen_by: u8,
    pub actor: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MemberChanged {
    pub organization: Pubkey,
    pub member: Pubkey,
    pub roles: u8,
    pub revoked: bool,
    pub actor: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct KeyCompromiseReported {
    pub organization: Pubkey,
    pub member: Pubkey,
    pub compromised_since: i64,
    pub reported_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct DomainAttested {
    pub organization: Pubkey,
    pub domain: String,
    pub attestor: Pubkey,
    pub verified_at: i64,
    pub expires_at: i64,
}

#[event]
pub struct DomainRevoked {
    pub organization: Pubkey,
    pub domain: String,
    pub actor: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct DocumentCreated {
    pub organization: Pubkey,
    pub document: Pubkey,
    pub slug: String,
    pub document_type: String,
    pub locale: String,
    pub created_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct VersionPublished {
    pub organization: Pubkey,
    pub document: Pubkey,
    pub version_account: Pubkey,
    pub publisher: Pubkey,
    pub version_hash: [u8; 32],
    pub content_hash: [u8; 32],
    pub previous_version_hash: [u8; 32],
    pub effective_at: i64,
    pub published_at: i64,
    pub slot: u64,
    pub version: u32,
    pub publisher_role: u8,
}

#[event]
pub struct NonceShardChanged {
    pub organization: Pubkey,
    pub nonce_shard: Pubkey,
    pub shard_id: u16,
    pub relayer: Pubkey,
    pub created: bool,
    pub actor: Pubkey,
}

#[event]
pub struct AcceptanceRecorded {
    pub organization: Pubkey,
    pub document: Pubkey,
    pub version: Pubkey,
    pub signer: Pubkey,
    pub nonce_shard: Pubkey,
    pub acceptance_id: [u8; 32],
    pub message_hash: [u8; 32],
    pub accumulator: [u8; 32],
    pub issued_at: i64,
    pub expires_at: i64,
    pub recorded_at: i64,
    pub slot: u64,
    pub sequence: u64,
    pub nonce_index: u32,
    pub shard_id: u16,
}

#[event]
pub struct SponsorshipChanged {
    pub organization: Pubkey,
    pub nonce_shard: Pubkey,
    pub shard_id: u16,
    pub max_fee_per_record: u64,
    pub daily_limit: u64,
    pub paused: bool,
    pub created: bool,
    pub actor: Pubkey,
}

#[event]
pub struct SponsorWithdrawal {
    pub organization: Pubkey,
    pub nonce_shard: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub remaining: u64,
    pub actor: Pubkey,
}

/// Emitted after `AcceptanceRecorded` / `ProofRecorded` when the sponsored shard paid the fee.
#[event]
pub struct SponsorReimbursed {
    pub organization: Pubkey,
    pub nonce_shard: Pubkey,
    pub relayer: Pubkey,
    /// `acceptance_id` or `proof_id` of the recording whose fee was reimbursed.
    pub record_id: [u8; 32],
    pub amount: u64,
    pub fee: u64,
    pub spent_today: u64,
    pub day: i64,
}

#[event]
pub struct ProofRecorded {
    pub organization: Pubkey,
    pub signer: Pubkey,
    pub nonce_shard: Pubkey,
    pub proof_id: [u8; 32],
    pub statement_hash: [u8; 32],
    pub message_hash: [u8; 32],
    pub accumulator: [u8; 32],
    pub issued_at: i64,
    pub expires_at: i64,
    pub recorded_at: i64,
    pub slot: u64,
    pub sequence: u64,
    pub nonce_index: u32,
    pub shard_id: u16,
    pub proof_type: u8,
}

/// A native passkey (WebAuthn ES256) acceptance (stele/2).
#[event]
pub struct PasskeyAcceptanceRecorded {
    pub organization: Pubkey,
    pub document: Pubkey,
    pub version: Pubkey,
    pub signer_key: [u8; 33],
    /// The signer's enrollment, or the default key when the acceptance was made without one.
    pub enrollment: Pubkey,
    pub nonce_shard: Pubkey,
    pub acceptance_id: [u8; 32],
    pub message_hash: [u8; 32],
    pub client_data_hash: [u8; 32],
    pub rp_id_hash: [u8; 32],
    pub accumulator: [u8; 32],
    pub issued_at: i64,
    pub expires_at: i64,
    pub recorded_at: i64,
    pub slot: u64,
    pub sequence: u64,
    pub nonce_index: u32,
    pub shard_id: u16,
    pub authenticator_flags: u8,
}

/// An enrollment was created, rotated, recovered or revoked.
#[event]
pub struct PasskeySignerChanged {
    pub organization: Pubkey,
    pub enrollment: Pubkey,
    pub account_commitment: [u8; 32],
    pub signer_key: [u8; 33],
    pub previous_key: [u8; 33],
    pub rp_id_hash: [u8; 32],
    pub credential_id_hash: [u8; 32],
    /// The relayer (enrollment, rotation) or the organization authority (recovery, revocation).
    pub actor: Pubkey,
    pub changed_at: i64,
    pub slot: u64,
    pub generation: u32,
    pub kind: u8,
    pub status: u8,
}

/// A Merkle root of off-chain-verified acceptances was anchored (`MERKLE_BATCHED` mode). The
/// program verified no user signature for it; see PROTOCOL_SPEC.md §17.9.
#[event]
pub struct AcceptanceBatchAnchored {
    pub organization: Pubkey,
    pub nonce_shard: Pubkey,
    pub batch_root: [u8; 32],
    pub batch_id: [u8; 32],
    pub accumulator: [u8; 32],
    pub anchored_at: i64,
    pub slot: u64,
    /// The shard's recorded count after this batch.
    pub sequence: u64,
    pub leaf_count: u32,
    pub shard_id: u16,
}

/// Stele Gate: an access pass was created or advanced by a verified acceptance
/// (`record_gated_acceptance`). The acceptance itself is the `AcceptanceRecorded` event of the same
/// instruction.
#[event]
pub struct AccessPassUpdated {
    pub organization: Pubkey,
    pub document: Pubkey,
    pub holder: Pubkey,
    pub access_pass: Pubkey,
    pub version: Pubkey,
    pub acceptance_id: [u8; 32],
    pub accepted_at: i64,
    pub slot: u64,
    pub version_number: u32,
    pub acceptance_count: u32,
    /// True when this acceptance created the pass.
    pub created: bool,
}
