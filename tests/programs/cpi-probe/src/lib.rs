//! Test fixture: forwards its instruction data to another program through a CPI.
//!
//! Accounts: `[target program, ...accounts]`; the accounts after the target are passed through with
//! their signer and writable flags. The program tests use it to prove that `record_acceptance`
//! refuses to run inside a CPI (PROTOCOL_SPEC.md §8), where instruction introspection would describe
//! the caller's instruction instead of Stele's. It lives outside `programs/` so that it is never
//! built or deployed as part of the protocol.

use anchor_lang::solana_program::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction},
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};

#[cfg(not(feature = "no-entrypoint"))]
anchor_lang::solana_program::entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> Result<(), ProgramError> {
    let (target, forwarded) = accounts
        .split_first()
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    let metas = forwarded
        .iter()
        .map(|account| AccountMeta {
            pubkey: *account.key,
            is_signer: account.is_signer,
            is_writable: account.is_writable,
        })
        .collect();
    let instruction = Instruction {
        program_id: *target.key,
        accounts: metas,
        data: data.to_vec(),
    };
    invoke(&instruction, accounts)
}
