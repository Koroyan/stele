# Stele — Verifiable consent for the web

**Prove what was agreed.**

## The problem

"I agree" evidence normally lives with one party: the company's database says you accepted its
Terms, and that row says whatever the company — or whoever controls its database — says it says.
The text you saw, the version, the time and whether you agreed at all cannot be checked by anyone
else.

## What Stele does

- The organization publishes the **exact version** of its Terms. The canonical text is hashed and the
  fingerprint is committed on Solana; versions are append-only and hash-chained — the program has no
  instruction to edit one.
- The user reads that exact text and accepts it **with a passkey** — Face ID, Touch ID, Windows Hello,
  Android or a security key. **No wallet. No SOL. No seed phrase.** (A Solana wallet works too.)
- The passkey's own key signs. **Stele never holds the user's signing private key** — not even
  encrypted: it stays in the authenticator.
- In direct mode, Solana verifies the signature on-chain (the secp256r1 precompile) and the Stele
  program binds it to the document version, the requesting site and the relying party before recording
  it. In batched mode, the relayer verifies signatures off-chain and Solana orders and timestamps a
  Merkle root; anyone can re-verify each signature from the receipt.
- The user pays **nothing**: Stele, or the organization, pays the network fee.
- The user gets a **portable receipt** containing the exact text. Anyone can verify it with the
  open-source verifier and any archival Solana RPC — **with Stele's API and database switched off**,
  and without the organization's website.

## What Stele proves — and what it does not

| Stele proves | Stele does not prove |
|---|---|
| A specific signing credential accepted a specific canonical version — this text, this fingerprint — under a stated verification context (organization, site, network, time window) | Who the person was. A passkey proves control of a credential; a wallet signature proves control of a key |
| For native passkeys: a WebAuthn credential produced a **user-verified** signature (biometric or device PIN, checked on the device) in a top-level page of the **browser-attested origin** | What the authenticator displayed: passkey prompts show the site, not the agreement — the text is what the signing page showed |
| The acceptance existed no later than its Solana slot, and the version was current then | That a synced passkey or a device was not used by someone else |
| The text, version and signature were not altered afterwards | That the agreement is legally enforceable — that depends on law; Stele gives no legal advice |
| After a key is enrolled, nobody else can sign under it; replacing it is the user's rotation or a publicly labeled organization recovery | That the first enrolled key really was the user's passkey: whoever runs enrollment links keys to accounts, and a software P-256 key looks like a passkey to the program |

Cryptographic validity, account association (an organization's on-chain enrollment of a user's key),
identity and legal enforceability are four different things; Stele provides the first two. The
[trust model](docs/trust-model.md) lists who controls what — including the two things Stele cannot
make trustless: what the signing page displays, and who enrolls a key.

## Why Solana

Solana is Stele's **neutral witness** and **key registry**.

1. **Neutral witness.** Neither the organization nor Stele controls the ledger that orders and
   timestamps the evidence, and its validators watch that history for everyone — a self-run log would
   need its own network of independent monitors to offer the same.
2. **Key registry with enforced rules.** Which key signs for an account is recorded in one public
   place, and the program enforces the rules: a rotation must be signed by the current key, an
   organization recovery is time-stamped and labeled, a revocation is recorded. Verifiers do not have
   to re-derive these rules from data an operator wrote.
3. **Passkeys verified natively.** Solana's secp256r1 precompile verifies the WebAuthn signatures of
   ordinary passkeys on-chain, so consumers take part without a crypto wallet.
4. **Seconds, not hours.** Acceptances are final within seconds, which fits a checkout flow.
5. **Cost at consumer scale.** About 0.00001 SOL per directly recorded acceptance, and about
   5 lamports per acceptance in Merkle batches of 1,024 ([measured costs](docs/cost-analysis.md)).

Not yet: other programs cannot act on an acceptance today, because Stele deliberately creates no
per-user account. An opt-in mode that does — so that an app's program can require the current terms
before an action — is on the roadmap.

## Program authority — current status

The Devnet program `6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV` is upgradeable and its upgrade
authority is **a single key** today. It is **not immutable.** The procedure to move it to a Squads
multisig, and the path to immutability, are in [docs/upgrade-authority.md](docs/upgrade-authority.md).
An upgrade cannot rewrite past Solana transactions, and verifiers re-check signatures, hashes and
proofs themselves; but an upgrade could change account state and future rules. Until the authority
is a multisig and then revoked, "history can't be changed" holds for transactions, not for the
program.

## The demo (Devnet)

[docs/demo.md](docs/demo.md) walks through the 14-step story: publish Terms v1 (30-day refunds),
accept with a passkey in a clean browser, receive and verify the receipt, publish v2 (7 days), watch
the old receipt still prove v1, tamper with it, attempt operator forgeries against an enrolled user (rejected by Solana),
and verify again with Stele switched off.

## Protocol versions

`stele/1` (wallets, PRF-protected keys, Ed25519) is unchanged and remains supported forever;
`stele/2` adds native passkeys, `stele-receipt/2` and Merkle-batched evidence
([PROTOCOL_SPEC.md §17](PROTOCOL_SPEC.md)). Nothing old is reinterpreted: old messages, receipts and
accounts keep their meaning, and their test suites run unchanged.

## How it works

1. **Publish.** A document is canonicalized into exact bytes and hashed. The organization's authority
   (ideally a multisig) signs the publication; the Solana program recomputes the version fingerprint,
   links it to the previous version and stores it in an immutable account.
2. **Accept.** The user reads text whose hash the browser has checked against the chain. The signed
   message names the organization (and whether its domain is verified), the document, the version
   fingerprint, the network, a validity window, a single-use nonce and the requesting site. With a
   **native passkey** the passkey signs a WebAuthn challenge derived from that message; with a
   **wallet** the wallet signs the message itself. A relayer submits it; the program verifies the
   signature through Solana's precompile (secp256r1 or Ed25519), rebuilds the message from its own
   state, checks the browser-attested origin and relying party (passkeys), and consumes the nonce.
   High-volume organizations can instead anchor **Merkle roots** of verified acceptances
   ([evidence modes](PROTOCOL_SPEC.md)).
3. **Verify.** Each acceptance yields a portable receipt (`stele-receipt/2` carries the exact text
   and the WebAuthn evidence). The open-source verifier checks it against one or more Solana RPC
   endpoints — signature, WebAuthn binding, message, fingerprint, content hash, version chain,
   enrollment, Merkle inclusion, authority, nonce — without contacting Stele.

What a signature proves, and what it does not, is spelled out in
[docs/acceptance-signing.md](docs/acceptance-signing.md). In short: it proves that a specific key
accepted a specific, unaltered version at a recorded time. It does not by itself establish a person's
legal identity, and whether an agreement is enforceable depends on applicable law. Stele does not
provide legal advice.

## What's in the box

| | |
|---|---|
| **Solana program** (`programs/stele`, Anchor) | Organizations with owners, roles, multisig support, time-locked recovery, freezing and key-compromise reports; verified domains; immutable, hash-chained document versions; on-chain-verified, replay-protected acceptances (Ed25519 and native P-256 passkeys via secp256r1 introspection); on-chain passkey enrollments with rotation and organization recovery; Merkle batch anchors; fee sponsorship; proofs |
| **Protocol libraries** (`crates/*`, `@stele/protocol`) | Canonicalization, fingerprints, acceptance messages, account and instruction codecs — Rust and TypeScript, checked against shared test vectors |
| **Verifier** (`@stele/verifier`) | Library and `stele-verify` CLI; works with Stele switched off; multi-RPC consensus; receipts v1 and v2, direct and batched evidence; verdicts `VALID`, `VALID_WITH_WARNINGS`, `INVALID`, `INCONCLUSIVE` |
| **SDK** (`@stele/sdk`) | Verified document loading, acceptance flow (wallets, native passkeys, PRF passkeys), embeddable widget with a published SRI hash, `<TermsAcceptance/>` React component, server client and webhook verification |
| **API** (`apps/api`, Fastify) | Wallet sign-in, organizations and documents, drafts and publication preparation, acceptance relayer, DNS domain verification, API keys, signed webhooks, hash-chained audit log, chain indexer |
| **Web app** (`apps/web`, Next.js) | Marketing site and docs, dashboard, hosted acceptance pages, receipts, in-browser verifier |
| **Design system** (`@stele/ui`) | Tokens, brand mark and accessible primitives |
| **Tests** | Rust program tests (LiteSVM), unit and integration tests, localnet tests against a real validator, Playwright end-to-end tests with an injected Wallet Standard test wallet |

## Repository layout

```
programs/stele/        Solana program (Anchor) and LiteSVM tests
crates/                stele-core (shared Rust used by the program), stele-canonical
packages/protocol      @stele/protocol — TypeScript protocol implementation
packages/verifier      @stele/verifier — independent verifier and CLI
packages/sdk           @stele/sdk — browser, React and server SDK
packages/db            @stele/db — database schema and migrations
packages/ui            @stele/ui — design system
apps/api               REST API, relayer, attestor, workers, indexer
apps/web               Next.js web application
tools/localnet         Local keys, environment and seed data
tools/ops              Operator tooling (protocol initialization)
tests/integration      SDK ↔ API ↔ validator tests
tests/e2e              Playwright end-to-end tests
tests/programs         Test-only Solana programs (a CPI forwarder for the program tests)
examples/              Northwind Shop (a complete integration) and a plain HTML widget page
spec/test-vectors      Language-neutral test vectors
infra/                 Dockerfiles and docker-compose
docs/                  Documentation
```

## Quick start (local)

Requirements: Node.js 24, pnpm 12.8, Rust, and the Agave (Solana) toolchain 3.1 — on Windows, inside
WSL 2.

```shell
pnpm install
bash scripts/dev/build-program.sh                 # build the program (Linux/WSL)
pnpm localnet:keys                                # throwaway keys; note the "admin" key
bash scripts/localnet/validator.sh <ADMIN_PUBKEY> # in its own terminal
pnpm localnet:env && pnpm localnet:seed           # local .env and realistic data
pnpm dev:api                                      # http://127.0.0.1:4000
pnpm dev:web                                      # http://localhost:3000
```

Then open `http://localhost:3000/accept/acme.example/terms-of-service` or the dashboard. The full guide,
including disk-usage notes for the local validator, is in [docs/deployment.md](docs/deployment.md).

## Commands

| Command | |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Static checks |
| `pnpm test` | Unit tests (validator-dependent tests skip themselves without one) |
| `pnpm test:integration`, `pnpm test:e2e` | Integration and browser tests against a seeded localnet |
| `bash scripts/dev/test-program.sh` | Build the program and run all Rust tests |
| `pnpm build` | Build every package and app |
| `pnpm vectors` | Regenerate the shared test vectors |
| `pnpm localnet:attest-domain <org> <domain>` | Localnet only: mark a domain verified without DNS |
| `pnpm localnet:demo -- --member <wallet>` then `pnpm demo:shop` | Localnet only: set up and run the Northwind Shop demo (examples/demo-shop) |
| `pnpm --filter @stele/localnet costs` | Measured fees, compute units, sizes and rent of real recordings (any cluster) |
| `pnpm --filter @stele/localnet forgery-demo -- --receipt <file>` | Simulates what a malicious operator could try against a user's passkey; every attempt must be rejected |
| `pnpm db:migrate` | Apply database migrations |

## Documentation

**Public** (served by the web app at `/docs`; the catalog is `apps/web/src/lib/docs.ts`):

- [Product overview](docs/overview.md) · [How Stele works](docs/how-it-works.md) ·
  [Get started](docs/get-started.md)
- [Verification](docs/verification.md) · [What a signature proves](docs/acceptance-signing.md)
- [API & SDK reference](docs/api.md)
- [Protocol specification](PROTOCOL_SPEC.md) and [overview](docs/protocol.md) ·
  [Canonicalization](docs/canonicalization.md) ·
  [Organizations & authority](docs/organization-authority.md) · [Content storage](docs/storage.md)
- [Security architecture](docs/security.md) · [Threat model](docs/threat-model.md) ·
  [Security policy](SECURITY.md)
- [Measured costs](docs/cost-analysis.md) · [Program authority](docs/upgrade-authority.md) ·
  [Demo walkthrough](docs/demo.md)

**Internal** (repository only; never routed or linked on the website):

- [PROJECT.md](PROJECT.md): the whole project in one document, in Georgian (overview, setup, testing,
  networks, what remains before production)

- [Architecture](ARCHITECTURE.md) and [detailed architecture](docs/architecture.md): components,
  infrastructure topology, costs
- [Deployment & operations](docs/deployment.md): environments, configuration, secrets, the mainnet
  checklist, monitoring, relayer and attestor operations, recovery and incident runbooks
- [Full threat model](SECURITY_THREAT_MODEL.md) with detection and recovery for every scenario

## Status

The protocol, program, verifier, SDK, API and web app are implemented and tested end to end on a
local validator; the program runs on Solana Devnet. Visitors sign with a native passkey (the
default), a Solana wallet, or — for signers registered before native passkeys — a PRF-protected Stele
key. Users never pay fees: Stele or the organization (through a sponsored nonce shard) does. Beyond
documents, the same machinery records proofs of purchases, refunds, consents and more
(`record_proof`). Before mainnet use: an independent security audit of the program and protocol,
the upgrade authority moved to a multisig, a reproducible-build release, and the
[mainnet checklist](docs/deployment.md#mainnet-checklist).

## License

[Apache License 2.0](LICENSE).
