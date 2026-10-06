# Canonicalization (`stele-canonical-v1`)

A hash only proves something if everyone hashes the same bytes. Two editors, two operating systems or
two programming languages must turn the same document into exactly the same byte sequence — and no one
must be able to produce two different-looking texts with the same fingerprint, or one text that looks
the same but hashes differently. Canonicalization is the set of rules that guarantees this.

The normative rules are in [PROTOCOL_SPEC.md §3–4](../PROTOCOL_SPEC.md#4-content-canonicalization--stele-canonical-v1).
This page explains them and shows how to reproduce a content hash with standard tools.

## What gets hashed

Not HTML, not Markdown, not a PDF rendering: a small, typed JSON model.

```json
{
  "attachments": [],
  "blocks": [
    { "level": 1, "text": "Terms", "type": "heading" },
    { "text": "These terms apply to everyone.", "type": "paragraph" },
    { "items": ["Be kind", "Be honest"], "ordered": false, "type": "list" }
  ],
  "changeSummary": null,
  "format": "stele-content-v1"
}
```

- Three block types: headings (levels 1–3), paragraphs, and ordered or unordered lists.
- An optional **change summary** — part of the signed content, so "what changed" is itself evidence.
- Attachments by digest only (name, media type, size, SHA-256); the files themselves are stored
  elsewhere and verified against their digests.
- No other keys, no styling, no links, no scripts. Nothing that renders differently on different
  screens can change what was agreed to.

## The pipeline

```
authoring text ──parse──▶ blocks ──normalize every string──▶ validate ──JCS serialize──▶ bytes ──SHA-256──▶ content_hash
```

### 1. Authoring syntax

Publishers write plain text in the dashboard (or produce the JSON model directly through the API):

| You type | You get |
|---|---|
| `# Title`, `## Section`, `### Subsection` | Heading, levels 1–3 |
| `- item` or `* item` | Unordered list item |
| `1. item` or `1) item` | Ordered list item |
| A blank line | Ends the current paragraph or list |
| A single line break | Stays inside the paragraph |

The authoring syntax is only a convenience; it is never hashed. Two different authoring texts that
parse into the same blocks produce the same hash.

### 2. Text normalization

Every string is normalized before validation:

1. A single leading byte-order mark is removed.
2. Line endings are unified: CR LF, CR, NEL, LINE SEPARATOR and PARAGRAPH SEPARATOR all become LF.
3. Tabs become spaces.
4. Unicode is normalized to **NFC**, so `é` typed as one code point or as `e` + combining accent is the
   same text.
5. **Forbidden code points are rejected**, not removed: control characters, zero-width spaces,
   bidirectional overrides and isolates (Trojan Source), invisible fillers, tag characters, private-use
   and non-characters. Silently removing them would let two different inputs collide; rejecting them
   forces the publisher to fix the source.
6. Within each line, runs of spaces collapse to one and leading/trailing spaces are removed.
7. Empty lines are removed (paragraph structure lives in the blocks, not in blank lines).
8. Headings and list items are single-line: their remaining line breaks become spaces.

Only U+0020 is collapsed. A no-break space (U+00A0) is meaningful — for example between a number and
its currency — and is kept.

### 3. Validation

The normalized model must satisfy fixed limits (up to 5,000 blocks, 20,000 bytes per paragraph, 2 MiB
in total, and so on) and contain exactly the allowed keys. Out-of-range input is rejected with a precise
error; it is never truncated.

### 4. Serialization

The canonical bytes are the [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) (JSON Canonicalization
Scheme) serialization: keys sorted, no whitespace, minimal escaping, UTF-8. Because the model only
contains strings, small integers, booleans, `null`, arrays and objects, the serialization is simple to
implement correctly in any language.

### 5. Hashing

```
content_hash = SHA-256(canonical bytes)
```

There is no prefix or salt. Domain separation comes from the mandatory `"format": "stele-content-v1"`
member, so the hash is reproducible with any SHA-256 tool.

## Worked example

Authoring text (note the Windows line endings and the repeated spaces):

```text
# Terms\r\n
\r\n
These terms apply   to everyone.\r\n
\r\n
- Be kind\r\n
- Be honest\r\n
```

Canonical bytes (one line, no trailing newline):

```text
{"attachments":[],"blocks":[{"level":1,"text":"Terms","type":"heading"},{"text":"These terms apply to everyone.","type":"paragraph"},{"items":["Be kind","Be honest"],"ordered":false,"type":"list"}],"changeSummary":null,"format":"stele-content-v1"}
```

Reproduce the hash yourself:

```shell
printf '%s' '{"attachments":[],"blocks":[{"level":1,"text":"Terms","type":"heading"},{"text":"These terms apply to everyone.","type":"paragraph"},{"items":["Be kind","Be honest"],"ordered":false,"type":"list"}],"changeSummary":null,"format":"stele-content-v1"}' | sha256sum
# 94413b9d81ddc8d24ad093b4025cd462ba1c8510813644177f76200029daeafd
```

The same applies to any published version: download its content from any mirror
(`GET /v1/public/content/<content_hash>` on the API, or the `ipfs://` CID in the version account) and
`sha256sum` it. The result must equal the `content_hash` stored on-chain.

## Verifying that bytes are canonical

A hash match proves the bytes are the committed ones. Verifiers additionally check that the bytes are
in canonical form — parse (rejecting duplicate keys), validate, re-normalize, re-serialize and compare
byte for byte — and report a non-canonical document separately from a hash mismatch. This catches a
publisher who hashed non-canonical bytes with a non-compliant tool.

## What changes the fingerprint — and what doesn't

| Change | Content hash | Version fingerprint |
|---|---|---|
| Any visible character of any block | Changes | Changes |
| The change summary | Changes | Changes |
| Line-ending style, BOM, tabs vs. spaces, repeated spaces, NFC vs. NFD | Unchanged | Unchanged |
| Title, version label or effective date | Unchanged | Changes |
| Publishing the same text as a new version | Unchanged | Changes (version number and predecessor differ) |
| Network or program | Unchanged | Changes |

## Test vectors

`spec/test-vectors/` contains language-neutral JSON vectors for text normalization, content
canonicalization (including rejection cases), version fingerprints, RFC 3339 formatting, acceptance
messages and acceptance IDs, and field validation. The Rust implementation (`crates/stele-canonical`,
`crates/stele-core`) and the TypeScript implementation (`@stele/protocol`) are both tested against
them. CI regenerates the vectors from the TypeScript implementation and fails if they differ from the
committed files, so any behavioural drift is caught in review.

To add a vector, edit `packages/protocol/scripts/generate-vectors.ts`, run `pnpm vectors`, and make sure
both `cargo test --workspace` and `pnpm --filter @stele/protocol test` pass.

## Pitfalls this design avoids

- **Rendering ambiguity.** HTML and Markdown can render identically from different sources (and
  differently from the same source). The typed model has one rendering.
- **Invisible text.** Zero-width characters and bidirectional overrides can make a clause invisible or
  reorder it on screen. They are rejected outright.
- **Homoglyphs in identity.** Organization names and titles are display strings and are never treated
  as identity; domains must be lowercase ASCII (punycode for IDNs) and are verified separately.
- **Platform differences.** Line endings, Unicode normalization and whitespace are normalized before
  hashing, so the same document hashes the same on every platform.
