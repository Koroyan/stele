# Acceptance & signing

This page explains exactly what a user signs, how the signature reaches Solana, what the program checks,
how anyone can verify the result, and — just as important — what an acceptance does **not** prove.

## What the user sees and signs

The user's wallet displays a fixed, versioned, human-readable message:

```
Stele Protocol v1 - Accept Agreement
I accept the exact document version below.
Organization: Acme Inc. (verified: acme.example)
Document: Acme Terms of Service
Version: 2.0 (#2)
Fingerprint: 9f3b48d76dee523326115c3726b446dc2e4c4efcc535f931f192f5c94d98b7a8
Account: 6254MWqadsGbUFNh84NiWMNmVnoAjdbmEfiyebfA991s
Network: Solana Mainnet
Issued: 2026-10-02T14:03:11Z
Expires: 2026-10-02T14:13:11Z
Nonce: 0-1842-9c1e2b7a4d0f6e35
Requested by: acme.example
```

| Line | Why it is there |
|---|---|
| Header and statement | Unambiguous intent; the protocol version makes the format self-describing |
| Organization | Who is asking, and whether its domain is **verified** — or an explicit `unverified` |
| Document, Version | What is being accepted, in human terms |
| Fingerprint | Binds the signature to one exact, immutable version (title, label, effective date, text, predecessor, network, program) |
| Account | The signing key, so a signature cannot be presented as someone else's |
| Network | A devnet or testnet signature can never be recorded or presented as mainnet evidence |
| Issued, Expires | A short validity window (10 minutes by default, 60 at most), checked against Solana cluster time |
| Nonce | A single-use slot: shard, bit index and a random tag |
| Requested by | The site that asked for the signature — a phishing tell users can check |

The message is deliberately different from the dashboard sign-in message (which starts with
`<host> wants you to sign in with your Solana account:` and states that it authorizes nothing), so a
login signature can never be replayed as an acceptance, or vice versa.

## The flow

1. **Verified display.** The hosted page or SDK reads the document version **from Solana**, downloads
   the text from any source, checks `SHA-256(text) = content_hash`, recomputes the fingerprint and
   confirms the version is current. Nothing is shown — and signing is impossible — if any check fails.
2. **Challenge.** The API allocates a nonce and returns the message, built from chain data at cluster
   time. The requesting site is taken from the browser's `Origin` header, never from the request body.
   Organization policy is applied here: allowed requesting sites, required acceptance sessions, and a
   cap on open challenges.
3. **Independent rebuild.** The browser rebuilds the message from the chain data it verified and
   refuses to continue unless the API's message is byte-identical.
4. **Signature.** The wallet signs the UTF-8 bytes with Ed25519 (`solana:signMessage`). The user signs
   a message, not a transaction: no SOL is needed and no funds can move.
5. **Relay.** The relayer checks the signature, then submits
   `[compute budget] [Ed25519 verify] [record_acceptance]`, paying the fee. It cannot change the
   message (the signature would no longer verify) and cannot reuse it (the nonce is consumed).
6. **On-chain checks** (below), then confirmation, indexing from the confirmed transaction, a receipt,
   and webhooks.

## What the program checks

`record_acceptance` refuses the transaction unless:

1. the protocol is not paused and the organization is not frozen;
2. the version is the document's **current** version and belongs to this document and organization;
3. the nonce shard belongs to the organization and, if it names a relayer, the transaction is signed
   by that relayer;
4. it is a top-level instruction (not called through another program);
5. the immediately preceding instruction is the native Ed25519 program with the **canonical layout**
   — one signature, fixed offsets, all data inside that instruction — so the verified key, signature
   and message are exactly the bytes the program reads;
6. the validity window holds against the Clock sysvar: issued no more than 5 minutes in the future
   and no more than 5 minutes before the version was published, expiring after issuance, at most 60
   minutes long, and not yet expired;
7. the message starts with the 11 lines and `Requested by: ` prefix that the program rebuilds from
   its own state and the instruction's arguments, and ends with a valid hostname;
8. the nonce bit is clear — it is then set, so the same message can never be recorded again.

It then computes the acceptance identifier, folds it into the shard's accumulator and emits
`AcceptanceRecorded`:

```
message_hash  = SHA-256(message)
acceptance_id = SHA-256("stele:v1:acceptance\0" ‖ version ‖ signer ‖ message_hash ‖ signature)
accumulator'  = SHA-256("stele:v1:accumulator\0" ‖ accumulator ‖ acceptance_id)
```

The worst-case transaction (all names, titles and domains at maximum length) fits in Solana's
1,232-byte packet limit; field limits were chosen to guarantee it and a test asserts it.

## How verification works

Anyone can verify an acceptance with nothing but its transaction signature (or a receipt) and RPC
access — in the browser at `/verify`, with the `stele-verify` CLI, or with `@stele/verifier` in code.

```shell
npx @stele/verifier --rpc https://rpc-one.example --rpc https://rpc-two.example --tx <signature>
```

The verifier:

1. confirms the RPC serves the expected network (genesis hash) and the program's configuration;
2. fetches the transaction (from every configured RPC — they must agree), requires success and
   reports whether it is finalized;
3. checks the transaction shape and re-verifies the Ed25519 signature locally (strict RFC 8032);
4. parses the message and checks it against the version, organization and protocol accounts;
5. recomputes the version fingerprint, fetches the content from the receipt, the storage URI or a
   mirror, and requires `SHA-256(content) = content_hash` and canonical form;
6. walks the version chain to version 1 and cross-checks each version account against the
   `publish_version` transaction that created it — so a malicious program upgrade or a lying RPC
   that rewrote a stored version is detected;
7. confirms the nonce bit is set and recomputes the acceptance ID;
8. for a receipt, compares **every** claim in the bundle with the facts it just derived.

Verdicts: `VALID`, `VALID_WITH_WARNINGS` (for example "confirmed but not yet finalized" or "the
organization has since been renamed"), `INVALID` (a critical check failed) and `INCONCLUSIVE` (a
critical check could not be completed — RPCs disagree, the content is unavailable, or the RPC no longer
holds the transaction's history). The verifier never reports success for evidence it could not check.

## What an acceptance proves

- This exact document text, committed by its fingerprint, existed and was the current version.
- The private key for the `Account:` address signed this exact message, which names that version.
- The acceptance was recorded on the named network no later than the block's time, within the signed
  validity window, and only once.

## What it does not prove

- **Who controls the key.** A wallet address or a passkey signer is not a legal identity. If you need to know which of
  your customers signed, issue an acceptance session from your server with your own user reference
  (kept off-chain) or combine Stele with your identity verification.
- **That the person read or understood the document.** The protocol records consent to an exact text;
  how that text was presented is up to the integrating site.
- **Legal enforceability.** Enforceability depends on jurisdiction, the type of agreement, how
  acceptance was presented, and other facts. Stele provides strong technical evidence, not a legal
  conclusion.

## Presenting acceptance responsibly

- Show the full text, or a clear link to it, before asking for a signature. The hosted page and the
  React component show only hash-verified text.
- Never present a checkbox or a button click as a cryptographic signature. If a user cannot sign with a
  wallet or a passkey, record that acceptance as an ordinary click-through in your own systems — not
  as Stele evidence.
- Make the requesting site obvious and stable: users and wallets see `Requested by:`. Restrict the
  allowed sites in **Organization → Acceptance policy**.
- Verify your domain, so the message says `verified: your-domain` rather than `unverified`.

## Signing without a wallet: native passkeys

Visitors without a wallet sign with a **passkey** — Face ID, Touch ID, Windows Hello, an Android
phone or a security key. The passkey's own P-256 key signs: its private key never leaves the
authenticator, and nothing is generated, encrypted or stored by Stele or the browser's JavaScript.

What the user approves is a WebAuthn challenge computed from the exact message above (whose signer
line names the passkey's public key). Solana's secp256r1 program verifies the signature, and the Stele
program checks before recording that:

- the challenge is that of the message it rebuilds from on-chain data (organization, title, version,
  fingerprint, network, validity window, nonce, requesting site);
- the browser reported the requesting site's own origin, from a top-level page (not a frame);
- the passkey belongs to the right relying party, and the authenticator asserted **user
  verification**;
- for organizations that bind passkeys to their accounts, the key is the account's enrolled signer.

What this proves: a WebAuthn credential produced a **user-verified** signature for this acceptance on
this site. What it does not prove: who the person is; what the passkey prompt displayed — passkey
prompts show the site, not the agreement, so the text is what the signing page showed (Stele's pages
and widget show only hash-verified text and flag invisible or look-alike characters); that a synced
passkey was not used from another device of the same provider account.

**Origin.** With a passkey, the requesting site is **browser-attested**: the browser writes it into
the signed data. With a wallet, `Requested by:` is written by the requesting page; the signature
makes it unalterable afterwards, but no browser attested it. Verifiers report the difference.

**Changing passkeys.** For account-bound signers the current passkey must approve a new one
(rotation). If every passkey is lost, the organization's admin wallet can authorize a replacement on
Solana; every verifier shows it as an **organization recovery**, never as the user's own act. Past
acceptances keep their original key and stay valid.

## Signing without a wallet: passkey-protected keys (earlier signers)

Signers registered before native passkeys use this scheme, which keeps working. The browser created an ordinary Ed25519
signing key and encrypts it under a secret only the passkey can release (the WebAuthn PRF extension,
after Face ID, a fingerprint or a device PIN). Stele stores only the encrypted key. To sign, one
passkey prompt approves the exact message and unlocks the key for that one signature.

On Solana nothing differs: the program verifies an Ed25519 signature over the same message, so every
property above holds unchanged. The receipt additionally carries **passkey evidence** that any
verifier checks: a statement signed by the key naming its passkey (endorsed by that passkey), and the
passkey's user-verified approval of this exact message on the requesting site.

What passkey evidence adds: that a passkey registered to the key approved this message, with user
verification, on that site. What it does not add: who the person is. Like a wallet, a passkey proves
control, not identity — and synced passkeys are as safe as the platform account they sync with.

Stele never falls back to a key it holds: without PRF support, the visitor signs with a wallet. If a
user loses every passkey and their recovery kit, nobody can recover the key; the organization can only
authorize a **new** key for the account, which is recorded as such and never inherits the old key's
history.

Custodial or SSO logins can identify a user to an integrator, but they do not produce a
user-controlled signature and are never presented as one.

## Privacy

Nothing personal is written on-chain: the chain holds the wallet's public key, hashes, the
organization's public data, timestamps and the requesting hostname. Links between a wallet and a real
person, email or customer ID stay in the integrator's systems (or in Stele's off-chain acceptance
sessions). Note that a wallet address is a pseudonym: acceptances made with the same wallet are
linkable to one another on a public ledger. Privacy-conscious users can use a separate account per
service.
