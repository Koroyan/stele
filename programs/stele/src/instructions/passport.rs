//! Stele Gate passports: one account per wallet holding every document the wallet accepted
//! (PROTOCOL_SPEC.md §18.8), as an alternative to one `AccessPass` per document.
//!
//! Layout (little-endian, offsets include the 8-byte discriminator):
//!
//! ```text
//! 0   discriminator   [u8; 8]   Passport::DISCRIMINATOR
//! 8   holder          Pubkey    the wallet (also the PDA seed)
//! 40  entry_count     u32
//! 44  bump            u8
//! 45  base_payer      Pubkey    who paid the header's deposit (gets it back on close)
//! 77  entries         entry_count × 76 bytes, sorted by `document` (byte order), no duplicates:
//!        +0  document        Pubkey
//!        +32 version_number  u32
//!        +36 accepted_at     i64
//!        +44 payer           Pubkey   who paid this entry's deposit (gets it back on removal)
//! ```
//!
//! The account grows by one entry when the wallet accepts a new document and is rewritten in place
//! when it accepts a newer version, so a protected program finds an entry with a binary search and
//! never deserializes the list. Every deposit goes back to whoever paid it: an entry's to its payer
//! when the entry is removed, the header's to the base payer when the passport is closed.
//!
//! Only `record_passport_acceptance` writes entries, after the same verification as every Stele
//! acceptance (runtime-verified signature over the message the program rebuilds, nonce, current
//! version), so an entry is as trustworthy as the acceptance itself.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::{CONFIG_SEED, PASSPORT_SEED};
use crate::error::SteleError;
use crate::events::{PassportClosed, PassportEntryRemoved, PassportUpdated};
use crate::instructions::acceptance::{record_signed_acceptance, AcceptanceAccounts, Reimburse};
use crate::instructions::sponsor::{reimburse, SPONSORED_SIGNATURES};
use crate::state::{Document, DocumentVersion, NonceShard, Organization, Passport, ProtocolConfig};

pub const PASSPORT_HOLDER: usize = 8;
pub const PASSPORT_COUNT: usize = 40;
pub const PASSPORT_BUMP: usize = 44;
pub const PASSPORT_BASE_PAYER: usize = 45;
pub const PASSPORT_HEADER_LEN: usize = 77;
pub const PASSPORT_ENTRY_LEN: usize = 76;
/// Offsets inside an entry.
pub const ENTRY_VERSION: usize = 32;
pub const ENTRY_ACCEPTED_AT: usize = 36;
pub const ENTRY_PAYER: usize = 44;

fn read_u32(d: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(d[at..at + 4].try_into().unwrap())
}

fn read_key(d: &[u8], at: usize) -> Pubkey {
    Pubkey::new_from_array(d[at..at + 32].try_into().unwrap())
}

fn entry_at(index: usize) -> usize {
    PASSPORT_HEADER_LEN + index * PASSPORT_ENTRY_LEN
}

/// Binary search for `document` among the sorted entries: `Ok(index)` or `Err(insertion index)`.
pub fn find_entry(
    data: &[u8],
    count: usize,
    document: &[u8; 32],
) -> core::result::Result<usize, usize> {
    let (mut lo, mut hi) = (0usize, count);
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        let at = entry_at(mid);
        match data[at..at + 32].cmp(&document[..]) {
            core::cmp::Ordering::Less => lo = mid + 1,
            core::cmp::Ordering::Greater => hi = mid,
            core::cmp::Ordering::Equal => return Ok(mid),
        }
    }
    Err(lo)
}

/// Checks that `passport` is a well-formed Stele passport at its canonical address and returns
/// (holder, entry count). The address is re-derived from the stored bump (no bump search).
fn checked_passport(passport: &AccountInfo, program_id: &Pubkey) -> Result<(Pubkey, usize)> {
    require_keys_eq!(*passport.owner, *program_id, SteleError::PassportMismatch);
    let d = passport.try_borrow_data()?;
    require!(
        d.len() >= PASSPORT_HEADER_LEN && d[..8] == Passport::DISCRIMINATOR[..],
        SteleError::PassportMismatch
    );
    let holder = read_key(&d, PASSPORT_HOLDER);
    let count = read_u32(&d, PASSPORT_COUNT) as usize;
    require!(d.len() == entry_at(count), SteleError::PassportMismatch);
    let expected = Pubkey::create_program_address(
        &[PASSPORT_SEED, holder.as_ref(), &[d[PASSPORT_BUMP]]],
        program_id,
    )
    .map_err(|_| error!(SteleError::PassportMismatch))?;
    require_keys_eq!(passport.key(), expected, SteleError::PassportMismatch);
    Ok((holder, count))
}

fn pay<'info>(
    system: &Program<'info, System>,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    lamports: u64,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    system_program::transfer(
        CpiContext::new(
            system.key(),
            system_program::Transfer {
                from: from.clone(),
                to: to.clone(),
            },
        ),
        lamports,
    )
}

// ---- record ------------------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RecordPassportAcceptance<'info> {
    /// The shard's designated relayer; pays the network fee.
    #[account(mut)]
    pub relayer: Signer<'info>,
    /// Pays the deposit of a new passport or a new entry and is recorded as that deposit's owner:
    /// the investor themselves, or the organization (often through the relayer). May be the same
    /// account as the relayer.
    #[account(mut)]
    pub rent_payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    pub organization: Box<Account<'info, Organization>>,
    #[account(
        constraint = document.organization == organization.key() @ SteleError::DocumentOrganizationMismatch
    )]
    pub document: Box<Account<'info, Document>>,
    #[account(
        constraint = version.organization == organization.key() @ SteleError::VersionOrganizationMismatch,
        constraint = version.document == document.key() @ SteleError::VersionDocumentMismatch
    )]
    pub version: Box<Account<'info, DocumentVersion>>,
    #[account(mut)]
    pub nonce_shard: AccountLoader<'info, NonceShard>,
    /// CHECK: the passport of the wallet that signed the acceptance, `[PASSPORT_SEED, signer]`; the
    /// handler derives the expected address from the runtime-verified signer and the given bump.
    #[account(mut)]
    pub passport: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: address-constrained to the instructions sysvar; read via checked loaders.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn record_passport_acceptance(
    ctx: Context<RecordPassportAcceptance>,
    nonce_index: u32,
    nonce_tag: [u8; 8],
    issued_at: i64,
    expires_at: i64,
    passport_bump: u8,
) -> Result<()> {
    let a = &ctx.accounts;
    let recorded = record_signed_acceptance(
        AcceptanceAccounts {
            relayer: &a.relayer,
            config: &a.config,
            organization: &a.organization,
            document: &a.document,
            version: &a.version,
            nonce_shard: &a.nonce_shard,
            instructions_sysvar: &a.instructions_sysvar,
        },
        nonce_index,
        nonce_tag,
        issued_at,
        expires_at,
        // The passport's deposit is paid by system-program CPIs below; a sponsored shard reimburses
        // the relayer only after them.
        Reimburse::Later,
    )?;
    // The passport is the signer's: its address is derived from the verified signer, never from
    // an account the relayer names. The caller supplies the bump (no on-chain search); a wrong
    // bump simply fails the address check.
    let holder = recorded.signer;
    let expected = Pubkey::create_program_address(
        &[PASSPORT_SEED, holder.as_ref(), &[passport_bump]],
        ctx.program_id,
    )
    .map_err(|_| error!(SteleError::PassportMismatch))?;
    require_keys_eq!(a.passport.key(), expected, SteleError::PassportMismatch);

    let passport = a.passport.to_account_info();
    let payer_info = a.rent_payer.to_account_info();
    let rent_payer = a.rent_payer.key();
    let document = a.document.key();
    let version_number = a.version.version;
    let rent = Rent::get()?;
    let seeds: &[&[u8]] = &[PASSPORT_SEED, holder.as_ref(), &[passport_bump]];

    // Create the passport on first use (also when someone pre-funded the address).
    let created = *passport.owner == system_program::ID;
    if created {
        let needed = rent
            .minimum_balance(PASSPORT_HEADER_LEN)
            .saturating_sub(passport.lamports());
        pay(&a.system_program, &payer_info, &passport, needed)?;
        system_program::allocate(
            CpiContext::new_with_signer(
                a.system_program.key(),
                system_program::Allocate {
                    account_to_allocate: passport.clone(),
                },
                &[seeds],
            ),
            PASSPORT_HEADER_LEN as u64,
        )?;
        system_program::assign(
            CpiContext::new_with_signer(
                a.system_program.key(),
                system_program::Assign {
                    account_to_assign: passport.clone(),
                },
                &[seeds],
            ),
            ctx.program_id,
        )?;
        let mut d = passport.try_borrow_mut_data()?;
        d[..8].copy_from_slice(&Passport::DISCRIMINATOR[..]);
        d[PASSPORT_HOLDER..PASSPORT_HOLDER + 32].copy_from_slice(holder.as_ref());
        d[PASSPORT_COUNT..PASSPORT_COUNT + 4].copy_from_slice(&0u32.to_le_bytes());
        d[PASSPORT_BUMP] = passport_bump;
        d[PASSPORT_BASE_PAYER..PASSPORT_BASE_PAYER + 32].copy_from_slice(rent_payer.as_ref());
    }

    let (stored_holder, count) = checked_passport(&passport, ctx.program_id)?;
    require_keys_eq!(stored_holder, holder, SteleError::PassportMismatch);
    let doc_bytes = document.to_bytes();
    let position = {
        let d = passport.try_borrow_data()?;
        find_entry(&d, count, &doc_bytes)
    };
    let entry_created = match position {
        Ok(index) => {
            // A newer version of a document already in the passport: rewrite in place. The
            // entry's deposit and its payer do not change.
            let mut d = passport.try_borrow_mut_data()?;
            let at = entry_at(index);
            let current = read_u32(&d, at + ENTRY_VERSION);
            // `record_signed_acceptance` only accepts the current version, so versions never go
            // back; the same version is not recorded twice (it would prove nothing new).
            require!(version_number >= current, SteleError::PassportMismatch);
            require!(
                version_number > current,
                SteleError::AccessPassAlreadyCurrent
            );
            d[at + ENTRY_VERSION..at + ENTRY_VERSION + 4]
                .copy_from_slice(&version_number.to_le_bytes());
            d[at + ENTRY_ACCEPTED_AT..at + ENTRY_ACCEPTED_AT + 8]
                .copy_from_slice(&recorded.recorded_at.to_le_bytes());
            false
        }
        Err(index) => {
            // A new document: grow by one entry; the rent payer deposits exactly its rent.
            let old_len = entry_at(count);
            let new_len = old_len + PASSPORT_ENTRY_LEN;
            let needed = rent
                .minimum_balance(new_len)
                .saturating_sub(rent.minimum_balance(old_len));
            pay(&a.system_program, &payer_info, &passport, needed)?;
            passport.resize(new_len)?;
            let mut d = passport.try_borrow_mut_data()?;
            let at = entry_at(index);
            d.copy_within(at..old_len, at + PASSPORT_ENTRY_LEN);
            d[at..at + 32].copy_from_slice(&doc_bytes);
            d[at + ENTRY_VERSION..at + ENTRY_VERSION + 4]
                .copy_from_slice(&version_number.to_le_bytes());
            d[at + ENTRY_ACCEPTED_AT..at + ENTRY_ACCEPTED_AT + 8]
                .copy_from_slice(&recorded.recorded_at.to_le_bytes());
            d[at + ENTRY_PAYER..at + ENTRY_PAYER + 32].copy_from_slice(rent_payer.as_ref());
            let new_count = u32::try_from(count + 1).map_err(|_| SteleError::ArithmeticOverflow)?;
            d[PASSPORT_COUNT..PASSPORT_COUNT + 4].copy_from_slice(&new_count.to_le_bytes());
            true
        }
    };

    // Fee sponsorship, after every CPI of this instruction (see `Reimburse::Later`).
    reimburse(
        &a.nonce_shard.to_account_info(),
        &a.relayer.to_account_info(),
        &a.instructions_sysvar.to_account_info(),
        &recorded.shard_relayer,
        recorded.acceptance_id,
        recorded.recorded_at,
        SPONSORED_SIGNATURES,
    )?;

    emit!(PassportUpdated {
        holder,
        passport: passport.key(),
        organization: a.organization.key(),
        document,
        version: a.version.key(),
        version_hash: a.version.version_hash,
        version_number,
        acceptance_id: recorded.acceptance_id,
        accepted_at: recorded.recorded_at,
        slot: recorded.slot,
        deposit_payer: rent_payer,
        passport_created: created,
        entry_created,
    });
    Ok(())
}

// ---- remove an entry / close -------------------------------------------------------------------

#[derive(Accounts)]
pub struct ManagePassport<'info> {
    /// The holder, or the payer of the deposit being released.
    pub authority: Signer<'info>,
    /// CHECK: a passport; owner, type, canonical address (from the stored bump) checked in the
    /// handler.
    #[account(mut)]
    pub passport: UncheckedAccount<'info>,
    /// CHECK: must be the recorded payer of the deposit being released (checked in the handler).
    #[account(mut)]
    pub refund_to: UncheckedAccount<'info>,
}

/// Removes one document from a passport and returns that entry's deposit to whoever paid it. The
/// holder may remove any entry; a payer (e.g. the organization) may remove the entries it paid
/// for. The acceptance evidence is untouched (it is in the ledger); protected programs stop
/// admitting the holder for that document until they accept it again.
pub fn remove_passport_entry(ctx: Context<ManagePassport>, document: Pubkey) -> Result<()> {
    let passport = ctx.accounts.passport.to_account_info();
    let (holder, count) = checked_passport(&passport, ctx.program_id)?;
    let (index, payer) = {
        let d = passport.try_borrow_data()?;
        let index = find_entry(&d, count, &document.to_bytes())
            .map_err(|_| error!(SteleError::PassportEntryMissing))?;
        (index, read_key(&d, entry_at(index) + ENTRY_PAYER))
    };
    let authority = ctx.accounts.authority.key();
    require!(
        authority == holder || authority == payer,
        SteleError::PassportUnauthorized
    );
    require_keys_eq!(
        ctx.accounts.refund_to.key(),
        payer,
        SteleError::PassportRefundMismatch
    );

    let old_len = entry_at(count);
    let new_len = old_len - PASSPORT_ENTRY_LEN;
    {
        let mut d = passport.try_borrow_mut_data()?;
        let at = entry_at(index);
        d.copy_within(at + PASSPORT_ENTRY_LEN..old_len, at);
        d[PASSPORT_COUNT..PASSPORT_COUNT + 4].copy_from_slice(&((count - 1) as u32).to_le_bytes());
    }
    passport.resize(new_len)?;
    let rent = Rent::get()?;
    // Exactly the entry's deposit (never more: lamports someone donated stay with the passport).
    let refunded = rent
        .minimum_balance(old_len)
        .saturating_sub(rent.minimum_balance(new_len))
        .min(
            passport
                .lamports()
                .saturating_sub(rent.minimum_balance(new_len)),
        );
    passport.sub_lamports(refunded)?;
    ctx.accounts.refund_to.add_lamports(refunded)?;
    emit!(PassportEntryRemoved {
        holder,
        passport: passport.key(),
        document,
        removed_by: authority,
        refund_to: payer,
        refunded,
    });
    Ok(())
}

/// Closes a passport and returns everything it holds to the base payer. Allowed for the holder or
/// the base payer, once every remaining entry was paid by the base payer (entries paid by someone
/// else are removed first, so each deposit returns to whoever paid it).
pub fn close_passport(ctx: Context<ManagePassport>) -> Result<()> {
    let passport = ctx.accounts.passport.to_account_info();
    let (holder, count) = checked_passport(&passport, ctx.program_id)?;
    let base_payer = {
        let d = passport.try_borrow_data()?;
        let base = read_key(&d, PASSPORT_BASE_PAYER);
        for i in 0..count {
            let at = entry_at(i) + ENTRY_PAYER;
            require!(
                d[at..at + 32] == base.to_bytes(),
                SteleError::PassportHasOtherDeposits
            );
        }
        base
    };
    let authority = ctx.accounts.authority.key();
    require!(
        authority == holder || authority == base_payer,
        SteleError::PassportUnauthorized
    );
    require_keys_eq!(
        ctx.accounts.refund_to.key(),
        base_payer,
        SteleError::PassportRefundMismatch
    );
    let refunded = passport.lamports();
    passport.sub_lamports(refunded)?;
    ctx.accounts.refund_to.add_lamports(refunded)?;
    passport.resize(0)?;
    passport.assign(&system_program::ID);
    emit!(PassportClosed {
        holder,
        passport: passport.key(),
        closed_by: authority,
        refund_to: base_payer,
        entries: count as u32,
        refunded,
    });
    Ok(())
}
