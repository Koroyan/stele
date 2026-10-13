# Architecture (detailed)

> **Internal documentation.** Repository only: not published on the website. The public
> explanation is [How Stele works](how-it-works.md).

This document expands [ARCHITECTURE.md](../ARCHITECTURE.md) with the details an operator, integrator
or auditor needs: every on-chain account, how data flows between components, why acceptances are
stored the way they are, what everything costs, and how the system behaves under load and failure.
The normative byte-level rules live in the [protocol specification](../PROTOCOL_SPEC.md).

## Components

| Component | Location | Role | Holds keys? |
|---|---|---|---|
| `stele` program | `programs/stele` | Enforces every invariant: authority, immutability, fingerprints, signature verification, replay protection | — |
| Shared Rust core | `crates/stele-core` | Validation, fingerprint JSON, acceptance message, RFC 3339, accumulator. Compiled into the program | — |
| Off-chain canonicalizer (Rust) | `crates/stele-canonical` | Reference canonicalization, cross-checked against TypeScript with shared vectors | — |
| `@stelehq/protocol` | `packages/protocol` | TypeScript mirror: canonicalization, hashing, messages, PDAs, account/instruction codecs | — |
| `@stelehq/verifier` | `packages/verifier` | Independent verifier library and `stele-verify` CLI | — |
| `@stelehq/sdk` | `packages/sdk` | REST client, verified document loading, acceptance flow, React component, server helpers | — |
| API | `apps/api` (`main.ts`) | REST API, acceptance relayer, DNS attestor, webhooks, audit log | Relayer and attestor hot keys |
| Workers | `apps/api` (`worker-main.ts`, or in-process) | Webhook delivery, finality tracking, challenge expiry, domain renewal | Attestor (renewal) |
| Indexer | `apps/api` (`indexer-main.ts`, or in-process) | Mirrors program state and acceptances from the chain; can rebuild the database | — |
| Web app | `apps/web` | Marketing site, docs, dashboard, hosted acceptance, receipts, in-browser verifier | — |
| PostgreSQL | — | Index and operational data (drafts, sessions, API keys, webhooks, audit log) | Encrypted webhook secrets |
| Content storage | Filesystem or S3-compatible | Canonical document bytes, content-addressed by SHA-256 | — |

Nothing in the bottom half of the table is a trust anchor for evidence: the program, the ledger and
SHA-256 are. A compromised API, database or web server can deny service; it cannot sign for a key it
does not hold, or alter or back-date evidence that passes the verifier. It can still control what a
signing page displays and enroll a key it generated for an account that never enrolled (see
[trust model](trust-model.md)).

## On-chain accounts

All accounts are owned by the program and start with Anchor's 8-byte discriminator. Fixed-size fields
come first and strings last so that `memcmp` filters have stable offsets. Rent is computed as
`(128 + size) × 6,960` lamports.

| Account | Seeds | Size (bytes) | Rent (SOL) | Created by | Mutated by | Closed |
|---|---|---|---|---|---|---|
| `ProtocolConfig` | `"config"` | 169 | 0.00207 | Program upgrade authority, once | Protocol admin: pause, attestor, admin rotation (`chain_id`, `network_label` immutable) | Never |
| `Organization` | `"organization"`, creator, seed[32] | 379 | 0.00353 | Anyone (the creator signs) | Owner and recovery authority under explicit rules | Never |
| `Member` | `"member"`, organization, member | 146 | 0.00191 | Owner; admins for non-admin roles | Owner/admin; revocation and compromise are timestamps | Never |
| `DomainRecord` | `"domain"`, SHA-256(domain) | 206 | 0.00232 | Domain attestor | Attestor (renew) | On revocation (current-state pointer; history stays in the ledger) |
| `Document` | `"document"`, organization, slug | 249 | 0.00262 | Owner, admin or publisher | Program only (head pointer on publication) | Never |
| `DocumentVersion` | `"version"`, document, u32 LE number | 446 | 0.00400 | Owner or publisher | **Nothing — immutable** | **Never** |
| `NonceShard` | `"nonce-shard"`, organization, u16 LE id | 8,320 | 0.0588 | Owner or admin | Program (bitmap, counter, accumulator); owner/admin (relayer key) | Never |

Field-level layouts are in [PROTOCOL_SPEC.md §6.2](../PROTOCOL_SPEC.md#62-account-layouts). Notable
design points:

- **Organization addresses are derived from the creator and a random 32-byte seed**, so nobody can
  front-run the creation of an address someone else intends to use (threat A21).
- **`Document` stores `head_hash`** — the fingerprint of its latest version. A new version must commit
  to it as `previous_version_hash`, forming a tamper-evident chain back to version 1.
- **`DocumentVersion.version_hash` is computed by the program**, never accepted from the client except
  as an equality check (`expected_version_hash`).
- **`NonceShard` is zero-copy**: a 65,536-bit bitmap (8 KiB), an accepted counter, a 32-byte
  accumulator and the only relayer key allowed to record against it (zero = anyone).

## Data flows

### Publication

1. A publisher edits a draft in the dashboard. Drafts are mutable API records and are never evidence.
2. *Prepare*: the API canonicalizes the draft, stores the canonical bytes content-addressed, reads the
   document's head from the chain and returns the version number, predecessor, content hash, version
   JSON and fingerprint.
3. The publisher's browser recomputes all of it independently — canonical bytes from the draft text,
   fingerprint from live chain state — and refuses to continue on any difference.
4. The publisher's wallet signs `publish_version` with `expected_version_hash`. The program checks the
   publisher's role, that the organization is not frozen and the protocol not paused, that the version
   number and predecessor match the head, validates every string, recomputes the fingerprint and
   creates the immutable `DocumentVersion`.
5. The API mirrors the confirmed transaction by reading it back from the chain, then writes the audit
   log and enqueues `document.version_published` webhooks.

### Acceptance

1. The browser (hosted page or SDK) loads the current version **from Solana**, fetches the content from
   any source, and checks `SHA-256(bytes) = content_hash` and the recomputed fingerprint. Nothing is
   shown otherwise.
2. It requests a challenge. The API derives the requesting site from the `Origin` header, applies the
   organization's policies (allowed sites, required acceptance sessions, open-challenge cap), allocates
   a nonce bit, and builds the message from chain data with cluster time.
3. The browser rebuilds the message from the chain data it verified and refuses to sign unless the two
   are byte-identical. The wallet displays the text.
4. The relayer verifies the signature locally, then submits
   `[compute budget] [Ed25519 verify] [record_acceptance]` as fee payer.
5. The program introspects the Ed25519 instruction (canonical offsets, top-level, same transaction),
   rebuilds the message prefix from its own state, validates the validity window against the Clock
   sysvar, requires the version to be current, consumes the nonce bit, folds the acceptance ID into the
   shard accumulator and emits `AcceptanceRecorded`.
6. The API indexes the confirmed transaction — reading it back, not trusting the request — and
   notifies webhooks. The finality worker later promotes it to `finalized`.

### Verification

The verifier needs only a transaction signature (or a receipt) and one or more RPC endpoints. It never
contacts a Stele server. See [Acceptance & signing](acceptance-signing.md#how-verification-works) and
[PROTOCOL_SPEC.md §11](../PROTOCOL_SPEC.md#11-verification-algorithm).

## Acceptance storage analysis

Acceptances are the high-volume object: a consumer product may collect millions. Five designs were
evaluated against the security requirements (on-chain signature verification, single use, permanent
public evidence, independent verifiability) and cost.

| Design | Cost per acceptance | Replay-safe on-chain | Evidence remains verifiable without Stele | Assessment |
|---|---|---|---|---|
| One PDA per acceptance | ≈ 0.0019 SOL rent, locked forever | Yes | Yes | Secure, but ~175× the cost; prohibitive at consumer scale |
| Memo / log only | ≈ 0.00001 SOL | No — duplicates cannot be rejected | Partly | Rejected: nothing consumes a nonce, nothing checks the signature on-chain |
| Merkle batches (off-chain leaves, on-chain root) | ≈ 0.000001 SOL | Depends on the batcher | Only if leaves are published and retained | Rejected for v1: availability depends on our infrastructure |
| ZK compression | ≈ 0.00001 SOL | Yes | Requires an external indexer/prover | Deferred: strong future option, adds dependencies |
| **Ed25519-verified event + nonce bitmap + accumulator** | **≈ 0.000011 SOL** | **Yes — the bit is consumed** | **Yes — message and signature are in the transaction** | **Chosen** |

Why the chosen design is sound:

- **Signature checked on-chain.** The Ed25519 program verifies the signature over the exact message
  bytes; `record_acceptance` requires that this verification happened in the same transaction, at the
  canonical offsets, for the expected key and message.
- **Message bound to state.** The program rebuilds lines 1–11 of the message from the organization,
  document version and protocol configuration. A relayer cannot attach a signature to different terms.
- **Single use.** Each nonce is one bit; setting an already-set bit fails the transaction.
- **Completeness auditing.** The shard accumulator `acc' = SHA-256(tag ‖ acc ‖ acceptance_id)` lets an
  auditor recompute the accumulator from the events and detect an index that omits or invents
  acceptances.
- **Permanent evidence.** The signed message and signature are part of a transaction recorded in the
  ledger. Archival RPC providers retain it; receipts carry a copy.

Trade-off accepted: historical transactions are served by archival RPC providers rather than by
account state, so long-term verification needs at least one RPC provider that keeps full history (all
major providers do) or the receipt bundle, which contains the signed message and signature.

## Cost model

Assumptions: rent-exempt minimum `(128 + data_len) × 6,960` lamports; base fee 5,000 lamports per
signature (the Ed25519 precompile signature counts); priority fees excluded; USD at SOL = $150 for
illustration only.

| Operation | Paid by | Rent (SOL) | Fees (SOL) | ≈ USD |
|---|---|---|---|---|
| Initialize protocol | Operator | 0.00207 | 0.000005 | $0.31 |
| Create organization | Organization wallet | 0.00353 | 0.000005 | $0.53 |
| Add member | Organization wallet | 0.00191 | 0.000005 | $0.29 |
| Attest domain | Stele attestor | 0.00232 | 0.000005 | $0.35 |
| Create document | Organization wallet | 0.00262 | 0.000005 | $0.39 |
| Publish version | Organization wallet | 0.00400 | 0.000005 | $0.60 |
| Nonce shard (65,536 acceptances) | Organization wallet | 0.0588 | 0.000005 | $8.82 |
| One acceptance | Relayer | 0.0000009 (shard, amortized) | 0.00001 | $0.0016 |
| 1,000 acceptances | Relayer + shard | 0.0009 | 0.010 | $1.64 |
| 1,000,000 acceptances | Relayer + 16 shards | 0.94 | 10.0 | $1,641 |
| 1,000,000 acceptances as PDAs (rejected design) | — | ≈ 1,900 | 10.0 | ≈ $286,000 |

Off-chain costs (database, storage, RPC) are small by comparison: a document version is typically
10–100 KB of canonical JSON, and an indexed acceptance row is under 1 KB.

## Scalability and performance

- **No global hot accounts.** `ProtocolConfig` is read-only in every user transaction. Organizations,
  documents and shards are independent, so unrelated organizations never contend.
- **Shard write locks.** Each acceptance writes only its nonce shard. At ~29,000 compute units per
  acceptance (measured in the program tests), one shard sustains hundreds of acceptances per block; the
  relayer allocates from the least-used active shard, so throughput grows with the number of shards.
- **Transaction size.** The worst-case acceptance transaction (maximum-length names, titles and domain)
  is asserted in tests to fit Solana's 1,232-byte packet limit.
- **Relayer.** Stateless apart from the database; several API instances can relay concurrently
  because nonce allocation is a single atomic `UPDATE … RETURNING`.
- **Indexer.** Idempotent upserts keyed by on-chain identifiers; safe to run more than one instance;
  can replay the program's full history to rebuild the database.
- **Verification** runs on the verifier's machine and RPC quota, not ours.

## Observability

- Structured JSON logs (pino) with request IDs; secrets, cookies and authorization headers are
  redacted; IP addresses appear in logs and rate limits only as keyed hashes (the acceptance audit
  trail stores them encrypted).
- Health endpoints: `GET /health` (process) and `GET /ready` (RPC reachable).
- Signals worth alerting on: relay failures by program error code, shard capacity above 80%, webhook
  endpoints with consecutive failures, domain attestations expiring within 30 days without renewal,
  indexer lag (newest indexed slot vs. cluster slot), audit-chain verification failures, and
  unexpected program upgrades (compare the deployed program hash with the release).

## Failure modes

| Failure | Effect | Behaviour and recovery |
|---|---|---|
| RPC outage | Relaying and verification pause | Configure several providers; the verifier accepts user-chosen RPCs |
| Solana congestion | Slower confirmation | Priority fees; challenges are valid for 10 minutes by default (protocol maximum 60) |
| Content storage outage | Text temporarily unavailable | Mirrors and receipts carry content; the verifier reports `INCONCLUSIVE`, never "valid" |
| Indexer outage | Dashboards stale | The relayer indexes its own confirmations; the indexer catches up from its cursor |
| Database loss | Index lost | Rebuild from the chain (`STELE_INDEXER_REBUILD=1`); content re-fetched by hash |
| API compromise | Denial of service, spam, metadata exposure | Cannot forge evidence; rotate relayer and attestor keys; see the [runbooks](deployment.md#disaster-recovery) |
| Frontend compromise | Phishing at signing time | Wallets display the exact message; content is re-hashed in the browser; integrators can pin program, network and RPCs in the SDK |
| Organization key compromise | Unauthorized publications possible | Freeze, revoke, report the compromise, rotate the owner via recovery; history stays verifiable |
| Program bug | Depends | Protocol admin can pause; upgrades require the multisig; the verifier cross-checks publication transactions so a malicious upgrade cannot silently rewrite stored versions |
