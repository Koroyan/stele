# Threat model

This page summarizes Stele's threat model: who might attack an agreement record, how, and what stops
each attack. The model was written before the code, and every security-relevant change is reviewed
against it.

## Scope and assumptions

- **Assets:** the integrity of published versions, the authenticity and uniqueness of acceptances, the meaning of organization identity, the availability of evidence, users' privacy, and the confidentiality of operator and customer secrets.
- **Trusted:** Solana consensus and finality, SHA-256, Ed25519 and P-256, the program (target: audited, reproducible build, multisig upgrade authority — today it is unaudited and its upgrade authority is a single key), and — only for what "verified domain" means — DNS and the domain attestor. Two things are trusted to whoever runs them: what the signing page displays, and which key is enrolled for an account (see the [trust model](trust-model.md)).
- **Not trusted:** Stele's API, database, indexer, relayer and web app; RPC providers; storage providers; integrators' sites; and any single party's claims about what was agreed.

## Attacker profiles

Malicious companies and employees, compromised administrators, users who later deny accepting, stolen wallets and devices, bots and Sybils, malicious frontend operators, compromised backends, rogue database administrators, API attackers with stolen credentials, phishing sites, malicious browser extensions, replay attackers, network attackers, compromised RPC and storage providers, malicious integrators, a malicious multisig signer, XSS/CSRF attackers and supply-chain attackers.

## Scenario index (134 scenarios)

Each row gives the primary defense. Where software cannot remove a risk entirely, it is listed under [residual risks](#residual-risks).

### Document integrity (malicious company)

| ID | Scenario | Primary defense |
|---|---|---|
| T01 | Company changes the ToS after users accepted it | `DocumentVersion` accounts have no update or close instruction (P1). |
| T02 | Company displays one document but commits another hash | Stele's acceptance page and SDK component render **only content whose SHA-256 the browser recomputed and matched against the on-chain account**. |
| T03 | Company creates a second, similar document and claims it was the accepted one | Acceptance binds to an exact `DocumentVersion` via its fingerprint, which commits to organization address, document address, version number, previous fingerprint, title, label, locale, … |
| T04 | Formatting / encoding / whitespace tricks to create ambiguous hashes | `stele-canonical-v1` (§4): strict UTF-8, BOM stripped, CRLF/CR → LF, NFC, tabs → space, per-line trim, space-run collapse, forbidden invisible/bidi/control code points rejected, typed … |
| T05 | Company changes the content at an external URL after publishing the hash | Storage is content-addressed by SHA-256. |
| T06 | Company deletes the original file | Redundant storage: Stele archive (object storage) + optional Arweave permanent copy + database copy. |
| T07 | Company changes metadata while keeping the text similar | All metadata is inside the version fingerprint, computed **on-chain** from the account's own fields. |
| T08 | Company backdates a ToS | `published_at`/`published_slot` are written by the program from the cluster clock. |
| T09 | Company claims a document existed earlier than it did | The earliest provable existence of content is the publication time of the first version committing to it. |
| T10 | Company publishes many versions rapidly to create ambiguity | Every acceptance binds to an exact fingerprint. |

### Organization authority

| ID | Scenario | Primary defense |
|---|---|---|
| T11 | Company administrator account is compromised | Admins cannot grant ADMIN or touch other admins (owner-only). |
| T12 | Employee publishes an unauthorized ToS | Least privilege (separate PUBLISHER role). |
| T13 | One company impersonates another | Display name ≠ identity. |
| T14 | Fake company registers a famous domain or brand lookalike | Only lowercase ASCII LDH hostnames are accepted. |

### User disputes

| ID | Scenario | Primary defense |
|---|---|---|
| T15 | User claims "I never accepted this" | The record contains the user's Ed25519 signature over a message naming the organization, document, version, fingerprint, the user's own account, the network and validity window — … |
| T16 | User claims "someone else accepted this for me" | We never claim human identity (P10). |
| T17 | Creating an acceptance using another user's wallet address | The program reads the signer **from the Ed25519 instruction that the runtime verified** and requires the message's `Account:` line to equal it. |
| T18 | Backend creates an acceptance without the user signing | Same as T17: the backend holds no user keys. |
| T19 | Frontend modifies the payload before signing | The wallet — not our page — displays the full message text, including organization, document, version and fingerprint. |
| T20 | Malicious site tricks the user into signing a different ToS | Message names organization + verification status + document + version + `Requested by: <domain>`. |

### Signature reuse and replay

| ID | Scenario | Primary defense |
|---|---|---|
| T21 | Signature reused for another agreement | . |
| T22 | Signature reused for another company | Organization name, verification status, and (via the fingerprint) the organization address are bound. |
| T23 | Signature reused for another version of the same document | Version label, version number (`#n`) and fingerprint are bound. |
| T24 | Signature replayed later | Each challenge consumes a nonce bit `(shard, index)` on-chain — a second recording fails with `NonceAlreadyUsed`. |
| T25 | Devnet signature reused on mainnet | Message includes `Network: Solana Mainnet\|Devnet\|…` read from the immutable `ProtocolConfig.network_label`. |
| T26 | Signature produced for another application/domain reused here | The message begins with the fixed line `Stele Protocol v1 - Accept Agreement`. |
| T27 | User signs a blank or ambiguous message | We never request signatures over blank, hash-only or free-form text. |
| T28 | User signs a hash without understandable context | The pre-sign review screen and the wallet message both show organization, verified domain, document title, version, fingerprint, network, account, validity and requester. |

### Infrastructure attacks

| ID | Scenario | Primary defense |
|---|---|---|
| T29 | API request modified between frontend and backend | TLS everywhere (HSTS). |
| T30 | Backend database completely compromised | The DB contains **no evidence**: no keys, no authority. |
| T31 | Database administrator edits acceptance records | Same as T30. |
| T32 | RPC provider returns misleading information | The verifier supports multiple independent endpoints and requires agreement. |
| T33 | Storage URL returns different content | Hash check on every read (T05). |
| T34 | IPFS/Arweave content unavailable | Mirrors, receipt-embedded content, DB copy, company export. |

### Key lifecycle

| ID | Scenario | Primary defense |
|---|---|---|
| T35 | Wallet stolen after acceptance | Past records are immutable. |
| T36 | Wallet stolen before acceptance | None cryptographic. |
| T37 | User rotates wallet/account | Old acceptances remain valid evidence for the old key. |
| T38 | Organization rotates signing authority | Two-step owner transfer (`propose_owner` → `accept_ownership`). |
| T39 | Organization key compromised | Owner as multisig. |
| T40 | A multisig signer becomes malicious | Squads threshold (≥ 2-of-3 recommended), Squads time lock, signer rotation inside Squads without changing the Stele owner address. |
| T41 | Former owner/employee still has a key | Revoke membership (`revoked_at`). |

### Platform compromise

| ID | Scenario | Primary defense |
|---|---|---|
| T42 | Frontend JavaScript is compromised | Wallet-displayed message (T19). |
| T43 | DNS/domain hijacked | HSTS preload, CAA records, registrar lock, DNSSEC. |
| T44 | Session hijacked | HttpOnly/Secure/SameSite cookies. |
| T45 | API token stolen | Keys are scoped (`acceptances:read`, `acceptances:write`, `documents:read`), prefixed for secret-scanning, stored hashed, revocable, optionally expiring. |
| T46 | Signature request injected into another browser session | Challenges are bound to the requesting session/acceptance-session token and to the signer key at issuance. |

### Concurrency and reliability

| ID | Scenario | Primary defense |
|---|---|---|
| T47 | Race conditions while publishing versions | Optimistic concurrency **on-chain**: the publish instruction requires `version == version_count + 1` and `previous_version_hash == head_hash`. |
| T48 | Two admins publish simultaneously | Same as T47. |
| T49 | Transaction succeeds on frontend but indexing fails | Chain is the source of truth. |
| T50 | Indexer reports incorrect data | Indexer output is never evidence. |
| T51 | Blockchain transaction fails but backend marks it successful | Status transitions require reading the transaction from RPC with `meta.err == null` at `confirmed`, and to `finalized` later. |
| T52 | User signs but the transaction is never submitted | UI shows "Recording…" until confirmation and only then "Agreement Verified ✓". |
| T53 | User submits the same acceptance twice | Nonce bit consumption (second fails). |
| T54 | Bot spams millions of acceptance records | Shards are **relayer-gated** (only the shard's designated relayer can record), so bots cannot self-submit. |
| T55 | Denial of service through Solana transaction spam | Priority fees, retries, multiple RPC/sender endpoints, generous signed validity windows. |

### History hiding

| ID | Scenario | Primary defense |
|---|---|---|
| T56 | Organization tries to remove historical evidence | No close instruction for `Organization`, `Document`, `DocumentVersion`, `Member`, `NonceShard`. |
| T57 | Organization tries to hide a previous version from the UI | Stele's public pages render the full chain from `version_count` down to v1 by PDA derivation — not from a curated list. |
| T58 | UI intentionally shows incomplete history | History count is checked against on-chain `version_count`. |
| T59 | Explorer/backend disagrees with the blockchain | Chain wins. |
| T60 | Content encoding produces different hashes on different devices | Canonicalization happens once, at authoring time, producing canonical **bytes** that are stored and hashed. |

### Additional scenarios identified during design

| ID | Scenario | Primary defense |
|---|---|---|
| A01 | Malicious program upgrade rewrites account state | Upgrade authority held by a Squads multisig with time lock. |
| A02 | Ed25519 instruction indirection / offset attack | The program requires: preceding instruction's program ID = Ed25519 program. |
| A03 | Fake instructions sysvar account | `address = sysvar::instructions::ID` constraint. |
| A04 | Malicious program CPIs into `record_acceptance` | The program requires stack height 1 and that the instruction at the current top-level index is itself (`program_id == stele`), so CPI invocations are rejected (tested with a forwarding program). |
| A05 | Unicode deception (Trojan Source, invisible characters, homoglyph names) | Bidi embedding/override/isolate characters (U+202A–202E, U+2066–2069), zero-width and invisible format characters (U+200B, U+2060–2064, U+FEFF), C0/C1 controls, private-use, tag and … |
| A06 | Domain expires and is re-registered by an attacker | Attestations expire (≤ 400 days) and must be renewed via fresh DNS checks. |
| A07 | Nonce-bitmap exhaustion (DoS) | Relayer-gated shards (only the designated relayer can consume bits). |
| A08 | Oversized names cause un-relayable transactions | Strict on-chain length limits (org name ≤ 40 B, domains ≤ 48 B, title ≤ 60 B, label ≤ 16 B) chosen so the worst-case acceptance transaction fits in 1,232 bytes. |
| A09 | Domain attestor key compromised | Attestor can only set/renew/revoke domain attestations — it cannot publish, accept, or edit history. |
| A10 | XSS via document content or names | No HTML in content — typed blocks rendered as React text nodes. |
| A11 | CSRF against dashboard API | SameSite=Lax cookies, Origin allow-list for state-changing requests, double-submit CSRF token header, JSON-only bodies. |
| A12 | Malicious integrator spoofs the SDK UI | The SDK widget renders only hash-verified content with the full review summary, and the wallet itself displays the exact message signed. |
| A13 | Company rename after publication to mislead | Rename is an on-chain, audited event. |
| A14 | Supply-chain attack (npm/crates/CI) | Lockfiles committed. |
| A15 | Webhook spoofing / replay | HMAC-SHA256 over `timestamp.body` with a per-endpoint secret. |
| A16 | Login message confused with acceptance message (or vice versa) | Distinct, fixed first lines and structures. |
| A17 | SSRF via webhook URLs or domain verification | Webhook URLs must be `https`, resolve to public IPs (private/link-local/loopback/metadata ranges blocked, re-checked at connection time to defeat DNS rebinding), no redirects, short … |
| A18 | Timing attacks on secret comparison | Secrets compared via SHA-256 digests with `timingSafeEqual`. |
| A19 | Privacy: on-chain correlation of a user's acceptances | No personal data on-chain — only public keys. |
| A20 | Fork/reorg between "confirmed" and "finalized" | Receipts show commitment level. |
| A21 | Front-running organization creation | Organization PDA seeds include the creator's key, so nobody else can create an organization at an address someone intends to use. |
| A22 | TOCTOU between publication preparation and signing | The publish instruction carries `expected_version_hash`. |
| A23 | Fake "verifier" websites | Open-source verifier library and CLI. |
| A24 | Sensitive data in logs | Structured logging with redaction paths (authorization headers, cookies, tokens, secrets, signatures, emails). |

### Walletless signing, fee sponsorship and proofs

| ID | Scenario | Primary defense |
|---|---|---|
| W01 | The database is stolen: can someone sign as a passkey user? | Stele stores only AES-256-GCM ciphertext of each signing key, keyed by the passkey's PRF output, which never leaves the authenticator. No server-held or password-derived copy exists. |
| W02 | Database write access swaps a user's passkey for the attacker's | The user's Ed25519 signature is still required and verified on-chain; the attacker has no key. |
| W03 | Stele or the organization signs "for" a walletless user | Impossible as for wallets: only the key holder can sign, and the program rebuilds the message. |
| W04 | A stolen, unlocked key is used to record other messages | Stele relays a passkey signer's record only with a user-verified passkey assertion over that exact message; receipts carry it. |
| W05 | A phishing site asks for the passkey signature | Passkeys are bound to the site's origin; the signed message names the requesting site; verifiers check both. |
| W06 | Offline brute force of a stored key | The wrapping key derives from a 256-bit PRF output, not a password. |
| W07 | A browser without PRF | Walletless signing is refused; the visitor is offered a wallet. Never a server-held key. |
| W08 | Email or account takeover | Adding passkeys or recovery kits requires a statement signed by the key. Losing every unlock method leads to a **new** key, flagged as authorized by the organization's account system — never control of the old key; past records stay valid. |
| W09 | Silent passkey changes | Every change is in the append-only audit log, sent as a webhook, and published as key statements. |
| W10 | Draining an organization's fee deposit | The deposit (a nonce shard) has no private key; the program reimburses only the designated relayer, only the exact fee of a verified recording, within per-record and daily caps; only the owner withdraws. |
| W11 | Sponsorship changes who authorized a record | Reimbursement runs after, and independently of, authorization; invalid records pay nothing. |
| W12 | The relayer key signs something else | One code path, with an allowlist of the exact transaction shape, before every signature. |
| W13 | The user is made to pay | Users sign messages, never transactions; the relayer pays; signer accounts need no SOL. |
| W14 | A customer is shown one order but signs another | The SDK hashes the statement it shows and refuses to sign unless the message names that hash; verifiers recompute it from the receipt. |
| W15 | A proof is moved to another organization or network | The message names the organization address and chain ID; the program rebuilds both. |
| W16 | An acceptance signature is replayed as a proof | Different message formats; shared single-use nonces. |
| W17 | Order details leak | Only a salted hash is on-chain; personal fields can be commitments; proof receipts require the organization's key or the customer's token. |
| W18 | A receipt claims passkey evidence or a fee payer it does not have | Every claim is re-verified; altered receipts are reported invalid. |
| W19 | Biometric data leaks | WebAuthn never exposes biometrics; receipts contain flags, origin and signatures only. |
| W20 | A cloned authenticator | Signature counters must increase; synced passkeys depend on their platform account (documented). |

### Native passkeys, batched evidence and the security review (`stele/2`)

| ID | Scenario | Primary defense |
|---|---|---|
| R01 | A malicious Stele operator records acceptances users never made | No user key exists outside the authenticator; every record needs a passkey signature verified by Solana's secp256r1 program and bound by the Stele program to message, site and relying party. Simulated forgeries by an operator holding the relayer key against an enrolled user are rejected. A key the operator enrolls itself is R22. |
| R02 | A malicious organization takes over a user's signer | Rotation needs the current passkey; recovery needs the organization's admin wallet and is shown to every verifier as an organization recovery. |
| R04 | Altered widget code shows one text and requests another | The SDK recomputes the challenge from chain data; published Subresource Integrity hash; isolated hosted signing page; cross-origin frames rejected on-chain. |
| R05 | A database maps an account to an attacker's key | Account-bound keys are enrolled on-chain; the program enforces the enrollment. |
| R07 | The relayer key is stolen | Strict per-instruction allowlist; it cannot pass any check that needs a user signature. |
| R12 | Phishing | The program rejects assertions whose browser-attested origin is not the requesting site. |
| R14 | A synced passkey account is compromised | Not detectable by signatures; receipts report backup state. Documented. |
| R15 | The program upgrade key | Single key today (not immutable); multisig procedure documented; verifiers re-check evidence themselves. |
| R16 | Precompile introspection tricks | One canonical layout, adjacent, self-referencing, top-level only; adversarial tests. |
| R17 | Invisible or look-alike characters | Forbidden code points rejected; remaining ones flagged to publishers, readers and verifiers; per-paragraph bidi isolation. |
| R18 | A receipt is altered | Every claim re-derived; batched leaves must prove into the anchored root. |
| R20 | A batch operator swaps or invents leaves | Root and leaf count anchored; leaves need user signatures; anchors outside the signed window are refused. |
| R22 | Whoever runs enrollment registers a software key for a user who never enrolled | Not preventable by signatures (synced passkeys carry no attestation); guarantees are stated for enrolled keys only; later key changes need the current key or a labeled recovery; enrollments are public. |
| R23 | Evidence cannot be read years later | Receipts carry text, signatures and proofs; verification needs an archival Solana RPC. |

### Stele Gate (`require_current`)

| ID | Scenario | Primary defense |
|---|---|---|
| G01 | A script or the CLI calls the protected instruction directly, skipping the terms | `require_current` runs inside the protected program: no pass, no action (`AccessPassMissing`). |
| G02 | Someone presents another wallet's pass | The pass's holder must be the transaction's signer, at the address derived from that signer. |
| G03 | A forged pass account | Owner must be the Stele program, with the pass type and its canonical address; only Stele writes it, and only after a verified signature. |
| G04 | A policy the attacker created | The protected program pins its policy's address; `require_current` checks the policy's owner, type and address. |
| G05 | The relayer assigns a pass to a wallet that never signed | The holder must equal the signer Solana verified; the relayer cannot sign for users. |
| G06 | A gated acceptance is replayed or altered | Exact message reconstruction, single-use nonce, validity window, current version only. |
| G07 | Recording through another program | Signature-carrying instructions are top-level only. |
| G08 | Acting under v1 after the organization requires v2 | Older passes fail with `AccessPassOutdated` until the holder accepts v2. |
| G09 | A pass names the required number with other text | Equal version numbers must have equal fingerprints. |
| G10 | A pass for another document | Document and organization must be the policy's. |
| G11 | The victim's wallet named without its signature | `UserNotSigner`. |
| G12 | The requirement changes between acceptance and action | Fails safe (`AccessPassOutdated`); the SDK re-checks and shows the new version. Not atomic — stated publicly. |
| G13 | The organization lowers the requirement | Only its role holders can, never while frozen; every change is a public `PolicyChanged` event with the previous value. |
| G14 | Mass new wallets drain pass rent | Rate-limited relay, optional server-issued acceptance sessions, allowed domains, balance alerts. |
| G15 | A protected instruction forgets the check or accepts any policy | Documented MUST rules, integration wizard, live checks and test templates. Stele cannot inspect your code. |
| G16 | The public demo's relay is abused | Exactly one demo deposit for the session's own vault and policy; per-session, per-IP and daily caps; off on mainnet. |

## Residual risks

Some risks are reduced but cannot be eliminated by software. They are stated openly:

| Risk | Why it remains | Mitigation |
|---|---|---|
| A key holder is not necessarily the person | Keys can be stolen, shared or used under coercion | Stele states only what a signature proves; integrators can link acceptances to their own signed-in users |
| A malicious program upgrade | Whoever controls upgrades could change future behavior | Multisig with time lock, reproducible builds, verifiers cross-check publication transactions; past ledger history cannot be rewritten |
| Every RPC provider consulted lies in the same way | The verifier reads Solana through providers | Use several independent providers, or your own node |
| The domain attestor's key is stolen | It could vouch for a domain falsely until rotated | Limited power, expiring attestations, live DNS re-checks by verifiers |
| Users do not read what they sign | Consent is to exact text, not proof of comprehension | Short, plain messages; a review screen before signing |
| Every copy of a document's text is lost | Solana stores commitments, not the text | Receipts embed the text; mirrors, IPFS and Arweave copies |
| Public keys can be linked across sites | Acceptances are public records | No personal data on-chain; use separate keys for privacy |
| Insiders misuse the roles they were given | Authority is role-based | Multisig owners, attributable on-chain actions, alerts |
| Some hardware wallets cannot sign messages | A wallet limitation | Documented; an alternative signing scheme is planned |
| The cluster clock drifts | Timestamps come from Solana | Bounded skew checks; slots are recorded with times |
| Account recovery can produce a new walletless key | When a user loses every passkey and recovery kit, only the organization can vouch for them | The new key is a separate, flagged identity; the old key is retired, never recovered |
| Synced passkeys depend on the platform account | Apple, Google and password managers sync passkeys | Documented; organizations may prefer wallets or device-bound passkeys |
| A compromised relayer can spend a sponsorship deposit on fees | Fees for throwaway recordings go to validators | Per-record and daily caps, pause, low-balance alerts |
| An unlocked key on a compromised page | Script injection during the one signature | Single-signature unlock; Stele requires the passkey assertion; strict CSP |
| Passkey prompts do not show the agreement | WebAuthn has no "what you see is what you sign" | The signing page shows only hash-verified text; the challenge is computed from it by the SDK; isolated hosted signing page |
| The page that requests a passkey decides what is signed | The organization controls its own site | Domain-separated statement types; rotations and recoveries are public events; prefer Stele's hosted page when the organization is not trusted |
| Batched acceptances can be omitted or delayed | The batch operator chooses what to anchor | As refusal to relay in direct mode; users and organizations keep the evidence |
| The program upgrade authority is a single key | Devnet deployment stage | Move to a multisig before production (procedure published) |
| The first enrollment of an account is trusted | The program cannot tell a passkey from a software P-256 key | Guarantees stated for enrolled keys only; enrollments are public; prefer Stele's hosted page when the organization is not trusted |
| Old transactions need an archival RPC | Most public RPC endpoints keep only recent history | Keep receipts and batch manifests; use an archival provider or node |
| Gate enforcement depends on the integration | Stele cannot inspect a protected program | Pin the policy, call `require_current` in every protected instruction, keep the four bypass tests |
| Accept & Continue is two transactions | The acceptance is relayed and paid by Stele; the action is the user's own transaction. Merging them would put Stele's relayer into every protected transaction | The acceptance stays recorded if the action fails; the program check fails safe |
| A Gate policy is the organization's decision | It may require, raise or lower a version | Every change is public with its previous value |
