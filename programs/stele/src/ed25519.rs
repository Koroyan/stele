//! Instruction introspection for the native Ed25519 precompile (PROTOCOL_SPEC.md §8 steps 4–6).
//!
//! The runtime verifies an Ed25519 instruction before the transaction executes; if verification
//! fails the transaction fails. This module proves that the verified signature is *the one we are
//! about to rely on*, defeating the known pitfalls of precompile introspection:
//!
//! * spoofed sysvar accounts — `load_*_checked` require the real instructions sysvar ID;
//! * CPI invocation — we require stack height 1 and that the current top-level instruction is ours;
//! * indirection — offsets pointing into *other* instructions (`*_instruction_index != u16::MAX`)
//!   would let the precompile verify bytes different from those we read; we require the canonical
//!   self-contained layout and read pubkey/signature/message from the same instruction;
//! * ambiguity — exactly one signature, exact data length, no accounts.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::get_stack_height;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

use crate::constants::{
    ED25519_MESSAGE_OFFSET, ED25519_PUBKEY_OFFSET, ED25519_SELF_INDEX, ED25519_SIGNATURE_OFFSET,
    TRANSACTION_LEVEL_STACK_HEIGHT,
};
use crate::error::SteleError;

/// A signature the runtime has verified, together with the exact bytes it covers.
pub struct VerifiedSignature {
    pub signer: [u8; 32],
    pub signature: [u8; 64],
    pub message: Vec<u8>,
}

fn read_u16(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([data[offset], data[offset + 1]])
}

/// Parses canonical single-signature Ed25519 instruction data. Pure function (unit-tested natively).
pub fn parse_canonical_ed25519_data(data: &[u8]) -> Result<VerifiedSignature> {
    let header = usize::from(ED25519_MESSAGE_OFFSET);
    require!(data.len() > header, SteleError::InvalidEd25519Instruction);
    // num_signatures (u8) == 1, padding byte == 0.
    require!(
        data[0] == 1 && data[1] == 0,
        SteleError::InvalidEd25519Instruction
    );

    let signature_offset = read_u16(data, 2);
    let signature_ix = read_u16(data, 4);
    let pubkey_offset = read_u16(data, 6);
    let pubkey_ix = read_u16(data, 8);
    let message_offset = read_u16(data, 10);
    let message_size = read_u16(data, 12);
    let message_ix = read_u16(data, 14);

    require!(
        signature_offset == ED25519_SIGNATURE_OFFSET
            && pubkey_offset == ED25519_PUBKEY_OFFSET
            && message_offset == ED25519_MESSAGE_OFFSET,
        SteleError::InvalidEd25519Instruction
    );
    require!(
        signature_ix == ED25519_SELF_INDEX
            && pubkey_ix == ED25519_SELF_INDEX
            && message_ix == ED25519_SELF_INDEX,
        SteleError::InvalidEd25519Instruction
    );
    require!(
        data.len() == header + usize::from(message_size),
        SteleError::InvalidEd25519Instruction
    );

    let mut signer = [0u8; 32];
    signer.copy_from_slice(&data[16..48]);
    let mut signature = [0u8; 64];
    signature.copy_from_slice(&data[48..112]);
    Ok(VerifiedSignature {
        signer,
        signature,
        message: data[header..].to_vec(),
    })
}

/// Loads the Ed25519 verification that immediately precedes the current top-level instruction.
pub fn load_preceding_ed25519(instructions_sysvar: &AccountInfo) -> Result<VerifiedSignature> {
    require!(
        get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT,
        SteleError::CpiNotAllowed
    );
    let current = usize::from(load_current_index_checked(instructions_sysvar)?);
    let this_ix = load_instruction_at_checked(current, instructions_sysvar)?;
    require_keys_eq!(this_ix.program_id, crate::ID, SteleError::CpiNotAllowed);

    require!(current > 0, SteleError::MissingEd25519Instruction);
    let ix = load_instruction_at_checked(current - 1, instructions_sysvar)?;
    require_keys_eq!(
        ix.program_id,
        solana_sdk_ids::ed25519_program::ID,
        SteleError::MissingEd25519Instruction
    );
    require!(
        ix.accounts.is_empty(),
        SteleError::InvalidEd25519Instruction
    );
    parse_canonical_ed25519_data(&ix.data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canonical(message: &[u8]) -> Vec<u8> {
        let mut d = vec![1u8, 0];
        for v in [
            48u16,
            u16::MAX,
            16,
            u16::MAX,
            112,
            message.len() as u16,
            u16::MAX,
        ] {
            d.extend_from_slice(&v.to_le_bytes());
        }
        d.extend_from_slice(&[7u8; 32]); // pubkey
        d.extend_from_slice(&[9u8; 64]); // signature
        d.extend_from_slice(message);
        d
    }

    #[test]
    fn accepts_canonical_layout() {
        let parsed = parse_canonical_ed25519_data(&canonical(b"hello")).unwrap();
        assert_eq!(parsed.signer, [7u8; 32]);
        assert_eq!(parsed.signature, [9u8; 64]);
        assert_eq!(parsed.message, b"hello");
    }

    #[test]
    fn rejects_indirection_and_ambiguity() {
        // Message borrowed from another instruction.
        let mut d = canonical(b"hello");
        d[14..16].copy_from_slice(&2u16.to_le_bytes());
        assert!(parse_canonical_ed25519_data(&d).is_err());
        // Two signatures.
        let mut d = canonical(b"hello");
        d[0] = 2;
        assert!(parse_canonical_ed25519_data(&d).is_err());
        // Non-canonical offsets.
        let mut d = canonical(b"hello");
        d[10..12].copy_from_slice(&113u16.to_le_bytes());
        assert!(parse_canonical_ed25519_data(&d).is_err());
        // Trailing bytes beyond the declared message.
        let mut d = canonical(b"hello");
        d.push(0);
        assert!(parse_canonical_ed25519_data(&d).is_err());
        // Truncated.
        assert!(parse_canonical_ed25519_data(&canonical(b"hello")[..100]).is_err());
    }
}
