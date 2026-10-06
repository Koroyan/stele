//! `record_proof` — on-chain verification and recording of a signed business statement such as a
//! purchase, refund or consent (PROTOCOL_SPEC.md §12).
//!
//! The guarantees mirror `record_acceptance`:
//! * the signer, signature and message come from the runtime-verified Ed25519 instruction;
//! * every line of the anchor message except the request domain is rebuilt from on-chain state
//!   and the instruction's arguments (including the statement hash) and must match byte-for-byte;
//! * the nonce bit is consumed (acceptances and proofs share the shard's nonce space and
//!   accumulator, so one signed message can never be recorded twice in any form);
//! * if the organization sponsors fees, the sponsored shard reimburses the relayer.
//!
//! The statement itself stays off-chain; only its hash is recorded.

use anchor_lang::prelude::*;
use stele_core::acceptance::{accumulate, bitmap_try_set};
use stele_core::constants::SHARD_CAPACITY;
use stele_core::hash::sha256;
use stele_core::message::extract_request_domain;
use stele_core::proof::{proof_id, proof_message_prefix, proof_type_label, ProofMessageFields};

use crate::constants::CONFIG_SEED;
use crate::ed25519::load_preceding_ed25519;
use crate::error::SteleError;
use crate::events::ProofRecorded;
use crate::instructions::acceptance::check_validity_window;
use crate::instructions::sponsor::{reimburse, SPONSORED_SIGNATURES};
use crate::state::{NonceShard, Organization, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RecordProofArgs {
    pub proof_type: u8,
    pub statement_hash: [u8; 32],
    pub nonce_index: u32,
    pub nonce_tag: [u8; 8],
    pub issued_at: i64,
    pub expires_at: i64,
}

#[derive(Accounts)]
pub struct RecordProof<'info> {
    /// The shard's designated relayer (any signer for open shards). Usually also the fee payer.
    #[account(mut)]
    pub relayer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    pub organization: Box<Account<'info, Organization>>,
    #[account(mut)]
    pub nonce_shard: AccountLoader<'info, NonceShard>,
    /// CHECK: address-constrained to the instructions sysvar; read via checked loaders.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn record_proof(ctx: Context<RecordProof>, args: RecordProofArgs) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let config = &ctx.accounts.config;
    let org = &ctx.accounts.organization;
    let org_key = org.key();

    require!(!config.paused, SteleError::ProtocolPaused);
    require!(!org.frozen, SteleError::OrganizationFrozen);
    require!(
        proof_type_label(args.proof_type).is_some(),
        SteleError::InvalidProofType
    );
    require!(
        args.statement_hash != [0u8; 32],
        SteleError::InvalidStatementHash
    );
    check_validity_window(now, args.issued_at, args.expires_at)?;
    require!(
        args.nonce_index < SHARD_CAPACITY,
        SteleError::NonceOutOfRange
    );

    // Shard ownership and relayer gating.
    let shard_key = ctx.accounts.nonce_shard.key();
    let mut shard = ctx.accounts.nonce_shard.load_mut()?;
    require_keys_eq!(
        shard.organization,
        org_key,
        SteleError::ShardOrganizationMismatch
    );
    if shard.relayer != Pubkey::default() {
        require_keys_eq!(
            shard.relayer,
            ctx.accounts.relayer.key(),
            SteleError::UnauthorizedRelayer
        );
    }
    let shard_relayer = shard.relayer;

    let verified = load_preceding_ed25519(&ctx.accounts.instructions_sysvar.to_account_info())?;

    let org_bytes = org_key.to_bytes();
    let fields = ProofMessageFields {
        proof_type: args.proof_type,
        org_name: &org.name,
        org_verified_domain: org.verified_domain_at(now),
        organization: &org_bytes,
        statement_hash: &args.statement_hash,
        signer: &verified.signer,
        network_label: &config.network_label,
        chain_id: &config.chain_id,
        issued_at: args.issued_at,
        expires_at: args.expires_at,
        shard_id: shard.shard_id,
        nonce_index: args.nonce_index,
        nonce_tag: &args.nonce_tag,
    };
    let prefix = proof_message_prefix(&fields).map_err(|_| SteleError::InvalidTimestamp)?;
    if !verified.message.starts_with(prefix.as_bytes()) {
        return err!(SteleError::MessageMismatch);
    }
    extract_request_domain(&verified.message, prefix.as_bytes())
        .map_err(|_| SteleError::InvalidRequestDomain)?;

    require!(
        bitmap_try_set(&mut shard.bitmap, args.nonce_index),
        SteleError::NonceAlreadyUsed
    );

    let message_hash = sha256(&verified.message);
    let id = proof_id(
        &org_bytes,
        &verified.signer,
        &args.statement_hash,
        &message_hash,
        &verified.signature,
    );
    shard.accumulator = accumulate(&shard.accumulator, &id);
    shard.accepted_count = shard
        .accepted_count
        .checked_add(1)
        .ok_or(SteleError::ArithmeticOverflow)?;

    emit!(ProofRecorded {
        organization: org_key,
        signer: Pubkey::new_from_array(verified.signer),
        nonce_shard: shard_key,
        proof_id: id,
        statement_hash: args.statement_hash,
        message_hash,
        accumulator: shard.accumulator,
        issued_at: args.issued_at,
        expires_at: args.expires_at,
        recorded_at: now,
        slot: clock.slot,
        sequence: shard.accepted_count,
        nonce_index: args.nonce_index,
        shard_id: shard.shard_id,
        proof_type: args.proof_type,
    });
    drop(shard);

    // Fee sponsorship, if the organization enabled it on this shard (never affects the record).
    reimburse(
        &ctx.accounts.nonce_shard.to_account_info(),
        &ctx.accounts.relayer.to_account_info(),
        &ctx.accounts.instructions_sysvar.to_account_info(),
        &shard_relayer,
        id,
        now,
        SPONSORED_SIGNATURES,
    )?;
    Ok(())
}
