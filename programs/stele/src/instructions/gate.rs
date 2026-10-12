//! Stele Gate (PROTOCOL_SPEC.md §18): acceptance as a precondition for actions in other programs.
//!
//! * `create_policy` / `set_policy_requirement` — the organization states which version of one of
//!   its documents a protected action requires (a [`GatePolicy`], one per document).
//! * `record_gated_acceptance` — records a wallet's signed acceptance exactly like
//!   `record_acceptance` (same message, same checks, same nonce and accumulator) and then creates
//!   or advances the holder's [`AccessPass`] for that document. Nothing else can write a pass.
//!
//! Enforcement is not here: the organization's own program reads the pass and the policy and
//! rejects the action unless the requirement is met (`stele_gate::require_current`). Stele is never
//! in the execution path of the protected action.

use anchor_lang::prelude::*;

use crate::authority::{authorize, DOCUMENT_CREATOR_ROLES};
use crate::constants::{ACCESS_PASS_SEED, CONFIG_SEED, MEMBER_SEED, POLICY_SEED};
use crate::error::SteleError;
use crate::events::{AccessPassUpdated, PolicyChanged};
use crate::instructions::acceptance::{record_signed_acceptance, AcceptanceAccounts};
use crate::state::{
    AccessPass, Document, DocumentVersion, GatePolicy, Member, NonceShard, Organization,
    ProtocolConfig,
};

// ---- policies ----------------------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CreatePolicy<'info> {
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
        constraint = document.organization == organization.key() @ SteleError::DocumentOrganizationMismatch
    )]
    pub document: Box<Account<'info, Document>>,
    /// The version the policy requires (must be a published version of `document`).
    #[account(
        constraint = version.document == document.key() @ SteleError::VersionDocumentMismatch
    )]
    pub version: Box<Account<'info, DocumentVersion>>,
    #[account(
        init,
        payer = payer,
        space = 8 + GatePolicy::INIT_SPACE,
        seeds = [POLICY_SEED, document.key().as_ref()],
        bump
    )]
    pub policy: Box<Account<'info, GatePolicy>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn create_policy(ctx: Context<CreatePolicy>) -> Result<()> {
    let a = &ctx.accounts;
    require!(!a.config.paused, SteleError::ProtocolPaused);
    let org_key = a.organization.key();
    let authority = a.authority.key();
    authorize(
        &a.organization,
        &org_key,
        &authority,
        a.membership.as_deref().map(|m| &**m),
        DOCUMENT_CREATOR_ROLES,
        true,
    )?;
    let clock = Clock::get()?;
    let document = a.document.key();
    let (required_version, required_hash) = (a.version.version, a.version.version_hash);
    let policy_key = a.policy.key();
    let policy = &mut ctx.accounts.policy;
    policy.organization = org_key;
    policy.document = document;
    policy.required_version = required_version;
    policy.required_version_hash = required_hash;
    policy.updated_by = authority;
    policy.created_at = clock.unix_timestamp;
    policy.updated_at = clock.unix_timestamp;
    policy.bump = ctx.bumps.policy;
    emit!(PolicyChanged {
        organization: org_key,
        document,
        policy: policy_key,
        required_version_hash: required_hash,
        actor: authority,
        changed_at: clock.unix_timestamp,
        slot: clock.slot,
        required_version,
        previous_required_version: 0,
        created: true,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetPolicyRequirement<'info> {
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
        constraint = document.organization == organization.key() @ SteleError::DocumentOrganizationMismatch
    )]
    pub document: Box<Account<'info, Document>>,
    #[account(
        constraint = version.document == document.key() @ SteleError::VersionDocumentMismatch
    )]
    pub version: Box<Account<'info, DocumentVersion>>,
    #[account(
        mut,
        seeds = [POLICY_SEED, document.key().as_ref()],
        bump = policy.bump,
        constraint = policy.document == document.key() @ SteleError::PolicyMismatch
    )]
    pub policy: Box<Account<'info, GatePolicy>>,
}

/// Changes the version the policy requires (raising it makes every older pass insufficient).
pub fn set_policy_requirement(ctx: Context<SetPolicyRequirement>) -> Result<()> {
    let a = &ctx.accounts;
    require!(!a.config.paused, SteleError::ProtocolPaused);
    let org_key = a.organization.key();
    let authority = a.authority.key();
    authorize(
        &a.organization,
        &org_key,
        &authority,
        a.membership.as_deref().map(|m| &**m),
        DOCUMENT_CREATOR_ROLES,
        true,
    )?;
    require!(
        a.version.version >= 1 && a.version.version <= a.document.version_count,
        SteleError::InvalidPolicyRequirement
    );
    let clock = Clock::get()?;
    let document = a.document.key();
    let (required_version, required_hash) = (a.version.version, a.version.version_hash);
    let policy_key = a.policy.key();
    let policy = &mut ctx.accounts.policy;
    let previous = policy.required_version;
    policy.required_version = required_version;
    policy.required_version_hash = required_hash;
    policy.updated_by = authority;
    policy.updated_at = clock.unix_timestamp;
    emit!(PolicyChanged {
        organization: org_key,
        document,
        policy: policy_key,
        required_version_hash: required_hash,
        actor: authority,
        changed_at: clock.unix_timestamp,
        slot: clock.slot,
        required_version,
        previous_required_version: previous,
        created: false,
    });
    Ok(())
}

// ---- gated acceptance ----------------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RecordGatedAcceptance<'info> {
    /// The shard's designated relayer; pays the fee and, the first time, the pass's rent.
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
    /// CHECK: the wallet that signed the acceptance. Not a transaction signer: the handler requires
    /// it to equal the runtime-verified Ed25519 signer of the acceptance message.
    pub holder: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = relayer,
        space = 8 + AccessPass::INIT_SPACE,
        seeds = [ACCESS_PASS_SEED, document.key().as_ref(), holder.key().as_ref()],
        bump
    )]
    pub access_pass: Box<Account<'info, AccessPass>>,
    pub system_program: Program<'info, System>,
    /// CHECK: address-constrained to the instructions sysvar; read via checked loaders.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn record_gated_acceptance(
    ctx: Context<RecordGatedAcceptance>,
    nonce_index: u32,
    nonce_tag: [u8; 8],
    issued_at: i64,
    expires_at: i64,
) -> Result<()> {
    let a = &ctx.accounts;
    let recorded = record_signed_acceptance(
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
    )?;
    // The pass belongs to whoever signed the acceptance, never to an account the relayer names.
    require_keys_eq!(
        a.holder.key(),
        recorded.signer,
        SteleError::AccessPassMismatch
    );

    let organization = a.organization.key();
    let document = a.document.key();
    let version_key = a.version.key();
    let version_number = a.version.version;
    let version_hash = a.version.version_hash;
    let pass_key = a.access_pass.key();
    let pass = &mut ctx.accounts.access_pass;
    let created = pass.holder == Pubkey::default();
    if created {
        pass.organization = organization;
        pass.document = document;
        pass.holder = recorded.signer;
        pass.first_accepted_at = recorded.recorded_at;
        pass.bump = ctx.bumps.access_pass;
    } else {
        // Seeds bind the pass to (document, holder); these can only differ on a corrupted account.
        require_keys_eq!(pass.document, document, SteleError::AccessPassMismatch);
        require_keys_eq!(pass.holder, recorded.signer, SteleError::AccessPassMismatch);
        // `record_signed_acceptance` only accepts the current version, so versions never go back;
        // and a version the pass already names is not recorded twice (it would prove nothing new).
        require!(
            version_number >= pass.version_number,
            SteleError::AccessPassMismatch
        );
        require!(
            version_number > pass.version_number,
            SteleError::AccessPassAlreadyCurrent
        );
    }
    pass.version = version_key;
    pass.version_hash = version_hash;
    pass.version_number = version_number;
    pass.acceptance_id = recorded.acceptance_id;
    pass.accepted_at = recorded.recorded_at;
    pass.accepted_slot = recorded.slot;
    pass.acceptance_count = pass
        .acceptance_count
        .checked_add(1)
        .ok_or(SteleError::ArithmeticOverflow)?;

    emit!(AccessPassUpdated {
        organization,
        document,
        holder: recorded.signer,
        access_pass: pass_key,
        version: version_key,
        version_hash,
        acceptance_id: recorded.acceptance_id,
        accepted_at: recorded.recorded_at,
        slot: recorded.slot,
        version_number,
        acceptance_count: pass.acceptance_count,
        created,
    });
    Ok(())
}
