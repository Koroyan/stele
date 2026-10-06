//! Organization fee sponsorship: a sponsored nonce shard reimburses its designated relayer the
//! exact network fee of a *valid* recording, within per-record and daily caps, and never changes
//! who authorized the record. The user never pays and needs no SOL at all. Sponsorship adds no
//! account to the recording transaction: the shard is the deposit address.

mod common;

use common::*;
use solana_address::Address;
use solana_keypair::Keypair;
use solana_signer::Signer;
use stele::error::SteleError;
use stele::state::{NonceShard, ShardSponsorship};
use stele_core::constants::{MAX_SPONSOR_FEE_PER_RECORD, ROLE_ADMIN};

const ONE_SOL: u64 = 1_000_000_000;
/// 2 signatures (relayer + Ed25519) × 5,000 + ceil(60,000 CU × 10,000 µ-lamports / 1e6).
const EXPECTED_FEE: u64 = 10_600;

fn budget() -> Vec<solana_instruction::Instruction> {
    vec![cu_limit_ix(60_000), cu_price_ix(10_000)]
}

/// Fixture with sponsorship enabled (generous limits) and 1 SOL deposited on shard 0.
fn sponsored(env: &mut Env) -> Fixture {
    let fx = env.fixture();
    assert_ok(&env.enable_sponsorship(
        &fx.owner,
        &fx.target.org,
        &fx.target.shard,
        50_000,
        1_000_000,
    ));
    let funder = env.funded();
    env.deposit(&funder, &fx.target.shard, ONE_SOL);
    fx
}

fn rent(env: &Env, shard: &Address) -> u64 {
    let len = env.raw_account(shard).unwrap().data.len();
    env.svm.minimum_balance_for_rent_exemption(len)
}

#[test]
fn shard_reimburses_the_relayer_the_exact_fee_and_the_user_pays_nothing() {
    let mut env = Env::new();
    let fx = sponsored(&mut env);
    let shard = fx.target.shard;
    assert_eq!(
        env.raw_account(&shard).unwrap().data.len(),
        ShardSponsorship::SPONSORED_ACCOUNT_SIZE
    );
    // A user with no SOL at all.
    let user = Keypair::new();
    assert_eq!(env.lamports(&user.pubkey()), 0);

    let relayer = env.relayer.pubkey();
    let relayer_before = env.lamports(&relayer);
    let shard_before = env.lamports(&shard);

    let meta = env
        .accept_with_budget(&user, &fx.target, &env.default_accept(1), &budget())
        .expect("sponsored acceptance recorded");
    println!(
        "sponsored record_acceptance compute units: {}",
        meta.compute_units_consumed
    );
    assert!(meta.compute_units_consumed < 50_000);
    let events = meta
        .logs
        .iter()
        .filter(|l| l.starts_with("Program data: "))
        .count();
    assert_eq!(events, 2, "AcceptanceRecorded + SponsorReimbursed");

    let relayer_after = env.lamports(&relayer);
    let paid = shard_before - env.lamports(&shard);
    println!(
        "relayer was charged {} lamports, the shard reimbursed {paid}",
        relayer_before + paid - relayer_after
    );
    assert_eq!(paid, EXPECTED_FEE);
    assert_eq!(
        relayer_after, relayer_before,
        "relayer is made whole, no more"
    );
    assert_eq!(env.lamports(&user.pubkey()), 0, "the user paid nothing");

    let s = env.sponsorship(&shard).unwrap();
    assert_eq!(s.spent_today, EXPECTED_FEE);
    assert_eq!(s.total_reimbursed, EXPECTED_FEE);
    assert_eq!(s.reimbursed_count, 1);
    assert_eq!(env.shard(&shard).accepted_count, 1);
}

#[test]
fn recording_transactions_are_unchanged_by_sponsorship() {
    let mut env = Env::new();
    let fx = env.fixture();
    let user = Keypair::new();
    // Not sponsored: the relayer pays (Stele-sponsored model) and nothing else changes.
    let relayer = env.relayer.pubkey();
    let before = env.lamports(&relayer);
    assert_ok(&env.accept_with_budget(&user, &fx.target, &env.default_accept(1), &budget()));
    assert_eq!(before - env.lamports(&relayer), EXPECTED_FEE);
    assert!(env.sponsorship(&fx.target.shard).is_none());
    // The very same instruction layout is reimbursed once the organization enables sponsorship.
    assert_ok(&env.enable_sponsorship(
        &fx.owner,
        &fx.target.org,
        &fx.target.shard,
        50_000,
        1_000_000,
    ));
    let funder = env.funded();
    env.deposit(&funder, &fx.target.shard, ONE_SOL);
    let before = env.lamports(&relayer);
    assert_ok(&env.accept(&user, &fx.target, &env.default_accept(2)));
    assert_eq!(env.lamports(&relayer), before);
}

#[test]
fn reimbursement_is_capped_per_record() {
    let mut env = Env::new();
    let fx = env.fixture();
    let shard = fx.target.shard;
    assert_ok(&env.enable_sponsorship(&fx.owner, &fx.target.org, &shard, 6_000, 1_000_000));
    let funder = env.funded();
    env.deposit(&funder, &shard, ONE_SOL);
    let before = env.lamports(&shard);
    // An inflated priority fee is paid by the relayer but reimbursed only up to the cap.
    let inflated = vec![cu_limit_ix(60_000), cu_price_ix(5_000_000)];
    assert_ok(&env.accept_with_budget(
        &Keypair::new(),
        &fx.target,
        &env.default_accept(1),
        &inflated,
    ));
    assert_eq!(before - env.lamports(&shard), 6_000);
}

#[test]
fn daily_limit_stops_payment_but_never_blocks_a_recording() {
    let mut env = Env::new();
    let fx = env.fixture();
    let shard = fx.target.shard;
    assert_ok(&env.enable_sponsorship(
        &fx.owner,
        &fx.target.org,
        &shard,
        EXPECTED_FEE,
        2 * EXPECTED_FEE + 1,
    ));
    let funder = env.funded();
    env.deposit(&funder, &shard, ONE_SOL);
    let start = env.lamports(&shard);
    for n in 1..=3 {
        assert_ok(&env.accept_with_budget(
            &Keypair::new(),
            &fx.target,
            &env.default_accept(n),
            &budget(),
        ));
    }
    // Three recordings, two reimbursements.
    assert_eq!(env.shard(&shard).accepted_count, 3);
    assert_eq!(start - env.lamports(&shard), 2 * EXPECTED_FEE);
    assert_eq!(env.sponsorship(&shard).unwrap().reimbursed_count, 2);

    env.advance(86_400);
    assert_ok(&env.accept_with_budget(
        &Keypair::new(),
        &fx.target,
        &env.default_accept(4),
        &budget(),
    ));
    let s = env.sponsorship(&shard).unwrap();
    assert_eq!(s.spent_today, EXPECTED_FEE);
    assert_eq!(s.reimbursed_count, 3);
}

#[test]
fn paused_or_empty_shards_pay_nothing_and_never_dip_below_rent() {
    let mut env = Env::new();
    let fx = env.fixture();
    let shard = fx.target.shard;
    assert_ok(&env.enable_sponsorship(&fx.owner, &fx.target.org, &shard, 50_000, 1_000_000));
    // Only the rent-exempt minimum: nothing to spend, the recording still succeeds.
    assert_eq!(env.lamports(&shard), rent(&env, &shard));
    assert_ok(&env.accept_with_budget(
        &Keypair::new(),
        &fx.target,
        &env.default_accept(1),
        &budget(),
    ));
    assert_eq!(env.lamports(&shard), rent(&env, &shard));

    let funder = env.funded();
    env.deposit(&funder, &shard, ONE_SOL);
    assert_ok(&env.update_sponsorship(&fx.owner, &fx.target.org, &shard, 50_000, 1_000_000, true));
    let before = env.lamports(&shard);
    assert_ok(&env.accept_with_budget(
        &Keypair::new(),
        &fx.target,
        &env.default_accept(2),
        &budget(),
    ));
    assert_eq!(env.lamports(&shard), before, "paused: nothing paid");
    assert_ok(&env.update_sponsorship(&fx.owner, &fx.target.org, &shard, 50_000, 1_000_000, false));
    assert_ok(&env.accept_with_budget(
        &Keypair::new(),
        &fx.target,
        &env.default_accept(3),
        &budget(),
    ));
    assert_eq!(before - env.lamports(&shard), EXPECTED_FEE);
}

#[test]
fn sponsorship_never_turns_an_invalid_recording_into_a_valid_one() {
    let mut env = Env::new();
    let fx = sponsored(&mut env);
    let shard = fx.target.shard;
    let before = env.lamports(&shard);
    let user = Keypair::new();
    let a = env.default_accept(1);
    // Tampered message: rejected exactly as without sponsorship, and nothing is paid.
    let message = env
        .acceptance_message(
            &fx.target.org,
            &fx.target.version,
            &shard,
            &user.pubkey(),
            &a,
        )
        .replace("Terms of Service", "Terms of Servic3");
    assert_stele_err(
        &env.accept_message(&user, &fx.target, &a, message.as_bytes()),
        SteleError::MessageMismatch,
    );
    assert_eq!(env.lamports(&shard), before);

    // Replays are rejected and not reimbursed.
    assert_ok(&env.accept_with_budget(&user, &fx.target, &a, &budget()));
    let after_first = env.lamports(&shard);
    assert_stele_err(
        &env.accept_with_budget(&user, &fx.target, &a, &budget()),
        SteleError::NonceAlreadyUsed,
    );
    assert_eq!(env.lamports(&shard), after_first);
    assert_eq!(before - after_first, EXPECTED_FEE);
}

#[test]
fn only_the_designated_relayer_is_paid() {
    let mut env = Env::new();
    let fx = env.fixture();
    let org = fx.target.org;
    // Sponsorship cannot be enabled on an open shard (anyone could relay and be paid).
    let (open_shard, res) = env.create_shard(&fx.owner, &org, 1, &Address::default());
    assert_ok(&res);
    assert_stele_err(
        &env.enable_sponsorship(&fx.owner, &org, &open_shard, 50_000, 1_000_000),
        SteleError::SponsorRequiresDesignatedRelayer,
    );
    // A shard that is later opened up stops paying.
    let shard = fx.target.shard;
    assert_ok(&env.enable_sponsorship(&fx.owner, &org, &shard, 50_000, 1_000_000));
    let funder = env.funded();
    env.deposit(&funder, &shard, ONE_SOL);
    let i = ix(
        stele::instruction::SetShardRelayer {
            relayer: Pk::default(),
        },
        vec![
            signer_ro(fx.owner.pubkey()),
            optional(None),
            ro(org),
            rw(shard),
        ],
    );
    assert_ok(&env.send(&[i], &fx.owner, &[]));
    let before = env.lamports(&shard);
    assert_ok(&env.accept_with_budget(
        &Keypair::new(),
        &fx.target,
        &env.default_accept(1),
        &budget(),
    ));
    assert_eq!(env.lamports(&shard), before);
}

#[test]
fn sponsorship_management_rules() {
    let mut env = Env::new();
    let fx = env.fixture();
    let org = fx.target.org;
    let shard = fx.target.shard;
    let stranger = env.funded();
    assert_stele_err(
        &env.enable_sponsorship(&stranger, &org, &shard, 10_000, 100_000),
        SteleError::Unauthorized,
    );
    for (max, daily) in [
        (0, 100_000),
        (
            MAX_SPONSOR_FEE_PER_RECORD + 1,
            MAX_SPONSOR_FEE_PER_RECORD + 1,
        ),
        (10_000, 9_999),
    ] {
        assert_stele_err(
            &env.enable_sponsorship(&fx.owner, &org, &shard, max, daily),
            SteleError::InvalidSponsorLimits,
        );
    }
    assert_stele_err(
        &env.update_sponsorship(&fx.owner, &org, &shard, 10_000, 100_000, false),
        SteleError::SponsorshipNotEnabled,
    );
    // Another organization's shard.
    let other_owner = env.funded();
    let other_org = env.create_org(&other_owner, "Other Org", None);
    assert_stele_err(
        &env.enable_sponsorship(&other_owner, &other_org, &shard, 10_000, 100_000),
        SteleError::ShardOrganizationMismatch,
    );
    // An admin may enable sponsorship...
    let admin = env.funded();
    assert_ok(&env.add_member(&fx.owner, &org, &admin.pubkey(), ROLE_ADMIN));
    assert_ok(&env.enable_sponsorship(&admin, &org, &shard, 10_000, 100_000));
    assert_stele_err(
        &env.enable_sponsorship(&admin, &org, &shard, 10_000, 100_000),
        SteleError::SponsorshipAlreadyEnabled,
    );
    let s = env.sponsorship(&shard).unwrap();
    assert_eq!(s.created_by, to_pk(&admin.pubkey()));
    assert_eq!(s.magic, ShardSponsorship::MAGIC);
    // ...pause it and lower limits, but not raise them or unpause.
    assert_ok(&env.update_sponsorship(&admin, &org, &shard, 8_000, 80_000, true));
    assert_stele_err(
        &env.update_sponsorship(&admin, &org, &shard, 8_000, 80_000, false),
        SteleError::Unauthorized,
    );
    assert_stele_err(
        &env.update_sponsorship(&admin, &org, &shard, 9_000, 80_000, true),
        SteleError::Unauthorized,
    );
    // The owner can do both.
    assert_ok(&env.update_sponsorship(&fx.owner, &org, &shard, 20_000, 200_000, false));
    let s = env.sponsorship(&shard).unwrap();
    assert_eq!(
        (s.max_fee_per_record, s.daily_limit, s.paused),
        (20_000, 200_000, 0)
    );
    // The shard's replay-protection state is untouched by the trailer.
    let shard_state: NonceShard = env.shard(&shard);
    assert_eq!(shard_state.accepted_count, 0);
}

#[test]
fn only_the_owner_withdraws_and_never_below_rent() {
    let mut env = Env::new();
    let fx = sponsored(&mut env);
    let org = fx.target.org;
    let shard = fx.target.shard;
    let admin = env.funded();
    assert_ok(&env.add_member(&fx.owner, &org, &admin.pubkey(), ROLE_ADMIN));
    let destination = Keypair::new().pubkey();

    assert_stele_err(
        &env.withdraw_sponsorship(&admin, &org, &shard, &admin.pubkey(), 1_000),
        SteleError::Unauthorized,
    );
    assert_stele_err(
        &env.withdraw_sponsorship(&fx.owner, &org, &shard, &destination, 0),
        SteleError::InvalidWithdrawal,
    );
    assert_stele_err(
        &env.withdraw_sponsorship(&fx.owner, &org, &shard, &destination, ONE_SOL + 1),
        SteleError::WithdrawalBelowRentMinimum,
    );
    assert_ok(&env.withdraw_sponsorship(&fx.owner, &org, &shard, &destination, ONE_SOL));
    assert_eq!(env.lamports(&destination), ONE_SOL);
    assert_eq!(env.sponsorship(&shard).unwrap().total_withdrawn, ONE_SOL);
    assert_eq!(env.lamports(&shard), rent(&env, &shard));
    // Recording still works on the emptied shard (nothing is paid).
    assert_ok(&env.accept(&Keypair::new(), &fx.target, &env.default_accept(1)));
}

#[test]
fn proofs_are_sponsored_the_same_way() {
    let mut env = Env::new();
    let fx = sponsored(&mut env);
    let shard = fx.target.shard;
    let before = env.lamports(&shard);
    let relayer = env.relayer.pubkey();
    let relayer_before = env.lamports(&relayer);
    let p = env.default_proof(9);
    assert_ok(&env.prove(&Keypair::new(), &fx.target.org, &shard, &p));
    // cu_limit 60_000 without a price: 2 × 5,000 lamports.
    assert_eq!(before - env.lamports(&shard), 10_000);
    assert_eq!(env.lamports(&relayer), relayer_before);
}
