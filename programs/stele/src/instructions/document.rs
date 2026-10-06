//! Documents and immutable version publication (PROTOCOL_SPEC.md §6.4 #26–#27, §6.5).

use anchor_lang::prelude::*;
use stele_core::constants::{
    MAX_EFFECTIVE_AT_HORIZON, PUBLISHER_ROLE_MEMBER, PUBLISHER_ROLE_OWNER,
};
use stele_core::validate::{
    validate_document_type, validate_locale, validate_slug, validate_storage_uri, validate_title,
    validate_version_label,
};
use stele_core::version::{version_hash, VersionFields};

use crate::authority::{authorize, Actor, DOCUMENT_CREATOR_ROLES, PUBLISHER_ROLES};
use crate::constants::{CONFIG_SEED, DOCUMENT_SEED, MEMBER_SEED, VERSION_SEED};
use crate::error::SteleError;
use crate::events::*;
use crate::state::{Document, DocumentVersion, Member, Organization, ProtocolConfig};

// ---- create_document ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateDocumentArgs {
    pub slug: String,
    pub document_type: String,
    pub locale: String,
}

#[derive(Accounts)]
#[instruction(args: CreateDocumentArgs)]
pub struct CreateDocument<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [MEMBER_SEED, organization.key().as_ref(), authority.key().as_ref()],
        bump = membership.bump
    )]
    pub membership: Option<Box<Account<'info, Member>>>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(mut)]
    pub organization: Box<Account<'info, Organization>>,
    #[account(
        init,
        payer = payer,
        space = 8 + Document::INIT_SPACE,
        seeds = [DOCUMENT_SEED, organization.key().as_ref(), args.slug.as_bytes()],
        bump
    )]
    pub document: Box<Account<'info, Document>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn create_document(ctx: Context<CreateDocument>, args: CreateDocumentArgs) -> Result<()> {
    require!(!ctx.accounts.config.paused, SteleError::ProtocolPaused);
    validate_slug(&args.slug).map_err(|_| SteleError::InvalidSlug)?;
    validate_document_type(&args.document_type).map_err(|_| SteleError::InvalidDocumentType)?;
    validate_locale(&args.locale).map_err(|_| SteleError::InvalidLocale)?;

    let org_key = ctx.accounts.organization.key();
    let authority = ctx.accounts.authority.key();
    authorize(
        &ctx.accounts.organization,
        &org_key,
        &authority,
        ctx.accounts.membership.as_deref().map(|m| &**m),
        DOCUMENT_CREATOR_ROLES,
        true,
    )?;

    let timestamp = Clock::get()?.unix_timestamp;
    let document = &mut ctx.accounts.document;
    document.organization = org_key;
    document.created_by = authority;
    document.head_hash = [0u8; 32];
    document.current_version = Pubkey::default();
    document.created_at = timestamp;
    document.last_published_at = 0;
    document.version_count = 0;
    document.bump = ctx.bumps.document;
    document.slug = args.slug.clone();
    document.document_type = args.document_type.clone();
    document.locale = args.locale.clone();

    let org = &mut ctx.accounts.organization;
    org.document_count = org
        .document_count
        .checked_add(1)
        .ok_or(SteleError::ArithmeticOverflow)?;

    emit!(DocumentCreated {
        organization: org_key,
        document: document.key(),
        slug: args.slug,
        document_type: args.document_type,
        locale: args.locale,
        created_by: authority,
        timestamp,
    });
    Ok(())
}

// ---- publish_version ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PublishVersionArgs {
    pub version: u32,
    pub previous_version_hash: [u8; 32],
    pub content_hash: [u8; 32],
    pub title: String,
    pub version_label: String,
    pub effective_at: i64,
    pub storage_uri: String,
    /// The fingerprint the publisher reviewed. Publication fails unless the program computes
    /// exactly this value.
    pub expected_version_hash: [u8; 32],
}

#[derive(Accounts)]
#[instruction(args: PublishVersionArgs)]
pub struct PublishVersion<'info> {
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
        mut,
        constraint = document.organization == organization.key() @ SteleError::DocumentOrganizationMismatch
    )]
    pub document: Box<Account<'info, Document>>,
    #[account(
        init,
        payer = payer,
        space = 8 + DocumentVersion::INIT_SPACE,
        seeds = [VERSION_SEED, document.key().as_ref(), &args.version.to_le_bytes()],
        bump
    )]
    pub version: Box<Account<'info, DocumentVersion>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn publish_version(ctx: Context<PublishVersion>, args: PublishVersionArgs) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, SteleError::ProtocolPaused);

    let org_key = ctx.accounts.organization.key();
    let authority = ctx.accounts.authority.key();
    let actor = authorize(
        &ctx.accounts.organization,
        &org_key,
        &authority,
        ctx.accounts.membership.as_deref().map(|m| &**m),
        PUBLISHER_ROLES,
        true,
    )?;

    // Optimistic concurrency, enforced on-chain: exactly the next number, exactly the current head.
    let document = &ctx.accounts.document;
    let expected_number = document
        .version_count
        .checked_add(1)
        .ok_or(SteleError::ArithmeticOverflow)?;
    require!(
        args.version == expected_number,
        SteleError::InvalidVersionNumber
    );
    require!(
        args.previous_version_hash == document.head_hash,
        SteleError::PreviousVersionHashMismatch
    );

    validate_title(&args.title).map_err(|_| SteleError::InvalidTitle)?;
    validate_version_label(&args.version_label).map_err(|_| SteleError::InvalidVersionLabel)?;
    validate_storage_uri(&args.storage_uri).map_err(|_| SteleError::InvalidStorageUri)?;

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    if args.effective_at != 0 {
        let horizon = now
            .checked_add(MAX_EFFECTIVE_AT_HORIZON)
            .ok_or(SteleError::ArithmeticOverflow)?;
        require!(
            args.effective_at >= now && args.effective_at <= horizon,
            SteleError::InvalidEffectiveAt
        );
    }

    // The fingerprint is computed here, from on-chain values and validated arguments only.
    let document_key = document.key();
    let program_id = crate::ID.to_bytes();
    let org_bytes = org_key.to_bytes();
    let document_bytes = document_key.to_bytes();
    let previous = if args.version == 1 {
        None
    } else {
        Some(&args.previous_version_hash)
    };
    let computed = version_hash(&VersionFields {
        chain_id: &config.chain_id,
        program: &program_id,
        organization: &org_bytes,
        document: &document_bytes,
        document_type: &document.document_type,
        locale: &document.locale,
        version: args.version,
        previous_version_hash: previous,
        title: &args.title,
        version_label: &args.version_label,
        effective_at: args.effective_at,
        content_hash: &args.content_hash,
    });
    require!(
        computed == args.expected_version_hash,
        SteleError::VersionHashMismatch
    );

    let publisher_role = match actor {
        Actor::Owner => PUBLISHER_ROLE_OWNER,
        Actor::Member(_) => PUBLISHER_ROLE_MEMBER,
    };

    let version = &mut ctx.accounts.version;
    version.document = document_key;
    version.organization = org_key;
    version.version_hash = computed;
    version.content_hash = args.content_hash;
    version.previous_version_hash = args.previous_version_hash;
    version.publisher = authority;
    version.effective_at = args.effective_at;
    version.published_at = now;
    version.published_slot = clock.slot;
    version.version = args.version;
    version.publisher_role = publisher_role;
    version.bump = ctx.bumps.version;
    version.title = args.title;
    version.version_label = args.version_label;
    version.storage_uri = args.storage_uri;
    let version_key = version.key();

    let document = &mut ctx.accounts.document;
    document.head_hash = computed;
    document.current_version = version_key;
    document.version_count = args.version;
    document.last_published_at = now;

    emit!(VersionPublished {
        organization: org_key,
        document: document_key,
        version_account: version_key,
        publisher: authority,
        version_hash: computed,
        content_hash: args.content_hash,
        previous_version_hash: args.previous_version_hash,
        effective_at: args.effective_at,
        published_at: now,
        slot: clock.slot,
        version: args.version,
        publisher_role,
    });
    Ok(())
}
