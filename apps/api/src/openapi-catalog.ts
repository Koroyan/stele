/**
 * What the OpenAPI document says about each route: its group (tag), a one-line summary, a
 * description and how it authenticates. Kept apart from the routes so the API reference reads as
 * one document; a route missing here still appears, under "Other".
 *
 * Auth kinds: `public` (no credentials), `apiKey:<scope>` (server-to-server, `Authorization:
 * Bearer stl_…`), `session` (the dashboard's signed-in wallet session — cookie + CSRF header),
 * `proofToken` (the `x-proof-token` header of a proof request).
 */
export interface CatalogEntry {
  tag: string;
  summary: string;
  description?: string;
  auth: "public" | "session" | "proofToken" | `apiKey:${string}`;
}

export const TAGS: { name: string; description: string }[] = [
  {
    name: "Network",
    description: "Which Solana network, program and keys this Stele app uses. Start here.",
  },
  {
    name: "Documents",
    description:
      "Published documents and their exact text. Anyone can read them; the text is checked against its on-chain fingerprint by the SDK and the verifier.",
  },
  {
    name: "Accepting",
    description:
      "The acceptance flow the widget and SDK run in the browser: get a challenge (the exact message to sign), sign it, submit it. The user never pays a fee.",
  },
  {
    name: "Server: acceptances",
    description:
      "For your backend, with an API key: link acceptances to your users and check who accepted what.",
  },
  {
    name: "Verification",
    description:
      "Public evidence: acceptance records, receipts and batches. Every answer can be re-checked against Solana without Stele.",
  },
  {
    name: "Stele Gate",
    description:
      "Has a wallet accepted the version a policy requires? The same answer your Solana program's require_current() gives.",
  },
  {
    name: "Proofs (experimental)",
    description:
      "Experimental. Purchases, refunds, consents and quotes confirmed by your customer's signature: create a request on your server, the customer confirms it in the browser.",
  },
  {
    name: "Passkeys",
    description:
      "Native passkey signing (secp256r1, verified on-chain) used by the widget and SDK (Face ID, Touch ID, Windows Hello). You rarely call these directly.",
  },
  {
    name: "Passkeys (legacy PRF)",
    description:
      "Signers registered before native passkeys: an Ed25519 key encrypted under the passkey's WebAuthn PRF output. Kept so those signers keep working; new signers are native.",
  },
  {
    name: "Server: signers",
    description: "For your backend, with an API key: the passkey signers linked to your users.",
  },
  {
    name: "Dashboard",
    description:
      "What the Stele dashboard calls with a signed-in wallet session (cookie + CSRF header). Listed for completeness; integrations use the endpoints above.",
  },
];

const pub = "public" as const;
const dash = "session" as const;

export const CATALOG: Record<string, CatalogEntry> = {
  // ---- Network -----------------------------------------------------------------------------------
  "GET /v1/network": {
    tag: "Network",
    summary: "This app's network, program and keys",
    description:
      "The Solana network (cluster, chain ID, label), the Stele program ID, the relayer and attestor keys and public RPC endpoints. The SDK checks every answer against these.",
    auth: pub,
  },
  "GET /health": { tag: "Network", summary: "Liveness", auth: pub },
  "GET /ready": {
    tag: "Network",
    summary: "Readiness (database and Solana RPC reachable)",
    auth: pub,
  },

  // ---- Documents ---------------------------------------------------------------------------------
  "GET /v1/public/organizations/:ref": {
    tag: "Documents",
    summary: "An organization",
    description:
      "By on-chain address or verified domain (e.g. acme.com): name, verified domain, signing policy and its documents.",
    auth: pub,
  },
  "GET /v1/public/organizations/:ref/documents/:slug": {
    tag: "Documents",
    summary: "A document and its current version",
    description:
      "The current version's number, label, fingerprint and content hash, the version history, and the document's Gate policy if it has one.",
    auth: pub,
  },
  "GET /v1/public/content/:hash": {
    tag: "Documents",
    summary: "A version's exact text (canonical bytes)",
    description:
      "The canonical bytes whose SHA-256 is the content hash committed on-chain. Hash them yourself to check them.",
    auth: pub,
  },
  "GET /v1/public/content/:hash/parsed": {
    tag: "Documents",
    summary: "A version's text as structured blocks",
    auth: pub,
  },
  "GET /v1/public/versions/:address": {
    tag: "Documents",
    summary: "A published version by its on-chain address",
    auth: pub,
  },

  // ---- Accepting ---------------------------------------------------------------------------------
  "POST /v1/acceptance/challenges": {
    tag: "Accepting",
    summary: "Get the exact message to sign",
    description:
      "Rebuilds the acceptance message from live Solana state for this signer and the document's current version, with a one-time nonce. Returns the message, a challenge ID and a client binding the browser keeps. Refused with 409 already_accepted when this signer already accepted this version.",
    auth: pub,
  },
  "POST /v1/acceptance/challenges/:challengeId/submit": {
    tag: "Accepting",
    summary: "Submit the signature — records the acceptance on Solana",
    description:
      "Verifies the signature over the exact message, then the relayer records it on Solana (paying the fee). Returns the acceptance ID and transaction.",
    auth: pub,
  },
  "GET /v1/acceptance/challenges/:challengeId": {
    tag: "Accepting",
    summary: "A challenge's status",
    auth: pub,
  },

  // ---- Server: acceptances -----------------------------------------------------------------------
  "POST /v1/acceptance-sessions": {
    tag: "Server: acceptances",
    summary: "Link the next acceptance to your user",
    description:
      "Returns a short-lived session token for your user ID; the widget passes it, and the acceptance is linked to that user (off-chain).",
    auth: "apiKey:acceptances:write",
  },
  "GET /v1/acceptances": {
    tag: "Server: acceptances",
    summary: "Search acceptances",
    description: "By your user ID, document, version, signer or date.",
    auth: "apiKey:acceptances:read",
  },
  "GET /v1/acceptances/:acceptanceId": {
    tag: "Server: acceptances",
    summary: "One acceptance, with its receipt URL",
    auth: "apiKey:acceptances:read",
  },
  "GET /v1/documents/by-slug/:slug/latest": {
    tag: "Server: acceptances",
    summary: "The current version of one of your documents",
    auth: "apiKey:documents:read",
  },

  // ---- Verification ------------------------------------------------------------------------------
  "GET /v1/public/acceptances/:acceptanceId": {
    tag: "Verification",
    summary: "A public acceptance record",
    auth: pub,
  },
  "GET /v1/public/acceptances/:acceptanceId/receipt": {
    tag: "Verification",
    summary: "A receipt, verified against Solana",
    description:
      "The portable receipt (with the exact text) and Stele's verification report. Re-check it yourself with @stelehq/verifier.",
    auth: pub,
  },
  "GET /v1/public/transactions/:signature/acceptance": {
    tag: "Verification",
    summary: "The acceptance recorded by a Solana transaction",
    auth: pub,
  },
  "GET /v1/public/batches/:root": {
    tag: "Verification",
    summary: "A batch of acceptances anchored under one Merkle root",
    auth: pub,
  },
  "GET /v1/public/signers/:publicKey": {
    tag: "Verification",
    summary: "A passkey signer's public enrollment",
    auth: pub,
  },

  // ---- Stele Gate --------------------------------------------------------------------------------
  "GET /v1/public/gate/access": {
    tag: "Stele Gate",
    summary: "Has this wallet accepted the version a policy requires?",
    description:
      "Status VALID, MISSING or OUTDATED, read from the AccessPass and policy accounts on Solana, with the pass address your program reads. For your interface — your program's require_current() is what enforces it.",
    auth: pub,
  },

  // ---- Proofs ------------------------------------------------------------------------------------
  "POST /v1/proof-requests": {
    tag: "Proofs (experimental)",
    summary: "Create a proof request (purchase, refund, consent, quote)",
    description:
      "Your server describes what the customer confirms; Stele returns a request ID and token for the confirmation page or widget.",
    auth: "apiKey:proofs:write",
  },
  "GET /v1/proof-requests/:id": {
    tag: "Proofs (experimental)",
    summary: "A proof request, as the customer sees it",
    auth: "proofToken",
  },
  "POST /v1/proof-requests/:id/challenge": {
    tag: "Proofs (experimental)",
    summary: "Get the exact statement to sign",
    auth: "proofToken",
  },
  "POST /v1/proof-requests/:id/submit": {
    tag: "Proofs (experimental)",
    summary: "Submit the customer's signature — records the proof",
    auth: "proofToken",
  },
  "GET /v1/proof-requests/:id/receipt": {
    tag: "Proofs (experimental)",
    summary: "A confirmed proof's receipt",
    auth: "proofToken",
  },
  "GET /v1/proofs": {
    tag: "Proofs (experimental)",
    summary: "Search confirmed proofs",
    auth: "apiKey:proofs:read",
  },
  "GET /v1/proofs/:proofId": {
    tag: "Proofs (experimental)",
    summary: "One proof",
    auth: "apiKey:proofs:read",
  },
  "GET /v1/proofs/:proofId/receipt": {
    tag: "Proofs (experimental)",
    summary: "One proof's receipt",
    auth: "apiKey:proofs:read",
  },

  // ---- Passkeys ----------------------------------------------------------------------------------
  "POST /v1/passkeys/options": {
    tag: "Passkeys (legacy PRF)",
    summary: "Passkey registration options",
    auth: pub,
  },
  "POST /v1/passkeys/register": {
    tag: "Passkeys (legacy PRF)",
    summary: "Register a passkey signer",
    auth: pub,
  },
  "POST /v1/passkeys/identify": {
    tag: "Passkeys (legacy PRF)",
    summary: "Find a returning signer",
    auth: pub,
  },
  "POST /v1/passkeys/key-material": {
    tag: "Passkeys (legacy PRF)",
    summary: "Encrypted key material for a passkey-protected signer",
    auth: pub,
  },
  "POST /v1/passkeys/recovery-kits": {
    tag: "Passkeys (legacy PRF)",
    summary: "Store a recovery kit",
    auth: pub,
  },
  "POST /v1/passkeys/recovery-kits/lookup": {
    tag: "Passkeys (legacy PRF)",
    summary: "Look up a recovery kit",
    auth: pub,
  },
  "POST /v1/passkeys/revoke": { tag: "Passkeys", summary: "Revoke a passkey signer", auth: pub },
  "POST /v1/passkeys/native/options": {
    tag: "Passkeys",
    summary: "Native (P-256) passkey options",
    auth: pub,
  },
  "POST /v1/passkeys/native/register": {
    tag: "Passkeys",
    summary: "Register a native passkey",
    auth: pub,
  },
  "POST /v1/passkeys/native/confirm": {
    tag: "Passkeys",
    summary: "Confirm a native passkey enrollment",
    auth: pub,
  },
  "POST /v1/passkeys/native/identify": {
    tag: "Passkeys",
    summary: "Find a returning native passkey",
    auth: pub,
  },

  // ---- Server: signers ---------------------------------------------------------------------------
  "GET /v1/signer-identities": {
    tag: "Server: signers",
    summary: "Passkey signers linked to your users",
    auth: "apiKey:signers:read",
  },
  "POST /v1/signer-identities/:publicKey/revoke": {
    tag: "Server: signers",
    summary: "Revoke a user's signer",
    auth: "apiKey:signers:write",
  },
};

/** Routes that are not part of the API reference (demo plumbing, the document itself). */
export const HIDDEN = new Set([
  "GET /v1/openapi.json",
  "GET /v1/demo",
  "POST /v1/demo/sessions",
  "POST /v1/demo/sessions/current",
  "POST /v1/demo/sessions/publish",
  "POST /v1/demo/sessions/deposit",
]);

/** Everything else lives behind the dashboard's signed-in session. */
export function describeRoute(method: string, url: string): CatalogEntry | "hidden" {
  const key = `${method} ${url}`;
  if (HIDDEN.has(key)) return "hidden";
  const known = CATALOG[key];
  if (known) return known;
  const words = url
    .replace(/^\/v1\//, "")
    .split("/")
    .filter((w) => !w.startsWith(":"))
    .join(" ")
    .replace(/-/g, " ");
  const verb = { GET: "Get", POST: "Create or run", PATCH: "Update", DELETE: "Delete" }[method];
  return { tag: "Dashboard", summary: `${verb ?? method} ${words}`.trim(), auth: dash };
}
