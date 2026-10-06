/**
 * Merkle-batched acceptances — the `MERKLE_BATCHED` evidence mode (PROTOCOL_SPEC.md §17.9).
 * Mirrors `crates/stele-core/src/batch.rs` byte for byte.
 *
 * The program anchors only a root and a leaf count; it verifies no user signature in this mode.
 * Every verifier checks each batched acceptance off-chain (signature, WebAuthn binding, message vs
 * chain data) and its Merkle path to the anchored root, at the anchored leaf count.
 */
import { getAddressEncoder, type Address } from "@solana/kit";
import { utf8 } from "./encoding";
import { ProtocolError } from "./errors";
import { sha256v } from "./hash";

export const BATCH_LEAF_TAG = utf8("stele:v2:batch-leaf\u0000");
export const BATCH_NODE_TAG = utf8("stele:v2:batch-node\u0000");
export const BATCH_ID_TAG = utf8("stele:v2:batch\u0000");
export const MAX_BATCH_LEAVES = 65_536;
export const LEAF_PROTOCOL_STELE_1 = 1;
export const LEAF_PROTOCOL_STELE_2 = 2;

export type EvidenceMode = "DIRECT_ONCHAIN" | "MERKLE_BATCHED";

export function batchLeafHash(protocol: 1 | 2, acceptanceId: Uint8Array): Uint8Array {
  if (acceptanceId.length !== 32)
    throw new ProtocolError("INVALID_FORMAT", "acceptance ids are 32 bytes");
  return sha256v(BATCH_LEAF_TAG, Uint8Array.of(protocol), acceptanceId);
}

export function batchNodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256v(BATCH_NODE_TAG, left, right);
}

const u32le = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};
const u64le = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
};

/** The anchored batch's identifier (folded into the shard accumulator). */
export function batchId(
  organization: Address,
  nonceShard: Address,
  root: Uint8Array,
  leafCount: number,
  sequence: bigint,
): Uint8Array {
  const enc = getAddressEncoder();
  return sha256v(
    BATCH_ID_TAG,
    new Uint8Array(enc.encode(organization)),
    new Uint8Array(enc.encode(nonceShard)),
    root,
    u32le(leafCount),
    u64le(sequence),
  );
}

function nextLevel(level: Uint8Array[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < level.length; i += 2)
    out.push(i + 1 < level.length ? batchNodeHash(level[i]!, level[i + 1]!) : level[i]!);
  return out;
}

/** Root over leaf hashes (an unpaired node is promoted, never duplicated). */
export function merkleRoot(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0 || leaves.length > MAX_BATCH_LEAVES)
    throw new ProtocolError("INVALID_FORMAT", "a batch has 1 to 65,536 leaves");
  let level = leaves;
  while (level.length > 1) level = nextLevel(level);
  return level[0]!;
}

/** Sibling hashes from leaf `index` to the root. */
export function merkleProof(leaves: Uint8Array[], index: number): Uint8Array[] {
  if (index < 0 || index >= leaves.length || leaves.length > MAX_BATCH_LEAVES)
    throw new ProtocolError("INVALID_FORMAT", "leaf index out of range");
  const proof: Uint8Array[] = [];
  let level = leaves;
  let i = index;
  while (level.length > 1) {
    const sibling = i ^ 1;
    if (sibling < level.length) proof.push(level[sibling]!);
    level = nextLevel(level);
    i = Math.floor(i / 2);
  }
  return proof;
}

/**
 * Whether `leaf` sits at `index` of a `leafCount`-leaf tree with `root`. Only meaningful with the
 * ANCHORED leaf count (read it from the chain, never from a receipt alone).
 */
export function verifyMerkleProof(
  leaf: Uint8Array,
  index: number,
  leafCount: number,
  proof: Uint8Array[],
  root: Uint8Array,
): boolean {
  if (leafCount < 1 || leafCount > MAX_BATCH_LEAVES || index < 0 || index >= leafCount)
    return false;
  let hash = leaf;
  let i = index;
  let size = leafCount;
  let used = 0;
  while (size > 1) {
    const sibling = i ^ 1;
    if (sibling < size) {
      const s = proof[used];
      if (!s) return false;
      hash = i % 2 === 0 ? batchNodeHash(hash, s) : batchNodeHash(s, hash);
      used++;
    }
    i = Math.floor(i / 2);
    size = Math.ceil(size / 2);
  }
  if (used !== proof.length || hash.length !== root.length) return false;
  return hash.every((b, k) => b === root[k]);
}
