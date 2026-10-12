/**
 * Independent verification of Stele evidence (PROTOCOL_SPEC.md §11).
 *
 * Inputs are untrusted (a transaction signature, a receipt file, a version address or fingerprint).
 * Everything is re-derived from Solana (via one or more RPC endpoints that must agree) and from
 * content bytes whose SHA-256 must match the on-chain commitment.
 */
import { address as toAddress, type Address } from "@solana/kit";
import {
  ACCOUNT_DISCRIMINATORS,
  MAX_ISSUED_AT_SKEW,
  PUBLISHER_ROLE_MEMBER,
  VERSION_HASH_OFFSET,
  acceptanceId as computeAcceptanceId,
  buildAcceptanceMessage,
  bytesEqual,
  chainIdFromGenesisHash,
  contentHash as hashContentBytes,
  decodeDocument,
  decodeDocumentVersion,
  decodeDomainRecord,
  decodeEventsFromLogs,
  decodeMember,
  decodeNonceShard,
  decodeOrganization,
  decodeProtocolConfig,
  decodePublishVersionArgs,
  decodeRecordAcceptanceArgs,
  ED25519_PROGRAM_ADDRESS,
  findAccessPassPda,
  findConfigPda,
  findDocumentPda,
  findDomainRecordPda,
  findMemberPda,
  findOrganizationPda,
  findVersionPda,
  fromBase58,
  fromHex,
  fromUtf8,
  identifyInstruction,
  INSTRUCTIONS_SYSVAR_ADDRESS,
  isNonceConsumed,
  messageHash as computeMessageHash,
  parseAcceptanceMessage,
  parseCanonicalContent,
  parseCanonicalEd25519Data,
  serializeContent,
  toBase58,
  toHex,
  verifiedDomainAt,
  verifyEd25519,
  versionHash,
  type DocumentAccount,
  type DocumentVersionAccount,
  type OrganizationAccount,
  type ProtocolConfigAccount,
  type Content,
  type Receipt,
  type SignerEvidence,
  type ProofReceipt,
  DEFAULT_PROGRAM_ADDRESS,
  checkCommerceTotals,
  parseCommerceDetails,
  decodeRecordProofArgs,
  parseProofMessage,
  parseProofReceipt,
  parseStatement,
  proofId as computeProofId,
  proofTypeByCode,
  statementHash,
  PASSKEY_ACCEPTANCE_TAG,
  PASSKEY_KIND_ORGANIZATION_RECOVERY,
  PASSKEY_KIND_ROTATED,
  PASSKEY_STATUS_REVOKED,
  PasskeyCheckFailure,
  RECEIPT_V2_FORMAT,
  SECP256R1_PROGRAM_ADDRESS,
  buildPasskeyAcceptanceMessage,
  checkAuthenticatorData,
  checkPasskeyAssertion,
  decodePasskeySigner,
  decodeRecordPasskeyAcceptanceArgs,
  findPasskeySignerPda,
  p256KeyId,
  parseAnyReceipt,
  parsePasskeyAcceptanceMessage,
  parseSecp256r1Instruction,
  passkeyAcceptanceId,
  passkeyOriginMatches,
  rpIdCovers,
  sha256,
  toBase64Url,
  utf8,
  verifyP256,
  webauthnChallenge,
  type ParsedPasskeyAcceptanceMessage,
  type ParsedSecp256r1,
  type PasskeyAcceptanceRecordedEvent,
  type ReceiptV2,
  type BatchedEvidence,
  batchedEvidenceSchema,
  SUSPICIOUS_FINDINGS,
  describeFinding,
  inspectContent,
  batchId as computeBatchId,
  batchLeafHash,
  concatBytes,
  decodeAnchorAcceptanceBatchArgs,
  fromBase64Url,
  verifyMerkleProof,
} from "@stelehq/protocol";
import { checkFees, checkSignerEvidence } from "./evidence";
import { retrieveContent, type ContentOptions } from "./content";
import { ReportBuilder, type VerificationReport, type VerifiedFacts } from "./report";
import {
  RpcDisagreementError,
  type ChainSource,
  type ReadCommitment,
  type TransactionSnapshot,
} from "./rpc";
import { decodeWireTransaction, type DecodedInstruction, type DecodedTransaction } from "./wire";

export interface VerifierOptions {
  chain: ChainSource;
  /** Expected program ID (default: the Stele program). */
  programId?: string;
  /** Expected CAIP-2 chain ID. When set, the RPC genesis hash must match it. */
  expectedChainId?: string;
  content?: ContentOptions;
  /** Hosts other than the organization's own domain that legitimately request acceptances. */
  trustedRequestDomains?: string[];
  /** Check `_stele.<domain>` TXT live via DNS-over-HTTPS. */
  liveDnsCheck?: boolean;
  dohUrl?: string;
  /** Scan whole blocks when the publication transaction cannot be found otherwise (heavy). */
  deepPublicationSearch?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface Context {
  /** Commitment for state reads: equals the commitment of the transaction being verified. */
  commitment: ReadCommitment;
  b: ReportBuilder;
  opts: VerifierOptions;
  programId: Address;
  config: ProtocolConfigAccount | null;
  genesisHash: string | null;
}

interface VersionContext {
  address: string;
  version: DocumentVersionAccount;
  document: DocumentAccount;
  documentAddress: string;
  organization: OrganizationAccount;
  organizationAddress: string;
}

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const nowSeconds = (opts: VerifierOptions) =>
  opts.now ? opts.now() : Math.floor(Date.now() / 1000);

// ---- shared: network & program --------------------------------------------------------------------

async function checkNetwork(ctx: Context): Promise<boolean> {
  const { b, opts } = ctx;
  try {
    ctx.genesisHash = await opts.chain.getGenesisHash();
  } catch (e) {
    b.error("network.genesis", "Network identity", `Could not read genesis hash: ${describe(e)}`);
    return false;
  }
  const [configAddress] = await findConfigPda(ctx.programId);
  let configAccount;
  try {
    configAccount = await opts.chain.getAccount(configAddress, ctx.commitment);
  } catch (e) {
    b.error("network.config", "Protocol configuration", describe(e));
    return false;
  }
  if (!configAccount || configAccount.owner !== ctx.programId) {
    b.fail(
      "network.config",
      "Protocol configuration",
      `No Stele configuration account owned by ${ctx.programId} on this network.`,
    );
    return false;
  }
  try {
    ctx.config = decodeProtocolConfig(configAccount.data);
  } catch (e) {
    b.fail("network.config", "Protocol configuration", describe(e));
    return false;
  }
  const derived = chainIdFromGenesisHash(ctx.genesisHash);
  const config = ctx.config;
  if (config.chainId === derived) {
    b.pass(
      "network.genesis",
      "Network identity",
      `Genesis hash ${ctx.genesisHash} matches the program's immutable chain ID ${config.chainId} (${config.networkLabel}).`,
    );
  } else if (config.chainId === "solana:localnet") {
    b.warn(
      "network.genesis",
      "Network identity",
      `Local network (${config.networkLabel}); the chain ID is not genesis-derived. Local evidence is for testing only.`,
    );
  } else {
    b.fail(
      "network.genesis",
      "Network identity",
      `RPC genesis hash ${ctx.genesisHash} does not match configured chain ID ${config.chainId}.`,
    );
  }
  if (opts.expectedChainId !== undefined) {
    b.expect(
      config.chainId === opts.expectedChainId,
      "network.expected",
      "Expected network",
      `Evidence belongs to ${opts.expectedChainId}.`,
      `Evidence belongs to ${config.chainId}, not the expected ${opts.expectedChainId}.`,
    );
  }
  b.facts.network = {
    chainId: config.chainId,
    label: config.networkLabel,
    programId: ctx.programId,
    genesisHash: ctx.genesisHash,
  };
  return true;
}

// ---- shared: document version ----------------------------------------------------------------------

async function loadVersion(ctx: Context, versionAddress: string): Promise<VersionContext | null> {
  const { b, opts, programId } = ctx;
  let accounts;
  try {
    const versionAcc = await opts.chain.getAccount(versionAddress, ctx.commitment);
    if (!versionAcc) {
      b.fail(
        "version.account",
        "Document version account",
        `No account exists at ${versionAddress}.`,
      );
      return null;
    }
    if (versionAcc.owner !== programId) {
      b.fail(
        "version.account",
        "Document version account",
        `Account is owned by ${versionAcc.owner}, not the Stele program.`,
      );
      return null;
    }
    const version = decodeDocumentVersion(versionAcc.data);
    const [docAcc, orgAcc] = await opts.chain.getAccounts(
      [version.document, version.organization],
      ctx.commitment,
    );
    accounts = { version, docAcc, orgAcc };
  } catch (e) {
    b.add(
      "version.account",
      "Document version account",
      e instanceof RpcDisagreementError ? "error" : "fail",
      describe(e),
    );
    return null;
  }
  const { version, docAcc, orgAcc } = accounts;
  const [pda] = await findVersionPda(version.document, version.version, programId);
  if (
    !b.expect(
      pda === versionAddress,
      "version.account",
      "Document version account",
      `Version #${version.version} is the canonical PDA of its document.`,
      `Address is not the canonical PDA for version #${version.version}.`,
    )
  ) {
    return null;
  }
  if (!docAcc || docAcc.owner !== programId || !orgAcc || orgAcc.owner !== programId) {
    b.fail(
      "version.relations",
      "Organization and document",
      "Document or organization account is missing or not owned by the program.",
    );
    return null;
  }
  let document: DocumentAccount;
  let organization: OrganizationAccount;
  try {
    document = decodeDocument(docAcc.data);
    organization = decodeOrganization(orgAcc.data);
  } catch (e) {
    b.fail("version.relations", "Organization and document", describe(e));
    return null;
  }
  const [docPda] = await findDocumentPda(version.organization, document.slug, programId);
  const [orgPda] = await findOrganizationPda(organization.creator, organization.seed, programId);
  const related =
    document.organization === version.organization &&
    docPda === version.document &&
    orgPda === version.organization;
  b.expect(
    related,
    "version.relations",
    "Organization and document",
    `Version belongs to document "${document.slug}" of organization ${version.organization}.`,
    "Version, document and organization accounts are not consistently related.",
  );
  if (!related) return null;
  return {
    address: versionAddress,
    version,
    document,
    documentAddress: version.document,
    organization,
    organizationAddress: version.organization,
  };
}

function recomputeFingerprint(
  ctx: Context,
  vc: VersionContext,
  v: DocumentVersionAccount,
): Uint8Array {
  return versionHash({
    chainId: ctx.config!.chainId,
    program: ctx.programId,
    organization: vc.organizationAddress,
    document: vc.documentAddress,
    documentType: vc.document.documentType,
    locale: vc.document.locale,
    version: v.version,
    previousVersionHash: v.version === 1 ? null : v.previousVersionHash,
    title: v.title,
    versionLabel: v.versionLabel,
    effectiveAt: v.effectiveAt,
    contentHash: v.contentHash,
  });
}

async function findPublicationTransaction(
  ctx: Context,
  vc: VersionContext,
  hint?: string,
): Promise<TransactionSnapshot | null> {
  const { opts } = ctx;
  const isPublication = (tx: TransactionSnapshot | null): tx is TransactionSnapshot => {
    if (!tx || tx.err !== null) return false;
    try {
      const decoded = decodeWireTransaction(tx.wire, tx.loadedWritable, tx.loadedReadonly);
      return decoded.instructions.some(
        (ix) =>
          ix.programId === ctx.programId &&
          identifyInstruction(ix.data) === "publish_version" &&
          ix.accounts[5] === vc.address,
      );
    } catch {
      return false;
    }
  };
  if (hint) {
    const tx = await opts.chain.getTransaction(hint).catch(() => null);
    if (isPublication(tx)) return tx;
  }
  // Oldest transaction touching the version account (bounded paging).
  let before: string | undefined;
  for (let page = 0; page < 5; page++) {
    const sigs = await opts.chain
      .getSignaturesForAddress(vc.address, { before, limit: 1000, commitment: ctx.commitment })
      .catch(() => []);
    if (sigs.length === 0) break;
    if (sigs.length < 1000) {
      const oldest = sigs[sigs.length - 1]!;
      const tx = await opts.chain.getTransaction(oldest.signature).catch(() => null);
      return isPublication(tx) ? tx : null;
    }
    before = sigs[sigs.length - 1]!.signature;
  }
  if (opts.deepPublicationSearch) {
    const signatures = await opts.chain.getBlockSignatures(Number(vc.version.publishedSlot));
    for (const sig of signatures ?? []) {
      const tx = await opts.chain.getTransaction(sig).catch(() => null);
      if (isPublication(tx)) return tx;
    }
  }
  return null;
}

async function verifyVersionEvidence(
  ctx: Context,
  vc: VersionContext,
  input: { publicationHint?: string; embeddedContent?: Uint8Array | null },
): Promise<void> {
  const { b, opts } = ctx;
  const v = vc.version;

  // Fingerprint recomputed from on-chain fields.
  const fingerprint = recomputeFingerprint(ctx, vc, v);
  b.expect(
    bytesEqual(fingerprint, v.versionHash),
    "version.fingerprint",
    "Version fingerprint",
    `SHA-256 of the canonical version JSON equals the stored fingerprint ${toHex(v.versionHash)}.`,
    `Recomputed fingerprint ${toHex(fingerprint)} differs from stored ${toHex(v.versionHash)}.`,
  );
  if (v.version === 1) {
    b.expect(
      v.previousVersionHash.every((x) => x === 0),
      "chain.genesis",
      "First version",
      "Version 1 has no predecessor.",
      "Version 1 claims a predecessor.",
    );
  }

  // Original publication transaction (immutable ledger) vs. current account state.
  const tx = await findPublicationTransaction(ctx, vc, input.publicationHint);
  let publicationSignature: string | null = null;
  if (!tx) {
    b.warn(
      "version.publication",
      "Publication transaction",
      "The original publication transaction could not be located with the available RPC methods; account state was not cross-checked against it.",
    );
  } else {
    publicationSignature = tx.signature;
    const decoded = decodeWireTransaction(tx.wire, tx.loadedWritable, tx.loadedReadonly);
    const ix = decoded.instructions.find(
      (i) =>
        i.programId === ctx.programId &&
        identifyInstruction(i.data) === "publish_version" &&
        i.accounts[5] === vc.address,
    )!;
    const args = decodePublishVersionArgs(ix.data);
    const signerIndex = decoded.accountKeys.indexOf(ix.accounts[0]!);
    const consistent =
      args.version === v.version &&
      bytesEqual(args.previousVersionHash, v.previousVersionHash) &&
      bytesEqual(args.contentHash, v.contentHash) &&
      bytesEqual(args.expectedVersionHash, v.versionHash) &&
      args.title === v.title &&
      args.versionLabel === v.versionLabel &&
      BigInt(args.effectiveAt) === v.effectiveAt &&
      args.storageUri === v.storageUri &&
      ix.accounts[0] === v.publisher &&
      signerIndex >= 0 &&
      signerIndex < decoded.numRequiredSignatures &&
      BigInt(tx.slot) === v.publishedSlot;
    b.expect(
      consistent,
      "version.publication",
      "Publication transaction",
      `Transaction ${tx.signature} (slot ${tx.slot}) published exactly this version, signed by ${v.publisher}.`,
      `Account state differs from the original publication transaction ${tx.signature} — the account may have been altered after publication.`,
    );
  }

  // Content.
  const content = await retrieveContent(
    v.contentHash,
    v.storageUri,
    input.embeddedContent ?? null,
    { fetchImpl: opts.fetchImpl, ...opts.content },
  );
  b.contentAttempts.push(...content.attempts);
  const mismatches = content.attempts.filter((a) => a.outcome === "mismatch");
  if (content.bytes) {
    b.pass(
      "content.integrity",
      "Content integrity",
      `Content from ${content.matchedSource} hashes to ${toHex(v.contentHash)}.`,
    );
    if (mismatches.length > 0) {
      b.warn(
        "content.sources",
        "Content sources",
        `${mismatches.length} source(s) served different bytes: ${mismatches.map((m) => m.source).join(", ")}.`,
      );
    }
    try {
      const parsed = parseCanonicalContent(content.bytes);
      b.pass(
        "content.canonical",
        "Canonical form",
        "Content is canonical stele-content-v1 (stele-canonical-v1).",
      );
      b.facts.content = { canonical: fromUtf8(content.bytes), source: content.matchedSource! };
      await checkContentSafety(ctx, parsed);
    } catch (e) {
      b.fail(
        "content.canonical",
        "Canonical form",
        `Stored bytes are not canonical: ${describe(e)}`,
      );
    }
  } else if (mismatches.length > 0 && content.attempts.every((a) => a.outcome !== "unavailable")) {
    b.fail(
      "content.integrity",
      "Content integrity",
      `Every available source served content that does not match the on-chain hash (${mismatches.map((m) => m.source).join(", ")}).`,
    );
  } else {
    b.error(
      "content.integrity",
      "Content integrity",
      "Content could not be retrieved from any source. The commitment is intact, but the wording cannot be shown.",
    );
  }

  // Predecessor chain.
  if (v.version > 1) {
    const numbers = Array.from({ length: v.version - 1 }, (_, i) => v.version - 1 - i);
    const addresses = await Promise.all(
      numbers.map(async (n) => (await findVersionPda(vc.version.document, n, ctx.programId))[0]),
    );
    try {
      const accounts = await opts.chain.getAccounts(addresses, ctx.commitment);
      let expectedHash = v.previousVersionHash;
      const history: { number: number; fingerprint: string; address: string }[] = [];
      let broken: string | null = null;
      for (let i = 0; i < numbers.length; i++) {
        const acc = accounts[i];
        if (!acc || acc.owner !== ctx.programId) {
          broken = `version #${numbers[i]} is missing`;
          break;
        }
        const pv = decodeDocumentVersion(acc.data);
        const pvFingerprint = recomputeFingerprint(ctx, vc, pv);
        if (
          pv.version !== numbers[i] ||
          !bytesEqual(pv.versionHash, expectedHash) ||
          !bytesEqual(pvFingerprint, pv.versionHash)
        ) {
          broken = `link to version #${numbers[i]} does not verify`;
          break;
        }
        history.push({
          number: pv.version,
          fingerprint: toHex(pv.versionHash),
          address: addresses[i]!,
        });
        expectedHash = pv.previousVersionHash;
      }
      if (!broken && !expectedHash.every((x) => x === 0))
        broken = "version #1 claims a predecessor";
      b.expect(
        !broken,
        "chain.links",
        "Version history chain",
        `All ${v.version - 1} predecessor(s) link by fingerprint back to version 1.`,
        `History chain broken: ${broken}.`,
      );
      b.facts.history = history.reverse();
    } catch (e) {
      b.error("chain.links", "Version history chain", describe(e));
    }
  } else {
    b.pass("chain.links", "Version history chain", "This is the first version.");
    b.facts.history = [];
  }

  // Publisher authority annotations.
  if (v.publisherRole === PUBLISHER_ROLE_MEMBER) {
    const [memberPda] = await findMemberPda(
      toAddress(vc.organizationAddress),
      v.publisher,
      ctx.programId,
    );
    const acc = await opts.chain.getAccount(memberPda, ctx.commitment).catch(() => null);
    if (acc && acc.owner === ctx.programId) {
      const m = decodeMember(acc.data);
      if (m.compromisedSince !== 0n && m.compromisedSince <= v.publishedAt) {
        b.warn(
          "publisher.compromise",
          "Publisher key status",
          `The organization reported the publisher key compromised since ${new Date(Number(m.compromisedSince) * 1000).toISOString()} (report recorded ${new Date(Number(m.compromiseReportedAt) * 1000).toISOString()}). This version was published after that time.`,
        );
      } else {
        b.pass(
          "publisher.compromise",
          "Publisher key status",
          "No compromise was reported for the publisher key covering this publication.",
          false,
        );
      }
    }
  } else {
    b.pass(
      "publisher.compromise",
      "Publisher key status",
      "Published by the organization owner authority.",
      false,
    );
  }

  b.facts.version = {
    address: vc.address,
    number: v.version,
    label: v.versionLabel,
    title: v.title,
    fingerprint: toHex(v.versionHash),
    contentHash: toHex(v.contentHash),
    previousFingerprint: v.version === 1 ? null : toHex(v.previousVersionHash),
    effectiveAt: v.effectiveAt === 0n ? null : Number(v.effectiveAt),
    publishedAt: Number(v.publishedAt),
    publishedSlot: Number(v.publishedSlot),
    publisher: v.publisher,
    publisherRole: v.publisherRole === PUBLISHER_ROLE_MEMBER ? "member" : "owner",
    storageUri: v.storageUri,
    publicationTransaction: publicationSignature,
    superseded: vc.document.versionCount > v.version,
  };
  b.facts.document = {
    address: vc.documentAddress,
    slug: vc.document.slug,
    documentType: vc.document.documentType,
    locale: vc.document.locale,
    versionCount: vc.document.versionCount,
  };
  const now = nowSeconds(opts);
  b.facts.organization = {
    address: vc.organizationAddress,
    name: vc.organization.name,
    verifiedDomain: verifiedDomainAt(vc.organization, now),
    domainExpiresAt: vc.organization.verifiedDomain
      ? Number(vc.organization.domainExpiresAt)
      : null,
    owner: vc.organization.owner,
  };
}

async function checkDomain(ctx: Context, vc: VersionContext): Promise<void> {
  const { b, opts } = ctx;
  const domain = verifiedDomainAt(vc.organization, nowSeconds(opts));
  if (!domain) {
    b.warn(
      "organization.domain",
      "Organization identity",
      `"${vc.organization.name}" has no currently verified domain. Display names are self-asserted.`,
    );
    return;
  }
  // The evidence behind the domain: the attestor's on-chain record of its DNS check.
  const [recordAddress] = await findDomainRecordPda(domain, ctx.programId);
  const recordAcc = await opts.chain.getAccount(recordAddress, ctx.commitment).catch(() => null);
  const record =
    recordAcc && recordAcc.owner === ctx.programId ? decodeDomainRecord(recordAcc.data) : null;
  if (!record || record.organization !== vc.organizationAddress || record.domain !== domain) {
    b.fail(
      "organization.domain.record",
      "Domain evidence",
      `No DomainRecord account binds ${domain} to this organization, although the organization claims it.`,
    );
    return;
  }
  const dnsName = `_stele.${domain}`;
  const dnsValue = `stele-org=${vc.organizationAddress}`;
  if (b.facts.organization)
    b.facts.organization.domainAttestation = {
      record: recordAddress,
      attestor: record.attestor,
      currentAttestor: record.attestor === ctx.config!.domainAttestor,
      method: "DNS_TXT",
      dnsName,
      dnsValue,
      verifiedAt: Number(record.verifiedAt),
      expiresAt: Number(record.expiresAt),
      liveDnsChecked: Boolean(opts.liveDnsCheck),
    };
  b.pass(
    "organization.domain.record",
    "Domain evidence",
    `DomainRecord ${recordAddress}: attestor ${record.attestor}${record.attestor === ctx.config!.domainAttestor ? " (the protocol's current attestor)" : " (a former attestor)"} found ${dnsName} TXT "${dnsValue}" on ${new Date(Number(record.verifiedAt) * 1000).toISOString().slice(0, 10)}. Re-check that record yourself, or verify with live DNS enabled.`,
    false,
  );
  if (!opts.liveDnsCheck) {
    b.pass(
      "organization.domain",
      "Organization identity",
      `Domain ${domain} attested on-chain until ${new Date(Number(vc.organization.domainExpiresAt) * 1000).toISOString().slice(0, 10)}.`,
      false,
    );
    return;
  }
  try {
    const f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const url = `${opts.dohUrl ?? "https://cloudflare-dns.com/dns-query"}?name=${encodeURIComponent(`_stele.${domain}`)}&type=TXT`;
    const res = await f(url, { headers: { accept: "application/dns-json" } });
    const body = (await res.json()) as { Answer?: { data: string }[] };
    const records = (body.Answer ?? []).map((a) =>
      a.data.replace(/^"|"$/g, "").replace(/" "/g, ""),
    );
    const expected = `stele-org=${vc.organizationAddress}`;
    if (records.includes(expected))
      b.pass(
        "organization.domain",
        "Organization identity",
        `Live DNS confirms _stele.${domain} → ${vc.organizationAddress}.`,
        false,
      );
    else
      b.warn(
        "organization.domain",
        "Organization identity",
        `On-chain attestation exists for ${domain}, but live DNS no longer publishes ${expected}.`,
      );
  } catch (e) {
    b.warn("organization.domain", "Organization identity", `Live DNS check failed: ${describe(e)}`);
  }
}

// ---- public API: document version ----------------------------------------------------------------

export async function verifyDocumentVersion(
  input: {
    versionAddress?: string;
    fingerprint?: string;
    publicationTransaction?: string;
    embeddedContent?: Uint8Array;
  },
  opts: VerifierOptions,
): Promise<VerificationReport> {
  const reference = input.versionAddress ?? input.fingerprint ?? "";
  const b = new ReportBuilder({ kind: "version", reference });
  const ctx: Context = {
    b,
    opts,
    programId: toAddress(opts.programId ?? DEFAULT_PROGRAM_ADDRESS),
    config: null,
    genesisHash: null,
    commitment: "finalized",
  };
  try {
    if (!(await checkNetwork(ctx))) return b.build(opts.chain.description);
    let versionAddress = input.versionAddress;
    if (!versionAddress && input.fingerprint) {
      // Filter on the DocumentVersion discriminator too: Document.head_hash shares offset 72.
      const matches = await opts.chain.findAccounts(ctx.programId, [
        { offset: 0, bytesBase58: toBase58(ACCOUNT_DISCRIMINATORS.DocumentVersion) },
        { offset: VERSION_HASH_OFFSET, bytesBase58: toBase58(fromHex(input.fingerprint, 32)) },
      ]);
      if (matches.length !== 1) {
        b.fail(
          "version.lookup",
          "Fingerprint lookup",
          matches.length === 0
            ? "No published version has this fingerprint."
            : "Fingerprint is not unique (unexpected).",
        );
        return b.build(opts.chain.description);
      }
      versionAddress = matches[0]!;
      b.pass(
        "version.lookup",
        "Fingerprint lookup",
        `Fingerprint belongs to version account ${versionAddress}.`,
      );
    }
    if (!versionAddress) throw new Error("versionAddress or fingerprint is required");
    const vc = await loadVersion(ctx, versionAddress);
    if (vc) {
      await verifyVersionEvidence(ctx, vc, {
        publicationHint: input.publicationTransaction,
        embeddedContent: input.embeddedContent ?? null,
      });
      await checkDomain(ctx, vc);
    }
  } catch (e) {
    b.error("verifier", "Verification", describe(e));
  }
  return b.build(opts.chain.description);
}

// ---- public API: acceptance --------------------------------------------------------------------

function findAcceptanceInstructions(programId: string, instructions: DecodedInstruction[]) {
  return instructions
    .filter(
      (ix) =>
        ix.programId === programId &&
        // record_gated_acceptance records the same acceptance and also advances a Gate AccessPass.
        (identifyInstruction(ix.data) === "record_acceptance" ||
          identifyInstruction(ix.data) === "record_gated_acceptance"),
    )
    .map((ix) => ({ ix, previous: instructions[ix.index - 1] ?? null }));
}

/** stele/2: a record_passkey_acceptance with its precompile, arguments and event. */
interface NativeCandidate {
  ix: DecodedInstruction;
  p256: ParsedSecp256r1;
  args: ReturnType<typeof decodeRecordPasskeyAcceptanceArgs>;
  event: PasskeyAcceptanceRecordedEvent | null;
  /** Recomputed acceptance ID (needs the event's message hash). */
  id: Uint8Array | null;
}

function findNativeAcceptances(
  programId: string,
  instructions: DecodedInstruction[],
  logs: readonly string[],
): NativeCandidate[] {
  const events = decodeEventsFromLogs(logs, programId).flatMap((e) =>
    e.name === "PasskeyAcceptanceRecorded" ? [e.data] : [],
  );
  const out: NativeCandidate[] = [];
  for (const ix of instructions) {
    if (ix.programId !== programId || identifyInstruction(ix.data) !== "record_passkey_acceptance")
      continue;
    const previous = instructions[ix.index - 1];
    if (!previous || previous.programId !== SECP256R1_PROGRAM_ADDRESS) continue;
    if (previous.accounts.length > 0) continue;
    const p256 = parseSecp256r1Instruction(previous.data);
    if (!p256) continue;
    let args;
    try {
      args = decodeRecordPasskeyAcceptanceArgs(ix.data);
    } catch {
      continue;
    }
    const event =
      events.find(
        (e) =>
          e.nonceShard === ix.accounts[5] &&
          e.nonceIndex === args.nonceIndex &&
          bytesEqual(e.signerKey, p256.publicKey),
      ) ?? null;
    const id = event
      ? passkeyAcceptanceId(
          addressBytes(ix.accounts[4]!),
          p256.publicKey,
          event.messageHash,
          p256.signature,
        )
      : null;
    out.push({ ix, p256, args, event, id });
  }
  return out;
}

export async function verifyAcceptance(
  input: {
    transactionSignature?: string;
    receipt?: unknown;
    acceptanceId?: string;
    /** Signer-type evidence to check (taken from the receipt when one is given). */
    signer?: SignerEvidence;
    /**
     * stele/2: the signed message text (otherwise taken from a stele-receipt/2, or rebuilt from chain
     * data). Only its hash is on-chain; it is accepted only if it hashes to it.
     */
    message?: string;
    /** MERKLE_BATCHED: one leaf's evidence (e.g. from a batch manifest). Untrusted. */
    batched?: unknown;
  },
  opts: VerifierOptions,
): Promise<VerificationReport> {
  let receipt: Receipt | null = null;
  let receiptV2: ReceiptV2 | null = null;
  const b = new ReportBuilder({
    kind: "acceptance",
    reference: input.transactionSignature ?? input.acceptanceId ?? "receipt",
  });
  if (input.receipt !== undefined) {
    try {
      const parsed = parseAnyReceipt(input.receipt);
      if (parsed.format === RECEIPT_V2_FORMAT) receiptV2 = parsed as ReceiptV2;
      else receipt = parsed as Receipt;
      b.pass(
        "receipt.schema",
        "Receipt format",
        `Receipt is a well-formed ${parsed.format} bundle (its claims are verified below).`,
      );
    } catch (e) {
      b.fail("receipt.schema", "Receipt format", describe(e));
      return b.build(opts.chain.description);
    }
  }
  const signature =
    input.transactionSignature ??
    receipt?.transaction.signature ??
    receiptV2?.transaction.signature;
  const wantedId = input.acceptanceId ?? receipt?.acceptanceId ?? receiptV2?.acceptanceId;
  const ctx: Context = {
    b,
    opts,
    programId: toAddress(opts.programId ?? DEFAULT_PROGRAM_ADDRESS),
    config: null,
    genesisHash: null,
    commitment: "finalized",
  };
  try {
    if (!signature) throw new Error("a transaction signature or receipt is required");
    if (!(await checkNetwork(ctx))) return b.build(opts.chain.description);

    // 1. Transaction.
    let tx: TransactionSnapshot | null;
    try {
      tx = await opts.chain.getTransaction(signature);
    } catch (e) {
      b.add(
        "tx.status",
        "Transaction",
        e instanceof RpcDisagreementError ? "error" : "error",
        describe(e),
      );
      return b.build(opts.chain.description);
    }
    if (!tx) {
      // Absence only proves non-existence if the endpoint still holds the relevant history.
      let firstSlot: number | null = null;
      try {
        firstSlot = await opts.chain.getFirstAvailableSlot();
      } catch {
        firstSlot = null;
      }
      const claimedSlot = receipt?.transaction.slot;
      const historyCovered =
        firstSlot !== null &&
        (firstSlot === 0 || (claimedSlot !== undefined && claimedSlot >= firstSlot));
      if (historyCovered) {
        b.fail(
          "tx.status",
          "Transaction",
          `Transaction ${signature} does not exist on this network (the endpoint holds the relevant history${claimedSlot !== undefined ? ` for slot ${claimedSlot}` : ""}).`,
        );
      } else {
        b.error(
          "tx.status",
          "Transaction",
          `Transaction ${signature} was not found. Either it does not exist on this network, or the endpoint no longer keeps that history${firstSlot !== null ? ` (its oldest available slot is ${firstSlot})` : ""}. Use an archival RPC provider to decide.`,
        );
      }
      return b.build(opts.chain.description);
    }
    if (tx.err !== null) {
      b.fail(
        "tx.status",
        "Transaction",
        `Transaction failed on-chain (${JSON.stringify(tx.err)}); it recorded nothing.`,
      );
      return b.build(opts.chain.description);
    }
    // Everything that follows is read at the same commitment as the transaction.
    ctx.commitment = tx.commitment;
    if (tx.commitment === "finalized")
      b.pass(
        "tx.status",
        "Transaction",
        `Finalized in slot ${tx.slot}${tx.blockTime ? ` at ${new Date(tx.blockTime * 1000).toISOString()}` : ""}.`,
      );
    else b.warn("tx.status", "Transaction", `Confirmed in slot ${tx.slot} but not yet finalized.`);

    // 2. Structure.
    const decoded = decodeWireTransaction(tx.wire, tx.loadedWritable, tx.loadedReadonly);
    const candidates = findAcceptanceInstructions(ctx.programId, decoded.instructions);
    // Batched acceptances: the evidence is the receipt; the transaction anchors its root.
    if (receiptV2?.evidenceMode === "MERKLE_BATCHED" || input.batched !== undefined) {
      let leaf: BatchedEvidence;
      try {
        leaf = receiptV2
          ? {
              protocol: receiptV2.protocol,
              acceptanceId: receiptV2.acceptanceId,
              versionAddress: receiptV2.version.address,
              message: receiptV2.acceptance.message,
              signature: receiptV2.acceptance.signature,
              signer: receiptV2.signer,
              webauthn: receiptV2.webauthn,
              batch: receiptV2.batch!,
            }
          : batchedEvidenceSchema.parse(input.batched);
      } catch (e) {
        b.fail("receipt.schema", "Batched evidence", describe(e));
        return b.build(opts.chain.description);
      }
      if (wantedId && wantedId !== leaf.acceptanceId) {
        b.fail(
          "tx.shape",
          "Transaction structure",
          `The evidence is for ${leaf.acceptanceId}, not ${wantedId}.`,
        );
        return b.build(opts.chain.description);
      }
      await verifyBatchedAcceptance(ctx, tx, decoded, leaf, receiptV2);
      return b.build(opts.chain.description);
    }
    // stele/2 (native passkeys) are verified by their own path.
    const native = findNativeAcceptances(ctx.programId, decoded.instructions, tx.logs);
    const nativeChosen = wantedId
      ? native.find((n) => n.id !== null && toHex(n.id) === wantedId)
      : candidates.length === 0 && native.length === 1
        ? native[0]
        : undefined;
    if (nativeChosen || (receiptV2 && candidates.length === 0)) {
      if (!nativeChosen) {
        b.fail(
          "tx.shape",
          "Transaction structure",
          `No native passkey acceptance in this transaction has ID ${wantedId}.`,
        );
        return b.build(opts.chain.description);
      }
      await verifyNativeAcceptance(ctx, tx, decoded, nativeChosen, {
        receipt: receiptV2,
        message: input.message,
      });
      return b.build(opts.chain.description);
    }
    if (receiptV2) {
      b.fail(
        "tx.shape",
        "Transaction structure",
        "A direct stele-receipt/2 must reference a native passkey acceptance.",
      );
      return b.build(opts.chain.description);
    }
    if (candidates.length === 0 && native.length > 1) {
      b.fail(
        "tx.shape",
        "Transaction structure",
        `The transaction records ${native.length} acceptances; specify the acceptance ID.`,
      );
      return b.build(opts.chain.description);
    }
    if (candidates.length === 0) {
      b.fail(
        "tx.shape",
        "Transaction structure",
        "The transaction contains no Stele acceptance instruction.",
      );
      return b.build(opts.chain.description);
    }
    type Parsed = {
      ix: DecodedInstruction;
      ed: ReturnType<typeof parseCanonicalEd25519Data>;
      id: Uint8Array;
    };
    const parsed: Parsed[] = [];
    for (const c of candidates) {
      if (!c.previous || c.previous.programId !== ED25519_PROGRAM_ADDRESS) continue;
      try {
        const ed = parseCanonicalEd25519Data(c.previous.data);
        const id = computeAcceptanceId(
          addressBytes(c.ix.accounts[4]!),
          ed.publicKey,
          computeMessageHash(ed.message),
          ed.signature,
        );
        parsed.push({ ix: c.ix, ed, id });
      } catch {
        // reported below if nothing parses
      }
    }
    const chosen = wantedId
      ? parsed.find((p) => toHex(p.id) === wantedId)
      : parsed.length === 1
        ? parsed[0]
        : undefined;
    if (!chosen) {
      b.fail(
        "tx.shape",
        "Transaction structure",
        parsed.length === 0
          ? "No acceptance instruction is immediately preceded by a canonical Ed25519 verification."
          : wantedId
            ? `No acceptance in this transaction has ID ${wantedId}.`
            : `The transaction records ${parsed.length} acceptances; specify the acceptance ID.`,
      );
      return b.build(opts.chain.description);
    }
    b.pass(
      "tx.shape",
      "Transaction structure",
      identifyInstruction(chosen.ix.data) === "record_gated_acceptance"
        ? "A canonical Ed25519 verification immediately precedes a top-level record_gated_acceptance instruction (it also created or advanced the signer's Stele Gate AccessPass)."
        : "A canonical Ed25519 verification immediately precedes a top-level record_acceptance instruction.",
    );

    // 3. Signature (re-verified locally — the runtime's verdict is not taken on trust).
    const { ed, ix } = chosen;
    const signer = toBase58(ed.publicKey);
    if (
      !b.expect(
        verifyEd25519(ed.signature, ed.message, ed.publicKey),
        "signature.ed25519",
        "Signature",
        `Ed25519 signature by ${signer} verifies over the exact message bytes (strict RFC 8032).`,
        "Signature does not verify.",
      )
    ) {
      return b.build(opts.chain.description);
    }

    // 4. Message.
    let message;
    const messageText = fromUtf8(ed.message);
    try {
      message = parseAcceptanceMessage(messageText);
      b.expect(
        message.signer === signer,
        "message.format",
        "Acceptance message",
        "Message is canonical stele-acceptance-v1 and names the signing account.",
        `Message names account ${message.signer} but was signed by ${signer}.`,
      );
    } catch (e) {
      b.fail("message.format", "Acceptance message", describe(e));
      return b.build(opts.chain.description);
    }
    const args = decodeRecordAcceptanceArgs(ix.data);
    b.expect(
      Number(args.issuedAt) === message.issuedAt &&
        Number(args.expiresAt) === message.expiresAt &&
        args.nonceIndex === message.nonceIndex &&
        toHex(args.nonceTag) === message.nonceTag,
      "message.window",
      "Validity window",
      `Signed window ${new Date(message.issuedAt * 1000).toISOString()} → ${new Date(message.expiresAt * 1000).toISOString()} matches the recorded instruction.`,
      "Instruction arguments differ from the signed message.",
    );
    if (tx.blockTime !== null) {
      const inWindow =
        tx.blockTime + MAX_ISSUED_AT_SKEW >= message.issuedAt &&
        tx.blockTime <= message.expiresAt + 60;
      if (inWindow)
        b.pass(
          "message.timing",
          "Recording time",
          "Recorded within the signed validity window.",
          false,
        );
      else
        b.warn(
          "message.timing",
          "Recording time",
          "Block time is outside the signed validity window (cluster clock drift?).",
        );
    }

    // 5. Accounts referenced by the instruction.
    const [configPda] = await findConfigPda(ctx.programId);
    const gated = identifyInstruction(ix.data) === "record_gated_acceptance";
    // record_gated_acceptance adds [holder, access pass, system program] before the sysvar.
    const [, configAddr, orgAddr, docAddr, versionAddr, shardAddr] = ix.accounts;
    const sysvar = ix.accounts[gated ? 9 : 6];
    let gateAccountsOk = true;
    if (gated) {
      const [expectedPass] = await findAccessPassPda(
        toAddress(docAddr!),
        toAddress(signer),
        toAddress(ctx.programId),
      );
      gateAccountsOk = ix.accounts[6] === signer && ix.accounts[7] === expectedPass;
    }
    b.expect(
      configAddr === configPda && sysvar === INSTRUCTIONS_SYSVAR_ADDRESS && gateAccountsOk,
      "tx.accounts",
      "Instruction accounts",
      gated
        ? "Configuration and instructions-sysvar accounts are the canonical ones; the AccessPass is the signer's, at its canonical address."
        : "Configuration and instructions-sysvar accounts are the canonical ones.",
      "Instruction references unexpected configuration, sysvar or access-pass accounts.",
    );
    b.expect(
      message.networkLabel === ctx.config!.networkLabel,
      "config.network",
      "Network binding",
      `Signed for "${message.networkLabel}".`,
      `Signed for "${message.networkLabel}" but this network is "${ctx.config!.networkLabel}".`,
    );

    // 6. Version evidence.
    const vc = await loadVersion(ctx, versionAddr!);
    if (!vc) return b.build(opts.chain.description);
    b.expect(
      vc.organizationAddress === orgAddr && vc.documentAddress === docAddr,
      "tx.relations",
      "Accepted document",
      "The acceptance references the version's own document and organization.",
      "Instruction accounts do not match the version's document/organization.",
    );
    await verifyVersionEvidence(ctx, vc, {
      publicationHint: undefined,
      // Re-serialize canonically; a tampered embedded copy simply fails the hash check.
      embeddedContent: receipt?.content ? embeddedContentBytes(receipt.content) : null,
    });
    const v = vc.version;
    b.expect(
      message.title === v.title &&
        message.versionLabel === v.versionLabel &&
        message.version === v.version &&
        message.versionHash === toHex(v.versionHash),
      "version.binding",
      "Exact version binding",
      `The signed message names "${v.title}" version ${v.versionLabel} (#${v.version}) with fingerprint ${toHex(v.versionHash)}.`,
      "Signed title/version/fingerprint do not match the version account.",
    );
    // Canonical rebuild from chain data (except organization name/domain, which may change later).
    const rebuilt = buildAcceptanceMessage(
      {
        orgName: message.orgName,
        orgVerifiedDomain: message.orgVerifiedDomain,
        title: v.title,
        versionLabel: v.versionLabel,
        version: v.version,
        versionHash: v.versionHash,
        signer,
        networkLabel: ctx.config!.networkLabel,
        issuedAt: args.issuedAt,
        expiresAt: args.expiresAt,
        shardId: message.shardId,
        nonceIndex: args.nonceIndex,
        nonceTag: args.nonceTag,
      },
      message.requestDomain,
    );
    b.expect(
      rebuilt === messageText,
      "message.rebuild",
      "Message reconstruction",
      "The message rebuilt from chain data is byte-identical to the signed message.",
      "The signed message differs from its reconstruction.",
    );

    if (message.orgName === vc.organization.name) {
      b.pass(
        "organization.binding",
        "Organization name",
        `Signed for "${message.orgName}".`,
        false,
      );
    } else {
      b.warn(
        "organization.binding",
        "Organization name",
        `Signed for "${message.orgName}"; the organization is currently named "${vc.organization.name}" (renamed after acceptance).`,
      );
    }

    // 7. Was the version current at acceptance time?
    await checkVersionCurrent(ctx, vc, tx.slot);

    // 8. Nonce consumption.
    await checkNonceConsumed(ctx, {
      shard: shardAddr!,
      organization: orgAddr!,
      shardId: message.shardId,
      nonceIndex: args.nonceIndex,
    });

    // 9. Acceptance ID and event.
    const id = chosen.id;
    const events = decodeEventsFromLogs(tx.logs, ctx.programId).filter(
      (e) => e.name === "AcceptanceRecorded",
    );
    const event = events.find(
      (e) => e.name === "AcceptanceRecorded" && bytesEqual(e.data.acceptanceId, id),
    );
    b.expect(
      Boolean(event),
      "acceptance.id",
      "Acceptance identifier",
      `Acceptance ID ${toHex(id)} matches the recorded event.`,
      "No recorded event carries the recomputed acceptance ID.",
    );

    // 10. Requesting domain.
    checkRequestDomain(ctx, message.orgVerifiedDomain, message.requestDomain);

    // 11. How the key was controlled, and who paid the fee.
    b.facts.signer = await checkSignerEvidence(b, input.signer ?? receipt?.signer, {
      signer,
      message: messageText,
      requestDomain: message.requestDomain,
      organization: vc.organizationAddress,
      chainId: ctx.config!.chainId,
    });
    // Who vouches for the requesting site: a passkey assertion carries the browser's origin; a
    // wallet signature only covers the site name the server wrote into the message.
    const attestedOrigin = b.facts.signer?.passkey?.origin ?? null;
    b.facts.origin = {
      requestDomain: message.requestDomain,
      attestation: attestedOrigin ? "BROWSER_ATTESTED" : "MERCHANT_CLAIMED",
      origin: attestedOrigin,
    };
    if (attestedOrigin)
      b.pass(
        "origin.attestation",
        "Requesting-site attestation",
        `The browser attested origin ${attestedOrigin} in the passkey assertion.`,
        false,
      );
    else
      b.warn(
        "origin.attestation",
        "Requesting-site attestation",
        `Origin: merchant-claimed, not browser-attested. "Requested by: ${message.requestDomain}" is part of the signed text, so it cannot be changed after signing — but the requesting page wrote it; a wallet signature does not prove which website displayed the agreement. Signature and document are unaffected.`,
      );
    b.facts.fees = checkFees(b, tx, decoded.accountKeys, {
      programId: ctx.programId,
      recordId: toHex(id),
      signer,
    });

    await checkDomain(ctx, vc);

    b.facts.acceptance = {
      protocol: "stele/1",
      evidenceMode: "DIRECT_ONCHAIN",
      acceptanceId: toHex(id),
      signer,
      message: messageText,
      messageHash: toHex(computeMessageHash(ed.message)),
      signature: toBase58(ed.signature),
      issuedAt: message.issuedAt,
      expiresAt: message.expiresAt,
      requestDomain: message.requestDomain,
      nonce: { shardId: message.shardId, index: message.nonceIndex, tag: message.nonceTag },
      transaction: signature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      commitment: tx.commitment,
    };

    // 11. Receipt claims. EVERY claim in the bundle must equal a fact derived from the chain (or,
    // for the organization's name and domain, the values the user actually signed) — a receipt is a
    // convenience copy, and a single altered field makes it a forgery.
    if (receipt) {
      const problems: string[] = [];
      const same = (a: unknown, c: unknown) =>
        JSON.stringify(a ?? null) === JSON.stringify(c ?? null);
      const eq = (label: string, claimed: unknown, actual: unknown) => {
        if (!same(claimed, actual))
          problems.push(
            `${label}: receipt says ${JSON.stringify(claimed)}, chain says ${JSON.stringify(actual)}`,
          );
      };
      const f = b.facts;
      const acc = f.acceptance!;
      eq("acceptanceId", receipt.acceptanceId, acc.acceptanceId);
      eq("network.chainId", receipt.network.chainId, f.network?.chainId);
      eq("network.label", receipt.network.label, f.network?.label);
      eq("network.programId", receipt.network.programId, f.network?.programId);
      eq("transaction.signature", receipt.transaction.signature, acc.transaction);
      eq("transaction.slot", receipt.transaction.slot, acc.slot);
      eq("transaction.blockTime", receipt.transaction.blockTime, acc.blockTime);
      eq("acceptance.signer", receipt.acceptance.signer, acc.signer);
      eq("acceptance.message", receipt.acceptance.message, acc.message);
      eq("acceptance.messageHash", receipt.acceptance.messageHash, acc.messageHash);
      eq("acceptance.signature", receipt.acceptance.signature, acc.signature);
      eq("acceptance.issuedAt", receipt.acceptance.issuedAt, acc.issuedAt);
      eq("acceptance.expiresAt", receipt.acceptance.expiresAt, acc.expiresAt);
      eq("acceptance.nonce", receipt.acceptance.nonce, acc.nonce);
      eq("acceptance.requestDomain", receipt.acceptance.requestDomain, acc.requestDomain);
      eq("organization.address", receipt.organization.address, f.organization?.address);
      // Organizations can be renamed or lose a domain later: the signed value or the current one is accepted.
      if (
        !same(receipt.organization.name, message.orgName) &&
        !same(receipt.organization.name, f.organization?.name)
      ) {
        problems.push(
          `organization.name: receipt says ${JSON.stringify(receipt.organization.name)}, signed ${JSON.stringify(message.orgName)}`,
        );
      }
      if (
        !same(receipt.organization.verifiedDomain, message.orgVerifiedDomain) &&
        !same(receipt.organization.verifiedDomain, f.organization?.verifiedDomain)
      ) {
        problems.push(
          `organization.verifiedDomain: receipt says ${JSON.stringify(receipt.organization.verifiedDomain)}, signed ${JSON.stringify(message.orgVerifiedDomain)}`,
        );
      }
      eq("document.address", receipt.document.address, f.document?.address);
      eq("document.slug", receipt.document.slug, f.document?.slug);
      eq("document.documentType", receipt.document.documentType, f.document?.documentType);
      eq("document.locale", receipt.document.locale, f.document?.locale);
      eq("version.address", receipt.version.address, f.version?.address);
      eq("version.number", receipt.version.number, f.version?.number);
      eq("version.label", receipt.version.label, f.version?.label);
      eq("version.title", receipt.version.title, f.version?.title);
      eq("version.versionHash", receipt.version.versionHash, f.version?.fingerprint);
      eq("version.contentHash", receipt.version.contentHash, f.version?.contentHash);
      eq(
        "version.previousVersionHash",
        receipt.version.previousVersionHash,
        f.version?.previousFingerprint,
      );
      eq("version.effectiveAt", receipt.version.effectiveAt, f.version?.effectiveAt);
      eq("version.publishedAt", receipt.version.publishedAt, f.version?.publishedAt);
      eq("version.publishedSlot", receipt.version.publishedSlot, f.version?.publishedSlot);
      eq("version.storageUri", receipt.version.storageUri, f.version?.storageUri);
      if (receipt.fees) {
        const fees = f.fees!;
        eq("fees.payer", receipt.fees.payer, fees.payer);
        eq("fees.sponsor", receipt.fees.sponsor, fees.sponsor);
        eq("fees.reimbursedLamports", receipt.fees.reimbursedLamports, fees.reimbursedLamports);
        if (fees.feeLamports !== null)
          eq("fees.feeLamports", receipt.fees.feeLamports, fees.feeLamports);
      }
      if (
        receipt.signer &&
        receipt.signer.type !== "WALLET" &&
        f.signer?.type !== receipt.signer.type
      )
        problems.push("signer: the passkey evidence does not verify");
      if (receipt.content) {
        const bytes = embeddedContentBytes(receipt.content);
        if (!bytes || toHex(hashContentBytes(bytes)) !== f.version?.contentHash) {
          problems.push(
            "content: the embedded document text does not hash to the version's content commitment",
          );
        }
      }
      b.expect(
        problems.length === 0,
        "receipt.consistency",
        "Receipt consistency",
        "Every claim in the receipt matches the chain.",
        `Receipt does not match the chain (it was altered) — ${problems.join("; ")}.`,
      );
    }
  } catch (e) {
    b.error("verifier", "Verification", describe(e));
  }
  return b.build(opts.chain.description);
}

// ---- what you see is what you sign -------------------------------------------------------------------

/**
 * Reports what the frozen canonical form cannot exclude (PROTOCOL_SPEC.md §4.5): invisible marks,
 * look-alike words, external links (not covered by the hash) — and resolves pinned references to
 * other Stele versions on-chain. Informational: never changes whether the content hash verifies.
 */
async function checkContentSafety(ctx: Context, content: Content): Promise<void> {
  const { b, opts } = ctx;
  const findings = inspectContent(content);
  const suspicious = findings.filter((f) => SUSPICIOUS_FINDINGS.includes(f.kind));
  if (suspicious.length > 0)
    b.warn(
      "content.display",
      "Display safety",
      `The text contains characters that can change how it reads: ${suspicious
        .slice(0, 5)
        .map(describeFinding)
        .join("; ")}${suspicious.length > 5 ? ` (+${suspicious.length - 5} more)` : ""}.`,
    );
  else
    b.pass(
      "content.display",
      "Display safety",
      "No invisible direction marks, joiners, variation selectors or look-alike mixed-script words.",
      false,
    );
  const links = findings.filter((f) => f.kind === "EXTERNAL_LINK");
  if (links.length > 0)
    b.skip(
      "content.links",
      "External links",
      `${links.length} link(s) (${[...new Set(links.map((l) => l.value))].slice(0, 3).join(", ")}${links.length > 3 ? ", …" : ""}): what they point to is not covered by this document's hash and may change.`,
    );
  const pinned = [
    ...new Set(findings.filter((f) => f.kind === "PINNED_REFERENCE").map((f) => f.value)),
  ];
  for (const fingerprint of pinned.slice(0, 10)) {
    const matches = await opts.chain
      .findAccounts(ctx.programId, [
        { offset: 0, bytesBase58: toBase58(ACCOUNT_DISCRIMINATORS.DocumentVersion) },
        { offset: VERSION_HASH_OFFSET, bytesBase58: toBase58(fromHex(fingerprint, 32)) },
      ])
      .catch(() => null);
    if (matches === null)
      b.skip(
        "content.references",
        "Referenced document",
        `Could not look up referenced version ${fingerprint.slice(0, 16)}… (RPC does not allow account scans).`,
      );
    else if (matches.length === 1)
      b.pass(
        "content.references",
        "Referenced document",
        `Referenced version ${fingerprint.slice(0, 16)}… is published on-chain (${matches[0]}).`,
        false,
      );
    else
      b.warn(
        "content.references",
        "Referenced document",
        `The text references version ${fingerprint.slice(0, 16)}…, which is not published on this network.`,
      );
  }
}

// ---- acceptance checks shared by stele/1 and stele/2 ------------------------------------------------

async function checkVersionCurrent(ctx: Context, vc: VersionContext, txSlot: number) {
  const { b, opts } = ctx;
  const v = vc.version;
  if (vc.document.versionCount === v.version) {
    b.pass(
      "version.current",
      "Current version at acceptance",
      "This version is still the document's current version.",
    );
    return;
  }
  const [nextAddr] = await findVersionPda(
    toAddress(vc.documentAddress),
    v.version + 1,
    ctx.programId,
  );
  const nextAcc = await opts.chain.getAccount(nextAddr, ctx.commitment).catch(() => null);
  if (!nextAcc) {
    b.error(
      "version.current",
      "Current version at acceptance",
      "Could not load the next version to compare publication slots.",
    );
    return;
  }
  const next = decodeDocumentVersion(nextAcc.data);
  const slot = BigInt(txSlot);
  if (next.publishedSlot > slot)
    b.pass(
      "version.current",
      "Current version at acceptance",
      `Version #${v.version + 1} was published later (slot ${next.publishedSlot}).`,
    );
  else if (next.publishedSlot === slot)
    b.warn(
      "version.current",
      "Current version at acceptance",
      "The next version was published in the same slot; ordering within the slot was enforced by the program.",
    );
  else
    b.fail(
      "version.current",
      "Current version at acceptance",
      `Version #${v.version + 1} was already published (slot ${next.publishedSlot}) before this acceptance (slot ${slot}).`,
    );
}

async function checkNonceConsumed(
  ctx: Context,
  i: { shard: string; organization: string; shardId: number; nonceIndex: number },
) {
  const { b, opts } = ctx;
  const shardAcc = await opts.chain.getAccount(i.shard, ctx.commitment).catch(() => null);
  if (!shardAcc || shardAcc.owner !== ctx.programId) {
    b.fail("nonce.consumed", "Replay protection", "Nonce shard account not found.");
    return;
  }
  const shard = decodeNonceShard(shardAcc.data);
  b.expect(
    shard.organization === i.organization &&
      shard.shardId === i.shardId &&
      isNonceConsumed(shard.bitmap, i.nonceIndex),
    "nonce.consumed",
    "Replay protection",
    `Nonce ${i.shardId}-${i.nonceIndex} is consumed on-chain; this signed message can never be recorded again.`,
    "Nonce is not consumed in the organization's shard.",
  );
}

function checkRequestDomain(ctx: Context, orgDomain: string | null, req: string) {
  const { b, opts } = ctx;
  const trusted = (opts.trustedRequestDomains ?? []).includes(req);
  if ((orgDomain && (req === orgDomain || req.endsWith(`.${orgDomain}`))) || trusted) {
    b.pass("request.domain", "Requesting site", `Acceptance was requested by ${req}.`, false);
  } else {
    b.warn(
      "request.domain",
      "Requesting site",
      `Acceptance was requested by ${req}, which is not the organization's verified domain${orgDomain ? ` (${orgDomain})` : ""}.`,
    );
  }
}

// ---- stele/2: native passkey acceptances ------------------------------------------------------------

const PASSKEY_IDENTITY_NOTE =
  "A passkey signature proves that the holder of this authenticator approved with user verification (biometric or device PIN, checked on the device — no biometric data reaches Stele or the chain). It does not by itself identify a person.";

const enrollmentKind = (kind: number) =>
  kind === PASSKEY_KIND_ROTATED
    ? "ROTATED"
    : kind === PASSKEY_KIND_ORGANIZATION_RECOVERY
      ? "ORGANIZATION_RECOVERY"
      : "ENROLLED";

/**
 * Verifies a stele/2 acceptance: the secp256r1 precompile's P-256 signature (re-verified locally),
 * the WebAuthn binding to the exact message, the requesting site and the relying party, the
 * enrollment, and everything stele/1 checks (version, content, history, nonce, fees, domain).
 * The message text is not on-chain — only its hash inside the WebAuthn challenge — so it comes
 * from the caller, the receipt, or a rebuild from chain data, and is used only if it hashes to the
 * recorded message hash.
 */
async function verifyNativeAcceptance(
  ctx: Context,
  tx: TransactionSnapshot,
  decoded: DecodedTransaction,
  chosen: NativeCandidate,
  input: { receipt: ReceiptV2 | null; message?: string },
): Promise<void> {
  const { b, opts } = ctx;
  const { ix, p256, args } = chosen;
  const keyHex = toHex(p256.publicKey);
  const keyId = p256KeyId(p256.publicKey);
  b.pass(
    "tx.shape",
    "Transaction structure",
    "A canonical secp256r1 (P-256) verification immediately precedes a top-level record_passkey_acceptance instruction (stele/2).",
  );

  // 1. Signature, re-verified locally.
  if (
    !b.expect(
      verifyP256(p256.publicKey, p256.signature, p256.message),
      "signature.p256",
      "Signature",
      `ES256 (P-256) signature by passkey key ${keyHex} verifies over authenticatorData ‖ SHA-256(clientDataJSON), low-S (re-verified locally; the runtime's verdict is not taken on trust).`,
      "The P-256 signature does not verify.",
    )
  )
    return;

  // 2. Acceptance ID and event.
  const event = chosen.event;
  if (
    !b.expect(
      event !== null && chosen.id !== null && bytesEqual(chosen.id, event.acceptanceId),
      "acceptance.id",
      "Acceptance identifier",
      `Acceptance ID ${chosen.id ? toHex(chosen.id) : "?"} matches the recorded event.`,
      "No recorded event carries the recomputed acceptance ID.",
    )
  )
    return;
  const id = chosen.id!;
  const ev = event!;

  // 3. Accounts and version evidence.
  const [configPda] = await findConfigPda(ctx.programId);
  const [, configAddr, orgAddr, docAddr, versionAddr, shardAddr, enrollmentAddr, sysvar] =
    ix.accounts;
  b.expect(
    configAddr === configPda && sysvar === INSTRUCTIONS_SYSVAR_ADDRESS,
    "tx.accounts",
    "Instruction accounts",
    "Configuration and instructions-sysvar accounts are the canonical ones.",
    "Instruction references unexpected configuration or sysvar accounts.",
  );
  const vc = await loadVersion(ctx, versionAddr!);
  if (!vc) return;
  b.expect(
    vc.organizationAddress === orgAddr && vc.documentAddress === docAddr,
    "tx.relations",
    "Accepted document",
    "The acceptance references the version's own document and organization.",
    "Instruction accounts do not match the version's document/organization.",
  );
  await verifyVersionEvidence(ctx, vc, {
    publicationHint: undefined,
    embeddedContent: input.receipt?.content ? embeddedContentBytes(input.receipt.content) : null,
  });
  const v = vc.version;

  // 4. The signed text.
  const hashesToEvent = (m: string | null | undefined): m is string =>
    typeof m === "string" && bytesEqual(sha256(utf8(m)), ev.messageHash);
  let text: string | null = null;
  let textSource = "";
  if (hashesToEvent(input.message)) {
    text = input.message;
    textSource = "supplied by the caller";
  } else if (hashesToEvent(input.receipt?.acceptance.message)) {
    text = input.receipt!.acceptance.message;
    textSource = "from the receipt";
  } else {
    try {
      const rebuilt = buildPasskeyAcceptanceMessage(
        {
          orgName: vc.organization.name,
          orgVerifiedDomain: verifiedDomainAt(vc.organization, Number(ev.recordedAt)),
          title: v.title,
          versionLabel: v.versionLabel,
          version: v.version,
          versionHash: v.versionHash,
          signer: p256.publicKey,
          networkLabel: ctx.config!.networkLabel,
          issuedAt: args.issuedAt,
          expiresAt: args.expiresAt,
          shardId: ev.shardId,
          nonceIndex: args.nonceIndex,
          nonceTag: args.nonceTag,
        },
        args.assertion.requestDomain,
      );
      if (hashesToEvent(rebuilt)) {
        text = rebuilt;
        textSource = "rebuilt from chain data";
      }
    } catch {
      text = null;
    }
  }
  if (text)
    b.pass(
      "message.text",
      "Signed text",
      `The exact signed text (${textSource}) hashes to the recorded message hash ${toHex(ev.messageHash)}.`,
    );
  else
    b.warn(
      "message.text",
      "Signed text",
      "Only the message hash is on-chain, and the text could not be rebuilt from current chain data (the organization was renamed, its domain status or the network label changed since). The program verified the text at recording time; a stele-receipt/2 carries it.",
    );

  // 5. WebAuthn binding.
  const authenticatorData = p256.message.subarray(0, p256.message.length - 32);
  const clientData = args.assertion.clientDataJson;
  const rpId = args.assertion.rpId;
  const requestDomain = args.assertion.requestDomain;
  let origin: string;
  let flags: number;
  try {
    if (text) {
      const facts = checkPasskeyAssertion({
        signed: p256.message,
        clientData,
        challenge: webauthnChallenge(PASSKEY_ACCEPTANCE_TAG, text),
        requestDomain,
        rpId,
      });
      origin = facts.origin;
      flags = facts.flags;
    } else {
      // Without the text the challenge cannot be recomputed; every other rule is checked.
      if (!rpIdCovers(rpId, requestDomain))
        throw new PasskeyCheckFailure(
          "RELYING_PARTY_MISMATCH",
          `${rpId} does not cover ${requestDomain}`,
        );
      if (!bytesEqual(p256.message.subarray(p256.message.length - 32), sha256(clientData)))
        throw new PasskeyCheckFailure(
          "CLIENT_DATA_HASH_MISMATCH",
          "client data does not match the signed hash",
        );
      flags = checkAuthenticatorData(authenticatorData, rpId);
      const parsed = JSON.parse(fromUtf8(clientData)) as { type?: unknown; origin?: unknown };
      if (parsed.type !== "webauthn.get" || typeof parsed.origin !== "string")
        throw new PasskeyCheckFailure("INVALID_CLIENT_DATA", "not an assertion");
      if (!passkeyOriginMatches(parsed.origin, requestDomain))
        throw new PasskeyCheckFailure(
          "ORIGIN_MISMATCH",
          `origin ${parsed.origin} is not ${requestDomain}`,
        );
      origin = parsed.origin;
    }
  } catch (e) {
    b.fail(
      "webauthn.binding",
      "Passkey approval",
      e instanceof PasskeyCheckFailure ? `${e.code}: ${e.message}` : describe(e),
    );
    return;
  }
  b.pass(
    "webauthn.binding",
    "Passkey approval",
    text
      ? `The passkey approved this exact text: the WebAuthn challenge is SHA-256(tag ‖ message); the browser reported origin ${origin} (the requesting site, not a cross-origin frame); relying party ${rpId}; the authenticator asserted user presence and user verification.`
      : `Origin ${origin} (the requesting site), relying party ${rpId}, user presence and user verification check out; the challenge was checked by the program on-chain (not recomputed here without the text).`,
  );

  // 6. Message fields against the chain.
  let message: ParsedPasskeyAcceptanceMessage | null = null;
  if (text) {
    try {
      message = parsePasskeyAcceptanceMessage(text);
    } catch (e) {
      b.fail("message.format", "Acceptance message", describe(e));
      return;
    }
    b.expect(
      message.signer === keyHex,
      "message.format",
      "Acceptance message",
      "Message is canonical stele-acceptance-v2 and names the signing passkey key.",
      `Message names passkey key ${message.signer} but was signed by ${keyHex}.`,
    );
    b.expect(
      Number(args.issuedAt) === message.issuedAt &&
        Number(args.expiresAt) === message.expiresAt &&
        args.nonceIndex === message.nonceIndex &&
        toHex(args.nonceTag) === message.nonceTag &&
        message.shardId === ev.shardId &&
        message.requestDomain === requestDomain,
      "message.window",
      "Validity window",
      `Signed window ${new Date(message.issuedAt * 1000).toISOString()} → ${new Date(message.expiresAt * 1000).toISOString()} matches the recorded instruction.`,
      "Instruction arguments differ from the signed message.",
    );
    b.expect(
      message.networkLabel === ctx.config!.networkLabel,
      "config.network",
      "Network binding",
      `Signed for "${message.networkLabel}".`,
      `Signed for "${message.networkLabel}" but this network is "${ctx.config!.networkLabel}".`,
    );
    b.expect(
      message.title === v.title &&
        message.versionLabel === v.versionLabel &&
        message.version === v.version &&
        message.versionHash === toHex(v.versionHash),
      "version.binding",
      "Exact version binding",
      `The signed message names "${v.title}" version ${v.versionLabel} (#${v.version}) with fingerprint ${toHex(v.versionHash)}.`,
      "Signed title/version/fingerprint do not match the version account.",
    );
    const rebuilt = buildPasskeyAcceptanceMessage(
      {
        orgName: message.orgName,
        orgVerifiedDomain: message.orgVerifiedDomain,
        title: v.title,
        versionLabel: v.versionLabel,
        version: v.version,
        versionHash: v.versionHash,
        signer: p256.publicKey,
        networkLabel: ctx.config!.networkLabel,
        issuedAt: args.issuedAt,
        expiresAt: args.expiresAt,
        shardId: ev.shardId,
        nonceIndex: args.nonceIndex,
        nonceTag: args.nonceTag,
      },
      requestDomain,
    );
    b.expect(
      rebuilt === text,
      "message.rebuild",
      "Message reconstruction",
      "The message rebuilt from chain data is byte-identical to the signed message.",
      "The signed message differs from its reconstruction.",
    );
    if (message.orgName === vc.organization.name)
      b.pass(
        "organization.binding",
        "Organization name",
        `Signed for "${message.orgName}".`,
        false,
      );
    else
      b.warn(
        "organization.binding",
        "Organization name",
        `Signed for "${message.orgName}"; the organization is currently named "${vc.organization.name}" (renamed after acceptance).`,
      );
  } else {
    b.pass(
      "version.binding",
      "Exact version binding",
      `The program rebuilt the message from version account ${versionAddr} ("${v.title}" ${v.versionLabel}, fingerprint ${toHex(v.versionHash)}) before checking the passkey's challenge.`,
    );
  }
  if (tx.blockTime !== null) {
    const inWindow =
      tx.blockTime + MAX_ISSUED_AT_SKEW >= Number(args.issuedAt) &&
      tx.blockTime <= Number(args.expiresAt) + 60;
    if (inWindow)
      b.pass(
        "message.timing",
        "Recording time",
        "Recorded within the signed validity window.",
        false,
      );
    else
      b.warn(
        "message.timing",
        "Recording time",
        "Block time is outside the signed validity window (cluster clock drift?).",
      );
  }

  // 7–9. Current version, replay protection, requesting site.
  await checkVersionCurrent(ctx, vc, tx.slot);
  await checkNonceConsumed(ctx, {
    shard: shardAddr!,
    organization: orgAddr!,
    shardId: ev.shardId,
    nonceIndex: args.nonceIndex,
  });
  checkRequestDomain(
    ctx,
    message?.orgVerifiedDomain ?? verifiedDomainAt(vc.organization, Number(ev.recordedAt)),
    requestDomain,
  );
  b.facts.origin = { requestDomain, attestation: "BROWSER_ATTESTED", origin };
  b.pass(
    "origin.attestation",
    "Requesting-site attestation",
    `The browser wrote origin ${origin} into clientDataJSON, which the passkey signed and the program matched to "Requested by: ${requestDomain}".`,
    false,
  );

  // 10. Enrollment (account-bound signers).
  let enrollment: NonNullable<NonNullable<VerifiedFacts["signer"]>["native"]>["enrollment"] = null;
  if (!ev.enrollment) {
    b.pass(
      "signer.enrollment",
      "Signer enrollment",
      "Key-only passkey signer: not bound to an organization account on-chain.",
      false,
    );
  } else {
    const acc =
      enrollmentAddr === ev.enrollment
        ? await opts.chain.getAccount(ev.enrollment, ctx.commitment).catch(() => null)
        : null;
    if (!acc || acc.owner !== ctx.programId) {
      b.fail(
        "signer.enrollment",
        "Signer enrollment",
        "The enrollment named by the event is not the instruction's enrollment account, or it does not exist.",
      );
    } else {
      const e = decodePasskeySigner(acc.data);
      const [pda] = await findPasskeySignerPda(
        toAddress(orgAddr!),
        e.accountCommitment,
        ctx.programId,
      );
      if (
        b.expect(
          pda === ev.enrollment && e.organization === orgAddr,
          "signer.enrollment",
          "Signer enrollment",
          `Enrolled on-chain under salted account commitment ${toHex(e.accountCommitment)} of this organization. When recording, the program required this enrollment to be active and to hold this key for relying party ${rpId}.`,
          "The enrollment account does not belong to this organization.",
        )
      ) {
        const current = bytesEqual(e.signerKey, p256.publicKey);
        if (e.status === PASSKEY_STATUS_REVOKED)
          b.warn(
            "signer.status",
            "Signer status now",
            "The organization has since revoked this enrollment. That does not undo this acceptance; it means the key can no longer record new ones for this account.",
          );
        else if (!current)
          b.pass(
            "signer.status",
            "Signer status now",
            `The account's signer changed later (now generation ${e.generation}; the latest change was ${enrollmentKind(e.kind) === "ORGANIZATION_RECOVERY" ? "an organization recovery — NOT endorsed by the key it replaced" : "a rotation endorsed by the key it replaced"}). This acceptance was made by the key enrolled at the time.`,
            false,
          );
        else
          b.pass(
            "signer.status",
            "Signer status now",
            `Still the account's active signer (generation ${e.generation}, ${enrollmentKind(e.kind).toLowerCase().replace("_", " ")}).`,
            false,
          );
        enrollment = {
          address: ev.enrollment,
          accountCommitment: toHex(e.accountCommitment),
          generation: e.generation,
          kind: enrollmentKind(e.kind),
          status: e.status === PASSKEY_STATUS_REVOKED ? "REVOKED" : "ACTIVE",
          currentSigner: toHex(e.signerKey),
        };
      }
    }
  }

  // 11. Signer, fees, organization identity.
  const signCount = new DataView(
    authenticatorData.buffer,
    authenticatorData.byteOffset + 33,
    4,
  ).getUint32(0, false);
  b.pass("signer.type", "Signer", `Native passkey ${keyId}. ${PASSKEY_IDENTITY_NOTE}`, false);
  b.facts.signer = {
    type: "NATIVE_PASSKEY",
    native: {
      publicKey: keyHex,
      keyId,
      algorithm: "ES256",
      rpId,
      origin,
      userPresent: true,
      userVerified: true,
      backupEligible: (flags & 0x08) !== 0,
      backedUp: (flags & 0x10) !== 0,
      signCount,
      enrollment,
    },
  };
  b.facts.fees = checkFees(b, tx, decoded.accountKeys, {
    programId: ctx.programId,
    recordId: toHex(id),
    signer: keyId,
  });
  await checkDomain(ctx, vc);

  b.facts.acceptance = {
    protocol: "stele/2",
    evidenceMode: "DIRECT_ONCHAIN",
    acceptanceId: toHex(id),
    signer: keyId,
    message: text,
    messageHash: toHex(ev.messageHash),
    signature: toHex(p256.signature),
    issuedAt: Number(args.issuedAt),
    expiresAt: Number(args.expiresAt),
    requestDomain,
    nonce: { shardId: ev.shardId, index: args.nonceIndex, tag: toHex(args.nonceTag) },
    transaction: tx.signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    commitment: tx.commitment,
    challenge: text ? toHex(webauthnChallenge(PASSKEY_ACCEPTANCE_TAG, text)) : null,
    webauthn: {
      authenticatorData: toBase64Url(authenticatorData),
      clientDataJSON: toBase64Url(clientData),
      rpId,
    },
  };

  // 12. Receipt claims: every one must equal a fact derived from the chain.
  if (input.receipt)
    checkReceiptV2(b, input.receipt, {
      textMatches: hashesToEvent(input.receipt.acceptance.message),
      signed: message,
      signer: {
        type: "NATIVE_PASSKEY",
        algorithm: "ES256",
        publicKey: keyHex,
        enrollment: enrollment
          ? { address: enrollment.address, accountCommitment: enrollment.accountCommitment }
          : null,
      },
      webauthn: {
        authenticatorData: b.facts.acceptance.webauthn!.authenticatorData,
        clientDataJSON: b.facts.acceptance.webauthn!.clientDataJSON,
        signature: b.facts.acceptance.signature,
        rpId,
      },
      origin: { attestation: "BROWSER_ATTESTED", origin, requestDomain },
      batch: undefined,
    });
}

// ---- MERKLE_BATCHED acceptances ----------------------------------------------------------------------

/** Batches anchored this long after a signed window closes are refused (the anchor is the clock). */
const BATCH_GRACE_SECONDS = 60;

/**
 * Verifies a batched acceptance (PROTOCOL_SPEC.md §17.9). The program verified NO signature for
 * it, so this verifier does: the user's signature (Ed25519, or the passkey's P-256 WebAuthn
 * signature with its full binding), the message against chain data, and the leaf's Merkle path to
 * the root anchored in the transaction — at the ANCHORED leaf count. What the chain contributes is
 * the time bound (the acceptance existed by the batch's slot) and the organization's shard log.
 */
async function verifyBatchedAcceptance(
  ctx: Context,
  tx: TransactionSnapshot,
  decoded: DecodedTransaction,
  leaf: BatchedEvidence,
  receipt: ReceiptV2 | null,
): Promise<void> {
  const { b, opts } = ctx;
  const r = leaf;
  const batch = leaf.batch;

  // 1. The anchor and its event.
  const anchorIx = decoded.instructions.find((ix) => {
    if (
      ix.programId !== ctx.programId ||
      identifyInstruction(ix.data) !== "anchor_acceptance_batch"
    )
      return false;
    try {
      return toHex(decodeAnchorAcceptanceBatchArgs(ix.data).batchRoot) === batch.root;
    } catch {
      return false;
    }
  });
  const ev = decodeEventsFromLogs(tx.logs, ctx.programId)
    .flatMap((e) => (e.name === "AcceptanceBatchAnchored" ? [e.data] : []))
    .find((e) => toHex(e.batchRoot) === batch.root && toHex(e.batchId) === batch.batchId);
  if (
    !b.expect(
      Boolean(anchorIx && ev),
      "tx.shape",
      "Transaction structure",
      `A top-level anchor_acceptance_batch instruction anchored root ${batch.root.slice(0, 16)}… of ${ev?.leafCount ?? "?"} acceptance(s) (MERKLE_BATCHED: the program verified no signature; this verifier does).`,
      "The transaction anchors no batch with this root and batch id.",
    )
  )
    return;
  const event = ev!;
  const [configPda] = await findConfigPda(ctx.programId);
  const [, configAddr, orgAddr, shardAddr, sysvar] = anchorIx!.accounts;
  const recomputedBatchId = computeBatchId(
    toAddress(orgAddr!),
    toAddress(shardAddr!),
    fromHex(batch.root, 32),
    event.leafCount,
    event.sequence - BigInt(event.leafCount),
  );
  b.expect(
    configAddr === configPda &&
      sysvar === INSTRUCTIONS_SYSVAR_ADDRESS &&
      event.organization === orgAddr &&
      event.nonceShard === shardAddr &&
      bytesEqual(recomputedBatchId, event.batchId),
    "tx.accounts",
    "Instruction accounts",
    "Canonical configuration and sysvar; the batch id recomputes from the organization, shard, root, count and log position.",
    "The anchor's accounts or batch id are inconsistent.",
  );

  // 2. The leaf's acceptance: signature verified here, off-chain.
  const text = r.message;
  const messageHash = sha256(utf8(text));
  const versionAddress = r.versionAddress;
  let id: Uint8Array;
  let signed: { orgName: string; orgVerifiedDomain: string | null };
  let nonce: { shardId: number; nonceIndex: number; nonceTag: string };
  let window: { issuedAt: number; expiresAt: number };
  let requestDomain: string;
  let signerLabel: string;
  let originFacts: NonNullable<VerifiedFacts["origin"]>;
  const signerEvidenceForReceipt: ReceiptV2["signer"] = r.signer;
  try {
    if (r.protocol === "stele/2") {
      if (r.signer.type !== "NATIVE_PASSKEY" || !r.webauthn) throw new Error("malformed");
      const key = fromHex(r.signer.publicKey, 33);
      const authenticatorData = fromBase64Url(r.webauthn.authenticatorData);
      const clientData = fromBase64Url(r.webauthn.clientDataJSON);
      const signature = fromHex(r.webauthn.signature, 64);
      const signedBytes = concatBytes(authenticatorData, sha256(clientData));
      if (
        !b.expect(
          verifyP256(key, signature, signedBytes),
          "signature.p256",
          "Signature",
          `ES256 (P-256) signature by passkey key ${r.signer.publicKey} verifies (checked here, off-chain).`,
          "The P-256 signature does not verify.",
        )
      )
        return;
      const message = parsePasskeyAcceptanceMessage(text);
      const facts = checkPasskeyAssertion({
        signed: signedBytes,
        clientData,
        challenge: webauthnChallenge(PASSKEY_ACCEPTANCE_TAG, text),
        requestDomain: message.requestDomain,
        rpId: r.webauthn.rpId,
      });
      b.pass(
        "webauthn.binding",
        "Passkey approval",
        `The passkey approved this exact text: challenge SHA-256(tag ‖ message); browser-reported origin ${facts.origin} (the requesting site); relying party ${r.webauthn.rpId}; user presence and verification asserted.`,
      );
      b.expect(
        message.signer === r.signer.publicKey,
        "message.format",
        "Acceptance message",
        "Message is canonical stele-acceptance-v2 and names the signing passkey key.",
        "The message names another key.",
      );
      id = passkeyAcceptanceId(addressBytes(versionAddress), key, messageHash, signature);
      signed = message;
      nonce = message;
      window = message;
      requestDomain = message.requestDomain;
      signerLabel = p256KeyId(key);
      originFacts = { requestDomain, attestation: "BROWSER_ATTESTED", origin: facts.origin };
      const signCount = new DataView(
        authenticatorData.buffer,
        authenticatorData.byteOffset + 33,
        4,
      ).getUint32(0, false);
      b.facts.signer = {
        type: "NATIVE_PASSKEY",
        native: {
          publicKey: r.signer.publicKey,
          keyId: signerLabel,
          algorithm: "ES256",
          rpId: r.webauthn.rpId,
          origin: facts.origin,
          userPresent: true,
          userVerified: true,
          backupEligible: (facts.flags & 0x08) !== 0,
          backedUp: (facts.flags & 0x10) !== 0,
          signCount,
          enrollment: null,
        },
      };
      b.pass(
        "signer.type",
        "Signer",
        `Native passkey ${signerLabel}. ${PASSKEY_IDENTITY_NOTE}`,
        false,
      );
      if (r.signer.enrollment) {
        // Not checked at recording time in this mode: report what the enrollment says now.
        const acc = await opts.chain
          .getAccount(r.signer.enrollment.address, ctx.commitment)
          .catch(() => null);
        const e = acc && acc.owner === ctx.programId ? decodePasskeySigner(acc.data) : null;
        const [pda] = e
          ? await findPasskeySignerPda(toAddress(orgAddr!), e.accountCommitment, ctx.programId)
          : [null];
        const listed =
          e !== null &&
          pda === r.signer.enrollment.address &&
          toHex(e.accountCommitment) === r.signer.enrollment.accountCommitment &&
          (bytesEqual(e.signerKey, key) || bytesEqual(e.previousKey, key));
        if (listed)
          b.pass(
            "signer.enrollment",
            "Signer enrollment",
            `The account's on-chain enrollment lists this key (${bytesEqual(e!.signerKey, key) ? "current" : "previous"} signer). In MERKLE_BATCHED mode the program did not check the enrollment when the batch was anchored.`,
            false,
          );
        else
          b.warn(
            "signer.enrollment",
            "Signer enrollment",
            "The claimed enrollment does not list this key now (or does not exist). In MERKLE_BATCHED mode enrollments are not checked on-chain.",
          );
        if (e && b.facts.signer?.native)
          b.facts.signer.native.enrollment = {
            address: r.signer.enrollment.address,
            accountCommitment: toHex(e.accountCommitment),
            generation: e.generation,
            kind: enrollmentKind(e.kind),
            status: e.status === PASSKEY_STATUS_REVOKED ? "REVOKED" : "ACTIVE",
            currentSigner: toHex(e.signerKey),
          };
      }
    } else {
      if (r.signer.type !== "ED25519_KEY" || !r.signature) throw new Error("malformed");
      const key = fromBase58(r.signer.publicKey);
      const signature = fromBase58(r.signature);
      if (
        !b.expect(
          key.length === 32 && signature.length === 64 && verifyEd25519(signature, utf8(text), key),
          "signature.ed25519",
          "Signature",
          `Ed25519 signature by ${r.signer.publicKey} verifies over the exact message (checked here, off-chain).`,
          "The Ed25519 signature does not verify.",
        )
      )
        return;
      const message = parseAcceptanceMessage(text);
      b.expect(
        message.signer === r.signer.publicKey,
        "message.format",
        "Acceptance message",
        "Message is canonical stele-acceptance-v1 and names the signing account.",
        "The message names another account.",
      );
      id = computeAcceptanceId(addressBytes(versionAddress), key, messageHash, signature);
      signed = message;
      nonce = message;
      window = message;
      requestDomain = message.requestDomain;
      signerLabel = r.signer.publicKey;
      b.facts.signer = await checkSignerEvidence(b, r.signer.evidence, {
        signer: signerLabel,
        message: text,
        requestDomain,
        organization: orgAddr!,
        chainId: ctx.config!.chainId,
      });
      const attested = b.facts.signer?.passkey?.origin ?? null;
      originFacts = {
        requestDomain,
        attestation: attested ? "BROWSER_ATTESTED" : "MERCHANT_CLAIMED",
        origin: attested,
      };
    }
  } catch (e) {
    b.fail(
      "message.format",
      "Acceptance evidence",
      e instanceof PasskeyCheckFailure ? `${e.code}: ${e.message}` : describe(e),
    );
    return;
  }
  b.facts.origin = originFacts;
  if (originFacts.attestation === "BROWSER_ATTESTED")
    b.pass(
      "origin.attestation",
      "Requesting-site attestation",
      `The browser attested origin ${originFacts.origin}.`,
      false,
    );
  else
    b.warn(
      "origin.attestation",
      "Requesting-site attestation",
      `Origin: merchant-claimed, not browser-attested. "Requested by: ${requestDomain}" is part of the signed text, but the requesting page wrote it. Signature and document are unaffected.`,
    );

  // 3. Inclusion: the leaf is in the anchored tree, at the anchored count.
  b.expect(
    toHex(id) === r.acceptanceId,
    "acceptance.id",
    "Acceptance identifier",
    `Acceptance ID ${toHex(id)} recomputes from the signed evidence.`,
    "The acceptance ID does not match the signed evidence.",
  );
  const leafHash = batchLeafHash(r.protocol === "stele/2" ? 2 : 1, id);
  if (
    !b.expect(
      batch.leafCount === event.leafCount &&
        verifyMerkleProof(
          leafHash,
          batch.leafIndex,
          event.leafCount,
          batch.proof.map((p) => fromHex(p, 32)),
          event.batchRoot,
        ),
      "batch.inclusion",
      "Batch inclusion",
      `The acceptance is leaf #${batch.leafIndex} of the ${event.leafCount}-leaf tree whose root was anchored in slot ${tx.slot}.`,
      "The Merkle proof does not lead to the anchored root at the anchored leaf count.",
    )
  )
    return;

  // 4. The accepted version, its content and history; the message against chain data.
  const vc = await loadVersion(ctx, versionAddress);
  if (!vc) return;
  b.expect(
    vc.organizationAddress === orgAddr,
    "tx.relations",
    "Accepted document",
    "The accepted version belongs to the organization whose shard anchored the batch.",
    "The version belongs to another organization than the batch's shard.",
  );
  await verifyVersionEvidence(ctx, vc, {
    publicationHint: undefined,
    embeddedContent: receipt?.content ? embeddedContentBytes(receipt.content) : null,
  });
  const v = vc.version;
  b.expect(
    nonce.shardId === event.shardId,
    "message.window",
    "Nonce shard",
    `The signed nonce ${nonce.shardId}-${nonce.nonceIndex} belongs to the shard that anchored the batch.`,
    "The signed nonce names another shard than the one that anchored the batch.",
  );
  const p = r.protocol === "stele/2" ? (signed as ParsedPasskeyAcceptanceMessage) : null;
  const q = r.protocol === "stele/1" ? (signed as ReturnType<typeof parseAcceptanceMessage>) : null;
  const named = (p ?? q)!;
  b.expect(
    named.title === v.title &&
      named.versionLabel === v.versionLabel &&
      named.version === v.version &&
      named.versionHash === toHex(v.versionHash),
    "version.binding",
    "Exact version binding",
    `The signed message names "${v.title}" version ${v.versionLabel} (#${v.version}) with fingerprint ${toHex(v.versionHash)}.`,
    "Signed title/version/fingerprint do not match the version account.",
  );
  b.expect(
    named.networkLabel === ctx.config!.networkLabel,
    "config.network",
    "Network binding",
    `Signed for "${named.networkLabel}".`,
    `Signed for "${named.networkLabel}" but this network is "${ctx.config!.networkLabel}".`,
  );
  if (signed.orgName === vc.organization.name)
    b.pass("organization.binding", "Organization name", `Signed for "${signed.orgName}".`, false);
  else
    b.warn(
      "organization.binding",
      "Organization name",
      `Signed for "${signed.orgName}"; the organization is currently named "${vc.organization.name}".`,
    );

  // 5. Time: the anchor is the only on-chain clock in this mode.
  if (tx.blockTime === null)
    b.error("message.timing", "Recording time", "The batch's block time is unavailable.");
  else
    b.expect(
      tx.blockTime + MAX_ISSUED_AT_SKEW >= window.issuedAt &&
        tx.blockTime <= window.expiresAt + BATCH_GRACE_SECONDS,
      "message.timing",
      "Recording time",
      "Anchored within the signed validity window.",
      "The batch was anchored outside the signed validity window.",
    );
  if (vc.document.versionCount === v.version)
    b.pass(
      "version.current",
      "Current version at acceptance",
      "This version is still the document's current version.",
    );
  else {
    const [nextAddr] = await findVersionPda(
      toAddress(vc.documentAddress),
      v.version + 1,
      ctx.programId,
    );
    const nextAcc = await opts.chain.getAccount(nextAddr, ctx.commitment).catch(() => null);
    if (!nextAcc)
      b.error(
        "version.current",
        "Current version at acceptance",
        "Could not load the next version.",
      );
    else {
      const next = decodeDocumentVersion(nextAcc.data);
      b.expect(
        Number(next.publishedAt) > window.issuedAt,
        "version.current",
        "Current version at acceptance",
        `Version #${v.version + 1} was published after the signed issue time (as stated in the signed message; not checked on-chain in this mode).`,
        `Version #${v.version + 1} was already published before the signed issue time.`,
      );
    }
  }
  b.skip(
    "nonce.consumed",
    "Replay protection",
    "MERKLE_BATCHED: nonces are not consumed on-chain. Re-anchoring the same signed acceptance yields the same acceptance ID (an acceptance is idempotent); uniqueness of other records is the relayer's job.",
  );
  checkRequestDomain(ctx, signed.orgVerifiedDomain, requestDomain);

  // 6. Fees and the organization's identity.
  b.facts.fees = checkFees(b, tx, decoded.accountKeys, {
    programId: ctx.programId,
    recordId: toHex(event.batchId),
    signer: signerLabel,
  });
  await checkDomain(ctx, vc);

  b.facts.acceptance = {
    protocol: r.protocol,
    evidenceMode: "MERKLE_BATCHED",
    acceptanceId: toHex(id),
    signer: signerLabel,
    message: text,
    messageHash: toHex(messageHash),
    signature: r.protocol === "stele/2" ? r.webauthn!.signature : r.signature!,
    issuedAt: window.issuedAt,
    expiresAt: window.expiresAt,
    requestDomain,
    nonce: { shardId: nonce.shardId, index: nonce.nonceIndex, tag: nonce.nonceTag },
    transaction: tx.signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    commitment: tx.commitment,
    challenge:
      r.protocol === "stele/2" ? toHex(webauthnChallenge(PASSKEY_ACCEPTANCE_TAG, text)) : null,
    webauthn:
      r.protocol === "stele/2"
        ? {
            authenticatorData: r.webauthn!.authenticatorData,
            clientDataJSON: r.webauthn!.clientDataJSON,
            rpId: r.webauthn!.rpId,
          }
        : undefined,
  };
  b.facts.batch = {
    root: batch.root,
    batchId: toHex(event.batchId),
    leafIndex: batch.leafIndex,
    leafCount: event.leafCount,
    proof: batch.proof,
  };

  if (receipt)
    checkReceiptV2(b, receipt, {
      textMatches:
        receipt.acceptance.message === text &&
        receipt.acceptance.messageHash === toHex(messageHash),
      signed,
      signer: signerEvidenceForReceipt,
      webauthn: r.protocol === "stele/2" ? r.webauthn : undefined,
      origin: { ...originFacts },
      batch: b.facts.batch,
    });
}

/** JSON with object keys sorted (claims compare by value, whatever their key order). */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/**
 * Compares every claim of a stele-receipt/2 with facts derived from the chain (and, for the
 * organization's name and domain, with the signed values). A single difference marks it altered.
 */
function checkReceiptV2(
  b: ReportBuilder,
  r: ReceiptV2,
  expected: {
    /** Whether the receipt's message hashes to the recorded/anchored message. */
    textMatches: boolean;
    signed: { orgName: string; orgVerifiedDomain: string | null } | null;
    signer: ReceiptV2["signer"];
    webauthn: ReceiptV2["webauthn"];
    origin: ReceiptV2["origin"];
    batch: ReceiptV2["batch"];
  },
): void {
  const problems: string[] = [];
  const same = (a: unknown, c: unknown) => stableJson(a ?? null) === stableJson(c ?? null);
  const eq = (label: string, claimed: unknown, actual: unknown) => {
    if (!same(claimed, actual))
      problems.push(
        `${label}: receipt says ${JSON.stringify(claimed)}, chain says ${JSON.stringify(actual)}`,
      );
  };
  const f = b.facts;
  const acc = f.acceptance!;
  eq("acceptanceId", r.acceptanceId, acc.acceptanceId);
  eq("network.chainId", r.network.chainId, f.network?.chainId);
  eq("network.label", r.network.label, f.network?.label);
  eq("network.programId", r.network.programId, f.network?.programId);
  eq("transaction.signature", r.transaction.signature, acc.transaction);
  eq("transaction.slot", r.transaction.slot, acc.slot);
  eq("transaction.blockTime", r.transaction.blockTime, acc.blockTime);
  if (!expected.textMatches)
    problems.push("acceptance.message: does not hash to the recorded message hash");
  eq("acceptance.messageHash", r.acceptance.messageHash, acc.messageHash);
  eq("acceptance.challenge", r.acceptance.challenge, acc.challenge ?? null);
  eq(
    "acceptance.signature",
    r.acceptance.signature,
    acc.protocol === "stele/1" ? acc.signature : null,
  );
  eq("acceptance.issuedAt", r.acceptance.issuedAt, acc.issuedAt);
  eq("acceptance.expiresAt", r.acceptance.expiresAt, acc.expiresAt);
  eq("acceptance.nonce", r.acceptance.nonce, acc.nonce);
  eq("acceptance.requestDomain", r.acceptance.requestDomain, acc.requestDomain);
  eq("signer", r.signer, expected.signer);
  eq("webauthn", r.webauthn, expected.webauthn);
  eq("origin", r.origin, expected.origin);
  eq("batch", r.batch, expected.batch);
  eq("organization.address", r.organization.address, f.organization?.address);
  if (
    !same(r.organization.name, expected.signed?.orgName) &&
    !same(r.organization.name, f.organization?.name)
  )
    problems.push(`organization.name: receipt says ${JSON.stringify(r.organization.name)}`);
  if (
    !same(r.organization.verifiedDomain, expected.signed?.orgVerifiedDomain) &&
    !same(r.organization.verifiedDomain, f.organization?.verifiedDomain)
  )
    problems.push(
      `organization.verifiedDomain: receipt says ${JSON.stringify(r.organization.verifiedDomain)}`,
    );
  eq("document.address", r.document.address, f.document?.address);
  eq("document.slug", r.document.slug, f.document?.slug);
  eq("document.documentType", r.document.documentType, f.document?.documentType);
  eq("document.locale", r.document.locale, f.document?.locale);
  eq("version.address", r.version.address, f.version?.address);
  eq("version.number", r.version.number, f.version?.number);
  eq("version.label", r.version.label, f.version?.label);
  eq("version.title", r.version.title, f.version?.title);
  eq("version.versionHash", r.version.versionHash, f.version?.fingerprint);
  eq("version.contentHash", r.version.contentHash, f.version?.contentHash);
  eq("version.previousVersionHash", r.version.previousVersionHash, f.version?.previousFingerprint);
  eq("version.effectiveAt", r.version.effectiveAt, f.version?.effectiveAt);
  eq("version.publishedAt", r.version.publishedAt, f.version?.publishedAt);
  eq("version.publishedSlot", r.version.publishedSlot, f.version?.publishedSlot);
  eq("version.storageUri", r.version.storageUri, f.version?.storageUri);
  if (r.fees) {
    const fees = f.fees!;
    eq("fees.payer", r.fees.payer, fees.payer);
    eq("fees.sponsor", r.fees.sponsor, fees.sponsor);
    eq("fees.reimbursedLamports", r.fees.reimbursedLamports, fees.reimbursedLamports);
    if (fees.feeLamports !== null) eq("fees.feeLamports", r.fees.feeLamports, fees.feeLamports);
  }
  if (r.content) {
    const bytes = embeddedContentBytes(r.content);
    if (!bytes || toHex(hashContentBytes(bytes)) !== f.version?.contentHash)
      problems.push(
        "content: the embedded document text does not hash to the version's content commitment",
      );
  }
  b.expect(
    problems.length === 0,
    "receipt.consistency",
    "Receipt consistency",
    "Every claim in the receipt matches the chain.",
    `Receipt does not match the chain (it was altered) — ${problems.join("; ")}.`,
  );
}

// ---- public API: proofs (purchases, refunds, consents…) ---------------------------------------------

/**
 * Verifies a recorded proof (PROTOCOL_SPEC.md §12). With the statement (from a `stele-proof-v1`
 * receipt or supplied directly) it also checks that the statement is exactly what was signed.
 */
export async function verifyProof(
  input: {
    transactionSignature?: string;
    receipt?: unknown;
    proofId?: string;
    statement?: unknown;
    signer?: SignerEvidence;
  },
  opts: VerifierOptions,
): Promise<VerificationReport> {
  let receipt: ProofReceipt | null = null;
  const b = new ReportBuilder({
    kind: "proof",
    reference: input.transactionSignature ?? input.proofId ?? "receipt",
  });
  if (input.receipt !== undefined) {
    try {
      receipt = parseProofReceipt(input.receipt);
      b.pass(
        "receipt.schema",
        "Receipt format",
        "Receipt is a well-formed stele-proof-v1 bundle (its claims are verified below).",
      );
    } catch (e) {
      b.fail("receipt.schema", "Receipt format", describe(e));
      return b.build(opts.chain.description);
    }
  }
  const signature = input.transactionSignature ?? receipt?.transaction.signature;
  const wantedId = input.proofId ?? receipt?.proofId;
  const ctx: Context = {
    b,
    opts,
    programId: toAddress(opts.programId ?? DEFAULT_PROGRAM_ADDRESS),
    config: null,
    genesisHash: null,
    commitment: "finalized",
  };
  try {
    if (!signature) throw new Error("a transaction signature or proof receipt is required");
    if (!(await checkNetwork(ctx))) return b.build(opts.chain.description);

    const tx = await opts.chain.getTransaction(signature).catch((e: unknown) => {
      b.error("tx.status", "Transaction", describe(e));
      return undefined;
    });
    if (tx === undefined) return b.build(opts.chain.description);
    if (!tx) {
      b.error(
        "tx.status",
        "Transaction",
        `Transaction ${signature} was not found on this network (or the endpoint no longer keeps that history).`,
      );
      return b.build(opts.chain.description);
    }
    if (tx.err !== null) {
      b.fail(
        "tx.status",
        "Transaction",
        `Transaction failed on-chain (${JSON.stringify(tx.err)}); it recorded nothing.`,
      );
      return b.build(opts.chain.description);
    }
    ctx.commitment = tx.commitment;
    if (tx.commitment === "finalized")
      b.pass("tx.status", "Transaction", `Finalized in slot ${tx.slot}.`);
    else b.warn("tx.status", "Transaction", `Confirmed in slot ${tx.slot} but not yet finalized.`);

    // Structure: a canonical Ed25519 verification immediately before a top-level record_proof.
    const decoded = decodeWireTransaction(tx.wire, tx.loadedWritable, tx.loadedReadonly);
    const parsed = decoded.instructions
      .filter(
        (ix) => ix.programId === ctx.programId && identifyInstruction(ix.data) === "record_proof",
      )
      .flatMap((ix) => {
        const prev = decoded.instructions[ix.index - 1];
        if (!prev || prev.programId !== ED25519_PROGRAM_ADDRESS) return [];
        try {
          const ed = parseCanonicalEd25519Data(prev.data);
          const args = decodeRecordProofArgs(ix.data);
          const id = computeProofId(
            addressBytes(ix.accounts[2]!),
            ed.publicKey,
            args.statementHash,
            computeMessageHash(ed.message),
            ed.signature,
          );
          return [{ ix, ed, args, id }];
        } catch {
          return [];
        }
      });
    const chosen = wantedId
      ? parsed.find((p) => toHex(p.id) === wantedId)
      : parsed.length === 1
        ? parsed[0]
        : undefined;
    if (!chosen) {
      b.fail(
        "tx.shape",
        "Transaction structure",
        parsed.length === 0
          ? "The transaction contains no record_proof instruction preceded by a canonical Ed25519 verification."
          : wantedId
            ? `No proof in this transaction has ID ${wantedId}.`
            : `The transaction records ${parsed.length} proofs; specify the proof ID.`,
      );
      return b.build(opts.chain.description);
    }
    b.pass(
      "tx.shape",
      "Transaction structure",
      "A canonical Ed25519 verification immediately precedes a top-level record_proof instruction.",
    );

    const { ed, ix, args, id } = chosen;
    const signer = toBase58(ed.publicKey);
    if (
      !b.expect(
        verifyEd25519(ed.signature, ed.message, ed.publicKey),
        "signature.ed25519",
        "Signature",
        `Ed25519 signature by ${signer} verifies over the exact message bytes (strict RFC 8032).`,
        "Signature does not verify.",
      )
    ) {
      return b.build(opts.chain.description);
    }

    const messageText = fromUtf8(ed.message);
    let message;
    try {
      message = parseProofMessage(messageText);
      b.expect(
        message.signer === signer,
        "message.format",
        "Proof message",
        "Message is canonical stele-proof-v1 and names the signing account.",
        `Message names account ${message.signer} but was signed by ${signer}.`,
      );
    } catch (e) {
      b.fail("message.format", "Proof message", describe(e));
      return b.build(opts.chain.description);
    }
    const type = proofTypeByCode(args.proofType);
    b.expect(
      Number(args.issuedAt) === message.issuedAt &&
        Number(args.expiresAt) === message.expiresAt &&
        args.nonceIndex === message.nonceIndex &&
        toHex(args.nonceTag) === message.nonceTag &&
        args.proofType === message.proofType &&
        toHex(args.statementHash) === message.statementHash,
      "message.window",
      "Signed parameters",
      `Type ${type?.name}, statement hash, validity window and nonce match the recorded instruction.`,
      "Instruction arguments differ from the signed message.",
    );

    const [configPda] = await findConfigPda(ctx.programId);
    const [, configAddr, orgAddr, shardAddr, sysvar] = ix.accounts;
    b.expect(
      configAddr === configPda && sysvar === INSTRUCTIONS_SYSVAR_ADDRESS,
      "tx.accounts",
      "Instruction accounts",
      "Configuration and instructions-sysvar accounts are the canonical ones.",
      "Instruction references unexpected configuration or sysvar accounts.",
    );
    b.expect(
      message.networkLabel === ctx.config!.networkLabel && message.chainId === ctx.config!.chainId,
      "config.network",
      "Network binding",
      `Signed for "${message.networkLabel}" (${message.chainId}).`,
      `Signed for "${message.networkLabel}" (${message.chainId}) but this network is "${ctx.config!.networkLabel}" (${ctx.config!.chainId}).`,
    );
    b.expect(
      message.organization === orgAddr,
      "organization.binding",
      "Organization",
      `The message names organization ${orgAddr}, the account the proof was recorded under.`,
      "The signed organization ID differs from the recording account.",
    );

    // Organization account (canonical PDA, owned by the program).
    const orgAcc = await opts.chain.getAccount(orgAddr!, ctx.commitment).catch(() => null);
    if (!orgAcc || orgAcc.owner !== ctx.programId) {
      b.fail(
        "organization.account",
        "Organization account",
        "Organization account not found or not owned by the program.",
      );
      return b.build(opts.chain.description);
    }
    const organization = decodeOrganization(orgAcc.data);
    const [orgPda] = await findOrganizationPda(
      organization.creator,
      organization.seed,
      ctx.programId,
    );
    b.expect(
      orgPda === orgAddr,
      "organization.account",
      "Organization account",
      "The organization is a canonical account of the program.",
      "The organization account is not a canonical PDA.",
    );
    if (message.orgName !== organization.name)
      b.warn(
        "organization.name",
        "Organization name",
        `Signed for "${message.orgName}"; the organization is currently named "${organization.name}" (renamed later).`,
      );

    // Statement: the off-chain content the signer confirmed by hash.
    const statementInput = input.statement ?? receipt?.statement;
    if (statementInput !== undefined) {
      try {
        const st = parseStatement(statementInput);
        const hash = toHex(statementHash(st));
        const consistent =
          hash === message.statementHash &&
          st.organization.address === orgAddr &&
          st.network.chainId === ctx.config!.chainId &&
          st.network.programId === ctx.programId &&
          st.type === type?.name;
        b.expect(
          consistent,
          "statement.integrity",
          "Statement",
          `The statement (${st.type}, reference ${st.reference}) hashes to ${hash}, the hash the signer confirmed, and names this organization, network and program.`,
          hash !== message.statementHash
            ? `The statement hashes to ${hash}, not to the confirmed ${message.statementHash}: it was altered.`
            : "The statement names another organization, network, program or type.",
        );
        if (consistent) {
          b.facts.statement = st;
          if (["PURCHASE", "SALE", "ORDER", "RECEIPT", "INVOICE"].includes(st.type)) {
            const problem = checkCommerceTotals(parseCommerceDetails(st.details));
            if (problem)
              b.warn(
                "statement.totals",
                "Statement totals",
                `The confirmed amounts do not add up: ${problem}.`,
              );
          }
        }
      } catch (e) {
        b.fail(
          "statement.integrity",
          "Statement",
          `Not a valid stele-statement-v1: ${describe(e)}`,
        );
      }
    } else {
      b.warn(
        "statement.integrity",
        "Statement",
        "Only the statement's hash is on-chain. Supply the statement (from the proof receipt) to see exactly what was confirmed.",
      );
    }

    // Replay protection and the recorded event.
    const shardAcc = await opts.chain.getAccount(shardAddr!, ctx.commitment).catch(() => null);
    if (!shardAcc || shardAcc.owner !== ctx.programId)
      b.fail("nonce.consumed", "Replay protection", "Nonce shard account not found.");
    else {
      const shard = decodeNonceShard(shardAcc.data);
      b.expect(
        shard.organization === orgAddr &&
          shard.shardId === message.shardId &&
          isNonceConsumed(shard.bitmap, args.nonceIndex),
        "nonce.consumed",
        "Replay protection",
        `Nonce ${message.shardId}-${args.nonceIndex} is consumed on-chain; this signed message can never be recorded again.`,
        "Nonce is not consumed in the organization's shard.",
      );
    }
    const event = decodeEventsFromLogs(tx.logs, ctx.programId).find(
      (e) => e.name === "ProofRecorded" && bytesEqual(e.data.proofId, id),
    );
    b.expect(
      Boolean(event),
      "proof.id",
      "Proof identifier",
      `Proof ID ${toHex(id)} matches the recorded event.`,
      "No recorded event carries the recomputed proof ID.",
    );

    const orgDomain = message.orgVerifiedDomain;
    const req = message.requestDomain;
    if (
      (orgDomain && (req === orgDomain || req.endsWith(`.${orgDomain}`))) ||
      (opts.trustedRequestDomains ?? []).includes(req)
    )
      b.pass("request.domain", "Requesting site", `The proof was requested by ${req}.`, false);
    else
      b.warn(
        "request.domain",
        "Requesting site",
        `The proof was requested by ${req}, which is not the organization's verified domain${orgDomain ? ` (${orgDomain})` : ""}.`,
      );

    b.facts.signer = await checkSignerEvidence(b, input.signer ?? receipt?.signer, {
      signer,
      message: messageText,
      requestDomain: req,
      organization: orgAddr!,
      chainId: ctx.config!.chainId,
    });
    b.facts.fees = checkFees(b, tx, decoded.accountKeys, {
      programId: ctx.programId,
      recordId: toHex(id),
      signer,
    });
    b.facts.organization = {
      address: orgAddr!,
      name: organization.name,
      verifiedDomain: verifiedDomainAt(organization, nowSeconds(opts)),
      domainExpiresAt: organization.verifiedDomain ? Number(organization.domainExpiresAt) : null,
      owner: organization.owner,
    };
    await checkDomain(ctx, { organization, organizationAddress: orgAddr! } as VersionContext);
    b.facts.proof = {
      proofId: toHex(id),
      type: type?.name ?? String(args.proofType),
      signer,
      message: messageText,
      messageHash: toHex(computeMessageHash(ed.message)),
      signature: toBase58(ed.signature),
      statementHash: message.statementHash,
      issuedAt: message.issuedAt,
      expiresAt: message.expiresAt,
      requestDomain: req,
      nonce: { shardId: message.shardId, index: message.nonceIndex, tag: message.nonceTag },
      transaction: signature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      commitment: tx.commitment,
    };

    if (receipt) {
      const problems: string[] = [];
      const same = (a: unknown, c: unknown) =>
        JSON.stringify(a ?? null) === JSON.stringify(c ?? null);
      const eq = (label: string, claimed: unknown, actual: unknown) => {
        if (!same(claimed, actual))
          problems.push(
            `${label}: receipt says ${JSON.stringify(claimed)}, chain says ${JSON.stringify(actual)}`,
          );
      };
      const p = b.facts.proof;
      eq("proofId", receipt.proofId, p.proofId);
      eq("network.chainId", receipt.network.chainId, b.facts.network?.chainId);
      eq("network.programId", receipt.network.programId, b.facts.network?.programId);
      eq("transaction.signature", receipt.transaction.signature, p.transaction);
      eq("transaction.slot", receipt.transaction.slot, p.slot);
      eq("proof.type", receipt.proof.type, p.type);
      eq("proof.signer", receipt.proof.signer, p.signer);
      eq("proof.message", receipt.proof.message, p.message);
      eq("proof.messageHash", receipt.proof.messageHash, p.messageHash);
      eq("proof.signature", receipt.proof.signature, p.signature);
      eq("proof.statementHash", receipt.proof.statementHash, p.statementHash);
      eq("proof.nonce", receipt.proof.nonce, p.nonce);
      eq("proof.requestDomain", receipt.proof.requestDomain, p.requestDomain);
      eq("organization.address", receipt.organization.address, orgAddr);
      if (
        !same(receipt.organization.name, message.orgName) &&
        !same(receipt.organization.name, organization.name)
      )
        problems.push(
          `organization.name: receipt says ${JSON.stringify(receipt.organization.name)}`,
        );
      if (receipt.fees && b.facts.fees) {
        eq("fees.payer", receipt.fees.payer, b.facts.fees.payer);
        eq("fees.sponsor", receipt.fees.sponsor, b.facts.fees.sponsor);
        eq(
          "fees.reimbursedLamports",
          receipt.fees.reimbursedLamports,
          b.facts.fees.reimbursedLamports,
        );
      }
      if (
        receipt.signer &&
        receipt.signer.type !== "WALLET" &&
        b.facts.signer?.type !== receipt.signer.type
      )
        problems.push("signer: the passkey evidence does not verify");
      b.expect(
        problems.length === 0,
        "receipt.consistency",
        "Receipt consistency",
        "Every claim in the receipt matches the chain.",
        `Receipt does not match the chain (it was altered) — ${problems.join("; ")}.`,
      );
    }
  } catch (e) {
    b.error("verifier", "Verification", describe(e));
  }
  return b.build(opts.chain.description);
}

/** 32 raw bytes of a base58 address (throws on anything else). */
function addressBytes(a: string): Uint8Array {
  const bytes = fromBase58(a);
  if (bytes.length !== 32) throw new Error(`invalid address ${a}`);
  return bytes;
}

function embeddedContentBytes(content: NonNullable<Receipt["content"]>): Uint8Array | null {
  try {
    return serializeContent(content as unknown as Content);
  } catch {
    return null;
  }
}
