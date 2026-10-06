# How Stele works

Stele turns three moments into evidence: **publishing** a document, a person **accepting** it, and
anyone later **verifying** what was agreed. The evidence lives on Solana, a public blockchain, so it
does not depend on Stele, on the company, or on any database staying honest.

## The parties

| | Role |
|---|---|
| **Organization** | Publishes documents (terms of service, privacy policies, contracts) with its own wallet keys |
| **User** | Reads a document and accepts it by signing with their own wallet |
| **Stele** | Prepares documents, shows them, relays acceptances to Solana and provides the dashboard, API and SDK. It holds no one's keys and cannot alter evidence |
| **Solana** | Stores the commitments: the Stele program enforces every rule, and the ledger keeps the history |
| **Anyone** | Can verify, using the open-source verifier and any Solana endpoint |

## 1. Publishing

1. The organization writes or pastes its document in the dashboard.
2. Stele **canonicalizes** the text into exact bytes, so that the same document always produces the
   same bytes on every device, and computes their SHA-256 hash (the *content hash*).
3. The text is stored, addressed by that hash.
4. The organization's wallet signs the publication. The Stele program on Solana computes the
   version's **fingerprint**, which commits to the content hash, the organization, the document, the
   version number, the title, the effective date, the network and the previous version's fingerprint,
   and stores it in a new, permanent version account.

Published versions cannot be edited or deleted, by the organization, by Stele, or by anyone else.
Changing the terms means publishing a new version, which links to the previous one. The history
therefore forms a chain that cannot be reordered, and hiding an old version would break it.

Who may publish is decided by the program from the organization's on-chain roles: an owner (ideally a
multisig), admins and publishers. Organizations can prove their domain with a DNS record; Stele
attests it on-chain with an expiry, and users see the domain with a check mark.
[Organizations & authority](organization-authority.md) explains roles, recovery and freezing.

## 2. Accepting

1. The user opens the document, either on the organization's own site through the
   [embeddable widget](get-started.md) or on Stele's hosted page.
2. Before showing anything, the browser downloads the text, hashes it and compares it with the
   fingerprint on Solana. Altered text is never displayed.
3. The user's wallet shows a short, readable message to sign, for example:

   ```
   Stele Protocol v1 - Accept Agreement
   I accept the exact document version below.
   Organization: Acme Inc. (verified: acme.com)
   Document: Terms of Service
   Version: 2.0 (#2)
   Fingerprint: 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
   Account: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
   Network: Solana Mainnet
   Issued: 2026-10-03T09:30:00Z
   Expires: 2026-10-03T09:40:00Z
   Nonce: 0-1842-9f86d081884c7d65
   Requested by: shop.acme.com
   ```

   The message names the exact version, the network, a validity window of a few minutes, a
   single-use number, and the site that asked for the signature.
4. Stele submits the signature to Solana and pays the small network fee. The program checks the
   signature itself, rebuilds the message from its own records, and accepts it only if every line
   matches and the single-use number has never been used. The acceptance is recorded permanently.
5. The user receives a **receipt** that anyone can verify.

Signing a message cannot move funds or approve a transaction. The relayer that submits the
acceptance cannot change it: any change would invalidate the user's signature.

## 3. Verifying

Anyone holding a transaction signature or a receipt can check, against Solana and without asking
Stele, that this exact text was the current version, that this key signed this exact message, and
that it was recorded once, on the named network, at the recorded time. See
[Verification](verification.md).

## What is stored where

| | Where | Public? |
|---|---|---|
| Fingerprints, content hashes, version history, organization roles, verified domains | Solana | Yes |
| Acceptances: the signer's public key, the version, the time, the requesting site | Solana | Yes |
| Document text | Stele's storage, receipts, and optionally IPFS or Arweave | Yes: published documents are public |
| Your link between an acceptance and your own user ID | Stele, off-chain | No |
| Drafts, API keys, webhook settings | Stele, off-chain | No |

No personal data is written to Solana: only public keys, hashes, timestamps and hostnames.

## Without a wallet, and beyond documents

- **Passkeys.** A visitor without a wallet creates a passkey; their browser generates a signing key and
  encrypts it so that only the passkey can unlock it. Signing then takes one passkey prompt, and the
  same signature is recorded on Solana. Stele stores only the encrypted key.
- **Fees.** The visitor never pays: Stele's relayer pays every network fee, and the organization can
  reimburse it automatically from a deposit only the Solana program can spend.
- **Proofs.** The same machinery records confirmations of purchases, refunds, consents and more: the
  customer signs a message naming the SHA-256 of the statement, which stays private.

## What a signature proves

That a specific key accepted a specific, unaltered version at a recorded time. It does not by itself
establish a person's legal identity, and whether an agreement is enforceable depends on the
applicable law. [What a signature proves](acceptance-signing.md) covers this in detail.
