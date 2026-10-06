//! Organization lifecycle and authority management (PROTOCOL_SPEC.md §6.4, #6–#18).
//!
//! Authority model:
//! * `owner` — root authority (recommended: a Squads multisig vault).
//! * `recovery` — optional emergency authority: can freeze instantly (only recovery can lift a
//!   recovery freeze) and replace the owner after a 72-hour time lock. While the organization is
//!   locked by recovery, owner powers are suspended.
//! * Replacing an *existing* recovery key is time-locked so a thief holding the owner key cannot
//!   silently remove the safety net.

use anchor_lang::prelude::*;
use stele_core::constants::{FROZEN_BY_NONE, FROZEN_BY_OWNER, FROZEN_BY_RECOVERY, RECOVERY_DELAY};
use stele_core::validate::validate_org_name;

use crate::authority::require_owner;
use crate::constants::{CONFIG_SEED, ORGANIZATION_SEED};
use crate::error::SteleError;
use crate::events::*;
use crate::state::{Organization, ProtocolConfig};

const KIND_OWNER_PROPOSED: u8 = 1;
const KIND_OWNERSHIP_ACCEPTED: u8 = 2;
const KIND_OWNER_TRANSFER_CANCELLED: u8 = 3;
const KIND_RECOVERY_PROPOSED: u8 = 4;
const KIND_RECOVERY_CHANGED: u8 = 5;
const KIND_RECOVERY_CHANGE_CANCELLED: u8 = 6;
const KIND_OWNER_RECOVERY_INITIATED: u8 = 7;
const KIND_OWNER_RECOVERY_CANCELLED: u8 = 8;
const KIND_OWNER_RECOVERY_EXECUTED: u8 = 9;

fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

fn emit_authority(org: Pubkey, kind: u8, actor: Pubkey, subject: Pubkey, eta: i64) -> Result<()> {
    emit!(AuthorityChanged {
        organization: org,
        kind,
        actor,
        subject,
        eta,
        timestamp: now()?
    });
    Ok(())
}

// ---- create / update ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateOrganizationArgs {
    pub seed: [u8; 32],
    pub name: String,
    pub owner: Pubkey,
    pub recovery: Option<Pubkey>,
}

#[derive(Accounts)]
#[instruction(args: CreateOrganizationArgs)]
pub struct CreateOrganization<'info> {
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        init,
        payer = payer,
        space = 8 + Organization::INIT_SPACE,
        seeds = [ORGANIZATION_SEED, creator.key().as_ref(), args.seed.as_ref()],
        bump
    )]
    pub organization: Box<Account<'info, Organization>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn create_organization(
    ctx: Context<CreateOrganization>,
    args: CreateOrganizationArgs,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, SteleError::ProtocolPaused);
    validate_org_name(&args.name).map_err(|_| SteleError::InvalidOrganizationName)?;
    require_keys_neq!(args.owner, Pubkey::default(), SteleError::ZeroAddress);
    let recovery = args.recovery.unwrap_or_default();
    if recovery != Pubkey::default() {
        require_keys_neq!(recovery, args.owner, SteleError::RecoveryEqualsOwner);
    }

    let timestamp = now()?;
    let org = &mut ctx.accounts.organization;
    org.creator = ctx.accounts.creator.key();
    org.seed = args.seed;
    org.owner = args.owner;
    org.pending_owner = Pubkey::default();
    org.recovery = recovery;
    org.pending_recovery = Pubkey::default();
    org.pending_recovery_eta = 0;
    org.recovery_target_owner = Pubkey::default();
    org.recovery_eta = 0;
    org.domain_verified_at = 0;
    org.domain_expires_at = 0;
    org.created_at = timestamp;
    org.document_count = 0;
    org.member_count = 0;
    org.frozen = false;
    org.frozen_by = FROZEN_BY_NONE;
    org.bump = ctx.bumps.organization;
    org.name = args.name.clone();
    org.verified_domain = String::new();

    emit!(OrganizationCreated {
        organization: org.key(),
        creator: org.creator,
        owner: org.owner,
        recovery,
        name: args.name,
        timestamp,
    });
    Ok(())
}

/// Accounts for organization-authority instructions that only touch the organization account.
#[derive(Accounts)]
pub struct OrganizationAuthority<'info> {
    pub authority: Signer<'info>,
    #[account(mut)]
    pub organization: Box<Account<'info, Organization>>,
}

pub fn update_organization(ctx: Context<OrganizationAuthority>, name: String) -> Result<()> {
    let org = &mut ctx.accounts.organization;
    require_owner(org, &ctx.accounts.authority.key())?;
    validate_org_name(&name).map_err(|_| SteleError::InvalidOrganizationName)?;
    org.name = name.clone();
    emit!(OrganizationRenamed {
        organization: org.key(),
        name,
        timestamp: now()?
    });
    Ok(())
}

// ---- two-step ownership transfer --------------------------------------------------------------

pub fn propose_owner(ctx: Context<OrganizationAuthority>, new_owner: Pubkey) -> Result<()> {
    let actor = ctx.accounts.authority.key();
    let org = &mut ctx.accounts.organization;
    require_owner(org, &actor)?;
    require_keys_neq!(new_owner, Pubkey::default(), SteleError::ZeroAddress);
    if org.has_recovery() {
        require_keys_neq!(new_owner, org.recovery, SteleError::RecoveryEqualsOwner);
    }
    org.pending_owner = new_owner;
    emit_authority(org.key(), KIND_OWNER_PROPOSED, actor, new_owner, 0)
}

pub fn accept_ownership(ctx: Context<OrganizationAuthority>) -> Result<()> {
    let actor = ctx.accounts.authority.key();
    let org = &mut ctx.accounts.organization;
    require!(
        !org.is_recovery_locked(),
        SteleError::OrganizationLockedByRecovery
    );
    require_keys_neq!(
        org.pending_owner,
        Pubkey::default(),
        SteleError::NoPendingOwner
    );
    require_keys_eq!(actor, org.pending_owner, SteleError::Unauthorized);
    org.owner = actor;
    org.pending_owner = Pubkey::default();
    emit_authority(org.key(), KIND_OWNERSHIP_ACCEPTED, actor, actor, 0)
}

pub fn cancel_owner_transfer(ctx: Context<OrganizationAuthority>) -> Result<()> {
    let actor = ctx.accounts.authority.key();
    let org = &mut ctx.accounts.organization;
    require_owner(org, &actor)?;
    require_keys_neq!(
        org.pending_owner,
        Pubkey::default(),
        SteleError::NoPendingOwner
    );
    let cancelled = org.pending_owner;
    org.pending_owner = Pubkey::default();
    emit_authority(
        org.key(),
        KIND_OWNER_TRANSFER_CANCELLED,
        actor,
        cancelled,
        0,
    )
}

// ---- recovery authority ------------------------------------------------------------------------

/// Sets a recovery key immediately if none exists; otherwise schedules the change after
/// `RECOVERY_DELAY`. `None` proposes removing the recovery key (also time-locked).
pub fn propose_recovery(
    ctx: Context<OrganizationAuthority>,
    new_recovery: Option<Pubkey>,
) -> Result<()> {
    let actor = ctx.accounts.authority.key();
    let org = &mut ctx.accounts.organization;
    require_owner(org, &actor)?;
    let target = new_recovery.unwrap_or_default();
    if target != Pubkey::default() {
        require_keys_neq!(target, org.owner, SteleError::RecoveryEqualsOwner);
    }
    if !org.has_recovery() {
        org.recovery = target;
        org.pending_recovery = Pubkey::default();
        org.pending_recovery_eta = 0;
        return emit_authority(org.key(), KIND_RECOVERY_CHANGED, actor, target, 0);
    }
    let eta = now()?
        .checked_add(RECOVERY_DELAY)
        .ok_or(SteleError::ArithmeticOverflow)?;
    org.pending_recovery = target;
    org.pending_recovery_eta = eta;
    emit_authority(org.key(), KIND_RECOVERY_PROPOSED, actor, target, eta)
}

pub fn apply_recovery_change(ctx: Context<OrganizationAuthority>) -> Result<()> {
    let actor = ctx.accounts.authority.key();
    let org = &mut ctx.accounts.organization;
    require_owner(org, &actor)?;
    require!(
        org.pending_recovery_eta != 0,
        SteleError::NoPendingRecoveryChange
    );
    require!(
        now()? >= org.pending_recovery_eta,
        SteleError::TimelockNotElapsed
    );
    org.recovery = org.pending_recovery;
    org.pending_recovery = Pubkey::default();
    org.pending_recovery_eta = 0;
    let recovery = org.recovery;
    emit_authority(org.key(), KIND_RECOVERY_CHANGED, actor, recovery, 0)
}

pub fn cancel_recovery_change(ctx: Context<OrganizationAuthority>) -> Result<()> {
    let actor = ctx.accounts.authority.key();
    let org = &mut ctx.accounts.organization;
    if !org.is_recovery(&actor) {
        require_owner(org, &actor)?;
    }
    require!(
        org.pending_recovery_eta != 0,
        SteleError::NoPendingRecoveryChange
    );
    let cancelled = org.pending_recovery;
    org.pending_recovery = Pubkey::default();
    org.pending_recovery_eta = 0;
    emit_authority(
        org.key(),
        KIND_RECOVERY_CHANGE_CANCELLED,
        actor,
        cancelled,
        0,
    )
}

// ---- freeze ------------------------------------------------------------------------------------

/// Owner (unless recovery-locked) or recovery. A recovery freeze outranks an owner freeze.
pub fn freeze_organization(ctx: Context<OrganizationAuthority>) -> Result<()> {
    let actor = ctx.accounts.authority.key();
    let org = &mut ctx.accounts.organization;
    let level = if org.is_recovery(&actor) {
        FROZEN_BY_RECOVERY
    } else {
        require_owner(org, &actor)?;
        FROZEN_BY_OWNER
    };
    org.frozen = true;
    org.frozen_by = org.frozen_by.max(level);
    emit!(OrganizationFreezeChanged {
        organization: org.key(),
        frozen: true,
        frozen_by: org.frozen_by,
        actor,
        timestamp: now()?,
    });
    Ok(())
}

/// A recovery freeze can only be lifted by recovery; an owner freeze by owner or recovery.
pub fn unfreeze_organization(ctx: Context<OrganizationAuthority>) -> Result<()> {
    let actor = ctx.accounts.authority.key();
    let org = &mut ctx.accounts.organization;
    require!(org.frozen, SteleError::NotFrozen);
    if org.frozen_by == FROZEN_BY_RECOVERY {
        require!(
            org.is_recovery(&actor),
            SteleError::OrganizationLockedByRecovery
        );
    } else {
        require!(
            org.is_owner(&actor) || org.is_recovery(&actor),
            SteleError::Unauthorized
        );
    }
    org.frozen = false;
    org.frozen_by = FROZEN_BY_NONE;
    emit!(OrganizationFreezeChanged {
        organization: org.key(),
        frozen: false,
        frozen_by: FROZEN_BY_NONE,
        actor,
        timestamp: now()?,
    });
    Ok(())
}

// ---- recovery-initiated owner replacement ------------------------------------------------------

pub fn initiate_owner_recovery(
    ctx: Context<OrganizationAuthority>,
    new_owner: Pubkey,
) -> Result<()> {
    let actor = ctx.accounts.authority.key();
    let org = &mut ctx.accounts.organization;
    require!(org.has_recovery(), SteleError::NoRecoveryAuthority);
    require!(org.is_recovery(&actor), SteleError::Unauthorized);
    require_keys_neq!(new_owner, Pubkey::default(), SteleError::ZeroAddress);
    require_keys_neq!(new_owner, org.recovery, SteleError::RecoveryEqualsOwner);
    let eta = now()?
        .checked_add(RECOVERY_DELAY)
        .ok_or(SteleError::ArithmeticOverflow)?;
    org.recovery_target_owner = new_owner;
    org.recovery_eta = eta;
    emit_authority(
        org.key(),
        KIND_OWNER_RECOVERY_INITIATED,
        actor,
        new_owner,
        eta,
    )
}

/// Recovery may always cancel; the owner may cancel unless the organization is recovery-locked.
pub fn cancel_owner_recovery(ctx: Context<OrganizationAuthority>) -> Result<()> {
    let actor = ctx.accounts.authority.key();
    let org = &mut ctx.accounts.organization;
    if !org.is_recovery(&actor) {
        require_owner(org, &actor)?;
    }
    require!(org.recovery_eta != 0, SteleError::NoPendingOwnerRecovery);
    let cancelled = org.recovery_target_owner;
    org.recovery_target_owner = Pubkey::default();
    org.recovery_eta = 0;
    emit_authority(
        org.key(),
        KIND_OWNER_RECOVERY_CANCELLED,
        actor,
        cancelled,
        0,
    )
}

pub fn execute_owner_recovery(ctx: Context<OrganizationAuthority>) -> Result<()> {
    let actor = ctx.accounts.authority.key();
    let org = &mut ctx.accounts.organization;
    require!(org.is_recovery(&actor), SteleError::Unauthorized);
    require!(org.recovery_eta != 0, SteleError::NoPendingOwnerRecovery);
    require!(now()? >= org.recovery_eta, SteleError::TimelockNotElapsed);
    let new_owner = org.recovery_target_owner;
    org.owner = new_owner;
    org.recovery_target_owner = Pubkey::default();
    org.recovery_eta = 0;
    // Anything the previous (possibly compromised) owner scheduled is discarded.
    org.pending_owner = Pubkey::default();
    org.pending_recovery = Pubkey::default();
    org.pending_recovery_eta = 0;
    // Hand freeze control to the new owner.
    if org.frozen && org.frozen_by == FROZEN_BY_RECOVERY {
        org.frozen_by = FROZEN_BY_OWNER;
    }
    emit_authority(org.key(), KIND_OWNER_RECOVERY_EXECUTED, actor, new_owner, 0)
}
