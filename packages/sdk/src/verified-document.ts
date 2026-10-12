/**
 * Loads a document for acceptance and verifies it INDEPENDENTLY of the Stele API:
 *
 *   on-chain version account (via Solana RPC)  ─┐
 *   content bytes (via any mirror)               ├─► SHA-256(content) == on-chain content hash
 *   API metadata (claims)                       ─┘   recomputed fingerprint == on-chain fingerprint
 *                                                    API claims == chain facts
 *
 * Signing is only offered when every check passes. A compromised API can at worst refuse service.
 */
import {
  bytesEqual,
  chainIdFromGenesisHash,
  contentHash as hashContent,
  decodeDocument,
  decodeDocumentVersion,
  decodeOrganization,
  decodeProtocolConfig,
  findConfigPda,
  parseCanonicalContent,
  toHex,
  versionHash,
  inspectContent,
  type Content,
  type ContentFinding,
  type DocumentAccount,
  type DocumentVersionAccount,
  type OrganizationAccount,
  type ProtocolConfigAccount,
} from "@stelehq/protocol";
import { address } from "@solana/kit";
import { chainFromUrls, type ChainSource } from "@stelehq/verifier";
import type { NetworkInfo, PublicDocument, SteleClient } from "./client";

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityError";
  }
}

export interface VerifiedDocument {
  network: NetworkInfo;
  chain: ChainSource;
  api: PublicDocument;
  config: ProtocolConfigAccount;
  organization: OrganizationAccount;
  organizationAddress: string;
  document: DocumentAccount;
  documentAddress: string;
  version: DocumentVersionAccount;
  versionAddress: string;
  content: Content;
  contentBytes: Uint8Array;
  /** Hex fingerprint the user will sign. */
  fingerprint: string;
  /** Previous version's content (for "view changes"), if available and verified. */
  previous: { version: DocumentVersionAccount; content: Content } | null;
  checks: { label: string; detail: string }[];
  /**
   * What the canonical form cannot exclude (invisible direction marks, joiners, look-alike words,
   * external links not covered by the hash, pinned references). Show the suspicious ones to the
   * reader before they sign (see `SUSPICIOUS_FINDINGS`).
   */
  displayFindings: ContentFinding[];
}

export interface LoadOptions {
  client: SteleClient;
  /** Verified domain or organization address. */
  organization: string;
  /** Document slug. */
  document: string;
  /**
   * RPC endpoints to read the chain from. Pin your own (ideally two independent providers): the
   * default is the RPC list advertised by the Stele API, which a compromised API could falsify.
   */
  rpcUrls?: string[];
  /** Values pinned by the integrator. A mismatch with what the API advertises aborts loading. */
  expected?: { programId?: string; chainId?: string };
  loadPrevious?: boolean;
}

async function verifiedContent(
  client: SteleClient,
  expectedHash: Uint8Array,
): Promise<{ bytes: Uint8Array; content: Content }> {
  const bytes = await client.getContentBytes(toHex(expectedHash));
  if (!bytesEqual(hashContent(bytes), expectedHash)) {
    throw new IntegrityError(
      "The document text served does not match its on-chain fingerprint. Do not accept it.",
    );
  }
  return { bytes, content: parseCanonicalContent(bytes) };
}

export async function loadVerifiedDocument(opts: LoadOptions): Promise<VerifiedDocument> {
  const { client } = opts;
  const [network, api] = await Promise.all([
    client.getNetwork(),
    client.getPublicDocument(opts.organization, opts.document),
  ]);
  if (opts.expected?.programId && network.programId !== opts.expected.programId) {
    throw new IntegrityError(
      `The API advertises program ${network.programId}, but ${opts.expected.programId} is pinned.`,
    );
  }
  if (opts.expected?.chainId && network.chainId !== opts.expected.chainId) {
    throw new IntegrityError(
      `The API advertises network ${network.chainId}, but ${opts.expected.chainId} is pinned.`,
    );
  }
  const chain = chainFromUrls(
    opts.rpcUrls && opts.rpcUrls.length > 0 ? opts.rpcUrls : network.publicRpcUrls,
  );
  const checks: VerifiedDocument["checks"] = [];

  const versionAddress = api.document.currentVersionAddress;
  if (!versionAddress) throw new IntegrityError("This document has no published version yet.");

  const [configAddress] = await findConfigPda(address(network.programId));
  const [cfgAcc, orgAcc, docAcc, verAcc] = await chain.getAccounts(
    [configAddress, api.organization.address, api.document.address, versionAddress],
    "confirmed",
  );
  for (const [acc, what] of [
    [cfgAcc, "protocol configuration"],
    [orgAcc, "organization"],
    [docAcc, "document"],
    [verAcc, "document version"],
  ] as const) {
    if (!acc || acc.owner !== network.programId)
      throw new IntegrityError(`The ${what} account was not found on-chain.`);
  }
  const config = decodeProtocolConfig(cfgAcc!.data);
  const organization = decodeOrganization(orgAcc!.data);
  const document = decodeDocument(docAcc!.data);
  const version = decodeDocumentVersion(verAcc!.data);

  // Chain facts must agree with the API's claims.
  if (
    document.currentVersion !== versionAddress ||
    version.document !== api.document.address ||
    version.organization !== api.organization.address
  ) {
    throw new IntegrityError("The API's description of this document does not match the chain.");
  }
  if (config.chainId !== network.chainId)
    throw new IntegrityError("Network mismatch between the API and the chain.");
  if (config.chainId !== chainIdFromGenesisHash(await chain.getGenesisHash())) {
    throw new IntegrityError(
      "The RPC endpoint serves a different network than the protocol configuration claims.",
    );
  }
  checks.push({
    label: "On-chain version",
    detail: `Version ${version.versionLabel} (#${version.version}) is the document's current version.`,
  });

  // Recompute the fingerprint from on-chain fields.
  const fingerprint = versionHash({
    chainId: config.chainId,
    program: network.programId,
    organization: api.organization.address,
    document: api.document.address,
    documentType: document.documentType,
    locale: document.locale,
    version: version.version,
    previousVersionHash: version.version === 1 ? null : version.previousVersionHash,
    title: version.title,
    versionLabel: version.versionLabel,
    effectiveAt: version.effectiveAt,
    contentHash: version.contentHash,
  });
  if (!bytesEqual(fingerprint, version.versionHash))
    throw new IntegrityError("The on-chain fingerprint does not recompute.");
  checks.push({
    label: "Fingerprint",
    detail: `Recomputed fingerprint ${toHex(fingerprint)} matches the chain.`,
  });

  const { bytes, content } = await verifiedContent(client, version.contentHash);
  checks.push({
    label: "Content integrity",
    detail: "The text below hashes exactly to the on-chain commitment (SHA-256).",
  });

  let previous: VerifiedDocument["previous"] = null;
  if (opts.loadPrevious && version.version > 1) {
    const prevMeta = api.versions.find((v) => v.number === version.version - 1);
    if (prevMeta) {
      const prevAcc = await chain.getAccount(prevMeta.address, "confirmed");
      if (prevAcc && prevAcc.owner === network.programId) {
        const prevVersion = decodeDocumentVersion(prevAcc.data);
        if (bytesEqual(prevVersion.versionHash, version.previousVersionHash)) {
          const prev = await verifiedContent(client, prevVersion.contentHash).catch(() => null);
          if (prev) previous = { version: prevVersion, content: prev.content };
        }
      }
    }
  }

  return {
    network,
    chain,
    api,
    config,
    organization,
    organizationAddress: api.organization.address,
    document,
    documentAddress: api.document.address,
    version,
    versionAddress,
    content,
    contentBytes: bytes,
    fingerprint: toHex(fingerprint),
    previous,
    checks,
    displayFindings: inspectContent(content),
  };
}
