# Security architecture

Stele's central security property is that **recorded evidence does not depend on trusting Stele's
servers**. The program, the ledger, SHA-256, Ed25519 and P-256 are the trust anchors; the API,
database, indexer, relayer and web app are conveniences whose compromise can deny service but cannot
sign for a key they do not hold, or alter or back-date evidence that passes the verifier. Two things
remain trusted to whoever runs them — what the signing page displays, and which key is first enrolled
for an account; the [trust model](trust-model.md) explains both. This page describes the controls at each layer. The scenario-by-scenario analysis
is in the [threat model](threat-model.md).

## Security properties

| # | Property | Mechanism |
|---|---|---|
| P1 | Published versions cannot change | No update or close instruction for `DocumentVersion`; fingerprints computed on-chain |
| P2 | History cannot be hidden or reordered | Each version commits to its predecessor's fingerprint; the head is stored on the document |
| P3 | Users sign exactly what they were shown | Hash-verified display; the message is rebuilt locally and on-chain; wallets show the text |
| P4 | Acceptances cannot be forged | The program verifies the Ed25519 signature itself, with strict instruction introspection |
| P5 | Acceptances cannot be replayed | Single-use nonce bits, validity windows on cluster time, network-bound messages |
| P6 | Only authorized keys publish | On-chain roles; multisig owners; key-compromise reports |
| P7 | Identity claims are explicit | Verified domains via DNS + on-chain attestation; display names never trusted |
| P8 | Independent verifiability | Open verifier; multiple RPCs must agree; receipts are claims re-checked in full |
| P9 | No personal data on-chain | Only public keys, hashes, timestamps and hostnames |
| P10 | Off-chain tampering is detectable | Hash-chained, append-only audit log; the database is rebuildable from the chain |

## On-chain program

- **Account validation** through Anchor constraints: owners, discriminators, PDA seeds and bumps,
  `has_one` relations, signer and writable checks on every account.
- **Authority** resolved from on-chain state only (`authorize`, `require_owner`); admins cannot manage
  admins; recovery-lock suspends owner powers.
- **Fingerprint integrity:** the program builds the version JSON and hashes it; the publisher's
  `expected_version_hash` must match. The version number must be `version_count + 1` and the
  predecessor must equal the document head, so concurrent publications cannot fork the chain.
- **Signature verification:** `record_acceptance` must be a top-level instruction, immediately
  preceded by an Ed25519 instruction with the canonical single-signature layout and all offsets pointing
  inside that instruction (`0xFFFF` indices). This defeats offset-indirection attacks in which the
  verified bytes differ from the bytes the program reads.
- **Message binding:** lines 1–11 of the message are rebuilt from accounts and arguments; the requesting
  site is validated as a hostname.
- **Replay protection:** nonce bits in zero-copy bitmaps; checked arithmetic; validity windows against
  the Clock sysvar, never client time.
- **Effective dates** cannot be in the past and are limited to five years ahead.
- **Pause and freeze** switches with narrow scopes; the protocol admin cannot modify organization data.
- **Immutability of layouts:** fixed-size fields first, strings last; never reordered.
- **Build:** `overflow-checks = true` in release; clippy correctness/suspicious lints are errors in CI;
  LiteSVM tests run against the compiled `.so`, including adversarial cases: forged signatures,
  Ed25519 layout and ordering attacks, replay, reuse across versions, documents, organizations and
  networks, tampered message fields and line injection, unauthorized signers and relayers, front-run
  organization creation, a spoofed instructions sysvar, invocation through another program (CPI,
  using the test-only forwarder in `tests/programs/cpi-probe`), frozen and paused states, and invalid
  inputs. Rust dependencies are pinned by the committed `Cargo.lock`; CI builds with `--locked`.

## Cryptography

| Use | Construction |
|---|---|
| Content commitment | SHA-256 over canonical bytes (`stele-canonical-v1`) |
| Version fingerprint | SHA-256 over canonical version JSON (format-tagged) |
| User signatures | Ed25519 (RFC 8032), strict verification (no ZIP-215 leniency) off-chain; Solana's Ed25519 program on-chain |
| Acceptance ID, accumulator | SHA-256 with protocol tags `stele:v1:acceptance\0`, `stele:v1:accumulator\0` |
| Network separation | CAIP-2 chain ID (genesis-derived) in fingerprints; network label in messages |
| Sessions, API keys | 256-bit random tokens; only SHA-256 digests stored; constant-time comparison |
| Webhook signatures | HMAC-SHA256 over `timestamp.body`; secrets encrypted at rest with AES-256-GCM |
| Stored idempotent responses | AES-256-GCM |
| IP addresses | Rate limits and sessions: HMAC-SHA256 with a server secret. Acceptance audit trail: AES-256-GCM (see below) |

No custom cryptography; all primitives come from audited libraries (`@noble/curves`,
`@noble/hashes`, Node's `crypto`, Solana's runtime).

## API

- **Input validation:** every route has a schema (zod): types, formats and sizes are checked, unknown
  fields are dropped before handlers see them, and the request body limit is 3 MB.
- **Authentication:** wallet sign-in with single-use nonces; session rotation on sign-in (no fixation);
  idle and absolute expiry; `HttpOnly`, `SameSite=Lax`, `__Host-` + `Secure` cookies in production.
- **CSRF:** allowed-origin check plus a per-session CSRF token on every cookie-authenticated write.
- **Authorization:** organization roles from the chain-mirrored membership; organizations the caller
  cannot see return 404 (no existence leaks); step-up re-authentication for credentials and policy.
- **API keys:** prefixed, scoped, expiring, revocable, hashed; cannot act on-chain.
- **CORS:** public endpoints allow any origin **without** credentials; credentialed endpoints only the
  app's origins.
- **Rate limiting:** global and per-route limits; a cap on open acceptance challenges per
  organization prevents nonce-exhaustion attacks.
- **Idempotency keys** for safe retries, scoped per caller, encrypted at rest.
- **SSRF:** webhook URLs must be HTTPS to public addresses; DNS is resolved and the connection pinned to
  the vetted IP (no DNS rebinding); redirects are not followed; responses are size-limited.
- **Errors** never include stack traces or internal details; they carry stable codes.
- **Headers:** strict security headers on every response (`default-src 'none'` CSP for JSON, no
  sniffing, no referrer, HSTS in production).
- **Logging:** structured logs with request IDs; authorization headers, cookies, tokens and secrets are
  redacted; signatures are not logged.
- **Trust in the chain, not the client:** organizations, documents, versions, shards and acceptances
  are written to the database only after the API reads them back from Solana.

## Web application

- **Content Security Policy** with a per-request nonce and `'strict-dynamic'`; no `'unsafe-eval'` in
  production; `frame-ancestors 'none'`; `base-uri 'none'`; `object-src 'none'`; `form-action 'self'`;
  `connect-src` limited to the site and the configured RPC endpoints (the verifier pages may also reach
  HTTPS endpoints the user chooses).
- **No HTML from data:** document text, names and Markdown are rendered as text nodes; raw HTML in
  Markdown is skipped; `dangerouslySetInnerHTML` is banned by lint.
- **Verified rendering:** acceptance, receipt and dashboard pages hash content in the browser before
  displaying it, and verify receipts locally.
- **Anti-phishing UX:** the verified-domain badge is the only use of the "verified" colour; unverified
  organizations get a prominent warning; the requesting site is shown before signing; the sign-in
  message is distinct from acceptance messages and checked before the wallet is asked to sign.
- **Wallets:** Wallet Standard only; the app never sees private keys or seed phrases and never asks
  for them; transactions are simulated before the wallet prompt, and the wallet signs exact bytes.
- **Pinning:** program ID, chain ID and RPC endpoints can be pinned at build time and are compared with
  what the API advertises.
- **Redirects:** post-login destinations must be same-site relative paths (no open redirects).
- **Headers:** `X-Frame-Options: DENY`, `nosniff`, a strict `Permissions-Policy`, CORP, COOP, HSTS.

## PDF receipts

- **Rendering:** the API builds the certificate as HTML in which every value (document text, names,
  addresses) is HTML-escaped, and Chromium renders it in the separate `pdf-renderer` container. The
  page has JavaScript disabled and every network request is blocked; the container has no internet
  access (internal Docker network), runs as an unprivileged user with a read-only filesystem, no
  capabilities and a memory limit.
- **Not evidence:** the PDF's visible text is a readable copy. The original JSON receipt is attached
  inside, and the Verify page verifies only that receipt, against Solana. Editing the PDF's text
  cannot change a verification result.
- **Audit trail:** public certificates show the signer's time zone only; the IP address appears on
  the signer's own certificate (proven by the acceptance's client binding) and the organization's.

## Data protection

- **Never stored:** private keys, seed phrases, plaintext API keys or session tokens.
- **Acceptance audit trail:** when a signature is submitted, the API records the IP address it came
  from (encrypted with AES-256-GCM) and the browser's time zone, off-chain, next to the acceptance.
  Only the organization sees the IP (dashboard, API, CSV export) and the signer sees it on their own
  PDF receipt; public receipts show the time zone only. It is never written on-chain and is not
  evidence the verifier checks.
- **Encrypted at rest:** webhook secrets, stored idempotent responses, acceptance IP addresses
  (application layer), plus database and bucket encryption at the infrastructure layer.
- **Minimized:** wallet addresses are pseudonymous; integrators' user references stay off-chain;
  member labels stay off-chain.
- **Audit log:** append-only (a database trigger rejects updates and deletes) and hash-chained per
  organization; the head hash can be recorded externally to detect a wholesale rewrite.

## Software supply chain

- Dependencies are pinned and checked against vulnerability advisories on every change.
- Program builds are reproducible: anyone can rebuild the published source and check that it matches
  the program deployed on Solana.

## Walletless signing

- Passkey signers sign with the passkey's own secp256r1 key, which never leaves the device; Solana
  verifies each signature on-chain. Stele holds no signing key for them. (Signers enrolled earlier
  keep an Ed25519 key that Stele stores only as AES-256-GCM ciphertext under the passkey's WebAuthn
  PRF output; Stele cannot decrypt it.)
- Every signature by a passkey signer needs a user-verified passkey assertion over that exact message
  on the requesting site; Stele refuses to record it otherwise, and receipts carry the assertion.
- Adding a passkey or recovery kit requires a statement signed by the key itself. Account access alone
  (email, password) never grants control of a key. Lost keys are replaced by new, flagged keys.
- No passkey support, no passkey signing: there is no downgrade to a server-held key.

## Fee sponsorship

- Users sign messages, never transactions, and never pay fees. Stele's relayer pays and signs only the
  exact recording transaction shape (checked before every signature).
- An organization can sponsor fees from its nonce shard, a program-owned account with no private key.
  The program reimburses only the designated relayer, only the exact fee of a verified recording,
  within per-record and daily caps; only the organization owner can withdraw.

## Keys Stele operates

- Program upgrades and protocol administration require multisig approval.
- The service keys that relay acceptances and attest domains hold only the power they need. Neither
  can create, alter or back-date documents or acceptances: a relayer can only submit acceptances that
  users signed, or fail to submit them. The domain attestor vouches for domains after a DNS check; if
  its key were stolen it could attest a domain falsely until the key is rotated, which is why
  attestations expire and verifiers can re-check a domain's DNS record live.
- Stele continuously checks the health of relaying, acceptance capacity and the integrity of its own
  records, and watches for unexpected program upgrades.

## Residual risks

Some risks cannot be eliminated by software and are accepted explicitly:

- **Wallet software** must display messages faithfully and protect keys.
- **A user may not read** what they sign; the protocol records consent to exact text, not
  comprehension.
- **Key ≠ person:** a signature proves control of a key, not legal identity.
- **DNS** is the root of domain verification; a hijacked domain can be attested until detected.
- **History availability** depends on archival RPC providers or retained receipts.
- **Solana** liveness and finality are assumed.
- **Synced passkeys** are as safe as the platform account (Apple, Google, password manager) they sync
  with.
- **Account recovery** by an organization yields a new key for the account, visibly — never the old
  key.

The [threat model](threat-model.md#residual-risks) lists them with their mitigations.

## Reporting vulnerabilities

See the [security policy](../SECURITY.md).
