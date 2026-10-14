//! # Stele program
//!
//! Immutable, chained document versions and on-chain-verified acceptance records.
//!
//! * Normative specification: `PROTOCOL_SPEC.md`
//! * Threat model: `SECURITY_THREAT_MODEL.md`
//!
//! Security invariants enforced here (see each instruction module for detail):
//! 1. `DocumentVersion` accounts are created once and never modified or closed.
//! 2. Version `n` must reference the fingerprint of version `n-1`; the program computes every
//!    fingerprint itself from on-chain values.
//! 3. Only the organization owner or an active publisher can publish; only the current version
//!    can be accepted.
//! 4. Acceptance requires a runtime-verified Ed25519 signature over a message the program
//!    reconstructs; each signed message consumes a nonce bit and can be recorded once.
//! 5. All times come from the cluster clock.
//! 6. Proofs (`record_proof`) follow the same rules as acceptances, over a statement hash.
//! 7. Fee sponsorship never changes who authorized a record: a sponsored nonce shard only
//!    reimburses its designated relayer the network fee of a recording already verified.

use anchor_lang::prelude::*;

pub mod authority;
pub mod constants;
pub mod ed25519;
pub mod error;
pub mod events;
pub mod instructions;
pub mod secp256r1;
pub mod state;

use instructions::*;

declare_id!("6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV");

#[program]
pub mod stele {
    use super::*;

    // ---- protocol ------------------------------------------------------------------------------

    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        args: InitializeProtocolArgs,
    ) -> Result<()> {
        instructions::protocol::initialize_protocol(ctx, args)
    }

    pub fn set_protocol_paused(ctx: Context<ProtocolAdmin>, paused: bool) -> Result<()> {
        instructions::protocol::set_protocol_paused(ctx, paused)
    }

    pub fn set_domain_attestor(ctx: Context<ProtocolAdmin>, attestor: Pubkey) -> Result<()> {
        instructions::protocol::set_domain_attestor(ctx, attestor)
    }

    pub fn propose_protocol_admin(ctx: Context<ProtocolAdmin>, new_admin: Pubkey) -> Result<()> {
        instructions::protocol::propose_protocol_admin(ctx, new_admin)
    }

    pub fn accept_protocol_admin(ctx: Context<ProtocolAdmin>) -> Result<()> {
        instructions::protocol::accept_protocol_admin(ctx)
    }

    // ---- organization --------------------------------------------------------------------------

    pub fn create_organization(
        ctx: Context<CreateOrganization>,
        args: CreateOrganizationArgs,
    ) -> Result<()> {
        instructions::organization::create_organization(ctx, args)
    }

    pub fn update_organization(ctx: Context<OrganizationAuthority>, name: String) -> Result<()> {
        instructions::organization::update_organization(ctx, name)
    }

    pub fn propose_owner(ctx: Context<OrganizationAuthority>, new_owner: Pubkey) -> Result<()> {
        instructions::organization::propose_owner(ctx, new_owner)
    }

    pub fn accept_ownership(ctx: Context<OrganizationAuthority>) -> Result<()> {
        instructions::organization::accept_ownership(ctx)
    }

    pub fn cancel_owner_transfer(ctx: Context<OrganizationAuthority>) -> Result<()> {
        instructions::organization::cancel_owner_transfer(ctx)
    }

    pub fn propose_recovery(
        ctx: Context<OrganizationAuthority>,
        new_recovery: Option<Pubkey>,
    ) -> Result<()> {
        instructions::organization::propose_recovery(ctx, new_recovery)
    }

    pub fn apply_recovery_change(ctx: Context<OrganizationAuthority>) -> Result<()> {
        instructions::organization::apply_recovery_change(ctx)
    }

    pub fn cancel_recovery_change(ctx: Context<OrganizationAuthority>) -> Result<()> {
        instructions::organization::cancel_recovery_change(ctx)
    }

    pub fn freeze_organization(ctx: Context<OrganizationAuthority>) -> Result<()> {
        instructions::organization::freeze_organization(ctx)
    }

    pub fn unfreeze_organization(ctx: Context<OrganizationAuthority>) -> Result<()> {
        instructions::organization::unfreeze_organization(ctx)
    }

    pub fn initiate_owner_recovery(
        ctx: Context<OrganizationAuthority>,
        new_owner: Pubkey,
    ) -> Result<()> {
        instructions::organization::initiate_owner_recovery(ctx, new_owner)
    }

    pub fn cancel_owner_recovery(ctx: Context<OrganizationAuthority>) -> Result<()> {
        instructions::organization::cancel_owner_recovery(ctx)
    }

    pub fn execute_owner_recovery(ctx: Context<OrganizationAuthority>) -> Result<()> {
        instructions::organization::execute_owner_recovery(ctx)
    }

    // ---- members -------------------------------------------------------------------------------

    pub fn add_member(ctx: Context<AddMember>, args: AddMemberArgs) -> Result<()> {
        instructions::member::add_member(ctx, args)
    }

    pub fn update_member(ctx: Context<ManageMember>, roles: u8) -> Result<()> {
        instructions::member::update_member(ctx, roles)
    }

    pub fn revoke_member(ctx: Context<ManageMember>) -> Result<()> {
        instructions::member::revoke_member(ctx)
    }

    pub fn report_key_compromise(ctx: Context<ManageMember>, compromised_since: i64) -> Result<()> {
        instructions::member::report_key_compromise(ctx, compromised_since)
    }

    // ---- domains -------------------------------------------------------------------------------

    pub fn attest_domain(ctx: Context<AttestDomain>, args: AttestDomainArgs) -> Result<()> {
        instructions::domain::attest_domain(ctx, args)
    }

    pub fn renew_domain(ctx: Context<RenewDomain>, expires_at: i64) -> Result<()> {
        instructions::domain::renew_domain(ctx, expires_at)
    }

    pub fn revoke_domain(ctx: Context<RevokeDomain>) -> Result<()> {
        instructions::domain::revoke_domain(ctx)
    }

    // ---- documents -----------------------------------------------------------------------------

    pub fn create_document(ctx: Context<CreateDocument>, args: CreateDocumentArgs) -> Result<()> {
        instructions::document::create_document(ctx, args)
    }

    pub fn publish_version(ctx: Context<PublishVersion>, args: PublishVersionArgs) -> Result<()> {
        instructions::document::publish_version(ctx, args)
    }

    // ---- acceptance ----------------------------------------------------------------------------

    pub fn create_nonce_shard(
        ctx: Context<CreateNonceShard>,
        args: CreateNonceShardArgs,
    ) -> Result<()> {
        instructions::shard::create_nonce_shard(ctx, args)
    }

    pub fn set_shard_relayer(ctx: Context<SetShardRelayer>, relayer: Pubkey) -> Result<()> {
        instructions::shard::set_shard_relayer(ctx, relayer)
    }

    pub fn record_acceptance(
        ctx: Context<RecordAcceptance>,
        nonce_index: u32,
        nonce_tag: [u8; 8],
        issued_at: i64,
        expires_at: i64,
    ) -> Result<()> {
        instructions::acceptance::record_acceptance(
            ctx,
            nonce_index,
            nonce_tag,
            issued_at,
            expires_at,
        )
    }

    pub fn record_proof(ctx: Context<RecordProof>, args: RecordProofArgs) -> Result<()> {
        instructions::proof::record_proof(ctx, args)
    }

    // ---- native passkeys (stele/2) ------------------------------------------------------------

    pub fn record_passkey_acceptance(
        ctx: Context<RecordPasskeyAcceptance>,
        args: RecordPasskeyAcceptanceArgs,
    ) -> Result<()> {
        instructions::passkey::record_passkey_acceptance(ctx, args)
    }

    pub fn enroll_passkey_signer(
        ctx: Context<EnrollPasskeySigner>,
        args: EnrollPasskeySignerArgs,
    ) -> Result<()> {
        instructions::passkey::enroll_passkey_signer(ctx, args)
    }

    pub fn rotate_passkey_signer(
        ctx: Context<RotatePasskeySigner>,
        args: RotatePasskeySignerArgs,
    ) -> Result<()> {
        instructions::passkey::rotate_passkey_signer(ctx, args)
    }

    pub fn recover_passkey_signer(
        ctx: Context<ManagePasskeySigner>,
        args: RecoverPasskeySignerArgs,
    ) -> Result<()> {
        instructions::passkey::recover_passkey_signer(ctx, args)
    }

    pub fn revoke_passkey_signer(ctx: Context<ManagePasskeySigner>) -> Result<()> {
        instructions::passkey::revoke_passkey_signer(ctx)
    }

    // ---- fee sponsorship -----------------------------------------------------------------------

    pub fn enable_shard_sponsorship(
        ctx: Context<EnableShardSponsorship>,
        limits: SponsorLimits,
    ) -> Result<()> {
        instructions::sponsor::enable_shard_sponsorship(ctx, limits)
    }

    pub fn update_shard_sponsorship(
        ctx: Context<UpdateShardSponsorship>,
        args: UpdateShardSponsorshipArgs,
    ) -> Result<()> {
        instructions::sponsor::update_shard_sponsorship(ctx, args)
    }

    pub fn withdraw_shard_sponsorship(
        ctx: Context<WithdrawShardSponsorship>,
        amount: u64,
    ) -> Result<()> {
        instructions::sponsor::withdraw_shard_sponsorship(ctx, amount)
    }

    // ---- Merkle-batched acceptances ------------------------------------------------------------

    pub fn anchor_acceptance_batch(
        ctx: Context<AnchorAcceptanceBatch>,
        args: AnchorAcceptanceBatchArgs,
    ) -> Result<()> {
        instructions::batch::anchor_acceptance_batch(ctx, args)
    }

    // ---- Stele Gate ----------------------------------------------------------------------------

    pub fn record_gated_acceptance(
        ctx: Context<RecordGatedAcceptance>,
        nonce_index: u32,
        nonce_tag: [u8; 8],
        issued_at: i64,
        expires_at: i64,
    ) -> Result<()> {
        instructions::gate::record_gated_acceptance(
            ctx,
            nonce_index,
            nonce_tag,
            issued_at,
            expires_at,
        )
    }

    pub fn create_policy(ctx: Context<CreatePolicy>) -> Result<()> {
        instructions::gate::create_policy(ctx)
    }

    pub fn set_policy_requirement(ctx: Context<SetPolicyRequirement>) -> Result<()> {
        instructions::gate::set_policy_requirement(ctx)
    }

    // ---- Stele Gate passports -------------------------------------------------------------------

    pub fn record_passport_acceptance(
        ctx: Context<RecordPassportAcceptance>,
        nonce_index: u32,
        nonce_tag: [u8; 8],
        issued_at: i64,
        expires_at: i64,
        passport_bump: u8,
    ) -> Result<()> {
        instructions::passport::record_passport_acceptance(
            ctx,
            nonce_index,
            nonce_tag,
            issued_at,
            expires_at,
            passport_bump,
        )
    }

    pub fn remove_passport_entry(ctx: Context<ManagePassport>, document: Pubkey) -> Result<()> {
        instructions::passport::remove_passport_entry(ctx, document)
    }

    pub fn close_passport(ctx: Context<ManagePassport>) -> Result<()> {
        instructions::passport::close_passport(ctx)
    }
}
