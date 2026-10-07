//! Stele Gate demo — "Atlas Real Estate Vault", a toy permissioned investment vault
//! (PROTOCOL_SPEC.md §18.5).
//!
//! Each vault pins one Stele policy (its "Investor Offering Terms"). `deposit` executes only if the
//! investor signed the transaction and holds a Stele AccessPass that satisfies the policy — checked
//! here, inside this program, with one call to `stele_gate::require_current`. Calling `deposit`
//! directly from a script or the CLI without a current pass fails on-chain.
//!
//! No tokens move: a deposit is recorded as demo USDC in the vault's public totals. The program
//! exists to show — and test — program-level enforcement, not to hold funds.

use anchor_lang::prelude::*;
use stele_gate::{require_current, STELE_PROGRAM_ID};

declare_id!("A6DBoANAavtbG2ARK6PihqzMjhtbcZUbLnTMAWn339uR");

pub const VAULT_SEED: &[u8] = b"vault";
pub const MAX_NAME_LEN: usize = 64;
/// Demo USDC has 6 decimals; one deposit is at most 1,000,000 USDC.
pub const MAX_DEPOSIT: u64 = 1_000_000_000_000;

#[program]
pub mod stele_gate_demo {
    use super::*;

    /// Opens a vault whose deposits require `policy` (one vault per policy).
    pub fn create_vault(ctx: Context<CreateVault>, name: String) -> Result<()> {
        require!(
            !name.is_empty() && name.len() <= MAX_NAME_LEN,
            VaultError::InvalidName
        );
        let policy = &ctx.accounts.policy;
        require_keys_eq!(*policy.owner, STELE_PROGRAM_ID, VaultError::NotAStelePolicy);
        {
            let data = policy.try_borrow_data()?;
            require!(
                data.len() >= 8 && data[..8] == stele_gate::POLICY_DISCRIMINATOR,
                VaultError::NotAStelePolicy
            );
        }
        let vault = &mut ctx.accounts.vault;
        vault.policy = policy.key();
        vault.manager = ctx.accounts.manager.key();
        vault.created_at = Clock::get()?.unix_timestamp;
        vault.bump = ctx.bumps.vault;
        vault.name = name;
        Ok(())
    }

    /// Deposits `amount` demo USDC (6 decimals) — only with a current Stele AccessPass.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let granted = require_current(
            &ctx.accounts.access_pass,
            &ctx.accounts.policy,
            &ctx.accounts.investor,
        )?;
        require!(
            amount > 0 && amount <= MAX_DEPOSIT,
            VaultError::InvalidAmount
        );
        let vault = &mut ctx.accounts.vault;
        vault.total_deposited = vault
            .total_deposited
            .checked_add(amount)
            .ok_or(VaultError::Overflow)?;
        vault.deposit_count = vault
            .deposit_count
            .checked_add(1)
            .ok_or(VaultError::Overflow)?;
        emit!(Deposited {
            vault: vault.key(),
            investor: ctx.accounts.investor.key(),
            amount,
            total_deposited: vault.total_deposited,
            deposit_count: vault.deposit_count,
            terms_version: granted.version,
            terms_version_number: granted.version_number,
            terms_fingerprint: granted.version_hash,
            acceptance_id: granted.acceptance_id,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateVault<'info> {
    #[account(mut)]
    pub manager: Signer<'info>,
    /// CHECK: must be a Stele GatePolicy (owner and type are checked in the handler).
    pub policy: UncheckedAccount<'info>,
    #[account(
        init,
        payer = manager,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, policy.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub investor: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED, vault.policy.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: pinned to the vault's policy; verified by `stele_gate::require_current`.
    #[account(address = vault.policy @ VaultError::WrongPolicy)]
    pub policy: UncheckedAccount<'info>,
    /// CHECK: verified by `stele_gate::require_current` (owner, type, address, wallet, version).
    pub access_pass: UncheckedAccount<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Vault {
    /// The Stele policy every deposit requires.
    pub policy: Pubkey,
    pub manager: Pubkey,
    /// Demo USDC, 6 decimals.
    pub total_deposited: u64,
    pub deposit_count: u64,
    pub created_at: i64,
    pub bump: u8,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
}

#[event]
pub struct Deposited {
    pub vault: Pubkey,
    pub investor: Pubkey,
    pub amount: u64,
    pub total_deposited: u64,
    pub deposit_count: u64,
    /// The offering terms the investor's AccessPass names (their Stele Proof acceptance).
    pub terms_version: Pubkey,
    pub terms_version_number: u32,
    pub terms_fingerprint: [u8; 32],
    pub acceptance_id: [u8; 32],
    pub slot: u64,
}

#[error_code]
pub enum VaultError {
    #[msg("The vault name must be 1 to 64 bytes")]
    InvalidName,
    #[msg("The policy is not a Stele policy")]
    NotAStelePolicy,
    #[msg("This is not the policy the vault requires")]
    WrongPolicy,
    #[msg("Amount must be between 0.000001 and 1,000,000 demo USDC")]
    InvalidAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
}
