//! Stele Gate demo — a toy prediction market protected by Stele Gate (PROTOCOL_SPEC.md §18.5).
//!
//! Each market pins one Stele policy document (its "Risk Disclosure"). A bet executes only if the
//! bettor signed the transaction and holds an access pass for the document's **current** version:
//!
//! * `place_bet` checks the pass itself with `stele_gate::verify_access` (check mode);
//! * `place_bet_strict` asks the Stele program through a CPI (`check_access`, strict mode).
//!
//! No funds move: a bet only adds its stake to the market's public totals. The program exists to
//! show — and test — that calling it directly, without a valid pass, fails on-chain.

use anchor_lang::prelude::*;
use stele_gate::{require_access_cpi, verify_access, GrantedAccess, Requirement, STELE_PROGRAM_ID};

declare_id!("A6DBoANAavtbG2ARK6PihqzMjhtbcZUbLnTMAWn339uR");

pub const MARKET_SEED: &[u8] = b"market";
pub const MAX_QUESTION_LEN: usize = 96;
/// Upper bound of a single stake (an arbitrary unit; nothing is transferred).
pub const MAX_STAKE: u64 = 1_000_000_000_000;

pub const SIDE_NO: u8 = 0;
pub const SIDE_YES: u8 = 1;

#[program]
pub mod stele_gate_demo {
    use super::*;

    /// Opens the market guarded by `policy_document` (one market per document).
    pub fn create_market(ctx: Context<CreateMarket>, question: String) -> Result<()> {
        require!(
            !question.is_empty() && question.len() <= MAX_QUESTION_LEN,
            DemoError::InvalidQuestion
        );
        let document = &ctx.accounts.policy_document;
        require_keys_eq!(
            *document.owner,
            STELE_PROGRAM_ID,
            DemoError::NotAStelePolicy
        );
        {
            let data = document.try_borrow_data()?;
            require!(
                data.len() >= 8 && data[..8] == stele_gate::DOCUMENT_DISCRIMINATOR,
                DemoError::NotAStelePolicy
            );
        }
        let market = &mut ctx.accounts.market;
        market.policy_document = document.key();
        market.creator = ctx.accounts.creator.key();
        market.created_at = Clock::get()?.unix_timestamp;
        market.bump = ctx.bumps.market;
        market.question = question;
        Ok(())
    }

    /// A bet in check mode: this program reads the access pass itself.
    pub fn place_bet(ctx: Context<PlaceBet>, side: u8, stake: u64) -> Result<()> {
        let a = &ctx.accounts;
        let granted = verify_access(
            &a.market.policy_document,
            &a.policy_document.to_account_info(),
            &a.access_pass.to_account_info(),
            &a.bettor.to_account_info(),
            Requirement::CurrentVersion,
        )?;
        let bettor = a.bettor.key();
        settle(
            &mut ctx.accounts.market,
            bettor,
            side,
            stake,
            granted,
            false,
        )
    }

    /// A bet in strict mode: the Stele program evaluates the requirement through a CPI.
    pub fn place_bet_strict(ctx: Context<PlaceBetStrict>, side: u8, stake: u64) -> Result<()> {
        let a = &ctx.accounts;
        let granted = require_access_cpi(
            &a.stele_program.to_account_info(),
            &a.market.policy_document,
            &a.policy_document.to_account_info(),
            &a.access_pass.to_account_info(),
            &a.bettor.to_account_info(),
            Requirement::CurrentVersion,
        )?;
        let bettor = a.bettor.key();
        settle(&mut ctx.accounts.market, bettor, side, stake, granted, true)
    }
}

fn settle(
    market: &mut Account<Market>,
    bettor: Pubkey,
    side: u8,
    stake: u64,
    granted: GrantedAccess,
    strict: bool,
) -> Result<()> {
    require!(side == SIDE_NO || side == SIDE_YES, DemoError::InvalidSide);
    require!(stake > 0 && stake <= MAX_STAKE, DemoError::InvalidStake);
    if side == SIDE_YES {
        market.yes_stake = market
            .yes_stake
            .checked_add(stake)
            .ok_or(DemoError::Overflow)?;
    } else {
        market.no_stake = market
            .no_stake
            .checked_add(stake)
            .ok_or(DemoError::Overflow)?;
    }
    market.bet_count = market.bet_count.checked_add(1).ok_or(DemoError::Overflow)?;
    emit!(BetPlaced {
        market: market.key(),
        bettor,
        policy_version: granted.version,
        policy_version_number: granted.version_number,
        stake,
        yes_stake: market.yes_stake,
        no_stake: market.no_stake,
        bet_count: market.bet_count,
        slot: Clock::get()?.slot,
        side,
        strict,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    /// CHECK: must be a Stele `Document` (owner and type are checked in the handler).
    pub policy_document: UncheckedAccount<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, policy_document.key().as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    pub bettor: Signer<'info>,
    #[account(mut, seeds = [MARKET_SEED, market.policy_document.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    /// CHECK: verified by `stele_gate::verify_access` against `market.policy_document`.
    pub policy_document: UncheckedAccount<'info>,
    /// CHECK: verified by `stele_gate::verify_access` (owner, type, document, holder, version).
    pub access_pass: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct PlaceBetStrict<'info> {
    pub bettor: Signer<'info>,
    #[account(mut, seeds = [MARKET_SEED, market.policy_document.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    /// CHECK: pinned to `market.policy_document` by `stele_gate::require_access_cpi`; Stele checks
    /// its type.
    pub policy_document: UncheckedAccount<'info>,
    /// CHECK: evaluated by the Stele program (`check_access`).
    pub access_pass: UncheckedAccount<'info>,
    /// CHECK: address-constrained to the Stele program.
    #[account(address = STELE_PROGRAM_ID)]
    pub stele_program: UncheckedAccount<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub policy_document: Pubkey,
    pub creator: Pubkey,
    pub yes_stake: u64,
    pub no_stake: u64,
    pub bet_count: u64,
    pub created_at: i64,
    pub bump: u8,
    #[max_len(MAX_QUESTION_LEN)]
    pub question: String,
}

#[event]
pub struct BetPlaced {
    pub market: Pubkey,
    pub bettor: Pubkey,
    /// The policy version the bettor's access pass names.
    pub policy_version: Pubkey,
    pub policy_version_number: u32,
    pub stake: u64,
    pub yes_stake: u64,
    pub no_stake: u64,
    pub bet_count: u64,
    pub slot: u64,
    pub side: u8,
    /// True for `place_bet_strict` (CPI), false for `place_bet` (check mode).
    pub strict: bool,
}

#[error_code]
pub enum DemoError {
    #[msg("The question must be 1 to 96 bytes")]
    InvalidQuestion,
    #[msg("The policy document is not a Stele document")]
    NotAStelePolicy,
    #[msg("Side must be 0 (no) or 1 (yes)")]
    InvalidSide,
    #[msg("Stake must be between 1 and 1,000,000,000,000")]
    InvalidStake,
    #[msg("Arithmetic overflow")]
    Overflow,
}
