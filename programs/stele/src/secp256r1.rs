//! Instruction introspection for the native secp256r1 (P-256) precompile (SIMD-0075;
//! PROTOCOL_SPEC.md §17.3).
//!
//! The runtime verifies a secp256r1 instruction before the transaction executes (SHA-256 of the
//! message, low-S signature, compressed public key on the curve); if verification fails, the
//! transaction fails. This module proves that the verified signature is *the one we rely on*, with
//! the same defences as the Ed25519 path (`ed25519.rs`):
//!
//! * spoofed sysvar — `load_*_checked` require the real instructions sysvar;
//! * CPI — stack height 1, and the current top-level instruction must be this program's;
//! * position — the precompile must *immediately* precede the current instruction;
//! * indirection — every offset must point into the precompile's own data
//!   (`*_instruction_index == u16::MAX`), at the canonical positions, so the bytes we read are the
//!   bytes the runtime verified;
//! * ambiguity — exactly one signature, zero padding byte, exact data length, no accounts.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::get_stack_height;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};
use stele_core::passkey::{P256_PUBLIC_KEY_LEN, P256_SIGNATURE_LEN};

use crate::constants::{
    SECP256R1_MESSAGE_OFFSET, SECP256R1_PUBKEY_OFFSET, SECP256R1_SELF_INDEX,
    SECP256R1_SIGNATURE_OFFSET, TRANSACTION_LEVEL_STACK_HEIGHT,
};
use crate::error::SteleError;

/// A P-256 signature the runtime has verified, with the exact bytes it covers.
pub struct VerifiedP256 {
    pub public_key: [u8; P256_PUBLIC_KEY_LEN],
    pub signature: [u8; P256_SIGNATURE_LEN],
    /// For WebAuthn: `authenticatorData ‖ SHA-256(clientDataJSON)`.
    pub message: Vec<u8>,
}

fn read_u16(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([data[offset], data[offset + 1]])
}

/// Parses canonical single-signature secp256r1 instruction data. Pure (unit-tested natively).
pub fn parse_canonical_secp256r1_data(data: &[u8]) -> Result<VerifiedP256> {
    let header = usize::from(SECP256R1_MESSAGE_OFFSET);
    require!(data.len() > header, SteleError::InvalidSecp256r1Instruction);
    require!(
        data[0] == 1 && data[1] == 0,
        SteleError::InvalidSecp256r1Instruction
    );

    let signature_offset = read_u16(data, 2);
    let signature_ix = read_u16(data, 4);
    let pubkey_offset = read_u16(data, 6);
    let pubkey_ix = read_u16(data, 8);
    let message_offset = read_u16(data, 10);
    let message_size = read_u16(data, 12);
    let message_ix = read_u16(data, 14);

    require!(
        signature_offset == SECP256R1_SIGNATURE_OFFSET
            && pubkey_offset == SECP256R1_PUBKEY_OFFSET
            && message_offset == SECP256R1_MESSAGE_OFFSET,
        SteleError::InvalidSecp256r1Instruction
    );
    require!(
        signature_ix == SECP256R1_SELF_INDEX
            && pubkey_ix == SECP256R1_SELF_INDEX
            && message_ix == SECP256R1_SELF_INDEX,
        SteleError::InvalidSecp256r1Instruction
    );
    require!(
        data.len() == header + usize::from(message_size),
        SteleError::InvalidSecp256r1Instruction
    );

    let pk_start = usize::from(SECP256R1_PUBKEY_OFFSET);
    let sig_start = usize::from(SECP256R1_SIGNATURE_OFFSET);
    let mut public_key = [0u8; P256_PUBLIC_KEY_LEN];
    public_key.copy_from_slice(&data[pk_start..pk_start + P256_PUBLIC_KEY_LEN]);
    let mut signature = [0u8; P256_SIGNATURE_LEN];
    signature.copy_from_slice(&data[sig_start..sig_start + P256_SIGNATURE_LEN]);
    Ok(VerifiedP256 {
        public_key,
        signature,
        message: data[header..].to_vec(),
    })
}

/// Loads the secp256r1 verification that immediately precedes the current top-level instruction.
pub fn load_preceding_secp256r1(instructions_sysvar: &AccountInfo) -> Result<VerifiedP256> {
    require!(
        get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT,
        SteleError::CpiNotAllowed
    );
    let current = usize::from(load_current_index_checked(instructions_sysvar)?);
    let this_ix = load_instruction_at_checked(current, instructions_sysvar)?;
    require_keys_eq!(this_ix.program_id, crate::ID, SteleError::CpiNotAllowed);

    require!(current > 0, SteleError::MissingSecp256r1Instruction);
    let ix = load_instruction_at_checked(current - 1, instructions_sysvar)?;
    require_keys_eq!(
        ix.program_id,
        solana_sdk_ids::secp256r1_program::ID,
        SteleError::MissingSecp256r1Instruction
    );
    require!(
        ix.accounts.is_empty(),
        SteleError::InvalidSecp256r1Instruction
    );
    parse_canonical_secp256r1_data(&ix.data)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The layout `solana_secp256r1_program::new_secp256r1_instruction_with_signature` produces.
    fn canonical(message: &[u8]) -> Vec<u8> {
        let mut d = vec![1u8, 0];
        for v in [
            49u16,
            u16::MAX,
            16,
            u16::MAX,
            113,
            message.len() as u16,
            u16::MAX,
        ] {
            d.extend_from_slice(&v.to_le_bytes());
        }
        let mut pk = [7u8; 33];
        pk[0] = 2;
        d.extend_from_slice(&pk);
        d.extend_from_slice(&[9u8; 64]);
        d.extend_from_slice(message);
        d
    }

    #[test]
    fn accepts_canonical_layout() {
        let parsed = parse_canonical_secp256r1_data(&canonical(b"hello")).unwrap();
        assert_eq!(parsed.public_key[0], 2);
        assert_eq!(parsed.public_key[1..], [7u8; 32]);
        assert_eq!(parsed.signature, [9u8; 64]);
        assert_eq!(parsed.message, b"hello");
    }

    #[test]
    fn rejects_indirection_and_ambiguity() {
        // Each field borrowed from another instruction.
        for field in [4usize, 8, 14] {
            let mut d = canonical(b"hello");
            d[field..field + 2].copy_from_slice(&0u16.to_le_bytes());
            assert!(
                parse_canonical_secp256r1_data(&d).is_err(),
                "index at {field}"
            );
        }
        // Two signatures; non-zero padding.
        let mut d = canonical(b"hello");
        d[0] = 2;
        assert!(parse_canonical_secp256r1_data(&d).is_err());
        let mut d = canonical(b"hello");
        d[1] = 1;
        assert!(parse_canonical_secp256r1_data(&d).is_err());
        // Shifted offsets (a different pubkey/signature/message than the one we would read).
        for (field, value) in [(2usize, 50u16), (6, 17), (10, 114)] {
            let mut d = canonical(b"hello");
            d[field..field + 2].copy_from_slice(&value.to_le_bytes());
            assert!(
                parse_canonical_secp256r1_data(&d).is_err(),
                "offset at {field}"
            );
        }
        // Trailing bytes; declared size shorter than the data; truncation.
        let mut d = canonical(b"hello");
        d.push(0);
        assert!(parse_canonical_secp256r1_data(&d).is_err());
        let mut d = canonical(b"hello");
        d[12..14].copy_from_slice(&4u16.to_le_bytes());
        assert!(parse_canonical_secp256r1_data(&d).is_err());
        assert!(parse_canonical_secp256r1_data(&canonical(b"hello")[..100]).is_err());
        assert!(parse_canonical_secp256r1_data(&[]).is_err());
    }
}
