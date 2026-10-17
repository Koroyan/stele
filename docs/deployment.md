# Deployment & operations

> **Internal documentation.** Operator-only: not published on the website. Keep it out of public
> channels.

This guide covers local development, a devnet deployment, the mainnet checklist, configuration,
day-to-day operations, and the runbooks for things going wrong.

## Environments

| | Localnet | Devnet | Mainnet |
|---|---|---|---|
| Purpose | Development, integration and E2E tests | Staging, demos, customer trials | Production evidence |
| Chain ID | Derived from the local genesis hash | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| Network label | `Solana Localnet` | `Solana Devnet` | `Solana Mainnet` |
| Keys | Throwaway, generated into `.data/localnet` | Dedicated devnet keys | Multisig + secret-manager hot keys |
| Database | Embedded PGlite or PostgreSQL | PostgreSQL | PostgreSQL with TLS, backups, PITR |

The chain ID is committed into every version fingerprint and the network label into every acceptance
message, so evidence from one environment can never be presented as evidence from another. The API
refuses `localnet` and the embedded database when `NODE_ENV=production`.

### One deployment per network, one switcher

Run a complete, separate stack for each public network you offer (API, workers, indexer, database,
content storage, relayer and attestor keys, web app), each on its own address, for example:

| Network | Web app | Notes |
|---|---|---|
| Mainnet | `https://app.stele.example` | Production |
| Devnet | `https://devnet.app.stele.example` | Integrators' testing |

Never share a database, relayer key or nonce shard between networks. Every web app gets the same
`STELE_NETWORKS` list, which drives the network switcher in the site header and the dashboard:

```env
STELE_NETWORKS=mainnet=https://app.stele.example,devnet=https://devnet.app.stele.example
```

The current network is read from the deployment's own API; switching opens the same page on the
other deployment (dashboard and receipt pages open that network's dashboard and verifier). Every
page of a test network shows a banner saying so. To retire a network, remove its entry from
`STELE_NETWORKS` everywhere and redeploy; no code change is needed. An entry without a URL
(`devnet=`) is listed as "not available". Localnet is never offered in the switcher.

## Prerequisites

- Node.js 24 and pnpm 12.8 (`corepack enable`)
- Rust (stable) and the Agave toolchain 3.1.x (`solana`, `solana-test-validator`, `cargo build-sbf`)
- On Windows: WSL 2 with Ubuntu for the Solana toolchain — the helper scripts in `scripts/dev` sync the
  repository into the Linux filesystem and run commands there
- Optional: Docker (container images), Redis (multi-instance rate limiting)

## Local development

```shell
pnpm install

# 1. Build the program (Linux/WSL). Output: target/deploy/stele.so
bash scripts/dev/build-program.sh            # Windows: wsl -- bash scripts/dev/wsl-run.sh "bash scripts/dev/build-program.sh"

# 2. Throwaway keys, then a validator with the program deployed as upgradeable (admin = upgrade authority)
pnpm localnet:keys                            # prints the public keys; "admin" is the upgrade authority
bash scripts/localnet/validator.sh <ADMIN_PUBKEY>      # foreground; keep it running

# 3. Local configuration and realistic data
pnpm localnet:env                             # writes .env: embedded DB, local keys, fresh secrets
pnpm localnet:seed                            # protocol, an organization, documents, versions, acceptances

# 4. Run the API and the web app
pnpm dev:api                                  # http://127.0.0.1:4000
pnpm dev:web                                  # http://localhost:3000
```

The seeded organization is **Acme Inc.** with the verified domain `acme.example`:

- hosted acceptance page: `http://localhost:3000/accept/acme.example/terms-of-service`
- dashboard: sign in with a browser wallet configured for a local validator, or import
  `.data/localnet/owner.json` into a development wallet. Never use these keys anywhere else.

**Validator disk usage.** Even idle, a test validator produces a few hundred shreds per second.
`validator.sh` caps the ledger at `STELE_LEDGER_SHREDS` (default 1,000,000 ≈ the last hour, a few
hundred MB). Raise it only with disk space to match: under WSL the ledger lives in the distribution's
virtual disk, which grows on the Windows drive and never shrinks by itself. To reclaim space after
deleting a ledger, shut WSL down and compact the virtual disk from an elevated prompt:

```text
wsl --shutdown
diskpart
  select vdisk file="%LOCALAPPDATA%\Packages\<your Ubuntu package>\LocalState\ext4.vhdx"
  attach vdisk readonly
  compact vdisk
  detach vdisk
  exit
```

Because old transactions are pruned, run integration tests soon after seeding (re-seed on a fresh
validator if they report transactions as not found).

### Local domain verification and a test page

Domain verification needs a real DNS record, which you cannot create for `localhost` or a domain
you do not control. On localnet, mark a domain verified directly with the throwaway attestor key:

```shell
pnpm localnet:attest-domain <organization address> mycompany.test
```

The script refuses to run against Mainnet or Devnet. To try the widget on a plain HTML
page, serve `examples/local-widget` (it works with the seeded `acme.example` organization) and open
`http://localhost:8080`:

```shell
npx serve -l 8080 examples/local-widget
```

### Tests

```shell
pnpm test                    # unit tests; tests that need a validator skip themselves
pnpm test:integration        # SDK ↔ API ↔ validator (needs the seeded validator)
bash scripts/dev/test-program.sh   # SBF build + Rust tests (core crates, LiteSVM program tests)
pnpm test:e2e                # Playwright; starts the API and web app if they are not running
PW_CHANNEL=msedge pnpm test:e2e    # use an installed browser instead of Playwright's Chromium
E2E_PRODUCTION=1 pnpm test:e2e     # against the production builds (after `pnpm build`), as CI does
```

### Production builds locally

`pnpm build` produces the artifacts the container images run: the API bundle (`apps/api/dist`,
which carries its SQL migrations in `dist/drizzle`) and the standalone web server, which the build
completes with its client assets and the documentation Markdown. Run them with:

```shell
pnpm --filter @stele/api start      # reads the repository's .env if present
PUBLIC_RPC_URLS=http://127.0.0.1:8899 HOSTNAME=localhost pnpm --filter @stele/web start
```

Set `HOSTNAME` explicitly: the standalone server listens on it, and shells and containers often
preset it to the machine name.

## Building the program reproducibly

Release builds must be reproducible so anyone can check that the deployed bytecode is this source:

```shell
cargo install solana-verify
solana-verify build --library-name stele          # deterministic Docker build
sha256sum target/deploy/stele.so                  # record this hash in the release notes
# after deployment:
solana-verify get-program-hash -u <cluster RPC> <PROGRAM_ID>      # must equal the release hash
solana-verify verify-from-repo -u <cluster RPC> --program-id <PROGRAM_ID> <git URL> --commit-hash <commit>
```

CI builds the program with `cargo build-sbf` and publishes its SHA-256 as a build artifact.

## Deploying to devnet

1. **Keys.** Generate dedicated keys for: the program address, a deployer (temporary upgrade
   authority), the protocol admin (a Squads multisig on devnet is good practice), the domain attestor,
   and the relayer. Store them outside the repository.
2. **Program ID.** If you are not using the published program address, set the new address in
   `declare_id!` (`programs/stele/src/lib.rs`), `Anchor.toml`, `PROGRAM_ID` and
   `NEXT_PUBLIC_PROGRAM_ID`, then rebuild.
3. **Deploy.**

   ```shell
   solana program deploy target/deploy/stele.so --program-id <program-keypair.json> \
     --upgrade-authority <deployer.json> -u devnet
   ```

4. **Initialize the protocol** (the upgrade authority signs; the network label is permanent):

   ```shell
   pnpm --filter @stele/ops init-protocol -- --rpc https://api.devnet.solana.com \
     --label "Solana Devnet" --admin <protocol admin> --attestor <attestor pubkey> \
     --authority <deployer.json>            # dry run; add --yes to send
   ```

   When the upgrade authority is already a multisig, add `--print-instruction` (with
   `--authority-address <vault>`) and propose the printed instruction from the multisig.

5. **Hand over the upgrade authority** to a multisig:

   ```shell
   solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <multisig vault> \
     --skip-new-upgrade-authority-signer-check -u devnet
   ```

6. **Fund** the relayer (it pays acceptance fees) and the attestor (domain records rent).
7. **Configure and start** the API, workers, indexer and web app (below). Run database migrations
   with `pnpm db:migrate` or `MIGRATE_ON_START=true`.
8. **Smoke test:** create an organization in the dashboard, publish a version, accept it from the
   hosted page with a second wallet, and verify the receipt with the CLI against an independent RPC.

## Mainnet checklist

- [ ] Reproducible build; release hash published; `solana-verify` confirms the deployed program.
- [ ] Upgrade authority and protocol admin held by **separate** multisigs (or one multisig with a high
      threshold), signers on hardware wallets, documented signer rotation.
- [ ] Domain attestor and relayer keys generated on a secure host, stored in a secret manager, mounted
      read-only into containers (`RELAYER_KEYPAIR` / `ATTESTOR_KEYPAIR` point at the files), never in
      environment variables or images.
- [ ] Relayer funded with a small float and topped up automatically; alerts on low balance.
- [ ] At least two independent RPC providers with full history in `SOLANA_RPC_URLS`; public,
      key-free endpoints in `PUBLIC_RPC_URLS` (they are sent to browsers and allowed by the CSP).
- [ ] `NEXT_PUBLIC_PROGRAM_ID` and `NEXT_PUBLIC_CHAIN_ID` pinned in the web build.
- [ ] `APP_ORIGIN` on HTTPS; HSTS (sent by the web app in production) and, if possible, preload.
- [ ] PostgreSQL with TLS, encrypted at rest, automated backups and point-in-time recovery.
- [ ] Content storage on S3-compatible storage with versioning and an object-lock retention policy;
      a second copy (another bucket, IPFS pinning or Arweave) for redundancy.
- [ ] `REDIS_URL` set when running more than one API instance (shared rate limits).
- [ ] `TRUST_PROXY_HOPS` equal to the number of proxies in front of the API.
- [ ] `ENCRYPTION_KEY` and `IP_HASH_SECRET` generated randomly and stored in the secret manager.
- [ ] Monitoring and alerts (below) wired to on-call.
- [ ] Incident runbooks (below) rehearsed on devnet.

## Configuration

`.env.example` documents every variable. The important ones:

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | API | PostgreSQL; TLS required unless the host is local. `pglite:<dir>` for single-process development only |
| `APP_ORIGIN`, `EXTRA_APP_ORIGINS` | API | Cookie scope, CSRF origin checks, sign-in message domain, OpenAPI `servers` |
| `APP_ORIGIN` | web (runtime) | Public address: page metadata and the base URL filled into documentation samples (never taken from request headers when set) |
| `HOSTED_ACCEPT_DOMAIN` | API | Host shown as "Requested by" for Stele-hosted pages |
| `SOLANA_CLUSTER`, `SOLANA_RPC_URLS`, `PUBLIC_RPC_URLS` | API, web | Server RPCs may contain provider keys; public ones must not |
| `PROGRAM_ID` | API | The program address |
| `RELAYER_KEYPAIR`, `ATTESTOR_KEYPAIR` | API | File path (preferred), JSON array or base58 |
| `PRIORITY_FEE_MICROLAMPORTS` | API | Priority fee for relayed acceptances |
| `STELE_TREASURY_ADDRESS`, `STELE_CREDIT_PACKS`, `STELE_FREE_RECORDS_PER_MONTH` | API | Billing: where credit purchases are paid (address only, never a key), the packs on sale, the free monthly allowance |
| `ENCRYPTION_KEY` | API | 32 random bytes, base64: encrypts webhook secrets and stored idempotent responses |
| `IP_HASH_SECRET` | API | Keyed hashing of IP addresses for rate limits and sessions |
| `PDF_RENDERER_URL` | API | Internal PDF renderer for PDF receipts (unset: PDF receipts disabled) |
| `STORAGE_*`, `S3_*`, `PUBLIC_CONTENT_BASE_URL` | API | Content storage and the public mirror |
| `RUN_WORKERS`, `RUN_INDEXER` | API | Run workers / the indexer inside the API process (single-node) |
| `STEP_UP_MINUTES`, `SESSION_TTL_HOURS`, `SESSION_IDLE_HOURS` | API | Session policy |
| `API_INTERNAL_URL` | web (build) | Target of the `/api` rewrite, compiled into the build |
| `NEXT_PUBLIC_PROGRAM_ID`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URLS` | web (build) | Pinned into the browser bundle |
| `PUBLIC_RPC_URLS` | web (runtime) | Allowed in the Content Security Policy's `connect-src` |
| `PORT`, `HOSTNAME` | web (runtime) | Listen address of the standalone server |
| `STELE_NETWORKS` | web (runtime) | Networks offered by the switcher: `cluster=url` pairs (see [Environments](#one-deployment-per-network-one-switcher)) |
| `STELE_REPO_ROOT` | web (runtime) | Where the documentation Markdown is read from (default: the standalone root) |
| `STELE_MIGRATIONS_DIR` | API, `db:migrate` | Overrides where SQL migrations are read from (default: shipped with the build) |
| `STELE_PLATFORM_ORGANIZATION` | API | Stele's own organization, which publishes `legal/` (Terms, Privacy Policy). Set: dashboard users accept the current Terms first |
| `STELE_PLATFORM_ADMINS` | API | Wallets of Stele's team: they see Dashboard → Inbox (contact form) |
| `STELE_CONTACT_PER_IP_HOUR` | API | Contact form messages per IP address per hour (default 5) |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | API | The AI assistant (any OpenAI-compatible endpoint). No key: the assistant is hidden |
| `STELE_ASSISTANT_DAILY_LIMIT`, `STELE_ASSISTANT_PER_IP_HOUR` | API | Assistant answers per day (everyone) and per IP address per hour; counters live in the API process |

### Stele's own Terms and Privacy Policy

Stele publishes its legal documents with Stele. The source is `legal/` (`manifest.json` names each
document, its title and version label). To create the organization or publish a changed document:

```bash
# devnet: a dedicated, funded key for Stele's own organization (keep it like any organization key)
STELE_RPC_URL=https://api.devnet.solana.com STELE_APP_URL=https://stele.site \
  pnpm --filter @stele/localnet platform -- --owner ~/.config/stele-devnet/platform-owner.json
```

A changed document needs a new `versionLabel` in the manifest; the script publishes it as a new
version, and every dashboard user is asked to accept it on their next visit. Set the printed
`STELE_PLATFORM_ORGANIZATION` in the server's `.env` once, then restart the API.

### Content storage

The API writes canonical content to its store before a version is published (public behaviour is
described in [Content storage](storage.md)):

| Provider | Configuration | Notes |
|---|---|---|
| Filesystem | `STORAGE_PROVIDER=filesystem`, `STORAGE_DIR` | Development and single-node deployments; files at `sha256/<hash>` |
| S3-compatible | `STORAGE_PROVIDER=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_PREFIX` | AWS S3, Cloudflare R2, MinIO. Enable versioning and an object-lock / retention policy |

Writes are idempotent (the key is the hash). `PUBLIC_CONTENT_BASE_URL` advertises the public mirror
to verifiers. Keep a second copy (another bucket with object lock, IPFS pinning or Arweave).

## Running with Docker

```shell
cp .env.example .env                       # fill in values; never commit it
mkdir -p infra/secrets && cp <relayer.json> <attestor.json> infra/secrets/   # chmod 600
docker compose -f infra/docker-compose.yml --env-file .env up --build
```

The compose file runs PostgreSQL, the API (with workers), a separate indexer and the web app, with
read-only root filesystems, dropped capabilities and secrets mounted as files. Put a TLS-terminating
reverse proxy in front of the web app and set `TRUST_PROXY_HOPS` accordingly.

Processes:

| Process | Command | Scaling |
|---|---|---|
| API | `node dist/main.js` | Horizontally (stateless; set `REDIS_URL`) |
| Workers | `node dist/worker-main.js`, or `RUN_WORKERS=true` in the API | Any number; work is claimed with `SKIP LOCKED` |
| Indexer | `node dist/indexer-main.js` (`STELE_INDEXER_REBUILD=1` replays history) | One or more; idempotent |
| Web | `node apps/web/server.js` (standalone build) | Horizontally |
| PDF renderer | `node apps/pdf-renderer/src/server.mjs` (Chromium + Noto fonts) | One per API host; renders one PDF at a time |

The PDF renderer (`infra/docker/pdf-renderer.Dockerfile`) turns the API's certificate templates into
PDF receipts in any script. It sits on an internal network with no internet access; only the API can
reach it (`PDF_RENDERER_URL`, default `http://pdf-renderer:4100`). Without it, PDF receipts return
503 and everything else keeps working.

## Monitoring

| Signal | Why |
|---|---|
| `/ready` failing | RPC unreachable: acceptances cannot be relayed |
| Relay failures by program error | Misconfiguration, frozen organizations, or abuse |
| Relayer balance | Acceptances stop when it cannot pay fees |
| Shard capacity above 80% | Organizations need another shard before acceptances stop |
| Indexer lag (newest indexed slot vs. cluster slot) | Dashboards and webhooks delayed |
| Webhook endpoints with consecutive failures | Integrations missing events |
| Domain attestations expiring within 30 days and not renewed | Organizations about to show "unverified" |
| Audit-log chain verification failing | Database tampering |
| Program data hash differs from the release | Unexpected upgrade |

## Disaster recovery

The evidence itself lives on Solana and cannot be lost or altered by any failure below. These
runbooks restore service and limit damage.

### Database lost or corrupted

1. Provision an empty database and run migrations.
2. Run the indexer with `STELE_INDEXER_REBUILD=1`; it replays the program's history from an archival
   RPC and rebuilds organizations, members, shards, documents, versions and acceptances.
3. Restore off-chain-only data (users, API keys, webhooks, drafts, audit log) from the latest backup.
   API keys and sessions that cannot be restored must be re-issued.
4. Verify the audit log chain (**Audit log → Verify integrity**); a broken chain means the restored
   data was tampered with.

### Content store lost

Restore from the second copy (bucket replica, IPFS pins, Arweave). Receipts embed full content, so
customers holding receipts are unaffected. Any copy whose SHA-256 matches the on-chain hash is valid.

### Relayer key compromised

The relayer can only submit acceptances that users signed; it cannot forge, alter or replay evidence.
The risks are spent SOL and disrupted service.

1. Generate a new relayer key, fund it, deploy it (`RELAYER_KEYPAIR`).
2. Drain the old key's balance if possible.
3. Ask organizations to re-point their shards: **Organization → Acceptance capacity → Use current
   Stele relayer** (an owner or admin signs `set_shard_relayer`). New shards use the new key
   automatically.

### Domain attestor compromised

An attacker could attest arbitrary domains to arbitrary organizations.

1. The protocol admin multisig rotates the attestor immediately (`set_domain_attestor`).
2. Review every `DomainAttested` event since the possible compromise; revoke illegitimate records with
   the new attestor key (`revoke_domain`).
3. Notify affected organizations. Verifiers can re-check DNS live (`stele-verify --dns`).

### Organization key compromised

Follow [Recovering from a lost or stolen owner key](organization-authority.md#recovering-from-a-lost-or-stolen-owner-key):
freeze with the recovery authority, report compromised member keys, replace the owner after the
72-hour timelock. Evidence published before the compromise remains valid; verifiers flag versions
published by a key after its reported compromise time.

### Program vulnerability

1. The protocol admin multisig pauses the protocol (`set_protocol_paused`): no new organizations,
   documents, versions or acceptances.
2. Fix, build reproducibly, review, and upgrade through the upgrade-authority multisig.
3. Verify the deployed hash, then unpause.
4. Existing evidence stays verifiable throughout; the verifier cross-checks stored versions against
   their original transactions, so a faulty upgrade could not silently rewrite them.

### Web front end compromised

Take the site down or roll back, rotate deployment credentials, and review what was served. Users'
wallets display the exact message they sign; integrators using the SDK with pinned program, network
and RPC endpoints remain protected; receipts and the CLI verifier do not depend on the web app.

### RPC provider outage or misbehaviour

Switch providers via configuration. When several endpoints are configured, the verifier requires them
to agree and reports disagreement as inconclusive rather than trusting either.
