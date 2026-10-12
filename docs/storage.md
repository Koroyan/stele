# Content storage

Solana stores each version's **commitments** (content hash and fingerprint), not its text. The text —
the canonical content bytes — lives off-chain. Its integrity never depends on where it is stored: any
copy from any source is accepted only if it hashes to the on-chain `content_hash`.

## Content addressing

- **Key:** the SHA-256 of the canonical bytes (`content_hash`, 64 hex characters).
- **Storage URI on-chain:** an IPFS CIDv1 derived from that same hash — raw codec (`0x55`),
  sha2-256 multihash — for example `ipfs://bafkrei…`. The URI is computed from the hash, so it can
  never point at different content than the fingerprint commits to.
- **Other URI schemes** accepted by the protocol: `ar://<id>` (Arweave) and `https://…`. A version
  records exactly one URI; mirrors are additional.

## Where Stele keeps content

When a publisher prepares a version, Stele canonicalizes the draft and stores the bytes, keyed by
their hash, **before** the version is published, so the text is available the moment the version
exists. Every read re-hashes the bytes; a corrupted or altered copy is treated as missing.

Content is served publicly (documents are meant to be read) at:

```
GET /v1/public/content/<content_hash>          canonical bytes (application/json; immutable cache headers)
GET /v1/public/content/<content_hash>/parsed   the same content as a parsed object
```

## Redundancy

Evidence must outlive any single server, so treat the content store as one of several copies:

1. **Receipts embed the text.** Every receipt bundle includes the full canonical content, so the party
   holding a receipt can verify it with no network access to any content store.
2. **Pin to IPFS.** The on-chain URI is a raw-block CID, so anyone can make the bytes resolvable
   through IPFS:

   ```shell
   curl -s https://stele.site/api/v1/public/content/<content_hash> > version.json
   sha256sum version.json                       # must print <content_hash>
   ipfs block put --cid-codec=raw --mhtype=sha2-256 version.json
   # prints the same bafkrei… CID as the version's storage URI
   ipfs pin add <cid>
   ```

   Stele does not pin to IPFS on your behalf; use your own node or a pinning service. Note that most
   IPFS networks limit raw blocks to about 1 MiB; larger documents should rely on the other copies.
3. **Keep your own archive.** Store the bytes somewhere you control, keyed by the content hash; any
   copy that hashes correctly is as good as the original.
4. **Verifiers try every source** they are given — embedded content, the storage URI through IPFS or
   Arweave gateways, and mirrors — and accept the first one whose hash matches. A mismatching source is
   reported, never silently used.

## Availability failures

If no source can provide the bytes, the verifier reports the content check as **inconclusive** — never
as valid. The commitments on-chain remain intact; the evidence becomes fully verifiable again as soon as
any copy of the bytes is found.

## Attachments

The content model can reference attachments (PDF, PNG, JPEG or plain text) by name, media type, size
and SHA-256; those digests are part of the canonical content and therefore covered by the fingerprint.
The current API and dashboard publish text-only documents (the attachment list is always empty). Tools
that build content objects with attachments must store each file keyed by its own hash and verify it
the same way.

## Privacy

Published documents are public and permanent: their hashes are on a public ledger and their text is
served openly. Do not publish personal data in agreement text. Drafts are private API records and
are not published until a publisher signs.
