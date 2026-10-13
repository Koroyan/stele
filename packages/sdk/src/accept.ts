/**
 * The acceptance flow. Before asking for a signature, the SDK rebuilds the exact message from
 * on-chain data it read itself and refuses to continue if the server-provided message differs by a
 * single byte. A wallet then displays that same text; a native passkey signs a challenge the SDK
 * computes from it (the passkey prompt itself shows the site, not the text — this page shows it).
 */
import {
  buildAcceptanceMessage,
  buildPasskeyAcceptanceMessage,
  fromBase58,
  fromHex,
  toBase58,
  toBase64Url,
  utf8,
  verifiedDomainAt,
  verifyEd25519,
  type PasskeyAssertion,
} from "@stelehq/protocol";
import type { FeeInfo, SignerAudit, SignerType, SteleClient } from "./client";
import { NativePasskeySigner } from "./native-passkey";
import { IntegrityError, type VerifiedDocument } from "./verified-document";

/** Anything that can sign raw bytes with an Ed25519 key (Wallet Standard `signMessage`). */
export interface MessageSigner {
  address: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  /** Shown next to the account, e.g. "Phantom". */
  walletName?: string;
  /**
   * "wallet" (default), "passkey_p256" (native passkey, see `NativePasskeySigner`) or "passkey"
   * (a PRF-protected Stele key, see `PasskeySigner`).
   */
  signerType?: SignerType;
  /** PRF passkey signers: signature plus the passkey's assertion over the same message. */
  signWithAssertion?(
    message: Uint8Array,
  ): Promise<{ signature: Uint8Array; passkeyAssertion: PasskeyAssertion }>;
  /** Native passkey signers: one user-verified assertion over `challenge` for relying party `rpId`. */
  approve?(challenge: Uint8Array, rpId: string): Promise<PasskeyAssertion>;
  /** Native passkey signers: the compressed P-256 key. */
  publicKey?: Uint8Array;
}

/** Signs with the right ceremony for the signer type. */
export async function signForStele(
  signer: MessageSigner,
  message: Uint8Array,
): Promise<{ signature: Uint8Array; passkeyAssertion?: PasskeyAssertion }> {
  if (signer.signerType === "passkey") {
    if (!signer.signWithAssertion)
      throw new Error("A passkey signer must provide signWithAssertion");
    return signer.signWithAssertion(message);
  }
  return { signature: await signer.signMessage(message) };
}

export type AcceptanceStatus = "requesting" | "awaiting-signature" | "recording" | "recorded";

export interface AcceptanceResult {
  acceptanceId: string;
  /**
   * The recording transaction. Null when the organization anchors acceptances in Merkle batches
   * and this one is queued for the next anchor (seconds); the receipt is available after it.
   */
  transactionSignature: string | null;
  slot: number | null;
  /** "DIRECT_ONCHAIN" (recorded by its own transaction) or "MERKLE_BATCHED". */
  evidenceMode: "DIRECT_ONCHAIN" | "MERKLE_BATCHED";
  /** The exact text the user signed. */
  message: string;
  receiptPath: string;
  signerType: SignerType;
  /** Who paid the network fee (never the signer). */
  fee: FeeInfo | null;
  /** Off-chain audit trail: the IP address and time zone the server recorded (not evidence). */
  audit: SignerAudit | null;
  /**
   * Lets this browser download its own PDF certificate (with the audit trail):
   * `client.downloadReceiptPdf(receiptAccess)`. The binding is this acceptance's client secret.
   */
  receiptAccess: { challengeId: string; clientBinding: string };
}

export interface AcceptOptions {
  client: SteleClient;
  verified: VerifiedDocument;
  signer: MessageSigner;
  /** Host the browser will present as `Origin` (normally `window.location.hostname`). */
  requestDomain: string;
  sessionToken?: string;
  onStatus?: (status: AcceptanceStatus) => void;
}

export async function acceptDocument(opts: AcceptOptions): Promise<AcceptanceResult> {
  const { client, verified, signer } = opts;
  opts.onStatus?.("requesting");
  const challenge = await client.createChallenge({
    organization: verified.organizationAddress,
    document: verified.documentAddress,
    signer: signer.address,
    sessionToken: opts.sessionToken,
    signerType: signer.signerType ?? "wallet",
  });

  if (challenge.version.address !== verified.versionAddress) {
    throw new IntegrityError(
      "A newer version was published while you were reading. Please review it first.",
    );
  }
  if (signer.signerType === "passkey_p256") return acceptNative(opts, challenge);
  // Independent reconstruction from chain data (organization name and domain status, version,
  // network label) plus the challenge's nonce and validity window.
  const expected = buildAcceptanceMessage(
    {
      orgName: verified.organization.name,
      orgVerifiedDomain: verifiedDomainAt(verified.organization, challenge.issuedAt),
      title: verified.version.title,
      versionLabel: verified.version.versionLabel,
      version: verified.version.version,
      versionHash: verified.version.versionHash,
      signer: signer.address,
      networkLabel: verified.config.networkLabel,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
      shardId: challenge.nonce.shardId,
      nonceIndex: challenge.nonce.index,
      nonceTag: fromHex(challenge.nonce.tag, 8),
    },
    opts.requestDomain,
  );
  if (expected !== challenge.message) {
    throw new IntegrityError(
      "The message provided by the server does not match the on-chain data. Signing was blocked for your protection.",
    );
  }

  opts.onStatus?.("awaiting-signature");
  const messageBytes = utf8(challenge.message);
  const { signature, passkeyAssertion } = await signForStele(signer, messageBytes);
  if (!verifyEd25519(signature, messageBytes, fromBase58(signer.address))) {
    throw new IntegrityError(
      "The wallet returned a signature that does not verify for this account.",
    );
  }

  opts.onStatus?.("recording");
  const result = await client.submitChallenge(
    challenge.challengeId,
    challenge.clientBinding,
    toBase58(signature),
    passkeyAssertion,
  );
  opts.onStatus?.("recorded");
  return {
    acceptanceId: result.acceptanceId,
    transactionSignature: result.transactionSignature,
    slot: result.slot,
    message: challenge.message,
    receiptPath: `/receipt/${result.acceptanceId}`,
    evidenceMode: result.evidenceMode ?? "DIRECT_ONCHAIN",
    signerType: signer.signerType ?? "wallet",
    fee: result.fee ?? null,
    audit: result.audit ?? null,
    receiptAccess: { challengeId: challenge.challengeId, clientBinding: challenge.clientBinding },
  };
}

/**
 * stele/2: rebuild the `stele-acceptance-v2` message from chain data, compute its WebAuthn
 * challenge locally, and approve it with one passkey prompt.
 */
async function acceptNative(
  opts: AcceptOptions,
  challenge: Awaited<ReturnType<SteleClient["createChallenge"]>>,
): Promise<AcceptanceResult> {
  const { client, verified, signer } = opts;
  if (!signer.approve || !signer.publicKey)
    throw new Error("A native passkey signer must provide approve() and its public key");
  if (challenge.protocol !== "stele/2" || !challenge.passkey)
    throw new IntegrityError("The server did not issue a native passkey challenge.");
  const expected = buildPasskeyAcceptanceMessage(
    {
      orgName: verified.organization.name,
      orgVerifiedDomain: verifiedDomainAt(verified.organization, challenge.issuedAt),
      title: verified.version.title,
      versionLabel: verified.version.versionLabel,
      version: verified.version.version,
      versionHash: verified.version.versionHash,
      signer: signer.publicKey,
      networkLabel: verified.config.networkLabel,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
      shardId: challenge.nonce.shardId,
      nonceIndex: challenge.nonce.index,
      nonceTag: fromHex(challenge.nonce.tag, 8),
    },
    opts.requestDomain,
  );
  if (expected !== challenge.message) {
    throw new IntegrityError(
      "The message provided by the server does not match the on-chain data. Signing was blocked for your protection.",
    );
  }
  const webauthn = NativePasskeySigner.acceptanceChallenge(expected);
  if (toBase64Url(webauthn) !== challenge.passkey.challenge)
    throw new IntegrityError("The server's passkey challenge does not match the message.");

  opts.onStatus?.("awaiting-signature");
  const assertion = await signer.approve(webauthn, challenge.passkey.rpId);
  opts.onStatus?.("recording");
  const result = await client.submitChallenge(
    challenge.challengeId,
    challenge.clientBinding,
    undefined,
    assertion,
  );
  opts.onStatus?.("recorded");
  return {
    acceptanceId: result.acceptanceId,
    transactionSignature: result.transactionSignature,
    slot: result.slot,
    message: challenge.message,
    receiptPath: `/receipt/${result.acceptanceId}`,
    evidenceMode: result.evidenceMode ?? "DIRECT_ONCHAIN",
    signerType: "passkey_p256",
    fee: result.fee ?? null,
    audit: result.audit ?? null,
    receiptAccess: { challengeId: challenge.challengeId, clientBinding: challenge.clientBinding },
  };
}
