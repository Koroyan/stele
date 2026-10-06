//! Domain attestations (PROTOCOL_SPEC.md §6.4, #23–#25).
//!
//! The domain attestor (a dedicated key held by the verification service) asserts that the
//! organization controlled `_stele.<domain>` at attestation time. The `DomainRecord` PDA, keyed by
//! the domain hash, guarantees at most one live attestation per domain across all organizations.

use anchor_lang::prelude::*;
use stele_core::constants::{DOMAIN_METHOD_DNS_TXT, MAX_DOMAIN_ATTESTATION};
use stele_core::hash::domain_hash;
use stele_core::validate::validate_verified_domain;

use crate::authority::require_owner;
use crate::constants::{CONFIG_SEED, DOMAIN_SEED};
use crate::error::SteleError;
use crate::events::*;
use crate::state::{DomainRecord, Organization, ProtocolConfig};

fn validate_expiry(now: i64, expires_at: i64) -> Result<()> {
    let max = now
        .checked_add(MAX_DOMAIN_ATTESTATION)
        .ok_or(SteleError::ArithmeticOverflow)?;
    require!(
        expires_at > now && expires_at <= max,
        SteleError::InvalidDomainExpiry
    );
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AttestDomainArgs {
    pub domain: String,
    pub domain_hash: [u8; 32],
    pub expires_at: i64,
}

#[derive(Accounts)]
#[instruction(args: AttestDomainArgs)]
pub struct AttestDomain<'info> {
    pub attestor: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.domain_attestor == attestor.key() @ SteleError::UnauthorizedAttestor
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub organization: Box<Account<'info, Organization>>,
    #[account(
        init,
        payer = payer,
        space = 8 + DomainRecord::INIT_SPACE,
        seeds = [DOMAIN_SEED, args.domain_hash.as_ref()],
        bump
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn attest_domain(ctx: Context<AttestDomain>, args: AttestDomainArgs) -> Result<()> {
    validate_verified_domain(&args.domain).map_err(|_| SteleError::InvalidDomain)?;
    require!(
        domain_hash(&args.domain) == args.domain_hash,
        SteleError::DomainHashMismatch
    );
    let now = Clock::get()?.unix_timestamp;
    validate_expiry(now, args.expires_at)?;

    let org = &mut ctx.accounts.organization;
    require!(
        org.verified_domain.is_empty(),
        SteleError::OrganizationAlreadyHasDomain
    );
    org.verified_domain = args.domain.clone();
    org.domain_verified_at = now;
    org.domain_expires_at = args.expires_at;

    let record = &mut ctx.accounts.domain_record;
    record.organization = org.key();
    record.attestor = ctx.accounts.attestor.key();
    record.rent_payer = ctx.accounts.payer.key();
    record.domain_hash = args.domain_hash;
    record.verified_at = now;
    record.expires_at = args.expires_at;
    record.method = DOMAIN_METHOD_DNS_TXT;
    record.bump = ctx.bumps.domain_record;
    record.domain = args.domain.clone();

    emit!(DomainAttested {
        organization: org.key(),
        domain: args.domain,
        attestor: record.attestor,
        verified_at: now,
        expires_at: args.expires_at,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RenewDomain<'info> {
    pub attestor: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.domain_attestor == attestor.key() @ SteleError::UnauthorizedAttestor
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub organization: Box<Account<'info, Organization>>,
    #[account(
        mut,
        seeds = [DOMAIN_SEED, domain_record.domain_hash.as_ref()],
        bump = domain_record.bump,
        constraint = domain_record.organization == organization.key() @ SteleError::DomainOrganizationMismatch
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
}

/// Re-attests after a fresh DNS check, extending validity.
pub fn renew_domain(ctx: Context<RenewDomain>, expires_at: i64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    validate_expiry(now, expires_at)?;
    let record = &mut ctx.accounts.domain_record;
    record.verified_at = now;
    record.expires_at = expires_at;
    record.attestor = ctx.accounts.attestor.key();
    let org = &mut ctx.accounts.organization;
    require!(
        org.verified_domain == record.domain,
        SteleError::DomainOrganizationMismatch
    );
    org.domain_verified_at = now;
    org.domain_expires_at = expires_at;
    emit!(DomainAttested {
        organization: org.key(),
        domain: record.domain.clone(),
        attestor: record.attestor,
        verified_at: now,
        expires_at,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RevokeDomain<'info> {
    /// The domain attestor or the organization owner.
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub organization: Box<Account<'info, Organization>>,
    #[account(
        mut,
        seeds = [DOMAIN_SEED, domain_record.domain_hash.as_ref()],
        bump = domain_record.bump,
        constraint = domain_record.organization == organization.key() @ SteleError::DomainOrganizationMismatch,
        close = rent_payer
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
    /// CHECK: receives the record's rent; constrained to the recorded payer.
    #[account(mut, address = domain_record.rent_payer)]
    pub rent_payer: UncheckedAccount<'info>,
}

pub fn revoke_domain(ctx: Context<RevokeDomain>) -> Result<()> {
    let authority = ctx.accounts.authority.key();
    if authority != ctx.accounts.config.domain_attestor {
        require_owner(&ctx.accounts.organization, &authority)?;
    }
    let domain = ctx.accounts.domain_record.domain.clone();
    let org = &mut ctx.accounts.organization;
    if org.verified_domain == domain {
        org.verified_domain = String::new();
        org.domain_verified_at = 0;
        org.domain_expires_at = 0;
    }
    emit!(DomainRevoked {
        organization: org.key(),
        domain,
        actor: authority,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
