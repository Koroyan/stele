/**
 * Event decoding from transaction logs. Only `Program data:` lines emitted while **our program** is
 * the innermost executing program are decoded — another program cannot spoof Stele events by
 * logging bytes with our discriminators.
 */
import type { Address } from "@solana/kit";
import { BorshReader } from "./borsh";
import { LIMITS } from "./constants";
import { bytesEqual, fromBase64 } from "./encoding";
import { anchorDiscriminator } from "./hash";

export interface AcceptanceRecordedEvent {
  organization: Address;
  document: Address;
  version: Address;
  signer: Address;
  nonceShard: Address;
  acceptanceId: Uint8Array;
  messageHash: Uint8Array;
  accumulator: Uint8Array;
  issuedAt: bigint;
  expiresAt: bigint;
  recordedAt: bigint;
  slot: bigint;
  sequence: bigint;
  nonceIndex: number;
  shardId: number;
}

export interface VersionPublishedEvent {
  organization: Address;
  document: Address;
  versionAccount: Address;
  publisher: Address;
  versionHash: Uint8Array;
  contentHash: Uint8Array;
  previousVersionHash: Uint8Array;
  effectiveAt: bigint;
  publishedAt: bigint;
  slot: bigint;
  version: number;
  publisherRole: number;
}

export interface ProofRecordedEvent {
  organization: Address;
  signer: Address;
  nonceShard: Address;
  proofId: Uint8Array;
  statementHash: Uint8Array;
  messageHash: Uint8Array;
  accumulator: Uint8Array;
  issuedAt: bigint;
  expiresAt: bigint;
  recordedAt: bigint;
  slot: bigint;
  sequence: bigint;
  nonceIndex: number;
  shardId: number;
  proofType: number;
}

export interface SponsorReimbursedEvent {
  organization: Address;
  nonceShard: Address;
  relayer: Address;
  /** `acceptance_id` or `proof_id` of the recording whose fee was reimbursed. */
  recordId: Uint8Array;
  amount: bigint;
  fee: bigint;
  spentToday: bigint;
  day: bigint;
}

export interface PasskeyAcceptanceRecordedEvent {
  organization: Address;
  document: Address;
  version: Address;
  /** Compressed P-256 key. */
  signerKey: Uint8Array;
  /** The signer's enrollment, or `null` for a key-only acceptance. */
  enrollment: Address | null;
  nonceShard: Address;
  acceptanceId: Uint8Array;
  messageHash: Uint8Array;
  clientDataHash: Uint8Array;
  rpIdHash: Uint8Array;
  accumulator: Uint8Array;
  issuedAt: bigint;
  expiresAt: bigint;
  recordedAt: bigint;
  slot: bigint;
  sequence: bigint;
  nonceIndex: number;
  shardId: number;
  authenticatorFlags: number;
}

export interface PasskeySignerChangedEvent {
  organization: Address;
  enrollment: Address;
  accountCommitment: Uint8Array;
  signerKey: Uint8Array;
  previousKey: Uint8Array;
  rpIdHash: Uint8Array;
  credentialIdHash: Uint8Array;
  actor: Address;
  changedAt: bigint;
  slot: bigint;
  generation: number;
  kind: number;
  status: number;
}

export interface AcceptanceBatchAnchoredEvent {
  organization: Address;
  nonceShard: Address;
  batchRoot: Uint8Array;
  batchId: Uint8Array;
  accumulator: Uint8Array;
  anchoredAt: bigint;
  slot: bigint;
  sequence: bigint;
  leafCount: number;
  shardId: number;
}

/** Stele Gate: a verified acceptance created or advanced an access pass. */
export interface AccessPassUpdatedEvent {
  organization: Address;
  document: Address;
  holder: Address;
  accessPass: Address;
  version: Address;
  acceptanceId: Uint8Array;
  acceptedAt: bigint;
  slot: bigint;
  versionNumber: number;
  acceptanceCount: number;
  created: boolean;
}

export type SteleEvent =
  | { name: "AcceptanceRecorded"; data: AcceptanceRecordedEvent }
  | { name: "AccessPassUpdated"; data: AccessPassUpdatedEvent }
  | { name: "AcceptanceBatchAnchored"; data: AcceptanceBatchAnchoredEvent }
  | { name: "PasskeyAcceptanceRecorded"; data: PasskeyAcceptanceRecordedEvent }
  | { name: "PasskeySignerChanged"; data: PasskeySignerChangedEvent }
  | { name: "ProofRecorded"; data: ProofRecordedEvent }
  | { name: "SponsorReimbursed"; data: SponsorReimbursedEvent }
  | {
      name: "SponsorshipChanged";
      data: {
        organization: Address;
        nonceShard: Address;
        shardId: number;
        maxFeePerRecord: bigint;
        dailyLimit: bigint;
        paused: boolean;
        created: boolean;
        actor: Address;
      };
    }
  | {
      name: "SponsorWithdrawal";
      data: {
        organization: Address;
        nonceShard: Address;
        destination: Address;
        amount: bigint;
        remaining: bigint;
        actor: Address;
      };
    }
  | { name: "VersionPublished"; data: VersionPublishedEvent }
  | {
      name: "OrganizationCreated";
      data: {
        organization: Address;
        creator: Address;
        owner: Address;
        recovery: Address;
        name: string;
        timestamp: bigint;
      };
    }
  | {
      name: "OrganizationRenamed";
      data: { organization: Address; name: string; timestamp: bigint };
    }
  | {
      name: "AuthorityChanged";
      data: {
        organization: Address;
        kind: number;
        actor: Address;
        subject: Address;
        eta: bigint;
        timestamp: bigint;
      };
    }
  | {
      name: "OrganizationFreezeChanged";
      data: {
        organization: Address;
        frozen: boolean;
        frozenBy: number;
        actor: Address;
        timestamp: bigint;
      };
    }
  | {
      name: "MemberChanged";
      data: {
        organization: Address;
        member: Address;
        roles: number;
        revoked: boolean;
        actor: Address;
        timestamp: bigint;
      };
    }
  | {
      name: "KeyCompromiseReported";
      data: {
        organization: Address;
        member: Address;
        compromisedSince: bigint;
        reportedBy: Address;
        timestamp: bigint;
      };
    }
  | {
      name: "DomainAttested";
      data: {
        organization: Address;
        domain: string;
        attestor: Address;
        verifiedAt: bigint;
        expiresAt: bigint;
      };
    }
  | {
      name: "DomainRevoked";
      data: { organization: Address; domain: string; actor: Address; timestamp: bigint };
    }
  | {
      name: "DocumentCreated";
      data: {
        organization: Address;
        document: Address;
        slug: string;
        documentType: string;
        locale: string;
        createdBy: Address;
        timestamp: bigint;
      };
    }
  | {
      name: "NonceShardChanged";
      data: {
        organization: Address;
        nonceShard: Address;
        shardId: number;
        relayer: Address;
        created: boolean;
        actor: Address;
      };
    }
  | {
      name: "ProtocolInitialized";
      data: { admin: Address; domainAttestor: Address; chainId: string; networkLabel: string };
    }
  | { name: "ProtocolPauseChanged"; data: { paused: boolean; admin: Address } }
  | { name: "DomainAttestorChanged"; data: { previous: Address; attestor: Address } }
  | { name: "ProtocolAdminProposed"; data: { admin: Address; proposed: Address } }
  | { name: "ProtocolAdminChanged"; data: { previous: Address; admin: Address } };

type Decoder = (r: BorshReader) => SteleEvent["data"];

const DEFAULT_ADDRESS = "11111111111111111111111111111111";

const DECODERS: Record<SteleEvent["name"], Decoder> = {
  AccessPassUpdated: (r) => ({
    organization: r.address(),
    document: r.address(),
    holder: r.address(),
    accessPass: r.address(),
    version: r.address(),
    acceptanceId: r.bytes(32),
    acceptedAt: r.i64(),
    slot: r.u64(),
    versionNumber: r.u32(),
    acceptanceCount: r.u32(),
    created: r.bool(),
  }),
  AcceptanceBatchAnchored: (r) => ({
    organization: r.address(),
    nonceShard: r.address(),
    batchRoot: r.bytes(32),
    batchId: r.bytes(32),
    accumulator: r.bytes(32),
    anchoredAt: r.i64(),
    slot: r.u64(),
    sequence: r.u64(),
    leafCount: r.u32(),
    shardId: r.u16(),
  }),
  PasskeyAcceptanceRecorded: (r) => {
    const organization = r.address();
    const document = r.address();
    const version = r.address();
    const signerKey = r.bytes(33);
    const enrollment = r.address();
    return {
      organization,
      document,
      version,
      signerKey,
      enrollment: enrollment === DEFAULT_ADDRESS ? null : enrollment,
      nonceShard: r.address(),
      acceptanceId: r.bytes(32),
      messageHash: r.bytes(32),
      clientDataHash: r.bytes(32),
      rpIdHash: r.bytes(32),
      accumulator: r.bytes(32),
      issuedAt: r.i64(),
      expiresAt: r.i64(),
      recordedAt: r.i64(),
      slot: r.u64(),
      sequence: r.u64(),
      nonceIndex: r.u32(),
      shardId: r.u16(),
      authenticatorFlags: r.u8(),
    };
  },
  PasskeySignerChanged: (r) => ({
    organization: r.address(),
    enrollment: r.address(),
    accountCommitment: r.bytes(32),
    signerKey: r.bytes(33),
    previousKey: r.bytes(33),
    rpIdHash: r.bytes(32),
    credentialIdHash: r.bytes(32),
    actor: r.address(),
    changedAt: r.i64(),
    slot: r.u64(),
    generation: r.u32(),
    kind: r.u8(),
    status: r.u8(),
  }),
  ProofRecorded: (r) => ({
    organization: r.address(),
    signer: r.address(),
    nonceShard: r.address(),
    proofId: r.bytes(32),
    statementHash: r.bytes(32),
    messageHash: r.bytes(32),
    accumulator: r.bytes(32),
    issuedAt: r.i64(),
    expiresAt: r.i64(),
    recordedAt: r.i64(),
    slot: r.u64(),
    sequence: r.u64(),
    nonceIndex: r.u32(),
    shardId: r.u16(),
    proofType: r.u8(),
  }),
  SponsorReimbursed: (r) => ({
    organization: r.address(),
    nonceShard: r.address(),
    relayer: r.address(),
    recordId: r.bytes(32),
    amount: r.u64(),
    fee: r.u64(),
    spentToday: r.u64(),
    day: r.i64(),
  }),
  SponsorshipChanged: (r) => ({
    organization: r.address(),
    nonceShard: r.address(),
    shardId: r.u16(),
    maxFeePerRecord: r.u64(),
    dailyLimit: r.u64(),
    paused: r.bool(),
    created: r.bool(),
    actor: r.address(),
  }),
  SponsorWithdrawal: (r) => ({
    organization: r.address(),
    nonceShard: r.address(),
    destination: r.address(),
    amount: r.u64(),
    remaining: r.u64(),
    actor: r.address(),
  }),
  AcceptanceRecorded: (r) => ({
    organization: r.address(),
    document: r.address(),
    version: r.address(),
    signer: r.address(),
    nonceShard: r.address(),
    acceptanceId: r.bytes(32),
    messageHash: r.bytes(32),
    accumulator: r.bytes(32),
    issuedAt: r.i64(),
    expiresAt: r.i64(),
    recordedAt: r.i64(),
    slot: r.u64(),
    sequence: r.u64(),
    nonceIndex: r.u32(),
    shardId: r.u16(),
  }),
  VersionPublished: (r) => ({
    organization: r.address(),
    document: r.address(),
    versionAccount: r.address(),
    publisher: r.address(),
    versionHash: r.bytes(32),
    contentHash: r.bytes(32),
    previousVersionHash: r.bytes(32),
    effectiveAt: r.i64(),
    publishedAt: r.i64(),
    slot: r.u64(),
    version: r.u32(),
    publisherRole: r.u8(),
  }),
  OrganizationCreated: (r) => ({
    organization: r.address(),
    creator: r.address(),
    owner: r.address(),
    recovery: r.address(),
    name: r.string(LIMITS.orgName),
    timestamp: r.i64(),
  }),
  OrganizationRenamed: (r) => ({
    organization: r.address(),
    name: r.string(LIMITS.orgName),
    timestamp: r.i64(),
  }),
  AuthorityChanged: (r) => ({
    organization: r.address(),
    kind: r.u8(),
    actor: r.address(),
    subject: r.address(),
    eta: r.i64(),
    timestamp: r.i64(),
  }),
  OrganizationFreezeChanged: (r) => ({
    organization: r.address(),
    frozen: r.bool(),
    frozenBy: r.u8(),
    actor: r.address(),
    timestamp: r.i64(),
  }),
  MemberChanged: (r) => ({
    organization: r.address(),
    member: r.address(),
    roles: r.u8(),
    revoked: r.bool(),
    actor: r.address(),
    timestamp: r.i64(),
  }),
  KeyCompromiseReported: (r) => ({
    organization: r.address(),
    member: r.address(),
    compromisedSince: r.i64(),
    reportedBy: r.address(),
    timestamp: r.i64(),
  }),
  DomainAttested: (r) => ({
    organization: r.address(),
    domain: r.string(LIMITS.verifiedDomain),
    attestor: r.address(),
    verifiedAt: r.i64(),
    expiresAt: r.i64(),
  }),
  DomainRevoked: (r) => ({
    organization: r.address(),
    domain: r.string(LIMITS.verifiedDomain),
    actor: r.address(),
    timestamp: r.i64(),
  }),
  DocumentCreated: (r) => ({
    organization: r.address(),
    document: r.address(),
    slug: r.string(LIMITS.slug),
    documentType: r.string(LIMITS.documentType),
    locale: r.string(LIMITS.locale),
    createdBy: r.address(),
    timestamp: r.i64(),
  }),
  NonceShardChanged: (r) => ({
    organization: r.address(),
    nonceShard: r.address(),
    shardId: r.u16(),
    relayer: r.address(),
    created: r.bool(),
    actor: r.address(),
  }),
  ProtocolInitialized: (r) => ({
    admin: r.address(),
    domainAttestor: r.address(),
    chainId: r.string(LIMITS.chainId),
    networkLabel: r.string(LIMITS.networkLabel),
  }),
  ProtocolPauseChanged: (r) => ({ paused: r.bool(), admin: r.address() }),
  DomainAttestorChanged: (r) => ({ previous: r.address(), attestor: r.address() }),
  ProtocolAdminProposed: (r) => ({ admin: r.address(), proposed: r.address() }),
  ProtocolAdminChanged: (r) => ({ previous: r.address(), admin: r.address() }),
};

/** Events this package decodes (a subset of what the program emits). */
export const EVENT_NAMES = Object.keys(DECODERS) as SteleEvent["name"][];

const EVENT_DISCRIMINATORS = EVENT_NAMES.map((name) => ({
  name: name as SteleEvent["name"],
  discriminator: anchorDiscriminator("event", name),
}));

/** Decodes one `Program data:` payload (base64) into an event, or `null` if unknown. */
export function decodeEventData(base64: string): SteleEvent | null {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(base64);
  } catch {
    return null;
  }
  if (bytes.length < 8) return null;
  const head = bytes.subarray(0, 8);
  const match = EVENT_DISCRIMINATORS.find((e) => bytesEqual(e.discriminator, head));
  if (!match) return null;
  const r = new BorshReader(bytes);
  r.bytes(8);
  try {
    const data = DECODERS[match.name](r);
    return { name: match.name, data } as SteleEvent;
  } catch {
    return null;
  }
}

const INVOKE = /^Program (\S+) invoke \[\d+\]$/;
const EXIT = /^Program (\S+) (success|failed.*)$/;
const DATA = /^Program data: (.+)$/;

/** Decodes Stele events from logs, attributing each `Program data:` line to the executing program. */
export function decodeEventsFromLogs(
  logs: readonly string[],
  programAddress: string,
): SteleEvent[] {
  const stack: string[] = [];
  const events: SteleEvent[] = [];
  for (const line of logs) {
    const invoke = INVOKE.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    if (EXIT.test(line)) {
      stack.pop();
      continue;
    }
    const data = DATA.exec(line);
    if (data && stack[stack.length - 1] === programAddress) {
      const ev = decodeEventData(data[1]!);
      if (ev) events.push(ev);
    }
  }
  return events;
}
