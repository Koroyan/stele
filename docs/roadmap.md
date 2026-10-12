# Roadmap

Stele is live on Solana Devnet. This page lists what comes next, in order. Nothing here is built
yet; dates depend on the security audit and on the first issuers.

## Before mainnet

1. **Security audit** of the program, the protocol and the verifier.
2. **Multisig upgrade authority**: the program's upgrade authority moves from a single key to a
   Squads multisig ([trust model](trust-model.md)).
3. **Reproducible-build release**, so anyone can check the deployed program matches the source.
4. **First issuers on mainnet**, starting with tokenized real-world-asset funds using Stele Gate.

## Who published the terms: verified legal entities

Today a receipt can show that the publisher **controls a domain** (an on-chain domain attestation,
for example `stele.site`). The next level is the **legal entity** behind it:

- the organization is verified through a KYB provider, a business register or its
  [LEI](https://www.gleif.org/) code;
- the result is recorded on-chain as an attestation, like the domain attestation;
- receipts and the Verify page show it, for example "Atlas Fund LLC, Delaware — verified".

Evidence that names the company is far stronger in a dispute than "whoever controls this domain".
Organizations are few and their data is public, so this step carries little privacy risk.

## Who accepted: links to existing KYC attestations

Stele will **not** run KYC itself: that means licences, personal data and liability. Instead it will
link to attestations that already exist — the
[Solana Attestation Service](https://attest.solana.com/), Civic Pass, or a KYC provider's own
attestation — so an issuer can require both, in one transaction:

- **who the wallet is** — "KYC-verified by provider X" (their attestation);
- **what it accepted** — "accepted the current offering terms, v2" (Stele).

No personal data goes on-chain. Because publicly linking an address to an identity can itself leak
privacy, the link will use a salted commitment or a zero-knowledge proof, never the data directly.
This will be built together with the first RWA partners.

## A verifiable "Stele Verified" badge

A badge that sites can show next to their terms, under two rules:

- **It must be checkable**, not an image anyone can copy: clicking it opens the organization's live
  status on the Verify page, from Solana.
- **It means one precise thing**: "these terms are versioned, and acceptances can be verified
  independently". It does **not** mean "this company is trustworthy".

The badge is a distribution tool, like "Powered by Stripe". Stele becomes a standard the way
OpenTimestamps and C2PA did: an open specification (already published), independent verifiers,
and partners who adopt it — not through the badge itself.
