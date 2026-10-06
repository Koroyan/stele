//! Native passkey signers (stele/2, PROTOCOL_SPEC.md §17): acceptances signed by a WebAuthn ES256
//! credential through the platform authenticator, verified by Solana's secp256r1 precompile, and
//! the on-chain enrollment that binds such a key to an account of an organization.
//!
//! Nothing is taken on trust from the transaction submitter:
//! * the public key, signature and signed bytes come from the runtime-verified secp256r1
//!   instruction immediately preceding this one (`secp256r1.rs`);
//! * the signed bytes must be `authenticatorData ‖ SHA-256(clientDataJSON)` for a user-verified
//!   assertion whose challenge is the hash of the message rebuilt here from on-chain state, whose
//!   browser-attested origin is the requesting site, and whose relying party covers it;
//! * an enrollment, when given, must belong to the organization, be active and name this key;
//! * the nonce bit is consumed exactly as for stele/1 acceptances.
//!
//! Enrollment changes leave the previous key on record: rotation needs the previous key's own
//! signature, organization recovery needs the organization's authority and is a different kind,
//! and no instruction can make a later key appear to have signed an earlier acceptance.

use anchor_lang::prelude::*;
use stele_core::acceptance::{accumulate, bitmap_try_set};
use stele_core::constants::{MAX_ISSUED_AT_SKEW, ROLE_ADMIN, SHARD_CAPACITY};
use stele_core::hash::sha256;
use stele_core::passkey::{
    check_assertion, enrollment_statement, is_compressed_p256_key, passkey_acceptance_id,
    passkey_acceptance_message, rotation_statement, webauthn_challenge, AssertionFacts,
    PasskeyAcceptanceFields, PASSKEY_ACCEPTANCE_TAG, PASSKEY_ENROLL_TAG, PASSKEY_ROTATE_TAG,
};
use stele_core::CoreError;

use crate::authority::authorize;
use crate::constants::{CONFIG_SEED, MEMBER_SEED, PASSKEY_SIGNER_SEED};
use crate::error::SteleError;
use crate::events::{PasskeyAcceptanceRecorded, PasskeySignerChanged};
use crate::instructions::acceptance::check_validity_window;
use crate::instructions::sponsor::{reimburse, SPONSORED_SIGNATURES};
use crate::secp256r1::{load_preceding_secp256r1, VerifiedP256};
use crate::state::{
    Document, DocumentVersion, Member, NonceShard, Organization, PasskeySigner, ProtocolConfig,
    PASSKEY_KIND_ENROLLED, PASSKEY_KIND_ORGANIZATION_RECOVERY, PASSKEY_KIND_ROTATED,
    PASSKEY_STATUS_ACTIVE, PASSKEY_STATUS_REVOKED,
};

/// The WebAuthn evidence that accompanies a secp256r1 signature. The authenticator data travels in
/// the precompile instruction (it is part of the signed bytes).
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PasskeyAssertion {
    /// Hostname of the page that ran the ceremony; must equal the browser-attested origin's host.
    pub request_domain: String,
    /// The WebAuthn relying-party ID the credential is scoped to.
    pub rp_id: String,
    /// The exact `clientDataJSON` bytes the browser produced.
    pub client_data_json: Vec<u8>,
}

fn core_error(e: CoreError) -> Error {
    match e {
        CoreError::InvalidClientData => SteleError::InvalidClientData,
        CoreError::OriginMismatch => SteleError::OriginMismatch,
        CoreError::CrossOriginCeremony => SteleError::CrossOriginCeremony,
        CoreError::InvalidAuthenticatorData => SteleError::InvalidAuthenticatorData,
        CoreError::RelyingPartyMismatch => SteleError::RelyingPartyMismatch,
        CoreError::UserNotVerified => SteleError::UserNotVerified,
        CoreError::ClientDataHashMismatch => SteleError::ClientDataHashMismatch,
        CoreError::InvalidTimestamp => SteleError::InvalidTimestamp,
        _ => SteleError::InvalidRequestDomain,
    }
    .into()
}

/// The verified secp256r1 signature preceding this instruction, with its WebAuthn binding to
/// `statement` under `tag`.
fn verify_passkey<'a>(
    instructions_sysvar: &AccountInfo,
    tag: &[u8],
    statement: impl FnOnce(&[u8; 33]) -> Result<String>,
    assertion: &'a PasskeyAssertion,
    signed: &'a mut Option<VerifiedP256>,
) -> Result<(String, AssertionFacts<'a>)> {
    let verified: &'a VerifiedP256 = signed.insert(load_preceding_secp256r1(instructions_sysvar)?);
    require!(
        is_compressed_p256_key(&verified.public_key),
        SteleError::InvalidSignerKey
    );
    let text = statement(&verified.public_key)?;
    let challenge = webauthn_challenge(tag, text.as_bytes());
    let facts = check_assertion(
        &verified.message,
        &assertion.client_data_json,
        &challenge,
        &assertion.request_domain,
        &assertion.rp_id,
    )
    .map_err(core_error)?;
    Ok((text, facts))
}

// ---- record_passkey_acceptance ------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RecordPasskeyAcceptanceArgs {
    pub nonce_index: u32,
    pub nonce_tag: [u8; 8],
    pub issued_at: i64,
    pub expires_at: i64,
    pub assertion: PasskeyAssertion,
}

#[derive(Accounts)]
pub struct RecordPasskeyAcceptance<'info> {
    /// The shard's designated relayer (any signer for open shards). Pays the fee; the user never
    /// does. Writable so that a sponsored shard can reimburse it.
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
    /// The signer's enrollment, for acceptances made under an enrolled account.
    #[account(
        constraint = enrollment.organization == organization.key() @ SteleError::EnrollmentMismatch
    )]
    pub enrollment: Option<Box<Account<'info, PasskeySigner>>>,
    /// CHECK: address-constrained to the instructions sysvar; read via checked loaders.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn record_passkey_acceptance(
    ctx: Context<RecordPasskeyAcceptance>,
    args: RecordPasskeyAcceptanceArgs,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let config = &ctx.accounts.config;
    let org = &ctx.accounts.organization;
    let document = &ctx.accounts.document;
    let version = &ctx.accounts.version;

    require!(!config.paused, SteleError::ProtocolPaused);
    require!(!org.frozen, SteleError::OrganizationFrozen);
    require_keys_eq!(
        document.current_version,
        version.key(),
        SteleError::VersionNotCurrent
    );
    check_validity_window(now, args.issued_at, args.expires_at)?;
    let issued_plus_skew = args
        .issued_at
        .checked_add(MAX_ISSUED_AT_SKEW)
        .ok_or(SteleError::ArithmeticOverflow)?;
    require!(
        issued_plus_skew >= version.published_at,
        SteleError::IssuedBeforePublication
    );
    require!(
        args.nonce_index < SHARD_CAPACITY,
        SteleError::NonceOutOfRange
    );

    let shard_key = ctx.accounts.nonce_shard.key();
    let mut shard = ctx.accounts.nonce_shard.load_mut()?;
    require_keys_eq!(
        shard.organization,
        org.key(),
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
    let shard_id = shard.shard_id;

    // The runtime-verified signature, bound to the message rebuilt from on-chain state.
    let mut signed = None;
    let (message, facts) = verify_passkey(
        &ctx.accounts.instructions_sysvar.to_account_info(),
        PASSKEY_ACCEPTANCE_TAG,
        |signer| {
            let fields = PasskeyAcceptanceFields {
                org_name: &org.name,
                org_verified_domain: org.verified_domain_at(now),
                title: &version.title,
                version_label: &version.version_label,
                version: version.version,
                version_hash: &version.version_hash,
                signer,
                network_label: &config.network_label,
                issued_at: args.issued_at,
                expires_at: args.expires_at,
                shard_id,
                nonce_index: args.nonce_index,
                nonce_tag: &args.nonce_tag,
            };
            passkey_acceptance_message(&fields, &args.assertion.request_domain)
                .map_err(|_| error!(SteleError::InvalidRequestDomain))
        },
        &args.assertion,
        &mut signed,
    )?;
    let flags = facts.flags;
    let client_data_hash = facts.client_data_hash;
    let verified = signed
        .as_ref()
        .ok_or(SteleError::MissingSecp256r1Instruction)?;
    let rp_id_hash = sha256(args.assertion.rp_id.as_bytes());

    let enrollment_key = match &ctx.accounts.enrollment {
        Some(enrollment) => {
            require!(
                enrollment.status == PASSKEY_STATUS_ACTIVE,
                SteleError::EnrollmentNotActive
            );
            require!(
                enrollment.signer_key == verified.public_key,
                SteleError::EnrollmentMismatch
            );
            require!(
                enrollment.rp_id_hash == rp_id_hash,
                SteleError::RelyingPartyMismatch
            );
            enrollment.key()
        }
        None => Pubkey::default(),
    };

    // Replay protection, identifier and completeness accumulator (shared with stele/1).
    require!(
        bitmap_try_set(&mut shard.bitmap, args.nonce_index),
        SteleError::NonceAlreadyUsed
    );
    let message_hash = sha256(message.as_bytes());
    let version_key = version.key();
    let id = passkey_acceptance_id(
        &version_key.to_bytes(),
        &verified.public_key,
        &message_hash,
        &verified.signature,
    );
    shard.accumulator = accumulate(&shard.accumulator, &id);
    shard.accepted_count = shard
        .accepted_count
        .checked_add(1)
        .ok_or(SteleError::ArithmeticOverflow)?;

    emit!(PasskeyAcceptanceRecorded {
        organization: org.key(),
        document: document.key(),
        version: version_key,
        signer_key: verified.public_key,
        enrollment: enrollment_key,
        nonce_shard: shard_key,
        acceptance_id: id,
        message_hash,
        client_data_hash,
        rp_id_hash,
        accumulator: shard.accumulator,
        issued_at: args.issued_at,
        expires_at: args.expires_at,
        recorded_at: now,
        slot: clock.slot,
        sequence: shard.accepted_count,
        nonce_index: args.nonce_index,
        shard_id,
        authenticator_flags: flags,
    });
    drop(shard);

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

// ---- enroll_passkey_signer ------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct EnrollPasskeySignerArgs {
    /// Salted commitment to the organization's account identifier (never personal data).
    pub account_commitment: [u8; 32],
    pub credential_id_hash: [u8; 32],
    pub issued_at: i64,
    pub expires_at: i64,
    pub assertion: PasskeyAssertion,
}

#[derive(Accounts)]
#[instruction(args: EnrollPasskeySignerArgs)]
pub struct EnrollPasskeySigner<'info> {
    /// Pays the enrollment's rent (the user pays nothing). Must be a relayer the organization
    /// designated on one of its nonce shards (or any signer when that shard is open).
    #[account(mut)]
    pub relayer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    pub organization: Box<Account<'info, Organization>>,
    pub nonce_shard: AccountLoader<'info, NonceShard>,
    #[account(
        init,
        payer = relayer,
        space = 8 + PasskeySigner::INIT_SPACE,
        seeds = [PASSKEY_SIGNER_SEED, organization.key().as_ref(), &args.account_commitment],
        bump
    )]
    pub enrollment: Box<Account<'info, PasskeySigner>>,
    pub system_program: Program<'info, System>,
    /// CHECK: address-constrained to the instructions sysvar; read via checked loaders.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn enroll_passkey_signer(
    ctx: Context<EnrollPasskeySigner>,
    args: EnrollPasskeySignerArgs,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let config = &ctx.accounts.config;
    let org = &ctx.accounts.organization;
    require!(!config.paused, SteleError::ProtocolPaused);
    require!(!org.frozen, SteleError::OrganizationFrozen);
    require!(
        args.account_commitment != [0u8; 32],
        SteleError::InvalidAccountCommitment
    );
    check_validity_window(now, args.issued_at, args.expires_at)?;
    {
        let shard = ctx.accounts.nonce_shard.load()?;
        require_keys_eq!(
            shard.organization,
            org.key(),
            SteleError::ShardOrganizationMismatch
        );
        if shard.relayer != Pubkey::default() {
            require_keys_eq!(
                shard.relayer,
                ctx.accounts.relayer.key(),
                SteleError::UnauthorizedRelayer
            );
        }
    }

    let org_key = org.key();
    let mut signed = None;
    verify_passkey(
        &ctx.accounts.instructions_sysvar.to_account_info(),
        PASSKEY_ENROLL_TAG,
        |signer| {
            enrollment_statement(
                &org_key.to_bytes(),
                &args.account_commitment,
                signer,
                &args.assertion.rp_id,
                &config.network_label,
                args.issued_at,
                args.expires_at,
            )
            .map_err(core_error)
        },
        &args.assertion,
        &mut signed,
    )?;
    let verified = signed
        .as_ref()
        .ok_or(SteleError::MissingSecp256r1Instruction)?;

    let enrollment = &mut ctx.accounts.enrollment;
    enrollment.organization = org_key;
    enrollment.account_commitment = args.account_commitment;
    enrollment.signer_key = verified.public_key;
    enrollment.previous_key = [0u8; 33];
    enrollment.rp_id_hash = sha256(args.assertion.rp_id.as_bytes());
    enrollment.credential_id_hash = args.credential_id_hash;
    enrollment.enrolled_at = now;
    enrollment.updated_at = now;
    enrollment.generation = 1;
    enrollment.status = PASSKEY_STATUS_ACTIVE;
    enrollment.kind = PASSKEY_KIND_ENROLLED;
    enrollment.bump = ctx.bumps.enrollment;
    emit_change(enrollment, ctx.accounts.relayer.key(), now, clock.slot);
    Ok(())
}

fn emit_change(e: &Account<PasskeySigner>, actor: Pubkey, now: i64, slot: u64) {
    emit!(PasskeySignerChanged {
        organization: e.organization,
        enrollment: e.key(),
        account_commitment: e.account_commitment,
        signer_key: e.signer_key,
        previous_key: e.previous_key,
        rp_id_hash: e.rp_id_hash,
        credential_id_hash: e.credential_id_hash,
        actor,
        changed_at: now,
        slot,
        generation: e.generation,
        kind: e.kind,
        status: e.status,
    });
}

// ---- rotate_passkey_signer (the previous key signs) -----------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RotatePasskeySignerArgs {
    pub new_signer: [u8; 33],
    pub new_credential_id_hash: [u8; 32],
    pub issued_at: i64,
    pub expires_at: i64,
    /// The **current** key's assertion over the rotation statement.
    pub assertion: PasskeyAssertion,
}

#[derive(Accounts)]
pub struct RotatePasskeySigner<'info> {
    pub relayer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    pub organization: Box<Account<'info, Organization>>,
    #[account(
        mut,
        constraint = enrollment.organization == organization.key() @ SteleError::EnrollmentMismatch
    )]
    pub enrollment: Box<Account<'info, PasskeySigner>>,
    /// CHECK: address-constrained to the instructions sysvar; read via checked loaders.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn rotate_passkey_signer(
    ctx: Context<RotatePasskeySigner>,
    args: RotatePasskeySignerArgs,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let config = &ctx.accounts.config;
    require!(!config.paused, SteleError::ProtocolPaused);
    check_validity_window(now, args.issued_at, args.expires_at)?;
    let current = {
        let e = &ctx.accounts.enrollment;
        require!(
            e.status == PASSKEY_STATUS_ACTIVE,
            SteleError::EnrollmentNotActive
        );
        e.signer_key
    };
    require!(
        is_compressed_p256_key(&args.new_signer) && args.new_signer != current,
        SteleError::InvalidSignerKey
    );
    require!(
        sha256(args.assertion.rp_id.as_bytes()) == ctx.accounts.enrollment.rp_id_hash,
        SteleError::RelyingPartyMismatch
    );

    let org_key = ctx.accounts.organization.key();
    let commitment = ctx.accounts.enrollment.account_commitment;
    let mut signed = None;
    verify_passkey(
        &ctx.accounts.instructions_sysvar.to_account_info(),
        PASSKEY_ROTATE_TAG,
        |signer| {
            rotation_statement(
                &org_key.to_bytes(),
                &commitment,
                signer,
                &args.new_signer,
                &config.network_label,
                args.issued_at,
                args.expires_at,
            )
            .map_err(core_error)
        },
        &args.assertion,
        &mut signed,
    )?;
    let verified = signed
        .as_ref()
        .ok_or(SteleError::MissingSecp256r1Instruction)?;
    require!(
        verified.public_key == current,
        SteleError::EnrollmentMismatch
    );

    let e = &mut ctx.accounts.enrollment;
    e.previous_key = current;
    e.signer_key = args.new_signer;
    e.credential_id_hash = args.new_credential_id_hash;
    e.updated_at = now;
    e.generation = e
        .generation
        .checked_add(1)
        .ok_or(SteleError::ArithmeticOverflow)?;
    e.kind = PASSKEY_KIND_ROTATED;
    emit_change(e, ctx.accounts.relayer.key(), now, clock.slot);
    Ok(())
}

// ---- recover / revoke (the organization's authority, without the previous key) --------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RecoverPasskeySignerArgs {
    pub new_signer: [u8; 33],
    pub new_credential_id_hash: [u8; 32],
    pub rp_id_hash: [u8; 32],
}

#[derive(Accounts)]
pub struct ManagePasskeySigner<'info> {
    /// The organization's owner or an admin member (their own wallet, never the relayer).
    pub authority: Signer<'info>,
    #[account(
        seeds = [MEMBER_SEED, organization.key().as_ref(), authority.key().as_ref()],
        bump = membership.bump
    )]
    pub membership: Option<Box<Account<'info, Member>>>,
    pub organization: Box<Account<'info, Organization>>,
    #[account(
        mut,
        constraint = enrollment.organization == organization.key() @ SteleError::EnrollmentMismatch
    )]
    pub enrollment: Box<Account<'info, PasskeySigner>>,
}

pub fn recover_passkey_signer(
    ctx: Context<ManagePasskeySigner>,
    args: RecoverPasskeySignerArgs,
) -> Result<()> {
    let clock = Clock::get()?;
    let org = &ctx.accounts.organization;
    authorize(
        org,
        &org.key(),
        &ctx.accounts.authority.key(),
        ctx.accounts.membership.as_deref().map(|m| &**m),
        ROLE_ADMIN,
        false,
    )?;
    require!(
        is_compressed_p256_key(&args.new_signer)
            && args.new_signer != ctx.accounts.enrollment.signer_key,
        SteleError::InvalidSignerKey
    );
    let e = &mut ctx.accounts.enrollment;
    e.previous_key = e.signer_key;
    e.signer_key = args.new_signer;
    e.credential_id_hash = args.new_credential_id_hash;
    e.rp_id_hash = args.rp_id_hash;
    e.updated_at = clock.unix_timestamp;
    e.generation = e
        .generation
        .checked_add(1)
        .ok_or(SteleError::ArithmeticOverflow)?;
    e.kind = PASSKEY_KIND_ORGANIZATION_RECOVERY;
    e.status = PASSKEY_STATUS_ACTIVE;
    emit_change(
        e,
        ctx.accounts.authority.key(),
        clock.unix_timestamp,
        clock.slot,
    );
    Ok(())
}

pub fn revoke_passkey_signer(ctx: Context<ManagePasskeySigner>) -> Result<()> {
    let clock = Clock::get()?;
    let org = &ctx.accounts.organization;
    authorize(
        org,
        &org.key(),
        &ctx.accounts.authority.key(),
        ctx.accounts.membership.as_deref().map(|m| &**m),
        ROLE_ADMIN,
        false,
    )?;
    let e = &mut ctx.accounts.enrollment;
    require!(
        e.status == PASSKEY_STATUS_ACTIVE,
        SteleError::EnrollmentNotActive
    );
    e.status = PASSKEY_STATUS_REVOKED;
    e.updated_at = clock.unix_timestamp;
    emit_change(
        e,
        ctx.accounts.authority.key(),
        clock.unix_timestamp,
        clock.slot,
    );
    Ok(())
}
