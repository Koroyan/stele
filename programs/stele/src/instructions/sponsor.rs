//! Organization fee sponsorship (PROTOCOL_SPEC.md §13).
//!
//! An organization funds a **nonce shard**: the shard PDA is the deposit address, and a
//! sponsorship trailer appended to the shard account holds its limits and counters. The shard is
//! program-owned, so no private key exists that could spend the deposit, and because the shard is
//! already part of every recording transaction, sponsorship adds no account and no bytes to it.
//!
//! Money leaves a sponsored shard in exactly two ways:
//!
//! * `reimburse` — inside `record_acceptance` / `record_proof`, after the user's signature, the
//!   message and the nonce have been verified and recorded, the program pays the shard's
//!   **designated relayer** the network fee of that transaction (computed from its compute-budget
//!   instructions with the runtime's formula), capped per record and per UTC day. When a cap or the
//!   balance does not allow it, nothing is paid and the recording still succeeds: fee accounting
//!   never blocks or alters a user's signed record;
//! * `withdraw_shard_sponsorship` — signed by the organization owner, never below the rent minimum.
//!
//! Least privilege: admins may enable sponsorship, pause it and *lower* its limits; only the owner
//! may raise limits, unpause or withdraw.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};
use stele_core::constants::MAX_SPONSOR_FEE_PER_RECORD;
use stele_core::fees::{transaction_fee, utc_day, ComputeBudget};

use crate::authority::{authorize, require_owner, Actor, SHARD_MANAGER_ROLES};
use crate::constants::MEMBER_SEED;
use crate::error::SteleError;
use crate::events::{SponsorReimbursed, SponsorWithdrawal, SponsorshipChanged};
use crate::state::{Member, NonceShard, Organization, ShardSponsorship};

/// Signatures whose fee a sponsored recording reimburses: the relayer's transaction signature and
/// the one precompile-verified user signature. Extra signers are never reimbursed.
pub(crate) const SPONSORED_SIGNATURES: u64 = 2;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct SponsorLimits {
    pub max_fee_per_record: u64,
    pub daily_limit: u64,
}

impl SponsorLimits {
    fn validate(&self) -> Result<()> {
        require!(
            self.max_fee_per_record > 0
                && self.max_fee_per_record <= MAX_SPONSOR_FEE_PER_RECORD
                && self.daily_limit >= self.max_fee_per_record,
            SteleError::InvalidSponsorLimits
        );
        Ok(())
    }
}

/// Reads the sponsorship trailer of a shard account, if present.
pub fn read_sponsorship(shard: &AccountInfo) -> Result<Option<ShardSponsorship>> {
    let data = shard.try_borrow_data()?;
    if data.len() <= NonceShard::ACCOUNT_SIZE {
        return Ok(None);
    }
    require!(
        data.len() == ShardSponsorship::SPONSORED_ACCOUNT_SIZE,
        SteleError::SponsorshipNotEnabled
    );
    let trailer: ShardSponsorship = bytemuck::pod_read_unaligned(&data[NonceShard::ACCOUNT_SIZE..]);
    require!(
        trailer.magic == ShardSponsorship::MAGIC,
        SteleError::SponsorshipNotEnabled
    );
    Ok(Some(trailer))
}

fn write_sponsorship(shard: &AccountInfo, trailer: &ShardSponsorship) -> Result<()> {
    let mut data = shard.try_borrow_mut_data()?;
    require!(
        data.len() == ShardSponsorship::SPONSORED_ACCOUNT_SIZE,
        SteleError::SponsorshipNotEnabled
    );
    data[NonceShard::ACCOUNT_SIZE..].copy_from_slice(bytemuck::bytes_of(trailer));
    Ok(())
}

/// The organization recorded in a shard account (first field after the discriminator).
fn shard_organization(shard: &AccountInfo) -> Result<Pubkey> {
    let data = shard.try_borrow_data()?;
    let bytes: [u8; 32] = data
        .get(8..40)
        .and_then(|s| s.try_into().ok())
        .ok_or(SteleError::ShardOrganizationMismatch)?;
    Ok(Pubkey::new_from_array(bytes))
}

#[derive(Accounts)]
pub struct EnableShardSponsorship<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [MEMBER_SEED, organization.key().as_ref(), authority.key().as_ref()],
        bump = membership.bump
    )]
    pub membership: Option<Box<Account<'info, Member>>>,
    pub organization: Box<Account<'info, Organization>>,
    #[account(mut)]
    pub nonce_shard: AccountLoader<'info, NonceShard>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn enable_shard_sponsorship(
    ctx: Context<EnableShardSponsorship>,
    limits: SponsorLimits,
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
    limits.validate()?;
    let (shard_id, relayer) = {
        let shard = ctx.accounts.nonce_shard.load()?;
        require_keys_eq!(
            shard.organization,
            org_key,
            SteleError::ShardOrganizationMismatch
        );
        (shard.shard_id, shard.relayer)
    };
    require!(
        relayer != Pubkey::default(),
        SteleError::SponsorRequiresDesignatedRelayer
    );

    let shard_info = ctx.accounts.nonce_shard.to_account_info();
    require!(
        shard_info.data_len() == NonceShard::ACCOUNT_SIZE,
        SteleError::SponsorshipAlreadyEnabled
    );
    let new_size = ShardSponsorship::SPONSORED_ACCOUNT_SIZE;
    let needed = Rent::get()?
        .minimum_balance(new_size)
        .saturating_sub(shard_info.lamports());
    if needed > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: shard_info.clone(),
                },
            ),
            needed,
        )?;
    }
    shard_info.resize(new_size)?;

    let now = Clock::get()?.unix_timestamp;
    let trailer = ShardSponsorship {
        magic: ShardSponsorship::MAGIC,
        created_by: authority,
        max_fee_per_record: limits.max_fee_per_record,
        daily_limit: limits.daily_limit,
        current_day: utc_day(now),
        spent_today: 0,
        total_reimbursed: 0,
        reimbursed_count: 0,
        total_withdrawn: 0,
        created_at: now,
        updated_at: now,
        paused: 0,
        reserved: [0u8; 7],
    };
    write_sponsorship(&shard_info, &trailer)?;

    emit!(SponsorshipChanged {
        organization: org_key,
        nonce_shard: shard_info.key(),
        shard_id,
        max_fee_per_record: limits.max_fee_per_record,
        daily_limit: limits.daily_limit,
        paused: false,
        created: true,
        actor: authority,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct UpdateShardSponsorshipArgs {
    pub limits: SponsorLimits,
    pub paused: bool,
}

#[derive(Accounts)]
pub struct UpdateShardSponsorship<'info> {
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

pub fn update_shard_sponsorship(
    ctx: Context<UpdateShardSponsorship>,
    args: UpdateShardSponsorshipArgs,
) -> Result<()> {
    let org_key = ctx.accounts.organization.key();
    let authority = ctx.accounts.authority.key();
    let actor = authorize(
        &ctx.accounts.organization,
        &org_key,
        &authority,
        ctx.accounts.membership.as_deref().map(|m| &**m),
        SHARD_MANAGER_ROLES,
        false,
    )?;
    args.limits.validate()?;
    let shard_id = {
        let shard = ctx.accounts.nonce_shard.load()?;
        require_keys_eq!(
            shard.organization,
            org_key,
            SteleError::ShardOrganizationMismatch
        );
        shard.shard_id
    };
    let shard_info = ctx.accounts.nonce_shard.to_account_info();
    let mut trailer = read_sponsorship(&shard_info)?.ok_or(SteleError::SponsorshipNotEnabled)?;
    if let Actor::Member(_) = actor {
        // Admins can only make sponsorship more restrictive.
        require!(
            args.limits.max_fee_per_record <= trailer.max_fee_per_record
                && args.limits.daily_limit <= trailer.daily_limit
                && (args.paused || trailer.paused == 0),
            SteleError::Unauthorized
        );
    }
    trailer.max_fee_per_record = args.limits.max_fee_per_record;
    trailer.daily_limit = args.limits.daily_limit;
    trailer.paused = u8::from(args.paused);
    trailer.updated_at = Clock::get()?.unix_timestamp;
    write_sponsorship(&shard_info, &trailer)?;

    emit!(SponsorshipChanged {
        organization: org_key,
        nonce_shard: shard_info.key(),
        shard_id,
        max_fee_per_record: trailer.max_fee_per_record,
        daily_limit: trailer.daily_limit,
        paused: args.paused,
        created: false,
        actor: authority,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawShardSponsorship<'info> {
    pub owner: Signer<'info>,
    pub organization: Box<Account<'info, Organization>>,
    #[account(mut)]
    pub nonce_shard: AccountLoader<'info, NonceShard>,
    /// CHECK: any account chosen by the owner receives the lamports.
    #[account(mut, constraint = destination.key() != nonce_shard.key() @ SteleError::InvalidWithdrawal)]
    pub destination: UncheckedAccount<'info>,
}

pub fn withdraw_shard_sponsorship(
    ctx: Context<WithdrawShardSponsorship>,
    amount: u64,
) -> Result<()> {
    let owner = ctx.accounts.owner.key();
    let org_key = ctx.accounts.organization.key();
    require_owner(&ctx.accounts.organization, &owner)?;
    require!(amount > 0, SteleError::InvalidWithdrawal);
    {
        let shard = ctx.accounts.nonce_shard.load()?;
        require_keys_eq!(
            shard.organization,
            org_key,
            SteleError::ShardOrganizationMismatch
        );
    }
    let shard_info = ctx.accounts.nonce_shard.to_account_info();
    let mut trailer = read_sponsorship(&shard_info)?.ok_or(SteleError::SponsorshipNotEnabled)?;

    let rent_floor = Rent::get()?.minimum_balance(shard_info.data_len());
    let remaining = shard_info
        .lamports()
        .checked_sub(amount)
        .ok_or(SteleError::WithdrawalBelowRentMinimum)?;
    require!(
        remaining >= rent_floor,
        SteleError::WithdrawalBelowRentMinimum
    );
    shard_info.sub_lamports(amount)?;
    ctx.accounts.destination.add_lamports(amount)?;

    trailer.total_withdrawn = trailer
        .total_withdrawn
        .checked_add(amount)
        .ok_or(SteleError::ArithmeticOverflow)?;
    trailer.updated_at = Clock::get()?.unix_timestamp;
    write_sponsorship(&shard_info, &trailer)?;

    emit!(SponsorWithdrawal {
        organization: org_key,
        nonce_shard: shard_info.key(),
        destination: ctx.accounts.destination.key(),
        amount,
        remaining,
        actor: owner,
    });
    Ok(())
}

/// The compute-budget settings of the current transaction, read from the instructions sysvar.
/// `skip` lists instruction indices already known not to be compute-budget instructions.
fn transaction_compute_budget(
    instructions_sysvar: &AccountInfo,
    skip: [usize; 2],
) -> Result<ComputeBudget> {
    let count = {
        let data = instructions_sysvar.try_borrow_data()?;
        require!(data.len() >= 2, SteleError::MissingEd25519Instruction);
        usize::from(u16::from_le_bytes([data[0], data[1]]))
    };
    let mut budget = ComputeBudget::default();
    for index in (0..count).filter(|i| !skip.contains(i)) {
        let ix = load_instruction_at_checked(index, instructions_sysvar)?;
        if ix.program_id == solana_sdk_ids::compute_budget::ID {
            budget.apply(&ix.data);
        }
    }
    Ok(budget)
}

/// Pays the relayer the network fee of the current recording from a sponsored shard. Called by
/// the recording instructions **after** the record has been verified and written, with no
/// outstanding borrow of the shard's data. `signatures`: the transaction's signature count
/// including precompile signatures (2 for a signed recording, 1 for a batch anchor). Never fails a valid recording for accounting reasons:
/// without active sponsorship, room under the caps or balance, it pays nothing.
pub(crate) fn reimburse<'info>(
    shard: &AccountInfo<'info>,
    relayer: &AccountInfo<'info>,
    instructions_sysvar: &AccountInfo<'info>,
    designated_relayer: &Pubkey,
    record_id: [u8; 32],
    now: i64,
    signatures: u64,
) -> Result<()> {
    let Some(mut trailer) = read_sponsorship(shard)? else {
        return Ok(());
    };
    // Only the designated relayer of a relayer-gated shard is ever paid.
    if trailer.paused != 0
        || *designated_relayer == Pubkey::default()
        || designated_relayer != relayer.key
    {
        return Ok(());
    }

    let current = usize::from(load_current_index_checked(instructions_sysvar)?);
    // With a precompile (two signatures) the instruction before this one is the precompile.
    let previous = if signatures > 1 {
        current.saturating_sub(1)
    } else {
        current
    };
    let budget = transaction_compute_budget(instructions_sysvar, [current, previous])?;
    let fee = transaction_fee(signatures, &budget).ok_or(SteleError::ArithmeticOverflow)?;
    let amount = fee.min(trailer.max_fee_per_record);

    let day = utc_day(now);
    if day != trailer.current_day {
        trailer.current_day = day;
        trailer.spent_today = 0;
    }
    let spent = trailer
        .spent_today
        .checked_add(amount)
        .ok_or(SteleError::ArithmeticOverflow)?;
    let rent_floor = Rent::get()?.minimum_balance(shard.data_len());
    let available = shard.lamports().saturating_sub(rent_floor);
    if spent > trailer.daily_limit || available < amount {
        // Nothing is paid; only a day rollover is persisted.
        write_sponsorship(shard, &trailer)?;
        return Ok(());
    }
    shard.sub_lamports(amount)?;
    relayer.add_lamports(amount)?;

    trailer.spent_today = spent;
    trailer.total_reimbursed = trailer
        .total_reimbursed
        .checked_add(amount)
        .ok_or(SteleError::ArithmeticOverflow)?;
    trailer.reimbursed_count = trailer
        .reimbursed_count
        .checked_add(1)
        .ok_or(SteleError::ArithmeticOverflow)?;
    write_sponsorship(shard, &trailer)?;

    emit!(SponsorReimbursed {
        organization: shard_organization(shard)?,
        nonce_shard: shard.key(),
        relayer: *relayer.key,
        record_id,
        amount,
        fee,
        spent_today: spent,
        day,
    });
    Ok(())
}
