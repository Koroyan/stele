/**
 * Instruction builders and decoders for the `stele` program. Account order matches each Anchor
 * `#[derive(Accounts)]` struct exactly. Signer slots accept an `Address` or a `TransactionSigner`
 * (embedded so `signTransactionMessageWithSigners` can find it).
 */
import {
  AccountRole,
  address,
  type AccountMeta,
  type AccountSignerMeta,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { BorshReader, BorshWriter } from "./borsh";
import { DEFAULT_PROGRAM_ADDRESS, LIMITS } from "./constants";
import { bytesEqual } from "./encoding";
import { ProtocolError } from "./errors";
import { anchorDiscriminator } from "./hash";

export const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");
export const INSTRUCTIONS_SYSVAR_ADDRESS = address("Sysvar1nstructions1111111111111111111111111");

export const INSTRUCTION_NAMES = [
  "initialize_protocol",
  "set_protocol_paused",
  "set_domain_attestor",
  "propose_protocol_admin",
  "accept_protocol_admin",
  "create_organization",
  "update_organization",
  "propose_owner",
  "accept_ownership",
  "cancel_owner_transfer",
  "propose_recovery",
  "apply_recovery_change",
  "cancel_recovery_change",
  "freeze_organization",
  "unfreeze_organization",
  "initiate_owner_recovery",
  "cancel_owner_recovery",
  "execute_owner_recovery",
  "add_member",
  "update_member",
  "revoke_member",
  "report_key_compromise",
  "attest_domain",
  "renew_domain",
  "revoke_domain",
  "create_document",
  "publish_version",
  "create_nonce_shard",
  "set_shard_relayer",
  "record_acceptance",
  "record_proof",
  "enable_shard_sponsorship",
  "update_shard_sponsorship",
  "withdraw_shard_sponsorship",
  "record_passkey_acceptance",
  "enroll_passkey_signer",
  "rotate_passkey_signer",
  "recover_passkey_signer",
  "revoke_passkey_signer",
  "anchor_acceptance_batch",
  "record_gated_acceptance",
  "create_policy",
  "set_policy_requirement",
] as const;
export type InstructionName = (typeof INSTRUCTION_NAMES)[number];

export const INSTRUCTION_DISCRIMINATORS: Record<InstructionName, Uint8Array> = Object.fromEntries(
  INSTRUCTION_NAMES.map((n) => [n, anchorDiscriminator("global", n)]),
) as Record<InstructionName, Uint8Array>;

export function identifyInstruction(data: Uint8Array): InstructionName | null {
  if (data.length < 8) return null;
  const head = data.subarray(0, 8);
  return INSTRUCTION_NAMES.find((n) => bytesEqual(INSTRUCTION_DISCRIMINATORS[n], head)) ?? null;
}

type SignerInput = Address | TransactionSigner;
type Meta = AccountMeta | AccountSignerMeta;

const ro = (a: Address): Meta => ({ address: a, role: AccountRole.READONLY });
const rw = (a: Address): Meta => ({ address: a, role: AccountRole.WRITABLE });

function signer(s: SignerInput, writable: boolean): Meta {
  const role = writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER;
  return typeof s === "string"
    ? { address: s as Address, role }
    : ({ address: s.address, role, signer: s } as AccountSignerMeta);
}

const keyOf = (s: SignerInput): Address => (typeof s === "string" ? (s as Address) : s.address);

function build(
  name: InstructionName,
  accounts: Meta[],
  args: (w: BorshWriter) => void,
  programAddress?: Address,
): Instruction {
  const w = new BorshWriter().raw(INSTRUCTION_DISCRIMINATORS[name]);
  args(w);
  return {
    programAddress: programAddress ?? address(DEFAULT_PROGRAM_ADDRESS),
    accounts,
    data: w.toBytes(),
  };
}

/** Anchor encodes an absent optional account as the program ID itself. */
const optional = (a: Address | null | undefined, programAddress?: Address): Meta =>
  ro(a ?? programAddress ?? address(DEFAULT_PROGRAM_ADDRESS));

interface Base {
  programAddress?: Address;
}

// ---- protocol ------------------------------------------------------------------------------------

export function initializeProtocolInstruction(
  i: Base & {
    authority: SignerInput;
    config: Address;
    programData: Address;
    admin: Address;
    domainAttestor: Address;
    chainId: string;
    networkLabel: string;
  },
): Instruction {
  const program = i.programAddress ?? address(DEFAULT_PROGRAM_ADDRESS);
  return build(
    "initialize_protocol",
    [
      signer(i.authority, true),
      rw(i.config),
      ro(program),
      ro(i.programData),
      ro(SYSTEM_PROGRAM_ADDRESS),
    ],
    (w) => w.address(i.admin).address(i.domainAttestor).string(i.chainId).string(i.networkLabel),
    i.programAddress,
  );
}

export function setProtocolPausedInstruction(
  i: Base & { admin: SignerInput; config: Address; paused: boolean },
): Instruction {
  return build(
    "set_protocol_paused",
    [signer(i.admin, false), rw(i.config)],
    (w) => w.bool(i.paused),
    i.programAddress,
  );
}

export function setDomainAttestorInstruction(
  i: Base & { admin: SignerInput; config: Address; attestor: Address },
): Instruction {
  return build(
    "set_domain_attestor",
    [signer(i.admin, false), rw(i.config)],
    (w) => w.address(i.attestor),
    i.programAddress,
  );
}

// ---- organization -------------------------------------------------------------------------------

export function createOrganizationInstruction(
  i: Base & {
    creator: SignerInput;
    payer: SignerInput;
    config: Address;
    organization: Address;
    seed: Uint8Array;
    name: string;
    owner: Address;
    recovery: Address | null;
  },
): Instruction {
  return build(
    "create_organization",
    [
      signer(i.creator, false),
      ro(i.config),
      rw(i.organization),
      signer(i.payer, true),
      ro(SYSTEM_PROGRAM_ADDRESS),
    ],
    (w) => w.fixed(i.seed, 32).string(i.name).address(i.owner).optionAddress(i.recovery),
    i.programAddress,
  );
}

type OrgAuthorityName =
  | "accept_ownership"
  | "cancel_owner_transfer"
  | "apply_recovery_change"
  | "cancel_recovery_change"
  | "freeze_organization"
  | "unfreeze_organization"
  | "cancel_owner_recovery"
  | "execute_owner_recovery";

/** Organization-authority instructions without arguments. */
export function organizationAuthorityInstruction(
  i: Base & { name: OrgAuthorityName; authority: SignerInput; organization: Address },
): Instruction {
  return build(
    i.name,
    [signer(i.authority, false), rw(i.organization)],
    () => undefined,
    i.programAddress,
  );
}

export function updateOrganizationInstruction(
  i: Base & { authority: SignerInput; organization: Address; name: string },
): Instruction {
  return build(
    "update_organization",
    [signer(i.authority, false), rw(i.organization)],
    (w) => w.string(i.name),
    i.programAddress,
  );
}

export function proposeOwnerInstruction(
  i: Base & { authority: SignerInput; organization: Address; newOwner: Address },
): Instruction {
  return build(
    "propose_owner",
    [signer(i.authority, false), rw(i.organization)],
    (w) => w.address(i.newOwner),
    i.programAddress,
  );
}

export function proposeRecoveryInstruction(
  i: Base & { authority: SignerInput; organization: Address; newRecovery: Address | null },
): Instruction {
  return build(
    "propose_recovery",
    [signer(i.authority, false), rw(i.organization)],
    (w) => w.optionAddress(i.newRecovery),
    i.programAddress,
  );
}

export function initiateOwnerRecoveryInstruction(
  i: Base & { authority: SignerInput; organization: Address; newOwner: Address },
): Instruction {
  return build(
    "initiate_owner_recovery",
    [signer(i.authority, false), rw(i.organization)],
    (w) => w.address(i.newOwner),
    i.programAddress,
  );
}

// ---- members --------------------------------------------------------------------------------------

export function addMemberInstruction(
  i: Base & {
    authority: SignerInput;
    authorityMembership: Address | null;
    organization: Address;
    memberAccount: Address;
    member: Address;
    roles: number;
    payer: SignerInput;
  },
): Instruction {
  return build(
    "add_member",
    [
      signer(i.authority, false),
      optional(i.authorityMembership, i.programAddress),
      rw(i.organization),
      rw(i.memberAccount),
      signer(i.payer, true),
      ro(SYSTEM_PROGRAM_ADDRESS),
    ],
    (w) => w.address(i.member).u8(i.roles),
    i.programAddress,
  );
}

type ManageMemberArgs =
  | { kind: "update_member"; roles: number }
  | { kind: "revoke_member" }
  | { kind: "report_key_compromise"; compromisedSince: bigint | number };

export function manageMemberInstruction(
  i: Base & {
    authority: SignerInput;
    authorityMembership: Address | null;
    organization: Address;
    memberAccount: Address;
    action: ManageMemberArgs;
  },
): Instruction {
  return build(
    i.action.kind,
    [
      signer(i.authority, false),
      optional(i.authorityMembership, i.programAddress),
      ro(i.organization),
      rw(i.memberAccount),
    ],
    (w) => {
      if (i.action.kind === "update_member") w.u8(i.action.roles);
      if (i.action.kind === "report_key_compromise") w.i64(i.action.compromisedSince);
    },
    i.programAddress,
  );
}

// ---- domains --------------------------------------------------------------------------------------

export function attestDomainInstruction(
  i: Base & {
    attestor: SignerInput;
    payer: SignerInput;
    config: Address;
    organization: Address;
    domainRecord: Address;
    domain: string;
    domainHash: Uint8Array;
    expiresAt: bigint | number;
  },
): Instruction {
  return build(
    "attest_domain",
    [
      signer(i.attestor, false),
      ro(i.config),
      rw(i.organization),
      rw(i.domainRecord),
      signer(i.payer, true),
      ro(SYSTEM_PROGRAM_ADDRESS),
    ],
    (w) => w.string(i.domain).fixed(i.domainHash, 32).i64(i.expiresAt),
    i.programAddress,
  );
}

export function renewDomainInstruction(
  i: Base & {
    attestor: SignerInput;
    config: Address;
    organization: Address;
    domainRecord: Address;
    expiresAt: bigint | number;
  },
): Instruction {
  return build(
    "renew_domain",
    [signer(i.attestor, false), ro(i.config), rw(i.organization), rw(i.domainRecord)],
    (w) => w.i64(i.expiresAt),
    i.programAddress,
  );
}

export function revokeDomainInstruction(
  i: Base & {
    authority: SignerInput;
    config: Address;
    organization: Address;
    domainRecord: Address;
    rentPayer: Address;
  },
): Instruction {
  return build(
    "revoke_domain",
    [
      signer(i.authority, false),
      ro(i.config),
      rw(i.organization),
      rw(i.domainRecord),
      rw(i.rentPayer),
    ],
    () => undefined,
    i.programAddress,
  );
}

// ---- documents ------------------------------------------------------------------------------------

export function createDocumentInstruction(
  i: Base & {
    authority: SignerInput;
    membership: Address | null;
    config: Address;
    organization: Address;
    document: Address;
    payer: SignerInput;
    slug: string;
    documentType: string;
    locale: string;
  },
): Instruction {
  return build(
    "create_document",
    [
      signer(i.authority, false),
      optional(i.membership, i.programAddress),
      ro(i.config),
      rw(i.organization),
      rw(i.document),
      signer(i.payer, true),
      ro(SYSTEM_PROGRAM_ADDRESS),
    ],
    (w) => w.string(i.slug).string(i.documentType).string(i.locale),
    i.programAddress,
  );
}

export interface PublishVersionArgs {
  version: number;
  previousVersionHash: Uint8Array;
  contentHash: Uint8Array;
  title: string;
  versionLabel: string;
  effectiveAt: bigint | number;
  storageUri: string;
  expectedVersionHash: Uint8Array;
}

export function publishVersionInstruction(
  i: Base &
    PublishVersionArgs & {
      authority: SignerInput;
      membership: Address | null;
      config: Address;
      organization: Address;
      document: Address;
      versionAccount: Address;
      payer: SignerInput;
    },
): Instruction {
  return build(
    "publish_version",
    [
      signer(i.authority, false),
      optional(i.membership, i.programAddress),
      ro(i.config),
      ro(i.organization),
      rw(i.document),
      rw(i.versionAccount),
      signer(i.payer, true),
      ro(SYSTEM_PROGRAM_ADDRESS),
    ],
    (w) =>
      w
        .u32(i.version)
        .fixed(i.previousVersionHash, 32)
        .fixed(i.contentHash, 32)
        .string(i.title)
        .string(i.versionLabel)
        .i64(i.effectiveAt)
        .string(i.storageUri)
        .fixed(i.expectedVersionHash, 32),
    i.programAddress,
  );
}

export function decodePublishVersionArgs(data: Uint8Array): PublishVersionArgs {
  if (identifyInstruction(data) !== "publish_version")
    throw new ProtocolError("DECODE_ERROR", "not a publish_version instruction");
  const r = new BorshReader(data);
  r.bytes(8);
  return {
    version: r.u32(),
    previousVersionHash: r.bytes(32),
    contentHash: r.bytes(32),
    title: r.string(LIMITS.title),
    versionLabel: r.string(LIMITS.versionLabel),
    effectiveAt: r.i64(),
    storageUri: r.string(LIMITS.storageUri),
    expectedVersionHash: r.bytes(32),
  };
}

// ---- shards & acceptance --------------------------------------------------------------------------

export function createNonceShardInstruction(
  i: Base & {
    authority: SignerInput;
    membership: Address | null;
    config: Address;
    organization: Address;
    nonceShard: Address;
    payer: SignerInput;
    shardId: number;
    relayer: Address;
  },
): Instruction {
  return build(
    "create_nonce_shard",
    [
      signer(i.authority, false),
      optional(i.membership, i.programAddress),
      ro(i.config),
      ro(i.organization),
      rw(i.nonceShard),
      signer(i.payer, true),
      ro(SYSTEM_PROGRAM_ADDRESS),
    ],
    (w) => w.u16(i.shardId).address(i.relayer),
    i.programAddress,
  );
}

export function setShardRelayerInstruction(
  i: Base & {
    authority: SignerInput;
    membership: Address | null;
    organization: Address;
    nonceShard: Address;
    relayer: Address;
  },
): Instruction {
  return build(
    "set_shard_relayer",
    [
      signer(i.authority, false),
      optional(i.membership, i.programAddress),
      ro(i.organization),
      rw(i.nonceShard),
    ],
    (w) => w.address(i.relayer),
    i.programAddress,
  );
}

export interface RecordAcceptanceArgs {
  nonceIndex: number;
  nonceTag: Uint8Array;
  issuedAt: bigint | number;
  expiresAt: bigint | number;
}

/**
 * `record_acceptance`. If the organization enabled fee sponsorship on the shard, the program
 * reimburses the relayer from it; the instruction is the same either way.
 */
export function recordAcceptanceInstruction(
  i: Base &
    RecordAcceptanceArgs & {
      relayer: SignerInput;
      config: Address;
      organization: Address;
      document: Address;
      version: Address;
      nonceShard: Address;
    },
): Instruction {
  return build(
    "record_acceptance",
    [
      signer(i.relayer, true),
      ro(i.config),
      ro(i.organization),
      ro(i.document),
      ro(i.version),
      rw(i.nonceShard),
      ro(INSTRUCTIONS_SYSVAR_ADDRESS),
    ],
    (w) => w.u32(i.nonceIndex).fixed(i.nonceTag, 8).i64(i.issuedAt).i64(i.expiresAt),
    i.programAddress,
  );
}

/**
 * Stele Gate: records a wallet's acceptance exactly like `record_acceptance` and creates or advances
 * the holder's access pass (PROTOCOL_SPEC.md §18.2). `holder` must be the wallet that signed.
 */
export function recordGatedAcceptanceInstruction(
  i: Base &
    RecordAcceptanceArgs & {
      relayer: SignerInput;
      config: Address;
      organization: Address;
      document: Address;
      version: Address;
      nonceShard: Address;
      holder: Address;
      accessPass: Address;
    },
): Instruction {
  return build(
    "record_gated_acceptance",
    [
      signer(i.relayer, true),
      ro(i.config),
      ro(i.organization),
      ro(i.document),
      ro(i.version),
      rw(i.nonceShard),
      ro(i.holder),
      rw(i.accessPass),
      ro(SYSTEM_PROGRAM_ADDRESS),
      ro(INSTRUCTIONS_SYSVAR_ADDRESS),
    ],
    (w) => w.u32(i.nonceIndex).fixed(i.nonceTag, 8).i64(i.issuedAt).i64(i.expiresAt),
    i.programAddress,
  );
}

/**
 * Stele Gate: creates the policy of `document`, requiring `version` (PROTOCOL_SPEC.md §18.2).
 * Signed by the organization's owner, an admin or a publisher.
 */
export function createPolicyInstruction(
  i: Base & {
    authority: SignerInput;
    membership: Address | null;
    config: Address;
    organization: Address;
    document: Address;
    version: Address;
    policy: Address;
    payer: SignerInput;
  },
): Instruction {
  return build(
    "create_policy",
    [
      signer(i.authority, false),
      optional(i.membership, i.programAddress),
      ro(i.config),
      ro(i.organization),
      ro(i.document),
      ro(i.version),
      rw(i.policy),
      signer(i.payer, true),
      ro(SYSTEM_PROGRAM_ADDRESS),
    ],
    () => undefined,
    i.programAddress,
  );
}

/** Stele Gate: changes the version a policy requires (raising it makes older passes insufficient). */
export function setPolicyRequirementInstruction(
  i: Base & {
    authority: SignerInput;
    membership: Address | null;
    config: Address;
    organization: Address;
    document: Address;
    version: Address;
    policy: Address;
  },
): Instruction {
  return build(
    "set_policy_requirement",
    [
      signer(i.authority, false),
      optional(i.membership, i.programAddress),
      ro(i.config),
      ro(i.organization),
      ro(i.document),
      ro(i.version),
      rw(i.policy),
    ],
    () => undefined,
    i.programAddress,
  );
}

export function decodeRecordAcceptanceArgs(data: Uint8Array): RecordAcceptanceArgs {
  const name = identifyInstruction(data);
  if (name !== "record_acceptance" && name !== "record_gated_acceptance")
    throw new ProtocolError("DECODE_ERROR", "not a record_acceptance instruction");
  const r = new BorshReader(data);
  r.bytes(8);
  const out = { nonceIndex: r.u32(), nonceTag: r.bytes(8), issuedAt: r.i64(), expiresAt: r.i64() };
  if (r.remaining !== 0) throw new ProtocolError("DECODE_ERROR", "trailing instruction data");
  return out;
}

// ---- proofs ----------------------------------------------------------------------------------------

export interface RecordProofArgs {
  proofType: number;
  statementHash: Uint8Array;
  nonceIndex: number;
  nonceTag: Uint8Array;
  issuedAt: bigint | number;
  expiresAt: bigint | number;
}

export function recordProofInstruction(
  i: Base &
    RecordProofArgs & {
      relayer: SignerInput;
      config: Address;
      organization: Address;
      nonceShard: Address;
    },
): Instruction {
  return build(
    "record_proof",
    [
      signer(i.relayer, true),
      ro(i.config),
      ro(i.organization),
      rw(i.nonceShard),
      ro(INSTRUCTIONS_SYSVAR_ADDRESS),
    ],
    (w) =>
      w
        .u8(i.proofType)
        .fixed(i.statementHash, 32)
        .u32(i.nonceIndex)
        .fixed(i.nonceTag, 8)
        .i64(i.issuedAt)
        .i64(i.expiresAt),
    i.programAddress,
  );
}

export function decodeRecordProofArgs(data: Uint8Array): RecordProofArgs {
  if (identifyInstruction(data) !== "record_proof")
    throw new ProtocolError("DECODE_ERROR", "not a record_proof instruction");
  const r = new BorshReader(data);
  r.bytes(8);
  const out = {
    proofType: r.u8(),
    statementHash: r.bytes(32),
    nonceIndex: r.u32(),
    nonceTag: r.bytes(8),
    issuedAt: r.i64(),
    expiresAt: r.i64(),
  };
  if (r.remaining !== 0) throw new ProtocolError("DECODE_ERROR", "trailing instruction data");
  return out;
}

// ---- fee sponsorship ---------------------------------------------------------------------------------

export interface SponsorLimits {
  maxFeePerRecord: bigint | number;
  dailyLimit: bigint | number;
}

export function enableShardSponsorshipInstruction(
  i: Base &
    SponsorLimits & {
      authority: SignerInput;
      membership: Address | null;
      organization: Address;
      nonceShard: Address;
      payer: SignerInput;
    },
): Instruction {
  return build(
    "enable_shard_sponsorship",
    [
      signer(i.authority, false),
      optional(i.membership, i.programAddress),
      ro(i.organization),
      rw(i.nonceShard),
      signer(i.payer, true),
      ro(SYSTEM_PROGRAM_ADDRESS),
    ],
    (w) => w.u64(i.maxFeePerRecord).u64(i.dailyLimit),
    i.programAddress,
  );
}

export function updateShardSponsorshipInstruction(
  i: Base &
    SponsorLimits & {
      authority: SignerInput;
      membership: Address | null;
      organization: Address;
      nonceShard: Address;
      paused: boolean;
    },
): Instruction {
  return build(
    "update_shard_sponsorship",
    [
      signer(i.authority, false),
      optional(i.membership, i.programAddress),
      ro(i.organization),
      rw(i.nonceShard),
    ],
    (w) => w.u64(i.maxFeePerRecord).u64(i.dailyLimit).bool(i.paused),
    i.programAddress,
  );
}

export function withdrawShardSponsorshipInstruction(
  i: Base & {
    owner: SignerInput;
    organization: Address;
    nonceShard: Address;
    destination: Address;
    amount: bigint | number;
  },
): Instruction {
  return build(
    "withdraw_shard_sponsorship",
    [signer(i.owner, false), ro(i.organization), rw(i.nonceShard), rw(i.destination)],
    (w) => w.u64(i.amount),
    i.programAddress,
  );
}

/** `SystemInstruction::Transfer` — e.g. a deposit into a sponsored nonce shard. */
export function systemTransferInstruction(i: {
  source: SignerInput;
  destination: Address;
  lamports: bigint | number;
}): Instruction {
  const data = new BorshWriter().u32(2).u64(i.lamports).toBytes();
  return {
    programAddress: SYSTEM_PROGRAM_ADDRESS,
    accounts: [signer(i.source, true), rw(i.destination)],
    data,
  };
}

export { keyOf as signerAddress };

// ---- native passkeys (stele/2) ----------------------------------------------------------------------

/** WebAuthn evidence accompanying a secp256r1 signature (authenticator data is in the precompile). */
export interface PasskeyAssertionArgs {
  requestDomain: string;
  rpId: string;
  clientDataJson: Uint8Array;
}

const writeAssertion = (w: BorshWriter, a: PasskeyAssertionArgs) =>
  w.string(a.requestDomain).string(a.rpId).u32(a.clientDataJson.length).raw(a.clientDataJson);

const readAssertion = (r: BorshReader): PasskeyAssertionArgs => ({
  requestDomain: r.string(64),
  rpId: r.string(64),
  clientDataJson: r.bytes(r.u32()),
});

export interface RecordPasskeyAcceptanceArgs {
  nonceIndex: number;
  nonceTag: Uint8Array;
  issuedAt: number | bigint;
  expiresAt: number | bigint;
  assertion: PasskeyAssertionArgs;
}

export function recordPasskeyAcceptanceInstruction(
  i: Base &
    RecordPasskeyAcceptanceArgs & {
      relayer: SignerInput;
      config: Address;
      organization: Address;
      document: Address;
      version: Address;
      nonceShard: Address;
      enrollment?: Address | null;
    },
): Instruction {
  return build(
    "record_passkey_acceptance",
    [
      signer(i.relayer, true),
      ro(i.config),
      ro(i.organization),
      ro(i.document),
      ro(i.version),
      rw(i.nonceShard),
      optional(i.enrollment, i.programAddress),
      ro(INSTRUCTIONS_SYSVAR_ADDRESS),
    ],
    (w) => {
      w.u32(i.nonceIndex).fixed(i.nonceTag, 8).i64(i.issuedAt).i64(i.expiresAt);
      writeAssertion(w, i.assertion);
    },
    i.programAddress,
  );
}

export function decodeRecordPasskeyAcceptanceArgs(data: Uint8Array): RecordPasskeyAcceptanceArgs & {
  issuedAt: bigint;
  expiresAt: bigint;
} {
  if (identifyInstruction(data) !== "record_passkey_acceptance")
    throw new ProtocolError("DECODE_ERROR", "not a record_passkey_acceptance instruction");
  const r = new BorshReader(data);
  r.bytes(8);
  const out = {
    nonceIndex: r.u32(),
    nonceTag: r.bytes(8),
    issuedAt: r.i64(),
    expiresAt: r.i64(),
    assertion: readAssertion(r),
  };
  if (r.remaining !== 0) throw new ProtocolError("DECODE_ERROR", "trailing instruction data");
  return out;
}

export function enrollPasskeySignerInstruction(
  i: Base & {
    relayer: SignerInput;
    config: Address;
    organization: Address;
    nonceShard: Address;
    enrollment: Address;
    accountCommitment: Uint8Array;
    credentialIdHash: Uint8Array;
    issuedAt: number | bigint;
    expiresAt: number | bigint;
    assertion: PasskeyAssertionArgs;
  },
): Instruction {
  return build(
    "enroll_passkey_signer",
    [
      signer(i.relayer, true),
      ro(i.config),
      ro(i.organization),
      ro(i.nonceShard),
      rw(i.enrollment),
      ro(SYSTEM_PROGRAM_ADDRESS),
      ro(INSTRUCTIONS_SYSVAR_ADDRESS),
    ],
    (w) => {
      w.fixed(i.accountCommitment, 32)
        .fixed(i.credentialIdHash, 32)
        .i64(i.issuedAt)
        .i64(i.expiresAt);
      writeAssertion(w, i.assertion);
    },
    i.programAddress,
  );
}

export function rotatePasskeySignerInstruction(
  i: Base & {
    relayer: SignerInput;
    config: Address;
    organization: Address;
    enrollment: Address;
    newSigner: Uint8Array;
    newCredentialIdHash: Uint8Array;
    issuedAt: number | bigint;
    expiresAt: number | bigint;
    assertion: PasskeyAssertionArgs;
  },
): Instruction {
  return build(
    "rotate_passkey_signer",
    [
      signer(i.relayer, false),
      ro(i.config),
      ro(i.organization),
      rw(i.enrollment),
      ro(INSTRUCTIONS_SYSVAR_ADDRESS),
    ],
    (w) => {
      w.fixed(i.newSigner, 33).fixed(i.newCredentialIdHash, 32).i64(i.issuedAt).i64(i.expiresAt);
      writeAssertion(w, i.assertion);
    },
    i.programAddress,
  );
}

/** The organization (owner or admin wallet) replaces a signer without the previous key. */
export function recoverPasskeySignerInstruction(
  i: Base & {
    authority: SignerInput;
    membership: Address | null;
    organization: Address;
    enrollment: Address;
    newSigner: Uint8Array;
    newCredentialIdHash: Uint8Array;
    rpIdHash: Uint8Array;
  },
): Instruction {
  return build(
    "recover_passkey_signer",
    [
      signer(i.authority, false),
      optional(i.membership, i.programAddress),
      ro(i.organization),
      rw(i.enrollment),
    ],
    (w) => w.fixed(i.newSigner, 33).fixed(i.newCredentialIdHash, 32).fixed(i.rpIdHash, 32),
    i.programAddress,
  );
}

export function revokePasskeySignerInstruction(
  i: Base & {
    authority: SignerInput;
    membership: Address | null;
    organization: Address;
    enrollment: Address;
  },
): Instruction {
  return build(
    "revoke_passkey_signer",
    [
      signer(i.authority, false),
      optional(i.membership, i.programAddress),
      ro(i.organization),
      rw(i.enrollment),
    ],
    () => undefined,
    i.programAddress,
  );
}

// ---- Merkle-batched acceptances (PROTOCOL_SPEC.md §17.9) ----------------------------------------

/** The shard's designated relayer anchors a Merkle root of off-chain-verified acceptances. */
export function anchorAcceptanceBatchInstruction(
  i: Base & {
    relayer: SignerInput;
    config: Address;
    organization: Address;
    nonceShard: Address;
    batchRoot: Uint8Array;
    leafCount: number;
  },
): Instruction {
  return build(
    "anchor_acceptance_batch",
    [
      signer(i.relayer, true),
      ro(i.config),
      ro(i.organization),
      rw(i.nonceShard),
      ro(INSTRUCTIONS_SYSVAR_ADDRESS),
    ],
    (w) => w.fixed(i.batchRoot, 32).u32(i.leafCount),
    i.programAddress,
  );
}

export function decodeAnchorAcceptanceBatchArgs(data: Uint8Array): {
  batchRoot: Uint8Array;
  leafCount: number;
} {
  if (identifyInstruction(data) !== "anchor_acceptance_batch")
    throw new ProtocolError("DECODE_ERROR", "not an anchor_acceptance_batch instruction");
  const r = new BorshReader(data);
  r.bytes(8);
  const out = { batchRoot: r.bytes(32), leafCount: r.u32() };
  if (r.remaining !== 0) throw new ProtocolError("DECODE_ERROR", "trailing instruction data");
  return out;
}
