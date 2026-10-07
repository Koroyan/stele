//! # Stele Gate for Solana programs
//!
//! One call in your protected instruction: the signer must hold a Stele AccessPass that satisfies
//! your Stele policy — they accepted the policy's document at the required version or later
//! (PROTOCOL_SPEC.md §18).
//!
//! ```ignore
//! pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
//!     stele_gate::require_current(
//!         &ctx.accounts.access_pass,
//!         &ctx.accounts.policy,   // pinned: #[account(address = vault.policy)]
//!         &ctx.accounts.investor, // a Signer
//!     )?;
//!     // … the protected action
//! }
//! ```
//!
//! A frontend checkbox can be skipped by any custom client; this check runs inside your program,
//! so a direct call without a valid pass fails on-chain. Your program must pin the policy's
//! address (store it, or make it a constant): otherwise a caller could present a policy of their
//! own. Stele is not in the execution path — no CPI, no proxy, no shared signer.
//!
//! Errors are `ProgramError::Custom` codes 7600–7606 ([`GateError`]).

use anchor_lang::solana_program::{
    account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey,
};

/// The Stele program (the same address on localnet and devnet).
pub const STELE_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    87, 55, 61, 197, 197, 98, 47, 235, 126, 82, 9, 191, 132, 109, 76, 103, 180, 177, 243, 81, 82,
    188, 211, 224, 243, 73, 142, 97, 133, 67, 181, 204,
]);

/// Seed of an access pass: `[ACCESS_PASS_SEED, document, holder]` under [`STELE_PROGRAM_ID`].
pub const ACCESS_PASS_SEED: &[u8] = b"access-pass";
/// Seed of a policy: `[POLICY_SEED, document]` under [`STELE_PROGRAM_ID`].
pub const POLICY_SEED: &[u8] = b"policy";

/// Anchor discriminators of the Stele accounts read here.
pub const ACCESS_PASS_DISCRIMINATOR: [u8; 8] = [24, 47, 32, 42, 150, 120, 87, 169];
pub const POLICY_DISCRIMINATOR: [u8; 8] = [3, 77, 45, 55, 30, 166, 143, 147];
/// Kept for programs that read Stele documents (e.g. to check a policy's document exists).
pub const DOCUMENT_DISCRIMINATOR: [u8; 8] = [226, 212, 133, 177, 48, 5, 171, 243];

/// Byte lengths of the accounts (discriminator included).
pub const ACCESS_PASS_LEN: usize = 233;
pub const POLICY_LEN: usize = 157;

// Normative layouts (PROTOCOL_SPEC.md §18.1); offsets include the discriminator.
mod layout {
    pub const PASS_ORGANIZATION: usize = 8;
    pub const PASS_DOCUMENT: usize = 40;
    pub const PASS_HOLDER: usize = 72;
    pub const PASS_VERSION: usize = 104;
    pub const PASS_VERSION_HASH: usize = 136;
    pub const PASS_ACCEPTANCE_ID: usize = 168;
    pub const PASS_ACCEPTED_AT: usize = 200;
    pub const PASS_VERSION_NUMBER: usize = 224;
    pub const PASS_BUMP: usize = 232;

    pub const POLICY_ORGANIZATION: usize = 8;
    pub const POLICY_DOCUMENT: usize = 40;
    pub const POLICY_REQUIRED_HASH: usize = 72;
    pub const POLICY_REQUIRED_VERSION: usize = 152;
    pub const POLICY_BUMP: usize = 156;
}

/// The acceptance that satisfied the policy.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GrantedAccess {
    pub organization: Pubkey,
    pub document: Pubkey,
    /// The accepted `DocumentVersion` account and its number and fingerprint.
    pub version: Pubkey,
    pub version_number: u32,
    pub version_hash: [u8; 32],
    /// The policy's required version (≤ `version_number`).
    pub required_version: u32,
    /// The acceptance identifier (the Proof receipt of this acceptance).
    pub acceptance_id: [u8; 32],
    /// When the holder accepted (Unix seconds).
    pub accepted_at: i64,
}

/// Gate failures, returned as `ProgramError::Custom(code)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum GateError {
    /// The policy account is not a Stele policy at its canonical address.
    InvalidPolicy = 7600,
    /// The user did not sign the transaction.
    UserNotSigner = 7601,
    /// The user has never accepted the policy's document (no access pass).
    AccessPassMissing = 7602,
    /// The account is not a Stele access pass at its canonical address.
    AccessPassInvalid = 7603,
    /// The pass belongs to another wallet or another document.
    AccessPassMismatch = 7604,
    /// The pass names an older version than the policy requires.
    AccessPassOutdated = 7605,
    /// The pass names the required version number with a different fingerprint.
    FingerprintMismatch = 7606,
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

/// The policy address of `document`.
pub fn policy_address(document: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[POLICY_SEED, document.as_ref()], &STELE_PROGRAM_ID)
}

fn read_pubkey(data: &[u8], at: usize) -> Pubkey {
    let mut b = [0u8; 32];
    b.copy_from_slice(&data[at..at + 32]);
    Pubkey::new_from_array(b)
}

fn read_32(data: &[u8], at: usize) -> [u8; 32] {
    let mut b = [0u8; 32];
    b.copy_from_slice(&data[at..at + 32]);
    b
}

fn read_u32(data: &[u8], at: usize) -> u32 {
    let mut b = [0u8; 4];
    b.copy_from_slice(&data[at..at + 4]);
    u32::from_le_bytes(b)
}

fn read_i64(data: &[u8], at: usize) -> i64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&data[at..at + 8]);
    i64::from_le_bytes(b)
}

fn is_canonical(key: &Pubkey, seeds: &[&[u8]], bump: u8) -> bool {
    let mut with_bump: Vec<&[u8]> = seeds.to_vec();
    let bump = [bump];
    with_bump.push(&bump);
    Pubkey::create_program_address(&with_bump, &STELE_PROGRAM_ID)
        .map(|k| k == *key)
        .unwrap_or(false)
}

/// Succeeds only if `user` signed the transaction and holds an access pass that satisfies `policy`:
/// the pass is the Stele account at `[access-pass, policy.document, user]` and names the policy's
/// required version or a later one (same fingerprint when it is the required version itself).
///
/// Only the Stele program can create accounts it owns, and it writes the `AccessPass` type only
/// after verifying the holder's signature over the exact document text; together with the owner,
/// type and canonical-address checks below, that is what makes the pass trustworthy.
pub fn require_current(
    access_pass: &AccountInfo,
    policy: &AccountInfo,
    user: &AccountInfo,
) -> Result<GrantedAccess, ProgramError> {
    // The policy: a Stele GatePolicy at its canonical address.
    let p = policy.try_borrow_data()?;
    if *policy.owner != STELE_PROGRAM_ID || p.len() < POLICY_LEN || p[..8] != POLICY_DISCRIMINATOR {
        return Err(GateError::InvalidPolicy.into());
    }
    let document = read_pubkey(&p, layout::POLICY_DOCUMENT);
    if !is_canonical(
        policy.key,
        &[POLICY_SEED, document.as_ref()],
        p[layout::POLICY_BUMP],
    ) {
        return Err(GateError::InvalidPolicy.into());
    }
    let organization = read_pubkey(&p, layout::POLICY_ORGANIZATION);
    let required_version = read_u32(&p, layout::POLICY_REQUIRED_VERSION);
    let required_hash = read_32(&p, layout::POLICY_REQUIRED_HASH);

    // The user: must have signed this transaction.
    if !user.is_signer {
        return Err(GateError::UserNotSigner.into());
    }

    // The pass: a Stele AccessPass at [access-pass, document, user].
    let pass = access_pass.try_borrow_data()?;
    if *access_pass.owner != STELE_PROGRAM_ID {
        // An uninitialized pass address (pre-funded or not) is owned by the system program.
        let (expected, _) = access_pass_address(&document, user.key);
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
    if read_pubkey(&pass, layout::PASS_HOLDER) != *user.key
        || read_pubkey(&pass, layout::PASS_DOCUMENT) != document
        || read_pubkey(&pass, layout::PASS_ORGANIZATION) != organization
    {
        return Err(GateError::AccessPassMismatch.into());
    }
    if !is_canonical(
        access_pass.key,
        &[ACCESS_PASS_SEED, document.as_ref(), user.key.as_ref()],
        pass[layout::PASS_BUMP],
    ) {
        return Err(GateError::AccessPassInvalid.into());
    }

    // The requirement.
    let version_number = read_u32(&pass, layout::PASS_VERSION_NUMBER);
    let version_hash = read_32(&pass, layout::PASS_VERSION_HASH);
    if version_number < required_version {
        return Err(GateError::AccessPassOutdated.into());
    }
    if version_number == required_version && version_hash != required_hash {
        return Err(GateError::FingerprintMismatch.into());
    }
    Ok(GrantedAccess {
        organization,
        document,
        version: read_pubkey(&pass, layout::PASS_VERSION),
        version_number,
        version_hash,
        required_version,
        acceptance_id: read_32(&pass, layout::PASS_ACCEPTANCE_ID),
        accepted_at: read_i64(&pass, layout::PASS_ACCEPTED_AT),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::{AccountSerialize, Discriminator, Space};

    #[test]
    fn constants_match_the_stele_program() {
        assert_eq!(STELE_PROGRAM_ID, stele::ID);
        assert_eq!(
            ACCESS_PASS_DISCRIMINATOR,
            stele::state::AccessPass::DISCRIMINATOR
        );
        assert_eq!(
            POLICY_DISCRIMINATOR,
            stele::state::GatePolicy::DISCRIMINATOR
        );
        assert_eq!(
            DOCUMENT_DISCRIMINATOR,
            stele::state::Document::DISCRIMINATOR
        );
        assert_eq!(ACCESS_PASS_LEN, 8 + stele::state::AccessPass::INIT_SPACE);
        assert_eq!(POLICY_LEN, 8 + stele::state::GatePolicy::INIT_SPACE);
        assert_eq!(ACCESS_PASS_SEED, stele::constants::ACCESS_PASS_SEED);
        assert_eq!(POLICY_SEED, stele::constants::POLICY_SEED);
    }

    #[test]
    fn layout_offsets_match_the_serialized_accounts() {
        use anchor_lang::prelude::Pubkey as P;
        let pass = stele::state::AccessPass {
            organization: P::new_from_array([1; 32]),
            document: P::new_from_array([2; 32]),
            holder: P::new_from_array([3; 32]),
            version: P::new_from_array([4; 32]),
            version_hash: [5; 32],
            acceptance_id: [6; 32],
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
        assert_eq!(
            read_pubkey(&data, layout::PASS_ORGANIZATION),
            pass.organization
        );
        assert_eq!(read_pubkey(&data, layout::PASS_DOCUMENT), pass.document);
        assert_eq!(read_pubkey(&data, layout::PASS_HOLDER), pass.holder);
        assert_eq!(read_pubkey(&data, layout::PASS_VERSION), pass.version);
        assert_eq!(read_32(&data, layout::PASS_VERSION_HASH), pass.version_hash);
        assert_eq!(
            read_32(&data, layout::PASS_ACCEPTANCE_ID),
            pass.acceptance_id
        );
        assert_eq!(read_i64(&data, layout::PASS_ACCEPTED_AT), pass.accepted_at);
        assert_eq!(
            read_u32(&data, layout::PASS_VERSION_NUMBER),
            pass.version_number
        );
        assert_eq!(data[layout::PASS_BUMP], pass.bump);

        let policy = stele::state::GatePolicy {
            organization: P::new_from_array([1; 32]),
            document: P::new_from_array([2; 32]),
            required_version_hash: [3; 32],
            updated_by: P::new_from_array([4; 32]),
            created_at: 5,
            updated_at: 6,
            required_version: 0x0102_0304,
            bump: 253,
        };
        let mut data = Vec::new();
        policy.try_serialize(&mut data).unwrap();
        assert_eq!(data.len(), POLICY_LEN);
        assert_eq!(
            read_pubkey(&data, layout::POLICY_ORGANIZATION),
            policy.organization
        );
        assert_eq!(read_pubkey(&data, layout::POLICY_DOCUMENT), policy.document);
        assert_eq!(
            read_32(&data, layout::POLICY_REQUIRED_HASH),
            policy.required_version_hash
        );
        assert_eq!(
            read_u32(&data, layout::POLICY_REQUIRED_VERSION),
            policy.required_version
        );
        assert_eq!(data[layout::POLICY_BUMP], policy.bump);
    }

    #[test]
    fn addresses_are_the_programs() {
        let doc = Pubkey::new_from_array([7; 32]);
        let holder = Pubkey::new_from_array([8; 32]);
        let (pass, bump) = access_pass_address(&doc, &holder);
        assert!(is_canonical(
            &pass,
            &[ACCESS_PASS_SEED, doc.as_ref(), holder.as_ref()],
            bump
        ));
        assert!(!is_canonical(
            &pass,
            &[ACCESS_PASS_SEED, holder.as_ref(), doc.as_ref()],
            bump
        ));
        let (policy, bump) = policy_address(&doc);
        assert!(is_canonical(&policy, &[POLICY_SEED, doc.as_ref()], bump));
    }
}
