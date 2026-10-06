/**
 * Builds a `stele-receipt-v1` bundle from a VERIFIED acceptance report. Issuers (including the Stele
 * API) generate receipts only from facts that the verifier has just checked against the chain.
 */
import {
  PROOF_RECEIPT_FORMAT,
  RECEIPT_FORMAT,
  RECEIPT_V2_FORMAT,
  type ProofReceipt,
  type Receipt,
  type ReceiptV2,
} from "@stele/protocol";
import type { VerificationReport } from "./report";

export class ReceiptError extends Error {}

export function receiptFromReport(
  report: VerificationReport,
  opts: { includeContent?: boolean; now?: Date } = {},
): Receipt {
  if (report.subject.kind !== "acceptance")
    throw new ReceiptError("receipts are issued for acceptances only");
  if (report.verdict !== "VALID" && report.verdict !== "VALID_WITH_WARNINGS") {
    throw new ReceiptError(`cannot issue a receipt for evidence with verdict ${report.verdict}`);
  }
  const { network, organization, document, version, acceptance, content } = report.facts;
  if (!network || !organization || !document || !version || !acceptance)
    throw new ReceiptError("report is missing verified facts");
  if (acceptance.protocol !== "stele/1" || acceptance.message === null)
    throw new ReceiptError("stele/2 acceptances use stele-receipt/2 (receiptV2FromReport)");
  const receipt: Receipt = {
    format: RECEIPT_FORMAT,
    acceptanceId: acceptance.acceptanceId,
    network: { chainId: network.chainId, label: network.label, programId: network.programId },
    transaction: {
      signature: acceptance.transaction,
      slot: acceptance.slot,
      blockTime: acceptance.blockTime,
    },
    acceptance: {
      signer: acceptance.signer,
      message: acceptance.message,
      messageHash: acceptance.messageHash,
      signature: acceptance.signature,
      issuedAt: acceptance.issuedAt,
      expiresAt: acceptance.expiresAt,
      nonce: acceptance.nonce,
      requestDomain: acceptance.requestDomain,
    },
    organization: {
      address: organization.address,
      name: organization.name,
      verifiedDomain: organization.verifiedDomain,
    },
    document: {
      address: document.address,
      slug: document.slug,
      documentType: document.documentType,
      locale: document.locale,
    },
    version: {
      address: version.address,
      number: version.number,
      label: version.label,
      title: version.title,
      versionHash: version.fingerprint,
      contentHash: version.contentHash,
      previousVersionHash: version.previousFingerprint,
      effectiveAt: version.effectiveAt,
      publishedAt: version.publishedAt,
      publishedSlot: version.publishedSlot,
      storageUri: version.storageUri,
    },
    generatedAt: (opts.now ?? new Date()).toISOString(),
  };
  if (opts.includeContent && content)
    receipt.content = JSON.parse(content.canonical) as Receipt["content"];
  if (report.facts.signer?.evidence) receipt.signer = report.facts.signer.evidence;
  const fees = report.facts.fees;
  if (fees && fees.feeLamports !== null)
    receipt.fees = {
      payer: fees.payer,
      sponsor: fees.sponsor,
      feeLamports: fees.feeLamports,
      reimbursedLamports: fees.reimbursedLamports,
    };
  return receipt;
}

/**
 * Builds a `stele-receipt/2` bundle from a VERIFIED report of a stele/2 acceptance or of any batched
 * acceptance. The signed text must be known (only its hash, or a root, is on-chain) and the document
 * text is included by default.
 */
export function receiptV2FromReport(
  report: VerificationReport,
  opts: { includeContent?: boolean; now?: Date } = {},
): ReceiptV2 {
  if (report.subject.kind !== "acceptance")
    throw new ReceiptError("receipts are issued for acceptances only");
  if (report.verdict !== "VALID" && report.verdict !== "VALID_WITH_WARNINGS")
    throw new ReceiptError(`cannot issue a receipt for evidence with verdict ${report.verdict}`);
  const { network, organization, document, version, acceptance, content, signer, origin, fees } =
    report.facts;
  if (!network || !organization || !document || !version || !acceptance)
    throw new ReceiptError("report is missing verified facts");
  if (!origin) throw new ReceiptError("report is missing the origin facts");
  const native = acceptance.protocol === "stele/2";
  if (acceptance.evidenceMode === "DIRECT_ONCHAIN" && !native)
    throw new ReceiptError("stele/1 acceptances recorded directly use stele-receipt-v1");
  if (native && (!signer?.native || !acceptance.challenge || !acceptance.webauthn))
    throw new ReceiptError("not a verified stele/2 acceptance");
  if (acceptance.message === null)
    throw new ReceiptError("the signed text is unknown: supply it to the verifier first");
  if (acceptance.evidenceMode === "MERKLE_BATCHED" && !report.facts.batch)
    throw new ReceiptError("the batch inclusion proof was not verified");
  const receipt: ReceiptV2 = {
    format: RECEIPT_V2_FORMAT,
    protocol: acceptance.protocol,
    acceptanceId: acceptance.acceptanceId,
    evidenceMode: acceptance.evidenceMode,
    network: { chainId: network.chainId, label: network.label, programId: network.programId },
    transaction: {
      signature: acceptance.transaction,
      slot: acceptance.slot,
      blockTime: acceptance.blockTime,
    },
    acceptance: {
      message: acceptance.message,
      messageHash: acceptance.messageHash,
      challenge: native ? acceptance.challenge! : null,
      signature: native ? null : acceptance.signature,
      issuedAt: acceptance.issuedAt,
      expiresAt: acceptance.expiresAt,
      nonce: acceptance.nonce,
      requestDomain: acceptance.requestDomain,
    },
    signer: native
      ? {
          type: "NATIVE_PASSKEY",
          algorithm: "ES256",
          publicKey: signer!.native!.publicKey,
          enrollment: signer!.native!.enrollment
            ? {
                address: signer!.native!.enrollment.address,
                accountCommitment: signer!.native!.enrollment.accountCommitment,
              }
            : null,
        }
      : {
          type: "ED25519_KEY",
          algorithm: "Ed25519",
          publicKey: acceptance.signer,
          ...(signer?.evidence ? { evidence: signer.evidence } : {}),
        },
    ...(native
      ? {
          webauthn: {
            authenticatorData: acceptance.webauthn!.authenticatorData,
            clientDataJSON: acceptance.webauthn!.clientDataJSON,
            signature: acceptance.signature,
            rpId: acceptance.webauthn!.rpId,
          },
        }
      : {}),
    origin: {
      attestation: origin.attestation,
      origin: origin.origin,
      requestDomain: origin.requestDomain,
    },
    ...(report.facts.batch ? { batch: { ...report.facts.batch } } : {}),
    organization: {
      address: organization.address,
      name: organization.name,
      verifiedDomain: organization.verifiedDomain,
    },
    document: {
      address: document.address,
      slug: document.slug,
      documentType: document.documentType,
      locale: document.locale,
    },
    version: {
      address: version.address,
      number: version.number,
      label: version.label,
      title: version.title,
      versionHash: version.fingerprint,
      contentHash: version.contentHash,
      previousVersionHash: version.previousFingerprint,
      effectiveAt: version.effectiveAt,
      publishedAt: version.publishedAt,
      publishedSlot: version.publishedSlot,
      storageUri: version.storageUri,
    },
    generatedAt: (opts.now ?? new Date()).toISOString(),
  };
  if ((opts.includeContent ?? true) && content)
    receipt.content = JSON.parse(content.canonical) as ReceiptV2["content"];
  if (fees && fees.feeLamports !== null)
    receipt.fees = {
      payer: fees.payer,
      sponsor: fees.sponsor,
      feeLamports: fees.feeLamports,
      reimbursedLamports: fees.reimbursedLamports,
    };
  return receipt;
}

/** Builds a `stele-proof-v1` bundle from a VERIFIED proof report (statement included). */
export function proofReceiptFromReport(
  report: VerificationReport,
  opts: { now?: Date } = {},
): ProofReceipt {
  if (report.subject.kind !== "proof") throw new ReceiptError("not a proof report");
  if (report.verdict !== "VALID" && report.verdict !== "VALID_WITH_WARNINGS")
    throw new ReceiptError(`cannot issue a receipt for evidence with verdict ${report.verdict}`);
  const { network, organization, proof, statement, signer, fees } = report.facts;
  if (!network || !organization || !proof || !statement)
    throw new ReceiptError("report is missing verified facts (the statement is required)");
  const receipt: ProofReceipt = {
    format: PROOF_RECEIPT_FORMAT,
    proofId: proof.proofId,
    network: { chainId: network.chainId, label: network.label, programId: network.programId },
    transaction: { signature: proof.transaction, slot: proof.slot, blockTime: proof.blockTime },
    proof: {
      type: proof.type as ProofReceipt["proof"]["type"],
      signer: proof.signer,
      message: proof.message,
      messageHash: proof.messageHash,
      signature: proof.signature,
      statementHash: proof.statementHash,
      issuedAt: proof.issuedAt,
      expiresAt: proof.expiresAt,
      nonce: proof.nonce,
      requestDomain: proof.requestDomain,
    },
    organization: {
      address: organization.address,
      name: organization.name,
      verifiedDomain: organization.verifiedDomain,
    },
    statement: statement as unknown as Record<string, unknown>,
    generatedAt: (opts.now ?? new Date()).toISOString(),
  };
  if (signer?.evidence) receipt.signer = signer.evidence;
  if (fees && fees.feeLamports !== null)
    receipt.fees = {
      payer: fees.payer,
      sponsor: fees.sponsor,
      feeLamports: fees.feeLamports,
      reimbursedLamports: fees.reimbursedLamports,
    };
  return receipt;
}
