//! `record_acceptance` — on-chain verification and recording of a user's signed acceptance
//! (PROTOCOL_SPEC.md §7–§8).
//!
//! Nothing about the acceptance is taken on trust from the transaction submitter:
//! * the signer, signature and message come from the runtime-verified Ed25519 instruction;
//! * every line of the message except the request domain is rebuilt from on-chain state and the
//!   instruction's own arguments, and must match byte-for-byte;
//! * the version must be the document's current version;
//! * the nonce bit is consumed, so the same signed message can never be recorded twice;
//! * the acceptance is folded into the shard accumulator for completeness audits;
//! * if the organization sponsors fees, the sponsored shard reimburses the relayer (never the signer:
//!   fee payment and authorization are separate; the user pays nothing in either model).

use anchor_lang::prelude::*;
use stele_core::acceptance::{acceptance_id, accumulate, bitmap_try_set};
use stele_core::constants::{MAX_CHALLENGE_TTL, MAX_ISSUED_AT_SKEW, SHARD_CAPACITY};
use stele_core::hash::sha256;
use stele_core::message::{
    acceptance_message_prefix, extract_request_domain, AcceptanceMessageFields,
};

use crate::constants::CONFIG_SEED;
use crate::ed25519::load_preceding_ed25519;
use crate::error::SteleError;
use crate::events::AcceptanceRecorded;
use crate::instructions::sponsor::{reimburse, SPONSORED_SIGNATURES};
use crate::state::{Document, DocumentVersion, NonceShard, Organization, ProtocolConfig};

#[derive(Accounts)]
pub struct RecordAcceptance<'info> {
    /// The shard's designated relayer (any signer for open shards). Usually also the fee payer.
    /// Writable so that a sponsored shard can reimburse it.
    #[account(mut)]
    pub relayer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    pub organization: Box<Account<'info, Organization>>,
    #[account(
        constraint = document.organization == organization.key() @ SteleError::DocumentOrganizationMismatch
    )]
    pub document: Box<Account<'info, Document>>,
    #[account(
        constraint = version.organization == organization.key() @ SteleError::VersionOrganizationMismatch,
        constraint = version.document == document.key() @ SteleError::VersionDocumentMismatch
    )]
    pub version: Box<Account<'info, DocumentVersion>>,
    #[account(mut)]
    pub nonce_shard: AccountLoader<'info, NonceShard>,
    /// CHECK: address-constrained to the instructions sysvar; read via checked loaders.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

/// Validity-window rules shared by every signed recording (PROTOCOL_SPEC.md §8 step 2).
pub(crate) fn check_validity_window(now: i64, issued_at: i64, expires_at: i64) -> Result<()> {
    require!(
        issued_at >= 0 && expires_at > issued_at,
        SteleError::InvalidAcceptanceWindow
    );
    let ttl = expires_at
        .checked_sub(issued_at)
        .ok_or(SteleError::ArithmeticOverflow)?;
    require!(
        ttl <= MAX_CHALLENGE_TTL,
        SteleError::InvalidAcceptanceWindow
    );
    let latest_issue = now
        .checked_add(MAX_ISSUED_AT_SKEW)
        .ok_or(SteleError::ArithmeticOverflow)?;
    require!(issued_at <= latest_issue, SteleError::IssuedInFuture);
    require!(now <= expires_at, SteleError::AcceptanceExpired);
    Ok(())
}

pub fn record_acceptance(
    ctx: Context<RecordAcceptance>,
    nonce_index: u32,
    nonce_tag: [u8; 8],
    issued_at: i64,
    expires_at: i64,
) -> Result<()> {
    let a = &ctx.accounts;
    record_signed_acceptance(
        AcceptanceAccounts {
            relayer: &a.relayer,
            config: &a.config,
            organization: &a.organization,
            document: &a.document,
            version: &a.version,
            nonce_shard: &a.nonce_shard,
            instructions_sysvar: &a.instructions_sysvar,
        },
        nonce_index,
        nonce_tag,
        issued_at,
        expires_at,
        Reimburse::Now,
    )?;
    Ok(())
}

/// The accounts every Ed25519-signed acceptance recording reads (shared by `record_acceptance` and
/// `record_gated_acceptance`, which add nothing to the checks below).
pub(crate) struct AcceptanceAccounts<'a, 'info> {
    pub relayer: &'a Signer<'info>,
    pub config: &'a Account<'info, ProtocolConfig>,
    pub organization: &'a Account<'info, Organization>,
    pub document: &'a Account<'info, Document>,
    pub version: &'a Account<'info, DocumentVersion>,
    pub nonce_shard: &'a AccountLoader<'info, NonceShard>,
    pub instructions_sysvar: &'a UncheckedAccount<'info>,
}

/// What a successful recording established.
pub(crate) struct RecordedAcceptance {
    pub acceptance_id: [u8; 32],
    /// The runtime-verified Ed25519 signer of the message.
    pub signer: Pubkey,
    pub recorded_at: i64,
    pub slot: u64,
    /// The shard's designated relayer (for a deferred sponsorship reimbursement).
    pub shard_relayer: Pubkey,
}

/// When the sponsored shard reimburses the relayer.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Reimburse {
    /// Inside `record_signed_acceptance`.
    Now,
    /// By the caller, after its own system-program CPIs: the runtime refuses a CPI that leaves out
    /// an account whose lamports the caller changed (here the shard), so the reimbursement — a
    /// direct lamport move — must come after them.
    Later,
}

/// Verifies and records one signed acceptance (PROTOCOL_SPEC.md §8): every check of
/// `record_acceptance`, the nonce, the accumulator, the event and the sponsorship reimbursement.
pub(crate) fn record_signed_acceptance(
    accounts: AcceptanceAccounts,
    nonce_index: u32,
    nonce_tag: [u8; 8],
    issued_at: i64,
    expires_at: i64,
    when: Reimburse,
) -> Result<RecordedAcceptance> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let config = accounts.config;
    let org = accounts.organization;
    let document = accounts.document;
    let version = accounts.version;

    require!(!config.paused, SteleError::ProtocolPaused);
    require!(!org.frozen, SteleError::OrganizationFrozen);
    require_keys_eq!(
        document.current_version,
        version.key(),
        SteleError::VersionNotCurrent
    );

    // Validity window.
    check_validity_window(now, issued_at, expires_at)?;
    let issued_plus_skew = issued_at
        .checked_add(MAX_ISSUED_AT_SKEW)
        .ok_or(SteleError::ArithmeticOverflow)?;
    require!(
        issued_plus_skew >= version.published_at,
        SteleError::IssuedBeforePublication
    );
    require!(nonce_index < SHARD_CAPACITY, SteleError::NonceOutOfRange);

    // Shard ownership and relayer gating.
    let shard_key = accounts.nonce_shard.key();
    let mut shard = accounts.nonce_shard.load_mut()?;
    require_keys_eq!(
        shard.organization,
        org.key(),
        SteleError::ShardOrganizationMismatch
    );
    if shard.relayer != Pubkey::default() {
        require_keys_eq!(
            shard.relayer,
            accounts.relayer.key(),
            SteleError::UnauthorizedRelayer
        );
    }
    let shard_relayer = shard.relayer;

    // The runtime-verified signature immediately preceding this instruction.
    let verified = load_preceding_ed25519(&accounts.instructions_sysvar.to_account_info())?;

    // Rebuild the message from on-chain state + arguments; compare byte-for-byte.
    let fields = AcceptanceMessageFields {
        org_name: &org.name,
        org_verified_domain: org.verified_domain_at(now),
        title: &version.title,
        version_label: &version.version_label,
        version: version.version,
        version_hash: &version.version_hash,
        signer: &verified.signer,
        network_label: &config.network_label,
        issued_at,
        expires_at,
        shard_id: shard.shard_id,
        nonce_index,
        nonce_tag: &nonce_tag,
    };
    let prefix = acceptance_message_prefix(&fields).map_err(|_| SteleError::InvalidTimestamp)?;
    if !verified.message.starts_with(prefix.as_bytes()) {
        return err!(SteleError::MessageMismatch);
    }
    extract_request_domain(&verified.message, prefix.as_bytes())
        .map_err(|_| SteleError::InvalidRequestDomain)?;

    // Consume the nonce (replay protection).
    require!(
        bitmap_try_set(&mut shard.bitmap, nonce_index),
        SteleError::NonceAlreadyUsed
    );

    // Acceptance identifier and completeness accumulator.
    let message_hash = sha256(&verified.message);
    let version_key = version.key();
    let id = acceptance_id(
        &version_key.to_bytes(),
        &verified.signer,
        &message_hash,
        &verified.signature,
    );
    shard.accumulator = accumulate(&shard.accumulator, &id);
    shard.accepted_count = shard
        .accepted_count
        .checked_add(1)
        .ok_or(SteleError::ArithmeticOverflow)?;

    emit!(AcceptanceRecorded {
        organization: org.key(),
        document: document.key(),
        version: version_key,
        signer: Pubkey::new_from_array(verified.signer),
        nonce_shard: shard_key,
        acceptance_id: id,
        message_hash,
        accumulator: shard.accumulator,
        issued_at,
        expires_at,
        recorded_at: now,
        slot: clock.slot,
        sequence: shard.accepted_count,
        nonce_index,
        shard_id: shard.shard_id,
    });
    drop(shard);

    // Fee sponsorship, if the organization enabled it on this shard (never affects the record).
    if when == Reimburse::Now {
        reimburse(
            &accounts.nonce_shard.to_account_info(),
            &accounts.relayer.to_account_info(),
            &accounts.instructions_sysvar.to_account_info(),
            &shard_relayer,
            id,
            now,
            SPONSORED_SIGNATURES,
        )?;
    }
    Ok(RecordedAcceptance {
        acceptance_id: id,
        signer: Pubkey::new_from_array(verified.signer),
        recorded_at: now,
        slot: clock.slot,
        shard_relayer,
    })
}
