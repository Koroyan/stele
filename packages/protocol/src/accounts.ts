/**
 * Account decoders (PROTOCOL_SPEC.md §6.2). Every decoder checks the Anchor discriminator before
 * reading, so an account of one type can never be decoded as another.
 */
import type { Address } from "@solana/kit";
import { BorshReader } from "./borsh";
import { LIMITS, NONCE_SHARD_ACCOUNT_SIZE, SHARD_BITMAP_BYTES } from "./constants";
import { bytesEqual } from "./encoding";
import { ProtocolError } from "./errors";
import { anchorDiscriminator } from "./hash";

export const ACCOUNT_NAMES = [
  "ProtocolConfig",
  "Organization",
  "Member",
  "DomainRecord",
  "Document",
  "DocumentVersion",
  "NonceShard",
  "PasskeySigner",
  "AccessPass",
] as const;
export type AccountName = (typeof ACCOUNT_NAMES)[number];

export const ACCOUNT_DISCRIMINATORS: Record<AccountName, Uint8Array> = Object.fromEntries(
  ACCOUNT_NAMES.map((n) => [n, anchorDiscriminator("account", n)]),
) as Record<AccountName, Uint8Array>;

/** Identifies an account's type from its discriminator, or `null`. */
export function identifyAccount(data: Uint8Array): AccountName | null {
  if (data.length < 8) return null;
  const head = data.subarray(0, 8);
  return ACCOUNT_NAMES.find((n) => bytesEqual(ACCOUNT_DISCRIMINATORS[n], head)) ?? null;
}

function reader(data: Uint8Array, name: AccountName): BorshReader {
  if (data.length < 8 || !bytesEqual(data.subarray(0, 8), ACCOUNT_DISCRIMINATORS[name])) {
    throw new ProtocolError("DECODE_ERROR", `account is not a ${name}`);
  }
  const r = new BorshReader(data);
  r.bytes(8);
  return r;
}

export const ZERO_ADDRESS = "11111111111111111111111111111111" as Address;
const orNull = (a: Address): Address | null => (a === ZERO_ADDRESS ? null : a);

export interface ProtocolConfigAccount {
  admin: Address;
  pendingAdmin: Address | null;
  domainAttestor: Address;
  paused: boolean;
  bump: number;
  chainId: string;
  networkLabel: string;
}

export function decodeProtocolConfig(data: Uint8Array): ProtocolConfigAccount {
  const r = reader(data, "ProtocolConfig");
  return {
    admin: r.address(),
    pendingAdmin: orNull(r.address()),
    domainAttestor: r.address(),
    paused: r.bool(),
    bump: r.u8(),
    chainId: r.string(LIMITS.chainId),
    networkLabel: r.string(LIMITS.networkLabel),
  };
}

export interface OrganizationAccount {
  creator: Address;
  seed: Uint8Array;
  owner: Address;
  pendingOwner: Address | null;
  recovery: Address | null;
  pendingRecovery: Address | null;
  pendingRecoveryEta: bigint;
  recoveryTargetOwner: Address | null;
  recoveryEta: bigint;
  domainVerifiedAt: bigint;
  domainExpiresAt: bigint;
  createdAt: bigint;
  documentCount: number;
  memberCount: number;
  frozen: boolean;
  frozenBy: number;
  bump: number;
  name: string;
  verifiedDomain: string | null;
}

export function decodeOrganization(data: Uint8Array): OrganizationAccount {
  const r = reader(data, "Organization");
  const creator = r.address();
  const seed = r.bytes(32);
  const owner = r.address();
  const pendingOwner = orNull(r.address());
  const recovery = orNull(r.address());
  const pendingRecovery = orNull(r.address());
  const pendingRecoveryEta = r.i64();
  const recoveryTargetOwner = orNull(r.address());
  const recoveryEta = r.i64();
  const domainVerifiedAt = r.i64();
  const domainExpiresAt = r.i64();
  const createdAt = r.i64();
  const documentCount = r.u32();
  const memberCount = r.u32();
  const frozen = r.bool();
  const frozenBy = r.u8();
  const bump = r.u8();
  const name = r.string(LIMITS.orgName);
  const domain = r.string(LIMITS.verifiedDomain);
  return {
    creator,
    seed,
    owner,
    pendingOwner,
    recovery,
    pendingRecovery,
    pendingRecoveryEta,
    recoveryTargetOwner,
    recoveryEta,
    domainVerifiedAt,
    domainExpiresAt,
    createdAt,
    documentCount,
    memberCount,
    frozen,
    frozenBy,
    bump,
    name,
    verifiedDomain: domain === "" ? null : domain,
  };
}

/** The verified domain shown in acceptance messages at cluster time `now` (seconds). */
export function verifiedDomainAt(org: OrganizationAccount, now: number | bigint): string | null {
  return org.verifiedDomain !== null && BigInt(now) < org.domainExpiresAt
    ? org.verifiedDomain
    : null;
}

export interface MemberAccount {
  organization: Address;
  member: Address;
  addedBy: Address;
  addedAt: bigint;
  updatedAt: bigint;
  revokedAt: bigint;
  compromisedSince: bigint;
  compromiseReportedAt: bigint;
  roles: number;
  bump: number;
}

export function decodeMember(data: Uint8Array): MemberAccount {
  const r = reader(data, "Member");
  return {
    organization: r.address(),
    member: r.address(),
    addedBy: r.address(),
    addedAt: r.i64(),
    updatedAt: r.i64(),
    revokedAt: r.i64(),
    compromisedSince: r.i64(),
    compromiseReportedAt: r.i64(),
    roles: r.u8(),
    bump: r.u8(),
  };
}

export interface DomainRecordAccount {
  organization: Address;
  attestor: Address;
  rentPayer: Address;
  domainHash: Uint8Array;
  verifiedAt: bigint;
  expiresAt: bigint;
  method: number;
  bump: number;
  domain: string;
}

export function decodeDomainRecord(data: Uint8Array): DomainRecordAccount {
  const r = reader(data, "DomainRecord");
  return {
    organization: r.address(),
    attestor: r.address(),
    rentPayer: r.address(),
    domainHash: r.bytes(32),
    verifiedAt: r.i64(),
    expiresAt: r.i64(),
    method: r.u8(),
    bump: r.u8(),
    domain: r.string(LIMITS.verifiedDomain),
  };
}

export interface DocumentAccount {
  organization: Address;
  createdBy: Address;
  headHash: Uint8Array;
  currentVersion: Address | null;
  createdAt: bigint;
  lastPublishedAt: bigint;
  versionCount: number;
  bump: number;
  slug: string;
  documentType: string;
  locale: string;
}

export function decodeDocument(data: Uint8Array): DocumentAccount {
  const r = reader(data, "Document");
  return {
    organization: r.address(),
    createdBy: r.address(),
    headHash: r.bytes(32),
    currentVersion: orNull(r.address()),
    createdAt: r.i64(),
    lastPublishedAt: r.i64(),
    versionCount: r.u32(),
    bump: r.u8(),
    slug: r.string(LIMITS.slug),
    documentType: r.string(LIMITS.documentType),
    locale: r.string(LIMITS.locale),
  };
}

export interface DocumentVersionAccount {
  document: Address;
  organization: Address;
  versionHash: Uint8Array;
  contentHash: Uint8Array;
  previousVersionHash: Uint8Array;
  publisher: Address;
  effectiveAt: bigint;
  publishedAt: bigint;
  publishedSlot: bigint;
  version: number;
  publisherRole: number;
  bump: number;
  title: string;
  versionLabel: string;
  storageUri: string;
}

/** Byte offset of `version_hash` — for `getProgramAccounts` memcmp lookups by fingerprint. */
export const VERSION_HASH_OFFSET = 72;

export function decodeDocumentVersion(data: Uint8Array): DocumentVersionAccount {
  const r = reader(data, "DocumentVersion");
  return {
    document: r.address(),
    organization: r.address(),
    versionHash: r.bytes(32),
    contentHash: r.bytes(32),
    previousVersionHash: r.bytes(32),
    publisher: r.address(),
    effectiveAt: r.i64(),
    publishedAt: r.i64(),
    publishedSlot: r.u64(),
    version: r.u32(),
    publisherRole: r.u8(),
    bump: r.u8(),
    title: r.string(LIMITS.title),
    versionLabel: r.string(LIMITS.versionLabel),
    storageUri: r.string(LIMITS.storageUri),
  };
}

export interface NonceShardAccount {
  organization: Address;
  relayer: Address | null;
  accumulator: Uint8Array;
  acceptedCount: bigint;
  createdAt: bigint;
  shardId: number;
  bump: number;
  bitmap: Uint8Array;
}

export function decodeNonceShard(data: Uint8Array): NonceShardAccount {
  const r = reader(data, "NonceShard");
  const organization = r.address();
  const relayer = orNull(r.address());
  const accumulator = r.bytes(32);
  const acceptedCount = r.u64();
  const createdAt = r.i64();
  const shardId = r.u16();
  const bump = r.u8();
  r.bytes(5);
  const bitmap = r.bytes(SHARD_BITMAP_BYTES);
  return { organization, relayer, accumulator, acceptedCount, createdAt, shardId, bump, bitmap };
}

/** Fee-sponsorship trailer of a nonce shard (PROTOCOL_SPEC.md §13). */
export interface ShardSponsorship {
  createdBy: Address;
  maxFeePerRecord: bigint;
  dailyLimit: bigint;
  currentDay: bigint;
  spentToday: bigint;
  totalReimbursed: bigint;
  reimbursedCount: bigint;
  totalWithdrawn: bigint;
  createdAt: bigint;
  updatedAt: bigint;
  paused: boolean;
}

export const SHARD_SPONSORSHIP_MAGIC = "stelesp1";
export const SHARD_SPONSORSHIP_SIZE = 120;
/** Account data size of a nonce shard with sponsorship enabled. */
export const SPONSORED_NONCE_SHARD_ACCOUNT_SIZE = NONCE_SHARD_ACCOUNT_SIZE + SHARD_SPONSORSHIP_SIZE;

/** The sponsorship trailer of a shard's account data, or `null` when sponsorship is not enabled. */
export function decodeShardSponsorship(data: Uint8Array): ShardSponsorship | null {
  if (data.length === NONCE_SHARD_ACCOUNT_SIZE) return null;
  if (data.length !== SPONSORED_NONCE_SHARD_ACCOUNT_SIZE)
    throw new ProtocolError("DECODE_ERROR", "unexpected nonce shard size");
  const r = new BorshReader(data.subarray(NONCE_SHARD_ACCOUNT_SIZE));
  const magic = new TextDecoder().decode(r.bytes(8));
  if (magic !== SHARD_SPONSORSHIP_MAGIC)
    throw new ProtocolError("DECODE_ERROR", "invalid sponsorship trailer");
  const out: ShardSponsorship = {
    createdBy: r.address(),
    maxFeePerRecord: r.u64(),
    dailyLimit: r.u64(),
    currentDay: r.i64(),
    spentToday: r.u64(),
    totalReimbursed: r.u64(),
    reimbursedCount: r.u64(),
    totalWithdrawn: r.u64(),
    createdAt: r.i64(),
    updatedAt: r.i64(),
    paused: r.u8() !== 0,
  };
  return out;
}

export const PASSKEY_STATUS_ACTIVE = 1;
export const PASSKEY_STATUS_REVOKED = 2;
export const PASSKEY_KIND_ENROLLED = 1;
export const PASSKEY_KIND_ROTATED = 2;
export const PASSKEY_KIND_ORGANIZATION_RECOVERY = 3;

/** Size of a PasskeySigner account: discriminator + fields (programs/stele/src/state.rs). */
export const PASSKEY_SIGNER_ACCOUNT_SIZE = 8 + 32 + 32 + 33 + 33 + 32 + 32 + 8 + 8 + 4 + 1 + 1 + 1;

export interface PasskeySignerAccount {
  organization: Address;
  accountCommitment: Uint8Array;
  /** Compressed P-256 key of the current signer. */
  signerKey: Uint8Array;
  /** The key this one replaced (all zero for the first enrollment). */
  previousKey: Uint8Array;
  rpIdHash: Uint8Array;
  credentialIdHash: Uint8Array;
  enrolledAt: bigint;
  updatedAt: bigint;
  generation: number;
  status: number;
  kind: number;
  bump: number;
}

export function decodePasskeySigner(data: Uint8Array): PasskeySignerAccount {
  const r = reader(data, "PasskeySigner");
  return {
    organization: r.address(),
    accountCommitment: r.bytes(32),
    signerKey: r.bytes(33),
    previousKey: r.bytes(33),
    rpIdHash: r.bytes(32),
    credentialIdHash: r.bytes(32),
    enrolledAt: r.i64(),
    updatedAt: r.i64(),
    generation: r.u32(),
    status: r.u8(),
    kind: r.u8(),
    bump: r.u8(),
  };
}

/** Size of an AccessPass account: discriminator + fields (programs/stele/src/state.rs). */
export const ACCESS_PASS_ACCOUNT_SIZE = 8 + 32 * 4 + 32 + 8 + 8 + 8 + 4 + 4 + 1;

/** Stele Gate: a wallet's latest acceptance of one policy document (PROTOCOL_SPEC.md §18.1). */
export interface AccessPassAccount {
  organization: Address;
  document: Address;
  holder: Address;
  /** The DocumentVersion most recently accepted. */
  version: Address;
  acceptanceId: Uint8Array;
  acceptedAt: bigint;
  firstAcceptedAt: bigint;
  acceptedSlot: bigint;
  versionNumber: number;
  acceptanceCount: number;
  bump: number;
}

export function decodeAccessPass(data: Uint8Array): AccessPassAccount {
  const r = reader(data, "AccessPass");
  return {
    organization: r.address(),
    document: r.address(),
    holder: r.address(),
    version: r.address(),
    acceptanceId: r.bytes(32),
    acceptedAt: r.i64(),
    firstAcceptedAt: r.i64(),
    acceptedSlot: r.u64(),
    versionNumber: r.u32(),
    acceptanceCount: r.u32(),
    bump: r.u8(),
  };
}
