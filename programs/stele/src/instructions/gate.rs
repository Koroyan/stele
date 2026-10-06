//! Stele Gate (PROTOCOL_SPEC.md §18): acceptance as a precondition for actions in other programs.
//!
//! * `record_gated_acceptance` records a wallet's signed acceptance exactly like `record_acceptance`
//!   (same message, same checks, same nonce and accumulator) and then creates or advances the
//!   holder's [`AccessPass`] for that document. Nothing else can write a pass.
//! * `check_access` is a read-only check that protected programs invoke through a CPI ("strict
//!   mode"): it fails unless the holder signed the transaction and holds a pass that satisfies the
//!   requirement for the given document. Programs that prefer not to CPI can read the same accounts
//!   themselves with the `stele-gate` crate ("check mode").
//!
//! A pass satisfies "current version" only while its version is the document's `current_version`,
//! so publishing a new version makes every older pass outdated at once. The evidence of the older
//! acceptance is untouched; only the permission moves on.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::set_return_data;

use crate::constants::{ACCESS_PASS_SEED, CONFIG_SEED};
use crate::error::SteleError;
use crate::events::AccessPassUpdated;
use crate::instructions::acceptance::{record_signed_acceptance, AcceptanceAccounts};
use crate::state::{
    AccessPass, Document, DocumentVersion, NonceShard, Organization, ProtocolConfig,
};

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
        // `record_signed_acceptance` only accepts the current version, so versions never go back.
        require!(
            version_number >= pass.version_number,
            SteleError::AccessPassOutdated
        );
    }
    pass.version = version_key;
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
        acceptance_id: recorded.acceptance_id,
        accepted_at: recorded.recorded_at,
        slot: recorded.slot,
        version_number,
        acceptance_count: pass.acceptance_count,
        created,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct CheckAccessArgs {
    /// `0`: the pass must name the document's current version. `n > 0`: any accepted version
    /// numbered `n` or later satisfies the requirement.
    pub min_version: u32,
}

#[derive(Accounts)]
pub struct CheckAccess<'info> {
    /// The policy document. The calling program must pin this address: Stele cannot know which
    /// document a third-party action requires.
    pub document: Box<Account<'info, Document>>,
    /// CHECK: validated in the handler (address, owner, type) so that an absent pass fails with
    /// `AccessPassMissing` rather than a generic account error.
    pub access_pass: UncheckedAccount<'info>,
    /// The pass holder must have signed the transaction that performs the protected action.
    pub holder: Signer<'info>,
}

/// Succeeds only for a valid pass of `holder` for `document`. On success the return data is the
/// accepted version's address followed by its number (u32, little-endian).
pub fn check_access(ctx: Context<CheckAccess>, args: CheckAccessArgs) -> Result<()> {
    let document = &ctx.accounts.document;
    let holder = ctx.accounts.holder.key();
    let info = &ctx.accounts.access_pass;

    let (expected, _) = Pubkey::find_program_address(
        &[ACCESS_PASS_SEED, document.key().as_ref(), holder.as_ref()],
        ctx.program_id,
    );
    require_keys_eq!(info.key(), expected, SteleError::AccessPassMismatch);
    if info.data_is_empty() || info.owner != ctx.program_id {
        return err!(SteleError::AccessPassMissing);
    }
    let pass = AccessPass::try_deserialize(&mut &info.try_borrow_data()?[..])?;
    require_keys_eq!(
        pass.document,
        document.key(),
        SteleError::AccessPassMismatch
    );
    require_keys_eq!(pass.holder, holder, SteleError::AccessPassMismatch);

    if args.min_version == 0 {
        require_keys_eq!(
            pass.version,
            document.current_version,
            SteleError::AccessPassOutdated
        );
    } else {
        require!(
            args.min_version <= document.version_count,
            SteleError::InvalidAccessRequirement
        );
        require!(
            pass.version_number >= args.min_version,
            SteleError::AccessPassOutdated
        );
    }

    let mut out = [0u8; 36];
    out[..32].copy_from_slice(pass.version.as_ref());
    out[32..].copy_from_slice(&pass.version_number.to_le_bytes());
    set_return_data(&out);
    Ok(())
}
