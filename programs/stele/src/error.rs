use anchor_lang::prelude::*;

/// Program errors. Codes start at 6000 (Anchor convention) and are part of the public interface:
/// never reorder or remove variants; only append.
#[error_code]
pub enum SteleError {
    // ---- protocol ------------------------------------------------------------------------------
    #[msg("Program data account does not belong to this program")]
    InvalidProgramData,
    #[msg("Signer is not the program upgrade authority")]
    NotUpgradeAuthority,
    #[msg("Invalid CAIP-2 chain id")]
    InvalidChainId,
    #[msg("Invalid network label")]
    InvalidNetworkLabel,
    #[msg("Signer is not authorized for this action")]
    Unauthorized,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Address must not be the zero key")]
    ZeroAddress,

    // ---- organization --------------------------------------------------------------------------
    #[msg("Invalid organization name")]
    InvalidOrganizationName,
    #[msg("Organization is frozen")]
    OrganizationFrozen,
    #[msg("Organization is locked by its recovery authority")]
    OrganizationLockedByRecovery,
    #[msg("Recovery authority must differ from the owner")]
    RecoveryEqualsOwner,
    #[msg("No ownership transfer is pending")]
    NoPendingOwner,
    #[msg("Organization has no recovery authority")]
    NoRecoveryAuthority,
    #[msg("No recovery-authority change is pending")]
    NoPendingRecoveryChange,
    #[msg("Time lock has not elapsed")]
    TimelockNotElapsed,
    #[msg("No owner recovery is pending")]
    NoPendingOwnerRecovery,
    #[msg("Organization is not frozen")]
    NotFrozen,

    // ---- members -------------------------------------------------------------------------------
    #[msg("Invalid role bits")]
    InvalidRoles,
    #[msg("Only the owner can manage administrators")]
    CannotManageAdmin,
    #[msg("Member has been revoked")]
    MemberRevoked,
    #[msg("A member reported as compromised cannot be reactivated")]
    MemberCompromised,
    #[msg("Member does not belong to this organization")]
    MemberOrganizationMismatch,
    #[msg("Invalid compromise timestamp")]
    InvalidCompromiseTime,

    // ---- domains -------------------------------------------------------------------------------
    #[msg("Signer is not the domain attestor")]
    UnauthorizedAttestor,
    #[msg("Invalid domain")]
    InvalidDomain,
    #[msg("Domain hash does not match the domain")]
    DomainHashMismatch,
    #[msg("Organization already has a verified domain")]
    OrganizationAlreadyHasDomain,
    #[msg("Invalid domain attestation expiry")]
    InvalidDomainExpiry,
    #[msg("Domain record does not belong to this organization")]
    DomainOrganizationMismatch,

    // ---- documents -----------------------------------------------------------------------------
    #[msg("Invalid document slug")]
    InvalidSlug,
    #[msg("Invalid document type")]
    InvalidDocumentType,
    #[msg("Invalid locale")]
    InvalidLocale,
    #[msg("Document does not belong to this organization")]
    DocumentOrganizationMismatch,

    // ---- publication ---------------------------------------------------------------------------
    #[msg("Version number must be exactly the next version")]
    InvalidVersionNumber,
    #[msg("Previous version hash does not match the document head")]
    PreviousVersionHashMismatch,
    #[msg("Invalid title")]
    InvalidTitle,
    #[msg("Invalid version label")]
    InvalidVersionLabel,
    #[msg("Invalid storage URI")]
    InvalidStorageUri,
    #[msg("Effective date must be upon publication or in the future (within the horizon)")]
    InvalidEffectiveAt,
    #[msg("Computed version fingerprint does not match the expected fingerprint")]
    VersionHashMismatch,

    // ---- acceptance ----------------------------------------------------------------------------
    #[msg("Version does not belong to this organization")]
    VersionOrganizationMismatch,
    #[msg("Version does not belong to this document")]
    VersionDocumentMismatch,
    #[msg("Only the current version of a document can be accepted")]
    VersionNotCurrent,
    #[msg("Nonce shard does not belong to this organization")]
    ShardOrganizationMismatch,
    #[msg("Signer is not the shard's relayer")]
    UnauthorizedRelayer,
    #[msg("Nonce index out of range")]
    NonceOutOfRange,
    #[msg("Nonce already used")]
    NonceAlreadyUsed,
    #[msg("Invalid acceptance validity window")]
    InvalidAcceptanceWindow,
    #[msg("Acceptance message has expired")]
    AcceptanceExpired,
    #[msg("Acceptance issued-at time is in the future")]
    IssuedInFuture,
    #[msg("Acceptance was issued before the version was published")]
    IssuedBeforePublication,
    #[msg("Timestamp out of range")]
    InvalidTimestamp,
    #[msg("This instruction must be invoked at the top level, not via CPI")]
    CpiNotAllowed,
    #[msg("The preceding instruction must be an Ed25519 signature verification")]
    MissingEd25519Instruction,
    #[msg("Ed25519 instruction is not in canonical single-signature layout")]
    InvalidEd25519Instruction,
    #[msg("Signed message does not match the reconstructed acceptance message")]
    MessageMismatch,
    #[msg("Invalid request domain in the signed message")]
    InvalidRequestDomain,

    // ---- generic -------------------------------------------------------------------------------
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    // ---- fee sponsorship (appended; codes above are stable) -------------------------------------
    #[msg("Invalid fee-sponsorship limits")]
    InvalidSponsorLimits,
    #[msg("Fee sponsorship is already enabled on this nonce shard")]
    SponsorshipAlreadyEnabled,
    #[msg("Fee sponsorship is not enabled on this nonce shard")]
    SponsorshipNotEnabled,
    #[msg("Fee sponsorship requires a nonce shard with a designated relayer")]
    SponsorRequiresDesignatedRelayer,
    #[msg("A withdrawal must leave the shard rent-exempt")]
    WithdrawalBelowRentMinimum,
    #[msg("Invalid withdrawal amount or destination")]
    InvalidWithdrawal,

    // ---- proofs ---------------------------------------------------------------------------------
    #[msg("Unknown or reserved proof type")]
    InvalidProofType,
    #[msg("The statement hash must not be zero")]
    InvalidStatementHash,

    // ---- native passkeys (stele/2) --------------------------------------------------------------
    #[msg("The preceding instruction must be a secp256r1 signature verification")]
    MissingSecp256r1Instruction,
    #[msg("secp256r1 instruction is not in canonical single-signature layout")]
    InvalidSecp256r1Instruction,
    #[msg("The signer key is not a compressed P-256 public key")]
    InvalidSignerKey,
    #[msg("WebAuthn client data is not an assertion for this acceptance")]
    InvalidClientData,
    #[msg("The browser-attested origin is not the requesting site")]
    OriginMismatch,
    #[msg("The passkey ceremony ran in a cross-origin frame")]
    CrossOriginCeremony,
    #[msg("WebAuthn authenticator data is malformed")]
    InvalidAuthenticatorData,
    #[msg("The relying party does not match")]
    RelyingPartyMismatch,
    #[msg("The authenticator did not verify the user")]
    UserNotVerified,
    #[msg("Client data does not match the signed hash")]
    ClientDataHashMismatch,
    #[msg("The passkey enrollment does not belong to this organization or signer")]
    EnrollmentMismatch,
    #[msg("The passkey enrollment is not active")]
    EnrollmentNotActive,
    #[msg("Invalid account commitment")]
    InvalidAccountCommitment,

    // ---- Merkle-batched acceptances ---------------------------------------------------------------
    #[msg("A batch needs a non-zero root and 1 to 65,536 leaves")]
    InvalidBatch,

    // ---- Stele Gate ------------------------------------------------------------------------------
    #[msg("The access pass does not belong to this document and holder")]
    AccessPassMismatch,
    #[msg("The required version must be a published version of the policy's document")]
    InvalidPolicyRequirement,
    #[msg("The policy does not belong to this document")]
    PolicyMismatch,
    #[msg("This wallet has already accepted this version")]
    AccessPassAlreadyCurrent,
}
