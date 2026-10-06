/** Error raised when a value violates the protocol (validation, canonicalization, decoding). */
export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }
}

export type ProtocolErrorCode =
  | "EMPTY"
  | "TOO_LONG"
  | "FORBIDDEN_CHARACTER"
  | "INVALID_WHITESPACE"
  | "INVALID_FORMAT"
  | "INVALID_TIMESTAMP"
  | "MESSAGE_MISMATCH"
  | "EMPTY_TEXT"
  | "LIMIT_EXCEEDED"
  | "INVALID_STRUCTURE"
  | "INVALID_JSON"
  | "NON_CANONICAL_TEXT"
  | "NON_CANONICAL_BYTES"
  | "DECODE_ERROR";

/**
 * Program error codes (Anchor offset 6000 + variant index of `SteleError`). Order is part of the
 * public interface and mirrors `programs/stele/src/error.rs`.
 */
export const PROGRAM_ERRORS = [
  ["InvalidProgramData", "Program data account does not belong to this program"],
  ["NotUpgradeAuthority", "Signer is not the program upgrade authority"],
  ["InvalidChainId", "Invalid CAIP-2 chain id"],
  ["InvalidNetworkLabel", "Invalid network label"],
  ["Unauthorized", "Signer is not authorized for this action"],
  ["ProtocolPaused", "Protocol is paused"],
  ["ZeroAddress", "Address must not be the zero key"],
  ["InvalidOrganizationName", "Invalid organization name"],
  ["OrganizationFrozen", "Organization is frozen"],
  ["OrganizationLockedByRecovery", "Organization is locked by its recovery authority"],
  ["RecoveryEqualsOwner", "Recovery authority must differ from the owner"],
  ["NoPendingOwner", "No ownership transfer is pending"],
  ["NoRecoveryAuthority", "Organization has no recovery authority"],
  ["NoPendingRecoveryChange", "No recovery-authority change is pending"],
  ["TimelockNotElapsed", "Time lock has not elapsed"],
  ["NoPendingOwnerRecovery", "No owner recovery is pending"],
  ["NotFrozen", "Organization is not frozen"],
  ["InvalidRoles", "Invalid role bits"],
  ["CannotManageAdmin", "Only the owner can manage administrators"],
  ["MemberRevoked", "Member has been revoked"],
  ["MemberCompromised", "A member reported as compromised cannot be reactivated"],
  ["MemberOrganizationMismatch", "Member does not belong to this organization"],
  ["InvalidCompromiseTime", "Invalid compromise timestamp"],
  ["UnauthorizedAttestor", "Signer is not the domain attestor"],
  ["InvalidDomain", "Invalid domain"],
  ["DomainHashMismatch", "Domain hash does not match the domain"],
  ["OrganizationAlreadyHasDomain", "Organization already has a verified domain"],
  ["InvalidDomainExpiry", "Invalid domain attestation expiry"],
  ["DomainOrganizationMismatch", "Domain record does not belong to this organization"],
  ["InvalidSlug", "Invalid document slug"],
  ["InvalidDocumentType", "Invalid document type"],
  ["InvalidLocale", "Invalid locale"],
  ["DocumentOrganizationMismatch", "Document does not belong to this organization"],
  ["InvalidVersionNumber", "Version number must be exactly the next version"],
  ["PreviousVersionHashMismatch", "Previous version hash does not match the document head"],
  ["InvalidTitle", "Invalid title"],
  ["InvalidVersionLabel", "Invalid version label"],
  ["InvalidStorageUri", "Invalid storage URI"],
  [
    "InvalidEffectiveAt",
    "Effective date must be upon publication or in the future (within the horizon)",
  ],
  ["VersionHashMismatch", "Computed version fingerprint does not match the expected fingerprint"],
  ["VersionOrganizationMismatch", "Version does not belong to this organization"],
  ["VersionDocumentMismatch", "Version does not belong to this document"],
  ["VersionNotCurrent", "Only the current version of a document can be accepted"],
  ["ShardOrganizationMismatch", "Nonce shard does not belong to this organization"],
  ["UnauthorizedRelayer", "Signer is not the shard's relayer"],
  ["NonceOutOfRange", "Nonce index out of range"],
  ["NonceAlreadyUsed", "Nonce already used"],
  ["InvalidAcceptanceWindow", "Invalid acceptance validity window"],
  ["AcceptanceExpired", "Acceptance message has expired"],
  ["IssuedInFuture", "Acceptance issued-at time is in the future"],
  ["IssuedBeforePublication", "Acceptance was issued before the version was published"],
  ["InvalidTimestamp", "Timestamp out of range"],
  ["CpiNotAllowed", "This instruction must be invoked at the top level, not via CPI"],
  [
    "MissingEd25519Instruction",
    "The preceding instruction must be an Ed25519 signature verification",
  ],
  ["InvalidEd25519Instruction", "Ed25519 instruction is not in canonical single-signature layout"],
  ["MessageMismatch", "Signed message does not match the reconstructed acceptance message"],
  ["InvalidRequestDomain", "Invalid request domain in the signed message"],
  ["ArithmeticOverflow", "Arithmetic overflow"],
  ["InvalidSponsorLimits", "Invalid fee-sponsorship limits"],
  ["SponsorshipAlreadyEnabled", "Fee sponsorship is already enabled on this nonce shard"],
  ["SponsorshipNotEnabled", "Fee sponsorship is not enabled on this nonce shard"],
  [
    "SponsorRequiresDesignatedRelayer",
    "Fee sponsorship requires a nonce shard with a designated relayer",
  ],
  ["WithdrawalBelowRentMinimum", "A withdrawal must leave the shard rent-exempt"],
  ["InvalidWithdrawal", "Invalid withdrawal amount or destination"],
  ["InvalidProofType", "Unknown or reserved proof type"],
  ["InvalidStatementHash", "The statement hash must not be zero"],
  [
    "MissingSecp256r1Instruction",
    "The preceding instruction must be a secp256r1 signature verification",
  ],
  [
    "InvalidSecp256r1Instruction",
    "secp256r1 instruction is not in canonical single-signature layout",
  ],
  ["InvalidSignerKey", "The signer key is not a compressed P-256 public key"],
  ["InvalidClientData", "WebAuthn client data is not an assertion for this acceptance"],
  ["OriginMismatch", "The browser-attested origin is not the requesting site"],
  ["CrossOriginCeremony", "The passkey ceremony ran in a cross-origin frame"],
  ["InvalidAuthenticatorData", "WebAuthn authenticator data is malformed"],
  ["RelyingPartyMismatch", "The relying party does not match"],
  ["UserNotVerified", "The authenticator did not verify the user"],
  ["ClientDataHashMismatch", "Client data does not match the signed hash"],
  ["EnrollmentMismatch", "The passkey enrollment does not belong to this organization or signer"],
  ["EnrollmentNotActive", "The passkey enrollment is not active"],
  ["InvalidAccountCommitment", "Invalid account commitment"],
  ["InvalidBatch", "A batch needs a non-zero root and 1 to 65,536 leaves"],
  ["AccessPassMissing", "No access pass exists for this policy document and holder"],
  [
    "AccessPassOutdated",
    "The access pass does not satisfy the policy requirement (a newer version must be accepted)",
  ],
  ["AccessPassMismatch", "The access pass does not belong to this policy document and holder"],
  ["InvalidAccessRequirement", "The policy requirement names a version the document does not have"],
] as const;

export type ProgramErrorName = (typeof PROGRAM_ERRORS)[number][0];
export const PROGRAM_ERROR_OFFSET = 6000;

export function programErrorCode(name: ProgramErrorName): number {
  return PROGRAM_ERROR_OFFSET + PROGRAM_ERRORS.findIndex(([n]) => n === name);
}

export function describeProgramError(code: number): { name: string; message: string } | null {
  const entry = PROGRAM_ERRORS[code - PROGRAM_ERROR_OFFSET];
  return entry ? { name: entry[0], message: entry[1] } : null;
}
