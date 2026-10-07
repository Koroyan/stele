/**
 * Generic proofs (PROTOCOL_SPEC.md §12): purchases, refunds, consents, quote acceptances…
 *
 *   createProofRequest (organization server, API key) → canonical statement with a random salt
 *   issueProofChallenge (customer browser)             → nonce + anchor message rebuilt from chain
 *   submitProof        (customer browser)              → signature (+ passkey assertion) → relay
 *
 * The statement stays off-chain (it may contain order details); only its SHA-256 is recorded, and
 * the customer signs a message that names that hash. Proof receipts are therefore served only to
 * the organization (API key) or to the customer holding the request's client token — never by
 * proof ID alone, because proof IDs are public on-chain.
 */
import { address } from "@solana/kit";
import { randomBytes } from "node:crypto";
import {
  buildEd25519Instruction,
  buildProofMessageFromChain,
  ChainStateError,
  checkCommerceTotals,
  decodeOrganization,
  DEFAULT_CHALLENGE_TTL,
  describeStatement,
  explainTransactionError,
  fetchAccountData,
  fetchProtocolConfig,
  findConfigPda,
  formatRfc3339,
  fromBase58,
  fromHex,
  newSalt,
  parseCommerceDetails,
  parseStatement,
  passkeySignatureChallenge,
  proofTypeByName,
  recordProofInstruction,
  statementHash,
  toBase64Url,
  toHex,
  utf8,
  verifiedDomainAt,
  verifyEd25519,
  type PasskeyAssertion,
  type ProofTypeName,
  type Statement,
} from "@stele/protocol";
import { and, desc, eq, nonceShards, organizations, proofRequests, proofs } from "@stele/db";
import type { Deps } from "../deps.js";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../errors.js";
import { matchesHash, randomToken, sha256Hex } from "../lib/crypto.js";
import { afterCursor, page } from "../lib/pagination.js";
import { indexProofTransaction, syncShard, untilAvailable } from "../lib/sync.js";
import { enqueueWebhook } from "../lib/webhooks.js";
import { allocateFreeNonce } from "./acceptance.js";
import {
  resolveSigner,
  signerEvidenceFor,
  verifySigningAssertion,
  type SignerType,
} from "./signers.js";
import { bookRecording, planSponsorship } from "./sponsorship.js";

const COMMERCE = new Set(["PURCHASE", "SALE", "ORDER", "RECEIPT", "INVOICE"]);

export interface CreateProofRequestInput {
  type: ProofTypeName;
  reference: string;
  summary: string;
  details: Record<string, unknown>;
  policies?: Statement["policies"];
  relatesTo?: string;
  externalUserRef?: string;
  ttlSeconds: number;
}

export async function createProofRequest(
  deps: Deps,
  key: { organizationId: string; id: string },
  input: CreateProofRequestInput,
) {
  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, key.organizationId));
  if (!org) throw notFound("Organization");
  const { config } = await fetchProtocolConfig(deps.chain.rpc, deps.chain.programAddress);
  const orgData = await fetchAccountData(deps.chain.rpc, address(org.address));
  if (!orgData) throw conflict("chain_state", "The organization is not on this network");
  const onChain = decodeOrganization(orgData);
  const now = await deps.chain.clusterTime();
  let statement: Statement;
  try {
    statement = parseStatement({
      format: "stele-statement-v1",
      type: input.type,
      network: { chainId: config.chainId, programId: deps.chain.programAddress },
      organization: {
        address: org.address,
        name: onChain.name,
        domain: verifiedDomainAt(onChain, now),
      },
      reference: input.reference,
      createdAt: formatRfc3339(now),
      summary: input.summary,
      details: input.details,
      ...(input.policies ? { policies: input.policies } : {}),
      ...(input.relatesTo ? { relatesTo: input.relatesTo } : {}),
      salt: newSalt(),
    });
  } catch (e) {
    throw badRequest("invalid_statement", (e as Error).message);
  }
  if (COMMERCE.has(statement.type)) {
    const problem = checkCommerceTotals(parseCommerceDetails(statement.details));
    if (problem) throw badRequest("invalid_totals", problem);
  }
  const token = `stlp_${randomToken(32)}`;
  const hash = toHex(statementHash(statement));
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
  const [row] = await deps.db
    .insert(proofRequests)
    .values({
      organizationId: org.id,
      clientTokenHash: sha256Hex(token),
      proofType: statement.type,
      statement: statement as unknown as Record<string, unknown>,
      statementHash: hash,
      reference: statement.reference,
      externalUserRef: input.externalUserRef ?? null,
      createdByApiKeyId: key.id,
      expiresAt,
    })
    .returning({ id: proofRequests.id });
  return {
    requestId: row!.id,
    clientToken: token,
    statement,
    statementHash: hash,
    expiresAt: expiresAt.toISOString(),
    confirmUrl: `${deps.config.APP_ORIGIN}/confirm/${row!.id}#token=${token}`,
  };
}

async function requestFor(deps: Deps, id: string, token: string) {
  const [r] = await deps.db.select().from(proofRequests).where(eq(proofRequests.id, id));
  if (!r || !matchesHash(token, r.clientTokenHash)) throw notFound("Proof request");
  return r;
}

export async function getProofRequest(deps: Deps, id: string, token: string) {
  const r = await requestFor(deps, id, token);
  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, r.organizationId));
  const statement = r.statement as unknown as Statement;
  return {
    requestId: r.id,
    status: r.status !== "confirmed" && r.expiresAt < new Date() ? "expired" : r.status,
    type: r.proofType,
    statement,
    statementHash: r.statementHash,
    lines: describeStatement(statement),
    organization: { address: org!.address, name: org!.name, verifiedDomain: org!.verifiedDomain },
    signingPolicy: org!.settings.signingPolicy ?? "WALLET_ONLY",
    expiresAt: r.expiresAt.toISOString(),
    proofId: r.proofId,
    transactionSignature: r.txSignature,
  };
}

export async function issueProofChallenge(
  deps: Deps,
  id: string,
  input: { token: string; signer: string; signerType: SignerType; requestDomain: string },
) {
  if (input.signerType === "passkey_p256")
    throw badRequest(
      "unsupported_signer",
      "Proofs are signed by a wallet or a PRF-protected Stele key; native passkeys (stele/2) sign acceptances",
    );
  if (fromBase58(input.signer).length !== 32)
    throw badRequest("invalid_signer", "Signer must be a 32-byte public key");
  const r = await requestFor(deps, id, input.token);
  if (r.status === "confirmed" || r.status === "submitted")
    throw conflict("proof_request_closed", `This request is already ${r.status}`);
  if (r.expiresAt < new Date()) throw conflict("proof_request_expired", "This request expired");
  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, r.organizationId));
  const sites = org!.settings.allowedRequestDomains ?? [];
  if (sites.length > 0 && !sites.includes(input.requestDomain))
    throw forbidden(
      `This organization does not accept signing requests from ${input.requestDomain}`,
    );
  const signer = await resolveSigner(deps, {
    org: org!,
    signer: input.signer,
    signerType: input.signerType,
    host: input.requestDomain,
    externalUserRef: r.externalUserRef,
  });
  const plan = await planSponsorship(deps, org!);
  const nonce = await allocateFreeNonce(deps, org!.id, plan.preferredShards);
  const now = await deps.chain.clusterTime();
  const nonceTag = new Uint8Array(randomBytes(8));
  const type = proofTypeByName(r.proofType)!;
  let built;
  try {
    built = await buildProofMessageFromChain({
      rpc: deps.chain.rpc,
      programAddress: deps.chain.programAddress,
      organization: address(org!.address),
      nonceShard: address(nonce.shardAddress),
      signer: address(input.signer),
      proofType: type.code,
      statementHash: fromHex(r.statementHash, 32),
      issuedAt: now,
      expiresAt: now + DEFAULT_CHALLENGE_TTL,
      nonceIndex: nonce.index,
      nonceTag,
      requestDomain: input.requestDomain,
      clusterTime: now,
    });
  } catch (e) {
    if (e instanceof ChainStateError) throw conflict("chain_state", e.message);
    throw e;
  }
  const clientBinding = randomToken(32);
  await deps.db
    .update(proofRequests)
    .set({
      status: "issued",
      shardRowId: nonce.shardRowId,
      nonceIndex: nonce.index,
      nonceTag: toHex(nonceTag),
      signerAddress: input.signer,
      signerType: signer.signerType,
      signerIdentityId: signer.identity?.id ?? null,
      requestDomain: input.requestDomain,
      issuedAt: now,
      challengeExpiresAt: now + DEFAULT_CHALLENGE_TTL,
      message: built.message,
      clientBindingHash: sha256Hex(clientBinding),
      passkeyAssertion: null,
      updatedAt: new Date(),
    })
    .where(eq(proofRequests.id, r.id));
  return {
    requestId: r.id,
    clientBinding,
    message: built.message,
    statementHash: r.statementHash,
    issuedAt: now,
    expiresAt: now + DEFAULT_CHALLENGE_TTL,
    nonce: { shardId: nonce.shardId, index: nonce.index, tag: toHex(nonceTag) },
    organization: {
      address: org!.address,
      name: built.organization.name,
      verifiedDomain: built.fields.orgVerifiedDomain,
    },
    network: { label: built.config.networkLabel, chainId: built.config.chainId },
    signerType: signer.signerType,
    passkey:
      signer.signerType === "passkey"
        ? {
            challenge: toBase64Url(passkeySignatureChallenge(built.message)),
            rpId: signer.identity!.rpId,
            allowCredentials: signer.credentials,
          }
        : null,
    feeSponsor: plan.sponsor,
  };
}

export async function submitProof(
  deps: Deps,
  id: string,
  input: {
    token: string;
    clientBinding: string;
    signature: string;
    passkeyAssertion?: PasskeyAssertion;
  },
) {
  const r = await requestFor(deps, id, input.token);
  if (r.status === "confirmed")
    return {
      proofId: r.proofId!,
      transactionSignature: r.txSignature!,
      status: "confirmed" as const,
    };
  if (
    r.status !== "issued" ||
    !r.clientBindingHash ||
    !matchesHash(input.clientBinding, r.clientBindingHash)
  )
    throw conflict("challenge_not_open", "Request a signing challenge first");
  const signature = fromBase58(input.signature);
  if (signature.length !== 64) throw badRequest("invalid_signature", "Signature must be 64 bytes");
  const signer = fromBase58(r.signerAddress!);
  if (!verifyEd25519(signature, utf8(r.message!), signer))
    throw badRequest("invalid_signature", "The signature does not match the message and account");
  const now = await deps.chain.clusterTime();
  if (now > r.challengeExpiresAt!)
    throw conflict("challenge_expired", "The challenge expired; request a new one");
  if (r.signerType === "passkey") {
    await verifySigningAssertion(deps, {
      identityId: r.signerIdentityId!,
      assertion: input.passkeyAssertion,
      message: r.message!,
      host: r.requestDomain!,
    });
  }
  const [claimed] = await deps.db
    .update(proofRequests)
    .set({
      status: "submitted",
      passkeyAssertion: r.signerType === "passkey" ? input.passkeyAssertion! : null,
      updatedAt: new Date(),
    })
    .where(and(eq(proofRequests.id, r.id), eq(proofRequests.status, "issued")))
    .returning({ id: proofRequests.id });
  if (!claimed) throw conflict("challenge_not_open", "Already submitted");

  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, r.organizationId));
  const [shard] = await deps.db.select().from(nonceShards).where(eq(nonceShards.id, r.shardRowId!));
  const [config] = await findConfigPda(deps.chain.programAddress);
  const record = recordProofInstruction({
    programAddress: deps.chain.programAddress,
    relayer: deps.chain.relayer,
    config,
    organization: address(org!.address),
    nonceShard: address(shard!.address),
    proofType: proofTypeByName(r.proofType)!.code,
    statementHash: fromHex(r.statementHash, 32),
    nonceIndex: r.nonceIndex!,
    nonceTag: fromHex(r.nonceTag!, 8),
    issuedAt: r.issuedAt!,
    expiresAt: r.challengeExpiresAt!,
  });
  let txSignature: string;
  try {
    txSignature = await deps.chain.sendRecord(
      buildEd25519Instruction(signer, signature, utf8(r.message!)),
      record,
    );
  } catch (e) {
    const reason = explainTransactionError(e).message.slice(0, 300);
    await deps.db
      .update(proofRequests)
      .set({ status: "failed", failureReason: reason, updatedAt: new Date() })
      .where(eq(proofRequests.id, r.id));
    if (/NonceAlreadyUsed/.test(reason))
      await syncShard(deps.db, deps.chain, shard!.address).catch(() => undefined);
    throw new ApiError(502, "relay_failed", `The proof could not be recorded: ${reason}`);
  }
  const mine = await untilAvailable(async () =>
    (
      await indexProofTransaction(deps.db, deps.chain, txSignature, {
        proofRequestId: r.id,
        externalUserRef: r.externalUserRef,
        reference: r.reference,
        signerType: r.signerType as "wallet" | "passkey",
      })
    ).find((p) => p.statementHash === r.statementHash && p.signer === r.signerAddress),
  );
  if (!mine) {
    await deps.db
      .update(proofRequests)
      .set({
        status: "failed",
        failureReason: "transaction did not contain the expected proof",
        txSignature,
        updatedAt: new Date(),
      })
      .where(eq(proofRequests.id, r.id));
    throw new ApiError(
      502,
      "relay_inconsistent",
      "The confirmed transaction did not contain the expected proof",
    );
  }
  await deps.db
    .update(proofRequests)
    .set({ status: "confirmed", txSignature, proofId: mine.proofId, updatedAt: new Date() })
    .where(eq(proofRequests.id, r.id));
  await bookRecording(deps, {
    organizationId: r.organizationId,
    txSignature,
    recordKind: "proof",
    recordId: mine.proofId,
    shardAddress: mine.shardAddress,
    fee: mine.fee,
  });
  await enqueueWebhook(deps.db, r.organizationId, "proof.recorded", {
    proofId: mine.proofId,
    type: r.proofType,
    reference: r.reference,
    statementHash: r.statementHash,
    transactionSignature: txSignature,
    slot: mine.slot,
    commitment: "confirmed",
    signer: r.signerAddress,
    signerType: r.signerType,
    externalUserRef: r.externalUserRef,
    fee: {
      payer: mine.fee.feePayer,
      lamports: mine.fee.feeLamports,
      sponsor: mine.fee.reimbursedLamports !== null ? "organization" : "stele",
      reimbursedLamports: mine.fee.reimbursedLamports,
    },
    verify: "Verify the proof receipt independently; do not treat this webhook as proof.",
  });
  return { proofId: mine.proofId, transactionSignature: txSignature, status: "confirmed" as const };
}

/** Everything a receipt needs that is not on-chain: the statement and the signer evidence. */
export async function proofEvidence(deps: Deps, proofId: string, organizationId?: string) {
  const [p] = await deps.db.select().from(proofs).where(eq(proofs.proofId, proofId));
  if (!p || (organizationId && p.organizationId !== organizationId)) throw notFound("Proof");
  const [r] = p.proofRequestId
    ? await deps.db.select().from(proofRequests).where(eq(proofRequests.id, p.proofRequestId))
    : [];
  if (!r) throw notFound("Proof statement");
  return {
    proof: p,
    statement: r.statement as unknown as Statement,
    signer: await signerEvidenceFor(deps, {
      signerType: p.signerType,
      passkeyAssertion: (r.passkeyAssertion as PasskeyAssertion | null) ?? null,
    }),
  };
}

export async function proofEvidenceForRequest(deps: Deps, id: string, token: string) {
  const r = await requestFor(deps, id, token);
  if (r.status !== "confirmed" || !r.proofId)
    throw conflict("not_recorded", "This proof is not recorded yet");
  return proofEvidence(deps, r.proofId, r.organizationId);
}

export async function listProofs(
  deps: Deps,
  organizationId: string,
  q: {
    type?: string;
    reference?: string;
    externalUserRef?: string;
    limit: number;
    cursor?: string;
  },
) {
  const conditions = [eq(proofs.organizationId, organizationId)];
  if (q.type) conditions.push(eq(proofs.proofType, q.type));
  if (q.reference) conditions.push(eq(proofs.reference, q.reference));
  if (q.externalUserRef) conditions.push(eq(proofs.externalUserRef, q.externalUserRef));
  if (q.cursor) conditions.push(afterCursor(q.cursor, proofs.slot, proofs.proofId));
  const rows = await deps.db
    .select({
      proofId: proofs.proofId,
      type: proofs.proofType,
      reference: proofs.reference,
      statementHash: proofs.statementHash,
      signer: proofs.signerAddress,
      signerType: proofs.signerType,
      transactionSignature: proofs.txSignature,
      slot: proofs.slot,
      blockTime: proofs.blockTime,
      externalUserRef: proofs.externalUserRef,
      feePayer: proofs.feePayer,
      feeLamports: proofs.feeLamports,
      reimbursedLamports: proofs.reimbursedLamports,
    })
    .from(proofs)
    .where(and(...conditions))
    .orderBy(desc(proofs.slot), desc(proofs.proofId))
    .limit(q.limit + 1);
  const { items, nextCursor } = page(rows, q.limit, (r) => ({ slot: r.slot, id: r.proofId }));
  return { proofs: items, nextCursor };
}
