# Product overview

**Stele records the exact version of an agreement, and every acceptance of it, as evidence anyone
can verify.** Terms of service, privacy policies, data-processing agreements and contracts are
published as fingerprinted versions on Solana that cannot be edited. People accept them by signing
the exact text with a passkey (Face ID, Touch ID, Windows Hello) or a wallet, with no fees. Years
later, anyone can check what was agreed against Solana, without Stele's servers or the company's
database.

> Prove what was agreed. Enforce what must be agreed.

Stele comes in two modes:

- **Stele Proof** — for websites, SaaS, apps, onboarding and consent: evidence of which exact version
  a user accepted.
- **Stele Gate** — for Solana programs such as RWA vaults, token offerings and permissioned credit:
  Proof plus enforcement. Your program calls `require_current()` and refuses a protected action until
  the signing wallet has accepted the version your policy requires. See [Stele Gate](gate.md).

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
