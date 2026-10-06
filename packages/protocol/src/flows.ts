/**
 * Chain-aware flows shared by the relayer, the dashboard, scripts and tests. Both functions read
 * live on-chain state and reproduce exactly what the program will compute, so a client can show a
 * user (or publisher) the precise bytes before anything is signed.
 */
import { address, type Address } from "@solana/kit";
import { buildAcceptanceMessage, type AcceptanceMessageFields } from "./acceptance";
import {
  decodeDocument,
  decodeDocumentVersion,
  decodeNonceShard,
  decodeOrganization,
  decodeProtocolConfig,
  verifiedDomainAt,
  type DocumentAccount,
  type DocumentVersionAccount,
  type NonceShardAccount,
  type OrganizationAccount,
  type ProtocolConfigAccount,
} from "./accounts";
import {
  fetchAccountData,
  fetchManyAccountData,
  getClusterUnixTimestamp,
  type SteleRpc,
} from "./client";
import { DEFAULT_PROGRAM_ADDRESS } from "./constants";
import { contentHash as hashContent, serializeContent, type Content } from "./content";
import { fromBase58, toBase58 } from "./encoding";
import { findConfigPda, findVersionPda } from "./pda";
import { buildPasskeyAcceptanceMessage, type PasskeyAcceptanceFields } from "./passkey-p256";
import { buildProofMessage, type ProofMessageFields } from "./proof";
import { contentStorageUri } from "./storage";
import { validateTitle, validateVersionLabel } from "./validate";
import { versionHash, versionJson } from "./version";

export class ChainStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainStateError";
  }
}

const program = (p?: Address) => p ?? address(DEFAULT_PROGRAM_ADDRESS);

export async function fetchProtocolConfig(
  rpc: SteleRpc,
  programAddress?: Address,
): Promise<{ address: Address; config: ProtocolConfigAccount }> {
  const [cfgAddress] = await findConfigPda(program(programAddress));
  const data = await fetchAccountData(rpc, cfgAddress);
  if (!data) throw new ChainStateError("protocol is not initialized on this network");
  return { address: cfgAddress, config: decodeProtocolConfig(data) };
}

export interface AcceptanceMessageInput {
  rpc: SteleRpc;
  programAddress?: Address;
  organization: Address;
  document: Address;
  version: Address;
  nonceShard: Address;
  signer: Address;
  issuedAt: number;
  expiresAt: number;
  nonceIndex: number;
  nonceTag: Uint8Array;
  requestDomain: string;
  /** Cluster time used to decide whether the organization's domain is still verified. */
  clusterTime?: number;
}

export interface AcceptanceMessageResult {
  message: string;
  fields: AcceptanceMessageFields;
  config: ProtocolConfigAccount;
  organization: OrganizationAccount;
  document: DocumentAccount;
  version: DocumentVersionAccount;
  shard: NonceShardAccount;
}

type AcceptanceState = Omit<AcceptanceMessageResult, "message" | "fields"> & { now: number };

/** Live accounts behind an acceptance, with the program's preconditions checked. */
async function loadAcceptanceState(
  i: Omit<AcceptanceMessageInput, "signer">,
): Promise<AcceptanceState> {
  const [cfgAddress] = await findConfigPda(program(i.programAddress));
  const [cfgData, orgData, docData, verData, shardData] = await fetchManyAccountData(i.rpc, [
    cfgAddress,
    i.organization,
    i.document,
    i.version,
    i.nonceShard,
  ]);
  if (!cfgData) throw new ChainStateError("protocol is not initialized");
  if (!orgData || !docData || !verData || !shardData)
    throw new ChainStateError("organization, document, version or nonce shard not found");
  const config = decodeProtocolConfig(cfgData);
  const organization = decodeOrganization(orgData);
  const document = decodeDocument(docData);
  const version = decodeDocumentVersion(verData);
  const shard = decodeNonceShard(shardData);
  if (
    document.organization !== i.organization ||
    version.document !== i.document ||
    shard.organization !== i.organization
  ) {
    throw new ChainStateError("accounts do not belong together");
  }
  if (document.currentVersion !== i.version)
    throw new ChainStateError("only the current version of a document can be accepted");
  if (organization.frozen) throw new ChainStateError("organization is frozen");
  if (config.paused) throw new ChainStateError("protocol is paused");
  const now = i.clusterTime ?? (await getClusterUnixTimestamp(i.rpc));
  return { config, organization, document, version, shard, now };
}

/** Builds the exact acceptance message the program will reconstruct for these parameters. */
export async function buildAcceptanceMessageFromChain(
  i: AcceptanceMessageInput,
): Promise<AcceptanceMessageResult> {
  const { config, organization, document, version, shard, now } = await loadAcceptanceState(i);
  const fields: AcceptanceMessageFields = {
    orgName: organization.name,
    orgVerifiedDomain: verifiedDomainAt(organization, now),
    title: version.title,
    versionLabel: version.versionLabel,
    version: version.version,
    versionHash: version.versionHash,
    signer: i.signer,
    networkLabel: config.networkLabel,
    issuedAt: i.issuedAt,
    expiresAt: i.expiresAt,
    shardId: shard.shardId,
    nonceIndex: i.nonceIndex,
    nonceTag: i.nonceTag,
  };
  return {
    message: buildAcceptanceMessage(fields, i.requestDomain),
    fields,
    config,
    organization,
    document,
    version,
    shard,
  };
}

export interface PasskeyAcceptanceMessageInput extends Omit<AcceptanceMessageInput, "signer"> {
  /** 33-byte compressed P-256 key of the native passkey. */
  signer: Uint8Array;
}

export interface PasskeyAcceptanceMessageResult extends Omit<AcceptanceMessageResult, "fields"> {
  fields: PasskeyAcceptanceFields;
}

/**
 * Builds the exact `stele-acceptance-v2` message `record_passkey_acceptance` will reconstruct
 * (PROTOCOL_SPEC.md §17.2); its WebAuthn challenge is `webauthnChallenge(PASSKEY_ACCEPTANCE_TAG, …)`.
 */
export async function buildPasskeyAcceptanceMessageFromChain(
  i: PasskeyAcceptanceMessageInput,
): Promise<PasskeyAcceptanceMessageResult> {
  const { config, organization, document, version, shard, now } = await loadAcceptanceState(i);
  const fields: PasskeyAcceptanceFields = {
    orgName: organization.name,
    orgVerifiedDomain: verifiedDomainAt(organization, now),
    title: version.title,
    versionLabel: version.versionLabel,
    version: version.version,
    versionHash: version.versionHash,
    signer: i.signer,
    networkLabel: config.networkLabel,
    issuedAt: i.issuedAt,
    expiresAt: i.expiresAt,
    shardId: shard.shardId,
    nonceIndex: i.nonceIndex,
    nonceTag: i.nonceTag,
  };
  return {
    message: buildPasskeyAcceptanceMessage(fields, i.requestDomain),
    fields,
    config,
    organization,
    document,
    version,
    shard,
  };
}

export interface ProofMessageInput {
  rpc: SteleRpc;
  programAddress?: Address;
  organization: Address;
  nonceShard: Address;
  signer: Address;
  proofType: number;
  statementHash: Uint8Array;
  issuedAt: number;
  expiresAt: number;
  nonceIndex: number;
  nonceTag: Uint8Array;
  requestDomain: string;
  clusterTime?: number;
}

export interface ProofMessageResult {
  message: string;
  fields: ProofMessageFields;
  config: ProtocolConfigAccount;
  organization: OrganizationAccount;
  shard: NonceShardAccount;
}

/** Builds the exact proof anchor message the program will reconstruct for these parameters. */
export async function buildProofMessageFromChain(
  i: ProofMessageInput,
): Promise<ProofMessageResult> {
  const [cfgAddress] = await findConfigPda(program(i.programAddress));
  const [cfgData, orgData, shardData] = await fetchManyAccountData(i.rpc, [
    cfgAddress,
    i.organization,
    i.nonceShard,
  ]);
  if (!cfgData) throw new ChainStateError("protocol is not initialized");
  if (!orgData || !shardData) throw new ChainStateError("organization or nonce shard not found");
  const config = decodeProtocolConfig(cfgData);
  const organization = decodeOrganization(orgData);
  const shard = decodeNonceShard(shardData);
  if (shard.organization !== i.organization)
    throw new ChainStateError("nonce shard belongs to another organization");
  if (organization.frozen) throw new ChainStateError("organization is frozen");
  if (config.paused) throw new ChainStateError("protocol is paused");
  const now = i.clusterTime ?? (await getClusterUnixTimestamp(i.rpc));
  const fields: ProofMessageFields = {
    proofType: i.proofType,
    orgName: organization.name,
    orgVerifiedDomain: verifiedDomainAt(organization, now),
    organization: i.organization,
    statementHash: i.statementHash,
    signer: i.signer,
    networkLabel: config.networkLabel,
    chainId: config.chainId,
    issuedAt: i.issuedAt,
    expiresAt: i.expiresAt,
    shardId: shard.shardId,
    nonceIndex: i.nonceIndex,
    nonceTag: i.nonceTag,
  };
  return {
    message: buildProofMessage(fields, i.requestDomain),
    fields,
    config,
    organization,
    shard,
  };
}

export interface PreparedPublication {
  versionNumber: number;
  versionAccount: Address;
  previousVersionHash: Uint8Array;
  contentBytes: Uint8Array;
  contentHash: Uint8Array;
  storageUri: string;
  versionJson: string;
  versionHash: Uint8Array;
  chainId: string;
}

/**
 * Computes everything a publisher must review before signing: the next version number, the
 * predecessor it will commit to, the canonical content bytes and their hash, and the exact
 * fingerprint the program will compute.
 */
export async function preparePublication(i: {
  rpc: SteleRpc;
  programAddress?: Address;
  organization: Address;
  document: Address;
  title: string;
  versionLabel: string;
  effectiveAt: number;
  content: Content;
  storageUri?: string;
}): Promise<PreparedPublication> {
  validateTitle(i.title);
  validateVersionLabel(i.versionLabel);
  const p = program(i.programAddress);
  const { config } = await fetchProtocolConfig(i.rpc, p);
  const docData = await fetchAccountData(i.rpc, i.document);
  if (!docData) throw new ChainStateError("document not found");
  const document = decodeDocument(docData);
  if (document.organization !== i.organization)
    throw new ChainStateError("document belongs to another organization");
  const versionNumber = document.versionCount + 1;
  const [versionAccount] = await findVersionPda(i.document, versionNumber, p);
  const contentBytes = serializeContent(i.content);
  const contentHash = hashContent(contentBytes);
  const fields = {
    chainId: config.chainId,
    program: p,
    organization: i.organization,
    document: i.document,
    documentType: document.documentType,
    locale: document.locale,
    version: versionNumber,
    previousVersionHash: versionNumber === 1 ? null : document.headHash,
    title: i.title,
    versionLabel: i.versionLabel,
    effectiveAt: i.effectiveAt,
    contentHash,
  };
  return {
    versionNumber,
    versionAccount,
    previousVersionHash: document.headHash,
    contentBytes,
    contentHash,
    storageUri: i.storageUri ?? contentStorageUri(contentHash),
    versionJson: versionJson(fields),
    versionHash: versionHash(fields),
    chainId: config.chainId,
  };
}

/** Address ⇄ bytes helpers commonly needed next to these flows. */
export const addressToBytes = (a: Address): Uint8Array => fromBase58(a);
export const bytesToAddress = (b: Uint8Array): Address => address(toBase58(b));
