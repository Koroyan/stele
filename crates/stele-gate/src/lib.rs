//! # Stele Gate for Solana programs
//!
//! Require that the signer of a protected action has accepted a Stele policy document — by default
//! its **current** version — before the action executes (PROTOCOL_SPEC.md §18).
//!
//! A frontend checkbox can be skipped by any custom client. A requirement evaluated by the program
//! that executes the action cannot. Two integration modes enforce the same rule:
//!
//! * **Check mode** — [`verify_access`]: the protected program reads the Stele `Document` and
//!   `AccessPass` accounts itself (owner, type and field checks; no CPI).
//! * **Strict mode** — [`require_access_cpi`]: the protected program calls Stele's `check_access`
//!   instruction through a CPI, so the rule is evaluated by the Stele program itself.
//!
//! In both modes the protected program must pin the policy document's address (a constant or a
//! value in its own state). Stele cannot know which document a third-party action requires; if a
//! program accepted any document, a caller could present a document it published itself.
//!
//! ```ignore
//! use stele_gate::{verify_access, Requirement};
//!
//! let granted = verify_access(
//!     &market.policy_document,          // pinned by the protected program
//!     &ctx.accounts.policy_document,
//!     &ctx.accounts.access_pass,
//!     &ctx.accounts.bettor,             // must be a signer
//!     Requirement::CurrentVersion,
//! )?;
//! ```
//!
//! Errors are `ProgramError::Custom` codes 7600–7608 ([`GateError`]).

use anchor_lang::solana_program::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction},
    program::{get_return_data, invoke},
    program_error::ProgramError,
    pubkey::Pubkey,
};

/// The Stele program (the same address on localnet and devnet).
pub const STELE_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    87, 55, 61, 197, 197, 98, 47, 235, 126, 82, 9, 191, 132, 109, 76, 103, 180, 177, 243, 81, 82,
    188, 211, 224, 243, 73, 142, 97, 133, 67, 181, 204,
]);

/// Seed of an access pass: `[ACCESS_PASS_SEED, document, holder]` under [`STELE_PROGRAM_ID`].
pub const ACCESS_PASS_SEED: &[u8] = b"access-pass";

/// Anchor discriminators of the Stele accounts and instruction read here.
pub const ACCESS_PASS_DISCRIMINATOR: [u8; 8] = [24, 47, 32, 42, 150, 120, 87, 169];
pub const DOCUMENT_DISCRIMINATOR: [u8; 8] = [226, 212, 133, 177, 48, 5, 171, 243];
pub const CHECK_ACCESS_DISCRIMINATOR: [u8; 8] = [74, 62, 42, 188, 96, 229, 63, 50];

/// Byte length of an `AccessPass` account (discriminator included).
pub const ACCESS_PASS_LEN: usize = 201;

// Normative layouts (PROTOCOL_SPEC.md §6.2 and §18.1); offsets include the discriminator.
mod layout {
    pub const PASS_DOCUMENT: usize = 40;
    pub const PASS_HOLDER: usize = 72;
    pub const PASS_VERSION: usize = 104;
    pub const PASS_ACCEPTED_AT: usize = 168;
    pub const PASS_VERSION_NUMBER: usize = 192;
    pub const DOCUMENT_CURRENT_VERSION: usize = 104;
    pub const DOCUMENT_VERSION_COUNT: usize = 152;
    pub const DOCUMENT_MIN_LEN: usize = 156;
}

/// What the holder must have accepted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Requirement {
    /// The document's current version: publishing a new version makes older passes outdated.
    CurrentVersion,
    /// Version `n` or any later one (`n >= 1`).
    AtLeast(u32),
}

impl Requirement {
    /// The `min_version` argument of Stele's `check_access` (`0` = current version).
    pub fn min_version(self) -> u32 {
        match self {
            Requirement::CurrentVersion => 0,
            Requirement::AtLeast(n) => n,
        }
    }
}

/// The acceptance that satisfied the requirement.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GrantedAccess {
    /// The accepted `DocumentVersion` account.
    pub version: Pubkey,
    pub version_number: u32,
}

/// Gate failures, returned as `ProgramError::Custom(code)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum GateError {
    /// The document account is not the policy document the program requires.
    PolicyMismatch = 7600,
    /// The document account is not a Stele `Document`.
    InvalidDocument = 7601,
    /// The holder did not sign the transaction.
    HolderNotSigner = 7602,
    /// The holder has never accepted this policy (no access pass).
    AccessPassMissing = 7603,
    /// The account is not a Stele `AccessPass`.
    AccessPassInvalid = 7604,
    /// The pass belongs to another document or holder.
    AccessPassMismatch = 7605,
    /// The pass names an older version than the requirement.
    AccessPassOutdated = 7606,
    /// The requirement names a version the document does not have.
    InvalidRequirement = 7607,
    /// The program account passed for Stele is not the Stele program.
    InvalidSteleProgram = 7608,
}

impl From<GateError> for ProgramError {
    fn from(e: GateError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

/// The access-pass address of `holder` for `document`.
pub fn access_pass_address(document: &Pubkey, holder: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[ACCESS_PASS_SEED, document.as_ref(), holder.as_ref()],
        &STELE_PROGRAM_ID,
    )
}

fn read_pubkey(data: &[u8], at: usize) -> Pubkey {
    let mut b = [0u8; 32];
    b.copy_from_slice(&data[at..at + 32]);
    Pubkey::new_from_array(b)
}

fn read_u32(data: &[u8], at: usize) -> u32 {
    let mut b = [0u8; 4];
    b.copy_from_slice(&data[at..at + 4]);
    u32::from_le_bytes(b)
}

/// Check mode: succeeds only if `holder` signed and holds an access pass for `policy_document`
/// that satisfies `requirement`.
///
/// Only the Stele program can create accounts it owns, and it writes the `AccessPass` type only
/// after verifying the holder's signed acceptance; the owner and discriminator checks below are
/// therefore what makes the pass's contents trustworthy.
pub fn verify_access(
    policy_document: &Pubkey,
    document: &AccountInfo,
    access_pass: &AccountInfo,
    holder: &AccountInfo,
    requirement: Requirement,
) -> Result<GrantedAccess, ProgramError> {
    if document.key != policy_document {
        return Err(GateError::PolicyMismatch.into());
    }
    if !holder.is_signer {
        return Err(GateError::HolderNotSigner.into());
    }

    let doc = document.try_borrow_data()?;
    if *document.owner != STELE_PROGRAM_ID
        || doc.len() < layout::DOCUMENT_MIN_LEN
        || doc[..8] != DOCUMENT_DISCRIMINATOR
    {
        return Err(GateError::InvalidDocument.into());
    }

    let pass = access_pass.try_borrow_data()?;
    if pass.is_empty() && access_pass.lamports() == 0 {
        return Err(GateError::AccessPassMissing.into());
    }
    if *access_pass.owner != STELE_PROGRAM_ID {
        // An uninitialized pass address (pre-funded or not) is owned by the system program.
        let (expected, _) = access_pass_address(document.key, holder.key);
        return Err(if *access_pass.key == expected {
            GateError::AccessPassMissing
        } else {
            GateError::AccessPassInvalid
        }
        .into());
    }
    if pass.len() < ACCESS_PASS_LEN || pass[..8] != ACCESS_PASS_DISCRIMINATOR {
        return Err(GateError::AccessPassInvalid.into());
    }
    if read_pubkey(&pass, layout::PASS_DOCUMENT) != *document.key
        || read_pubkey(&pass, layout::PASS_HOLDER) != *holder.key
    {
        return Err(GateError::AccessPassMismatch.into());
    }

    let version = read_pubkey(&pass, layout::PASS_VERSION);
    let version_number = read_u32(&pass, layout::PASS_VERSION_NUMBER);
    match requirement {
        Requirement::CurrentVersion => {
            if version != read_pubkey(&doc, layout::DOCUMENT_CURRENT_VERSION) {
                return Err(GateError::AccessPassOutdated.into());
            }
        }
        Requirement::AtLeast(n) => {
            if n == 0 || n > read_u32(&doc, layout::DOCUMENT_VERSION_COUNT) {
                return Err(GateError::InvalidRequirement.into());
            }
            if version_number < n {
                return Err(GateError::AccessPassOutdated.into());
            }
        }
    }
    Ok(GrantedAccess {
        version,
        version_number,
    })
}

/// When the holder last accepted (Unix seconds), read from a pass already checked by
/// [`verify_access`].
pub fn accepted_at(access_pass: &AccountInfo) -> Result<i64, ProgramError> {
    let pass = access_pass.try_borrow_data()?;
    if pass.len() < ACCESS_PASS_LEN || pass[..8] != ACCESS_PASS_DISCRIMINATOR {
        return Err(GateError::AccessPassInvalid.into());
    }
    let mut b = [0u8; 8];
    b.copy_from_slice(&pass[layout::PASS_ACCEPTED_AT..layout::PASS_ACCEPTED_AT + 8]);
    Ok(i64::from_le_bytes(b))
}

/// Stele's `check_access` instruction for a CPI.
pub fn check_access_instruction(
    document: &Pubkey,
    access_pass: &Pubkey,
    holder: &Pubkey,
    requirement: Requirement,
) -> Instruction {
    let mut data = Vec::with_capacity(12);
    data.extend_from_slice(&CHECK_ACCESS_DISCRIMINATOR);
    data.extend_from_slice(&requirement.min_version().to_le_bytes());
    Instruction {
        program_id: STELE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*document, false),
            AccountMeta::new_readonly(*access_pass, false),
            AccountMeta::new_readonly(*holder, true),
        ],
        data,
    }
}

/// Strict mode: the Stele program evaluates the requirement through a CPI. Fails with Stele's own
/// error (`AccessPassMissing`, `AccessPassOutdated`, …) when the requirement is not met.
pub fn require_access_cpi<'info>(
    stele_program: &AccountInfo<'info>,
    policy_document: &Pubkey,
    document: &AccountInfo<'info>,
    access_pass: &AccountInfo<'info>,
    holder: &AccountInfo<'info>,
    requirement: Requirement,
) -> Result<GrantedAccess, ProgramError> {
    if *stele_program.key != STELE_PROGRAM_ID {
        return Err(GateError::InvalidSteleProgram.into());
    }
    if document.key != policy_document {
        return Err(GateError::PolicyMismatch.into());
    }
    if !holder.is_signer {
        return Err(GateError::HolderNotSigner.into());
    }
    let ix = check_access_instruction(document.key, access_pass.key, holder.key, requirement);
    invoke(
        &ix,
        &[
            document.clone(),
            access_pass.clone(),
            holder.clone(),
            stele_program.clone(),
        ],
    )?;
    match get_return_data() {
        Some((program, data)) if program == STELE_PROGRAM_ID && data.len() == 36 => {
            Ok(GrantedAccess {
                version: read_pubkey(&data, 0),
                version_number: read_u32(&data, 32),
            })
        }
        _ => Err(GateError::InvalidSteleProgram.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::{Discriminator, Space};

    #[test]
    fn constants_match_the_stele_program() {
        assert_eq!(STELE_PROGRAM_ID, stele::ID);
        assert_eq!(
            ACCESS_PASS_DISCRIMINATOR,
            stele::state::AccessPass::DISCRIMINATOR
        );
        assert_eq!(
            DOCUMENT_DISCRIMINATOR,
            stele::state::Document::DISCRIMINATOR
        );
        assert_eq!(
            CHECK_ACCESS_DISCRIMINATOR,
            <stele::instruction::CheckAccess as Discriminator>::DISCRIMINATOR
        );
        assert_eq!(ACCESS_PASS_LEN, 8 + stele::state::AccessPass::INIT_SPACE);
        assert_eq!(ACCESS_PASS_SEED, stele::constants::ACCESS_PASS_SEED);
    }

    #[test]
    fn layout_offsets_match_the_serialized_accounts() {
        use anchor_lang::prelude::Pubkey as P;
        use anchor_lang::AccountSerialize;
        let pass = stele::state::AccessPass {
            organization: P::new_from_array([1; 32]),
            document: P::new_from_array([2; 32]),
            holder: P::new_from_array([3; 32]),
            version: P::new_from_array([4; 32]),
            acceptance_id: [5; 32],
            accepted_at: 0x0102_0304_0506_0708,
            first_accepted_at: 9,
            accepted_slot: 10,
            version_number: 0x0a0b_0c0d,
            acceptance_count: 1,
            bump: 254,
        };
        let mut data = Vec::new();
        pass.try_serialize(&mut data).unwrap();
        assert_eq!(data.len(), ACCESS_PASS_LEN);
        assert_eq!(read_pubkey(&data, layout::PASS_DOCUMENT), pass.document);
        assert_eq!(read_pubkey(&data, layout::PASS_HOLDER), pass.holder);
        assert_eq!(read_pubkey(&data, layout::PASS_VERSION), pass.version);
        assert_eq!(
            read_u32(&data, layout::PASS_VERSION_NUMBER),
            pass.version_number
        );
        let mut at = [0u8; 8];
        at.copy_from_slice(&data[layout::PASS_ACCEPTED_AT..layout::PASS_ACCEPTED_AT + 8]);
        assert_eq!(i64::from_le_bytes(at), pass.accepted_at);

        let doc = stele::state::Document {
            organization: P::new_from_array([1; 32]),
            created_by: P::new_from_array([2; 32]),
            head_hash: [3; 32],
            current_version: P::new_from_array([4; 32]),
            created_at: 5,
            last_published_at: 6,
            version_count: 0x0102_0304,
            bump: 7,
            slug: "terms".into(),
            document_type: "terms-of-service".into(),
            locale: "en-US".into(),
        };
        let mut data = Vec::new();
        doc.try_serialize(&mut data).unwrap();
        assert_eq!(
            read_pubkey(&data, layout::DOCUMENT_CURRENT_VERSION),
            doc.current_version
        );
        assert_eq!(
            read_u32(&data, layout::DOCUMENT_VERSION_COUNT),
            doc.version_count
        );
    }

    #[test]
    fn requirement_arguments() {
        assert_eq!(Requirement::CurrentVersion.min_version(), 0);
        assert_eq!(Requirement::AtLeast(4).min_version(), 4);
        let ix = check_access_instruction(
            &Pubkey::new_from_array([1; 32]),
            &Pubkey::new_from_array([2; 32]),
            &Pubkey::new_from_array([3; 32]),
            Requirement::AtLeast(4),
        );
        assert_eq!(ix.program_id, STELE_PROGRAM_ID);
        assert_eq!(&ix.data[..8], &CHECK_ACCESS_DISCRIMINATOR);
        assert_eq!(&ix.data[8..], &4u32.to_le_bytes());
        assert!(ix.accounts[2].is_signer && !ix.accounts[2].is_writable);
    }
}
