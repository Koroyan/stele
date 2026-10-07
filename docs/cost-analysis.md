# Cost analysis (measured)

Every number below comes from confirmed transactions on a local validator (Agave 3.1, the same
program binary as Devnet's next upgrade), read back with `pnpm --filter @stele/localnet costs`
(`tools/localnet/src/costs.ts`) on 2026-10-05. Run it against any cluster:

```shell
STELE_RPC_URL=https://api.devnet.solana.com pnpm --filter @stele/localnet costs
```

**The user pays nothing in every mode.** The relayer is always the fee payer; an organization may
reimburse it from a sponsored shard (on-chain, exact fee, capped).

## Transaction fees (no priority fee)

| Recording | Fee (lamports) | Signatures charged | Compute units (median) | Transaction bytes (max seen) |
|---|---|---|---|---|
| `stele/1` acceptance — wallet or PRF passkey (Ed25519 precompile) | 10,000 | relayer + Ed25519 | 29,746 | 1,048 |
| `stele/2` acceptance — native passkey (secp256r1 precompile) | 10,000 | relayer + secp256r1 | 28,489 | 860 |
| Passkey enrollment (account-bound signers, once per account) | 10,000 + rent below | relayer + secp256r1 | 42,864 | 879 |
| Passkey rotation | 10,000 | relayer + secp256r1 | 35,232 | 814 |
| Merkle batch anchor (any number of acceptances, up to 65,536) | 5,000 | relayer | 7,733 | 386 |
| Proof (purchase) | 10,000 | relayer + Ed25519 | 36,524 | 1,074 |

A priority fee adds `compute-unit limit × price / 10⁶` lamports: the API sets a 60,000-unit limit for
recordings and 30,000 for batch anchors, so at 10,000 micro-lamports per unit that is +600 and +300
lamports. Organization-sponsored shards reimburse exactly this formula (measured: 10,600 lamports for
a sponsored acceptance at 60k × 10k; 5,200 for a batch anchor at 20k × 10k).

## Rent (state), distinguished from fees

| State | Size | Rent-exempt deposit | Who pays | Notes |
|---|---|---|---|---|
| Nonce shard (65,536 direct recordings) | 8,320 bytes | 58,798,080 lamports (0.0588 SOL) | organization admin, once per shard | ≈ 897 lamports per direct recording when the shard is used up |
| Sponsorship trailer on a shard | +120 bytes | +835,200 lamports | organization admin, once | only if the organization sponsors fees |
| `PasskeySigner` enrollment | 225 bytes | 2,456,880 lamports (0.00246 SOL) | Stele's relayer, once per account-bound signer | capped per organization per month (`STELE_MAX_ENROLLMENTS_PER_MONTH`) |
| Per acceptance (direct or batched) | 0 bytes | 0 | — | no account is created per acceptance: a bit in the shard bitmap (direct) or a leaf in a root (batched) |

The program has no close instructions, so these deposits stay locked with their accounts.

## Per 1,000 and per 1,000,000 acceptances

Fees (no priority fee) plus the shard rent each mode consumes. Direct mode, wallet or native
passkey: 10,000 lamports of fees + ≈ 897 lamports of shard rent per acceptance.

| Mode | Per acceptance | Per 1,000 | Per 1,000,000 |
|---|---|---|---|
| Direct (wallet or native passkey) | ≈ 10,897 lamports | ≈ 0.0109 SOL | ≈ 10.9 SOL |
| Batched, 1 acceptance per anchor | 5,000 lamports | 0.005 SOL | 5 SOL |
| Batched, 64 per anchor | ≈ 78 lamports | ≈ 0.000078 SOL | ≈ 0.078 SOL |
| Batched, 1,024 per anchor (API maximum) | ≈ 4.9 lamports | ≈ 0.0000049 SOL | ≈ 0.0049 SOL |

Batched mode consumes no nonce bits (one shard per organization still gates the relayer). Its fee
per acceptance is 5,000 / *n* lamports for a batch of *n*; the API anchors every 10 seconds, so *n*
is whatever arrived in that window (up to 1,024).

Account-bound native passkeys add 2,456,880 lamports **once per account** (not per acceptance).

## What the numbers mean

* A native-passkey acceptance costs the same as a wallet acceptance: both charge two signatures
  (the precompile signature is charged like a transaction signature). It uses slightly fewer compute
  units and a smaller transaction (no 32-byte Ed25519 key, no message bytes on-chain).
* Batching removes the per-acceptance signature fee and the nonce bit: at the default batch size it
  is about 2,000 times cheaper per acceptance. In exchange the chain no longer verifies each
  signature — every verifier does (PROTOCOL_SPEC.md §17.9).
* Rent dominates only for account-bound signers' first enrollment; key-only native passkeys and PRF
  passkeys need no on-chain state at registration.

## Stele Gate

Measured the same way on 2026-10-07 (the live-demo flow of `pnpm --filter @stele/localnet gate-smoke`).

| Transaction | Fee (lamports) | Who pays | Compute units | Transaction bytes |
|---|---|---|---|---|
| Gated acceptance that creates the AccessPass | 10,000 + pass rent below | Stele's relayer (fee reimbursable by a sponsored shard) | 41,978 | 1,133 |
| Gated acceptance that advances the pass to a newer version | 10,000 | Stele's relayer | 39,368 | 1,133 |
| `create_policy` | 5,000 + policy rent below | the organization | 23,381 | 486 |
| `publish_version` + `set_policy_requirement` in one transaction | 5,000 | the organization | 73,056 | 610 |
| Demo vault `deposit`, including `require_current` | 5,000 per signature | the investor (the live demo relays it: 2 signatures, 10,000) | 9,406 | 383 |

| State | Size | Rent-exempt deposit | Who pays |
|---|---|---|---|
| `AccessPass` | 233 bytes | 2,512,560 lamports (0.00251 SOL) | Stele's relayer, once per wallet and document |
| `GatePolicy` | 157 bytes | 1,983,600 lamports (0.00198 SOL) | the organization, once per document |

`require_current` reads two accounts and writes nothing; the deposit's 9,406 units cover the whole
instruction (Anchor's account handling, `require_current` and the vault update). A gated acceptance
uses about 10,000–12,000 more units than a plain wallet acceptance (29,746) because it also writes
the pass.

## Sizes and limits

Solana transactions are limited to 1,232 bytes. A `stele/2` acceptance with typical browser client
data (~120–230 bytes) and domains of 20–30 characters measures 860–980 bytes. The client-data limit
(512 bytes) plus maximal request domain and RP ID (64 bytes each) would exceed the limit; such
assertions are refused by the network, not mis-recorded. Moving static accounts into an address
lookup table would recover ~150 bytes if browsers ever produce much longer client data.
