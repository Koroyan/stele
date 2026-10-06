# Stele — System Architecture

> **Internal documentation.** Repository only: not published on the website.

> **Stele** — *verifiable agreement infrastructure.*
> Publish immutable agreement versions and record cryptographically verifiable acceptance on Solana.
>
> Core rule: **Don't trust the website. Verify the evidence.**

This document explains how the system is built and why each decision was made. The normative wire
formats live in [PROTOCOL_SPEC.md](PROTOCOL_SPEC.md); the adversarial analysis lives in
[SECURITY_THREAT_MODEL.md](SECURITY_THREAT_MODEL.md). Where this document and the protocol spec
disagree, the protocol spec wins.

---

## 1. What the system proves — and what it does not

| Fact | How it is evidenced | Who can verify |
|---|---|---|
| **Which organization** published a version | `DocumentVersion` account is a PDA under the `Organization` PDA; the publish transaction was authorized by the org owner or an on-chain publisher member | Anyone with a Solana RPC |
| **Who** (which key) published it | `publisher` + `publisher_role` recorded by the program at publication; the publish transaction signature | Anyone |
| **What exact content** existed | `content_hash = SHA-256(canonical content bytes)`; content is stored off-chain and re-hashed on every read | Anyone with the content bytes |
| **Which exact version** | Monotonic version number, enforced by PDA seeds and an on-chain `version_count` | Anyone |
| **When** it was published | Solana slot + cluster `unix_timestamp` recorded by the program, not supplied by the client | Anyone |
| **What the previous version was** | `previous_version_hash` is checked on-chain against the document's `head_hash` — the chain is enforced by the program, not merely asserted | Anyone |
| **Whether content changed** | Any change to content changes `content_hash`, which changes the version fingerprint; old versions are immutable accounts with no update or close instruction | Anyone |
| **Which signing key accepted** | Ed25519 signature over a human-readable, domain-separated acceptance message, verified **on-chain** by the native Ed25519 program and re-verifiable off-chain | Anyone |
| **Which exact version that key accepted** | The signed message contains the version fingerprint; the program reconstructs the expected message from on-chain state and requires byte equality | Anyone |
| **When acceptance happened** | Slot/block time of the recording transaction; signed `issued`/`expires` window enforced on-chain | Anyone |
| **Whether acceptance evidence was modified** | The signed message, signature and recording instruction live in the immutable ledger; a per-shard hash accumulator commits to every acceptance ever recorded | Anyone with an archival RPC |

**What it does not prove** (and the product never claims): that a specific human being read,
understood, or personally clicked anything. A signature proves that *whoever controlled the signing
key* authorized an acceptance of an exact document version. Identity binding (KYC/SSO) and legal
effect are separate layers. See §11.

---

## 2. Design principles

1. **Evidence over databases.** Every fact a third party may need to rely on is either (a) on
   Solana, (b) committed to by a hash that is on Solana, or (c) a signature by a key whose authority
   is recorded on Solana. The PostgreSQL database is an index and a cache. It can be deleted and
   rebuilt from chain + storage.
2. **Program-enforced invariants, client-supplied nothing.** The program computes the version
   fingerprint itself from on-chain state plus validated arguments, reconstructs the exact
   acceptance message itself, and takes all timestamps from the cluster clock.
3. **Append-only history.** There is no instruction that edits or closes a `DocumentVersion`, and no
   instruction that edits an acceptance. Superseding is a *new* version; "status" is derived.
4. **Explicit intent.** Users sign a plain-language, structured message that names the organization,
   document, version, fingerprint, network, signing account, validity window and requesting domain.
   Never a bare hash.
5. **Domain separation everywhere.** Every hash preimage and signed message carries a format or
   protocol identifier, the network (CAIP-2 chain ID), and the program ID.
6. **Independent verification is a first-class product.** The verifier is a standalone library
   (`@stele/verifier`) and CLI that talks directly to Solana RPC and content storage. The website's
   `/verify` page runs that same library *in the user's browser*.
7. **Honest language.** "Cryptographically verifiable evidence", "tamper-evident history",
   "verifiable proof of acceptance authorization". Never "legally impossible to dispute".

---

## 3. System context

```
                         ┌───────────────────────────────────────────────────────────┐
                         │                         Solana                            │
                         │  ┌─────────────────────────────────────────────────────┐  │
                         │  │ stele program (Anchor 1.x)                           │  │
                         │  │  ProtocolConfig · Organization · Member · DomainRecord│  │
                         │  │  Document · DocumentVersion · NonceShard (bitmap)    │  │
                         │  └─────────────────────────────────────────────────────┘  │
                         │  native Ed25519 program · instructions sysvar · ledger    │
                         └──────────▲──────────────────▲───────────────▲─────────────┘
              publish / manage txs  │       acceptance │ txs (relayer) │ reads (RPC)
              (org wallets/Squads)  │                  │               │
┌──────────────────────┐   ┌────────┴─────────┐  ┌─────┴───────────┐  ┌┴──────────────────────┐
│ Company admins       │   │ apps/web         │  │ apps/api        │  │ Independent verifiers │
│ (browser wallet /    │──▶│ Next.js 16       │─▶│ Fastify 5       │  │ @stele/verifier (lib) │
│  Squads multisig)    │   │ dashboard, accept│  │ relayer, DNS    │  │ stele-verify (CLI)    │
└──────────────────────┘   │ flow, /verify    │  │ attestor, API   │  │ /verify (in-browser)  │
┌──────────────────────┐   │ (verifier runs   │  │ keys, webhooks  │  └───────────┬───────────┘
│ End users (wallet)   │──▶│  client-side)    │  └────┬───────┬────┘              │
└──────────────────────┘   └──────────────────┘       │       │                   │
                                                 ┌────▼──┐ ┌──▼──────────────┐    │
                                                 │Postgres│ │ Content storage │◀───┘
                                                 │(index) │ │ S3/R2 · Arweave │  re-hash on read
                                                 └────▲───┘ └─────────────────┘
                                                      │
                                                 ┌────┴─────────┐
                                                 │ indexer      │ ◀── tails program transactions,
                                                 │ (apps/api,   │     verifies, writes the index
                                                 │  rebuildable)│
                                                 └──────────────┘
```

### Trust boundaries

| Component | Trusted for | **Not** trusted for |
|---|---|---|
| Solana consensus/ledger | Ordering, timestamps (within cluster clock tolerance), immutability of finalized history | — |
| `stele` program (verifiable build, multisig-held upgrade authority) | Enforcing invariants at execution time | Nothing beyond its audited logic; verifiers re-check results against the original transactions |
| RPC providers | Availability | Correctness — verifiers can cross-check several independent RPCs |
| Content storage | Availability | Integrity — every byte is re-hashed against the on-chain commitment |
| `apps/api` (our backend) | Liveness of relaying, rate limiting, convenience indexes | Evidence. It can refuse service; it cannot forge, alter or back-date evidence |
| PostgreSQL | Performance, search, dashboards | Evidence. Fully rebuildable |
| `apps/web` (our frontend) | UX | The wallet shows the exact signed message; the browser re-verifies content hashes before signing |
| Domain attestor key | Asserting "this org controlled this domain at time T" | Live truth — verifiers can re-check DNS |
| End-user wallet software | Displaying the message faithfully, protecting the key | — (out of scope; documented residual risk) |

---

## 4. Repository layout

```
.
├── programs/stele/            Anchor 1.x on-chain program (Rust)
│   └── tests/                 LiteSVM integration tests (real compiled .so, real Ed25519 precompile)
├── crates/
│   ├── stele-core/            Shared Rust: validation, version fingerprint, acceptance message,
│   │                          RFC 3339, acceptance leaf/accumulator. Used by the program.
│   └── stele-canonical/       Off-chain Rust canonicalizer (NFC, JCS) — cross-checked with TS
├── packages/
│   ├── protocol/              @stele/protocol — TS mirror of the protocol: canonicalization,
│   │                          hashing, messages, PDAs, account/instruction codecs (@solana/kit)
│   ├── verifier/              @stele/verifier — independent verification library + CLI
│   ├── sdk/                   @stele/sdk — REST client, webhook verification, acceptance flow,
│   │                          React <TermsAcceptance/> (subpath export)
│   ├── db/                    @stele/db — Drizzle schema, migrations, client
│   └── ui/                    @stele/ui — design system (tokens, primitives, brand mark)
├── apps/
│   ├── web/                   Next.js 16 app: marketing, docs, dashboard, accept, receipt, verify
│   └── api/                   Fastify 5 REST API, relayer, DNS attestor, webhooks, workers,
│                              and the chain indexer (separate entry point; rebuilds the DB)
├── spec/test-vectors/         Language-neutral JSON test vectors (Rust and TS must both pass)
├── docs/                      Topic documentation
├── infra/                     Docker, compose, deployment manifests
├── scripts/                   Build/deploy/localnet helpers
├── tools/localnet/            Localnet keys, .env generator and realistic seed data
└── tests/
    ├── integration/           SDK ↔ API ↔ validator integration tests
    └── e2e/                   Playwright end-to-end tests (injected Wallet Standard test wallet)
```

---

## 5. On-chain design

Full account-by-account detail (seeds, sizes, signers, close policy, rent) is in
[docs/architecture.md](docs/architecture.md#on-chain-accounts) and the normative layout is in
[PROTOCOL_SPEC.md §6](PROTOCOL_SPEC.md#6-on-chain-program). Summary:

| Account | Seeds | Created by | Mutable by | Closable |
|---|---|---|---|---|
| `ProtocolConfig` | `["config"]` | Program upgrade authority (once) | Protocol admin (pause, attestor, admin rotation). `chain_id`/`network_label` are immutable | Never |
| `Organization` | `["organization", creator, seed32]` | Anyone (creator signs) | Owner / recovery, under explicit rules | Never |
| `Member` | `["member", organization, member_key]` | Owner, or admin for non-admin roles | Owner/admin; revocation is a timestamp, never deletion | Never |
| `DomainRecord` | `["domain", sha256(domain)]` | Domain attestor | Attestor (renew) | Yes — it is a *current-state pointer*; history is in the ledger |
| `Document` | `["document", organization, slug]` | Owner/admin/publisher | Program only (head pointer on publish) | Never |
| `DocumentVersion` | `["version", document, u32_le(n)]` | Owner/publisher | **Nothing. Immutable.** | **Never** |
| `NonceShard` | `["nonce-shard", organization, u16_le(id)]` | Owner/admin | Program (bitmap, counter, accumulator); owner/admin (relayer) | Never |

### 5.1 Why acceptances are *not* one PDA each

We evaluated five storage strategies for acceptance evidence (full analysis:
[docs/architecture.md#acceptance-storage-analysis](docs/architecture.md#acceptance-storage-analysis)):

| Strategy | Cost / acceptance (SOL) | Replay-safe | Evidence location | Verdict |
|---|---|---|---|---|
| PDA per acceptance | ≈ 0.0016–0.002 (rent, permanently locked) | Yes (PDA uniqueness) | Account state | Secure but ~180× more expensive; unusable for consumer-scale ToS |
| Memo / log only | ≈ 0.00001 | **No** (duplicates, no consumption) | Ledger | Rejected — no on-chain signature check or nonce consumption |
| Compressed / Merkle batches | ≈ 0.000001 | Depends | Off-chain leaves + on-chain root | Rejected for v1 — evidence availability depends on an indexer; complex third-party verification |
| ZK Compression (Light) | ≈ 0.00001 | Yes | Compressed state trees | Deferred — strong future option, adds external prover/indexer dependency |
| **On-chain-verified acceptance + nonce bitmap + accumulator (chosen)** | **≈ 0.000011** | **Yes (bit consumed on-chain)** | **Ledger (signed message + signature in tx) + bitmap state + accumulator** | **Chosen** |

The chosen design:

- the user signs a human-readable message; the **relayer** submits a transaction containing the
  native **Ed25519 verify instruction** (message + signature + pubkey) immediately followed by
  `record_acceptance`;
- `record_acceptance` reconstructs the expected message from on-chain state (organization name and
  verified domain, document title, version label/number/fingerprint, network label) and from its own
  arguments (nonce, issued/expires), and requires byte-equality with the message that the Ed25519
  program verified;
- it consumes a nonce bit in a per-organization 65,536-bit `NonceShard` (≈ 0.0588 SOL rent per shard
  ⇒ ≈ 900 lamports per acceptance), so the same signed message can never be recorded twice;
- it folds the acceptance into the shard's hash accumulator so auditors can prove the indexer's set
  of acceptances is complete and unaltered.

The signed message and signature live forever in the ledger; the receipt bundle carries them too.

### 5.2 Fingerprints

```
content_hash   = SHA-256( canonical content JSON bytes )             ← sha256sum-compatible
version_hash   = SHA-256( canonical version JSON bytes )             ← computed ON-CHAIN
                 version JSON = { chainId, contentHash, document, documentType, effectiveAt,
                                  format:"stele-version-v1", locale, organization,
                                  previousVersionHash, program, title, version, versionLabel }
```

The **version fingerprint** (`version_hash`) is what users see and sign. Because the program
computes it from on-chain fields, on-chain metadata and the fingerprint can never disagree; the only
off-chain input is the content, which anyone can re-hash. The publisher passes the fingerprint they
reviewed as `expected_version_hash`; the program rejects the publication if its own computation
differs.

---

## 6. Off-chain components

### 6.1 `apps/api` (Fastify 5, Node 24)

- **Auth:** Sign-In-With-Solana-style login (distinct, domain-separated message), server-side
  sessions (random 256-bit token in an `HttpOnly; Secure; SameSite=Lax` cookie; only the SHA-256 of
  the token is stored), CSRF defence via Origin allow-list + double-submit token.
- **Authorization:** every org-scoped route resolves the caller's role from the **on-chain-mirrored**
  membership table (written only by the indexer/verified confirmations), never from client input.
- **Drafts & publication preparation:** drafts are mutable and explicitly *not evidence*. Preparing a
  publication canonicalizes content, uploads it content-addressed, and returns the exact
  `content_hash`/`version_hash` that the publisher's browser independently recomputes before signing.
- **Acceptance relayer:** issues challenges (allocates a nonce bit, builds the message with the
  shared library), verifies the user signature locally, submits the transaction as fee payer, and
  tracks it to finality. It never holds user keys and cannot alter a signed message.
- **Domain attestor:** checks `_stele.<domain>` TXT records through multiple DNS-over-HTTPS
  resolvers and submits `attest_domain` with a dedicated attestor key.
- **API keys** (hashed, scoped, prefixed, revocable), **webhooks** (HMAC-SHA256, timestamped,
  encrypted secrets, outbox with retries), **idempotency keys**, **rate limiting**, **hash-chained
  audit log**.

### 6.2 Chain indexer (`apps/api`, `indexer-main.ts`)

Runs as its own process (or inside the API process with `RUN_INDEXER=true` for single-node and
local setups). Tails program transactions (`getSignaturesForAddress` + `getTransaction`), decodes instructions and
events, **re-verifies** every acceptance (signature + message reconstruction), and upserts index
rows keyed by on-chain identifiers. It tracks commitment (`confirmed` → `finalized`) and can replay
from the program's first transaction to rebuild the database after total loss.

### 6.3 `apps/web` (Next.js 16)

- Public site: `/`, `/product`, `/security`, `/developers`, `/pricing`, `/docs`, `/verify`.
- Company dashboard: documents, editor with canonical preview and live fingerprint, publication
  with wallet signing, version timeline and diffs, acceptances search, organization & domain
  verification, team (on-chain members), API keys, integrations/webhooks, security (authority,
  recovery, freeze, compromise reporting), audit log.
- Acceptance flow: `/accept/[organization]/[document]` — renders **hash-verified** content only,
  re-derives the acceptance message locally and refuses to sign if the server-provided message
  differs by a single byte.
- Receipts: `/receipt/[receipt]` — runs the verifier in the browser on load.
- Strict CSP with per-request nonces (`proxy.ts`): scripts execute only with the request's nonce,
  `frame-ancestors 'none'`, network access limited to the API and configured RPC endpoints.

### 6.4 `@stele/verifier`

Pure TypeScript, no dependency on our backend. Inputs: transaction signature, receipt bundle,
version address or fingerprint. Talks to one or more RPC endpoints (cross-checking results) and to
content storage. Produces a structured report of ~20 named checks, each `pass | fail | warn | skip`,
and an overall verdict: `VALID`, `VALID_WITH_WARNINGS`, `INVALID`, or `INCONCLUSIVE`.

---

## 7. Key flows

### 7.1 Publish a version

```
Publisher (browser)            apps/api                        Solana
       │ edit draft ──────────────▶│ store draft (mutable, not evidence)
       │ prepare publication ─────▶│ canonicalize → content bytes
       │                           │ upload to storage (content-addressed by SHA-256)
       │◀─ canonical bytes, content_hash, version JSON, version_hash, storage_uri
       │ recompute content_hash + version_hash LOCALLY; display; compare
       │ wallet signs publish_version(expected_version_hash, ...) ────────────────▶│
       │                                                 program: authority check, frozen/paused,
       │                                                 n == version_count+1, prev == head_hash,
       │                                                 validate strings, effective_at ≥ now,
       │                                                 compute version_hash, == expected?,
       │                                                 init immutable DocumentVersion PDA
       │ confirm(tx_sig) ─────────▶│ fetch tx from RPC, verify success + decode ──▶│
       │                           │ index version; audit log; webhook
```

### 7.2 Accept a version

```
User (browser + wallet)       apps/api (relayer)                  Solana
  open /accept/acme.example/terms
  ├─ fetch version account from RPC, fetch content, SHA-256 == content_hash? else BLOCK
  ├─ connect wallet; review summary (org, verified domain, doc, version, fingerprint, network)
  ├─ request challenge ───────────▶│ allocate (shard, bit); issued/expires; build message
  │◀─ message + fields ────────────│
  ├─ rebuild message locally from on-chain data; byte-compare; else BLOCK
  ├─ wallet.signMessage(message)  (wallet displays the full text)
  ├─ submit signature ────────────▶│ verify Ed25519 locally; build tx:
  │                                │  [compute budget] [Ed25519 verify] [record_acceptance]
  │                                │ sign as fee payer (relayer) ───────────────────────▶│
  │                                │                       program: introspect Ed25519 ix,
  │                                │                       canonical layout, signer, rebuild
  │                                │                       message, byte-compare, window,
  │                                │                       latest version, consume nonce bit,
  │                                │                       update accumulator, emit event
  │◀─ receipt (tx sig, acceptance id) ◀── confirmed ──────────────────────────────────────│
  └─ /receipt/<id>: verifier runs in browser against RPC
```

### 7.3 Verify (no Stele infrastructure required)

```
receipt.json / tx signature
  → getTransaction (≥1 RPC, compare)                → Ed25519 verify locally
  → parse message, compare with version account      → recompute version JSON → SHA-256
  → fetch content (bundle | storage URI | mirrors)   → SHA-256 == content_hash, canonical form
  → walk previous_version_hash chain to v1           → check publication txs match accounts
  → nonce bit set in shard                           → recompute acceptance leaf
  → report
```

---

## 8. Scalability

| Scale target | Design response |
|---|---|
| 100,000 organizations | Org PDAs are independent; no global hot accounts except read-only `ProtocolConfig` |
| 10 million documents/versions | One PDA per version (~0.004 SOL); DB indexes on (org, document, number) |
| Hundreds of millions of acceptances | No per-acceptance rent; nonce bitmaps sharded per org; the relayer allocates from the least-used active shard, spreading write locks; the append-only `acceptances` table can be partitioned by month when volume requires it |
| Write-lock contention | Each acceptance write-locks only its `NonceShard` (~29k CU each). One shard sustains hundreds of acceptances per block; throughput grows with the number of active shards |
| Indexing | Stateless decode; idempotent upserts keyed by `(tx_signature)` and `acceptance_id`; horizontally partitionable by program-account address |
| Verification | Client-side; cost borne by the verifier, not by us |

---

## 9. Cost model (summary)

Assumptions: rent-exempt minimum = `(128 + data_len) × 6,960` lamports; base fee 5,000 lamports per
signature (including Ed25519-precompile signatures); priority fees excluded; SOL = $150 for
illustration only. Full model: [docs/architecture.md#cost-model](docs/architecture.md#cost-model).

| Operation | Rent (SOL, locked) | Fees (SOL) | ≈ USD |
|---|---|---|---|
| Create organization | 0.00353 | 0.00001 | $0.53 |
| Add member | 0.00191 | 0.00001 | $0.29 |
| Create document | 0.00262 | 0.00001 | $0.39 |
| Publish version | 0.00400 | 0.00001 | $0.60 |
| Nonce shard (65,536 acceptances) | 0.05880 | 0.00001 | $8.82 |
| **One acceptance** | 0.0000009 (amortized shard) | 0.00001 | **$0.0016** |
| 1,000 acceptances | 0.0009 | 0.010 | $1.63 |
| 1,000,000 acceptances | 0.897 | 10.0 | $1,635 |
| 1,000,000 acceptances as PDAs (rejected) | ≈ 1,900 | 10.0 | ≈ $286,000 |

---

## 10. Failure modes and recovery (summary)

| Failure | Effect | Recovery |
|---|---|---|
| RPC outage | Relaying/verification pause | Multiple RPC providers with failover; verifier accepts user-supplied RPC |
| Solana congestion | Slower confirmation | Priority fees (dynamic), retries with fresh blockhash; challenge windows up to 60 min |
| Storage outage | Content temporarily unavailable | Multiple mirrors; receipts embed content; verifier reports `INCONCLUSIVE`, never "valid" |
| Indexer outage | Dashboards stale | Relayer writes confirmations directly; indexer catches up from cursor |
| Database loss | Index lost | `indexer --rebuild` replays from chain; content re-fetched from storage by hash |
| Backend compromise | Attacker can deny service, spam, leak PII | Cannot forge evidence; rotate relayer/attestor keys; incident runbook |
| Frontend compromise | Phishing risk at signing time | Wallet displays exact message; content re-hash in browser; strict nonce CSP; integrators can pin program, network and RPC in the SDK; the open-source verifier is independent of the frontend |
| Org key compromise | Unauthorized publications possible | Freeze, revoke, report compromise, owner rotation/recovery; history remains verifiable |

Detailed runbooks: [docs/deployment.md#disaster-recovery](docs/deployment.md#disaster-recovery).

---

## 11. Legal and semantic boundaries

- A Stele acceptance record is **verifiable proof that a specific signing key authorized acceptance
  of an exact document version at a time no later than its block time**.
- It is **not** proof of human identity, comprehension, capacity, or consent free of coercion. Those
  require additional, separate evidence (authentication logs, identity verification).
- Enforceability of electronic acceptance depends on jurisdiction and implementation (e.g. clear
  presentation, opportunity to review). Stele provides strong integrity and attribution evidence; it
  does not provide legal advice and does not guarantee enforceability.

---

## 12. Technology choices (verified September 2026)

| Concern | Choice | Why |
|---|---|---|
| Program framework | Anchor **1.2** (Solana 3.x crates) | Stable 1.x line; explicit account validation; IDL |
| Program tests | LiteSVM 0.17 (Rust) with precompiles | Real `.so`, real Ed25519 precompile, deterministic clock |
| Client SDK | `@solana/kit` 8 + kit plugins | Current Solana Foundation recommendation; tree-shakable; no web3.js v1 |
| Wallets | Wallet Standard via `@solana/kit-plugin-wallet` + `@solana/react` | Replaces wallet-adapter for modern wallets |
| Hashing | SHA-256 (`@noble/hashes`, Solana `sol_sha256` syscall) | Universally available, `sha256sum`-verifiable, on-chain syscall |
| Signatures | Ed25519 (native precompile on-chain, `@noble/curves` off-chain) | Solana-native wallet keys |
| Web | Next.js 16 (App Router, `proxy.ts` CSP nonces), React 19, Tailwind CSS 4 | Modern, secure defaults |
| API | Fastify 5 + Zod 4 | Mature, fast, schema-first |
| DB | PostgreSQL 16+ via Drizzle ORM; PGlite in tests | Typed SQL, real Postgres semantics in CI without Docker |
| Monorepo | pnpm 12 workspaces + Turborepo | Strict dependency isolation, cached pipelines |
| Language | TypeScript 6.0 (typescript-eslint requires < 6.1) | Ecosystem compatibility |
