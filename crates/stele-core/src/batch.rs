//! Merkle-batched acceptances — the `MERKLE_BATCHED` evidence mode (PROTOCOL_SPEC.md §17.9).
//!
//! Instead of one transaction per acceptance, the relayer collects acceptances it has verified
//! off-chain (an Ed25519 signature, or a native passkey's WebAuthn P-256 signature) and anchors the
//! Merkle root of their acceptance IDs in one transaction. What changes, and what does not:
//!
//! * the user's signature is verified by every verifier off-chain, not by the Solana runtime;
//! * the chain proves that the acceptance existed no later than the batch's slot;
//! * replay protection is off-chain: a nonce is never consumed on-chain in this mode. Recording the
//!   same signed acceptance twice yields the same acceptance ID (an acceptance is idempotent);
//! * the relayer cannot forge leaves (each needs the user's signature) but can omit them, as it can
//!   refuse to relay in direct mode.
//!
//! Tree: leaves `H(LEAF_TAG ‖ protocol ‖ acceptance_id)`, nodes `H(NODE_TAG ‖ left ‖ right)`; at each
//! level an unpaired last node is promoted unchanged (never duplicated), and the leaf count is
//! anchored with the root, so every (index, count) has exactly one path shape.

use crate::hash::sha256v;

pub const BATCH_LEAF_TAG: &[u8] = b"stele:v2:batch-leaf\0";
pub const BATCH_NODE_TAG: &[u8] = b"stele:v2:batch-node\0";
pub const BATCH_ID_TAG: &[u8] = b"stele:v2:batch\0";
/// Upper bound on leaves per anchored batch (proofs stay ≤ 16 hashes).
pub const MAX_BATCH_LEAVES: u32 = 65_536;
/// A batched stele/1 acceptance (Ed25519 over `stele-acceptance-v1`).
pub const LEAF_PROTOCOL_STELE_1: u8 = 1;
/// A batched stele/2 acceptance (native passkey over `stele-acceptance-v2`).
pub const LEAF_PROTOCOL_STELE_2: u8 = 2;

pub fn leaf_hash(protocol: u8, acceptance_id: &[u8; 32]) -> [u8; 32] {
    sha256v(&[BATCH_LEAF_TAG, &[protocol], acceptance_id])
}

pub fn node_hash(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    sha256v(&[BATCH_NODE_TAG, left, right])
}

/// The anchored batch's identifier, folded into the shard accumulator:
/// `H(BATCH_ID_TAG ‖ organization ‖ nonce_shard ‖ root ‖ leaf_count (u32 LE) ‖ sequence (u64 LE))`,
/// where `sequence` is the shard's recorded count before this batch.
pub fn batch_id(
    organization: &[u8; 32],
    nonce_shard: &[u8; 32],
    root: &[u8; 32],
    leaf_count: u32,
    sequence: u64,
) -> [u8; 32] {
    sha256v(&[
        BATCH_ID_TAG,
        organization,
        nonce_shard,
        root,
        &leaf_count.to_le_bytes(),
        &sequence.to_le_bytes(),
    ])
}

fn next_level(level: &[[u8; 32]]) -> Vec<[u8; 32]> {
    level
        .chunks(2)
        .map(|pair| match pair {
            [l, r] => node_hash(l, r),
            [single] => *single,
            _ => unreachable!(),
        })
        .collect()
}

/// The root of `leaves` (already leaf-hashed); `None` for an empty batch or one over the limit.
pub fn merkle_root(leaves: &[[u8; 32]]) -> Option<[u8; 32]> {
    if leaves.is_empty() || leaves.len() > MAX_BATCH_LEAVES as usize {
        return None;
    }
    let mut level = leaves.to_vec();
    while level.len() > 1 {
        level = next_level(&level);
    }
    Some(level[0])
}

/// Sibling hashes from leaf `index` up to the root (levels where the node is promoted add none).
pub fn merkle_proof(leaves: &[[u8; 32]], index: usize) -> Option<Vec<[u8; 32]>> {
    if index >= leaves.len() || leaves.len() > MAX_BATCH_LEAVES as usize {
        return None;
    }
    let mut proof = Vec::new();
    let mut level = leaves.to_vec();
    let mut i = index;
    while level.len() > 1 {
        let sibling = i ^ 1;
        if sibling < level.len() {
            proof.push(level[sibling]);
        }
        level = next_level(&level);
        i /= 2;
    }
    Some(proof)
}

/// Whether `leaf` sits at `index` of a `leaf_count`-leaf tree with root `root`. The proof must have
/// exactly the expected number of siblings (no more, no fewer).
pub fn verify_proof(
    leaf: &[u8; 32],
    index: u32,
    leaf_count: u32,
    proof: &[[u8; 32]],
    root: &[u8; 32],
) -> bool {
    if leaf_count == 0 || leaf_count > MAX_BATCH_LEAVES || index >= leaf_count {
        return false;
    }
    let mut hash = *leaf;
    let mut i = index;
    let mut size = leaf_count;
    let mut used = 0usize;
    while size > 1 {
        let sibling = i ^ 1;
        if sibling < size {
            let Some(s) = proof.get(used) else {
                return false;
            };
            hash = if i.is_multiple_of(2) {
                node_hash(&hash, s)
            } else {
                node_hash(s, &hash)
            };
            used += 1;
        }
        i /= 2;
        size = size.div_ceil(2);
    }
    used == proof.len() && &hash == root
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaves(n: usize) -> Vec<[u8; 32]> {
        (0..n)
            .map(|i| leaf_hash(LEAF_PROTOCOL_STELE_2, &[i as u8; 32]))
            .collect()
    }

    #[test]
    fn every_leaf_proves_for_every_size() {
        for n in 1..=33 {
            let l = leaves(n);
            let root = merkle_root(&l).unwrap();
            for (i, leaf) in l.iter().enumerate() {
                let proof = merkle_proof(&l, i).unwrap();
                assert!(
                    verify_proof(leaf, i as u32, n as u32, &proof, &root),
                    "n={n} i={i}"
                );
                // Wrong index, wrong count, extra or missing siblings, other root: rejected.
                if n > 1 {
                    assert!(!verify_proof(
                        leaf,
                        ((i + 1) % n) as u32,
                        n as u32,
                        &proof,
                        &root
                    ));
                }
                // A leaf that is not in the tree never verifies at the anchored count.
                let outsider = leaf_hash(LEAF_PROTOCOL_STELE_1, &[i as u8; 32]);
                assert!(!verify_proof(&outsider, i as u32, n as u32, &proof, &root));
                let mut longer = proof.clone();
                longer.push([0u8; 32]);
                assert!(!verify_proof(leaf, i as u32, n as u32, &longer, &root));
                if !proof.is_empty() {
                    assert!(!verify_proof(
                        leaf,
                        i as u32,
                        n as u32,
                        &proof[..proof.len() - 1],
                        &root
                    ));
                }
            }
        }
    }

    #[test]
    fn leaves_and_nodes_are_domain_separated() {
        let l = leaves(4);
        let root = merkle_root(&l).unwrap();
        // An inner node is not a leaf of the anchored tree: with the anchored count (4) it has no
        // valid position, whatever proof is offered.
        let inner = node_hash(&l[0], &l[1]);
        for i in 0..4 {
            assert!(!verify_proof(
                &inner,
                i,
                4,
                &[node_hash(&l[2], &l[3])],
                &root
            ));
        }
        assert_ne!(BATCH_LEAF_TAG, BATCH_NODE_TAG);
        assert_ne!(
            leaf_hash(LEAF_PROTOCOL_STELE_1, &[1; 32]),
            leaf_hash(LEAF_PROTOCOL_STELE_2, &[1; 32])
        );
        assert_ne!(node_hash(&l[0], &l[1]), node_hash(&l[1], &l[0]));
        assert!(merkle_root(&[]).is_none());
    }
}
