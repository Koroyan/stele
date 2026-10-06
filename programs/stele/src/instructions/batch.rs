//! `anchor_acceptance_batch` — the `MERKLE_BATCHED` evidence mode (PROTOCOL_SPEC.md §17.9).
//!
//! The shard's designated relayer anchors the Merkle root of acceptances it verified off-chain.
//! The program verifies NO user signature here (that is the point: one transaction for many
//! acceptances); it records that this root existed at this slot and folds the batch into the
//! shard's accumulator, so the shard's history stays one append-only log. Verifiers check every
//! batched acceptance off-chain: the user's signature, its WebAuthn binding (passkeys), the
//! message against chain data, and the Merkle path to this root.
//!
//! Only a designated relayer may anchor (never an open shard): anyone else could fill the log with
//! junk roots, which could not forge acceptances but would cost the organization reimbursements.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::get_stack_height;
use stele_core::acceptance::accumulate;
use stele_core::batch::{batch_id, MAX_BATCH_LEAVES};

use crate::constants::{CONFIG_SEED, TRANSACTION_LEVEL_STACK_HEIGHT};
use crate::error::SteleError;
use crate::events::AcceptanceBatchAnchored;
use crate::instructions::sponsor::reimburse;
use crate::state::{NonceShard, Organization, ProtocolConfig};

/// Signatures of a batch transaction: the relayer's only (no precompile).
const BATCH_SIGNATURES: u64 = 1;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AnchorAcceptanceBatchArgs {
    /// Merkle root over `leaf_hash(protocol, acceptance_id)` (stele_core::batch).
    pub batch_root: [u8; 32],
    pub leaf_count: u32,
}

#[derive(Accounts)]
pub struct AnchorAcceptanceBatch<'info> {
    /// The shard's designated relayer; writable so that a sponsored shard can reimburse it.
    #[account(mut)]
    pub relayer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    pub organization: Box<Account<'info, Organization>>,
    #[account(mut)]
    pub nonce_shard: AccountLoader<'info, NonceShard>,
    /// CHECK: address-constrained to the instructions sysvar (fee reimbursement reads it).
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn anchor_acceptance_batch(
    ctx: Context<AnchorAcceptanceBatch>,
    args: AnchorAcceptanceBatchArgs,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    require!(
        get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT,
        SteleError::CpiNotAllowed
    );
    require!(!ctx.accounts.config.paused, SteleError::ProtocolPaused);
    let org = &ctx.accounts.organization;
    require!(!org.frozen, SteleError::OrganizationFrozen);
    require!(
        args.leaf_count >= 1 && args.leaf_count <= MAX_BATCH_LEAVES && args.batch_root != [0u8; 32],
        SteleError::InvalidBatch
    );

    let shard_key = ctx.accounts.nonce_shard.key();
    let mut shard = ctx.accounts.nonce_shard.load_mut()?;
    require_keys_eq!(
        shard.organization,
        org.key(),
        SteleError::ShardOrganizationMismatch
    );
    require!(
        shard.relayer != Pubkey::default() && shard.relayer == ctx.accounts.relayer.key(),
        SteleError::UnauthorizedRelayer
    );
    let shard_relayer = shard.relayer;

    let id = batch_id(
        &org.key().to_bytes(),
        &shard_key.to_bytes(),
        &args.batch_root,
        args.leaf_count,
        shard.accepted_count,
    );
    shard.accumulator = accumulate(&shard.accumulator, &id);
    shard.accepted_count = shard
        .accepted_count
        .checked_add(u64::from(args.leaf_count))
        .ok_or(SteleError::ArithmeticOverflow)?;

    emit!(AcceptanceBatchAnchored {
        organization: org.key(),
        nonce_shard: shard_key,
        batch_root: args.batch_root,
        batch_id: id,
        accumulator: shard.accumulator,
        anchored_at: now,
        slot: clock.slot,
        sequence: shard.accepted_count,
        leaf_count: args.leaf_count,
        shard_id: shard.shard_id,
    });
    drop(shard);

    reimburse(
        &ctx.accounts.nonce_shard.to_account_info(),
        &ctx.accounts.relayer.to_account_info(),
        &ctx.accounts.instructions_sysvar.to_account_info(),
        &shard_relayer,
        id,
        now,
        BATCH_SIGNATURES,
    )
}
