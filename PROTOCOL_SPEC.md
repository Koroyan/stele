# Stele Protocol — Specification (`stele/1`, `stele/2`)

| | |
|---|---|
| Protocol identifiers | `stele/1`; `stele/2` (native passkeys and batched evidence, §17) |
| Canonicalization | `stele-canonical-v1` |
| Formats | `stele-content-v1`, `stele-version-v1`, `stele-acceptance-v1`, `stele-receipt-v1`; `stele-acceptance-v2`, `stele-receipt/2`, `stele-batch-manifest/1` |
| Status | Normative |
| Audience | Implementers of compatible clients, relayers, indexers and verifiers |

The key words MUST, MUST NOT, SHOULD, MAY are to be interpreted as in RFC 2119.

This specification is independent of any user interface. An implementer with access to a Solana RPC
endpoint and the content bytes MUST be able to verify every claim using only this document.

---

## 1. Conventions

| Item | Encoding |
|---|---|
| Hash function `H` | SHA-256 (FIPS 180-4) |
| Hash display | lowercase hexadecimal, 64 characters |
| Public keys / addresses | 32 bytes; displayed in Solana base58 |
| Transaction signatures | 64 bytes; displayed in base58 |
| Text | UTF-8, Unicode scalar values only |
| Integers in binary layouts | little-endian |
| Borsh strings | `u32` little-endian byte length, then UTF-8 bytes |
| Borsh `Option<T>` | `u8` tag (`0` = None, `1` = Some) then `T` |
| `bool` | one byte, `0` or `1` |
| Times | Unix seconds (`i64`), UTC. Displayed per §7.3 |
| `||` | byte concatenation |

**Byte length** always means the number of UTF-8 bytes, never characters.

---

## 2. Identifiers

### 2.1 Network

Every deployment has an immutable network identity stored in `ProtocolConfig`:

| Field | Format | Mainnet | Devnet | Testnet |
|---|---|---|---|---|
| `chain_id` | CAIP-2: `solana:` + first 32 base58 chars of the genesis hash; regex `^solana:[A-Za-z0-9]{1,32}$` | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | `solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z` |
| `network_label` | 1–16 bytes, `^[A-Za-z0-9 ]+$`, no leading/trailing/double spaces | `Solana Mainnet` | `Solana Devnet` | `Solana Testnet` |

Local clusters SHOULD use `chain_id` derived from their genesis hash (or `solana:localnet`) and the
label `Solana Localnet`. Verifiers MUST compare `chain_id` with the RPC endpoint's
`getGenesisHash` when the chain ID is genesis-derived.

### 2.2 Program

The program ID is part of every version fingerprint. Evidence from one program deployment is never
valid for another.

### 2.3 Addresses (PDAs)

All program-derived addresses use the program ID and these seeds:

| Account | Seeds |
|---|---|
| `ProtocolConfig` | `"config"` |
| `Organization` | `"organization"`, `creator` (32), `seed` (32) |
| `Member` | `"member"`, `organization` (32), `member_key` (32) |
| `DomainRecord` | `"domain"`, `H(domain_utf8)` (32) |
| `Document` | `"document"`, `organization` (32), `slug_utf8` |
| `DocumentVersion` | `"version"`, `document` (32), `u32_le(version)` |
| `NonceShard` | `"nonce-shard"`, `organization` (32), `u16_le(shard_id)` |

Seed strings are ASCII bytes without terminator.

---

## 3. Field validation rules

These rules are enforced **on-chain** for every value stored in program accounts and **off-chain** by
every compliant client. A value that fails validation MUST be rejected, never silently repaired.

### 3.1 Forbidden code points (set `F`)

| Range | Reason |
|---|---|
| U+0000–U+0008, U+000B, U+000C, U+000E–U+001F | C0 controls (U+0009 TAB, U+000A LF, U+000D CR are handled by normalization; see §4) |
| U+007F, U+0080–U+009F | DEL, C1 controls |
| U+00AD | Soft hyphen (invisible) |
| U+034F | Combining grapheme joiner (invisible) |
| U+115F, U+1160, U+3164, U+FFA0 | Hangul fillers (invisible) |
| U+17B4, U+17B5 | Khmer inherent vowels (invisible) |
| U+180E | Mongolian vowel separator (invisible format) |
| U+200B | Zero width space |
| U+202A–U+202E | Bidi embeddings/overrides (Trojan Source) |
| U+2060–U+206F | Word joiner, invisible operators, bidi isolates (U+2066–2069), deprecated format characters |
| U+FEFF | Zero width no-break space / BOM (a single leading BOM is stripped by normalization) |
| U+FFF9–U+FFFB | Interlinear annotation |
| U+FFFC, U+FFFD | Object replacement, replacement character (signals corrupted input) |
| U+1D173–U+1D17A | Invisible musical format characters |
| U+E0000–U+E007F | Tag characters (invisible "ASCII smuggling") |
| U+E000–U+F8FF, U+F0000–U+FFFFD, U+100000–U+10FFFD | Private use |
| U+FDD0–U+FDEF and every code point `c` with `c & 0xFFFE == 0xFFFE` | Noncharacters |
| U+D800–U+DFFF | Surrogates (cannot occur in valid UTF-8; JS implementations MUST reject lone surrogates) |

Permitted and meaningful: U+200C ZWNJ, U+200D ZWJ, U+200E LRM, U+200F RLM, U+061C ALM, variation
selectors.

### 3.2 Display strings (`organization name`, `document title`)

A *display string* MUST:

1. be 1 to `max` bytes (`name`: 40, `title`: 60);
2. contain no code point in `F`, and no U+0009, U+000A, U+000D, U+2028, U+2029;
3. not begin or end with U+0020 and not contain two consecutive U+0020;
4. be in Unicode NFC (enforced by clients; on-chain programs cannot check NFC and verifiers MUST
   report a warning, not a failure, for non-NFC display strings).

### 3.3 ASCII identifiers

| Field | Max bytes | Regex |
|---|---|---|
| `slug` | 32 | `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `document_type` | 32 | `^[a-z0-9]+(-[a-z0-9]+)*$` (registered values in §3.5) |
| `locale` | 16 | `^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$` |
| `version_label` | 16 | `^[A-Za-z0-9][A-Za-z0-9._+-]{0,15}$` |
| `storage_uri` | 128 | printable ASCII U+0021–U+007E, prefix `ar://`, `ipfs://`, or `https://` |

### 3.4 Domains

A *hostname* MUST be either the literal `localhost` or:

- 1–`max` bytes total (`verified domain`: 48, `request domain`: 48);
- two or more labels separated by `.`;
- each label 1–63 bytes of `[a-z0-9-]`, not starting or ending with `-`;
- final label not entirely numeric.

Uppercase is not permitted; IDNs MUST be supplied in A-label (punycode) form. Ports, schemes, paths
and trailing dots are not permitted. `localhost` MUST NOT be used as a verified domain.

### 3.5 Registered document types

`terms-of-service`, `privacy-policy`, `cookie-policy`, `acceptable-use-policy`,
`data-processing-agreement`, `end-user-license-agreement`, `service-level-agreement`,
`disclaimer`, `contract`, `other`. The program accepts any value matching §3.3; clients SHOULD use
registered values.

---

## 4. Content canonicalization — `stele-canonical-v1`

### 4.1 Content model (`stele-content-v1`)

```
Content     = { "attachments": [Attachment], "blocks": [Block], "changeSummary": Text|null,
                "format": "stele-content-v1" }
Block       = Heading | Paragraph | List
Heading     = { "level": 1|2|3, "text": Inline, "type": "heading" }
Paragraph   = { "text": Text, "type": "paragraph" }
List        = { "items": [Inline], "ordered": true|false, "type": "list" }
Attachment  = { "mediaType": MediaType, "name": FileName, "sha256": Hex64, "size": Integer }
```

| Constraint | Limit |
|---|---|
| `blocks` | 1–5,000 entries |
| Heading `text` | 1–500 bytes |
| Paragraph `text` | 1–20,000 bytes |
| List `items` | 1–500 entries, each 1–5,000 bytes |
| `changeSummary` | `null` or 1–2,000 bytes |
| `attachments` | 0–20 entries, unique `name` |
| `FileName` | 1–128 bytes, `^[A-Za-z0-9][A-Za-z0-9._-]*$` |
| `MediaType` | one of `application/pdf`, `image/png`, `image/jpeg`, `text/plain` |
| `size` | 1–26,214,400 |
| `sha256` | `H(attachment bytes)` in lowercase hex |
| Canonical serialization | ≤ 2,097,152 bytes |

No other keys are permitted at any level. Objects MUST contain exactly the keys listed.

### 4.2 Text normalization

`normalize_text(s)` (for `Text`: paragraphs, change summary):

1. If `s` begins with U+FEFF, remove that one code point.
2. Replace every CR LF pair with LF; then replace every remaining CR, U+0085, U+2028 and U+2029
   with LF.
3. Replace every U+0009 with U+0020.
4. Apply Unicode Normalization Form C.
5. Reject if any code point is in `F` (§3.1).
6. Split on LF. For each line: replace each run of U+0020 with a single U+0020; remove leading and
   trailing U+0020.
7. Remove empty lines.
8. Join the remaining lines with LF.
9. Reject if the result is empty.

`normalize_inline(s)` (for `Inline`: headings, list items) is `normalize_text(s)` followed by
replacing every LF with U+0020.

A string is *canonical* iff normalizing it returns it unchanged.

### 4.3 Serialization

The canonical byte form of a `Content` object is its RFC 8785 (JCS) serialization. Because the model
contains only ASCII keys, non-negative integers below 2^53, booleans, null, arrays, objects, and
strings, JCS reduces to:

- object members ordered by key (byte-wise ascending; equal to UTF-16 ordering for ASCII keys);
- no insignificant whitespace;
- integers in shortest decimal form;
- strings with `"` → `\"`, `\` → `\\`, U+0008 → `\b`, U+0009 → `\t`, U+000A → `\n`, U+000C → `\f`,
  U+000D → `\r`, other U+0000–U+001F → `\u00xx` (lowercase hex); all other code points emitted as raw
  UTF-8. (After normalization only `\n`, `\"` and `\\` can occur.)

### 4.4 Content hash

```
content_hash = H( canonical_content_bytes )
```

No prefix is added: `sha256sum content.json` reproduces it. Domain separation is provided by the
mandatory `"format": "stele-content-v1"` member.

### 4.5 Canonical-form verification

A verifier given bytes `b` MUST: parse `b` as JSON (rejecting duplicate keys), validate the model
(§4.1), check every text is canonical (§4.2), re-serialize (§4.3) and require the result to equal `b`
byte-for-byte. Failure is reported as `content.canonical` failure, distinct from a hash mismatch.

---

### 4.5 What you see is what you sign — display safety

`stele-canonical-v1` rejects the code points that can silently change what a reader sees (§3.1:
bidi embeddings, overrides and isolates, zero-width space, BOM, soft hyphen, tag characters, private
use, noncharacters…). These rules are frozen: changing them would change existing content hashes.
What they cannot exclude is **reported**, deterministically, by every Stele surface that shows a
document (publisher preview, signing page, widget, verifier):

| Finding | Meaning |
|---|---|
| `BIDI_MARK` | U+200E, U+200F, U+061C — legitimate in right-to-left text, invisible, able to reorder neighbouring digits and punctuation |
| `JOINER` | U+200C, U+200D — required by some scripts and emoji, invisible elsewhere |
| `VARIATION_SELECTOR` | U+FE00–FE0F, U+E0100–E01EF |
| `MIXED_SCRIPT_WORD` | a word mixing Latin with Cyrillic or Greek letters (look-alike spoofing) |
| `EXTERNAL_LINK` | an `http(s)://` URL: what it points to can change and is NOT covered by the content hash |
| `PINNED_REFERENCE` | `stele:version:<64 hex fingerprint>` — a reference to another Stele version, which verifiers resolve on-chain |

Rendering rules for compliant signing surfaces: content is inserted as text nodes only (never
HTML); each block is its own bidirectional paragraph (`dir="auto"`), so direction marks cannot
leak between blocks; suspicious findings are shown to the reader before signing; external links are
labelled as not part of the signed content. Documents that depend on another legally relevant
document SHOULD reference it by `stele:version:<fingerprint>` rather than by a mutable URL.

---

## 5. Version fingerprint — `stele-version-v1`

### 5.1 Version JSON

```
{"chainId":C,"contentHash":X,"document":D,"documentType":T,"effectiveAt":E,
 "format":"stele-version-v1","locale":L,"organization":O,"previousVersionHash":P,
 "program":G,"title":N,"version":V,"versionLabel":B}
```

(shown wrapped; the canonical form contains no whitespace or newlines)

| Key | Value |
|---|---|
| `chainId` | `ProtocolConfig.chain_id` |
| `contentHash` | `content_hash`, hex |
| `document` | document address, base58 |
| `documentType` | `Document.document_type` |
| `effectiveAt` | `null` if the stored `effective_at` is 0, else the integer |
| `format` | the literal `stele-version-v1` |
| `locale` | `Document.locale` |
| `organization` | organization address, base58 |
| `previousVersionHash` | `null` for version 1, else hex of the predecessor's `version_hash` |
| `program` | program ID, base58 |
| `title` | version title, JSON-escaped per §4.3 |
| `version` | integer version number (≥ 1) |
| `versionLabel` | version label |

The members appear in exactly the order above (which is JCS order). The serialization MUST be
byte-identical to JCS.

### 5.2 Fingerprint

```
version_hash = H( version_json_bytes )
```

The program computes `version_hash` itself during `publish_version` from on-chain values and
validated arguments. Clients MUST display `version_hash` as the **document fingerprint**.

---

## 6. On-chain program

Anchor 1.x program. Account discriminator = first 8 bytes of `H("account:" + TypeName)`;
instruction discriminator = first 8 bytes of `H("global:" + snake_case_name)`; event discriminator =
first 8 bytes of `H("event:" + EventName)`.

### 6.1 Constants

| Name | Value |
|---|---|
| `SHARD_CAPACITY` | 65,536 nonces (8,192-byte bitmap) |
| `MAX_CHALLENGE_TTL` | 3,600 s |
| `MAX_ISSUED_AT_SKEW` | 300 s |
| `RECOVERY_DELAY` | 259,200 s (72 h) |
| `MAX_DOMAIN_ATTESTATION` | 34,560,000 s (400 days) |
| `MAX_EFFECTIVE_AT_HORIZON` | 157,680,000 s (5 years) |
| Roles | `ADMIN = 0x01`, `PUBLISHER = 0x02` |
| `publisher_role` | `1` = owner, `2` = member |
| `frozen_by` | `0` = none, `1` = owner, `2` = recovery |
| Domain attestation method | `1` = DNS TXT |

### 6.2 Account layouts

Offsets include the 8-byte discriminator. Strings are Borsh strings placed after all fixed fields.
"None" for a `Pubkey` field is the all-zero key.

**ProtocolConfig**

| Offset | Field | Type |
|---|---|---|
| 8 | `admin` | Pubkey |
| 40 | `pending_admin` | Pubkey |
| 72 | `domain_attestor` | Pubkey |
| 104 | `paused` | bool |
| 105 | `bump` | u8 |
| 106 | `chain_id` | String (≤ 64) |
| … | `network_label` | String (≤ 16) |

**Organization**

| Offset | Field | Type |
|---|---|---|
| 8 | `creator` | Pubkey |
| 40 | `seed` | [u8; 32] |
| 72 | `owner` | Pubkey |
| 104 | `pending_owner` | Pubkey |
| 136 | `recovery` | Pubkey |
| 168 | `pending_recovery` | Pubkey |
| 200 | `pending_recovery_eta` | i64 (0 = none pending) |
| 208 | `recovery_target_owner` | Pubkey |
| 240 | `recovery_eta` | i64 (0 = none pending) |
| 248 | `domain_verified_at` | i64 |
| 256 | `domain_expires_at` | i64 |
| 264 | `created_at` | i64 |
| 272 | `document_count` | u32 |
| 276 | `member_count` | u32 |
| 280 | `frozen` | bool |
| 281 | `frozen_by` | u8 |
| 282 | `bump` | u8 |
| 283 | `name` | String (≤ 40) |
| … | `verified_domain` | String (≤ 48; empty = none) |

**Member**

| Offset | Field | Type |
|---|---|---|
| 8 | `organization` | Pubkey |
| 40 | `member` | Pubkey |
| 72 | `added_by` | Pubkey |
| 104 | `added_at` | i64 |
| 112 | `updated_at` | i64 |
| 120 | `revoked_at` | i64 (0 = active) |
| 128 | `compromised_since` | i64 (0 = not reported) |
| 136 | `compromise_reported_at` | i64 |
| 144 | `roles` | u8 |
| 145 | `bump` | u8 |

**DomainRecord**

| Offset | Field | Type |
|---|---|---|
| 8 | `organization` | Pubkey |
| 40 | `attestor` | Pubkey |
| 72 | `rent_payer` | Pubkey (receives rent when the record is closed) |
| 104 | `domain_hash` | [u8; 32] |
| 136 | `verified_at` | i64 |
| 144 | `expires_at` | i64 |
| 152 | `method` | u8 |
| 153 | `bump` | u8 |
| 154 | `domain` | String (≤ 48) |

**Document**

| Offset | Field | Type |
|---|---|---|
| 8 | `organization` | Pubkey |
| 40 | `created_by` | Pubkey |
| 72 | `head_hash` | [u8; 32] (zero before v1) |
| 104 | `current_version` | Pubkey (none before v1) |
| 136 | `created_at` | i64 |
| 144 | `last_published_at` | i64 |
| 152 | `version_count` | u32 |
| 156 | `bump` | u8 |
| 157 | `slug` | String (≤ 32) |
| … | `document_type` | String (≤ 32) |
| … | `locale` | String (≤ 16) |

**DocumentVersion** (immutable after creation)

| Offset | Field | Type |
|---|---|---|
| 8 | `document` | Pubkey |
| 40 | `organization` | Pubkey |
| 72 | `version_hash` | [u8; 32] |
| 104 | `content_hash` | [u8; 32] |
| 136 | `previous_version_hash` | [u8; 32] (zero for v1) |
| 168 | `publisher` | Pubkey |
| 200 | `effective_at` | i64 (0 = upon publication) |
| 208 | `published_at` | i64 |
| 216 | `published_slot` | u64 |
| 224 | `version` | u32 |
| 228 | `publisher_role` | u8 |
| 229 | `bump` | u8 |
| 230 | `title` | String (≤ 60) |
| … | `version_label` | String (≤ 16) |
| … | `storage_uri` | String (≤ 128) |

Lookup by fingerprint: `getProgramAccounts` with two `memcmp` filters — the `DocumentVersion`
discriminator at offset 0 **and** the fingerprint at offset 72. (The discriminator filter is
required: `Document.head_hash` also lives at offset 72.)

**NonceShard** (zero-copy, `repr(C)`, total 8,320 bytes)

| Offset | Field | Type |
|---|---|---|
| 8 | `organization` | Pubkey |
| 40 | `relayer` | Pubkey (zero = any relayer) |
| 72 | `accumulator` | [u8; 32] |
| 104 | `accepted_count` | u64 |
| 112 | `created_at` | i64 |
| 120 | `shard_id` | u16 |
| 122 | `bump` | u8 |
| 123 | reserved | [u8; 5] (zero) |
| 128 | `bitmap` | [u8; 8192] |

Nonce `i` is consumed iff bit `i mod 8` (least-significant bit first) of byte `128 + i / 8` is set.
A shard with fee sponsorship enabled carries a 120-byte trailer after these 8,320 bytes (§13.1);
readers of the fields above are unaffected.

### 6.3 Close and mutation policy

| Account | Update | Close |
|---|---|---|
| `ProtocolConfig` | `admin`, `pending_admin`, `domain_attestor`, `paused` only | Never |
| `Organization` | per §6.4 rules | Never |
| `Member` | roles, revocation, compromise fields | Never |
| `DomainRecord` | `expires_at` (renewal) | On revocation (it is a current-state pointer) |
| `Document` | `head_hash`, `current_version`, `version_count`, `last_published_at` by `publish_version` only | Never |
| `DocumentVersion` | **Never** | **Never** |
| `NonceShard` | bitmap, counter, accumulator by `record_acceptance` / `record_proof`; `relayer` by owner/admin; sponsorship trailer (§13) appended once and updated by §13.3 instructions and reimbursements | Never |

### 6.4 Instructions

Notation: *owner* = `organization.owner`; *recovery* = `organization.recovery` (if not none);
*admin*/*publisher* = signer with an active `Member` account (PDA-verified, `revoked_at == 0`) holding
the role. *Locked* = `frozen && frozen_by == 2`. All instructions that create accounts take a separate
`payer` signer.

| # | Instruction | Authorized signer(s) | Key checks |
|---|---|---|---|
| 1 | `initialize_protocol(admin, domain_attestor, chain_id, network_label)` | program upgrade authority | config PDA uninitialized; `chain_id`, `network_label` valid |
| 2 | `set_protocol_paused(paused)` | protocol admin | |
| 3 | `set_domain_attestor(attestor)` | protocol admin | non-zero |
| 4 | `propose_protocol_admin(new_admin)` | protocol admin | |
| 5 | `accept_protocol_admin()` | pending admin | |
| 6 | `create_organization(seed, name, owner, recovery)` | creator | not paused; name valid; owner non-zero; recovery ≠ owner |
| 7 | `update_organization(name)` | owner | not locked |
| 8 | `propose_owner(new_owner)` | owner | not locked; non-zero |
| 9 | `accept_ownership()` | pending owner | not locked |
| 10 | `cancel_owner_transfer()` | owner | |
| 11 | `propose_recovery(new_recovery)` | owner | not locked; if no current recovery → applied immediately, else pending with ETA = now + `RECOVERY_DELAY` |
| 12 | `apply_recovery_change()` | owner | not locked; ETA reached |
| 13 | `cancel_recovery_change()` | owner (not locked) or recovery | |
| 14 | `freeze_organization()` | owner (not locked) or recovery | sets `frozen_by = max(current, caller)` |
| 15 | `unfreeze_organization()` | recovery if `frozen_by == 2`; owner or recovery if `frozen_by == 1` | |
| 16 | `initiate_owner_recovery(new_owner)` | recovery | ETA = now + `RECOVERY_DELAY` |
| 17 | `cancel_owner_recovery()` | recovery, or owner if not locked | |
| 18 | `execute_owner_recovery()` | recovery | ETA reached; sets owner; clears pending owner/recovery changes; `frozen_by` 2 → 1 |
| 19 | `add_member(member, roles)` | owner (not locked); admin (not frozen) for non-admin roles | roles ∈ {1,2,3} |
| 20 | `update_member(roles)` | as 19 (admins cannot modify admin members) | compromised members cannot be re-activated |
| 21 | `revoke_member()` | as 20 | sets `revoked_at` |
| 22 | `report_key_compromise(compromised_since)` | owner (not locked), recovery, admin (non-admin targets), or the member itself | `0 < compromised_since ≤ now`; revokes |
| 23 | `attest_domain(domain, domain_hash, expires_at)` | domain attestor | `domain_hash == H(domain)`; domain valid (not `localhost`); org has no verified domain; `now < expires_at ≤ now + MAX_DOMAIN_ATTESTATION` |
| 24 | `renew_domain(expires_at)` | domain attestor | as above |
| 25 | `revoke_domain()` | domain attestor, or owner (not locked) | closes record to its payer; clears org fields |
| 26 | `create_document(slug, document_type, locale)` | owner/admin/publisher | not paused; not frozen; fields valid |
| 27 | `publish_version(args)` | owner or publisher | see §6.5 |
| 28 | `create_nonce_shard(shard_id, relayer)` | owner (not locked) / admin (not frozen) | |
| 29 | `set_shard_relayer(relayer)` | owner (not locked) / admin (not frozen) | |
| 30 | `record_acceptance(nonce_index, nonce_tag, issued_at, expires_at)` | shard relayer (any signer if relayer is zero) | see §8; sponsored reimbursement §13.2 |
| 31 | `record_proof(args)` | shard relayer (any signer if relayer is zero) | see §12.3 |
| 32–34 | `enable_shard_sponsorship`, `update_shard_sponsorship`, `withdraw_shard_sponsorship` | see §13.3 | |

### 6.5 `publish_version`

Arguments:

```
version: u32, previous_version_hash: [u8;32], content_hash: [u8;32], title: String,
version_label: String, effective_at: i64, storage_uri: String, expected_version_hash: [u8;32]
```

The program MUST:

1. require protocol not paused, organization not frozen, signer is owner or active publisher;
2. require `document.organization == organization`;
3. require `version == document.version_count + 1` (checked arithmetic);
4. require `previous_version_hash == document.head_hash` (all-zero for version 1);
5. validate `title`, `version_label`, `storage_uri` (§3);
6. require `effective_at == 0` or `now ≤ effective_at ≤ now + MAX_EFFECTIVE_AT_HORIZON`;
7. compute `version_hash` per §5 using `ProtocolConfig.chain_id`, its own program ID, and the
   document's type and locale; require `version_hash == expected_version_hash`;
8. initialize the `DocumentVersion` PDA for `(document, version)` with `published_at = now`,
   `published_slot = clock.slot`, `publisher = signer`, `publisher_role`;
9. set `document.head_hash = version_hash`, `document.current_version = version PDA`,
   `document.version_count = version`, `document.last_published_at = now`;
10. emit `VersionPublished`.

---

## 7. Acceptance message — `stele-acceptance-v1`

### 7.1 Template

The message is exactly the following twelve lines joined by LF (U+000A), **without** a trailing LF:

```
Stele Protocol v1 - Accept Agreement
I accept the exact document version below.
Organization: {org_name} ({org_status})
Document: {title}
Version: {version_label} (#{version})
Fingerprint: {version_hash_hex}
Account: {signer_base58}
Network: {network_label}
Issued: {issued_at}
Expires: {expires_at}
Nonce: {shard_id}-{nonce_index}-{nonce_tag_hex}
Requested by: {request_domain}
```

| Placeholder | Source | Format |
|---|---|---|
| `org_name` | `Organization.name` at recording time | display string |
| `org_status` | `verified: {Organization.verified_domain}` if non-empty and `now < domain_expires_at`, else `unverified` | |
| `title` | `DocumentVersion.title` | display string |
| `version_label` | `DocumentVersion.version_label` | |
| `version` | `DocumentVersion.version` | decimal, no leading zeros |
| `version_hash_hex` | `DocumentVersion.version_hash` | 64 lowercase hex |
| `signer_base58` | the Ed25519 public key that signs | base58 |
| `network_label` | `ProtocolConfig.network_label` | |
| `issued_at`, `expires_at` | instruction arguments | §7.3 |
| `shard_id` | `NonceShard.shard_id` | decimal |
| `nonce_index` | instruction argument | decimal |
| `nonce_tag_hex` | instruction argument (8 bytes) | 16 lowercase hex |
| `request_domain` | read from the signed message, validated as a hostname (§3.4, ≤ 48 bytes) | |

`now` is the cluster `unix_timestamp` at execution. Every value except `request_domain` is
reconstructed by the program; `request_domain` is the remainder of the message after the fixed
prefix `Requested by: ` on the final line and MUST validate as a hostname, which guarantees it
contains no LF.

### 7.2 Signing

The user signs the UTF-8 bytes of the message with Ed25519 (RFC 8032) using the wallet's
`solana:signMessage` feature. Signing scheme identifier: `1` (raw message). Future schemes (for
example the Solana off-chain message envelope used by hardware wallets) will be assigned new
identifiers and instructions; scheme `1` evidence remains valid forever.

### 7.3 Time format

`YYYY-MM-DDTHH:MM:SSZ` (RFC 3339, UTC, second precision, zero-padded, 4-digit year). Valid for
`0 ≤ t ≤ 253402300799`. Conversion uses the proleptic Gregorian calendar (days-from-civil algorithm).

### 7.4 Validity window (enforced on-chain)

```
issued_at ≥ 0;   issued_at ≤ now + MAX_ISSUED_AT_SKEW
expires_at > issued_at;   expires_at − issued_at ≤ MAX_CHALLENGE_TTL
now ≤ expires_at
issued_at + MAX_ISSUED_AT_SKEW ≥ version.published_at
```

---

## 8. `record_acceptance`

Accounts (in order): `relayer` (signer, writable), `config`, `organization`, `document`, `version`,
`nonce_shard` (writable), `instructions` sysvar.

Arguments: `nonce_index: u32`, `nonce_tag: [u8; 8]`, `issued_at: i64`, `expires_at: i64`.

The program MUST:

1. require `config` not paused and `organization` not frozen;
2. require `version.organization == organization`, `version.document == document`,
   `document.organization == organization`, `document.current_version == version`;
3. require `nonce_shard.organization == organization`; if `nonce_shard.relayer` is non-zero require
   `relayer == nonce_shard.relayer`;
4. require that the top-level instruction at the current index has program ID = this program
   (no CPI);
5. load the instruction at `current_index − 1`; require program ID = Ed25519 program
   (`Ed25519SigVerify111111111111111111111111111`), and data with:
   `data[0] == 1` (one signature), `data[1] == 0`, offsets
   `signature_offset = 48`, `public_key_offset = 16`, `message_data_offset = 112`,
   all three `*_instruction_index == 0xFFFF`, and `len(data) == 112 + message_data_size`;
6. read `signer = data[16..48]`, `signature = data[48..112]`, `message = data[112..]`;
7. enforce the validity window (§7.4) and `nonce_index < SHARD_CAPACITY`;
8. reconstruct the message prefix (lines 1–11 and the literal `Requested by: `), require `message`
   to start with it, and validate the remainder as `request_domain`;
9. require the nonce bit to be clear, then set it;
10. compute
    ```
    message_hash  = H(message)
    acceptance_id = H("stele:v1:acceptance\x00" || version || signer || message_hash || signature)
    accumulator'  = H("stele:v1:accumulator\x00" || accumulator || acceptance_id)
    ```
    store `accumulator'`, increment `accepted_count` (checked);
11. emit `AcceptanceRecorded`.

The Ed25519 program verifies the signature before the transaction executes; a transaction in which
it fails cannot succeed. `acceptance_id` is the canonical identifier of an acceptance and of its
receipt.

### 8.1 Transaction shape

```
[ComputeBudget::SetComputeUnitLimit]   (optional)
[ComputeBudget::SetComputeUnitPrice]   (optional)
[Ed25519SigVerify (canonical layout)]
[stele::record_acceptance]
```

The transaction uses the legacy message format. With every field at its maximum length the
serialized transaction is ≤ 1,232 bytes (the packet limit; measured worst case 1,226 bytes); field
limits were chosen to guarantee this, and a test builds the worst case and asserts the size. Fee
sponsorship adds no account and no byte (§13). `record_proof` transactions have the same shape.

---

## 9. Events

Events are emitted with `sol_log_data` (`Program data: <base64>`) as
`discriminator || borsh(event)`. Events are an indexing convenience; verifiers MUST derive facts from
instruction data and accounts, not from logs alone.

`AcceptanceRecorded`:

```
organization: Pubkey, document: Pubkey, version: Pubkey, signer: Pubkey, nonce_shard: Pubkey,
acceptance_id: [u8;32], message_hash: [u8;32], accumulator: [u8;32],
issued_at: i64, expires_at: i64, recorded_at: i64, slot: u64,
sequence: u64, nonce_index: u32, shard_id: u16
```

`VersionPublished`:

```
organization: Pubkey, document: Pubkey, version_account: Pubkey, publisher: Pubkey,
version_hash: [u8;32], content_hash: [u8;32], previous_version_hash: [u8;32],
effective_at: i64, published_at: i64, slot: u64, version: u32, publisher_role: u8
```

`ProofRecorded`:

```
organization: Pubkey, signer: Pubkey, nonce_shard: Pubkey, proof_id: [u8;32],
statement_hash: [u8;32], message_hash: [u8;32], accumulator: [u8;32],
issued_at: i64, expires_at: i64, recorded_at: i64, slot: u64, sequence: u64,
nonce_index: u32, shard_id: u16, proof_type: u8
```

`SponsorReimbursed` (after the record event, when a sponsored shard paid):

```
organization: Pubkey, nonce_shard: Pubkey, relayer: Pubkey, record_id: [u8;32],
amount: u64, fee: u64, spent_today: u64, day: i64
```

Also `SponsorshipChanged` and `SponsorWithdrawal`. The full event list is in
`programs/stele/src/events.rs`.

---

## 10. Receipt bundle — `stele-receipt-v1`

A receipt is an **unsigned** JSON convenience bundle. Every field is a claim that a verifier checks.

```json
{
  "format": "stele-receipt-v1",
  "acceptanceId": "<hex>",
  "network": { "chainId": "solana:…", "label": "Solana Mainnet", "programId": "<base58>" },
  "transaction": { "signature": "<base58>", "slot": 0, "blockTime": 0 },
  "acceptance": {
    "signer": "<base58>", "message": "<full message text>", "messageHash": "<hex>",
    "signature": "<base58>", "issuedAt": 0, "expiresAt": 0,
    "nonce": { "shardId": 0, "index": 0, "tag": "<hex16>" }, "requestDomain": "…"
  },
  "organization": { "address": "…", "name": "…", "verifiedDomain": "…" },
  "document": { "address": "…", "slug": "…", "documentType": "…", "locale": "…" },
  "version": {
    "address": "…", "number": 1, "label": "…", "title": "…", "versionHash": "…",
    "contentHash": "…", "previousVersionHash": null, "effectiveAt": null,
    "publishedAt": 0, "publishedSlot": 0, "storageUri": "…"
  },
  "content": { "...": "OPTIONAL: the full canonical content object" },
  "signer": { "...": "OPTIONAL: signer evidence, §14.4" },
  "fees": { "...": "OPTIONAL: fee evidence, §13.4" },
  "generatedAt": "<RFC 3339>"
}
```

`signer` and `fees` were added without a new format identifier: they are optional, receipts without
them verify exactly as before, and a verifier that knows them checks every claim they make.

---

## 11. Verification algorithm

A verifier MUST NOT report success unless every **critical** check passes. Outcomes:
`VALID`, `VALID_WITH_WARNINGS`, `INVALID` (a critical check failed), `INCONCLUSIVE` (a critical check
could not be completed, e.g. data unavailable or RPCs disagree).

### 11.1 Acceptance (input: transaction signature or receipt)

| ID | Check | Critical |
|---|---|---|
| `network.genesis` | RPC genesis hash matches expected chain ID | yes |
| `rpc.consensus` | all configured RPCs agree on transaction and accounts | yes |
| `tx.status` | transaction exists, `meta.err == null`, commitment `finalized`. Absence is a failure only if the endpoint demonstrably holds that history (`getFirstAvailableBlock` is 0, or ≤ the slot a receipt claims); otherwise it is INCONCLUSIVE | yes (confirmed → warning) |
| `tx.shape` | Ed25519 instruction immediately precedes a `record_acceptance` instruction of the expected program at top level; canonical Ed25519 layout | yes |
| `signature.ed25519` | signature verifies locally (strict RFC 8032) over message bytes for signer | yes |
| `message.format` | message parses under §7.1; `Account:` equals signer | yes |
| `message.window` | issued/expires consistent with instruction args and block time | yes |
| `config.network` | `Network:` equals `ProtocolConfig.network_label`; config chain ID equals expected | yes |
| `version.account` | version account exists, owned by program, correct discriminator, PDA matches `(document, version)` | yes |
| `version.binding` | message title/label/number/fingerprint equal the version account | yes |
| `version.fingerprint` | recomputed version JSON hashes to stored `version_hash` | yes |
| `version.publication` | the version's creation transaction's `publish_version` arguments equal the account (content hash, title, label, effective date, expected hash) | yes |
| `content.integrity` | content bytes hash to `content_hash` | yes (unavailable → INCONCLUSIVE) |
| `content.canonical` | content bytes are canonical | yes |
| `chain.links` | every predecessor exists and links by `previous_version_hash` to version 1 | yes |
| `organization.binding` | organization/document relations hold; message organization name matches name at acceptance (current name compared; difference → warning with rename note) | warning |
| `organization.domain` | verification status; optional live DNS re-check of `_stele.<domain>` | warning |
| `publisher.authority` | publisher key not reported compromised before publication | warning |
| `nonce.consumed` | nonce bit set in shard | yes |
| `acceptance.id` | recomputed `acceptance_id` equals receipt/event | yes |
| `version.current` | no later version was published before the acceptance slot | yes |
| `request.domain` | request domain equals org verified domain (or a subdomain) or a known Stele host | warning |
| `signer.passkey` | when passkey evidence is present: §14.4 checks | yes |
| `signer.type` | signer type reported (wallet / unspecified) | informational |
| `fees.payer` | fee payer, fee and organization reimbursement from the transaction | informational |
| `receipt.consistency` | every receipt claim (including `signer` and `fees`) matches verified facts | yes |

### 11.2 Proof (input: transaction signature, proof receipt, and optionally the statement)

As §11.1 for network, transaction, structure (`record_proof`), signature, message (§12.3; the
`Organization ID`, `Network`, `Chain`, statement hash, type, window and nonce equal the instruction and
configuration), organization account (canonical PDA; renamed → warning), replay protection,
`ProofRecorded` with the recomputed `proof_id`, requesting site, signer evidence and fees. With a
statement: `statement.integrity` — its canonical SHA-256 equals the signed hash and it names this
organization, network, program and type (critical); commerce totals that do not add up → warning.
Without a statement: warning (only the hash is on-chain).

### 11.3 Document version (input: version address or fingerprint)

Checks `network.*`, `rpc.consensus`, `version.*`, `content.*`, `chain.links`, `publisher.authority`,
`organization.*`.

---

## 12. Proofs — `record_proof`, `stele-statement-v1`, `stele-proof-v1`

A **proof** records that a signer confirmed a business statement other than a document version: a
purchase, a refund, a consent… It reuses everything §7–§8 establish for acceptances (runtime-verified
Ed25519 signature, message rebuilt on-chain, nonce consumption, accumulator) over a short **anchor
message** that names the SHA-256 of an off-chain **statement**.

### 12.1 Proof types

`proof_type: u8`. Code `0` is document acceptance (`record_acceptance`, never `record_proof`). Codes
are permanent.

| Code | Name | Label (`Type:` line) |
|---|---|---|
| 1 | `PURCHASE` | Purchase |
| 2 | `SALE` | Sale |
| 3 | `ORDER` | Order |
| 4 | `PAYMENT` | Payment |
| 5 | `RECEIPT` | Receipt |
| 6 | `INVOICE` | Invoice |
| 7 | `REFUND` | Refund |
| 8 | `CANCELLATION` | Cancellation |
| 9 | `DELIVERY` | Delivery |
| 10 | `RETURN` | Return |
| 11 | `WARRANTY` | Warranty |
| 12 | `SUBSCRIPTION_START` | Subscription start |
| 13 | `SUBSCRIPTION_CANCEL` | Subscription cancellation |
| 14 | `QUOTE_ACCEPTANCE` | Quote acceptance |
| 15 | `CONTRACT` | Contract |
| 16 | `CONSENT` | Consent |
| 17 | `POLICY_ACCEPTANCE` | Policy acceptance |

### 12.2 Statement — `stele-statement-v1`

A JSON object, serialized canonically: keys sorted by UTF-16 code units, no insignificant
whitespace, integers only (amounts are decimal **strings**), NFC strings, at most 16 KiB.
`statement_hash = SHA-256(canonical bytes)`.

```json
{
  "format": "stele-statement-v1",
  "type": "PURCHASE",
  "network": { "chainId": "solana:…", "programId": "<base58>" },
  "organization": { "address": "<base58>", "name": "Northwind Shop", "domain": "northwind.example" },
  "reference": "order-1042",
  "createdAt": "2026-09-21T14:13:20Z",
  "summary": "Purchase of 2 items from Northwind Shop",
  "details": { "currency": "EUR", "items": [ … ], "subtotal": "17.25", "total": "21.15",
               "buyer": { "commitment": "sha256:<hex>" } },
  "policies": [ { "title": "Terms of Service", "version": 3, "fingerprint": "<hex>", "acceptanceId": "<hex>" } ],
  "relatesTo": "<proof id, for refunds/cancellations/returns>",
  "salt": "<32 random bytes, hex>"
}
```

- `PURCHASE`, `SALE`, `ORDER`, `RECEIPT`, `INVOICE` details: `currency` (ISO 4217), `items[]`
  (`name`, `quantity`, `unitPrice`, `total`, optional `sku`), `subtotal`, optional `tax`,
  `shipping`, `discount`, `total`, optional display-safe `paymentMethod`, optional `buyer` and
  `deliveryAddress` **commitments**. Totals must add up exactly (checked by the issuer; a verifier
  warns otherwise).
- **Privacy.** The statement never goes on-chain. The mandatory random `salt` prevents confirming a
  guessed statement against the public hash. Personal data is not put in the statement in clear:
  `commitment = "sha256:" || hex(SHA-256("stele:v1:commitment\0" || salt_hex || value))`, the opening
  `(value, salt)` being kept by the parties.

### 12.3 Anchor message (`record_proof`)

13 lines joined by `\n`, no trailing newline. The program rebuilds lines 1–12 and `Requested by: `
from on-chain state and the instruction's arguments; the remainder is validated as a hostname (§7).

```
Stele Protocol v1 - Record Proof
I confirm the statement identified below.
Type: <label, §12.1>
Organization: <name> (verified: <domain>) | <name> (unverified)
Organization ID: <organization address, base58>
Statement: <statement_hash, lowercase hex>
Account: <signer, base58>
Network: <ProtocolConfig.network_label>
Chain: <ProtocolConfig.chain_id>
Issued: <RFC 3339>
Expires: <RFC 3339>
Nonce: <shard_id>-<nonce_index>-<nonce_tag hex>
Requested by: <host>
```

The organization **address** and the chain ID are bound explicitly (an acceptance binds them through
the version fingerprint). Organization PDAs are derived from the program ID, so the message cannot be
recorded by another deployment.

`record_proof(args: { proof_type: u8, statement_hash: [u8;32], nonce_index: u32, nonce_tag: [u8;8],
issued_at: i64, expires_at: i64 })`, accounts `relayer (signer, writable), config, organization,
nonce_shard (writable), instructions_sysvar`. Checks: not paused; organization not frozen; known
proof type; non-zero statement hash; validity window (§7.4, without the publication rule); shard
belongs to the organization and the relayer is the shard's relayer; canonical preceding Ed25519
instruction (§8 steps 4–6); message prefix equals the rebuild; nonce bit clear → set.

`proof_id = SHA-256("stele:v1:proof\0" || organization || signer || statement_hash || message_hash ||
signature)`. Proofs and acceptances share the shard's nonce space, counter and accumulator, so one
signed message can never be recorded twice in any form.

### 12.4 Proof receipt — `stele-proof-v1`

```json
{
  "format": "stele-proof-v1",
  "proofId": "<hex>",
  "network": { … }, "transaction": { … },
  "proof": { "type": "PURCHASE", "signer": "…", "message": "…", "messageHash": "…", "signature": "…",
             "statementHash": "…", "issuedAt": 0, "expiresAt": 0, "nonce": { … }, "requestDomain": "…" },
  "organization": { "address": "…", "name": "…", "verifiedDomain": "…" },
  "statement": { "...": "the full stele-statement-v1 object" },
  "signer": { "...": "OPTIONAL signer evidence, §14.4" },
  "fees": { "...": "OPTIONAL fee evidence, §13.4" },
  "generatedAt": "<RFC 3339>"
}
```

Proof IDs are public (they appear in `ProofRecorded` events), so issuers serve proof receipts only to
the organization or to the holder of the request's client token — never by proof ID alone.

---

## 13. Fee sponsorship

The user never pays. Every recording is relayed by the Stele relayer, which pays the network fee as
fee payer. The relayer is never an authorizer: the program verifies the user's signature exactly as
without sponsorship. Two models:

- **Stele-sponsored** — the relayer absorbs the fee (off-chain billing decides whether the organization
  may record: a free monthly allowance, then prepaid credits).
- **Organization-sponsored** — the organization funds one of its nonce shards; the program reimburses
  the relayer from it, on-chain, in the same transaction.

### 13.1 Sponsorship trailer

A shard with sponsorship enabled is 8,440 bytes: the unchanged 8,320-byte `NonceShard` (§6.2) followed
by a 120-byte trailer (little-endian, read and written by copy):

| Offset | Field | Type |
|---|---|---|
| 8320 | `magic` | `"stelesp1"` |
| 8328 | `created_by` | Pubkey |
| 8360 | `max_fee_per_record` | u64 (lamports, 1 … 5,000,000) |
| 8368 | `daily_limit` | u64 (≥ `max_fee_per_record`) |
| 8376 | `current_day` | i64 (`unix_time / 86400`) |
| 8384 | `spent_today` | u64 |
| 8392 | `total_reimbursed` | u64 |
| 8400 | `reimbursed_count` | u64 |
| 8408 | `total_withdrawn` | u64 |
| 8416 | `created_at` | i64 |
| 8424 | `updated_at` | i64 |
| 8432 | `paused` | u8 |
| 8433 | reserved | [u8; 7] |

The shard address is the **deposit address**: anyone may fund it with a plain transfer. It is a PDA:
no private key exists that could spend it. The balance above the rent-exempt minimum is spendable.
Enabling sponsorship is an explicit, opt-in reallocation that preserves every existing byte (§15 rule 3).

### 13.2 Reimbursement (inside `record_acceptance` / `record_proof`)

After the record is verified and written, if the shard has an active (unpaused) trailer and a
designated relayer equal to the transaction's relayer:

```
fee    = 5,000 × 2 + ceil(compute_unit_limit × compute_unit_price / 1,000,000)
amount = min(fee, max_fee_per_record)
```

The compute-budget values are read from the transaction's own `ComputeBudget` instructions through the
instructions sysvar (no limit instruction → no priority component). Two signatures are counted: the
relayer's transaction signature and the verified user signature; extra signers are never reimbursed.
The amount is paid only if `spent_today + amount ≤ daily_limit` (with a UTC-day rollover) and the
balance minus the rent minimum covers it; otherwise **nothing is paid and the recording still
succeeds** — fee accounting never blocks or alters a signed record. A `SponsorReimbursed` event names
the record ID and the amount.

### 13.3 Management instructions

| # | Instruction | Authorized signer(s) | Key checks |
|---|---|---|---|
| 32 | `enable_shard_sponsorship(max_fee_per_record, daily_limit)` | owner (not locked) / admin (not frozen) | shard of this organization; designated (non-zero) relayer; not already enabled; limits valid; payer tops up rent |
| 33 | `update_shard_sponsorship(limits, paused)` | owner; admin may only lower limits or pause | enabled; limits valid |
| 34 | `withdraw_shard_sponsorship(amount)` | owner (not locked) | enabled; `amount > 0`; remaining ≥ rent minimum; destination ≠ shard |

### 13.4 Fee evidence

Receipts MAY carry `fees: { payer, sponsor: "STELE" | "ORGANIZATION", feeLamports,
reimbursedLamports }`. A verifier derives the payer from the transaction's first account key, the
fee from transaction metadata and the reimbursement from the `SponsorReimbursed` event whose record ID
equals the acceptance/proof ID, and compares.

---

## 14. Passkey-protected Stele keys (walletless signing)

> New walletless signers use native passkeys (`stele/2`, §17): the passkey's own key signs and no
> key exists outside the authenticator. This section remains normative for signers registered
> before, which keep working unchanged.

A walletless signer is an ordinary Ed25519 key — the bytes signed and verified on-chain are exactly
those of §7 and §12 — whose private key exists only encrypted under a passkey.

### 14.1 Key generation and wrapping

The browser generates a 32-byte Ed25519 seed (CSPRNG) and wraps it:

```
wrapping_key = HKDF-SHA256(ikm = secret, salt = 32 random bytes, info = purpose tag)
blob         = AES-256-GCM(wrapping_key, iv = 12 random bytes, seed,
                           aad = "stele-wrapped-key-v1" || public_key || binding_id)
```

- passkey wrap: `secret` = WebAuthn **PRF** output (`prf.eval.first` = a stored random salt), released
  only after user verification; tag `"stele:v1:passkey-wrap\0"`; binding ID = credential ID;
- recovery wrap: `secret` = a 32-byte recovery kit secret shown to the user once
  (`stele-rk1-…`, base32 with a checksum); tag `"stele:v1:recovery-wrap\0"`; binding ID =
  `SHA-256("stele:v1:recovery-kit-id\0" || secret)[0..16]` (the kit ID, used to look the wrap up).

Unwrapping re-derives the public key and rejects any mismatch. Without PRF there is no walletless
signing: there is no server-held, password-derived or otherwise downgraded fallback.

### 14.2 WebAuthn challenges

```
signing challenge   = SHA-256("stele:v1:passkey-signature\0" || message bytes)
statement challenge = SHA-256("stele:v1:passkey-statement\0" || key statement bytes)
```

One assertion (with `userVerification: "required"`) per signed message both approves exactly that
message and releases the PRF output that unlocks the key for that single signature.

### 14.3 Key statements

Every change binding a key to an unlock method is a statement **signed by the key** (Ed25519 over its
UTF-8 bytes) and, when it concerns a passkey, endorsed by that passkey (assertion over the statement
challenge):

```
Stele Protocol v1 - Signing Key Statement
<action text>
Organization ID: <organization>
[Previous key: <key>]                      (ROTATE)
Key: <public key>
Passkey: <credential ID, base64url>        (REGISTER, ADD_PASSKEY, ROTATE, REVOKE_PASSKEY)
Passkey key: <SHA-256 of the SPKI, hex>     (REGISTER, ADD_PASSKEY, ROTATE)
Relying party: <RP ID>                      (REGISTER, ADD_PASSKEY, ROTATE)
Recovery kit: <kit ID, hex>                 (ADD_RECOVERY_KIT)
Chain: <chain ID>
Issued: <RFC 3339>
```

Actions: `REGISTER`, `ADD_PASSKEY`, `ADD_RECOVERY_KIT`, `REVOKE_PASSKEY`, `ROTATE` (an endorsed
rotation is additionally signed by the previous key). When every unlock method is lost, only the
organization's account system can authorize a **new** key for that account; the new key is recorded
as `account_authorized` (not endorsed by the old key) and the old key is retired, never recovered.

### 14.4 Signer evidence

Receipts MAY carry `signer`:

```json
{ "type": "PASSKEY_PROTECTED_STELE_KEY",
  "passkey": { "credentialId": "…", "publicKey": "<SPKI base64url>", "algorithm": -7, "rpId": "shop.example" },
  "keyStatement": { "statement": "…", "keySignature": "<base64url>", "passkeyAssertion": { … } },
  "assertion": { "credentialId": "…", "authenticatorData": "…", "clientDataJSON": "…", "signature": "…" } }
```

or `{ "type": "WALLET" }`. A verifier checks: the key statement parses, binds this passkey (ID, SPKI
hash, RP ID) to the signer key for this organization and network, and is signed by the signer key;
the endorsement verifies under the passkey on a host the RP ID covers; and the signing assertion
verifies under the passkey (ES256, EdDSA or RS256), over the signing challenge of the exact signed
message, with type `webauthn.get`, the requesting site's origin, the RP ID hash, and the UP and UV
flags. Any failure invalidates a receipt that claims passkey evidence. The evidence proves control of
the passkey and key at signing time; it contains no biometric data and does not identify a person.

---

## 15. Versioning and upgrade rules

1. Every hashed or signed artifact carries its format identifier. A new identifier is introduced for
   any change in bytes, never a silent change.
2. Verifiers MUST support all published format identifiers indefinitely.
3. Program upgrades MUST NOT alter the layout or meaning of existing `DocumentVersion`,
   `Organization`, `Member`, `Document` or `NonceShard` accounts; new fields require new account
   types or explicit migrations that preserve all existing values.
4. The acceptance message's first line names the protocol version. `stele/2` messages begin with
   `Stele Protocol v2 - Accept Agreement` and are recorded by `record_passkey_acceptance` (§17);
   `stele/1` messages, instructions and receipts are unchanged and remain supported.
5. Receipt formats are never reinterpreted: `stele-receipt-v1` keeps its meaning;
   `stele-receipt/2` is a separate format (§17.6).

---

## 16. Test vectors

`spec/test-vectors/` contains JSON vectors for: text normalization, content canonicalization and
hashing, version JSON and fingerprint, RFC 3339 formatting, acceptance message construction,
acceptance ID and accumulator, hostname/identifier validation, proof anchor messages and proof IDs,
statement canonicalization and commitments, `stele/2` native passkeys (`passkey-p256.json`) and
Merkle batches (`batch.json`). Both the Rust (`crates/`) and TypeScript (`packages/protocol`)
implementations MUST pass all vectors in CI.

---

## 17. `stele/2` — native passkey signatures and batched evidence

`stele/2` adds two things to `stele/1` without changing any `stele/1` byte, message, receipt or
account: **native passkey signatures** (a WebAuthn ES256 credential signs; Solana's secp256r1
precompile verifies) and the **`MERKLE_BATCHED` evidence mode**. `stele/1` acceptances (wallets and
PRF-protected Stele keys, §14) remain valid and verifiable indefinitely (§15.2).

| | |
|---|---|
| Message | `stele-acceptance-v2` (§17.2) |
| Signer algorithm | ECDSA P-256 / SHA-256 over WebAuthn data (COSE ES256), 33-byte compressed key |
| Instructions | `record_passkey_acceptance`, `enroll_passkey_signer`, `rotate_passkey_signer`, `recover_passkey_signer`, `revoke_passkey_signer`, `anchor_acceptance_batch` |
| Account | `PasskeySigner` (§17.5) |
| Receipt | `stele-receipt/2` (§17.6) |
| Batch manifest | `stele-batch-manifest/1` (§17.9) |

Text identifier of a P-256 signer in APIs and databases: `p256:` followed by the 66 lowercase hex
characters of the compressed key (never confusable with a base58 Solana address).

### 17.1 Why a new protocol version

With `stele/1` a walletless signer's Ed25519 key is generated in the browser and unlocked by the
passkey's PRF output (§14): the private key exists in JavaScript memory for each signature. With
`stele/2` the passkey's own P-256 key signs; the private key never leaves the authenticator and no
key exists anywhere else. Because the signed bytes are WebAuthn data rather than the message itself,
the message format, identifiers and verification differ — hence a new message header, new
instructions and a new receipt format (§15.1).

### 17.2 Acceptance message — `stele-acceptance-v2`

Twelve lines joined by LF (U+000A), no trailing newline, UTF-8:

```
Stele Protocol v2 - Accept Agreement
I accept the exact document version below.
Organization: <name> (verified: <domain>) | Organization: <name> (unverified)
Document: <title>
Version: <version label> (#<number>)
Fingerprint: <64 lowercase hex>
Signer: passkey-p256 <66 lowercase hex: compressed P-256 key>
Network: <network label>
Issued: <RFC 3339>
Expires: <RFC 3339>
Nonce: <shard id>-<nonce index>-<16 lowercase hex nonce tag>
Requested by: <request domain>
```

Field rules are those of §7. The program rebuilds every line from on-chain state, the instruction
arguments and the precompile-verified key; nothing of the message is transmitted on-chain except
its consequences. Parsers MUST require canonical form (re-serialization yields the same bytes).

**Challenge.** The WebAuthn challenge is

```
challenge   = SHA-256("stele:v2:passkey-acceptance\0" || UTF-8(message))
```

**Acceptance ID.**

```
acceptance_id = SHA-256("stele:v2:passkey-acceptance-id\0" || version (32) || signer (33)
                        || SHA-256(message) (32) || signature (64, compact r||s, low-S))
```

### 17.3 The secp256r1 precompile and instruction introspection

The transaction carries a secp256r1 (`Secp256r1SigVerify1111111111111111111111111`) instruction
**immediately before** the Stele instruction that relies on it. The runtime verifies it before
execution (SHA-256 of the message, low-S signature, valid compressed point). Stele accepts exactly
one layout:

| Bytes | Value |
|---|---|
| `0` | `1` (one signature) |
| `1` | `0` (padding) |
| `2..4` signature offset | `49` |
| `4..6` signature instruction | `0xFFFF` (this instruction) |
| `6..8` public-key offset | `16` |
| `8..10` public-key instruction | `0xFFFF` |
| `10..12` message offset | `113` |
| `12..14` message size | `n` |
| `14..16` message instruction | `0xFFFF` |
| `16..49` | public key (33) |
| `49..113` | signature (64) |
| `113..113+n` | message = `authenticatorData || SHA-256(clientDataJSON)` |

The data length MUST be exactly `113 + n`; the precompile instruction MUST have no accounts. The
Stele instruction MUST be top-level (stack height 1, its own program ID at the current index —
no CPI). Any deviation fails with `MissingSecp256r1Instruction` / `InvalidSecp256r1Instruction` /
`CpiNotAllowed`. Self-referencing offsets guarantee that the bytes the program reads are the bytes
the runtime verified.

### 17.4 WebAuthn binding and `record_passkey_acceptance`

Arguments: `nonce_index u32, nonce_tag [u8;8], issued_at i64, expires_at i64, assertion
{ request_domain string, rp_id string, client_data_json bytes (≤ 512) }`. Accounts: relayer
(signer, writable), config, organization, document, version, nonce shard (writable), optional
`PasskeySigner` enrollment, instructions sysvar.

The program, after the `stele/1` checks of §8 (protocol not paused, organization not frozen, current
version, validity window, issued no earlier than publication, nonce range, shard ownership and
relayer gating):

1. loads the precompile per §17.3; the verified key is the signer;
2. rebuilds the §17.2 message and its challenge;
3. checks `client_data_json` (§17.4.1) and `authenticatorData` (§17.4.2), and that
   `SHA-256(client_data_json)` equals the last 32 bytes of the precompile message;
4. if an enrollment account is passed: it belongs to the organization, is `ACTIVE`, holds this
   signer key, and its `rp_id_hash` equals `SHA-256(rp_id)` (`EnrollmentNotActive`,
   `EnrollmentMismatch`);
5. consumes the nonce bit (the same bitmap as `stele/1`: a nonce is used by at most one acceptance
   of either kind), computes the acceptance ID, folds it into the accumulator, emits
   `PasskeyAcceptanceRecorded`, and reimburses a sponsored shard (two signatures: relayer +
   precompile).

#### 17.4.1 `clientDataJSON`

At most 512 bytes of UTF-8, and it MUST begin with exactly

```
{"type":"webauthn.get","challenge":"<base64url(challenge), no padding>","origin":"
```

The origin is the text up to the next `"`; it MUST NOT contain `\`, and MUST equal
`https://<request_domain>` — or, only when the request domain is `localhost`,
`http://localhost` with an optional `:<port>`. The byte after the origin's closing quote MUST be `}`
or `,`. A `"crossOrigin":` member that is not `false`, a `"crossOrigin":true`, or a `"topOrigin"`
member anywhere in the remainder is rejected (`CrossOriginCeremony`): the ceremony must run in a
top-level browsing context of the requesting site. The origin is therefore **browser-attested**: the
browser writes it, and the key signs it.

#### 17.4.2 `authenticatorData` and relying party

At least 37 bytes; bytes 0..32 equal `SHA-256(rp_id)`; flags (byte 32) have UP (0x01) **and**
UV (0x04) set and AT (0x40) clear; the ED flag (0x80) is set if and only if bytes follow the
37-byte header. `rp_id` MUST be a valid hostname equal to `request_domain` or a parent domain of it
(dot boundary). Backup flags (BE 0x08, BS 0x10) are reported, never required.

### 17.5 Passkey signer enrollment — `PasskeySigner`

An organization that binds signers to its own accounts (`ACCOUNT_AND_PASSKEY`) anchors each
account's current passkey key on-chain, so that neither its database nor Stele's is the authority on
"account X → key Y".

**Account commitment** (no personal data on-chain):

```
account_commitment = SHA-256("stele:v2:account\0" || organization (32) || salt (32)
                              || UTF-8(external user reference))
```

`salt` is 32 random bytes per account, kept off-chain by the relayer and disclosable by the
organization to prove which account a commitment names. Without it the commitment cannot be
brute-forced from guessable references (e-mail addresses, sequential IDs).

**Account** (PDA `["passkey-signer", organization, account_commitment]`, 225 bytes with the
discriminator):

| Field | Type |
|---|---|
| organization | Pubkey |
| account_commitment | [u8; 32] |
| signer_key | [u8; 33] — current compressed P-256 key |
| previous_key | [u8; 33] — key it replaced (zero for the first enrollment) |
| rp_id_hash | [u8; 32] |
| credential_id_hash | [u8; 32] — SHA-256 of the raw WebAuthn credential ID |
| enrolled_at, updated_at | i64 |
| generation | u32 — +1 on every change |
| status | u8 — 1 ACTIVE, 2 REVOKED |
| kind | u8 — 1 ENROLLED, 2 ROTATED, 3 ORGANIZATION_RECOVERY |
| bump | u8 |

**Enrollment statement** (signed by the NEW key; tag `stele:v2:passkey-enroll\0`):

```
Stele Protocol v2 - Enroll Passkey Signer
Organization: <base58 organization>
Account commitment: <64 hex>
Signer: passkey-p256 <66 hex>
Relying party: <rp id>
Network: <network label>
Issued: <RFC 3339>
Expires: <RFC 3339>
```

**Rotation statement** (signed by the CURRENT key; tag `stele:v2:passkey-rotate\0`):

```
Stele Protocol v2 - Rotate Passkey Signer
Organization: <base58 organization>
Account commitment: <64 hex>
Previous signer: passkey-p256 <66 hex>
New signer: passkey-p256 <66 hex>
Network: <network label>
Issued: <RFC 3339>
Expires: <RFC 3339>
```

Each statement is signed through WebAuthn exactly like an acceptance (§17.3–§17.4, challenge =
`SHA-256(tag || statement)`).

| Instruction | Authorized by | Effect |
|---|---|---|
| `enroll_passkey_signer` | the shard's designated relayer AND the new key's signature over the enrollment statement | creates the account, kind ENROLLED; zero commitments are refused |
| `rotate_passkey_signer` | the CURRENT key's signature over the rotation statement (the program names the signing key as "Previous signer" and requires it to equal `signer_key`) | kind ROTATED, `previous_key` ← old key |
| `recover_passkey_signer` | the organization's owner or an admin wallet | kind ORGANIZATION_RECOVERY — never presented as endorsed by the previous key |
| `revoke_passkey_signer` | the organization's owner or an admin wallet | status REVOKED |

Every change emits `PasskeySignerChanged` (organization, enrollment, commitment, signer, previous
key, RP hash, credential hash, actor, time, slot, generation, kind, status). Changes never alter past
acceptances: an acceptance stays valid and its verification reports whether the key is still the
account's signer, and how it was replaced.

A relayer MUST require, before registering a key-only (not account-bound) passkey, an assertion of
the new key over an enrollment statement with an all-zero account commitment (possession proof; the
program refuses such statements, so they can never be recorded).

### 17.6 Receipt — `stele-receipt/2`

An unsigned JSON bundle; every field is a claim a verifier checks (§17.7). It is used for
`stele/2` acceptances and for any batched acceptance; `stele/1` acceptances recorded directly keep
`stele-receipt-v1`.

```
{
  "format": "stele-receipt/2",
  "protocol": "stele/1" | "stele/2",
  "evidenceMode": "DIRECT_ONCHAIN" | "MERKLE_BATCHED",
  "acceptanceId": hex32,
  "network": { "chainId", "label", "programId" },
  "transaction": { "signature", "slot", "blockTime" },     // MERKLE_BATCHED: the batch anchor
  "acceptance": { "message", "messageHash", "challenge" (stele/2) | null,
                  "signature" (stele/1, base58) | null, "issuedAt", "expiresAt",
                  "nonce": { "shardId", "index", "tag" }, "requestDomain" },
  "signer": { "type": "NATIVE_PASSKEY", "algorithm": "ES256", "publicKey": hex66,
              "enrollment": { "address", "accountCommitment" } | null }
          | { "type": "ED25519_KEY", "algorithm": "Ed25519", "publicKey": base58,
              "evidence"?: SignerEvidence (§14) },
  "webauthn"?: { "authenticatorData", "clientDataJSON" (base64url), "signature": hex128, "rpId" },
  "origin": { "attestation": "BROWSER_ATTESTED" | "MERCHANT_CLAIMED", "origin" | null,
              "requestDomain" },
  "batch"?: { "root", "batchId", "leafIndex", "leafCount", "proof": [hex32] },
  "organization": { "address", "name", "verifiedDomain" },
  "document": { "address", "slug", "documentType", "locale" },
  "version": { … as in stele-receipt-v1 … },
  "content"?: stele-content-v1,      // the document text; included by default
  "fees"?: { "payer", "sponsor", "feeLamports", "reimbursedLamports" },
  "generatedAt": RFC 3339
}
```

Consistency rules: `stele/2` ⇒ `NATIVE_PASSKEY`, `webauthn` and `challenge` present, origin
`BROWSER_ATTESTED`; `stele/1` ⇒ `ED25519_KEY`, no `webauthn`, `signature` present, evidence mode
`MERKLE_BATCHED`; `batch` present ⇔ `MERKLE_BATCHED`. Unknown fields are rejected.

The receipt carries the exact signed text (only its hash is on-chain) and, by default, the document
content (whose SHA-256 is on-chain). With the receipt and any Solana RPC holding the history, the
agreement — what text, which version, which credential, which site — is verifiable without Stele,
the organization or their databases.

### 17.7 Verification (stele/2 and batched)

In addition to §11 (network, version, content, history, domain, fees):

**Direct (`record_passkey_acceptance`).**

1. Find the instruction immediately preceded by a canonical secp256r1 instruction (§17.3); verify
   the P-256 signature locally.
2. Find its `PasskeyAcceptanceRecorded` event (same shard and nonce, same key); recompute the
   acceptance ID with the event's message hash.
3. Obtain the text: from the caller, the receipt, or by rebuilding it from chain data (version and
   shard are immutable; organization name, domain status and network label are read as of the
   recording, and the rebuild is used only if it hashes to the recorded message hash). If no text
   hashes to it, report the text as unavailable (warning) — the program verified it at recording.
4. With the text: re-run §17.4.1–§17.4.2 (challenge, origin, RP, UP+UV, client data hash), parse the
   message canonically, and compare its fields with the instruction and the version account.
5. Version current at recording, nonce consumed, requesting site (§11).
6. Enrollment (if named by the event): the account is the canonical PDA of this organization; report
   whether the key is still the current signer, was rotated, or was replaced by organization
   recovery, and whether the enrollment was revoked since.
7. Receipt: every claim equals the derived fact (value comparison, key order irrelevant).

**Batched (`anchor_acceptance_batch`).** See §17.9.

**Origin semantics.** `BROWSER_ATTESTED` (native passkey; PRF passkey evidence §14) vs
`MERCHANT_CLAIMED` (wallet signatures: the requesting page wrote "Requested by:" into the message;
the signature makes it unalterable afterwards, but no browser attested it). Verifiers MUST report
the latter as a warning, never as browser-attested.

### 17.8 Replay and nonces

* **Direct mode** (both protocols): one bit per acceptance in a shared shard bitmap (65,536 per
  shard account) — no per-acceptance account. A signed message can be recorded at most once; the
  same nonce cannot serve a wallet and a passkey acceptance.
* **Batched mode**: no nonce is consumed on-chain. Recording the same signed acceptance twice yields
  the same acceptance ID — an acceptance is idempotent (agreeing twice to the same version is the
  same fact). Relayers MUST de-duplicate by acceptance ID. Signed messages still carry the nonce,
  issue and expiry times; verifiers check that the batch was anchored inside the signed window.
* **Proofs** (§12) keep strong on-chain nonces in all cases: replaying a purchase or refund would
  change its meaning. Proofs are never batched.

### 17.9 `MERKLE_BATCHED` evidence mode

The relayer verifies each acceptance exactly as it would before relaying it (Ed25519 over the
`stele-acceptance-v1` message; or the native passkey's WebAuthn signature with §17.4's rules over
the `stele-acceptance-v2` message), checks on-chain that the version is still current, and queues
it. Periodically it anchors the Merkle root of queued acceptances of one shard.

**Leaves and nodes.**

```
leaf     = SHA-256("stele:v2:batch-leaf\0" || protocol (1 byte: 1 = stele/1, 2 = stele/2)
                   || acceptance_id (32))
node     = SHA-256("stele:v2:batch-node\0" || left (32) || right (32))
```

Leaves are ordered as anchored (queue order). At each level, pairs are hashed left to right; an
unpaired last node is **promoted unchanged** (never duplicated). A tree has 1 to 65,536 leaves.
An inclusion proof is the list of siblings from the leaf upwards, omitting levels where the node is
promoted; it MUST be verified against the **anchored** leaf count, which fixes the path shape.

**Anchor.** `anchor_acceptance_batch { batch_root [u8;32], leaf_count u32 }` with accounts relayer
(signer, writable), config, organization, nonce shard (writable), instructions sysvar. Only the
shard's designated relayer may anchor (never an open shard); the protocol must not be paused nor the
organization frozen; top-level only. The program verifies **no user signature** here. It computes

```
batch_id = SHA-256("stele:v2:batch\0" || organization (32) || nonce_shard (32) || root (32)
                   || leaf_count (u32 LE) || sequence (u64 LE))
```

with `sequence` the shard's recorded count before the batch, folds `batch_id` into the shard
accumulator, adds `leaf_count` to the recorded count, emits `AcceptanceBatchAnchored`
(organization, shard, root, batch id, accumulator, anchored at, slot, sequence after, leaf count,
shard id), and reimburses a sponsored shard one signature's fee. The accumulator thus remains one
append-only log of everything recorded against the shard, direct or batched (existing values are
unchanged, §15.3).

**Manifest.** For every anchored batch the relayer publishes `stele-batch-manifest/1` —
`{ format, organization, nonceShard, root, leafCount, leaves: [BatchedEvidence] }` — in the
content store (hash-addressed). `BatchedEvidence` is one leaf's complete evidence: protocol,
acceptance ID, version address, message, signature (stele/1) or WebAuthn data (stele/2), signer,
and `batch { root, batchId, leafIndex, leafCount, proof }`. The organization receives the same
evidence by webhook and the user in the receipt: a leaf never depends on one party's database.

**Verification of a batched acceptance.** Given the anchor transaction and the leaf's evidence:

1. The transaction succeeded; it contains a top-level `anchor_acceptance_batch` with this root and
   the matching `AcceptanceBatchAnchored` event; `batch_id` recomputes (organization, shard, root,
   count, `sequence − leaf_count`).
2. The signature verifies **off-chain**: Ed25519 over the message (stele/1), or P-256 over
   `authenticatorData || SHA-256(clientDataJSON)` plus all of §17.4.1–§17.4.2 with the challenge of
   the message (stele/2). The message parses canonically and names the signing key.
3. The acceptance ID recomputes from version, key, message hash and signature; the leaf proves into
   the anchored root at the anchored leaf count.
4. The version account, content and history verify (§11); the message names exactly that version,
   network and the shard that anchored the batch.
5. The anchor's block time lies within `[issuedAt − 300 s, expiresAt + 60 s]` — the anchor is the
   only on-chain clock in this mode.
6. The next version (if any) was published after the signed issue time (stated in the signed message;
   not checked on-chain in this mode).
7. Replay protection is reported as off-chain (§17.8); a claimed enrollment is reported as current,
   previous, or not listed (not checked on-chain in this mode).

**What changes, honestly.** In batched mode the chain proves *that the root existed at that slot*;
everything else is proven by the evidence the verifier checks. A batch operator cannot forge a leaf
(it needs the user's signature) and cannot change one after anchoring (the root and count are
fixed), but it can omit or delay leaves, as a relayer can refuse to relay in direct mode. Leaf
counts per batch are public. Direct mode remains available (and is required where another Solana
program must read the acceptance).

### 17.10 What `stele/2` proves — and what it does not

Proves: a WebAuthn credential whose public key is recorded produced a **user-verified** signature
(the authenticator asserted UV) over the challenge of this exact message, in a top-level page of the
browser-attested origin, for this relying party; and — direct mode — Solana's runtime verified that
signature and the Stele program bound it to the current version of this document before recording
it; for account-bound signers, the key was the account's enrolled signer at that moment.

Does not prove: the identity of a person (only control of the credential); what the authenticator
displayed (passkey prompts show the site, not the agreement text — the text is what the signing page
rendered, see §4.5); that a synced passkey was not used from another device of the same provider
account; that the device, browser or provider account was not compromised; legal enforceability.
Nor does it prove that the recorded key belongs to a genuine authenticator: the program cannot tell a
passkey from a P-256 key generated in software, so the origin and UV statements above hold for
genuine passkeys, and the first enrollment of an account (§17.5) — like any key-only signer — is
trusted to whoever ran the ceremony. Verifying direct-mode evidence later requires an RPC that
serves historical transactions (an archival RPC).

### 17.11 Test vectors

`spec/test-vectors/passkey-p256.json` (messages, challenges, signed bytes, signatures, acceptance
IDs, enrollment and rotation statements, client-data and authenticator-data rules) and
`spec/test-vectors/batch.json` (leaves, roots, every inclusion proof, batch IDs). Both the Rust and
TypeScript implementations MUST reproduce them.

## 18. Stele Gate — policies, access passes and `require_current`

Stele Gate lets another Solana program require, before a protected action, that the signing wallet
accepted a given version of a document. It adds two accounts and three instructions to the Stele
program and a read-only check (`crates/stele-gate`) that the protected program runs itself. It
changes no `stele/1` or `stele/2` byte, message, receipt or account: a gated acceptance is a
`stele-acceptance-v1` wallet acceptance (§7) and its receipt is a `stele-receipt-v1` (§10).

Stele is not in the protected transaction. The protected program reads the two accounts; there is no
cross-program invocation into Stele, no proxy and no shared signer.

### 18.1 `AccessPass`

PDA `["access-pass", document, holder]`. 233 bytes including the discriminator
`[24, 47, 32, 42, 150, 120, 87, 169]`. Rent is paid by the relayer that records the first acceptance.

| Offset | Field | Type | Meaning |
|---|---|---|---|
| 8 | `organization` | Pubkey | The document's organization |
| 40 | `document` | Pubkey | |
| 72 | `holder` | Pubkey | The wallet whose Ed25519 signature recorded the acceptance |
| 104 | `version` | Pubkey | The `DocumentVersion` most recently accepted |
| 136 | `version_hash` | [u8; 32] | That version's fingerprint (§5) |
| 168 | `acceptance_id` | [u8; 32] | The acceptance identifier of that acceptance (§2) |
| 200 | `accepted_at` | i64 | Unix time it was recorded |
| 208 | `first_accepted_at` | i64 | Unix time the pass was created |
| 216 | `accepted_slot` | u64 | Slot it was recorded |
| 224 | `version_number` | u32 | `DocumentVersion.version` of `version` |
| 228 | `acceptance_count` | u32 | Gated acceptances recorded for this pass |
| 232 | `bump` | u8 | |

A pass is created and advanced only by `record_gated_acceptance` (§18.3). It is never closed and its
`version_number` never decreases.

### 18.2 `GatePolicy`

PDA `["policy", document]` — one policy per document. 157 bytes including the discriminator
`[3, 77, 45, 55, 30, 166, 143, 147]`.

| Offset | Field | Type | Meaning |
|---|---|---|---|
| 8 | `organization` | Pubkey | |
| 40 | `document` | Pubkey | |
| 72 | `required_version_hash` | [u8; 32] | Fingerprint of the required version |
| 104 | `updated_by` | Pubkey | The authority of the last change |
| 136 | `created_at` | i64 | |
| 144 | `updated_at` | i64 | |
| 152 | `required_version` | u32 | The lowest version number that satisfies the policy |
| 156 | `bump` | u8 | |

Publishing a version (§6) does not change any policy.

### 18.3 Instructions

**`create_policy()`** — accounts: `authority` (signer), `membership` (optional, PDA
`["member", organization, authority]`), `config`, `organization`, `document`, `version`, `policy`
(init), `payer` (signer, mut), `system_program`. Requires: protocol not paused; `authority` holds a
document-creating role (owner, admin or publisher) and the organization is not frozen;
`document.organization == organization`; `version.document == document`. Sets
`required_version` and `required_version_hash` from `version`. Emits `PolicyChanged` with
`created = true`.

**`set_policy_requirement()`** — accounts: `authority`, `membership` (optional), `config`,
`organization`, `document`, `version`, `policy` (mut). Same authorization; additionally
`1 ≤ version.version ≤ document.version_count` (`InvalidPolicyRequirement`, 6081) and
`policy.document == document` (`PolicyMismatch`, 6082). The requirement may name any published
version, lower or higher than before. Emits `PolicyChanged` with `previous_required_version`.

**`record_gated_acceptance(nonce_index, nonce_tag, issued_at, expires_at)`** — accounts: `relayer`
(signer, mut), `config`, `organization`, `document`, `version`, `nonce_shard` (mut), `holder`,
`access_pass` (init if needed, PDA `["access-pass", document, holder]`, paid by `relayer`),
`system_program`, `instructions_sysvar`. Performs every check and effect of `record_acceptance`
(§8) — the Ed25519 instruction, the current version, the time window, the shard's relayer and the
single-use nonce — and then:

1. `holder` MUST equal the runtime-verified signer of the acceptance message
   (`AccessPassMismatch`, 6080). The relayer cannot assign a pass to another wallet.
2. On creation: sets `organization`, `document`, `holder`, `first_accepted_at`, `bump`. Otherwise
   `document` and `holder` MUST match and the new `version_number` MUST NOT be lower.
3. Sets `version`, `version_hash`, `version_number`, `acceptance_id`, `accepted_at`, `accepted_slot`
   and increments `acceptance_count`.
4. Emits `AcceptanceRecorded` (§9) and `AccessPassUpdated`.

Only wallet (Ed25519) acceptances open a Gate: the holder must be able to sign the protected
transaction. Verifiers (§11) treat `record_gated_acceptance` like `record_acceptance`, with
`holder` at account index 6, `access_pass` at index 7 (which MUST be the PDA above) and the
instructions sysvar at index 9.

### 18.4 `require_current(access_pass, policy, user)`

The check a protected program runs (`crates/stele-gate`). It reads both accounts, writes nothing and
returns the first failure, as `ProgramError::Custom(code)`:

| # | Rule | Failure |
|---|---|---|
| 1 | `policy` is owned by the Stele program, is at least 157 bytes, has the policy discriminator and is the PDA `["policy", policy.document]` with its stored bump | `InvalidPolicy` 7600 |
| 2 | `user` signed the transaction | `UserNotSigner` 7601 |
| 3 | `access_pass` is owned by the Stele program — if not, `AccessPassMissing` when it is the address `["access-pass", policy.document, user]` (the user never accepted), otherwise `AccessPassInvalid` — and is at least 233 bytes with the pass discriminator (else `AccessPassInvalid`) | 7602 / 7603 |
| 4 | `pass.holder == user`, `pass.document == policy.document`, `pass.organization == policy.organization` | `AccessPassMismatch` 7604 |
| 5 | `access_pass` is the PDA `["access-pass", document, user]` with its stored bump | `AccessPassInvalid` 7603 |
| 6 | `pass.version_number ≥ policy.required_version` | `AccessPassOutdated` 7605 |
| 7 | If equal, `pass.version_hash == policy.required_version_hash` | `FingerprintMismatch` 7606 |

On success it returns the pass's organization, document, version, version number, fingerprint,
acceptance identifier, acceptance time and the policy's required version.

The protected program MUST pin the policy (store its address or compile it in) and MUST call
`require_current` in every protected instruction. A program that accepts any policy accepts a
policy its caller created.

Off-chain readers apply the same rules (`evaluateAccess` in `@stele/protocol`), reporting `VALID`,
`OUTDATED` (rules 6–7) or `MISSING`.

### 18.5 Demo: Atlas Real Estate Vault

`programs/gate-demo` (`A6DBoANAavtbG2ARK6PihqzMjhtbcZUbLnTMAWn339uR`) is a toy permissioned vault
used by the live demo and the tests. No tokens move: deposits are recorded as demo USDC.

- `create_vault(name)` — vault PDA `["vault", policy]`; the policy must be owned by the Stele program
  and carry the policy discriminator.
- `deposit(amount)` — accounts `investor` (signer), `vault` (mut), `policy`
  (`address = vault.policy`, else `WrongPolicy`), `access_pass`. Calls `require_current`, then adds
  `amount` to the totals and emits `Deposited` with the version, number, fingerprint and acceptance
  identifier that allowed it.

### 18.6 Accept & Continue

A client that finds the pass `MISSING` or `OUTDATED` records a gated acceptance of the current
version (transaction 1, submitted and paid by the relayer), waits until the pass is visible, then
sends the protected transaction (transaction 2). The two are not atomic. If transaction 2 fails, the
acceptance and the pass remain; if the policy is raised in between, transaction 2 fails with
`AccessPassOutdated`.

### 18.7 What a Gate check proves — and what it does not

Proves: the wallet that signed the protected transaction earlier signed a `stele-acceptance-v1`
message for a version of the policy's document at least as new as the one the policy requires at
the moment of the check, and Solana verified that signature when it was recorded.

Does not prove: who controls the wallet (not KYC); that the document's terms are legally
enforceable; that the protected program integrates the check correctly (pinning, every
instruction). The policy is controlled by the organization's authorities and the program by its
upgrade authority (§15).
