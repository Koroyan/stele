# Trust model: who controls what

Stele's evidence is strong where cryptography and Solana enforce the rules, and only as strong as
the parties involved where they do not. This page lists both, so that nobody — a customer, a judge,
an auditor — has to guess which is which.

## The short version

- **Nobody can sign for a key they do not hold.** Not Stele, not the organization, not the relayer.
- **Nobody can edit or backdate recorded evidence.** A recorded acceptance names one exact version,
  one site, one network and one Solana slot; changing any byte makes the receipt `INVALID`.
- **Who enrolled a key, and what the page displayed, are trusted.** The website that runs the
  signing ceremony controls what the user sees, and whoever runs enrollment decides which key stands
  for which account. Stele makes both visible; it cannot make them trustless.

## Who controls what

| Party | Controls | Cannot do |
|---|---|---|
| **The user** | Their passkey or wallet; whether to approve | — |
| **The organization** | The text it publishes; its own page (when it embeds the widget); which customer account a key is linked to; organization recovery of a lost passkey (admin wallet) | Edit or delete a published version; sign for a user's key; hide a recovery (every verifier shows `ORGANIZATION_RECOVERY`) |
| **Stele's hosted page** | What the hosted acceptance page displays (only text whose hash matches the chain) | Sign for a user's key; change the text after signing without making the receipt invalid |
| **Stele's relayer** | Whether and when an acceptance is submitted; in batched mode, which acceptances go into a batch | Forge, alter or replay an acceptance; overcharge an organization's sponsorship (the program computes the reimbursement) |
| **Stele's domain attestor** | Which organization is shown as the verified owner of a domain (after a DNS check) | Publish, accept or edit anything |
| **The program's upgrade authority** | Future program behaviour | Rewrite past Solana transactions. It *could* change account state or future rules — see [Program authority](#program-authority) |
| **Solana** | Signature verification (direct mode), ordering, time | — |

## Display: what the user saw

WebAuthn prompts show the site, not the agreement, so the text a user saw is whatever the signing page
showed. Stele narrows this gap but does not close it:

- The page shows only text whose SHA-256 fingerprint matches the version on Solana, and refuses to
  sign otherwise.
- Display-safety checks flag bidirectional overrides, zero-width and look-alike characters and
  external links before signing.
- The receipt carries the exact text, so anyone can read afterwards what the signature covers.

These checks run in the signing page. On Stele's hosted page, Stele's code runs them. When an
organization embeds the widget in its own page, the organization controls that page: the checks
catch accidents and injected content, not a malicious organization.

## Enrollment: whose key is it?

The program verifies that a key signed; it cannot know whose key it is.

- **Key-only signers.** The signer is just a passkey public key; the organization links it to a
  customer in its own systems.
- **Account-bound signers.** A `PasskeySigner` account on Solana binds the key to a salted commitment
  of the organization's account ID (never personal data). Rotation must be signed by the current key;
  organization recovery is possible but permanently labeled.

The first enrollment of an account is the trust anchor. Synced passkeys carry no proof of which
device or authenticator holds them, so the program cannot tell a real passkey from a P-256 key
generated in software. Whoever runs the enrollment flow — the organization, or Stele's relayer on its
behalf — could therefore enroll a key it controls for a person who never created one, and sign with
it. What Stele guarantees is narrower and exact:

- after a key is enrolled, nobody else can produce acceptances under it, and replacing it is either
  the user's own rotation or a publicly labeled organization recovery;
- nobody can add, edit or backdate acceptances after a dispute starts.

The origin and user-verification flags in a receipt are attested by the browser and authenticator
**for a genuine passkey**; a software key can set them to anything.

## Batched mode

In `MERKLE_BATCHED` mode the relayer verifies signatures off-chain and anchors one Merkle root per
batch. Solana orders and timestamps the root; the user's signature — which anyone can re-verify from
the receipt — is what makes a leaf an acceptance. The relayer can delay or omit a leaf (the user's
acceptance then stays `pending`), but it cannot create one.

## Verifying years later

Direct-mode evidence lives in Solana transactions. Verifying it later needs a Solana RPC that serves
historical transactions (an **archival** RPC) — many public endpoints keep only recent history.
Receipts carry the text, the signatures and the transaction signature; batched receipts also carry
their Merkle proof, and batch manifests are public.

## Domain attestations

A verified domain means Stele's attestor saw the organization's DNS TXT record when it attested, and
wrote that on-chain with a time. The on-chain attestation time is the authority; a live DNS re-check
shows only who controls the domain today.

## Program authority

The program is upgradeable. An upgrade cannot rewrite past transactions, but it could change account
state or future rules, so "immutable" is not claimed. The current authority, the move to a multisig
and the path to an immutable program are tracked in the README and the upgrade-authority procedure.

## What Stele does not claim

- That a signature proves a person's legal identity.
- That an agreement is legally enforceable — that depends on law and circumstances.
- That anything is "trustless": the display and enrollment are trusted, as described above.
