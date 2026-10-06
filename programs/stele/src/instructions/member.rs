//! Organization members and key-compromise reporting (PROTOCOL_SPEC.md §6.4, #19–#22).
//! Member records are never deleted: revocation and compromise are timestamps, so verifiers can
//! always reconstruct who held which authority when.

use anchor_lang::prelude::*;
use stele_core::constants::ROLE_MASK;

use crate::authority::authorize_member_management;
use crate::constants::MEMBER_SEED;
use crate::error::SteleError;
use crate::events::*;
use crate::state::{Member, Organization};

fn validate_roles(roles: u8) -> Result<()> {
    require!(
        roles != 0 && roles & !ROLE_MASK == 0,
        SteleError::InvalidRoles
    );
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AddMemberArgs {
    pub member: Pubkey,
    pub roles: u8,
}

#[derive(Accounts)]
#[instruction(args: AddMemberArgs)]
pub struct AddMember<'info> {
    pub authority: Signer<'info>,
    /// The signer's own membership (required when the signer is not the owner).
    #[account(
        seeds = [MEMBER_SEED, organization.key().as_ref(), authority.key().as_ref()],
        bump = authority_membership.bump
    )]
    pub authority_membership: Option<Box<Account<'info, Member>>>,
    #[account(mut)]
    pub organization: Box<Account<'info, Organization>>,
    #[account(
        init,
        payer = payer,
        space = 8 + Member::INIT_SPACE,
        seeds = [MEMBER_SEED, organization.key().as_ref(), args.member.as_ref()],
        bump
    )]
    pub member: Box<Account<'info, Member>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn add_member(ctx: Context<AddMember>, args: AddMemberArgs) -> Result<()> {
    validate_roles(args.roles)?;
    require_keys_neq!(args.member, Pubkey::default(), SteleError::ZeroAddress);
    let org_key = ctx.accounts.organization.key();
    let authority = ctx.accounts.authority.key();
    authorize_member_management(
        &ctx.accounts.organization,
        &org_key,
        &authority,
        ctx.accounts.authority_membership.as_deref().map(|m| &**m),
        0,
        args.roles,
    )?;

    let timestamp = Clock::get()?.unix_timestamp;
    let member = &mut ctx.accounts.member;
    member.organization = org_key;
    member.member = args.member;
    member.added_by = authority;
    member.added_at = timestamp;
    member.updated_at = timestamp;
    member.revoked_at = 0;
    member.compromised_since = 0;
    member.compromise_reported_at = 0;
    member.roles = args.roles;
    member.bump = ctx.bumps.member;

    let org = &mut ctx.accounts.organization;
    org.member_count = org
        .member_count
        .checked_add(1)
        .ok_or(SteleError::ArithmeticOverflow)?;

    emit!(MemberChanged {
        organization: org_key,
        member: args.member,
        roles: args.roles,
        revoked: false,
        actor: authority,
        timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ManageMember<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [MEMBER_SEED, organization.key().as_ref(), authority.key().as_ref()],
        bump = authority_membership.bump
    )]
    pub authority_membership: Option<Box<Account<'info, Member>>>,
    pub organization: Box<Account<'info, Organization>>,
    #[account(
        mut,
        seeds = [MEMBER_SEED, organization.key().as_ref(), member.member.as_ref()],
        bump = member.bump,
        constraint = member.organization == organization.key() @ SteleError::MemberOrganizationMismatch
    )]
    pub member: Box<Account<'info, Member>>,
}

/// Changes roles; also re-activates a revoked member unless it was reported compromised.
pub fn update_member(ctx: Context<ManageMember>, roles: u8) -> Result<()> {
    validate_roles(roles)?;
    let org_key = ctx.accounts.organization.key();
    let authority = ctx.accounts.authority.key();
    authorize_member_management(
        &ctx.accounts.organization,
        &org_key,
        &authority,
        ctx.accounts.authority_membership.as_deref().map(|m| &**m),
        ctx.accounts.member.roles,
        roles,
    )?;
    let member = &mut ctx.accounts.member;
    require!(member.compromised_since == 0, SteleError::MemberCompromised);
    let timestamp = Clock::get()?.unix_timestamp;
    member.roles = roles;
    member.revoked_at = 0;
    member.updated_at = timestamp;
    emit!(MemberChanged {
        organization: org_key,
        member: member.member,
        roles,
        revoked: false,
        actor: authority,
        timestamp,
    });
    Ok(())
}

pub fn revoke_member(ctx: Context<ManageMember>) -> Result<()> {
    let org_key = ctx.accounts.organization.key();
    let authority = ctx.accounts.authority.key();
    let current = ctx.accounts.member.roles;
    authorize_member_management(
        &ctx.accounts.organization,
        &org_key,
        &authority,
        ctx.accounts.authority_membership.as_deref().map(|m| &**m),
        current,
        current,
    )?;
    let member = &mut ctx.accounts.member;
    require!(member.is_active(), SteleError::MemberRevoked);
    let timestamp = Clock::get()?.unix_timestamp;
    member.revoked_at = timestamp;
    member.updated_at = timestamp;
    emit!(MemberChanged {
        organization: org_key,
        member: member.member,
        roles: member.roles,
        revoked: true,
        actor: authority,
        timestamp,
    });
    Ok(())
}

/// Marks a member key compromised since `compromised_since` (≤ now) and revokes it.
/// Allowed for: the owner (not recovery-locked), the recovery authority, an admin (non-admin
/// targets, not frozen), or the member itself.
pub fn report_key_compromise(ctx: Context<ManageMember>, compromised_since: i64) -> Result<()> {
    let org_key = ctx.accounts.organization.key();
    let authority = ctx.accounts.authority.key();
    let timestamp = Clock::get()?.unix_timestamp;
    require!(
        compromised_since > 0 && compromised_since <= timestamp,
        SteleError::InvalidCompromiseTime
    );

    let is_self = authority == ctx.accounts.member.member;
    let is_recovery = ctx.accounts.organization.is_recovery(&authority);
    if !is_self && !is_recovery {
        let current = ctx.accounts.member.roles;
        authorize_member_management(
            &ctx.accounts.organization,
            &org_key,
            &authority,
            ctx.accounts.authority_membership.as_deref().map(|m| &**m),
            current,
            current,
        )?;
    }

    let member = &mut ctx.accounts.member;
    // An earlier report can only be moved earlier, never later (cannot "un-compromise" history).
    if member.compromised_since == 0 || compromised_since < member.compromised_since {
        member.compromised_since = compromised_since;
    }
    member.compromise_reported_at = timestamp;
    if member.revoked_at == 0 {
        member.revoked_at = timestamp;
    }
    member.updated_at = timestamp;

    emit!(KeyCompromiseReported {
        organization: org_key,
        member: member.member,
        compromised_since: member.compromised_since,
        reported_by: authority,
        timestamp,
    });
    Ok(())
}
