/**
 * Confirming a proof (purchase, refund, consent…) in the browser.
 *
 * Before anything is signed the SDK checks, locally, that the statement it shows hashes to the
 * value in the message, and that the message names this signer, this organization, this network,
 * the statement's type and the current site. A server that showed one order but asked for a
 * signature over another is caught here; the program then rebuilds the rest of the message on-chain.
 */
import {
  buildProofMessage,
  describeStatement,
  fromBase58,
  fromHex,
  parseProofMessage,
  parseStatement,
  proofTypeByName,
  statementHash,
  toBase58,
  toHex,
  utf8,
  verifyEd25519,
  type Statement,
} from "@stelehq/protocol";
import { signForStele, type MessageSigner } from "./accept";
import type { SigningPolicy, SteleClient } from "./client";
import { IntegrityError } from "./verified-document";

export interface VerifiedProofRequest {
  requestId: string;
  token: string;
  status: string;
  statement: Statement;
  statementHash: string;
  /** Human-readable lines rendered locally from the verified statement. */
  lines: string[];
  organization: { address: string; name: string; verifiedDomain: string | null };
  signingPolicy: SigningPolicy;
}

/** Loads a proof request and checks the statement's integrity locally. */
export async function loadProofRequest(opts: {
  client: SteleClient;
  requestId: string;
  token: string;
}): Promise<VerifiedProofRequest> {
  const view = await opts.client.getProofRequest(opts.requestId, opts.token);
  const statement = parseStatement(view.statement);
  const hash = toHex(statementHash(statement));
  if (hash !== view.statementHash)
    throw new IntegrityError(
      "The statement does not match its hash. It was not shown for your protection.",
    );
  if (statement.organization.address !== view.organization.address)
    throw new IntegrityError("The statement names a different organization.");
  return {
    requestId: view.requestId,
    token: opts.token,
    status: view.status,
    statement,
    statementHash: hash,
    lines: describeStatement(statement),
    organization: view.organization,
    signingPolicy: view.signingPolicy,
  };
}

export interface ProofResult {
  proofId: string;
  transactionSignature: string;
  message: string;
}

export async function confirmProof(opts: {
  client: SteleClient;
  request: VerifiedProofRequest;
  signer: MessageSigner;
  /** Host the browser presents as Origin (normally `window.location.hostname`). */
  requestDomain: string;
  onStatus?: (s: "requesting" | "awaiting-signature" | "recording" | "recorded") => void;
}): Promise<ProofResult> {
  const { client, request, signer } = opts;
  opts.onStatus?.("requesting");
  const ch = await client.createProofChallenge(request.requestId, {
    token: request.token,
    signer: signer.address,
    signerType: signer.signerType ?? "wallet",
  });
  // Every security-relevant line is checked against what this browser verified itself; the
  // canonical rebuild then rules out any other difference.
  const parsed = parseProofMessage(ch.message);
  const type = proofTypeByName(request.statement.type);
  const problems = [
    parsed.statementHash !== request.statementHash && "statement",
    parsed.signer !== signer.address && "account",
    parsed.organization !== request.statement.organization.address && "organization",
    parsed.chainId !== request.statement.network.chainId && "network",
    parsed.proofType !== type?.code && "type",
    parsed.requestDomain !== opts.requestDomain && "requesting site",
  ].filter(Boolean);
  const rebuilt = buildProofMessage(
    {
      ...parsed,
      statementHash: fromHex(parsed.statementHash, 32),
      nonceTag: fromHex(parsed.nonceTag, 8),
    },
    parsed.requestDomain,
  );
  if (problems.length > 0 || rebuilt !== ch.message)
    throw new IntegrityError(
      `The message to sign does not match the verified statement (${problems.join(", ") || "format"}). Signing was blocked for your protection.`,
    );

  opts.onStatus?.("awaiting-signature");
  const bytes = utf8(ch.message);
  const { signature, passkeyAssertion } = await signForStele(signer, bytes);
  if (!verifyEd25519(signature, bytes, fromBase58(signer.address)))
    throw new IntegrityError("The signature does not verify for this account.");
  opts.onStatus?.("recording");
  const result = await client.submitProof(request.requestId, {
    token: request.token,
    clientBinding: ch.clientBinding,
    signature: toBase58(signature),
    passkeyAssertion,
  });
  opts.onStatus?.("recorded");
  return {
    proofId: result.proofId,
    transactionSignature: result.transactionSignature,
    message: ch.message,
  };
}
