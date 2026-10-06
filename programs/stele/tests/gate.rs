//! Stele Gate: access passes written only by verified acceptances, the current-version rule, the
//! `check_access` CPI, and a protected program (the Gate demo market) that cannot be called
//! successfully without a valid pass — in check mode and in strict (CPI) mode.

#![allow(clippy::result_large_err)]

mod common;

use anchor_lang::{AccountDeserialize, InstructionData};
use common::*;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;
use stele::error::SteleError;
use stele::state::AccessPass;
use stele_gate::GateError;
use stele_gate_demo::Market;

const GATE_DEMO_SO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../target/deploy/stele_gate_demo.so"
);

fn gate_demo_id() -> Address {
    to_addr(&stele_gate_demo::ID)
}

fn deploy_gate_demo(env: &mut Env) {
    let so = std::fs::read(GATE_DEMO_SO).expect(
        "missing target/deploy/stele_gate_demo.so — run scripts/dev/build-program.sh first",
    );
    env.svm
        .add_program(gate_demo_id(), &so)
        .expect("load Gate demo");
}

fn access_pass_pda(document: &Address, holder: &Address) -> Address {
    pda(&[
        stele::constants::ACCESS_PASS_SEED,
        document.as_ref(),
        holder.as_ref(),
    ])
}

fn market_pda(document: &Address) -> Address {
    Address::find_program_address(
        &[stele_gate_demo::MARKET_SEED, document.as_ref()],
        &gate_demo_id(),
    )
    .0
}

fn gated_ix(relayer: &Address, holder: &Address, t: &Target, a: &AcceptParams) -> Instruction {
    ix(
        stele::instruction::RecordGatedAcceptance {
            nonce_index: a.nonce_index,
            nonce_tag: a.nonce_tag,
            issued_at: a.issued_at,
            expires_at: a.expires_at,
        },
        vec![
            signer_rw(*relayer),
            ro(config_pda()),
            ro(t.org),
            ro(t.document),
            ro(t.version),
            rw(t.shard),
            ro(*holder),
            rw(access_pass_pda(&t.document, holder)),
            ro(system_program()),
            ro(instructions_sysvar()),
        ],
    )
}

/// The user signs the ordinary acceptance message; the relayer records it with the gated
/// instruction, naming `holder` (normally the user) as the pass holder.
fn accept_gated_as(
    env: &mut Env,
    user: &Keypair,
    holder: &Address,
    t: &Target,
    a: &AcceptParams,
) -> TxResult {
    let message = env.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), a);
    let sig = user.sign_message(message.as_bytes());
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(sig.as_ref());
    let ed = ed25519_ix(&user.pubkey().to_bytes(), &sig_bytes, message.as_bytes());
    let relayer = env.relayer.insecure_clone();
    let rec = gated_ix(&relayer.pubkey(), holder, t, a);
    env.send(&[ed, rec], &relayer, &[])
}

fn accept_gated(env: &mut Env, user: &Keypair, t: &Target, a: &AcceptParams) -> TxResult {
    let holder = user.pubkey();
    accept_gated_as(env, user, &holder, t, a)
}

fn pass(env: &Env, document: &Address, holder: &Address) -> AccessPass {
    let acc = env
        .raw_account(&access_pass_pda(document, holder))
        .expect("access pass exists");
    AccessPass::try_deserialize(&mut acc.data.as_slice()).expect("access pass")
}

fn check_ix(document: &Address, pass: &Address, holder: &Address, min_version: u32) -> Instruction {
    ix(
        stele::instruction::CheckAccess {
            args: stele::instructions::CheckAccessArgs { min_version },
        },
        vec![ro(*document), ro(*pass), signer_ro(*holder)],
    )
}

fn check(env: &mut Env, document: &Address, holder: &Keypair, min_version: u32) -> TxResult {
    let pass = access_pass_pda(document, &holder.pubkey());
    let i = check_ix(document, &pass, &holder.pubkey(), min_version);
    let relayer = env.relayer.insecure_clone();
    env.send(&[i], &relayer, &[holder])
}

fn create_market(env: &mut Env, creator: &Keypair, document: &Address) -> Address {
    let market = market_pda(document);
    let i = Instruction {
        program_id: gate_demo_id(),
        accounts: vec![
            signer_rw(creator.pubkey()),
            ro(*document),
            rw(market),
            ro(system_program()),
        ],
        data: stele_gate_demo::instruction::CreateMarket {
            question: "Will the demo pass its tests?".into(),
        }
        .data(),
    };
    assert_ok(&env.send(&[i], creator, &[]));
    market
}

struct Bet {
    market: Address,
    document: Address,
    pass: Address,
    strict: bool,
    stele_program: Address,
}

fn bet_ix(bettor: &Address, b: &Bet, side: u8, stake: u64) -> Instruction {
    let mut accounts = vec![
        AccountMeta::new_readonly(*bettor, true),
        rw(b.market),
        ro(b.document),
        ro(b.pass),
    ];
    let data = if b.strict {
        accounts.push(ro(b.stele_program));
        stele_gate_demo::instruction::PlaceBetStrict { side, stake }.data()
    } else {
        stele_gate_demo::instruction::PlaceBet { side, stake }.data()
    };
    Instruction {
        program_id: gate_demo_id(),
        accounts,
        data,
    }
}

fn place_bet(env: &mut Env, bettor: &Keypair, b: &Bet) -> TxResult {
    let i = bet_ix(&bettor.pubkey(), b, 1, 100);
    let relayer = env.relayer.insecure_clone();
    env.send(&[i], &relayer, &[bettor])
}

fn bet_for(t: &Target, market: Address, holder: &Address, strict: bool) -> Bet {
    Bet {
        market,
        document: t.document,
        pass: access_pass_pda(&t.document, holder),
        strict,
        stele_program: program_id(),
    }
}

fn market(env: &Env, a: &Address) -> Market {
    let acc = env.raw_account(a).expect("market");
    Market::try_deserialize(&mut acc.data.as_slice()).expect("market")
}

fn gate_err(e: GateError) -> u32 {
    e as u32
}

// ---- access passes -------------------------------------------------------------------------------

#[test]
fn a_gated_acceptance_creates_the_holders_pass_and_the_user_pays_nothing() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    let user_lamports = env.lamports(&user.pubkey());
    let a = env.default_accept(1);

    let meta = accept_gated(&mut env, &user, &t, &a).expect("gated acceptance recorded");
    let p = pass(&env, &t.document, &user.pubkey());
    assert_eq!(p.organization, to_pk(&t.org));
    assert_eq!(p.document, to_pk(&t.document));
    assert_eq!(p.holder, to_pk(&user.pubkey()));
    assert_eq!(p.version, to_pk(&t.version));
    assert_eq!(p.version_number, 1);
    assert_eq!(p.acceptance_count, 1);
    assert_eq!(p.first_accepted_at, p.accepted_at);
    assert_ne!(p.acceptance_id, [0u8; 32]);
    // The acceptance is an ordinary one: same shard, nonce and accumulator.
    assert_eq!(env.shard(&t.shard).accepted_count, 1);
    // Fee and the pass's rent come from the relayer; the user's balance is untouched.
    assert_eq!(env.lamports(&user.pubkey()), user_lamports);
    println!(
        "gated acceptance: {} CU, pass {} bytes",
        meta.compute_units_consumed,
        env.raw_account(&access_pass_pda(&t.document, &user.pubkey()))
            .unwrap()
            .data
            .len()
    );
    assert_eq!(
        env.raw_account(&access_pass_pda(&t.document, &user.pubkey()))
            .unwrap()
            .data
            .len(),
        stele_gate::ACCESS_PASS_LEN
    );

    assert_ok(&check(&mut env, &t.document, &user, 0));
    assert_ok(&check(&mut env, &t.document, &user, 1));
}

#[test]
fn the_pass_belongs_to_the_signer_never_to_an_account_the_relayer_names() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    let someone_else = Keypair::new().pubkey();
    let a = env.default_accept(2);
    assert_stele_err(
        &accept_gated_as(&mut env, &user, &someone_else, &t, &a),
        SteleError::AccessPassMismatch,
    );
    assert!(env
        .raw_account(&access_pass_pda(&t.document, &someone_else))
        .is_none());
    assert_eq!(env.shard(&t.shard).accepted_count, 0, "nothing recorded");
}

#[test]
fn a_tampered_or_replayed_gated_acceptance_creates_no_pass() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    let a = env.default_accept(3);

    // Signed over a different message (the program rebuilds the real one).
    let mut message = env.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), &a);
    message = message.replace("Acme Inc.", "Acme Inc!");
    let sig = user.sign_message(message.as_bytes());
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(sig.as_ref());
    let ed = ed25519_ix(&user.pubkey().to_bytes(), &sig_bytes, message.as_bytes());
    let relayer = env.relayer.insecure_clone();
    let rec = gated_ix(&relayer.pubkey(), &user.pubkey(), &t, &a);
    assert_stele_err(
        &env.send(&[ed, rec], &relayer, &[]),
        SteleError::MessageMismatch,
    );
    assert!(env
        .raw_account(&access_pass_pda(&t.document, &user.pubkey()))
        .is_none());

    // Without the Ed25519 instruction there is no verified signer at all.
    let rec = gated_ix(&relayer.pubkey(), &user.pubkey(), &t, &a);
    assert_failed(&env.send(&[rec], &relayer, &[]));

    // A valid acceptance, then the same signed message again: the nonce is spent.
    assert_ok(&accept_gated(&mut env, &user, &t, &a));
    assert_stele_err(
        &accept_gated(&mut env, &user, &t, &a),
        SteleError::NonceAlreadyUsed,
    );
    assert_eq!(pass(&env, &t.document, &user.pubkey()).acceptance_count, 1);
}

#[test]
fn publishing_a_new_version_makes_the_pass_outdated_until_it_is_accepted() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    let a = env.default_accept(4);
    assert_ok(&accept_gated(&mut env, &user, &t, &a));
    let first = pass(&env, &t.document, &user.pubkey());

    env.advance(60);
    let v2 = env.publish(&fx.owner, &t.org, &t.document, "version two content");
    // The evidence for v1 is untouched; the permission now requires v2.
    assert_eq!(
        pass(&env, &t.document, &user.pubkey()).version,
        to_pk(&t.version)
    );
    assert_stele_err(
        &check(&mut env, &t.document, &user, 0),
        SteleError::AccessPassOutdated,
    );
    assert_ok(&check(&mut env, &t.document, &user, 1));
    assert_stele_err(
        &check(&mut env, &t.document, &user, 2),
        SteleError::AccessPassOutdated,
    );
    assert_stele_err(
        &check(&mut env, &t.document, &user, 3),
        SteleError::InvalidAccessRequirement,
    );

    // Accepting the old version is impossible (only the current one can be recorded).
    let stale = env.default_accept(5);
    assert_stele_err(
        &accept_gated(&mut env, &user, &t, &stale),
        SteleError::VersionNotCurrent,
    );

    let t2 = Target { version: v2, ..t };
    let a2 = env.default_accept(6);
    assert_ok(&accept_gated(&mut env, &user, &t2, &a2));
    let second = pass(&env, &t.document, &user.pubkey());
    assert_eq!(second.version, to_pk(&v2));
    assert_eq!(second.version_number, 2);
    assert_eq!(second.acceptance_count, 2);
    assert_eq!(second.first_accepted_at, first.first_accepted_at);
    assert_ne!(second.acceptance_id, first.acceptance_id);
    assert_ok(&check(&mut env, &t.document, &user, 0));
    assert_ok(&check(&mut env, &t.document, &user, 2));
}

#[test]
fn check_access_refuses_missing_foreign_and_unsigned_passes() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let alice = env.funded();
    let mallory = env.funded();
    let a = env.default_accept(7);
    assert_ok(&accept_gated(&mut env, &alice, &t, &a));

    // Mallory never accepted.
    assert_stele_err(
        &check(&mut env, &t.document, &mallory, 0),
        SteleError::AccessPassMissing,
    );

    // Mallory presents Alice's pass.
    let alices = access_pass_pda(&t.document, &alice.pubkey());
    let i = check_ix(&t.document, &alices, &mallory.pubkey(), 0);
    let relayer = env.relayer.insecure_clone();
    assert_stele_err(
        &env.send(&[i], &relayer, &[&mallory]),
        SteleError::AccessPassMismatch,
    );

    // Alice's pass without Alice's signature.
    let mut i = check_ix(&t.document, &alices, &alice.pubkey(), 0);
    i.accounts[2].is_signer = false;
    assert_failed(&env.send(&[i], &relayer, &[]));

    // Another document of the same organization: Alice's pass is for the first one only.
    let (other, res) = env.create_document(&fx.owner, &t.org, "risk", "risk-disclosure", "en-US");
    assert_ok(&res);
    env.publish(&fx.owner, &t.org, &other, "risk text");
    assert_stele_err(
        &check(&mut env, &other, &alice, 0),
        SteleError::AccessPassMissing,
    );
}

#[test]
fn gated_acceptance_cannot_be_invoked_through_cpi() {
    let mut env = Env::new();
    let probe = env.deploy_cpi_probe();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    let a = env.default_accept(8);
    let message = env.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), &a);
    let sig = user.sign_message(message.as_bytes());
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(sig.as_ref());
    let ed = ed25519_ix(&user.pubkey().to_bytes(), &sig_bytes, message.as_bytes());
    let relayer = env.relayer.insecure_clone();
    let rec = gated_ix(&relayer.pubkey(), &user.pubkey(), &t, &a);
    let mut accounts = vec![ro(program_id())];
    accounts.extend(rec.accounts.iter().cloned());
    let forwarded = Instruction {
        program_id: probe,
        accounts,
        data: rec.data.clone(),
    };
    assert_stele_err(
        &env.send(&[ed, forwarded], &relayer, &[]),
        SteleError::CpiNotAllowed,
    );
}

// ---- a protected program -------------------------------------------------------------------------

fn protected_market() -> (Env, Fixture, Address) {
    let mut env = Env::new();
    deploy_gate_demo(&mut env);
    let fx = env.fixture();
    let creator = env.funded();
    let market = create_market(&mut env, &creator, &fx.target.document);
    (env, fx, market)
}

#[test]
fn the_protected_program_runs_only_with_a_current_pass_in_both_modes() {
    for strict in [false, true] {
        let (mut env, fx, m) = protected_market();
        let t = fx.target;
        let user = env.funded();
        let b = bet_for(&t, m, &user.pubkey(), strict);

        // 1. No pass: a direct call to the program fails.
        let res = place_bet(&mut env, &user, &b);
        if strict {
            assert_stele_err(&res, SteleError::AccessPassMissing);
        } else {
            assert_custom(&res, gate_err(GateError::AccessPassMissing));
        }

        // 2. Accept v1 (gated): the same call succeeds.
        let a = env.default_accept(10);
        assert_ok(&accept_gated(&mut env, &user, &t, &a));
        let meta = place_bet(&mut env, &user, &b).expect("bet with a current pass");
        println!(
            "place_bet{}: {} CU",
            if strict { "_strict" } else { "" },
            meta.compute_units_consumed
        );
        let after = market(&env, &m);
        assert_eq!(after.bet_count, 1);
        assert_eq!(after.yes_stake, 100);

        // 3. Publish v2: the v1 pass no longer satisfies the requirement.
        env.advance(60);
        let v2 = env.publish(&fx.owner, &t.org, &t.document, "version two content");
        let res = place_bet(&mut env, &user, &b);
        if strict {
            assert_stele_err(&res, SteleError::AccessPassOutdated);
        } else {
            assert_custom(&res, gate_err(GateError::AccessPassOutdated));
        }

        // 4. Accept v2: allowed again.
        let t2 = Target { version: v2, ..t };
        let a2 = env.default_accept(11);
        assert_ok(&accept_gated(&mut env, &user, &t2, &a2));
        env.advance(1);
        assert_ok(&place_bet(&mut env, &user, &b));
        assert_eq!(market(&env, &m).bet_count, 2);
    }
}

#[test]
fn direct_bypass_attempts_are_rejected_on_chain() {
    for strict in [false, true] {
        let (mut env, fx, m) = protected_market();
        let t = fx.target;
        let alice = env.funded();
        let mallory = env.funded();
        let a = env.default_accept(20);
        assert_ok(&accept_gated(&mut env, &alice, &t, &a));
        let relayer = env.relayer.insecure_clone();

        // Mallory presents Alice's valid pass.
        let stolen = Bet {
            pass: access_pass_pda(&t.document, &alice.pubkey()),
            ..bet_for(&t, m, &mallory.pubkey(), strict)
        };
        let res = place_bet(&mut env, &mallory, &stolen);
        if strict {
            assert_stele_err(&res, SteleError::AccessPassMismatch);
        } else {
            assert_custom(&res, gate_err(GateError::AccessPassMismatch));
        }

        // Mallory uses Alice's pass and names Alice as the bettor, without Alice's signature.
        let mut i = bet_ix(
            &alice.pubkey(),
            &bet_for(&t, m, &alice.pubkey(), strict),
            1,
            100,
        );
        i.accounts[0].is_signer = false;
        assert_failed(&env.send(&[i], &relayer, &[]));

        // Mallory publishes her own policy, accepts it, and presents that document and pass.
        let own_owner = env.funded();
        let own_org = env.create_org(&own_owner, "Mallory Ltd", None);
        let (own_doc, res) =
            env.create_document(&own_owner, &own_org, "terms", "terms-of-service", "en-US");
        assert_ok(&res);
        let own_v1 = env.publish(&own_owner, &own_org, &own_doc, "anything goes");
        let relayer_pk = relayer.pubkey();
        let (own_shard, res) = env.create_shard(&own_owner, &own_org, 0, &relayer_pk);
        assert_ok(&res);
        let own = Target {
            org: own_org,
            document: own_doc,
            version: own_v1,
            shard: own_shard,
        };
        let a = env.default_accept(21);
        assert_ok(&accept_gated(&mut env, &mallory, &own, &a));
        let forged = Bet {
            market: m,
            document: own_doc,
            pass: access_pass_pda(&own_doc, &mallory.pubkey()),
            strict,
            stele_program: program_id(),
        };
        assert_custom(
            &place_bet(&mut env, &mallory, &forged),
            gate_err(GateError::PolicyMismatch),
        );

        // A look-alike "pass" account Mallory controls.
        let fake = env.funded().pubkey();
        let fake_bet = Bet {
            pass: fake,
            ..bet_for(&t, m, &mallory.pubkey(), strict)
        };
        let res = place_bet(&mut env, &mallory, &fake_bet);
        if strict {
            assert_stele_err(&res, SteleError::AccessPassMismatch);
        } else {
            assert_custom(&res, gate_err(GateError::AccessPassInvalid));
        }

        if strict {
            // A fake "Stele" program for the CPI.
            let impostor = Bet {
                stele_program: env.deploy_cpi_probe(),
                ..bet_for(&t, m, &alice.pubkey(), true)
            };
            assert_failed(&place_bet(&mut env, &alice, &impostor));
        }

        assert_eq!(market(&env, &m).bet_count, 0, "no bypass placed a bet");
        // Alice herself can bet.
        assert_ok(&place_bet(
            &mut env,
            &alice,
            &bet_for(&t, m, &alice.pubkey(), strict),
        ));
    }
}

#[test]
fn a_market_must_be_guarded_by_a_stele_document() {
    let mut env = Env::new();
    deploy_gate_demo(&mut env);
    let creator = env.funded();
    let not_a_document = env.funded().pubkey();
    let i = Instruction {
        program_id: gate_demo_id(),
        accounts: vec![
            signer_rw(creator.pubkey()),
            ro(not_a_document),
            rw(market_pda(&not_a_document)),
            ro(system_program()),
        ],
        data: stele_gate_demo::instruction::CreateMarket {
            question: "?".into(),
        }
        .data(),
    };
    assert_failed(&env.send(&[i], &creator, &[]));
}
