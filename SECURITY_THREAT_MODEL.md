# Stele — Security Threat Model

> **Internal documentation.** Repository only: not published on the website. The public
> summary is [docs/threat-model.md](docs/threat-model.md).

Version 1.2 · Protocols `stele/1`, `stele/2` · Status: normative (§6 added with walletless signing,
fee sponsorship and proofs; §7 with native passkeys, batched evidence and the security review)

This document attacks the system from every relevant angle **before** and **while** it is built.
Every protocol decision was tested against one question:

> *If both the company **and** our own backend become malicious, what evidence can an independent
> third party still verify?*

The answer this design aims for: **everything that matters** — what content existed, which version
it belonged to, when it was published and by which authorized key, which signing key accepted which
exact version, and when — remains verifiable from Solana and content hashes alone.

---

## 1. Scope

### 1.1 Assets

| ID | Asset | Why it matters |
|---|---|---|
| AS1 | Document version history (content + metadata + order) | The thing being proven |
| AS2 | Acceptance evidence (signed message, signature, recording tx) | Proves authorization by a key |
| AS3 | Organization identity (owner, members, verified domain) | Attributes publications |
| AS4 | Protocol configuration and program code | Enforces every invariant |
| AS5 | User private keys | Root of acceptance authority (never touched by Stele) |
| AS6 | Organization authority keys / multisig | Root of publication authority |
| AS7 | Relayer, attestor, protocol-admin keys | Operational authorities with bounded power |
| AS8 | Platform secrets (session tokens, API keys, webhook secrets, encryption keys) | Access to the convenience layer |
| AS9 | Personal data (emails, external user references, IP-derived data) | Privacy, regulation |
| AS10 | Availability of relaying, indexing, storage, verification | Business continuity |

### 1.2 Security properties

| ID | Property |
|---|---|
| **P1 Immutability** | A published version's content commitment, metadata, number, predecessor and publication time can never change. |
| **P2 Chain integrity** | Version *n* commits to the fingerprint of version *n−1*; the program refuses any other predecessor; gaps and forks are impossible. |
| **P3 Publication authorization** | A version exists only if the organization's owner or an active on-chain publisher authorized it at publication time. |
| **P4 Acceptance authenticity** | An acceptance record exists only if the named key signed the exact protocol message for that exact version. |
| **P5 Exact binding** | An acceptance signature is valid for exactly one (network, program, organization, document, version, fingerprint, signer, nonce, window, action, protocol version). |
| **P6 Non-replay** | A signed acceptance can be recorded at most once, and never after its expiry. |
| **P7 Temporal honesty** | All authoritative times come from the cluster clock; effective dates cannot precede publication. |
| **P8 Independent verifiability** | All of the above can be checked without trusting Stele's frontend, backend, database or storage. |
| **P9 Explicit intent** | A user is never asked to sign an opaque value; the signed text names what is being accepted. |
| **P10 Honest semantics** | The system never presents key authorization as proof of human identity or comprehension. |

### 1.3 Trust assumptions (explicit)

| ID | Assumption | If violated |
|---|---|---|
| TA1 | Solana consensus is safe (no successful rewrite of finalized history) | All on-chain evidence is weakened; no blockchain system survives this |
| TA2 | SHA-256 is collision- and second-preimage-resistant | Content substitution becomes possible |
| TA3 | Ed25519 (RFC 8032, strict verification) is unforgeable | Acceptance forgery becomes possible |
| TA4 | The deployed program matches the audited source (verifiable build) and its upgrade authority is a time-locked multisig, or the program is immutable | A malicious upgrade could rewrite account state (see A01 for detection) |
| TA5 | At least one RPC endpoint consulted by a verifier is honest | A verifier querying only colluding RPCs can be shown false data |
| TA6 | The user's wallet displays the message it signs | A malicious wallet can sign anything (out of scope) |
| TA7 | The domain attestor checked DNS honestly at attestation time | A false "verified" badge; mitigated by live re-check (T14) |
| TA8 | The cluster `unix_timestamp` is within minutes of real time | Timestamps skew; bounded by stake-weighted median design |

### 1.4 Attacker profiles

| Attacker | Capabilities assumed | Primary scenarios |
|---|---|---|
| Malicious company | Controls its org keys, its website, its users' UX, may collude with others | T01–T10, T13, T56–T58, A09, A13 |
| Malicious employee | Holds a publisher or admin key; may act outside policy | T11, T12, T41 |
| Compromised company administrator | Attacker holds an admin or owner key | T11, T38–T41 |
| Malicious user | Accepted genuinely, later wants to deny | T15, T16, T53 |
| Compromised user account / stolen wallet / stolen device | Attacker holds user key | T16, T35, T36 |
| Fake user / bot / Sybil | Unlimited keypairs, automation | T54, T55, A07 |
| Malicious frontend operator | Serves arbitrary JS from our domain | T19, T20, T42, T58 |
| Compromised backend | Full control of API, relayer key, DB | T18, T29–T31, T49–T52 |
| Malicious database administrator | Arbitrary DB writes | T30, T31, T59 |
| API attacker | Arbitrary HTTP requests, stolen keys/tokens | T29, T45, A17–A19 |
| Phishing site | Lookalike domain, can request signatures | T20, T26–T28, A05 |
| Malicious browser extension | Reads/modifies page DOM, injects requests | T19, T46 |
| Replay attacker | Holds previously signed messages | T21–T26 |
| Man-in-the-middle | Network position between components | T29, A16 |
| Compromised RPC provider | Returns arbitrary responses | T32, T59 |
| Compromised storage provider | Returns arbitrary bytes / deletes | T5, T6, T33, T34 |
| Malicious third-party integrator | Embeds SDK, controls host page | T2, T20, A12 |
| Malicious signer (multisig member) | One of N keys | T40 |
| Leaked API key / session token | Bearer access to convenience layer | T44, T45 |
| XSS / CSRF attacker | Script injection / cross-site requests | A10, A11 |
| Supply-chain attacker | Compromises a dependency or build | A14 |

---

## 2. Scenario analysis

Format for every scenario: **Attack** · **Impact** · **Defense** · **Detection** · **Recovery** ·
**Residual risk**. Section references point to [PROTOCOL_SPEC.md](PROTOCOL_SPEC.md).

### Document integrity (malicious company)

#### T01 — Company changes the ToS after users accepted it
- **Attack:** Edit the text of version 3 after 10,000 users accepted it, then present the edited
  text as "what you agreed to".
- **Impact:** Users bound to terms they never saw.
- **Defense:** `DocumentVersion` accounts have no update or close instruction (P1). The user signed
  the version fingerprint, which commits to `content_hash = SHA-256(canonical content)`. Edited
  content produces a different hash, which matches neither the account nor the signed message. The
  receipt bundle embeds the exact content the user accepted.
- **Detection:** Any verifier re-hashes presented content; mismatch → `content.integrity: FAIL`.
- **Recovery:** Nothing to recover — the original version remains on-chain. A legitimate change is a
  new version, which users must accept separately.
- **Residual risk:** If *every* copy of the original content (storage mirrors, receipts, the company's
  copy) were destroyed, the hash would still prove that the presented text is *not* the accepted
  one, but the original wording could not be shown. Mitigated by embedding content in receipts and
  mirroring (§T06).

#### T02 — Company displays one document but commits another hash
- **Attack:** Render friendly text in the company's own UI while committing harsher text on-chain;
  or commit text A and serve text B from the storage URL.
- **Impact:** Users accept text they did not see.
- **Defense:** (1) Stele's acceptance page and SDK component render **only content whose SHA-256 the
  browser recomputed and matched against the on-chain account**; mismatch blocks signing. (2) The
  wallet message carries the fingerprint, document title and version label, so the acceptance binds
  to the committed version regardless of what any page displayed. (3) Third-party integrators cannot
  inject display text into the official component.
- **Detection:** In-browser hash check; verifier re-hash; receipts embed the committed content, so a
  user can later show exactly what the commitment contains.
- **Recovery:** The record still proves *which* version was accepted; disputes about presentation
  are resolved with the committed text, which is unfavourable to a company that displayed something
  else.
- **Residual risk:** A company that builds its **own** UI (not Stele's component) can display
  anything before invoking signing. The signed message still names the fingerprint; we document
  that integrators must render hash-verified content and we publish a conformance checklist.

#### T03 — Company creates a second, similar document and claims it was the accepted one
- **Attack:** Publish "Terms of Service" in a second document (or a later version) with near-identical
  text, then claim users accepted that one.
- **Impact:** Substituted obligations.
- **Defense:** Acceptance binds to an exact `DocumentVersion` via its fingerprint, which commits to
  organization address, document address, version number, previous fingerprint, title, label,
  locale, type, effective date, network and program. Two documents can never share a fingerprint.
  The verifier displays the exact document address and version.
- **Detection:** Verifier shows the bound document/version; a different claimed document produces
  `message.binding: FAIL`.
- **Recovery:** N/A — the claim is falsifiable on its face.
- **Residual risk:** None cryptographic. Human confusion between similarly titled documents is
  reduced by showing slugs, addresses and fingerprints in receipts.

#### T04 — Formatting / encoding / whitespace tricks to create ambiguous hashes
- **Attack:** Produce two byte-different encodings of "the same" document (CRLF vs LF, NFD vs NFC,
  trailing spaces, zero-width characters, BOM, JSON key order) so that hashes become arguable.
- **Impact:** Disputes about which bytes "are" the document; inability to reproduce hashes.
- **Defense:** `stele-canonical-v1` (§4): strict UTF-8, BOM stripped, CRLF/CR → LF, NFC, tabs → space,
  per-line trim, space-run collapse, forbidden invisible/bidi/control code points rejected, typed
  block model (no HTML), RFC 8785 JCS serialization, no floats. The canonical bytes *are* the
  stored artifact; verifiers additionally check canonical form (parse → re-serialize → byte-equal).
  Shared test vectors are enforced in both Rust and TypeScript CI.
- **Detection:** `content.canonical: FAIL` if stored bytes are not in canonical form.
- **Recovery:** Re-canonicalize and publish as a new version (old versions are unaffected).
- **Residual risk:** Visually confusable but distinct characters (e.g. Latin "a" vs Cyrillic "а")
  hash differently by design; they are different text. The UI does not claim visual uniqueness.

#### T05 — Company changes the content at an external URL after publishing the hash
- **Attack:** Replace the file behind the storage URI.
- **Impact:** Viewers see altered text.
- **Defense:** Storage is content-addressed by SHA-256; every reader (browser, verifier, indexer,
  API) re-hashes before use and refuses mismatches. The on-chain `storage_uri` is a *hint*; the hash
  is the authority. Arweave URIs are themselves immutable.
- **Detection:** `content.integrity: FAIL (storage returned different content)` with both hashes.
- **Recovery:** Fetch from another mirror or from a receipt bundle; report the bad mirror.
- **Residual risk:** Availability only (see T06/T34).

#### T06 — Company deletes the original file
- **Attack:** Delete content from all company-controlled storage.
- **Impact:** Hard to show the original wording.
- **Defense:** Redundant storage: Stele archive (object storage) + optional Arweave permanent copy +
  database copy; **receipts embed the full canonical content**; users can download proof bundles.
  Deletion cannot alter the on-chain commitment.
- **Detection:** Storage health checks; verifier reports `INCONCLUSIVE` (never "valid") when
  content is unavailable.
- **Recovery:** Restore from any copy whose hash matches.
- **Residual risk:** If all copies vanish, the commitment proves only what the content was *not*.

#### T07 — Company changes metadata while keeping the text similar
- **Attack:** Change title, effective date, locale, or version label to alter meaning while keeping
  the body.
- **Impact:** Misleading context ("effective next year", different locale).
- **Defense:** All metadata is inside the version fingerprint, computed **on-chain** from the
  account's own fields; metadata cannot change after publication. Any metadata change is a new
  version with a new fingerprint.
- **Detection:** Verifier recomputes the version JSON from on-chain fields.
- **Recovery:** N/A.
- **Residual risk:** None.

#### T08 — Company backdates a ToS
- **Attack:** Claim version 4 was published in January when it was published in June.
- **Impact:** Retroactive obligations.
- **Defense:** `published_at`/`published_slot` are written by the program from the cluster clock;
  clients cannot supply them. `effective_at` must be `0` ("upon publication") or ≥ the publication
  block time; the program rejects backdated effective dates (P7).
- **Detection:** Verifier displays chain time; a claimed date earlier than chain time is refuted.
- **Recovery:** N/A.
- **Residual risk:** The cluster clock may deviate from real time by seconds to minutes (TA8).

#### T09 — Company claims a document existed earlier than it did
- **Attack:** "This clause has been in our terms since 2023."
- **Impact:** Users misled about history.
- **Defense:** The earliest provable existence of content is the publication time of the first
  version committing to it. The full chain from v1 is public, so the first appearance of any text
  can be located by diffing versions.
- **Detection:** Version timeline and diffs (UI + verifier) show when text first appeared.
- **Recovery:** N/A.
- **Residual risk:** Content published *outside* Stele before onboarding cannot be proven by Stele.

#### T10 — Company publishes many versions rapidly to create ambiguity
- **Attack:** Publish v5, v6, v7 within minutes so users cannot tell what they accepted.
- **Impact:** Confusion; acceptance of a version superseded seconds later.
- **Defense:** Every acceptance binds to an exact fingerprint. The program only records acceptance
  of the **current** version of a document; in-flight acceptances of a superseded version fail and
  the user must re-review. Each version has a distinct number, slot and fingerprint.
- **Detection:** Timeline highlights versions superseded within a short interval; verifier reports
  the next version's publication slot relative to each acceptance.
- **Recovery:** N/A.
- **Residual risk:** Rapid publication is visible but not prohibited; it is a business-conduct
  signal, not a cryptographic failure.

### Organization authority

#### T11 — Company administrator account is compromised
- **Attack:** Attacker steals an admin's key (or dashboard session) and adds a rogue publisher.
- **Impact:** Unauthorized members; possibly unauthorized publications.
- **Defense:** Admins cannot grant ADMIN or touch other admins (owner-only). Dashboard sessions
  cannot sign transactions — every on-chain change requires the key itself. Membership changes emit
  events and audit entries; all org members are notified. Owner should be a Squads multisig.
- **Detection:** Member-change alerts (email/webhook), audit log, on-chain events monitored by the
  indexer.
- **Recovery:** Owner freezes the org (stops publications **and** acceptances immediately), revokes
  the admin and rogue members, reports key compromise with a `compromised_since` time, then
  publishes a corrective version and unfreezes.
- **Residual risk:** Between compromise and freeze, a rogue publisher could publish a version.
  It is attributable to a key the org later flags as compromised; verifiers warn on it.

#### T12 — Employee publishes an unauthorized ToS
- **Attack:** A publisher-role employee publishes a version outside internal policy.
- **Impact:** A real, attributable, but unapproved version.
- **Defense:** Least privilege (separate PUBLISHER role); orgs requiring approval set the owner to a
  Squads multisig and grant PUBLISHER to no individual — publication then needs N-of-M approval.
  Every version records `publisher` and `publisher_role`.
- **Detection:** Publication notifications to all admins; webhooks `document.version_published`.
- **Recovery:** Publish a corrective version immediately (it supersedes; acceptances of the bad
  version stop). The bad version stays visible as history.
- **Residual risk:** Insider abuse within granted permissions is not preventable cryptographically —
  only attributable.

#### T13 — One company impersonates another
- **Attack:** Register an organization named "Stripe" and publish "Stripe Terms".
- **Impact:** Users accept a fake company's terms believing they are Stripe's.
- **Defense:** Display name ≠ identity. The acceptance message itself states
  `Organization: Stripe (unverified)` unless a **domain attestation** exists. Verified domains are
  unique on-chain (`DomainRecord` PDA keyed by the domain hash); URLs use the verified domain
  (`/accept/stripe.com/terms`). The UI shows an "Unverified organization" warning and flags names
  matching a protected-brand list for manual review.
- **Detection:** Brand-list monitoring; user reports; verifier shows verification status.
- **Recovery:** Platform suspends the listing (UI) — it cannot and does not delete on-chain data;
  verified-domain mismatch remains visible forever.
- **Residual risk:** Users may ignore "unverified" warnings.

#### T14 — Fake company registers a famous domain or brand lookalike
- **Attack:** Verify `stripe-payments.com` or an IDN homograph such as `strіpe.com` (Cyrillic і).
- **Impact:** A genuinely "verified" but misleading domain.
- **Defense:** Only lowercase ASCII LDH hostnames are accepted; IDNs must be in punycode
  (`xn--…`) and are displayed as such, which defeats homographs. Verification proves control of the
  exact domain shown — never brand ownership. High-profile brand similarity triggers manual KYB
  review before attestation. Live DNS re-check is available to any verifier.
- **Detection:** Similarity scoring on attestation requests; monitoring.
- **Recovery:** Attestor revokes the attestation (closes the `DomainRecord`, clears the org field);
  future acceptance messages then say "(unverified)".
- **Residual risk:** Legitimately owned lookalike domains (`stripe-payments.com`) can be verified.
  The UI always shows the exact domain, never a brand label.

### User disputes

#### T15 — User claims "I never accepted this"
- **Attack:** A user who genuinely accepted denies it.
- **Impact:** Company cannot enforce terms.
- **Defense:** The record contains the user's Ed25519 signature over a message naming the
  organization, document, version, fingerprint, the user's own account, the network and validity
  window — verified on-chain by the native Ed25519 program and re-verifiable by anyone. The message
  was displayed by the user's wallet, not by us.
- **Detection:** N/A.
- **Recovery:** Produce the receipt; anyone verifies it.
- **Residual risk:** The evidence proves **the key** authorized acceptance, not that the user
  personally did. The user may claim key theft (T16, T35); that becomes a question of key custody,
  which the company may supplement with its own authentication logs (linked off-chain via
  `external_user_ref`).

#### T16 — User claims "someone else accepted this for me"
- **Attack/claim:** Shared device, malware, a family member, a coerced signature.
- **Impact:** Attribution dispute.
- **Defense:** We never claim human identity (P10). Receipts state: "This signing credential
  authorized the acceptance." Organizations needing identity assurance combine Stele with
  authenticated sessions; the challenge can be bound to their session (`acceptance session token`)
  and their user ID (kept off-chain).
- **Detection:** Out of band (device/session logs held by the company).
- **Recovery:** Company policy; the user can accept a corrected version later.
- **Residual risk:** Inherent to all signature systems.

#### T17 — Creating an acceptance using another user's wallet address
- **Attack:** Submit an acceptance naming someone else's public key without their signature.
- **Impact:** Forged acceptance.
- **Defense:** The program reads the signer **from the Ed25519 instruction that the runtime verified**
  and requires the message's `Account:` line to equal it. Without the private key, no valid
  signature exists (TA3). The program also requires the Ed25519 instruction to be the immediately
  preceding top-level instruction, in canonical self-contained layout.
- **Detection:** Impossible to succeed; failed attempts appear as failed transactions (relayer
  rejects earlier: it verifies signatures before submitting).
- **Recovery:** N/A.
- **Residual risk:** None beyond TA3.

#### T18 — Backend creates an acceptance without the user signing
- **Attack:** A compromised Stele backend fabricates acceptances.
- **Impact:** Forged evidence at scale.
- **Defense:** Same as T17: the backend holds no user keys. The relayer key only pays fees and
  satisfies the shard's relayer check. The database cannot create on-chain evidence; verifiers never
  trust database rows.
- **Detection:** Verifier: any "acceptance" without a valid on-chain transaction is `INVALID`.
- **Recovery:** Rotate the relayer key; purge forged DB rows by re-indexing from chain.
- **Residual risk:** None for evidence. A compromised backend can lie in *dashboards* until an
  independent verification is run.

#### T19 — Frontend modifies the payload before signing
- **Attack:** Malicious JS (compromised frontend or extension) alters the message, e.g. swapping the
  version.
- **Impact:** User signs something other than intended.
- **Defense:** The wallet — not our page — displays the full message text, including organization,
  document, version and fingerprint. The program accepts only messages that exactly match an
  on-chain version, so the worst case is acceptance of a *different real version*, which is named
  in the text the user saw. The page also re-derives the message from on-chain data and refuses to
  sign on mismatch (defence against a compromised API, not against compromised JS).
- **Detection:** Receipts and verifier show exactly what was signed.
- **Recovery:** User can contest with the receipt; company can require re-acceptance.
- **Residual risk:** Users who do not read wallet prompts can be misled into accepting a different
  real document of the *same* organization. Mitigated by short, labeled messages.

#### T20 — Malicious site tricks the user into signing a different ToS
- **Attack:** A phishing page requests a Stele acceptance signature for an organization the user
  did not intend (e.g. a scam org's predatory terms).
- **Impact:** Acceptance recorded for the wrong agreement.
- **Defense:** Message names organization + verification status + document + version +
  `Requested by: <domain>`; wallets additionally show the requesting origin. The record names the
  requesting domain so verifiers can flag acceptances not requested by the org's verified domain or
  Stele's hosted domain. Signature can only ever be used for *that* agreement (P5).
- **Detection:** Verifier warns: `request domain does not match organization domain`.
- **Recovery:** User can publicly dispute with receipt; org cannot reuse signature elsewhere.
- **Residual risk:** Social engineering of users who ignore prompts.

### Signature reuse and replay

#### T21 — Signature reused for another agreement
- **Defense / analysis:** The message includes the fingerprint and title of exactly one version of
  one document. The program reconstructs the message from the *target* version's on-chain fields; a
  signature for agreement X fails byte comparison for agreement Y. Ed25519 binds the exact bytes.
- **Impact if bypassed:** Forged acceptance of another agreement. **Detection:** impossible to
  succeed; verifier re-checks binding. **Recovery:** N/A. **Residual risk:** None (TA2, TA3).

#### T22 — Signature reused for another company
- **Defense:** Organization name, verification status, and (via the fingerprint) the organization
  address are bound. Different org → different message bytes. **Residual risk:** None.

#### T23 — Signature reused for another version of the same document
- **Defense:** Version label, version number (`#n`) and fingerprint are bound; additionally only the
  current version can be accepted. **Residual risk:** None.

#### T24 — Signature replayed later
- **Attack:** Re-submit a recorded acceptance tomorrow to make it look like a renewed acceptance.
- **Defense:** (1) Each challenge consumes a nonce bit `(shard, index)` on-chain — a second recording
  fails with `NonceAlreadyUsed`. (2) Expiry: the program rejects messages whose `Expires` is before
  the cluster clock (max window 60 min). (3) Issued time cannot exceed chain time by > 5 min.
- **Detection:** Failed transactions; indexer alerts on replay attempts.
- **Recovery:** N/A. **Residual risk:** None.

#### T25 — Devnet signature reused on mainnet
- **Defense:** Message includes `Network: Solana Mainnet|Devnet|…` read from the immutable
  `ProtocolConfig.network_label`; the fingerprint commits to the CAIP-2 chain ID (genesis-hash
  derived) and program ID. A devnet message cannot match a mainnet reconstruction. Verifiers check
  RPC genesis hash against the expected chain ID.
- **Residual risk:** None, provided config is initialized correctly (verified by any verifier via
  `getGenesisHash`).

#### T26 — Signature produced for another application/domain reused here
- **Attack:** Get the user to sign a message on another protocol, reuse here; or reuse a Stele
  signature elsewhere.
- **Defense:** The message begins with the fixed line `Stele Protocol v1 - Accept Agreement`; the
  program reconstructs the full message, so foreign messages never match. Conversely, Stele messages
  are self-describing and unusable as transactions (they are not valid Solana message encodings, and
  wallets refuse to `signMessage` transaction bytes). Dashboard **login** messages use a different,
  SIWS-style format that can never parse as an acceptance.
- **Residual risk:** A third-party protocol that naively accepts *any* signed bytes could misuse a
  Stele signature as "proof of something"; that is their bug, and the text makes the intent obvious.

#### T27 — User signs a blank or ambiguous message
- **Defense:** We never request signatures over blank, hash-only or free-form text. The message
  template is fixed and labeled; every field is validated (no control characters, no newlines inside
  values, bounded lengths) so a value cannot inject extra lines or impersonate labels.
- **Residual risk:** None in Stele's flows.

#### T28 — User signs a hash without understandable context
- **Defense:** The pre-sign review screen and the wallet message both show organization, verified
  domain, document title, version, fingerprint, network, account, validity and requester. The
  fingerprint is *additional*, never the only content.
- **Residual risk:** Understanding cannot be cryptographically verified (P10).

### Infrastructure attacks

#### T29 — API request modified between frontend and backend
- **Attack:** MITM or malicious extension alters challenge or submission requests.
- **Impact:** Wrong challenge, failed or misattributed submission.
- **Defense:** TLS everywhere (HSTS). Challenges are re-derived and byte-compared by the browser
  before signing; the backend verifies the submitted signature against the stored challenge message
  before relaying; the program verifies again on-chain. Submitting a different signature fails.
- **Detection:** Signature verification failures are logged and rate-limited.
- **Recovery:** Retry with a new challenge.
- **Residual risk:** Denial of service only.

#### T30 — Backend database completely compromised
- **Attack:** Attacker gains full read/write to PostgreSQL.
- **Impact:** Fake dashboard data; PII exposure; forged audit rows.
- **Defense:** The DB contains **no evidence**: no keys, no authority. Verification never reads the
  DB. Secrets are hashed (session tokens, API keys) or encrypted with keys not stored in the DB
  (webhook secrets: AES-256-GCM with an environment/KMS key). Audit log rows are hash-chained.
- **Detection:** Indexer reconciliation flags rows that don't match chain; audit-chain verification
  detects edits; checksums on content blobs.
- **Recovery:** Rebuild the index from chain (`indexer --rebuild`), restore audit log from backups
  and compare heads, rotate secrets, notify users of PII exposure per law.
- **Residual risk:** PII confidentiality (emails, external user refs) is lost on full compromise.

#### T31 — Database administrator edits acceptance records
- **Defense:** Same as T30. Acceptance rows are a cache of on-chain facts; every receipt page
  re-verifies from chain in the browser; the shard accumulator makes omitted or inserted rows
  detectable in bulk.
- **Residual risk:** Viewers who never run verification could be misled by a dashboard.

#### T32 — RPC provider returns misleading information
- **Attack:** A malicious RPC fakes account data or transactions.
- **Defense:** The verifier supports multiple independent endpoints and requires agreement; it
  checks the genesis hash; it cross-checks account state against the original publication
  transaction; users can bring their own RPC. Signature checks are performed locally, so a fake RPC
  cannot make an invalid signature valid — only fake chain *state*.
- **Detection:** Cross-RPC disagreement → `INCONCLUSIVE` with details.
- **Recovery:** Use other providers; report.
- **Residual risk:** All consulted RPCs colluding (TA5). Light-client verification on Solana is not
  yet practical; documented.

#### T33 — Storage URL returns different content
- **Defense:** Hash check on every read (T05). Verifier output names the mirror that failed.
- **Residual risk:** Availability only.

#### T34 — IPFS/Arweave content unavailable
- **Defense:** Mirrors, receipt-embedded content, DB copy, company export. Verifier returns
  `INCONCLUSIVE` with `content unavailable`, never `VALID`.
- **Residual risk:** Total loss of all copies (T06).

### Key lifecycle

#### T35 — Wallet stolen after acceptance
- **Impact:** Thief could accept *new* agreements in the user's name; cannot alter past ones.
- **Defense:** Past records are immutable. Future acceptances by the thief are indistinguishable at
  the key level (inherent). Users rotate to a new wallet (T37).
- **Residual risk:** Acceptances made by a thief after theft cannot be cryptographically separated;
  the timeline (block times) helps users and companies reason about it.

#### T36 — Wallet stolen before acceptance
- **Impact:** Thief accepts terms in the victim's name.
- **Defense:** None cryptographic; Stele records the key, not the human (P10). Companies can bind
  acceptance to authenticated sessions.
- **Residual risk:** Inherent.

#### T37 — User rotates wallet/account
- **Defense:** Old acceptances remain valid evidence for the old key. A new key accepts again
  (a fresh signature). Linking old and new keys is an off-chain concern (company's user ID via
  `external_user_ref`); v1 has no on-chain key-linking to avoid creating public identity graphs.
- **Residual risk:** None for integrity.

#### T38 — Organization rotates signing authority
- **Defense:** Two-step owner transfer (`propose_owner` → `accept_ownership`); member revocation by
  timestamp (never deletion). Each version permanently records the publisher key and whether it
  acted as owner or member; rotation never touches versions.
- **Residual risk:** None.

#### T39 — Organization key compromised
- **Defense:** Owner as multisig; recovery authority with **72-hour time-locked** owner takeover;
  recovery can freeze immediately (only recovery can lift a recovery freeze); compromise reports
  (`report_key_compromise`) mark a member key with `compromised_since`.
- **Detection:** Publication/member alerts; anomalous activity.
- **Recovery:** Freeze → revoke/report → recover owner → corrective version → unfreeze.
- **Residual risk:** Publications made before detection remain on-chain (correctly), annotated with
  a warning when made by a key later reported compromised.

#### T40 — A multisig signer becomes malicious
- **Defense:** Squads threshold (≥ 2-of-3 recommended), Squads time lock, signer rotation inside
  Squads without changing the Stele owner address.
- **Residual risk:** Threshold collusion.

#### T41 — Former owner/employee still has a key
- **Defense:** Revoke membership (`revoked_at`); transfer ownership; remove from Squads. Since the
  program checks the *current* member record at execution, revoked keys are powerless immediately.
- **Residual risk:** Delay between departure and revocation (process issue).

### Platform compromise

#### T42 — Frontend JavaScript is compromised
- **Attack:** Malicious deploy or CDN injection serves JS that lies about verification and requests
  misleading signatures.
- **Defense:** Wallet-displayed message (T19); program-enforced binding; strict CSP with nonces and
  `strict-dynamic`; reproducible builds and release hashes; the verifier is also distributed as a CLI
  and npm package so verification never depends on our site.
- **Detection:** Release-integrity monitoring; third-party verifiers disagreeing with the site.
- **Recovery:** Roll back, rotate deploy credentials, publish incident report.
- **Residual risk:** During compromise, users who trust our page's "Verified ✓" could be deceived;
  the CLI/independent verifier is the remedy.

#### T43 — DNS/domain hijacked
- **Defense:** HSTS preload, CAA records, registrar lock, DNSSEC; wallets show origin; signed
  messages bind `Requested by:` so acceptances obtained via a hijacked host are attributable.
  Evidence is unaffected.
- **Residual risk:** Phishing during hijack.

#### T44 — Session hijacked
- **Defense:** HttpOnly/Secure/SameSite cookies; token hashed at rest; idle (12 h) and absolute (7 d)
  expiry; rotation on login; revocation on logout; sessions can **never** sign transactions — all
  on-chain actions need the wallet.
- **Residual risk:** Hijacker can read org dashboards and manage off-chain settings (API keys,
  webhooks) — these actions are audit-logged and require re-authentication (fresh SIWS signature,
  ≤ 5 min) for sensitive operations.

#### T45 — API token stolen
- **Defense:** Keys are scoped (`acceptances:read`, `acceptances:write`, `documents:read`,
  `webhooks:manage`), prefixed for secret-scanning, stored hashed, revocable, optionally expiring;
  last-used tracking; rate limits. API keys cannot publish or accept on-chain.
- **Residual risk:** Abuse within scope until revoked.

#### T46 — Signature request injected into another browser session
- **Attack:** Attacker obtains a challenge in their own session and gets a victim to sign it, so the
  victim's acceptance is linked to the attacker's account at the company.
- **Defense:** Challenges are bound to the requesting session/acceptance-session token and to the
  signer key at issuance; submission must come from the same binding; `external_user_ref` comes from
  the company's server-side session token, never from the browser.
- **Residual risk:** Low; on-chain evidence is still the victim's real authorization of a real
  document.

### Concurrency and reliability

#### T47 — Race conditions while publishing versions
- **Defense:** Optimistic concurrency **on-chain**: the publish instruction requires
  `version == version_count + 1` and `previous_version_hash == head_hash`; the version PDA is derived
  from the number. Exactly one publication per number can succeed. The losing draft must be rebased
  (new predecessor → new fingerprint → re-review).
- **Residual risk:** None.

#### T48 — Two admins publish simultaneously
- **Defense:** Same as T47; the dashboard shows "stale draft" and requires re-review.

#### T49 — Transaction succeeds on frontend but indexing fails
- **Defense:** Chain is the source of truth. The confirm endpoint, the relayer and the indexer all
  upsert idempotently from the chain; the indexer replays missed transactions from its cursor.
- **Residual risk:** Temporarily stale dashboards.

#### T50 — Indexer reports incorrect data
- **Defense:** Indexer output is never evidence; receipts are re-verified in the browser; per-shard
  accumulators let auditors verify completeness; reconciliation jobs compare DB to chain.
- **Residual risk:** Unverified dashboard views.

#### T51 — Blockchain transaction fails but backend marks it successful
- **Defense:** Status transitions require reading the transaction from RPC with `meta.err == null`
  at `confirmed`, and to `finalized` later; receipts are only issued after confirmation; the
  verifier independently checks status.
- **Residual risk:** A malicious backend could *display* success — refuted by any verification.

#### T52 — User signs but the transaction is never submitted
- **Impact:** User believes they accepted; no record.
- **Defense:** UI shows "Recording…" until confirmation and only then "Agreement Verified ✓";
  submission retries until expiry; expired challenges are marked `expired` and the user is asked to
  sign again. No record means no acceptance — the protocol never treats an unsubmitted signature as
  acceptance.
- **Residual risk:** A signed-but-unsubmitted message could be submitted later by whoever holds it,
  **only** until expiry (≤ 60 min) and only once.

#### T53 — User submits the same acceptance twice
- **Defense:** Nonce bit consumption (second fails). Separate *new* acceptances of the same version
  by the same key are allowed (distinct nonces) and shown as distinct records with distinct times.
- **Residual risk:** None.

#### T54 — Bot spams millions of acceptance records
- **Defense:** Shards are **relayer-gated** (only the shard's designated relayer can record), so bots
  cannot self-submit. The relayer requires rate-limited, optionally token-gated challenges
  (company-issued acceptance-session tokens, CAPTCHA/Turnstile on the hosted page, per-IP/per-key
  quotas). Even successful spam produces only records attributed to the bots' own keys — it cannot
  forge real users.
- **Residual risk:** Cost exhaustion is bounded by quotas; analytics should rely on
  session-bound acceptances.

#### T55 — Denial of service through Solana transaction spam
- **Defense:** Priority fees, retries, multiple RPC/sender endpoints, generous signed validity
  windows. Write locks are per-org shard, so one org's traffic cannot block another's.
- **Residual risk:** Network-wide congestion delays (not compromises) recording.

### History hiding

#### T56 — Organization tries to remove historical evidence
- **Defense:** No close instruction for `Organization`, `Document`, `DocumentVersion`, `Member`,
  `NonceShard`; acceptance evidence lives in the ledger. The program ID's upgrade authority is a
  multisig; any malicious upgrade that tampers with accounts is detectable against original
  transactions (A01).
- **Residual risk:** TA1/TA4.

#### T57 — Organization tries to hide a previous version from the UI
- **Defense:** Stele's public pages render the full chain from `version_count` down to v1 by PDA
  derivation — not from a curated list. The verifier walks `previous_version_hash` to v1.
- **Residual risk:** A company's *own* site can omit versions; our pages and verifier cannot.

#### T58 — UI intentionally shows incomplete history
- **Defense:** History count is checked against on-chain `version_count`; gaps are impossible because
  PDAs are sequential. Acceptance counts can be audited against shard accumulators.
- **Residual risk:** Users relying solely on a malicious UI.

#### T59 — Explorer/backend disagrees with the blockchain
- **Defense:** Chain wins. The verifier reports which source disagreed. Indexer reconciliation alerts.
- **Residual risk:** None for evidence.

#### T60 — Content encoding produces different hashes on different devices
- **Defense:** Canonicalization happens once, at authoring time, producing canonical **bytes** that
  are stored and hashed. Verification hashes stored bytes; it never re-normalizes user-visible text.
  Shared Rust/TS test vectors (including NFD input, CRLF, BOM, emoji, RTL scripts, CJK) run in CI.
- **Residual risk:** Older Unicode libraries may flag newly assigned characters as non-NFC in the
  canonical-form *check*; the hash itself is unaffected.

---

## 3. Additional scenarios identified during design

#### A01 — Malicious program upgrade rewrites account state
- **Attack:** Upgrade authority (or a thief of it) deploys code that edits `DocumentVersion`
  accounts or fakes acceptances.
- **Impact:** Critical: state-level history rewrite.
- **Defense:** Upgrade authority held by a Squads multisig with time lock; verifiable builds
  (`solana-verify`) for every release; roadmap to freeze the program. **Detection by design:** the
  verifier compares each version account with the *original publication transaction's instruction
  data* (content hash, title, label, effective date, expected fingerprint), which lives in the
  immutable ledger and cannot be changed by an upgrade. Acceptance evidence is the signed message in
  the ledger, re-verified locally.
- **Residual risk:** Logic of *future* executions after a malicious upgrade; detectable via
  program-data hash monitoring.

#### A02 — Ed25519 instruction indirection / offset attack
- **Attack:** Craft an Ed25519 instruction whose offsets point at data inside *another* instruction
  (e.g. our own instruction data) so the verified message differs from what our program reads.
- **Defense:** The program requires: preceding instruction's program ID = Ed25519 program;
  `num_signatures == 1`; all three `*_instruction_index == u16::MAX` (self); canonical offsets
  (pubkey 16, signature 48, message 112); data length exactly `112 + message_len`. It then reads
  pubkey/signature/message from that instruction only.
- **Residual risk:** None.

#### A03 — Fake instructions sysvar account
- **Defense:** `address = sysvar::instructions::ID` constraint; loader functions also check the ID.

#### A04 — Malicious program CPIs into `record_acceptance`
- **Defense:** The program requires stack height 1 (a top-level instruction) and that the instruction
  at the current top-level index is itself (`program_id == stele`), so CPI invocations are rejected
  before any introspection result is relied on; introspection is relative to the top-level index.
- **Test:** `record_acceptance_cannot_be_invoked_through_cpi` relays a validly signed acceptance
  through a forwarding program (`tests/programs/cpi-probe`) and expects `CpiNotAllowed`.

#### A05 — Unicode deception (Trojan Source, invisible characters, homoglyph names)
- **Defense:** Bidi embedding/override/isolate characters (U+202A–202E, U+2066–2069), zero-width and
  invisible format characters (U+200B, U+2060–2064, U+FEFF), C0/C1 controls, private-use, tag and
  noncharacter code points are rejected in content **and** in on-chain names/titles. Version labels,
  slugs, types, locales and domains are ASCII-restricted.
- **Residual risk:** Mixed-script homoglyphs in display names (shown with "unverified" status).

#### A06 — Domain expires and is re-registered by an attacker
- **Defense:** Attestations expire (≤ 400 days) and must be renewed via fresh DNS checks; acceptance
  messages show "(unverified)" once `domain_expires_at` passes; re-attestation to a new org requires
  closing the old `DomainRecord`. Historical acceptances keep the domain exactly as signed.
- **Residual risk:** Window between transfer and expiry; verifiers can run a live DNS check.

#### A07 — Nonce-bitmap exhaustion (DoS)
- **Defense:** Relayer-gated shards (only the designated relayer can consume bits); the relayer
  allocates bits only to rate-limited challenges; new shards are cheap (≈ 0.059 SOL).
- **Residual risk:** Relayer-key compromise could burn bits (cost of new shards).

#### A08 — Oversized names cause un-relayable transactions
- **Defense:** Strict on-chain length limits (org name ≤ 40 B, domains ≤ 48 B, title ≤ 60 B, label
  ≤ 16 B) chosen so the worst-case acceptance transaction fits in 1,232 bytes; a CI test builds the
  worst case and asserts the size. (Found during implementation: the first limits overflowed by 16
  bytes — the test caught it before any deployment.)

#### A09 — Domain attestor key compromised
- **Defense:** Attestor can only set/renew/revoke domain attestations — it cannot publish, accept,
  or edit history. Protocol admin (multisig) rotates the attestor. Attestations are public and
  re-checkable via live DNS.
- **Recovery:** Rotate, revoke fraudulent attestations, publish incident report.
- **Residual risk:** False "verified" labels in acceptance messages signed during the compromise
  window (the message records exactly what was displayed).

#### A10 — XSS via document content or names
- **Defense:** No HTML in content — typed blocks rendered as React text nodes; no
  `dangerouslySetInnerHTML` anywhere; strict CSP with nonces; storage URIs rendered only for
  allow-listed schemes (`ar://`, `ipfs://`, `https://`) and never as `javascript:`.

#### A11 — CSRF against dashboard API
- **Defense:** SameSite=Lax cookies, Origin allow-list for state-changing requests, double-submit
  CSRF token header, JSON-only bodies. All on-chain actions additionally require wallet signatures.

#### A12 — Malicious integrator spoofs the SDK UI
- **Defense:** The SDK's `<TermsAcceptance/>` renders hash-verified content and the full review
  summary; integrators can't swap text. A malicious integrator who writes their own UI is covered by
  T02/T19.

#### A13 — Company rename after publication to mislead
- **Defense:** Rename is an on-chain, audited event. Acceptance messages carry the name **at
  acceptance time**, preserved in the ledger. Verifiers show the historical signed name and the
  current name.

#### A14 — Supply-chain attack (npm/crates/CI)
- **Defense:** Lockfiles committed; `pnpm` with `allowBuilds` allow-list for install scripts; pinned
  Rust toolchain and dependencies; `cargo audit` / `pnpm audit` in CI; minimal, audited crypto
  dependencies (`@noble/*`); verifiable program builds; CI uses OIDC (no long-lived deploy secrets).
- **Residual risk:** Undetected compromise of a widely used dependency.

#### A15 — Webhook spoofing / replay
- **Defense:** HMAC-SHA256 over `timestamp.body` with a per-endpoint secret; 5-minute tolerance;
  event IDs for dedupe; constant-time comparison. Webhooks *point to* evidence (tx signature,
  acceptance ID); receivers should verify, never trust payload alone.

#### A16 — Login message confused with acceptance message (or vice versa)
- **Defense:** Distinct, fixed first lines and structures; login messages explicitly state they
  authorize no acceptance; acceptance reconstruction rejects anything else.

#### A17 — SSRF via webhook URLs or domain verification
- **Defense:** Webhook URLs must be `https`, resolve to public IPs (private/link-local/loopback/metadata
  ranges blocked, re-checked at connection time to defeat DNS rebinding), no redirects, short
  timeouts, response size caps. Domain verification uses DNS-over-HTTPS to fixed resolvers only.

#### A18 — Timing attacks on secret comparison
- **Defense:** Secrets compared via SHA-256 digests with `timingSafeEqual`.

#### A19 — Privacy: on-chain correlation of a user's acceptances
- **Defense:** No personal data on-chain — only public keys. `external_user_ref` and emails stay
  off-chain. Documentation tells organizations that acceptances by the same key are publicly
  linkable and that users may use per-service keys.
- **Residual risk:** Public linkability of a key across organizations (inherent to public ledgers).

#### A20 — Fork/reorg between "confirmed" and "finalized"
- **Defense:** Receipts show commitment level; webhooks for `agreement.accepted` are sent at
  `confirmed` with a `finalized` follow-up; verifier requires `finalized` for `VALID`.

#### A21 — Front-running organization creation
- **Defense:** Organization PDA seeds include the creator's key, so nobody else can create an
  organization at an address someone intends to use.

#### A22 — TOCTOU between publication preparation and signing
- **Defense:** The publish instruction carries `expected_version_hash`; the program recomputes it. If
  the head moved, or any field differs, publication fails. The browser recomputes hashes from the
  canonical bytes it received before prompting the wallet.

#### A23 — Fake "verifier" websites
- **Defense:** Open-source verifier library and CLI; documentation of the full verification
  algorithm so anyone can reimplement it; receipts are verifiable offline except for chain lookups.

#### A24 — Sensitive data in logs
- **Defense:** Structured logging with redaction paths (authorization headers, cookies, tokens,
  secrets, signatures, emails); IPs stored only as keyed hashes; request bodies never logged.

---

## 4. Phase-gate review (asked at the end of each build phase)

Each answer is backed by tests that exercise the attack against the real components (Rust tests run
the compiled program in LiteSVM; the TypeScript suites run against a local validator).

| Question | Answer for v1 | Checked by |
|---|---|---|
| Can the company cheat here? | It can publish (attributably) and choose what to publish; it **cannot** alter, back-date, hide (from Stele/verifier), or substitute versions or acceptances. | `publishes_a_hash_chained_history`, `rejects_incorrect_previous_hash`, `effective_date_cannot_be_backdated`, `concurrent_drafts_resolve_to_exactly_one_publication` (program); `detects a version account rewritten after publication` (verifier) |
| Can the user cheat here? | They can deny *intent*; they cannot deny that their key signed the exact message (unless key compromise). They cannot shift their acceptance to another version. | `signature_cannot_be_reused_for_another_version_document_or_org`, `signature_is_bound_to_signer_account`, `tampered_human_readable_fields_are_rejected` (program) |
| Can the backend forge this? | No. It holds no user keys; the program verifies signatures; verifiers ignore the DB. | `forged_signature_fails_in_the_precompile`, `ed25519_indirection_layout_is_rejected`, `spoofed_instructions_sysvar_is_rejected`, `record_acceptance_cannot_be_invoked_through_cpi` (program); `issues receipts only from verified facts and detects forged receipt claims` (verifier); `a forged receipt is reported invalid` (E2E) |
| Can the frontend forge this? | No forgery; it can only request signatures whose full text the wallet displays. | `tampered document text is never displayed or offered for signing`, `declining in the wallet records nothing` (E2E); `rejects content that does not match the on-chain commitment` (verifier) |
| Can another organization impersonate this company? | Display names, yes — labeled "unverified". Verified domains, no — unique on-chain and live-checkable. | `a_domain_belongs_to_at_most_one_organization`, `only_the_attestor_can_attest`, `verified_domain_appears_in_message_and_expires` (program) |
| Can an old signature be replayed? | No — nonce bit consumption + on-chain expiry, bound to one network. | `same_signed_message_cannot_be_recorded_twice`, `replay_after_expiry_is_rejected`, `devnet_style_message_is_rejected_on_this_network` (program); `rejects evidence from an unexpected network` (verifier) |
| Can a database administrator rewrite history? | No — the DB is not evidence; edits are detectable by re-indexing and audit-chain checks. | `rebuilds the entire index from the chain into an empty database` (API); `makes the audit log append-only at the database level` (db); `hash-chains entries and detects out-of-band insertion` (API) |
| Can a compromised account destroy historical proof? | No — no close/update instructions for evidence accounts; ledger is immutable. | The instruction set (PROTOCOL_SPEC.md) has no close or update for versions or acceptances; `revoked_member_loses_authority_immediately`, `owner_freeze_blocks_publication_and_acceptance`, `key_compromise_reporting` (program) |
| Could a user misunderstand what they are signing? | Mitigated by plain-language, labeled messages and a pre-sign review; cannot be eliminated (P10). | `a user reviews verified terms, signs the exact message and receives a verifiable receipt` (E2E) |

---

## 5. Residual risk register

| ID | Residual risk | Severity | Owner / mitigation |
|---|---|---|---|
| R1 | Key-holder ≠ human (theft, sharing, coercion) | High (semantic) | Honest language; session binding; company auth logs |
| R2 | Malicious program upgrade | Critical (low likelihood) | Multisig + timelock, verifiable builds, publication-tx cross-checks, eventual immutability |
| R3 | All RPCs consulted collude | High (very low likelihood) | Multi-provider verification; user-supplied RPC |
| R4 | Attestor key compromise → false verified badges | Medium | Bounded power, rotation, live DNS checks |
| R5 | Users ignore wallet prompt text | Medium | Short messages, review screen, anti-phishing copy |
| R6 | Total loss of all content copies | Medium (low likelihood) | Arweave + mirrors + receipt embedding |
| R7 | Public linkability of keys | Low–Medium | Privacy guidance; no PII on-chain |
| R8 | Insider abuse within granted roles | Medium | Multisig owners, alerts, attribution |
| R9 | Hardware wallets lacking raw `signMessage` support | Low (availability) | Documented; off-chain-message envelope planned as `stele/1` signing scheme 2 |
| R10 | Cluster clock drift | Low | Bounded skew checks; slot numbers recorded alongside time |
| R11 | Account-recovery abuse yields a NEW walletless key for an account (W08) | Medium | Visible rotation record, audit, webhook; organizations harden their account recovery |
| R12 | Synced passkeys inherit the platform account's security (W20) | Medium | Documented; organizations may require device-bound passkeys or wallets |
| R13 | Sponsored-shard griefing up to the daily limit by a compromised relayer (W10) | Low | Per-record and daily caps, pause, low-balance alerts |
| R14 | Unlocked seed in a compromised page (XSS) during one signature (W04) | Medium | Single-signature unlock, assertion required by the relayer, CSP |

---

## 6. Walletless signing, fee sponsorship and proofs

Added with passkey-protected Stele keys (PROTOCOL_SPEC.md §14), fee sponsorship (§13) and generic
proofs (§12). The on-chain acceptance protocol is unchanged (`stele/1`): a passkey-protected key is an
ordinary Ed25519 key, so every property of §1.2 holds for walletless signers exactly as for wallets.

### 6.1 New assets and attackers

| ID | Asset | Note |
|---|---|---|
| AS11 | Wrapped signing keys (AES-GCM blobs under passkey PRF outputs or recovery kits) | Ciphertext only; useless without the authenticator or the kit |
| AS12 | Passkeys (authenticator private keys) and recovery kits | Held by users; never seen by Stele |
| AS13 | Sponsored shard deposits | Program-owned; no private key exists |
| AS14 | Statements behind proofs (order details) | Off-chain; may contain personal or commercial data |

Additional attacker capabilities considered: full read/write access to the database (wrapped keys,
credentials, identities), a malicious or compromised relayer draining a sponsored shard, a phishing
site requesting passkey signatures, XSS on the integrator's page while a key is unlocked, a malicious
organization trying to sign for its users, an attacker controlling a user's email/account but not
their passkey.

### 6.2 Scenarios

#### W01 — The database is stolen: can the attacker sign as a walletless user?
- **Defense:** The database holds only the AES-256-GCM ciphertext of each seed, keyed by
  `HKDF(PRF output)`. The PRF output is a 256-bit secret computed inside the authenticator after user
  verification; it is never sent to Stele. There is no server-side, password-derived or escrowed copy.
- **Test:** `registers a passkey-protected key and records an acceptance the user never pays for`
  (API: the stored row contains neither the seed nor its encodings); `round-trips under the passkey PRF
  and fails closed otherwise` (protocol).
- **Residual risk:** None for existing keys.

#### W02 — Database write access: swap a user's credential for the attacker's passkey
- **Attack:** Replace the stored passkey public key so the attacker's assertions are accepted.
- **Defense:** The relayer still requires a valid Ed25519 signature by the user's key over the exact
  message (the attacker does not have the seed) and the program verifies it on-chain.
- **Test:** `a database attacker with their own passkey still cannot sign for an existing key` (API).
- **Residual risk:** The attacker can register a **new** key (W08), never sign with an existing one.

#### W03 — Stele or the organization tries to create an acceptance "for" a walletless user
- **Defense:** Same as wallets: no party but the key holder can produce the signature, and the
  program rebuilds the message. Historical records cannot be created later: times come from the
  cluster clock and nonces are single-use.
- **Residual risk:** Account-level substitution (W08) is visible as a new key with its own history.

#### W04 — Recording a passkey signer's message without the passkey's approval
- **Attack:** A stolen unlocked key (XSS while unlocked, memory scraping) is used to sign other
  messages and submit them.
- **Defense:** For keys registered as passkey signers the API refuses to relay unless a user-verified
  WebAuthn assertion over `SHA-256(tag || message)` from an active passkey of that signer accompanies
  the signature; a registered key cannot be used in "wallet" mode; receipts carry the assertion and
  verifiers check it. The seed lives in memory only for one signature and is wiped.
- **Test:** `never relays a passkey signer's record without a user-verified assertion over that exact
  message` (API: no assertion, no UV, other message, wallet-mode fallback).
- **Residual risk:** An attacker who extracts the seed could submit to the program directly through an
  open shard (no designated relayer). Shards created by Stele are relayer-gated; receipts of such
  records would lack passkey evidence.

#### W05 — Phishing site asks for the passkey signature
- **Defense:** WebAuthn binds assertions to the RP ID and origin; the passkey of `shop.example` cannot
  be exercised on `evil.example`. The signed message names the requesting host and the verifier checks
  the assertion's origin against it.
- **Test:** `rejects every deviation` (protocol: origin, RP ID, cross-origin, type, challenge, UV,
  counter); `allows http only on localhost`.

#### W06 — Offline brute force of a wrapped key
- **Defense:** The wrapping key derives from a 256-bit PRF output (not a password). The AAD binds the
  blob to its public key and credential, so it cannot be re-attributed.
- **Test:** `round-trips under the passkey PRF and fails closed otherwise` (wrong passkey, wrong salt,
  re-attribution, tampering, purpose confusion).

#### W07 — Browser without PRF: silent downgrade?
- **Defense:** Registration aborts with a clear error and nothing is stored; the visitor is offered a
  wallet. No code path creates a server-held or password-protected key.
- **Test:** `without the PRF extension, passkey signing is refused — never replaced by a server-held
  key` (E2E).

#### W08 — Email/account takeover gains the signing key
- **Defense:** Account control alone yields nothing: adding a passkey or recovery kit requires a
  statement **signed by the key** (unlocked with an existing passkey or the recovery kit). When every
  unlock method is lost, the organization can only retire the old key; the account's next key is a
  new identity recorded as `account_authorized` — explicitly not endorsed by the old key — and the old
  key can never sign again. Past records stay valid and attributable to the old key.
- **Test:** `a recovery kit unlocks the same key and adds a new passkey (statement signed by the key)`
  (intruder without the key is refused); `account recovery without any unlock method creates a NEW
  key, linked and flagged, never control of the old one` (API).
- **Residual risk:** An attacker controlling the user's account *and* the organization's
  account-recovery process can obtain a new key for that account. This is visible (new key, rotation
  record, audit entry, `signer.changed` webhook) and cannot rewrite history.

#### W09 — Silent passkey changes
- **Defense:** Every change (registration, added passkey, recovery kit, revocation, rotation, reset) is
  an audit-log entry (hash-chained, append-only) and a webhook; key statements are public evidence
  (`GET /v1/public/signers/:key`).

#### W10 — Draining an organization's sponsored shard
- **Attack:** A compromised relayer (or an organization admin) spends the deposit.
- **Defense:** No private key exists for the shard. The program pays only (a) the designated relayer
  of a relayer-gated shard, (b) after a valid user signature was verified and recorded, (c) the exact
  fee of that transaction computed from its own compute-budget instructions (never more than the
  runtime charged), (d) capped per record and per UTC day, (e) never below rent. Admins can only lower
  limits or pause; only the owner can raise limits, unpause or withdraw.
- **Test:** `shard_reimburses_the_relayer_the_exact_fee_and_the_user_pays_nothing`,
  `reimbursement_is_capped_per_record`, `daily_limit_stops_payment_but_never_blocks_a_recording`,
  `only_the_designated_relayer_is_paid`, `sponsorship_management_rules`,
  `only_the_owner_withdraws_and_never_below_rent` (program).
- **Residual risk:** A compromised relayer can make the organization pay network fees for recordings
  of throwaway keys up to the daily limit (it gains nothing: the fees go to validators). A colluding
  validator could inflate priority fees up to the per-record cap. Both are bounded by the caps.

#### W11 — Sponsorship changes who authorized a record
- **Defense:** Reimbursement runs after, and independently of, the authorization checks; it reads no
  user input; a tampered or replayed message fails exactly as without sponsorship and nothing is paid.
- **Test:** `sponsorship_never_turns_an_invalid_recording_into_a_valid_one` (program).

#### W12 — The relayer key signs something else
- **Defense:** The relayer signs only through one code path that assembles a recording and checks an
  allowlist before signing (compute budget ≤ cap, priority fee ≤ configured, canonical Ed25519,
  `record_acceptance`/`record_proof` only, the relayer the only signer). The generic send helper
  refuses the relayer key.
- **Test:** `the relayer signs nothing but the allowlisted recording shape` (API).

#### W13 — The user is made to pay
- **Defense:** Users never sign transactions — only messages; the relayer is the fee payer. The
  passkey signer's account never holds SOL.
- **Test:** `shard_reimburses_the_relayer_the_exact_fee_and_the_user_pays_nothing` (program: an
  unfunded key records); E2E tests run with unfunded keys.

#### W14 — Proof statement substitution (shown one order, signs another)
- **Defense:** The SDK hashes the statement it displays and refuses to sign unless the message's
  `Statement:` line, type, organization ID, chain and site match; the program records only the hash;
  verifiers recompute the hash of the statement in the receipt.
- **Test:** `refuses to show a statement that does not match its hash`, `blocks signing when the
  message names a different statement` (integration); `records a purchase proof … alterations fail`
  (API); `statement_hash_and_type_are_bound_to_the_signature` (program).

#### W15 — A proof moved to another organization or network
- **Defense:** The anchor message names the organization **address** (a PDA of this program) and the
  chain ID; the program rebuilds both.
- **Test:** `a_proof_cannot_be_moved_to_another_organization_even_with_the_same_name`,
  `signer_network_and_time_rules` (program).

#### W16 — Cross-record replay (acceptance ↔ proof)
- **Defense:** Different first lines; shared nonce space.
- **Test:** `an_acceptance_signature_cannot_be_recorded_as_a_proof`,
  `replay_is_rejected_and_nonces_are_shared_with_acceptances` (program).

#### W17 — Privacy of proofs
- **Defense:** Only the statement hash is on-chain, salted with 256 random bits; personal fields can be
  commitments. Proof receipts (which include the statement) are served only with the organization's
  API key or the customer's client token, never by proof ID (public).
- **Test:** `records a purchase proof …` (receipt refused without the token).

#### W18 — Receipt tampering (signer type, fee payer, statement)
- **Defense:** Every receipt field is re-derived; passkey evidence is re-verified signature by
  signature; fee claims are compared with the transaction.
- **Test:** `registers a passkey-protected key …` (forged assertion and relabeled fee payer → INVALID);
  `the widget signs with a passkey …` (edited RP ID → INVALID, E2E); proof statement edit → INVALID
  (API and E2E).

#### W19 — Biometric data leakage
- **Defense:** WebAuthn never exposes biometric data; receipts contain only authenticator data flags,
  a signature counter, the origin and signatures.

#### W20 — Cloned authenticator
- **Defense:** Signature counters must increase (when non-zero); synced passkeys (counter always 0)
  are accepted, as the platform intends.
- **Residual risk:** Synced passkeys rely on the platform account's security (Apple/Google/password
  manager). Documented for organizations choosing passkey-only policies.

### 6.3 Required invariants and their tests

| # | Invariant | Enforced by | Checked by |
|---|---|---|---|
| 1 | No published document can change | program (no update/close) | `publishes_a_hash_chained_history` |
| 2 | The organization cannot forge an acceptance for a key it does not hold | Ed25519 + on-chain rebuild | W03; `forged_signature_fails_in_the_precompile` |
| 3 | Stele cannot forge an acceptance for a key it does not hold | as 2; no user keys, no PRF outputs | W01–W03 |
| 4 | A database compromise cannot forge historical acceptances | ledger + cluster clock + nonces | W02; `rebuilds the entire index…` |
| 5 | A Stele sponsor key cannot forge | relayer pays only; signature checked on-chain | W11, W12 |
| 6 | An organization sponsor cannot forge | no key exists; reimbursement after verification | W10, W11 |
| 7 | Receipt tampering fails verification | claim-by-claim re-derivation | W18 |
| 8 | Replay fails | nonce bit | W16; `same_signed_message_cannot_be_recorded_twice` |
| 9 | Cross-domain reuse fails | `Requested by` + origin-bound assertions | W05; `request_domain_cannot_inject_lines` |
| 10 | Cross-network reuse fails | network label / chain ID / fingerprint | `devnet_style_message_is_rejected_on_this_network`, W15 |
| 11 | Wrong-version reuse fails | fingerprint binding | `signature_cannot_be_reused_for_another_version_document_or_org` |
| 12 | Expired signatures fail | on-chain window | `replay_after_expiry_is_rejected`, `signer_network_and_time_rules` |
| 13 | A stolen password alone cannot sign | key statements signed by the key | W08 |
| 14 | Passkey changes are auditable | audit log, webhooks, public key statements | W09 |
| 15 | Key rotation does not rewrite history | new key; old records untouched | W08 |
| 16 | Old acceptances remain verifiable | protocol unchanged; optional receipt fields | receipts without `signer`/`fees` verify (all pre-existing suites) |
| 17 | Fee sponsorship never changes the authorizer | W11 | W11 |
| 18 | No sensitive key material in logs | no seed/PRF/kit leaves the browser; API logs exclude bodies | W01; E2E storage check |
| 19 | No unnecessary PII on-chain | statements off-chain, salted; external refs off-chain | W17 |
| 20 | The user never pays | relayer is fee payer; unfunded keys work | W13 |

---

## 7. Native passkeys, batched evidence and the security review (`stele/2`)

Added with native passkey signatures (PROTOCOL_SPEC.md §17.2–§17.5), `stele-receipt/2` (§17.6),
the `MERKLE_BATCHED` evidence mode (§17.9) and display-safety reporting (§4.5). Everything in §1–§6
still holds for `stele/1`.

### 7.1 New assets

| ID | Asset | Note |
|---|---|---|
| AS15 | Native passkey private keys (P-256) | Inside the user's authenticator or passkey provider; never exported, never seen by Stele, the organization or the browser's JavaScript |
| AS16 | `PasskeySigner` enrollments | On-chain map "account commitment → current key"; changes only by the current key (rotation) or the organization's wallet (recovery, revocation) |
| AS17 | Account salts | Off-chain secrets that make account commitments unguessable |
| AS18 | Batch leaves and manifests | The only evidence of a batched acceptance besides the root; held by the user (receipt), the organization (webhook) and the content store (manifest) |
| AS19 | Program upgrade authority | Today a single key (see `docs/upgrade-authority.md`) |

### 7.2 Scenarios

Format: **Attack** · **Impact** · **Current defense** (before this change) · **New defense** ·
**Residual risk**.

#### R01 — Malicious Stele operator
- **Attack:** Record acceptances users never made; alter or drop receipts; replace enrollments.
- **Impact:** False evidence of consent.
- **Current defense:** Ed25519 signatures verified on-chain; no user keys; PRF-wrapped seeds only.
- **New defense:** Native passkeys: no key material exists outside the authenticator, not even
  encrypted. Every `stele/2` record needs a P-256 WebAuthn signature verified by the secp256r1
  precompile and bound by the program to message, site and RP. Enrollment/rotation need the user's
  key; the relayer key cannot rotate (`forgery-demo`: 4 of 4 attempts rejected — test
  `account mode: … history keeps verifying`).
- **Residual risk:** Censorship (refusing or delaying to relay); for a signing page Stele hosts,
  Stele's JavaScript chooses what the passkey signs (R09).

#### R02 — Malicious organization
- **Attack:** Sign for its users; pass off a takeover as the user's own rotation; reword a document.
- **Impact:** Forged consent; undetectable key takeover.
- **Current defense:** Same as R01; immutable versions; frozen history.
- **New defense:** The organization never holds a user key. Rotation needs the CURRENT key's
  signature; recovery is possible only through its own admin wallet and is recorded as
  `ORGANIZATION_RECOVERY` — never presented as endorsed by the previous key; every change emits
  `PasskeySignerChanged`; verifiers show it for every later and earlier acceptance.
- **Residual risk:** The organization controls the relying-party origin: its page decides what the
  user's passkey signs, and the passkey prompt does not show the text (no WYSIWYS in WebAuthn). A
  malicious page could, with one user tap, obtain a signature over a different Stele statement —
  including a rotation statement naming the organization's key. Such a rotation is public and
  permanent, but looks endorsed. Mitigations: domain-separated tags, display safety (§4.5), the
  isolated Stele signing page when the organization is not trusted (R09), and monitoring
  `PasskeySignerChanged`.

#### R03 — Compromised organization backend
- **Attack:** Mint acceptance sessions for any account (`ACCOUNT_AND_PASSKEY`), register an attacker
  passkey under a victim's account.
- **Impact:** Account-level substitution.
- **Current defense:** Sessions are bound to `externalUserRef`; PRF key statements.
- **New defense:** An account that already has an on-chain enrollment cannot register a new key: it
  needs rotation (victim's current key) or organization recovery (admin wallet, visibly different).
- **Residual risk:** First enrollment of an account that never had one; recovery if the admin wallet
  is also compromised.

#### R04 — Compromised Stele backend (API host)
- **Attack:** As R01 plus serving altered JavaScript, issuing misleading challenges.
- **Impact:** A user is shown one text and signs another.
- **Current defense:** The SDK rebuilds the message from chain data and refuses a mismatching
  challenge.
- **New defense:** The SDK also recomputes the WebAuthn challenge from the verified message and
  never signs the server's challenge blindly; it checks registration/rotation statements name the
  expected keys; widget builds publish a Subresource Integrity hash (`/sdk/v1/stele.js.integrity.json`).
- **Residual risk:** An integrator that loads the widget without `integrity=` trusts the host.

#### R05 — Compromised database
- **Attack:** Change "account → key" mappings, delete or alter rows, inject fake acceptances.
- **Impact:** Wrong answers from the API.
- **Current defense:** The index is rebuilt from the chain; receipts are generated by the verifier.
- **New defense:** Account-bound mappings are on-chain (`PasskeySigner`); the relayer passes the
  enrollment so the program enforces it; batched leaves are re-verified by the verifier before a
  receipt is issued, and their evidence also lives in manifests, webhooks and receipts.
- **Residual risk:** Loss of batch evidence held only by this database before the manifest is
  stored (R19).

#### R06 — Compromised or lying RPC
- **Attack:** Return a forged transaction/account to a verifier.
- **Impact:** False VALID.
- **Current defense:** Consensus over every configured RPC (`ConsensusSource`); disagreement →
  INCONCLUSIVE.
- **New defense:** The verifier re-verifies P-256 signatures locally and recomputes Merkle
  inclusion — a lying RPC must forge consistent precompile data, events and accounts.
- **Residual risk:** All configured RPCs colluding; users should configure independent providers.

#### R07 — Compromised relayer key
- **Attack:** Sign arbitrary transactions; drain sponsors; record forgeries.
- **Impact:** Loss of the hot wallet's SOL; sponsor drain.
- **Current defense:** Strict transaction allowlist (`tx-policy.ts`); the relayer cannot authorize
  records.
- **New defense:** The allowlist pairs each precompile with exactly its instructions
  (`Ed25519 → record_acceptance|record_proof`, `secp256r1 → record_passkey_acceptance|enroll|rotate`,
  or a bare `anchor_acceptance_batch`), caps compute and priority fees, and requires the relayer to be
  the only signer (test `pairs Ed25519 only with stele/1 recordings…`). The relayer key alone cannot
  pass any program check that needs a user signature (`forgery-demo`).
- **Residual risk:** The relayer can anchor junk batch roots (no user signature behind them, so no
  verifiable leaf) and spend its own SOL and, within caps, sponsor reimbursements.

#### R08 — Compromised sponsor
- **Attack:** Use organization sponsorship to pay for unrelated transactions or another org.
- **Impact:** Drained deposit.
- **Current defense:** The shard reimburses only its designated relayer, after a valid recording,
  within per-record and daily caps.
- **New defense:** Batch anchors reimburse exactly one signature's fee; enrollment rent is never
  reimbursed by organizations and Stele caps enrollments per organization per month
  (`STELE_MAX_ENROLLMENTS_PER_MONTH`).
- **Residual risk:** Valid but unwanted recordings within caps.

#### R09 — Compromised widget CDN
- **Attack:** Serve modified widget code that displays one text and requests a signature over
  another.
- **Impact:** WYSIWYS failure.
- **Current defense:** Strict CSP on Stele's own pages; text inserted as text nodes.
- **New defense:** SRI hash published per build; the hosted signing page (`/accept/<org>/<doc>`) is
  an isolated top-level origin with nonce-based CSP and `frame-ancestors 'none'`; cross-origin
  iframe ceremonies are rejected on-chain (`crossOrigin`/`topOrigin`).
- **Residual risk:** Integrators not pinning SRI; reproducible-build attestation is not yet
  published.

#### R10 — Merchant XSS
- **Attack:** Script injected into the organization's page drives the widget or calls WebAuthn
  directly.
- **Impact:** Signatures over attacker-chosen Stele statements after one user tap.
- **Current defense:** PRF keys exist in memory only during one signature.
- **New defense:** No private key is ever in page memory; each signature requires a user-verified
  ceremony; every statement kind has its own tag; everything recorded is public.
- **Residual risk:** As R02: the authenticator does not show the text.

#### R11 — Malicious browser extension
- **Attack:** Read or rewrite page content, request WebAuthn ceremonies.
- **Impact:** As R10.
- **Current defense / new defense:** As R10; extensions cannot export passkey private keys.
- **Residual risk:** Extensions with page access can do what the page can.

#### R12 — Phishing
- **Attack:** A look-alike site asks for the user's passkey.
- **Impact:** Signature on behalf of the user.
- **Current defense:** RP ID and origin binding of PRF assertions (off-chain).
- **New defense:** The program itself rejects any assertion whose browser-attested origin is not the
  signed "Requested by" site or whose RP ID does not cover it; passkeys of `shop.example` cannot be
  exercised on `evil.example` at all.
- **Residual risk:** A user who registers a passkey on the phishing domain itself (that key is then
  the phisher's own site's key, unrelated to the real organization).

#### R13 — Account recovery attack ("forgot password → attacker key")
- **Attack:** Take over the organization account (email reset) and enroll a new key.
- **Impact:** Attacker signs as the user.
- **Current defense:** PRF key statements; organization reset creates a new key marked
  `account_authorized`.
- **New defense:** On-chain: the old key's authority cannot be transferred without the old key; an
  organization recovery is an admin-wallet transaction recorded as `ORGANIZATION_RECOVERY` with the
  new key's possession proof; historical acceptances keep their original key.
- **Residual risk:** An organization whose recovery policy is weak can still authorize a new key —
  visibly.

#### R14 — Synced passkey account compromise
- **Attack:** Take over the user's passkey provider account (iCloud Keychain, Google Password
  Manager, a password manager) and use the synced passkey from another device.
- **Impact:** Valid signatures by the attacker.
- **Current defense / new defense:** Not detectable by WebAuthn signatures alone. Receipts report
  whether the credential is backup-eligible / backed up (synced) and the signature counter.
- **Residual risk:** Accepted and documented: a passkey signature proves control of the credential,
  not of a person or a device.

#### R15 — Program upgrade authority
- **Attack:** The upgrade key holder deploys a program that accepts forgeries or rewrites state.
- **Impact:** Every guarantee that depends on the program.
- **Current defense:** None beyond key custody (single key).
- **New defense:** Documented plan and procedure to move the authority to a Squads multisig
  (`docs/upgrade-authority.md`); verifiers re-check signatures and hashes themselves, so past
  evidence they verify does not depend on future program behavior.
- **Residual risk:** Until the transfer, one key. The program is NOT immutable.

#### R16 — Precompile introspection bugs
- **Attack:** Point the program at bytes other than those the precompile verified (offsets into
  another instruction, a second signature, an attached account, CPI, reordered instructions).
- **Impact:** Forged acceptances.
- **New defense:** One canonical layout only (§17.3): self-referencing offsets, one signature, exact
  length, no accounts, immediately preceding, top-level only. Adversarial tests:
  `programs/stele/tests/passkeys.rs` (pubkey/signature/message substitution, explicit indices, two
  signatures, accounts attached, wrong program, non-adjacent, CPI probe, high-S, r = 0) and
  `secp256r1.rs` unit tests.
- **Residual risk:** Runtime precompile defects (outside Stele).

#### R17 — Unicode / bidi content attacks
- **Attack:** Invisible or reordering characters make the rendered text differ from what a reader
  believes they accept; look-alike letters.
- **Impact:** Misleading agreement text.
- **Current defense:** Forbidden code points (bidi overrides/embeddings/isolates, zero-width space,
  BOM, tag characters…) rejected by canonicalization.
- **New defense:** §4.5 display-safety findings shown to publishers, readers and verifiers; per-block
  bidi isolation (`dir="auto"`); external links flagged as not covered by the hash; pinned references
  resolved on-chain.
- **Residual risk:** Legitimate RTL marks and joiners remain allowed (flagged, not rejected).

#### R18 — Receipt corruption or forgery
- **Attack:** Alter any claim of a receipt (text, fingerprint, transaction, signer, origin, slot,
  cluster, program, Merkle proof, root).
- **Impact:** Misleading evidence.
- **New defense:** `stele-receipt/2` claims are compared value-by-value with chain-derived facts;
  batched leaves must prove into the anchored root at the anchored count. Tests: native receipt
  tampering (text, origin, RP, signer key, title) and batched tampering (text, leaf index, proof
  element, leaf count, nonce) all yield INVALID.
- **Residual risk:** None for integrity; a lost receipt is an availability problem (R19).

#### R19 — Archival data unavailability
- **Attack/failure:** RPC providers prune history; Stele disappears; manifests are lost.
- **Impact:** Evidence cannot be re-verified.
- **New defense:** Receipts embed the document text; a missing transaction is reported INCONCLUSIVE
  (never INVALID) unless the endpoint provably holds that history; batched evidence is replicated to
  the user, the organization and the content store.
- **Residual risk:** Verification needs at least one archival RPC.

#### R20 — Batch operator manipulation
- **Attack:** Replace a leaf after anchoring; insert fake leaves; reorder; omit; anchor late.
- **Impact:** Altered or missing acceptances.
- **New defense:** Root and leaf count are anchored; domain-separated leaf/node hashes with promoted
  (never duplicated) nodes; proofs verified at the anchored count; leaves need user signatures;
  verifiers refuse anchors outside the signed window; batch ids enter the shard's append-only
  accumulator.
- **Residual risk:** Omission and delay (as censorship in direct mode); batch sizes are public.

#### R21 — Privacy correlation
- **Attack:** Link one person across organizations or reveal who accepted.
- **Impact:** Tracking.
- **Current defense:** No personal data on-chain; salted statements; per-site requests.
- **New defense:** Passkeys are per relying party, so keys differ across sites; account commitments
  are salted per account; batching hides individual recording times within a batch.
- **Residual risk:** Wallet addresses reused across sites; acceptance volumes per organization
  (approximately) public; organizations that host signing on one shared domain see one RP.

#### R22 — Software key enrolled for a user who never enrolled
- **Attack:** Whoever runs the enrollment flow (the organization's backend, or Stele's relayer acting
  for it) generates a P-256 key in software, enrolls it for an account that has never had a passkey
  (or uses it as a key-only signer), and signs acceptances with it — origin, RP ID and UV flags set
  to whatever the attacker likes.
- **Impact:** Acceptances attributed to a person who never made them, indistinguishable on-chain from
  a genuine passkey's.
- **Current defense:** None specific: the program verifies that a key signed, not whose key it is.
  Synced passkeys carry no attestation, so a genuine authenticator cannot be required.
- **New defense:** Stated, not engineered away: the trust model and every public claim limit the
  guarantee to enrolled keys ("nobody can sign for an enrolled user, or add, edit or backdate
  evidence"). Once an account is enrolled, a second key needs the current key's rotation or a
  labeled organization recovery (R03), and every enrollment is public with its time.
- **Residual risk:** The first enrollment of an account, and every key-only signer, is trusted to
  whoever ran the ceremony. Options under study: enrollment attestation for device-bound
  authenticators, and letting users monitor enrollments made for their account.

#### R23 — Evidence unreadable years later
- **Attack / failure:** The transactions that hold direct-mode evidence are no longer served by the
  RPC providers a verifier can reach (most public endpoints keep only recent history); a batch
  manifest disappears.
- **Impact:** A valid acceptance becomes `INCONCLUSIVE` instead of `VALID`.
- **Current defense:** Receipts carry the exact text, the signatures and the transaction signature;
  batched receipts carry their Merkle proof; account state (versions, enrollments, nonce bits) stays
  readable from any RPC.
- **New defense:** Public wording says "any archival Solana RPC"; manifests are public and can be
  mirrored.
- **Residual risk:** Long-term verification depends on archival RPC providers or a self-run archival
  node; organizations should keep receipts and manifests.

### 7.3 Invariants added by `stele/2` and their tests

| # | Invariant | Enforced by | Checked by |
|---|---|---|---|
| 21 | No user private key outside the authenticator (primary path) | native ES256 passkeys; nothing wrapped or stored | `key-only: … nothing secret stored` (API) |
| 22 | Only the precompile-verified bytes are trusted | §17.3 layout checks | `passkeys.rs` adversarial suite |
| 23 | Message, site and RP are bound on-chain | §17.4 | `never relays an assertion the program would reject` (API), `passkeys.rs` |
| 24 | Only the current key can hand over an enrollment | `rotate_passkey_signer` | `account mode` (API), `passkeys.rs` |
| 25 | Organization recovery is visibly different | `kind = ORGANIZATION_RECOVERY` | `account mode` (API, verifier "NOT endorsed") |
| 26 | Relayer cannot fabricate acceptances or rotations | precompile + program | `forgery-demo` (4 attempts, all rejected) |
| 27 | Historical evidence survives rotation and revocation | append-only state, verifier history checks | `account mode` (old receipt still VALID) |
| 28 | Batched leaves cannot be altered after anchoring | Merkle root + anchored count | `batch.rs`, `batches.rs`, `batches.localnet` tampering |
| 29 | Old receipts and accounts keep their meaning | new formats only (§15.4–15.5) | all `stele/1` suites unchanged |
| 30 | Wallet origins are never presented as browser-attested | verifier origin semantics | report `origin.attestation` (warning) |

## 8. Stele Gate (`require_current`)

Added with Stele Gate (PROTOCOL_SPEC.md §18): `GatePolicy`, `AccessPass`, `create_policy`,
`set_policy_requirement`, `record_gated_acceptance`, the `stele-gate` crate and the Atlas vault demo
program. Everything in §1–§7 still holds. Gate adds one new property to defend: **a protected action
runs only for a wallet that accepted the required version**. Stele is never in the protected
transaction (no CPI, proxy or shared signer), so a Stele outage cannot authorize an action — and
cannot block one for a wallet whose pass is already current.

### 8.1 New assets

| ID | Asset | Note |
|---|---|---|
| AS20 | `AccessPass` accounts | Only `record_gated_acceptance` writes them, after a runtime-verified signature of the holder |
| AS21 | `GatePolicy` accounts | Changed only by the organization's owner, admins and publishers, by wallet signature |
| AS22 | The protected program's integration | Outside Stele: pinning the policy and calling `require_current` in every protected instruction |

### 8.2 Scenarios

Format: **Attack** · **Impact** · **Defense** · **Residual risk**. Tests are in
`programs/stele/tests/gate.rs` (LiteSVM), `crates/stele-gate` (unit), `packages/protocol/test/gate.test.ts`,
`packages/sdk/test/gate.test.ts` and `tools/localnet/src/gate-smoke.ts` (local validator).

#### G01 — Direct call that skips the frontend
- **Attack:** Build the deposit transaction with a script or the CLI, never seeing the terms.
- **Impact:** Investment without the required acceptance.
- **Defense:** `require_current` runs inside the protected program: no pass → `AccessPassMissing`
  (test `direct_bypass_attempts_fail_on_chain`; `gate-smoke`; `vault-deposit` against a local
  validator shows the failed transaction).
- **Residual risk:** None in the program; integrations that omit the call are G15.

#### G02 — Someone else's pass
- **Attack:** Pass the address of a wallet that did accept.
- **Impact:** Borrowed access.
- **Defense:** The pass's holder must equal the transaction signer, and the pass must sit at
  `["access-pass", document, signer]` → `AccessPassMismatch` / `AccessPassInvalid`.
- **Residual risk:** A user who lends their wallet lends their acceptance (a key holder is not necessarily the person — §5).

#### G03 — Forged pass account
- **Attack:** Create an account with pass-shaped data: system-owned, owned by another program, or a
  Stele-owned account of another type or at another address.
- **Impact:** Fake access.
- **Defense:** Owner = Stele program, pass discriminator and length, canonical PDA with the stored
  bump; only the Stele program can write accounts it owns and it writes the pass type only in
  `record_gated_acceptance` (tests: system-owned, off-canonical Stele-owned, system account at the
  PDA → `AccessPassMissing`).
- **Residual risk:** A Stele program defect or a malicious upgrade (R15).

#### G04 — Policy of the attacker's own
- **Attack:** Create an organization, a document and a policy requiring nothing the attacker has not
  accepted, and pass that policy.
- **Impact:** Access under the wrong terms.
- **Defense:** Protected programs pin the policy (`#[account(address = vault.policy)]` in the demo →
  `WrongPolicy`); `require_current` also checks the policy's owner, type and canonical address
  (`InvalidPolicy`).
- **Residual risk:** An integration that does not pin the policy is not protected (G15). Documented
  as a MUST (§18.4).

#### G05 — Relayer assigns a pass to a wallet that never signed
- **Attack:** The relayer (or a thief of its key) records a gated acceptance naming another holder.
- **Impact:** Fabricated access and evidence.
- **Defense:** `holder` must equal the Ed25519 signer that the runtime verified; the relayer cannot
  produce the holder's signature (test `the_pass_belongs_to_the_signer_never_to_an_account_the_relayer_names`).
- **Residual risk:** None beyond R01 (censorship).

#### G06 — Replayed or altered acceptance
- **Attack:** Resubmit a signed gated acceptance, or change its version, document or time.
- **Impact:** Duplicate or misdated evidence.
- **Defense:** The `record_acceptance` checks (§8): exact message reconstruction, single-use nonce
  bit, validity window, current version only (test `a_tampered_or_replayed_gated_acceptance_creates_no_pass`).
- **Residual risk:** None known.

#### G07 — Recording through another program (CPI)
- **Attack:** A program invokes `record_gated_acceptance` to bundle or hide the signature.
- **Impact:** Ambiguous evidence.
- **Defense:** Top-level only, as every signature-carrying instruction (test `gated_acceptance_cannot_be_invoked_through_cpi`).
- **Residual risk:** None known.

#### G08 — Outdated pass after a terms update
- **Attack:** Keep depositing under v1 after the organization requires v2.
- **Impact:** Actions under superseded terms.
- **Defense:** `version_number < required_version` → `AccessPassOutdated` (tests
  `deposits_require_the_current_offering_terms`; `gate-smoke`).
- **Residual risk:** Publishing v2 alone changes nothing until v2 is required — intended, and shown
  in the dashboard.

#### G09 — Same number, different fingerprint
- **Attack:** A pass naming version N of the policy's document with another fingerprint.
- **Impact:** Access under different text.
- **Defense:** Equal numbers require equal fingerprints (`FingerprintMismatch`). Versions are
  immutable, so this needs corrupted state — the check is defense in depth (test
  `forged_policies_and_fingerprints_are_rejected`).
- **Residual risk:** None known.

#### G10 — Pass for another document
- **Attack:** Use a pass for another document of the same organization, or of another one.
- **Impact:** Access under unrelated terms.
- **Defense:** Pass document and organization must equal the policy's; the address is derived from
  the policy's document → `AccessPassMismatch` / `AccessPassInvalid`.
- **Residual risk:** None known.

#### G11 — Unsigned user account
- **Attack:** Name the victim's wallet without its signature.
- **Impact:** Act under someone else's pass.
- **Defense:** `UserNotSigner`; the demo also declares the investor a `Signer`.
- **Residual risk:** None known.

#### G12 — Policy raised between acceptance and action
- **Attack / failure:** Accept & Continue is two transactions; the requirement changes in between.
- **Impact:** The action fails after the user accepted.
- **Defense:** Fails safe: `AccessPassOutdated`; the SDK re-checks and shows the new version. If the
  document changes while the modal is open, the SDK refuses to sign the old text (`StaleTermsError`).
- **Residual risk:** UX only. Not atomic — stated in every public description.

#### G13 — Organization quietly lowers or changes the requirement
- **Attack:** An insider sets the policy back to an older version.
- **Impact:** Users act under older terms than investors expect.
- **Defense:** Only owner/admin/publisher wallets can change it, never while frozen; every change is a
  `PolicyChanged` event with the previous requirement, shown in the dashboard and indexed.
- **Residual risk:** The policy is the organization's own decision; Stele makes it public, not
  impossible.

#### G14 — Pass-rent drain
- **Attack:** Many new wallets each accept once, so the relayer pays ≈0.0025 SOL rent per pass.
- **Impact:** Cost to Stele.
- **Defense:** The existing relay limits: rate-limited challenges, optional server-issued acceptance
  sessions, allowed request domains, relayer balance alerts.
- **Residual risk:** Real for organizations that allow anonymous acceptances; recommend acceptance
  sessions for Gate documents.

#### G15 — Incomplete integration
- **Attack / failure:** A protected instruction forgets `require_current`, or accepts any policy.
- **Impact:** No enforcement on that path.
- **Defense:** Documentation (MUST rules), the dashboard's wizard and live checks, test templates for
  the four scenarios.
- **Residual risk:** Stele cannot inspect a program's code. Integrators own this.

#### G16 — Demo relay abused
- **Attack:** Use the public demo's deposit relay to get arbitrary transactions paid.
- **Impact:** Relayer funds spent.
- **Defense:** The relay accepts exactly one demo `deposit` (plus an optional compute-unit limit) for
  the session's own vault and policy, with the relayer only as fee payer; per-session, per-IP and
  daily caps; disabled on mainnet.
- **Residual risk:** Small fees within the caps.

### 8.3 Invariants added by Gate and their tests

| # | Invariant | Enforced by | Checked by |
|---|---|---|---|
| 31 | A protected action needs a current pass of the signer | `require_current` in the protected program | `direct_bypass_attempts_fail_on_chain`, `deposits_require_the_current_offering_terms`, `gate-smoke` |
| 32 | Only the holder's own signature creates or advances a pass | `holder == verified signer` | `the_pass_belongs_to_the_signer_never_to_an_account_the_relayer_names` |
| 33 | The user pays nothing to accept | relayer pays fee and rent | `a_gated_acceptance_creates_the_holders_pass_and_the_user_pays_nothing` |
| 34 | A pass never goes back to an older version | `record_gated_acceptance` | program check; current-version-only recording |
| 35 | Earlier acceptances stay verifiable after a requirement change | append-only acceptances | `gate-smoke` (Proof receipt `VALID`) |
| 36 | Stele is not in the protected transaction | read-only check, no CPI | crate design; demo program has no Stele CPI |
