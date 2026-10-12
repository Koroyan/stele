# Protocol overview (stele/1)

This is a plain-language tour of the Stele protocol. The [normative specification](../PROTOCOL_SPEC.md)
defines every byte; when the two disagree, the specification wins.

## What the protocol guarantees

1. **A published version is immutable.** Its text is committed by SHA-256, its metadata by a
   fingerprint the program computes, and no instruction can modify or close it.
2. **Versions form a chain.** Each version commits to the fingerprint of its predecessor, so hiding,
   reordering or inserting a version is detectable.
3. **An acceptance is a signature by the user's key over a human-readable message** that names the
   organization (and whether its domain is verified), the document, the version and its fingerprint,
   the signing account, the network, a validity window, a single-use nonce and the requesting site.
4. **The program verifies that signature itself** and rebuilds the message from on-chain state, so
   no intermediary can attach a signature to different terms.
5. **Each signed message can be recorded once.** Its nonce is one bit in an on-chain bitmap.
6. **Evidence is network-bound.** The CAIP-2 chain ID is part of every fingerprint and the network
   name is part of every message; devnet evidence can never pass as mainnet evidence.

## Identifiers and formats

| Identifier | Meaning |
|---|---|
| `stele/1` | Protocol version (this document) |
| `stele-canonical-v1` | Canonicalization rules for document content — see [Canonicalization](canonicalization.md) |
| `stele-content-v1` | Content model: typed blocks, optional change summary, attachment digests |
| `stele-version-v1` | The canonical version record hashed into the fingerprint |
| `stele-acceptance-v1` | The 12-line acceptance message template |
| `stele-receipt-v1` | The portable proof bundle |

## Accounts

| Account | What it is |
|---|---|
| `ProtocolConfig` | Network identity (chain ID, network label — immutable), protocol admin, domain attestor key, pause switch |
| `Organization` | Name, owner, recovery authority, pending changes and timelocks, freeze state, verified domain and its expiry |
| `Member` | A key with roles (`ADMIN`, `PUBLISHER`) in an organization; revocation and compromise are timestamps |
| `DomainRecord` | Current pointer from a verified domain to its organization (one per domain) |
| `Document` | A named series (`slug`, type, locale) with the head of its version chain |
| `DocumentVersion` | One immutable version: fingerprint, content hash, predecessor, title, label, effective date, storage URI, publisher |
| `NonceShard` | 65,536 single-use nonces (shared by acceptances and proofs), the relayer allowed to use them, the accumulator — and, when the organization sponsors fees, a sponsorship trailer (limits, counters); its address is then the deposit address |

Exact layouts, sizes and address seeds are in the [specification](../PROTOCOL_SPEC.md#62-account-layouts).

## Instructions and who may call them

| Instruction | Allowed signer |
|---|---|
| `initialize_protocol` | The program's upgrade authority, once |
| `set_protocol_paused`, `set_domain_attestor`, `propose_protocol_admin` | Protocol admin |
| `accept_protocol_admin` | Proposed protocol admin |
| `create_organization` | Anyone (becomes the creator; names the owner and optional recovery key) |
| `update_organization` (rename), `propose_owner`, `cancel_owner_transfer`, `propose_recovery`, `apply_recovery_change` | Owner (not while frozen by the recovery authority) |
| `accept_ownership` | The proposed owner |
| `cancel_recovery_change` | Owner or recovery authority |
| `freeze_organization` | Owner or recovery authority |
| `unfreeze_organization` | Recovery authority; the owner only for an owner-initiated freeze |
| `initiate_owner_recovery`, `execute_owner_recovery` | Recovery authority (execution after a 72-hour timelock) |
| `cancel_owner_recovery` | Recovery authority, or the owner unless frozen by recovery |
| `add_member`, `update_member`, `revoke_member` | Owner; admins for non-admin members |
| `report_key_compromise` | Owner, recovery authority, admin (non-admin targets) or the member itself |
| `attest_domain`, `renew_domain` | Domain attestor |
| `revoke_domain` | Domain attestor or the organization owner |
| `create_document` | Owner, admin or publisher |
| `publish_version` | Owner or publisher |
| `create_nonce_shard`, `set_shard_relayer` | Owner or admin |
| `record_acceptance` | Anyone, or only the shard's relayer when one is set — but only with a valid user signature |
| `record_proof` | Same as `record_acceptance`, for a signed statement hash (purchase, refund, consent…) |
| `enable_shard_sponsorship` | Owner or admin (the shard must have a designated relayer) |
| `update_shard_sponsorship` | Owner; admins may only pause or lower limits |
| `withdraw_shard_sponsorship` | Owner |

**Pause and freeze.** While the protocol is paused, `create_organization`, `create_document`,
`publish_version` and `record_acceptance` are refused. While an organization is frozen,
`create_document`, `publish_version` and `record_acceptance` are refused for it; member, shard and
authority management remain available so the incident can be handled (a freeze by the recovery
authority additionally suspends the owner's powers until the recovery authority lifts it).

## The version fingerprint

The program builds a canonical JSON record and hashes it:

```
version_hash = SHA-256({"chainId":…,"contentHash":…,"document":…,"documentType":…,"effectiveAt":…,
                        "format":"stele-version-v1","locale":…,"organization":…,
                        "previousVersionHash":…,"program":…,"title":…,"version":…,"versionLabel":…})
```

Keys are sorted, strings are escaped exactly as in RFC 8785, `effectiveAt` is a Unix timestamp in
seconds or `null` (effective on publication), and `previousVersionHash` is `null` for version 1. The publisher
passes the fingerprint they reviewed as `expected_version_hash`; the program refuses the transaction if
its own computation differs. Users see and sign this fingerprint.

## The acceptance message

```
Stele Protocol v1 - Accept Agreement
I accept the exact document version below.
Organization: <name> (verified: <domain>)        or  (unverified)
Document: <title>
Version: <label> (#<number>)
Fingerprint: <64 hex>
Account: <signer, base58>
Network: <network label>
Issued: <RFC 3339 UTC>
Expires: <RFC 3339 UTC>
Nonce: <shard>-<index>-<16 hex tag>
Requested by: <hostname>
```

Lines 1–11 are rebuilt by the program from its own state and the instruction's arguments; only the
requesting site comes from the signed bytes, and it must be a valid lowercase hostname. See
[Acceptance & signing](acceptance-signing.md) for the full rules and what a signature proves.

## Proofs

`record_proof` records a signed **statement** other than a document — a purchase, refund, order,
payment, cancellation, delivery, return, warranty, subscription start or cancellation, quote
acceptance, contract, consent or policy acceptance. The customer signs a 13-line anchor message
(`Stele Protocol v1 - Record Proof`) naming the proof type, the organization's name **and address**,
the network and chain ID, and the SHA-256 of a canonical, salted JSON statement that stays off-chain.
The program rebuilds the message like an acceptance message and consumes a nonce from the same shard.

## Fees and walletless signers

The user never pays: the relayer is the fee payer. An organization may fund its nonce shard; the
program then reimburses the relayer the exact fee of each valid recording (computed from the
transaction's compute-budget instructions), capped per record and per UTC day. This adds no account
and no byte to the recording transaction.

Walletless signers sign with the passkey's own secp256r1 key (`stele/2`): the program verifies the
WebAuthn signature on-chain through Solana's secp256r1 precompile. Signers enrolled earlier use an
Ed25519 key protected by their passkey (`stele/1`), which keeps working. Passkey evidence travels in
receipts and is checked by verifiers. Details:
[specification §12–§14](../PROTOCOL_SPEC.md#12-proofs--record_proof-stele-statement-v1-stele-proof-v1).

## Events

`VersionPublished`, `AcceptanceRecorded`, `ProofRecorded` and `SponsorReimbursed` (plus organization,
member, domain, shard and sponsorship events) are emitted with Anchor's `emit!`. Indexers use them for speed, but verification never depends on them:
the verifier reads accounts and the original transactions.

## Versioning and compatibility

- Every hashed or signed format carries its version identifier (`stele-version-v1`,
  `Stele Protocol v1`, `stele:v1:` hash tags).
- A breaking change introduces new identifiers and new instructions; existing evidence remains valid
  under the rules it was created with, and verifiers keep supporting every published version.
- The program's account layouts never reorder fields; new fields are appended in new account versions.
- Program upgrades are controlled by a multisig. Because the verifier cross-checks every version
  account against the transaction that created it, a malicious upgrade that rewrote stored versions
  would be detected rather than silently trusted.

## Reference implementations and test vectors

- Rust: `crates/stele-core` (used by the program) and `crates/stele-canonical`.
- TypeScript: `@stelehq/protocol`, used by the API, SDK, verifier and web app.
- Shared vectors: `spec/test-vectors/*.json` (text normalization, content, version fingerprints,
  RFC 3339, acceptance messages and IDs, proof messages and IDs, statements, validation). Both implementations must produce byte-identical
  results; CI regenerates the vectors and fails on any difference.
