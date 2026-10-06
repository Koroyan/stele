//! Account types. Layouts are normative (PROTOCOL_SPEC.md §6.2): fixed-size fields first, strings
//! last, so off-chain filters (`memcmp`) have stable offsets. Never reorder fields.

use anchor_lang::prelude::*;
use stele_core::constants::{
    FROZEN_BY_RECOVERY, MAX_CHAIN_ID_LEN, MAX_DOCUMENT_TYPE_LEN, MAX_LOCALE_LEN,
    MAX_NETWORK_LABEL_LEN, MAX_ORG_NAME_LEN, MAX_SLUG_LEN, MAX_STORAGE_URI_LEN, MAX_TITLE_LEN,
    MAX_VERIFIED_DOMAIN_LEN, MAX_VERSION_LABEL_LEN, SHARD_BITMAP_BYTES,
};

/// Global protocol configuration. `chain_id` and `network_label` are immutable after
/// initialization — they domain-separate every fingerprint and acceptance message.
#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub domain_attestor: Pubkey,
    pub paused: bool,
    pub bump: u8,
    #[max_len(MAX_CHAIN_ID_LEN)]
    pub chain_id: String,
    #[max_len(MAX_NETWORK_LABEL_LEN)]
    pub network_label: String,
}

/// An organization. Its address is derived from the creator and a 32-byte seed so nobody can
/// front-run creation at an address someone else intends to use. Never closed.
#[account]
#[derive(InitSpace)]
pub struct Organization {
    pub creator: Pubkey,
    pub seed: [u8; 32],
    pub owner: Pubkey,
    pub pending_owner: Pubkey,
    pub recovery: Pubkey,
    pub pending_recovery: Pubkey,
    pub pending_recovery_eta: i64,
    pub recovery_target_owner: Pubkey,
    pub recovery_eta: i64,
    pub domain_verified_at: i64,
    pub domain_expires_at: i64,
    pub created_at: i64,
    pub document_count: u32,
    pub member_count: u32,
    pub frozen: bool,
    pub frozen_by: u8,
    pub bump: u8,
    #[max_len(MAX_ORG_NAME_LEN)]
    pub name: String,
    #[max_len(MAX_VERIFIED_DOMAIN_LEN)]
    pub verified_domain: String,
}

impl Organization {
    pub fn has_recovery(&self) -> bool {
        self.recovery != Pubkey::default()
    }

    pub fn is_owner(&self, key: &Pubkey) -> bool {
        self.owner == *key
    }

    pub fn is_recovery(&self, key: &Pubkey) -> bool {
        self.has_recovery() && self.recovery == *key
    }

    /// Frozen by the recovery authority: owner powers are suspended.
    pub fn is_recovery_locked(&self) -> bool {
        self.frozen && self.frozen_by == FROZEN_BY_RECOVERY
    }

    /// The verified domain if present and unexpired at `now`.
    pub fn verified_domain_at(&self, now: i64) -> Option<&str> {
        if !self.verified_domain.is_empty() && now < self.domain_expires_at {
            Some(self.verified_domain.as_str())
        } else {
            None
        }
    }
}

/// An organization member. Revocation and compromise are timestamps; records are never deleted.
#[account]
#[derive(InitSpace)]
pub struct Member {
    pub organization: Pubkey,
    pub member: Pubkey,
    pub added_by: Pubkey,
    pub added_at: i64,
    pub updated_at: i64,
    pub revoked_at: i64,
    pub compromised_since: i64,
    pub compromise_reported_at: i64,
    pub roles: u8,
    pub bump: u8,
}

impl Member {
    pub fn is_active(&self) -> bool {
        self.revoked_at == 0
    }
}

/// Current-state pointer from a verified domain to its organization. Unique per domain. Closed on
/// revocation; the attestation history remains in the ledger.
#[account]
#[derive(InitSpace)]
pub struct DomainRecord {
    pub organization: Pubkey,
    pub attestor: Pubkey,
    pub rent_payer: Pubkey,
    pub domain_hash: [u8; 32],
    pub verified_at: i64,
    pub expires_at: i64,
    pub method: u8,
    pub bump: u8,
    #[max_len(MAX_VERIFIED_DOMAIN_LEN)]
    pub domain: String,
}

/// A document series (e.g. "terms-of-service" in "en-US"). Its type and locale are immutable;
/// only the head pointer advances on publication. Never closed.
#[account]
#[derive(InitSpace)]
pub struct Document {
    pub organization: Pubkey,
    pub created_by: Pubkey,
    pub head_hash: [u8; 32],
    pub current_version: Pubkey,
    pub created_at: i64,
    pub last_published_at: i64,
    pub version_count: u32,
    pub bump: u8,
    #[max_len(MAX_SLUG_LEN)]
    pub slug: String,
    #[max_len(MAX_DOCUMENT_TYPE_LEN)]
    pub document_type: String,
    #[max_len(MAX_LOCALE_LEN)]
    pub locale: String,
}

/// An immutable published version. There is no instruction that modifies or closes it.
#[account]
#[derive(InitSpace)]
pub struct DocumentVersion {
    pub document: Pubkey,
    pub organization: Pubkey,
    pub version_hash: [u8; 32],
    pub content_hash: [u8; 32],
    pub previous_version_hash: [u8; 32],
    pub publisher: Pubkey,
    pub effective_at: i64,
    pub published_at: i64,
    pub published_slot: u64,
    pub version: u32,
    pub publisher_role: u8,
    pub bump: u8,
    #[max_len(MAX_TITLE_LEN)]
    pub title: String,
    #[max_len(MAX_VERSION_LABEL_LEN)]
    pub version_label: String,
    #[max_len(MAX_STORAGE_URI_LEN)]
    pub storage_uri: String,
}

/// Per-organization replay-protection bitmap and acceptance accumulator (zero-copy, 8,320 bytes
/// including the discriminator). Nonce `i` is bit `i % 8` (LSB first) of `bitmap[i / 8]`.
#[account(zero_copy)]
pub struct NonceShard {
    pub organization: Pubkey,
    /// Only this key may record acceptances against the shard; the zero key means "any signer".
    pub relayer: Pubkey,
    pub accumulator: [u8; 32],
    pub accepted_count: u64,
    pub created_at: i64,
    pub shard_id: u16,
    pub bump: u8,
    pub reserved: [u8; 5],
    pub bitmap: [u8; SHARD_BITMAP_BYTES],
}

impl NonceShard {
    /// Size of the account data including the 8-byte discriminator.
    pub const ACCOUNT_SIZE: usize = 8 + core::mem::size_of::<NonceShard>();
}

const _: () = assert!(core::mem::size_of::<NonceShard>() == 8_312);

/// Fee-sponsorship trailer appended to a [`NonceShard`] account (PROTOCOL_SPEC.md §13): the
/// shard's own address is the deposit address, its lamports above the rent-exempt minimum are the
/// balance. Read and written by copy (the trailer is not necessarily 8-byte aligned in memory).
/// Absent (account size 8,320) when the organization has not enabled sponsorship on the shard.
#[zero_copy]
pub struct ShardSponsorship {
    pub magic: [u8; 8],
    pub created_by: Pubkey,
    /// Cap on the reimbursement of a single recording, in lamports.
    pub max_fee_per_record: u64,
    /// Cap on reimbursements per UTC day, in lamports.
    pub daily_limit: u64,
    /// UTC day number (`unix_timestamp / 86400`) that `spent_today` refers to.
    pub current_day: i64,
    pub spent_today: u64,
    pub total_reimbursed: u64,
    pub reimbursed_count: u64,
    pub total_withdrawn: u64,
    pub created_at: i64,
    pub updated_at: i64,
    pub paused: u8,
    pub reserved: [u8; 7],
}

impl ShardSponsorship {
    pub const MAGIC: [u8; 8] = *b"stelesp1";
    /// Account size of a shard with sponsorship enabled.
    pub const SPONSORED_ACCOUNT_SIZE: usize =
        NonceShard::ACCOUNT_SIZE + core::mem::size_of::<ShardSponsorship>();
}

const _: () = assert!(core::mem::size_of::<ShardSponsorship>() == 120);

pub const PASSKEY_STATUS_ACTIVE: u8 = 1;
pub const PASSKEY_STATUS_REVOKED: u8 = 2;

/// Enrolled by the passkey itself (it signed the enrollment statement).
pub const PASSKEY_KIND_ENROLLED: u8 = 1;
/// Replaced by the previous key's signature over a rotation statement.
pub const PASSKEY_KIND_ROTATED: u8 = 2;
/// Replaced by the organization (owner or admin) without the previous key: visibly different, and
/// never a continuation of the previous key's authority.
pub const PASSKEY_KIND_ORGANIZATION_RECOVERY: u8 = 3;

/// The current passkey signer of one account of an organization (PROTOCOL_SPEC.md §17.5). The
/// account is identified only by a salted commitment, never by personal data. One enrollment per
/// (organization, commitment): replacing its key needs the old key's signature (rotation) or the
/// organization's own authority (recovery), and every change is an event. Never closed.
#[account]
#[derive(InitSpace)]
pub struct PasskeySigner {
    pub organization: Pubkey,
    pub account_commitment: [u8; 32],
    /// Compressed SEC1 P-256 public key of the current signer.
    pub signer_key: [u8; 33],
    /// The key this one replaced (zero for the first enrollment).
    pub previous_key: [u8; 33],
    /// SHA-256 of the WebAuthn relying-party ID the key is scoped to.
    pub rp_id_hash: [u8; 32],
    /// SHA-256 of the WebAuthn credential ID (informational; assertions do not sign it).
    pub credential_id_hash: [u8; 32],
    pub enrolled_at: i64,
    pub updated_at: i64,
    pub generation: u32,
    pub status: u8,
    pub kind: u8,
    pub bump: u8,
}

/// Stele Gate: the latest acceptance of one policy document by one wallet (PROTOCOL_SPEC.md §18).
/// Only `record_gated_acceptance` writes it, after verifying the holder's signature over the
/// document's then-current version, so its contents are as trustworthy as the acceptance itself.
/// A pass satisfies a "current version" requirement only while `version` is still the document's
/// `current_version`: publishing a new version makes every older pass outdated without touching it.
/// The acceptance evidence for older versions stays in the ledger. Never closed.
#[account]
#[derive(InitSpace)]
pub struct AccessPass {
    pub organization: Pubkey,
    pub document: Pubkey,
    /// The wallet whose Ed25519 signature recorded the acceptance.
    pub holder: Pubkey,
    /// The `DocumentVersion` most recently accepted.
    pub version: Pubkey,
    pub acceptance_id: [u8; 32],
    pub accepted_at: i64,
    pub first_accepted_at: i64,
    pub accepted_slot: u64,
    pub version_number: u32,
    pub acceptance_count: u32,
    pub bump: u8,
}
