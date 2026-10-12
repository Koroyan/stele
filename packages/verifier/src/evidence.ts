/**
 * Evidence shared by acceptances and proofs: how the signing key was controlled (wallet or
 * passkey-protected Stele key) and who paid the network fee. Both are checked from first
 * principles: passkey evidence by verifying every signature it contains, fees from the transaction.
 */
import {
  decodeEventsFromLogs,
  fromBase58,
  fromBase64Url,
  parseClientData,
  parseKeyStatement,
  passkeySignatureChallenge,
  passkeyStatementChallenge,
  rpIdCoversHost,
  sha256,
  toHex,
  verifyKeyStatementSignature,
  verifyPasskeyAssertion,
  type SignerEvidence,
} from "@stelehq/protocol";
import type { ReportBuilder, VerifiedFacts } from "./report";
import type { TransactionSnapshot } from "./rpc";

const IDENTITY_NOTE =
  "It proves control of the key at signing time; it does not by itself identify a person.";

/**
 * Checks signer evidence (from a receipt or supplied by the caller). Without evidence the signer
 * type is unspecified: the signature proves control of the account key and nothing more.
 */
export async function checkSignerEvidence(
  b: ReportBuilder,
  evidence: SignerEvidence | undefined,
  ctx: {
    signer: string;
    message: string;
    requestDomain: string;
    organization: string;
    chainId: string;
  },
): Promise<VerifiedFacts["signer"]> {
  if (!evidence) {
    b.pass(
      "signer.type",
      "Signer",
      `Signed with the key of account ${ctx.signer} (no signer-type evidence supplied). ${IDENTITY_NOTE}`,
      false,
    );
    return { type: "UNSPECIFIED" };
  }
  if (evidence.type === "WALLET") {
    b.pass(
      "signer.type",
      "Signer",
      `Signed with the self-custodied key (wallet) of account ${ctx.signer}. ${IDENTITY_NOTE}`,
      false,
    );
    return { type: "WALLET", evidence };
  }

  // PASSKEY_PROTECTED_STELE_KEY: every claim must verify; a broken claim means an altered receipt.
  const problems: string[] = [];
  const pk = evidence.passkey;
  const credential = {
    credentialId: pk.credentialId,
    publicKey: pk.publicKey,
    algorithm: pk.algorithm,
    rpId: pk.rpId,
  };
  let statement: ReturnType<typeof parseKeyStatement> | null = null;
  try {
    statement = parseKeyStatement(evidence.keyStatement.statement);
  } catch (e) {
    problems.push(`key statement: ${(e as Error).message}`);
  }
  if (statement) {
    if (!["REGISTER", "ADD_PASSKEY", "ROTATE"].includes(statement.action))
      problems.push("key statement does not bind a passkey");
    if (statement.key !== ctx.signer) problems.push("key statement is about another key");
    if (statement.organization !== ctx.organization)
      problems.push("key statement is for another organization");
    if (statement.chainId !== ctx.chainId) problems.push("key statement is for another network");
    if (statement.credentialId !== pk.credentialId)
      problems.push("key statement names another passkey");
    if (statement.rpId !== pk.rpId) problems.push("key statement names another relying party");
    try {
      if (statement.passkeyKeyHash !== toHex(sha256(fromBase64Url(pk.publicKey))))
        problems.push("key statement commits to a different passkey public key");
    } catch {
      problems.push("malformed passkey public key");
    }
  }
  if (
    !verifyKeyStatementSignature(
      evidence.keyStatement.statement,
      evidence.keyStatement.keySignature,
      fromBase58(ctx.signer),
    )
  )
    problems.push("the key's signature over the key statement does not verify");

  // The passkey endorsed the statement on a site its relying party covers.
  let endorsementHost: string | null = null;
  try {
    endorsementHost = new URL(
      parseClientData(fromBase64Url(evidence.keyStatement.passkeyAssertion.clientDataJSON)).origin,
    ).hostname;
  } catch {
    problems.push("malformed endorsement assertion");
  }
  if (endorsementHost) {
    if (!rpIdCoversHost(pk.rpId, endorsementHost))
      problems.push("endorsement was made outside the relying party");
    const endorsed = await verifyPasskeyAssertion(
      evidence.keyStatement.passkeyAssertion,
      credential,
      {
        challenge: passkeyStatementChallenge(evidence.keyStatement.statement),
        host: endorsementHost,
      },
    );
    if (!endorsed.ok) problems.push(`passkey endorsement: ${endorsed.reason}`);
  }

  // The passkey approved exactly this message, with user verification, on the requesting site.
  const approved = await verifyPasskeyAssertion(evidence.assertion, credential, {
    challenge: passkeySignatureChallenge(ctx.message),
    host: ctx.requestDomain,
  });
  if (!approved.ok) problems.push(`passkey approval of this message: ${approved.reason}`);

  if (problems.length > 0) {
    b.fail(
      "signer.passkey",
      "Passkey-protected signer",
      `The passkey evidence does not verify (it was altered or belongs elsewhere) — ${problems.join("; ")}.`,
    );
    return { type: "UNSPECIFIED" };
  }
  const origin = approved.ok ? approved.origin : "";
  b.pass(
    "signer.passkey",
    "Passkey-protected signer",
    `Signed with a passkey-protected Stele key: passkey ${pk.credentialId.slice(0, 12)}… (relying party ${pk.rpId}) approved this exact message with user verification on ${origin}, and the key itself declared that passkey as its protector on ${new Date(statement!.issuedAt * 1000).toISOString()} (statement signed by the key and endorsed by the passkey). No biometric data is involved. ${IDENTITY_NOTE}`,
  );
  return {
    type: "PASSKEY_PROTECTED_STELE_KEY",
    evidence,
    passkey: {
      credentialId: pk.credentialId,
      rpId: pk.rpId,
      origin,
      keyRegisteredAt: statement!.issuedAt,
    },
  };
}

/** Who paid the fee: the transaction's fee payer, and whether a sponsored shard reimbursed it. */
export function checkFees(
  b: ReportBuilder,
  tx: TransactionSnapshot,
  accountKeys: string[],
  ctx: { programId: string; recordId: string; signer: string },
): VerifiedFacts["fees"] {
  const payer = accountKeys[0]!;
  const reimbursed = decodeEventsFromLogs(tx.logs, ctx.programId).find(
    (e) => e.name === "SponsorReimbursed" && toHex(e.data.recordId) === ctx.recordId,
  );
  const reimbursedLamports =
    reimbursed && reimbursed.name === "SponsorReimbursed" ? Number(reimbursed.data.amount) : null;
  const facts = {
    payer,
    feeLamports: tx.fee,
    sponsor: reimbursedLamports !== null ? ("ORGANIZATION" as const) : ("STELE" as const),
    reimbursedLamports,
    signerPaid: payer === ctx.signer,
  };
  const fee = tx.fee !== null ? `${tx.fee} lamports` : "the network fee";
  b.pass(
    "fees.payer",
    "Fee payer",
    facts.signerPaid
      ? `The signer paid ${fee} itself.`
      : reimbursedLamports !== null
        ? `${fee} was paid by ${payer} and reimbursed (${reimbursedLamports} lamports) by the organization's sponsored nonce shard. The signer paid nothing. Fee payment does not affect what was signed.`
        : `${fee} was paid by ${payer}, not by the signer. Fee payment does not affect what was signed.`,
    false,
  );
  return facts;
}
