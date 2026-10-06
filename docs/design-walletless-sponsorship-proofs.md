# Design: walletless signing, fee sponsorship and commerce proofs

> **Internal documentation.** Repository only; not published on the website.

Status: implemented and tested on localnet (program, protocol, API, verifier, SDK, widget, web,
demo shop). Normative rules: PROTOCOL_SPEC.md §12–§14; threats: SECURITY_THREAT_MODEL.md §6.

## A. What exists and is reused

| Existing piece | Reused for |
|---|---|
| `record_acceptance`: Ed25519 precompile + strict introspection, message rebuilt on-chain, nonce bitmap shards, accumulator | Walletless acceptances unchanged (a passkey-protected key is an ordinary Ed25519 key); `record_proof` shares the introspection, window checks, shards and accumulator |
| `stele-acceptance-v1` message (protocol `stele/1`) | Unchanged |
| Relayer (`apps/api`), relayer-gated shards | Fee payer for every mode; the user never pays; the shard's designated relayer is the only party a sponsored shard pays |
| Nonce shards | Also the organization's sponsorship deposit (trailer appended on opt-in) |
| Acceptance sessions (`externalUserRef`) | "Account + Passkey" policy |
| `stele-receipt-v1` and the verifier's claim-by-claim comparison | Optional `signer` and `fees` evidence; old receipts verify unchanged |
| Organization settings | Signing policy, fee sponsor, fallback, low-balance threshold |
| Audit log (hash-chained) and webhooks | Identity changes, proofs, low-balance alerts |

## B. Decisions

1. **No protocol version change for acceptances.** The signed bytes and on-chain verification are
   identical for wallet and passkey signers; `stele/2` is not cryptographically necessary.
2. **Passkey-protected Stele key.** Generated in the browser (Ed25519); the seed is wrapped with
   AES-256-GCM under `HKDF-SHA256(PRF output)`, with the public key and credential ID as AAD. The server
   stores ciphertext, PRF salt and credential public key only. **No PRF, no walletless signing**: no
   server-held or password-derived fallback.
3. **One ceremony per signature.** One user-verified assertion over
   `SHA-256("stele:v1:passkey-signature\0" ‖ message)` approves the message and releases the PRF
   output. The API refuses to relay a passkey signer's record without it; a registered key cannot sign
   in wallet mode. The assertion is kept for receipts.
4. **Identities are per organization; RP ID = requesting host.** A non-secret hint (public key and
   credential ID) is kept in `localStorage`; a new device identifies with a discoverable assertion.
5. **Identity changes need the key.** Added passkeys and recovery kits require a statement signed by
   the key (unlocked by an existing passkey or the recovery kit); revocations too. Losing every method
   leads to an organization-authorized **new** key (`account_authorized` rotation), never control of
   the old key. Endorsed rotations are signed by both keys.
6. **Organization sponsorship = a sponsored nonce shard (not a separate vault).** A separate
   `SponsorVault` account was built first and measured: it pushes the worst-case acceptance transaction
   to **1,259 bytes** (limit 1,232; the existing worst case is 1,226). Lookup tables would add
   operational state. Instead the shard — already in every recording transaction, program-owned, with
   no private key — becomes the deposit address via an opt-in 120-byte trailer (limits, counters,
   pause). The program reimburses the shard's designated relayer the exact fee computed from the
   transaction's compute-budget instructions, capped per record and per UTC day, never below rent; when
   it cannot pay, nothing is paid and the record still succeeds. Only the owner withdraws; admins may
   only pause or lower limits.
7. **Stele sponsorship** keeps the relayer-pays model with a monthly quota per organization and
   per-transaction accounting read back from each confirmed transaction; when nobody can pay, the API
   refuses **before** anyone signs (`402`).
8. **Generic proofs.** `record_proof` anchors `SHA-256(canonical, salted statement)` under a 13-line
   message naming type, organization name **and address**, network, chain ID and nonce. The statement
   (items, amounts, references, policy versions, optional commitments to personal data) stays
   off-chain in `stele-proof-v1` receipts, served only to the organization or the customer's token.

## C. Changes

- Program: `record_proof`; `enable_shard_sponsorship`, `update_shard_sponsorship`,
  `withdraw_shard_sponsorship`; reimbursement inside both record instructions; events `ProofRecorded`,
  `SponsorReimbursed`, `SponsorshipChanged`, `SponsorWithdrawal`; errors appended (codes stable).
- Core and protocol: proof messages and IDs (shared vectors), fee arithmetic, statements, WebAuthn
  verification (ES256/EdDSA/RS256, no CBOR), key statements, key wrapping, recovery kits, test
  authenticator.
- API: passkey registration/identification/key material/recovery kits/revocation, identity listing
  and reset, assertion enforcement, signing policy, sponsorship planning/accounting/overview, proof
  requests, receipts, transaction allowlist for the relayer, webhooks.
- Verifier: signer evidence, fee evidence, `verifyProof`.
- SDK and widget: `PasskeySigner`, `confirmProof`, receipts, `mountProof`, method choice, recovery kit.
- Web: Signing & fees dashboard, hosted passkey acceptance, `/confirm`, receipt and verify pages.
- Demo shop: passkeys, purchase proofs at checkout, account security page.

## D. Security risks considered

Backend, database or organization compromise; sponsor draining; passkey phishing (origin-bound
WebAuthn); XSS while a key is unlocked (single-signature unlock, assertion required by the relayer);
offline brute force of wrapped keys (256-bit PRF-derived keys); recovery and rotation abuse; replay,
cross-origin, network, document, version and cross-record substitution. Details:
SECURITY_THREAT_MODEL.md §6.

## E. Limits stated honestly

- Synced passkeys are as strong as the platform account that syncs them.
- An organization's account recovery can obtain a new key for an account (visible, never the old key).
- A compromised relayer can make a sponsored shard pay network fees for throwaway recordings up to the
  daily limit (bounded; fees go to validators).
- A page compromised while a key is unlocked could misuse that one unlocked key; the relayer still
  requires the passkey's approval of each message, and Stele-created shards are relayer-gated.
