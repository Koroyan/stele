/**
 * @stele/sdk — verified agreement acceptance.
 *
 * ```ts
 * import { SteleClient, loadVerifiedDocument, acceptDocument } from "@stele/sdk";
 * const client = new SteleClient({ apiBaseUrl: "https://api.stele.example" });
 * const doc = await loadVerifiedDocument({ client, organization: "acme.example", document: "terms-of-service" });
 * const result = await acceptDocument({ client, verified: doc, signer, requestDomain: location.hostname });
 * ```
 *
 * Acceptance proves that the signing key (a wallet, a native passkey, or a passkey-protected Stele
 * key) authorized acceptance of this exact version. It does not by itself prove the identity of the
 * person controlling the key. The user never pays the network fee.
 */
export * from "./accept";
export * from "./client";
export * from "./embed";
export * from "./native-passkey";
export * from "./passkey";
export * from "./proofs";
export * from "./receipts";
export * from "./verified-document";
export * from "./wallets";
export {
  contentToPlainLines,
  groupedFingerprint,
  shortFingerprint,
  type Block,
  type Content,
} from "@stele/protocol";
