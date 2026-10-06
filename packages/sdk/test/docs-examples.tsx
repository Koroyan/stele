/**
 * The JavaScript and TypeScript samples of docs/get-started.md and docs/api.md, type-checked against
 * the SDK (`pnpm typecheck`), so the documentation cannot drift from the real API. Not executed: the
 * samples need a Stele deployment, an API key and a browser. Keep in sync when editing those
 * documents. (The server samples of every language are also run against a local deployment before
 * a documentation change ships.)
 */
import { writeFile } from "node:fs/promises";
import { chainFromUrls, verifyAcceptance, verifyProof } from "@stele/verifier";
import {
  NativePasskeySigner,
  PasskeySigner,
  SteleClient,
  acceptDocument,
  mount,
  passkeySigningSupport,
  type AcceptanceResult,
} from "../src";
import { TermsAcceptance } from "../src/react";
import { SteleServerClient, verifyWebhook } from "../src/server";

declare const acceptanceId: string;
declare const rawBody: Buffer;
declare const signatureHeader: string | undefined;

// Client setup (Get started §7, API "Client setup")
const stele = new SteleServerClient({
  apiBaseUrl: "https://app.stele.example/api",
  apiKey: process.env.STELE_API_KEY!,
});

export async function serverSamples() {
  // Get started §7: the current version accepted?
  const acceptance = await stele.hasAcceptedLatest("user_12345", "terms-of-service");
  if (acceptance) {
    void [acceptance.acceptanceId, acceptance.transactionSignature, acceptance.signer];
  }

  // API "Documents"
  const latest = await stele.latestVersion("terms-of-service");
  console.log(latest.version.number, latest.version.address);

  // Get started §8 / API "Acceptance sessions"
  const { sessionToken } = await stele.createAcceptanceSession({
    document: "terms-of-service",
    externalUserRef: "user_12345",
  });

  // API "List acceptances"
  let cursor: string | undefined;
  do {
    const page = await stele.listAcceptances({ externalUserRef: "user_12345", limit: 50, cursor });
    for (const acceptance of page.acceptances) {
      console.log(acceptance.acceptanceId, acceptance.versionNumber);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  // API "Get one acceptance"
  const { acceptance: one, receiptUrl } = await stele.getAcceptance(acceptanceId);
  void [one.signerType, one.feeLamports, receiptUrl, sessionToken];

  // API "Receipts"
  const res = await fetch(
    `https://app.stele.example/api/v1/public/acceptances/${acceptanceId}/receipt`,
  );
  const { receipt, report } = (await res.json()) as { receipt: unknown; report: unknown };
  await writeFile(`${acceptanceId}.json`, JSON.stringify(receipt, null, 2));
  void report;
}

export function webhookSample() {
  // Get started §9 (Node.js)
  let event;
  try {
    event = verifyWebhook(process.env.STELE_WEBHOOK_SECRET!, signatureHeader, rawBody);
  } catch {
    return 400;
  }
  void event.id;
  if (event.type === "agreement.accepted") {
    const { acceptanceId, externalUserRef, versionNumber } = event.data;
    void [acceptanceId, externalUserRef, versionNumber];
  }
  return 204;
}

export function ReactSample() {
  // Get started §3
  return (
    <TermsAcceptance
      apiBaseUrl="https://app.stele.example/api"
      appUrl="https://app.stele.example"
      organization="acme.com"
      document="terms-of-service"
    />
  );
}

export function ReactCallbacksSample() {
  // Get started §5 and §8
  return (
    <TermsAcceptance
      apiBaseUrl="https://app.stele.example/api"
      appUrl="https://app.stele.example"
      organization="acme.com"
      document="terms-of-service"
      sessionToken={() => fetch("/stele/session").then((r) => r.text())}
      onAccepted={(result) => console.log("Accepted:", result.acceptanceId)}
      onError={(error) => console.warn("Stele:", error.message)}
    />
  );
}

export function ReactAdvancedSample({ sessionToken }: { sessionToken?: string }) {
  // API "Bundled JavaScript and React" (+ options table)
  return (
    <TermsAcceptance
      apiBaseUrl="https://app.stele.example/api"
      appUrl="https://app.stele.example"
      organization="acme.com"
      document="terms-of-service"
      sessionToken={sessionToken}
      theme="light"
      rpcUrls={["https://rpc-one.example"]}
      expected={{ programId: "6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV", chainId: "solana:x" }}
      onAccepted={(result) => console.log(result.acceptanceId)}
      onError={(error) => console.warn(error.message)}
      className="terms"
      style={{ maxWidth: 640 }}
    />
  );
}

export function mountSample() {
  // Get started §3, §5 and §8 / API "Bundled JavaScript and React"
  const widget = mount(document.querySelector("#terms")!, {
    apiBaseUrl: "https://app.stele.example/api",
    appUrl: "https://app.stele.example",
    organization: "acme.com",
    document: "terms-of-service",
    sessionToken: () => fetch("/stele/session").then((r) => r.text()),
    onAccepted: (result: AcceptanceResult) =>
      console.log(result.acceptanceId, result.transactionSignature, result.slot, result.signerType),
    onError: (error) => console.warn("Stele:", error.message),
  });
  widget.destroy();
}

export async function verifierSample() {
  // API "Verifier"
  const report = await verifyAcceptance(
    { transactionSignature: "4Gv4TkZK…" },
    { chain: chainFromUrls(["https://rpc-one.example", "https://rpc-two.example"]) },
  );
  const verdict: "VALID" | "VALID_WITH_WARNINGS" | "INVALID" | "INCONCLUSIVE" = report.verdict;
  return verdict;
}

declare const organizationAddress: string;
declare const verified: Parameters<typeof acceptDocument>[0]["verified"];

export async function proofAndSignerSamples() {
  // API "Proofs" step 1
  const request = await stele.createProofRequest({
    type: "PURCHASE",
    reference: "order-1042",
    summary: "Purchase of 2 items from Acme",
    details: {
      currency: "EUR",
      items: [{ sku: "MUG-1", name: "Mug", quantity: 2, unitPrice: "9.00", total: "18.00" }],
      subtotal: "18.00",
      shipping: "3.90",
      total: "21.90",
    },
    externalUserRef: "user_12345",
  });
  void [request.requestId, request.clientToken, request.confirmUrl];

  // API "Proofs" step 3
  const { proofs } = await stele.listProofs({ type: "PURCHASE", reference: "order-1042" });
  const proof = proofs.find((p) => p.externalUserRef === "user_12345");
  if (!proof) throw new Error("Not confirmed yet");
  const { receipt, report } = await stele.getProofReceipt(proof.proofId);
  void [receipt, report];

  // API "Managing signers from your server"
  const { signers } = await stele.listSigners("user_12345");
  await stele.revokeSigner(
    signers[0]!.publicKey,
    "lost all devices; identity re-verified by support",
  );
}

export async function nativePasskeyBrowserSample() {
  // API "Signing without a wallet": native passkeys in the browser (bundled SDK)
  const client = new SteleClient({ apiBaseUrl: "https://app.stele.example/api" });
  const signer =
    NativePasskeySigner.remembered(client, organizationAddress) ??
    (await NativePasskeySigner.register({ client, organization: organizationAddress }));
  await acceptDocument({ client, verified, signer, requestDomain: location.hostname });
}

export async function passkeyBrowserSample() {
  // API "PRF-protected Stele keys": in the browser (bundled SDK)
  const client = new SteleClient({ apiBaseUrl: "https://app.stele.example/api" });
  const signer =
    PasskeySigner.remembered(client, organizationAddress) ??
    (await PasskeySigner.register({ client, organization: organizationAddress, recoveryKit: true }))
      .signer;
  await acceptDocument({ client, verified, signer, requestDomain: location.hostname });
  void passkeySigningSupport;
}

export async function proofVerifierSample(receipt: unknown) {
  // Verification "Proof receipts"
  const report = await verifyProof(
    { receipt },
    { chain: chainFromUrls(["https://a", "https://b"]) },
  );
  void report.verdict;
}
