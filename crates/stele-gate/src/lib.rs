//! # Stele Gate for Solana programs
//!
//! One call in your protected instruction: the signer must have accepted your Stele policy's
//! document at the required version or later (PROTOCOL_SPEC.md §18).
//!
//! ```ignore
//! pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
//!     stele_gate::require_current_passport(
//!         &ctx.accounts.passport, // stele_gate::passport_address(investor).0
//!         &ctx.accounts.policy,   // pinned: #[account(address = vault.policy)]
//!         &ctx.accounts.investor, // a Signer
//!     )?;
//!     // … the protected action
//! }
//! ```
//!
//! Acceptances are stored in the wallet's **passport** — one Stele account per wallet, an entry per
//! document (§18.8) — or, for organizations that chose per-document storage, in an **access pass**
//! per (document, wallet) checked with [`require_current`]. Several documents:
//! [`require_passport_policies`] (one passport, N policies) or [`require_policies`].
//!
//! A frontend checkbox can be skipped by any custom client; this check runs inside your program,
//! so a direct call without a valid acceptance fails on-chain. Your program must pin the policy's
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
/// Seed of a passport: `[PASSPORT_SEED, holder]` under [`STELE_PROGRAM_ID`].
pub const PASSPORT_SEED: &[u8] = b"passport";

/// Anchor discriminators of the Stele accounts read here.
pub const ACCESS_PASS_DISCRIMINATOR: [u8; 8] = [24, 47, 32, 42, 150, 120, 87, 169];
pub const POLICY_DISCRIMINATOR: [u8; 8] = [3, 77, 45, 55, 30, 166, 143, 147];
pub const PASSPORT_DISCRIMINATOR: [u8; 8] = [18, 61, 245, 239, 6, 15, 18, 34];
/// Kept for programs that read Stele documents (e.g. to check a policy's document exists).
pub const DOCUMENT_DISCRIMINATOR: [u8; 8] = [226, 212, 133, 177, 48, 5, 171, 243];

/// Byte lengths of the accounts (discriminator included).
pub const ACCESS_PASS_LEN: usize = 233;
pub const POLICY_LEN: usize = 157;
/// Passport header and entry sizes (discriminator included in the header).
pub const PASSPORT_HEADER_LEN: usize = 77;
pub const PASSPORT_ENTRY_LEN: usize = 76;

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

/// The passport entry that satisfied the policy.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PassportAccess {
    pub organization: Pubkey,
    pub document: Pubkey,
    /// The accepted version number (≥ `required_version`).
    pub version_number: u32,
    pub required_version: u32,
    /// When the holder accepted that version (Unix seconds).
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
    /// The user has never accepted the policy's document (no passport entry or access pass).
    AccessPassMissing = 7602,
    /// The account is not a Stele passport or access pass at its canonical address.
    AccessPassInvalid = 7603,
    /// The passport or pass belongs to another wallet or another document.
    AccessPassMismatch = 7604,
    /// The accepted version is older than the policy requires.
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

/// The passport address of `holder` (one per wallet, every document it accepted).
pub fn passport_address(holder: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PASSPORT_SEED, holder.as_ref()], &STELE_PROGRAM_ID)
}

/// Like [`require_current`], with the user's Stele passport instead of a per-document access pass:
/// `user` signed the transaction and their passport (the Stele account at `[passport, user]`) has
/// an entry for the policy's document at the required version or later.
///
/// The passport is searched in place (binary search over its sorted entries), so the cost does not
/// grow with the number of documents the user accepted elsewhere.
///
/// ```ignore
/// stele_gate::require_current_passport(
///     &ctx.accounts.passport,  // stele_gate::passport_address(investor).0
///     &ctx.accounts.policy,    // pinned: #[account(address = vault.policy)]
///     &ctx.accounts.investor,  // a Signer
/// )?;
/// ```
pub fn require_current_passport(
    passport: &AccountInfo,
    policy: &AccountInfo,
    user: &AccountInfo,
) -> Result<PassportAccess, ProgramError> {
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

    if !user.is_signer {
        return Err(GateError::UserNotSigner.into());
    }

    let d = passport.try_borrow_data()?;
    if *passport.owner != STELE_PROGRAM_ID {
        let (expected, _) = passport_address(user.key);
        return Err(if *passport.key == expected {
            GateError::AccessPassMissing
        } else {
            GateError::AccessPassInvalid
        }
        .into());
    }
    if d.len() < PASSPORT_HEADER_LEN || d[..8] != PASSPORT_DISCRIMINATOR {
        return Err(GateError::AccessPassInvalid.into());
    }
    if read_pubkey(&d, 8) != *user.key {
        return Err(GateError::AccessPassMismatch.into());
    }
    if !is_canonical(passport.key, &[PASSPORT_SEED, user.key.as_ref()], d[44]) {
        return Err(GateError::AccessPassInvalid.into());
    }
    let count = read_u32(&d, 40) as usize;
    if d.len() != PASSPORT_HEADER_LEN + count * PASSPORT_ENTRY_LEN {
        return Err(GateError::AccessPassInvalid.into());
    }
    // Binary search over the entries, sorted by document.
    let key = document.to_bytes();
    let (mut lo, mut hi) = (0usize, count);
    let entry = loop {
        if lo >= hi {
            return Err(GateError::AccessPassMissing.into());
        }
        let mid = lo + (hi - lo) / 2;
        let at = PASSPORT_HEADER_LEN + mid * PASSPORT_ENTRY_LEN;
        match d[at..at + 32].cmp(&key[..]) {
            core::cmp::Ordering::Less => lo = mid + 1,
            core::cmp::Ordering::Greater => hi = mid,
            core::cmp::Ordering::Equal => break at,
        }
    };
    let version_number = read_u32(&d, entry + 32);
    if version_number < required_version {
        return Err(GateError::AccessPassOutdated.into());
    }
    Ok(PassportAccess {
        organization,
        document,
        version_number,
        required_version,
        accepted_at: read_i64(&d, entry + 36),
    })
}

/// One action that requires several documents (for example Terms of Service, a Privacy Policy and a
/// Risk Disclosure — one Stele policy each): `user` must hold a current pass for every policy.
/// Fails with the first unmet requirement; on success returns one [`GrantedAccess`] per policy,
/// in order.
///
/// ```ignore
/// stele_gate::require_all_current(
///     &[
///         (&ctx.accounts.terms_pass, &ctx.accounts.terms_policy),
///         (&ctx.accounts.privacy_pass, &ctx.accounts.privacy_policy),
///     ],
///     &ctx.accounts.investor,
/// )?;
/// ```
pub fn require_all_current(
    requirements: &[(&AccountInfo, &AccountInfo)],
    user: &AccountInfo,
) -> Result<Vec<GrantedAccess>, ProgramError> {
    requirements
        .iter()
        .map(|(access_pass, policy)| require_current(access_pass, policy, user))
        .collect()
}

/// A list of required policies, any length: `user` must hold a current pass for each.
///
/// `required` is YOUR list — constants or addresses stored in your program's state, never taken
/// from the caller (a caller-chosen policy could require nothing). `accounts` are what the caller
/// passed, in pairs `[policy, access_pass, policy, access_pass, …]` in any order — typically
/// `ctx.remaining_accounts`, so the instruction needs no named account per document.
///
/// Fails with [`GateError::InvalidPolicy`] if a required policy is missing from `accounts` (or the
/// accounts are not pairs), otherwise with the first unmet requirement. On success returns one
/// [`GrantedAccess`] per required policy, in the order of `required`.
///
/// ```ignore
/// pub const REQUIRED: [Pubkey; 3] = [TERMS_POLICY, PRIVACY_POLICY, RISK_POLICY];
///
/// pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
///     stele_gate::require_policies(&REQUIRED, ctx.remaining_accounts, &ctx.accounts.investor)?;
///     // … the protected action
/// }
/// ```
pub fn require_policies(
    required: &[Pubkey],
    accounts: &[AccountInfo],
    user: &AccountInfo,
) -> Result<Vec<GrantedAccess>, ProgramError> {
    if accounts.len() % 2 != 0 {
        return Err(GateError::InvalidPolicy.into());
    }
    required
        .iter()
        .map(|wanted| {
            let pair = accounts
                .chunks_exact(2)
                .find(|pair| pair[0].key == wanted)
                .ok_or(GateError::InvalidPolicy)?;
            require_current(&pair[1], &pair[0], user)
        })
        .collect()
}

/// [`require_policies`] with the user's passport: every policy in `required` must be satisfied by
/// an entry of the one `passport`. `policies` are the policy accounts the caller passed, in any
/// order — typically `ctx.remaining_accounts` — so N documents need N + 1 accounts, not 2N.
///
/// `required` is YOUR list (constants or addresses in your program's state). Fails with
/// [`GateError::InvalidPolicy`] if a required policy is missing from `policies`, otherwise with the
/// first unmet requirement. On success returns one [`PassportAccess`] per required policy, in the
/// order of `required`.
///
/// ```ignore
/// pub const REQUIRED: [Pubkey; 3] = [TERMS_POLICY, PRIVACY_POLICY, RISK_POLICY];
///
/// pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
///     stele_gate::require_passport_policies(
///         &REQUIRED,
///         ctx.remaining_accounts,  // the policies
///         &ctx.accounts.passport,
///         &ctx.accounts.investor,
///     )?;
///     // … the protected action
/// }
/// ```
pub fn require_passport_policies(
    required: &[Pubkey],
    policies: &[AccountInfo],
    passport: &AccountInfo,
    user: &AccountInfo,
) -> Result<Vec<PassportAccess>, ProgramError> {
    required
        .iter()
        .map(|wanted| {
            let policy = policies
                .iter()
                .find(|p| p.key == wanted)
                .ok_or(GateError::InvalidPolicy)?;
            require_current_passport(passport, policy, user)
        })
        .collect()
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
        assert_eq!(
            PASSPORT_DISCRIMINATOR,
            stele::state::Passport::DISCRIMINATOR
        );
        assert_eq!(PASSPORT_SEED, stele::constants::PASSPORT_SEED);
        assert_eq!(
            PASSPORT_HEADER_LEN,
            stele::instructions::passport::PASSPORT_HEADER_LEN
        );
        assert_eq!(
            PASSPORT_ENTRY_LEN,
            stele::instructions::passport::PASSPORT_ENTRY_LEN
        );
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

    /// A Stele-owned account as the program would hold it: (key, lamports, data).
    struct Fake {
        key: Pubkey,
        lamports: u64,
        data: Vec<u8>,
    }

    /// A policy requiring `version` of `doc`, and `holder`'s pass naming `pass_version`.
    fn policy_and_pass(
        doc: Pubkey,
        holder: Pubkey,
        version: u32,
        pass_version: u32,
    ) -> (Fake, Fake) {
        use anchor_lang::prelude::Pubkey as P;
        let org = P::new_from_array([1; 32]);
        let hash = [9u8; 32];
        let (policy_key, policy_bump) = policy_address(&doc);
        let mut policy = Vec::new();
        stele::state::GatePolicy {
            organization: org,
            document: doc,
            required_version_hash: hash,
            updated_by: org,
            created_at: 0,
            updated_at: 0,
            required_version: version,
            bump: policy_bump,
        }
        .try_serialize(&mut policy)
        .unwrap();
        let (pass_key, pass_bump) = access_pass_address(&doc, &holder);
        let mut pass = Vec::new();
        stele::state::AccessPass {
            organization: org,
            document: doc,
            holder,
            version: P::new_from_array([4; 32]),
            version_hash: hash,
            acceptance_id: [6; 32],
            accepted_at: 1,
            first_accepted_at: 1,
            accepted_slot: 1,
            version_number: pass_version,
            acceptance_count: 1,
            bump: pass_bump,
        }
        .try_serialize(&mut pass)
        .unwrap();
        (
            Fake {
                key: policy_key,
                lamports: 1,
                data: policy,
            },
            Fake {
                key: pass_key,
                lamports: 1,
                data: pass,
            },
        )
    }

    fn info(f: &mut Fake, signer: bool) -> AccountInfo<'_> {
        AccountInfo::new(
            &f.key,
            signer,
            false,
            &mut f.lamports,
            &mut f.data,
            &STELE_PROGRAM_ID,
            false,
        )
    }

    #[test]
    fn require_policies_checks_every_pinned_policy_in_any_order() {
        let holder = Pubkey::new_from_array([3; 32]);
        let (mut terms, mut terms_pass) =
            policy_and_pass(Pubkey::new_from_array([20; 32]), holder, 2, 2);
        let (mut privacy, mut privacy_pass) =
            policy_and_pass(Pubkey::new_from_array([21; 32]), holder, 1, 3);
        let (mut risk, mut risk_pass) =
            policy_and_pass(Pubkey::new_from_array([22; 32]), holder, 4, 1);
        let required = [terms.key, privacy.key];
        let user_key = holder;
        let mut user_lamports = 0;
        let mut user_data: Vec<u8> = vec![];
        let system = Pubkey::default();
        let user = AccountInfo::new(
            &user_key,
            true,
            false,
            &mut user_lamports,
            &mut user_data,
            &system,
            false,
        );
        let accounts = [
            info(&mut privacy, false),
            info(&mut privacy_pass, false),
            info(&mut risk, false), // extra, not required: ignored
            info(&mut risk_pass, false),
            info(&mut terms, false),
            info(&mut terms_pass, false),
        ];

        // Both required policies are satisfied, whatever the order of the pairs.
        let granted = require_policies(&required, &accounts, &user).unwrap();
        assert_eq!(granted.len(), 2);
        assert_eq!(granted[0].required_version, 2);
        assert_eq!(granted[1].version_number, 3);

        // A required policy the caller left out is refused.
        let only_privacy = &accounts[..2];
        assert_eq!(
            require_policies(&required, only_privacy, &user),
            Err(ProgramError::Custom(GateError::InvalidPolicy as u32))
        );
        // An outdated pass for a required policy is refused.
        assert_eq!(
            require_policies(&[*accounts[2].key], &accounts, &user),
            Err(ProgramError::Custom(GateError::AccessPassOutdated as u32))
        );
        // Not pairs: refused.
        assert_eq!(
            require_policies(&required, &accounts[..5], &user),
            Err(ProgramError::Custom(GateError::InvalidPolicy as u32))
        );
    }

    /// `holder`'s passport with the given (document, version) entries, sorted as the program keeps
    /// them.
    fn passport(holder: Pubkey, mut entries: Vec<(Pubkey, u32)>) -> Fake {
        entries.sort_by_key(|(doc, _)| doc.to_bytes());
        let (key, bump) = passport_address(&holder);
        let mut data = vec![0u8; PASSPORT_HEADER_LEN];
        data[..8].copy_from_slice(&PASSPORT_DISCRIMINATOR);
        data[8..40].copy_from_slice(holder.as_ref());
        data[40..44].copy_from_slice(&(entries.len() as u32).to_le_bytes());
        data[44] = bump;
        data[45..77].copy_from_slice(holder.as_ref());
        for (doc, version) in entries {
            data.extend_from_slice(doc.as_ref());
            data.extend_from_slice(&version.to_le_bytes());
            data.extend_from_slice(&7i64.to_le_bytes());
            data.extend_from_slice(holder.as_ref());
        }
        Fake {
            key,
            lamports: 1,
            data,
        }
    }

    #[test]
    fn require_passport_policies_reads_one_passport_for_every_policy() {
        let holder = Pubkey::new_from_array([3; 32]);
        let (terms_doc, privacy_doc, risk_doc) = (
            Pubkey::new_from_array([20; 32]),
            Pubkey::new_from_array([21; 32]),
            Pubkey::new_from_array([22; 32]),
        );
        let (mut terms, _) = policy_and_pass(terms_doc, holder, 2, 0);
        let (mut privacy, _) = policy_and_pass(privacy_doc, holder, 1, 0);
        let (mut risk, _) = policy_and_pass(risk_doc, holder, 4, 0);
        let mut pp = passport(
            holder,
            vec![(risk_doc, 1), (terms_doc, 2), (privacy_doc, 3)],
        );
        let required = [terms.key, privacy.key];
        let user_key = holder;
        let mut user_lamports = 0;
        let mut user_data: Vec<u8> = vec![];
        let system = Pubkey::default();
        let user = AccountInfo::new(
            &user_key,
            true,
            false,
            &mut user_lamports,
            &mut user_data,
            &system,
            false,
        );
        let risk_key = risk.key;
        let policies = [
            info(&mut privacy, false),
            info(&mut risk, false), // extra, not required: ignored
            info(&mut terms, false),
        ];
        let passport = info(&mut pp, false);

        let granted = require_passport_policies(&required, &policies, &passport, &user).unwrap();
        assert_eq!(granted.len(), 2);
        assert_eq!(granted[0].document, terms_doc);
        assert_eq!(granted[1].version_number, 3);

        // A required policy the caller left out is refused.
        assert_eq!(
            require_passport_policies(&required, &policies[..1], &passport, &user),
            Err(ProgramError::Custom(GateError::InvalidPolicy as u32))
        );
        // An outdated entry for a required policy is refused.
        assert_eq!(
            require_passport_policies(&[risk_key], &policies, &passport, &user),
            Err(ProgramError::Custom(GateError::AccessPassOutdated as u32))
        );
    }
}
