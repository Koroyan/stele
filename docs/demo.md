# Demo walkthrough — "Prove what was agreed" (Devnet)

Fourteen steps, about six minutes. The organization side uses the dashboard with a Devnet wallet;
the consumer side uses a clean browser with **no wallet, no SOL and no seed phrase**.

## Before the demo

1. **Stele on Devnet.** Either the hosted deployment (VPS, [deployment guide](deployment.md)) or the
   local stack pointed at Devnet: in `.env` set `SOLANA_CLUSTER=devnet`,
   `SOLANA_RPC_URLS=<two independent Devnet RPC URLs>`, the Devnet `PROGRAM_ID`, `RELAYER_KEYPAIR`
   and `ATTESTOR_KEYPAIR`, then `pnpm dev:api` and `pnpm dev:web`. Passkeys work on `https://` sites
   and on `http://localhost`.
2. **Organization.** In the dashboard (signed in with a Devnet wallet): create the organization
   "Northwind Shop", verify its domain if you have one, create a nonce shard relayed by Stele, and
   set **Signing & fees → Wallet or passkey** (or **Your account + passkey** to show on-chain
   enrollment).
3. Open a second browser profile in incognito mode for the consumer.

## The story

| # | Action | What it shows |
|---|---|---|
| 1 | Dashboard → Documents → **Terms of Service** → publish v1 with the text below (refunds: **30 days**). | The organization signs the publication with its own wallet. |
| 2 | Open the version page / Solana explorer: the version account, its fingerprint and the publication transaction. | The document version is committed on Solana; its fingerprint is the SHA-256 of the canonical text and links to the previous version. |
| 3 | In the incognito profile open `/accept/<organization>/terms-of-service` (or the shop's page with the widget). | No Phantom, no SOL, no seed phrase. |
| 4 | Read the text. The page checked its hash against Solana before showing it; a mismatch would block signing. | The reader sees exactly the canonical text behind the fingerprint; invisible or look-alike characters would be flagged. |
| 5 | Tick the box and click **Create a passkey to accept**, then **Accept & sign**. | |
| 6 | Windows Hello / Touch ID / Face ID / Android prompt. | The passkey's own P-256 key signs a WebAuthn challenge derived from the exact message; the private key never leaves the authenticator. |
| 7 | "Acceptance recorded on Solana — you paid nothing." | The relayer submitted `[secp256r1 verify, record_passkey_acceptance]`; Solana verified the signature; Stele or the organization paid the fee. |
| 8 | **Download receipt** (`stele-receipt-….json`). | A portable `stele-receipt/2` with the exact text, the WebAuthn data and the transaction. |
| 9 | Open **/verify**, paste the receipt — or run the CLI (below). Verdict **VALID** (or VALID with the warning "confirmed, not yet finalized" for a few seconds). | Shows: the exact text, version, document fingerprint, signer type **PASSKEY_P256**, **browser-attested origin**, **user verification**, the Solana transaction and slot. |
| 10 | Dashboard → publish v2 with **7 days** instead of 30. | A new immutable version, hash-chained to v1. |
| 11 | Verify the **old** receipt again. | Still VALID — for the exact v1 / 30-day text. The verifier reports that v2 was published later. |
| 12 | Edit one character of the receipt's message, or of the embedded Terms, and verify. | **INVALID** — every claim is compared with the chain; the text must hash to the on-chain commitment. |
| 13 | Run the forgery demo (below). | Four attempts by an operator holding the relayer key — forged signature, a server-held key presented as the user's, the user's real assertion replayed, a rotation without the user's passkey — are all **rejected by Solana**. |
| 14 | Stop the Stele API and database (`docker compose -f infra/docker-compose.yml stop api indexer postgres`, or stop `pnpm dev:api`). Verify the receipt with the CLI. | Still **VALID**: portable evidence + Solana RPC. Nothing called Stele. |

### Terms text

Version 1.0 (step 1):

```
# Northwind Shop Terms of Service

## Returns
You may return unused items within 30 days for a full refund. Return shipping is free.

## Payment
Prices include VAT. You are charged when your order ships.
```

Version 2.0 (step 10): the same with `within 7 days`.

### Step 9 and 14 — verify without Stele

```shell
npx tsx packages/verifier/src/cli.ts \
  --rpc https://api.devnet.solana.com --rpc <second Devnet RPC> \
  --receipt stele-receipt-<id>.json --show-text
```

The output lists every check, then:

```
Verdict: VALID
Organization: Northwind Shop (…) …
Version:      Terms of Service 1.0 (#1) fingerprint …
Accepted by:  p256:03… in slot … (tx …)
Evidence:     stele/2 · DIRECT_ONCHAIN
Signer type:  PASSKEY_P256 (native WebAuthn, ES256) · user verification: yes · relying party …
Origin:       https://… — browser-attested through WebAuthn
```

`--show-text` prints the signed message and the full canonical Terms. With two RPCs, any
disagreement makes the verdict INCONCLUSIVE rather than VALID.

### Step 13 — forgery attempts

```shell
STELE_RPC_URL=https://api.devnet.solana.com STELE_PROGRAM_ID=<program> \
  pnpm --filter @stele/localnet forgery-demo -- --receipt stele-receipt-<id>.json
```

Each attempt is simulated with the real relayer as fee payer (nothing is signed, recorded or paid).
With an account-bound signer the output reads:

```
✔ rejected  1. new acceptance claiming the user's key, forged signature
    instruction 0 (secp256r1 precompile): the signature does not verify (code 2)
✔ rejected  2. server-held P-256 key, valid signature, presented as the user's enrolled signer
    instruction 1: EnrollmentMismatch — The passkey enrollment does not belong to this organization or signer
✔ rejected  3. the user's real assertion replayed for a new acceptance
    instruction 1: InvalidClientData — WebAuthn client data is not an assertion for this acceptance
✔ rejected  4. enrollment handed to a server key, signed by the server
    instruction 1: EnrollmentMismatch — The passkey enrollment does not belong to this organization or signer
```

(Key-only signers have no enrollment, so attempts 2 and 4 do not apply: a server-made key is simply a
different signer, and receipts name the key.) Say it precisely: the demo shows that nobody can sign
for an **enrolled** user. Whoever runs enrollment could still register a software key for a person
who never enrolled — see the [trust model](trust-model.md). The same four attempts run in the automated suite
(`apps/api/test/native-passkeys.localnet.test.ts`).

## The 3-minute video cut

1. Publish a version (step 1).
2. Accept with a passkey in a clean browser — overlay: "no wallet · 0 SOL" (steps 3–7).
3. Download the receipt and verify it on a different domain or with the CLI (steps 8–9).
4. Publish v2; the old receipt still proves v1 (steps 10–11).
5. Edit one character: `INVALID` (step 12).
6. The four forgery attempts as a fast montage (step 13).
7. Servers off; the receipt still verifies (step 14).

Show the measured costs as an overlay. Leave out batching internals, domain attestation and dashboard
tours.

## Talking points

- **What it proves:** a WebAuthn credential produced a user-verified signature for this exact
  version on this site, recorded on Solana. **Not** who the person is, nor what the authenticator
  displayed (passkey prompts show the site; the page showed the text), nor legal enforceability.
- **Cost:** about 0.00001 SOL per directly recorded acceptance; about 5 lamports in Merkle batches of
  1,024 ([measured](cost-analysis.md)). The user pays nothing in either mode.
- **Authority:** the Devnet program's upgrade authority is a single key today — it is not immutable;
  the multisig plan is in [upgrade-authority.md](upgrade-authority.md).
- **Wallets still work:** a wallet acceptance verifies too, with the honest warning "origin:
  merchant-claimed, not browser-attested".
- **Why Solana:** a neutral witness (nobody controls the ordering and timestamps) and a key registry
  whose rules the program enforces — plus native passkey verification and seconds-level finality.
- **Say:** "nobody can sign for an enrolled user, or edit or backdate the evidence"; "verify with any
  archival Solana RPC". **Don't say:** "trustless", "immutable" (the program is upgradeable today),
  "legally enforceable".
