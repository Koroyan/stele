import type { Metadata } from "next";
import Link from "next/link";
import { Reference, type RefGroup } from "@/components/developers/reference";
import { siteOrigin } from "@/lib/origin";

export const metadata: Metadata = {
  title: "SDK reference",
  description:
    "Every function of @stelehq/sdk — Stele Gate, accepting documents, the widget, wallets and passkeys, proofs, receipts, the server client and webhooks — and @stelehq/verifier.",
};

function groups(origin: string): RefGroup[] {
  const api = `${origin}/api`;
  return [
    {
      id: "setup",
      title: "Setup",
      intro: (
        <>
          <code className="font-mono text-fg">npm install @stelehq/sdk</code>. In the browser the
          SDK talks to a Stele app; every answer it uses is checked against Solana (program,
          network, fingerprints).
        </>
      ),
      importLine: `import { SteleClient } from "@stelehq/sdk";`,
      entries: [
        {
          name: "new SteleClient(options)",
          kind: "class",
          signature: `new SteleClient({ apiBaseUrl: string; fetch?: typeof fetch })`,
          description:
            "The connection to a Stele app. Pass it to the functions below, or let them create one from apiBaseUrl.",
          example: `const client = new SteleClient({ apiBaseUrl: "${api}" });`,
        },
        {
          name: "client.getNetwork()",
          kind: "method",
          signature: `getNetwork(): Promise<NetworkInfo>
// { cluster, chainId, label, walletChain, programId, relayer, publicRpcUrls, … }`,
          description: "The Solana network and Stele program this app uses.",
        },
        {
          name: "SteleApiError",
          kind: "class",
          signature: `class SteleApiError extends Error { status: number; code: string }`,
          description: (
            <>
              Thrown for API errors, with the API&apos;s code — for example{" "}
              <code className="font-mono text-fg">already_accepted</code> (409) when this signer
              already accepted this version.
            </>
          ),
        },
      ],
    },
    {
      id: "gate",
      title: "Stele Gate",
      intro: (
        <>
          Run a protected action only after the wallet accepted the current terms. Your program
          enforces the same rule on-chain — see{" "}
          <Link href="/developers/onchain" className="text-accent">
            On-chain
          </Link>
          .
        </>
      ),
      importLine: `import { createSteleGate } from "@stelehq/sdk";`,
      entries: [
        {
          name: "createSteleGate(options)",
          kind: "function",
          signature: `createSteleGate({
  apiBaseUrl?: string;              // or client
  client?: SteleClient;
  wallet?: MessageSigner | (() => MessageSigner | Promise<MessageSigner>);
  ui?: "modal" | "none";            // default "modal"
  theme?: "auto" | "dark" | "light";
  requestDomain?: string;           // default location.hostname
  onStatus?: (status: GateStatus) => void;
}): SteleGate`,
          description:
            "Creates the gate. wallet is any object with address and signMessage (Wallet Standard wallets, Phantom, a passkey signer).",
          example: `const stele = createSteleGate({
  apiBaseUrl: "${api}",
  wallet: {
    address: wallet.publicKey.toBase58(),
    signMessage: (message) => wallet.signMessage(message),
  },
});`,
        },
        {
          name: "stele.gate(request)",
          kind: "method",
          signature: `gate<T>({
  policy: string;                   // the policy address
  action: () => T | Promise<T>;     // your transaction
  acceptLabel?: string;             // default "Accept & Continue"
  wallet?: MessageSigner;
}): Promise<T>`,
          description: (
            <>
              If the wallet&apos;s passport (or access pass) is current, runs{" "}
              <code className="font-mono">action</code> right away. Otherwise shows the exact
              required text, records the acceptance (free for the user), waits until it is visible
              on Solana, then runs it. Closing the window throws{" "}
              <code className="font-mono">GateCancelledError</code> and nothing runs.
            </>
          ),
          example: `await stele.gate({
  policy: "YOUR_POLICY_ADDRESS",
  action: () => sendDepositTransaction(),
  acceptLabel: "Accept & Deposit",
});`,
        },
        {
          name: "stele.check(policy, wallet)",
          kind: "method",
          signature: `check(policy: string, holder: string): Promise<AccessCheck>
// { status: "VALID" | "MISSING" | "OUTDATED", requiredVersion, storage: "passport" | "pass",
//   gateAccount, passport, passportEntry, accessPass, pass, document }`,
          description:
            "The wallet's status without prompting — for your interface (badges, disabled buttons). The same data is at GET /v1/public/gate/access.",
        },
        {
          name: "mountVerifiedBadge(target, { program })",
          kind: "function",
          signature: `mountVerifiedBadge(target: string | Element, {
  program: string;                  // your protected program
  apiBaseUrl?: string;              // default https://stele.site/api
  theme?: "auto" | "light" | "dark";
}): { state, refresh(), destroy() }
// React: <SteleVerifiedBadge program="…" /> · script: <span data-stele-verified="…"></span>`,
          description:
            "The Stele Verified badge: the live verification of your program (re-checked after every upgrade), opening the public evidence. Outside your organization's verified domains it reads “Not valid on this site”. Set up the verification in the dashboard (Gate → Verification).",
          example: `mountVerifiedBadge("#stele-badge", { program: "YOUR_PROGRAM_ID" });`,
        },
        {
          name: "GateCancelledError · AccessRequiredError · StaleTermsError",
          kind: "errors",
          description: (
            <>
              <code className="font-mono">GateCancelledError</code>: the user closed the window.{" "}
              <code className="font-mono">AccessRequiredError</code>: with{" "}
              <code className="font-mono">ui: &quot;none&quot;</code>, acceptance is needed — show
              your own UI. <code className="font-mono">StaleTermsError</code>: the document changed
              while open; the SDK loads the new version.
            </>
          ),
        },
      ],
    },
    {
      id: "accept",
      title: "Accept a document (Proof)",
      importLine: `import { loadVerifiedDocument, acceptDocument } from "@stelehq/sdk";`,
      entries: [
        {
          name: "loadVerifiedDocument(options)",
          kind: "function",
          signature: `loadVerifiedDocument({
  client: SteleClient;
  organization: string;             // address or verified domain, e.g. "acme.com"
  document: string;                 // slug, e.g. "terms-of-service"
  loadPrevious?: boolean;           // also load the previous version (for "what changed")
}): Promise<VerifiedDocument>`,
          description:
            "Loads the current version and checks its text against the on-chain fingerprint before you show it. Throws IntegrityError if anything does not match.",
        },
        {
          name: "acceptDocument(options)",
          kind: "function",
          signature: `acceptDocument({
  client: SteleClient;
  verified: VerifiedDocument;
  signer: MessageSigner;            // wallet or passkey
  requestDomain: string;            // location.hostname
  sessionToken?: string;            // from your server, links the acceptance to your user
  onStatus?: (s: "requesting" | "awaiting-signature" | "recording" | "recorded") => void;
}): Promise<AcceptanceResult>
// { acceptanceId, transactionSignature, message, receiptPath, evidenceMode, … }`,
          description:
            "The user signs the exact message naming this version; Stele records it on Solana and pays the fee. Each account accepts a version once — a repeat is refused before signing (already_accepted).",
          example: `const verified = await loadVerifiedDocument({ client, organization: "acme.com", document: "terms-of-service" });
const result = await acceptDocument({ client, verified, signer, requestDomain: location.hostname });`,
        },
      ],
    },
    {
      id: "widget",
      title: "Widget & React",
      intro:
        "A ready acceptance step on your page: shows the terms, lets the user sign, records it.",
      entries: [
        {
          name: "<script> + data attributes",
          kind: "HTML",
          signatureLanguage: "html",
          signature: `<div data-stele-organization="acme.com" data-stele-document="terms-of-service"></div>
<script src="${origin}/sdk/v1/stele.js" defer></script>`,
          description: (
            <>
              No build step. The script also exposes <code className="font-mono">window.Stele</code>
              : <code className="font-mono">mount</code>,{" "}
              <code className="font-mono">mountProof</code>,{" "}
              <code className="font-mono">createGate</code>,{" "}
              <code className="font-mono">client()</code>.
            </>
          ),
        },
        {
          name: "mount(target, options)",
          kind: "function",
          signature: `mount(target: string | Element, {
  apiBaseUrl: string;
  organization: string;
  document: string;
  onAccepted?: (result: AcceptanceResult) => void;
}): { destroy(): void }`,
          description: "The same widget from JavaScript.",
        },
        {
          name: "<TermsAcceptance />",
          kind: "React",
          signatureLanguage: "tsx",
          signature: `import { TermsAcceptance } from "@stelehq/sdk/react";

<TermsAcceptance apiBaseUrl="${api}" organization="acme.com" document="terms-of-service"
  onAccepted={(result) => …} />`,
          description: "The widget as a React component.",
        },
        {
          name: "mountProof(target, options)",
          kind: "function",
          signature: `mountProof(target, { apiBaseUrl, requestId, token, onConfirmed? }): { destroy(): void }`,
          description: "A confirmation widget for a proof request (purchase, refund, consent).",
        },
      ],
    },
    {
      id: "signers",
      title: "Wallets & passkeys",
      intro: "Signers are objects with address and signMessage. These helpers make them.",
      entries: [
        {
          name: "watchWallets(chain, onChange)",
          kind: "function",
          signature: `watchWallets(chain: string, onChange: (wallets: AvailableWallet[]) => void): () => void`,
          description:
            "Lists installed Wallet Standard wallets (Phantom, Solflare, Backpack…) for a chain, e.g. solana:devnet. Returns an unsubscribe function.",
        },
        {
          name: "connectWallet(wallet, chain)",
          kind: "function",
          signature: `connectWallet(wallet: AvailableWallet, chain: string): Promise<MessageSigner>`,
          description: "Connects a wallet and returns its signer.",
        },
        {
          name: "identifyPasskeySigner(options)",
          kind: "function",
          signature: `identifyPasskeySigner({ client, organization }): Promise<NativePasskeySigner | PasskeySigner>`,
          description:
            "Signing with Face ID, Touch ID or Windows Hello — no wallet needed. Finds the user's passkey signer for this organization.",
        },
        {
          name: "passkeySigningSupport() · nativePasskeySupport()",
          kind: "functions",
          description: "Whether this browser can sign with a passkey.",
        },
        {
          name: "isUserRejection(error)",
          kind: "function",
          signature: `isUserRejection(error: unknown): boolean`,
          description:
            "True when the user declined in the wallet — show a calm message, not an error.",
        },
      ],
    },
    {
      id: "proofs",
      title: "Proofs (purchases, refunds, consents)",
      importLine: `import { loadProofRequest, confirmProof } from "@stelehq/sdk";`,
      entries: [
        {
          name: "loadProofRequest(options)",
          kind: "function",
          signature: `loadProofRequest({ client, requestId, token }): Promise<VerifiedProofRequest>`,
          description:
            "Loads a request your server created and checks the statement's hash before showing it.",
        },
        {
          name: "confirmProof(options)",
          kind: "function",
          signature: `confirmProof({ client, request, signer, requestDomain, onStatus? }): Promise<ProofResult>`,
          description: "The customer signs the exact statement; it is recorded on Solana.",
        },
      ],
    },
    {
      id: "receipts",
      title: "Receipts",
      entries: [
        {
          name: "downloadAcceptanceReceipt(client, acceptanceId)",
          kind: "function",
          description: "Saves the verified receipt (with the exact text) as a JSON file.",
        },
        {
          name: "verificationLink(appUrl, acceptanceId)",
          kind: "function",
          signature: `verificationLink(appUrl: string, acceptanceId: string): string`,
          description: "A link anyone can open to check the acceptance against Solana.",
        },
      ],
    },
    {
      id: "server",
      title: "Server client & webhooks",
      intro: "Node.js, with an API key from the dashboard. Never ship the key to a browser.",
      importLine: `import { SteleServerClient, verifyWebhook } from "@stelehq/sdk/server";`,
      entries: [
        {
          name: "new SteleServerClient(options)",
          kind: "class",
          signature: `new SteleServerClient({ apiBaseUrl: string; apiKey: string; fetch?: typeof fetch })`,
          description: "Server-to-server client.",
          example: `const stele = new SteleServerClient({ apiBaseUrl: "${api}", apiKey: process.env.STELE_API_KEY! });`,
        },
        {
          name: "createAcceptanceSession(input)",
          kind: "method",
          signature: `createAcceptanceSession({ document?, externalUserRef?, ttlSeconds? }): Promise<{ sessionToken, expiresAt }>`,
          description:
            "Links the next acceptance to your user ID (kept off-chain). Pass sessionToken to the widget or acceptDocument.",
        },
        {
          name: "hasAcceptedLatest(externalUserRef, slug)",
          kind: "method",
          signature: `hasAcceptedLatest(externalUserRef: string, slug: string): Promise<AcceptanceRecord | null>`,
          description:
            "Did this user accept the current version? The check before checkout or sign-up.",
        },
        {
          name: "listAcceptances(query) · getAcceptance(id) · latestVersion(slug)",
          kind: "methods",
          description:
            "Search acceptances by user, document, version, signer or date; one acceptance; the current version of a document.",
        },
        {
          name: "createProofRequest(input) · listProofs() · getProofReceipt(id)",
          kind: "methods",
          description:
            "Ask a customer to confirm a purchase, refund, consent or quote, and read the results.",
        },
        {
          name: "listSigners(ref?) · revokeSigner(publicKey, reason)",
          kind: "methods",
          description: "Passkey signers linked to your users.",
        },
        {
          name: "verifyWebhook(secret, signatureHeader, rawBody)",
          kind: "function",
          signature: `verifyWebhook(secret: string, signatureHeader: string | undefined, rawBody: string | Buffer): WebhookEvent`,
          description:
            "Checks the Stele-Signature header over the raw body (and its age); throws WebhookVerificationError otherwise. Ignore event IDs you have already processed.",
        },
      ],
    },
    {
      id: "verifier",
      title: "Verify independently",
      intro: (
        <>
          <code className="font-mono text-fg">npm install @stelehq/verifier</code> — checks evidence
          against Solana without asking Stele.
        </>
      ),
      importLine: `import { verifyAcceptance, verifyDocumentVersion, verifyProof, chainFromUrls } from "@stelehq/verifier";`,
      entries: [
        {
          name: "verifyAcceptance(input, options)",
          kind: "function",
          signature: `verifyAcceptance(
  { receipt } | { transactionSignature } | { acceptanceId },
  { chain: chainFromUrls(["https://api.devnet.solana.com"]) },
): Promise<VerificationReport>   // { verdict: "VALID" | "VALID_WITH_WARNINGS" | "INVALID" | "INCONCLUSIVE", checks }`,
          description: "Re-checks fingerprint, signature, on-chain record and version history.",
        },
        {
          name: "verifyDocumentVersion · verifyProof",
          kind: "functions",
          description: "The same for a published version and for a proof.",
        },
      ],
    },
  ];
}

export default async function SdkPage() {
  const origin = await siteOrigin();
  return (
    <Reference
      title="SDK reference"
      lead={
        <>
          <code className="font-mono text-fg">@stelehq/sdk</code> for browsers, React and Node.js,
          and <code className="font-mono text-fg">@stelehq/verifier</code>. Step-by-step guides:{" "}
          <Link href="/docs/get-started" className="text-accent">
            Proof
          </Link>{" "}
          ·{" "}
          <Link href="/docs/gate-guide" className="text-accent">
            Gate
          </Link>
          .
        </>
      }
      groups={groups(origin)}
    />
  );
}
