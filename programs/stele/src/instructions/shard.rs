//! Nonce shards: per-organization replay-protection bitmaps (PROTOCOL_SPEC.md §6.4 #28–#29).

use anchor_lang::prelude::*;

use crate::authority::{authorize, SHARD_MANAGER_ROLES};
use crate::constants::{CONFIG_SEED, MEMBER_SEED, NONCE_SHARD_SEED};
use crate::error::SteleError;
use crate::events::*;
use crate::state::{Member, NonceShard, Organization, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateNonceShardArgs {
    pub shard_id: u16,
    /// Only this key may record acceptances against the shard. The zero key allows any signer
    /// (an "open" shard: anyone paying fees can record — and consume — nonces).
    pub relayer: Pubkey,
}

#[derive(Accounts)]
#[instruction(args: CreateNonceShardArgs)]
pub struct CreateNonceShard<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [MEMBER_SEED, organization.key().as_ref(), authority.key().as_ref()],
        bump = membership.bump
    )]
    pub membership: Option<Box<Account<'info, Member>>>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    pub organization: Box<Account<'info, Organization>>,
    #[account(
        init,
        payer = payer,
        space = NonceShard::ACCOUNT_SIZE,
        seeds = [NONCE_SHARD_SEED, organization.key().as_ref(), &args.shard_id.to_le_bytes()],
        bump
    )]
    pub nonce_shard: AccountLoader<'info, NonceShard>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn create_nonce_shard(
    ctx: Context<CreateNonceShard>,
    args: CreateNonceShardArgs,
) -> Result<()> {
    let org_key = ctx.accounts.organization.key();
    let authority = ctx.accounts.authority.key();
    authorize(
        &ctx.accounts.organization,
        &org_key,
        &authority,
        ctx.accounts.membership.as_deref().map(|m| &**m),
        SHARD_MANAGER_ROLES,
        false,
    )?;

    let mut shard = ctx.accounts.nonce_shard.load_init()?;
    shard.organization = org_key;
    shard.relayer = args.relayer;
    shard.accumulator = [0u8; 32];
    shard.accepted_count = 0;
    shard.created_at = Clock::get()?.unix_timestamp;
    shard.shard_id = args.shard_id;
    shard.bump = ctx.bumps.nonce_shard;
    // `reserved` and `bitmap` are zero-initialized by account creation.

    emit!(NonceShardChanged {
        organization: org_key,
        nonce_shard: ctx.accounts.nonce_shard.key(),
        shard_id: args.shard_id,
        relayer: args.relayer,
        created: true,
        actor: authority,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetShardRelayer<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [MEMBER_SEED, organization.key().as_ref(), authority.key().as_ref()],
        bump = membership.bump
    )]
    pub membership: Option<Box<Account<'info, Member>>>,
    pub organization: Box<Account<'info, Organization>>,
    #[account(mut)]
    pub nonce_shard: AccountLoader<'info, NonceShard>,
}

/// Rotates the relayer key of a shard (e.g. after relayer-key compromise).
pub fn set_shard_relayer(ctx: Context<SetShardRelayer>, relayer: Pubkey) -> Result<()> {
    let org_key = ctx.accounts.organization.key();
    let authority = ctx.accounts.authority.key();
    authorize(
        &ctx.accounts.organization,
        &org_key,
        &authority,
        ctx.accounts.membership.as_deref().map(|m| &**m),
        SHARD_MANAGER_ROLES,
        false,
    )?;
    let mut shard = ctx.accounts.nonce_shard.load_mut()?;
    require_keys_eq!(
        shard.organization,
        org_key,
        SteleError::ShardOrganizationMismatch
    );
    shard.relayer = relayer;
    emit!(NonceShardChanged {
        organization: org_key,
        nonce_shard: ctx.accounts.nonce_shard.key(),
        shard_id: shard.shard_id,
        relayer,
        created: false,
        actor: authority,
    });
    Ok(())
}
