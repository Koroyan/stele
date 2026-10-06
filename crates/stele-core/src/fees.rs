//! Transaction-fee arithmetic for organization-sponsored recordings (PROTOCOL_SPEC.md §13).
//!
//! The program reimburses its designated relayer from an organization's Sponsor Vault. The amount
//! is derived from the transaction's own compute-budget instructions with the same formula the
//! runtime uses to charge the fee payer, so the vault pays the network fee of a valid recording and
//! nothing more:
//!
//! `fee = LAMPORTS_PER_SIGNATURE × (transaction signatures + precompile signatures)
//!        + ceil(compute-unit limit × compute-unit price / 1_000_000)`
//!
//! Inputs the program cannot observe are counted at their minimum (one transaction signature),
//! so any error is an under-reimbursement.

use crate::constants::{LAMPORTS_PER_SIGNATURE, MICRO_LAMPORTS_PER_LAMPORT};

/// `ComputeBudgetInstruction::SetComputeUnitLimit` discriminant (borsh enum index).
pub const SET_COMPUTE_UNIT_LIMIT: u8 = 2;
/// `ComputeBudgetInstruction::SetComputeUnitPrice` discriminant (borsh enum index).
pub const SET_COMPUTE_UNIT_PRICE: u8 = 3;

/// The compute-budget settings of a transaction that affect its fee.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ComputeBudget {
    pub unit_limit: Option<u32>,
    /// Micro-lamports per compute unit.
    pub unit_price: Option<u64>,
}

impl ComputeBudget {
    /// Folds one compute-budget instruction's data into the settings. Instructions that do not
    /// affect the fee, or that are malformed, are ignored (the runtime rejects malformed ones).
    pub fn apply(&mut self, data: &[u8]) {
        match data.split_first() {
            Some((&SET_COMPUTE_UNIT_LIMIT, rest)) if rest.len() == 4 => {
                self.unit_limit = Some(u32::from_le_bytes([rest[0], rest[1], rest[2], rest[3]]));
            }
            Some((&SET_COMPUTE_UNIT_PRICE, rest)) if rest.len() == 8 => {
                let mut b = [0u8; 8];
                b.copy_from_slice(rest);
                self.unit_price = Some(u64::from_le_bytes(b));
            }
            _ => {}
        }
    }

    /// Prioritization fee in lamports. Without an explicit limit the runtime would use a default
    /// that depends on the instruction mix; the vault then reimburses no priority fee at all.
    pub fn priority_fee(&self) -> Option<u64> {
        match (self.unit_limit, self.unit_price) {
            (Some(limit), Some(price)) => {
                let micro = u128::from(limit).checked_mul(u128::from(price))?;
                let lamports = micro.div_ceil(u128::from(MICRO_LAMPORTS_PER_LAMPORT));
                u64::try_from(lamports).ok()
            }
            _ => Some(0),
        }
    }
}

/// The fee of a transaction with `signatures` signatures in total (transaction signatures plus
/// precompile-verified signatures) and the given compute budget.
pub fn transaction_fee(signatures: u64, budget: &ComputeBudget) -> Option<u64> {
    LAMPORTS_PER_SIGNATURE
        .checked_mul(signatures)?
        .checked_add(budget.priority_fee()?)
}

/// UTC day number used for daily sponsorship limits.
pub fn utc_day(unix_timestamp: i64) -> i64 {
    unix_timestamp.div_euclid(86_400)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limit(units: u32) -> Vec<u8> {
        let mut d = vec![SET_COMPUTE_UNIT_LIMIT];
        d.extend_from_slice(&units.to_le_bytes());
        d
    }
    fn price(micro: u64) -> Vec<u8> {
        let mut d = vec![SET_COMPUTE_UNIT_PRICE];
        d.extend_from_slice(&micro.to_le_bytes());
        d
    }

    #[test]
    fn base_fee_only_without_a_price() {
        let mut b = ComputeBudget::default();
        b.apply(&limit(60_000));
        assert_eq!(transaction_fee(2, &b), Some(10_000));
    }

    #[test]
    fn priority_fee_rounds_up_like_the_runtime() {
        let mut b = ComputeBudget::default();
        b.apply(&limit(60_000));
        b.apply(&price(1));
        // 60_000 micro-lamports = 0.06 lamports -> 1 lamport.
        assert_eq!(b.priority_fee(), Some(1));
        b.apply(&price(10_000));
        assert_eq!(b.priority_fee(), Some(600));
        assert_eq!(transaction_fee(2, &b), Some(10_600));
    }

    #[test]
    fn a_price_without_a_limit_is_not_reimbursed() {
        let mut b = ComputeBudget::default();
        b.apply(&price(1_000_000));
        assert_eq!(b.priority_fee(), Some(0));
    }

    #[test]
    fn malformed_and_unrelated_instructions_are_ignored() {
        let mut b = ComputeBudget::default();
        b.apply(&[]);
        b.apply(&[SET_COMPUTE_UNIT_LIMIT, 1, 2]);
        b.apply(&[1, 0, 0, 1, 0]); // RequestHeapFrame
        assert_eq!(b, ComputeBudget::default());
    }

    #[test]
    fn extreme_values_do_not_overflow_silently() {
        let mut b = ComputeBudget::default();
        b.apply(&limit(u32::MAX));
        b.apply(&price(u64::MAX));
        // u32::MAX * u64::MAX / 1e6 does not fit in u64.
        assert_eq!(b.priority_fee(), None);
        assert_eq!(transaction_fee(u64::MAX, &ComputeBudget::default()), None);
    }

    #[test]
    fn days() {
        assert_eq!(utc_day(0), 0);
        assert_eq!(utc_day(86_399), 0);
        assert_eq!(utc_day(86_400), 1);
        assert_eq!(utc_day(-1), -1);
    }
}
