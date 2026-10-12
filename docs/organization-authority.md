# Organizations & authority

An organization is an on-chain account that only its authorities can control. Everything a company
publishes — and every acceptance of it — is bound to that account. This page covers who can do what,
how to set authority up safely, how to recover from incidents, and how domain verification turns a
self-declared name into a verified identity.

## Roles

| Role | Held by | Purpose |
|---|---|---|
| **Owner** | One key — ideally a multisig vault | Full control: publishing, members, documents, shards, rename, ownership and recovery changes |
| **Admin** (member role) | Operations staff | Manage publishers, create documents and acceptance shards |
| **Publisher** (member role) | Legal / content staff | Create documents and publish new versions |
| **Recovery authority** | A separate key, kept offline or held by another person | Freeze instantly; replace a lost or compromised owner after a public 72-hour delay |

A member can hold both roles. The owner is not a member; it is stored on the organization itself.

### Permission matrix

| Action | Owner | Admin | Publisher | Recovery |
|---|:---:|:---:|:---:|:---:|
| Publish a version | ✓ | | ✓ | |
| Create a document | ✓ | ✓ | ✓ | |
| Create / re-assign an acceptance shard | ✓ | ✓ | | |
| Add, change, revoke publishers | ✓ | ✓ | | |
| Add, change, revoke admins | ✓ | | | |
| Report a member's key as compromised | ✓ | ✓ (non-admins) | own key only | ✓ |
| Rename the organization | ✓ | | | |
| Propose a new owner / cancel | ✓ | | | |
| Accept ownership | the proposed owner | | | |
| Propose / apply a recovery change (72 h) | ✓ | | | |
| Cancel a pending recovery change | ✓ | | | ✓ |
| Freeze | ✓ | | | ✓ |
| Unfreeze | owner-initiated freeze only | | | ✓ |
| Start / execute owner replacement (72 h) | | | | ✓ |
| Cancel owner replacement | ✓ (unless frozen by recovery) | | | ✓ |

These rules are enforced by the Solana program, not by the dashboard. The dashboard only offers the
buttons the program would accept for the connected wallet.

## Recommended setup

1. **Create the organization** from the dashboard with your wallet and set a **recovery authority**
   at the same time (a different key: a hardware wallet in a safe, or a key held by your counsel or a
   second executive).
2. **Verify your domain** (below), so every signature request says `verified: your-domain`.
3. **Add a publisher** key for routine publishing, so the owner key is rarely used.
4. **Move ownership to a multisig** (for example a Squads vault with 2-of-3 or 3-of-5 signers).

### Moving ownership to a multisig

Ownership transfer takes two steps so that a typo can never hand the organization to an unreachable
address:

1. In **Security → Transfer ownership**, the current owner proposes the multisig's vault address.
2. The vault accepts. In your multisig app, create a custom transaction with a single instruction:
   - program: the Stele program ID (shown in **Organization → Integration identifiers**);
   - accounts, in order: the vault address (signer), the organization address (writable);
   - data (hex): `ac172b0deed55596` — the `accept_ownership` instruction, which takes no arguments.

   With the TypeScript SDK the same instruction is
   `organizationAuthorityInstruction({ name: "accept_ownership", authority: vault, organization })`
   from `@stelehq/protocol`.
3. After the multisig executes it, the dashboard shows the vault as owner. Until then, the old owner
   can cancel the proposal.

Publishing as the owner then requires a multisig transaction; most teams publish with a publisher key
instead and reserve the multisig for authority changes.

## Members

- **Adding** a member creates a `Member` account (≈ 0.0019 SOL rent, paid by the signer).
- **Changing roles** is a signed transaction; admins cannot grant or modify the admin role.
- **Revoking** sets a revocation timestamp. Nothing is deleted: versions the member published before
  revocation remain valid, and the record can be re-activated later by changing its roles.
- **Labels** (for example a person's name) are stored only in the Stele database, never on-chain.

### Reporting a compromised key

If a member's key may have been in someone else's hands, report it with the earliest time the
compromise could have started. The program revokes the key permanently and records
`compromised_since`. Verifiers then flag any version that key published at or after that time.
Earlier evidence is unaffected. A compromised member cannot be re-activated; add a new key instead.

## Freezing

A freeze stops new publications, new documents and new acceptances for the organization immediately.
Member, shard and authority management stay available so the incident can be handled. Existing
evidence remains valid and verifiable.

- The **owner** can freeze and unfreeze its own freeze.
- The **recovery authority** can freeze at any time. Its freeze also suspends the owner's powers and
  can only be lifted by the recovery authority — this is what makes it useful when the owner key is
  stolen.

## Recovering from a lost or stolen owner key

1. The recovery authority **freezes** the organization (owner powers suspended).
2. It **starts an owner replacement** naming the new owner key. The change is public on-chain and can
   only be executed after **72 hours**.
3. During the delay, the legitimate owner (if it still has its key and the organization is not frozen
   by recovery) can cancel; the recovery authority can always cancel.
4. After 72 hours, the recovery authority **executes** the replacement. Anything the previous owner
   had scheduled (pending owner or recovery changes) is discarded.
5. The recovery authority **unfreezes**, and the new owner reviews members and reports any other
   compromised keys.

Changing the recovery authority itself also takes 72 hours, so a stolen owner key cannot quietly
replace it.

## Domain verification

Display names are self-declared — anyone can create an organization called "Acme Inc.". A verified
domain is what identifies an organization.

1. In **Organization → Verified domain**, enter the domain (lowercase; punycode for international
   domains).
2. Publish the DNS record the dashboard shows:

   | Type | Name | Value |
   |---|---|---|
   | TXT | `_stele.<domain>` | `stele-org=<organization address>` |

3. Choose **Check DNS & attest**. Stele queries several independent DNS-over-HTTPS resolvers; **all**
   must return the record. Stele's attestor key then records the attestation on-chain with an expiry
   (one year by default; the protocol maximum is 400 days).
4. A background job re-checks DNS and renews attestations within 30 days of expiry. If the record has
   been removed, the attestation is not renewed and lapses.

Properties and limits:

- **One organization per domain.** The on-chain `DomainRecord` is unique per domain; a domain must be
  revoked before another organization can verify it.
- **Point-in-time.** An attestation says the organization controlled the domain's DNS when it was
  checked. Each acceptance message records whether the domain was verified at that moment.
- **Expiry and re-registration.** Because attestations expire, a domain that is later sold or
  re-registered does not stay verified for its previous owner indefinitely. Verifiers can also re-check
  the DNS record live.
- **Revocation.** The owner can revoke a verified domain from the dashboard (a fresh wallet signature
  is required); the attestor can also revoke it.

## What Stele's own keys can do

Stele's operator holds two keys with deliberately narrow powers:

- the **protocol admin** (held by a multisig in production) can pause the protocol in an emergency
  and rotate the domain attestor. It cannot modify organizations, documents, versions or acceptances.
- the **domain attestor** can attest, renew and revoke domain verifications.

The program's **upgrade authority** is also held by a multisig. Verifiers cross-check every stored
version against the transaction that created it, so even a malicious upgrade could not silently
rewrite published evidence.
