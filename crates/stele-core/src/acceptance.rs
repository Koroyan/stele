//! Acceptance identifiers, the per-shard accumulator and nonce bitmap helpers
//! (PROTOCOL_SPEC.md §8).

use crate::constants::{ACCEPTANCE_ID_TAG, ACCUMULATOR_TAG, SHARD_CAPACITY};
use crate::hash::sha256v;

/// `acceptance_id = H("stele:v1:acceptance\0" || version || signer || message_hash || signature)`.
pub fn acceptance_id(
    version: &[u8; 32],
    signer: &[u8; 32],
    message_hash: &[u8; 32],
    signature: &[u8; 64],
) -> [u8; 32] {
    sha256v(&[ACCEPTANCE_ID_TAG, version, signer, message_hash, signature])
}

/// `accumulator' = H("stele:v1:accumulator\0" || accumulator || acceptance_id)`.
pub fn accumulate(accumulator: &[u8; 32], acceptance_id: &[u8; 32]) -> [u8; 32] {
    sha256v(&[ACCUMULATOR_TAG, accumulator, acceptance_id])
}

/// Byte index and bit mask for nonce `index` (least-significant bit first).
pub fn bit_position(index: u32) -> Option<(usize, u8)> {
    if index >= SHARD_CAPACITY {
        return None;
    }
    Some(((index / 8) as usize, 1u8 << (index % 8)))
}

/// Whether nonce `index` is consumed. Out-of-range indices are reported as consumed.
pub fn bitmap_is_set(bitmap: &[u8], index: u32) -> bool {
    match bit_position(index) {
        Some((byte, mask)) => bitmap.get(byte).is_none_or(|b| b & mask != 0),
        None => true,
    }
}

/// Marks nonce `index` consumed. Returns `false` if it was already set or out of range.
pub fn bitmap_try_set(bitmap: &mut [u8], index: u32) -> bool {
    let Some((byte, mask)) = bit_position(index) else {
        return false;
    };
    let Some(slot) = bitmap.get_mut(byte) else {
        return false;
    };
    if *slot & mask != 0 {
        return false;
    }
    *slot |= mask;
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::SHARD_BITMAP_BYTES;

    #[test]
    fn bitmap_semantics() {
        let mut bm = vec![0u8; SHARD_BITMAP_BYTES];
        assert!(!bitmap_is_set(&bm, 0));
        assert!(bitmap_try_set(&mut bm, 0));
        assert!(!bitmap_try_set(&mut bm, 0));
        assert_eq!(bm[0], 0b0000_0001);
        assert!(bitmap_try_set(&mut bm, 9));
        assert_eq!(bm[1], 0b0000_0010);
        assert!(bitmap_try_set(&mut bm, SHARD_CAPACITY - 1));
        assert_eq!(bm[SHARD_BITMAP_BYTES - 1], 0b1000_0000);
        assert!(!bitmap_try_set(&mut bm, SHARD_CAPACITY));
        assert!(bitmap_is_set(&bm, SHARD_CAPACITY));
    }

    #[test]
    fn accumulator_is_order_sensitive() {
        let a = [1u8; 32];
        let b = [2u8; 32];
        let zero = [0u8; 32];
        let ab = accumulate(&accumulate(&zero, &a), &b);
        let ba = accumulate(&accumulate(&zero, &b), &a);
        assert_ne!(ab, ba);
        let id1 = acceptance_id(&a, &b, &zero, &[0u8; 64]);
        let id2 = acceptance_id(&b, &a, &zero, &[0u8; 64]);
        assert_ne!(id1, id2);
    }
}
