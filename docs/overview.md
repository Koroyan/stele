# Product overview

**Stele keeps a record of what people agreed to that nobody can quietly change — and, for Solana
applications, makes your program require it.**

> [!TIP] Two minutes, no wallet
> The [live demo](/demo) shows both products with real transactions.

## In plain words

1. **A company publishes its terms.** Stele writes a fingerprint of the exact text to Solana. From
   then on nobody — not even the company — can change what that version said.
2. **People accept them** by signing with Face ID, a passkey or a wallet. It is free for them: no
   crypto, no fees.
3. **Anyone can check later** what was accepted, against Solana, without Stele's servers or the
   company's database.

## Two products

| | Stele Proof | Stele Gate |
|---|---|---|
| For | Websites, SaaS, apps, onboarding, consent | Solana programs: real-world-asset vaults, token offerings, permissioned credit |
| What it does | Proves which exact version of the terms a user accepted | Proof, plus your program refuses a protected action until the wallet accepted the current version |
| How you add it | A widget on your site and a check from your server | One call, `require_current()`, in your program |
| Start | [Get started](get-started.md) | [Stele Gate](gate.md) |

What the evidence does and does not depend on is spelled out in the [trust model](trust-model.md).

## The problem

Most "I agree" records are rows in a company's own database: a timestamp, a user ID and perhaps a
document version number. Whoever controls the database controls the evidence. Terms can be edited
after the fact, older versions quietly replaced, and records added or removed, and nobody outside the
company can tell.

## What Stele changes

| | Typical clickwrap | Stele |
|---|---|---|
| The agreed text | Whatever the company says it was | Committed on-chain by a fingerprint when it was published; cannot be edited |
| Version history | Editable | A hash-linked chain; versions cannot be removed or reordered |
| The acceptance | A database row | The user's own passkey or wallet signature over a message naming the exact version |
| Replay and reuse | Rarely considered | Single-use, time-limited, bound to one version, one network and one site |
| Who can verify | Only the company | Anyone, with open-source tools and an archival Solana endpoint |
| If the vendor disappears | Evidence goes with it | Evidence stays on Solana; receipts carry the text |

## What you get

- **Dashboard** to write documents, preview the exact bytes and fingerprint, publish versions with
  your wallet or multisig, manage roles, verify your domain, and see acceptances.
- **Acceptance on your own site** with an [embeddable widget](get-started.md): two lines of HTML, no
  wallet code. A hosted acceptance page is available too.
- **Signing without a wallet**: visitors can use a passkey (Face ID, fingerprint, device PIN) that
  protects a signing key only they can unlock. Nobody needs SOL — fees are sponsored by Stele or by you.
- **Proofs beyond documents**: purchases, refunds, consents and quote acceptances, confirmed by the
  customer and anchored on Solana with their details kept private.
- **Receipts** for every acceptance, verifiable by anyone.
- **Verification** in the browser, on the command line and in code. See [Verification](verification.md).
- **API, webhooks and SDK** to link acceptances to your users and react to them on your servers. See
  the [SDK & API reference](api.md).
- **Stele Gate** (opt-in): policies, AccessPasses, `require_current()` for your Solana program, an
  Accept & Continue modal, and dashboard pages to integrate and test it. See [Stele Gate](gate.md).

## Who it is for

- **Companies** that need to prove which terms a customer accepted, and when.
- **Platforms and marketplaces** that collect acceptances at scale and want records that hold up
  under scrutiny.
- **Users, auditors and courts**, who can check the evidence for themselves.
- **Solana applications** whose actions must not happen without the current terms (Stele Gate).

## What it is not

- **Not an identity service.** A signature proves control of a key, not who controls it. Link
  acceptances to your own signed-in users when you need to know which customer signed.
- **Not KYC or a compliance engine.** Face ID unlocks a passkey on the device; it does not identify
  anyone to Stele. Gate enforces one rule — acceptance of a required version — not regulation.
- **Not legal advice.** Stele makes the record verifiable; whether an agreement is enforceable depends
  on the applicable law.
- **Not a place for personal data.** Published documents are public and permanent. Only public keys,
  hashes, timestamps and hostnames are written to Solana.

## Learn more

- [How Stele works](how-it-works.md)
- [Stele Gate](gate.md)
- [Get started](get-started.md)
- [What a signature proves](acceptance-signing.md)
- [Security architecture](security.md) and [threat model](threat-model.md)

## Contact

News and questions: [@stelehq on X](https://x.com/stelehq). Security issues: see the
[security policy](../SECURITY.md).
