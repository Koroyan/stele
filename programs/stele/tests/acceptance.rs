//! On-chain acceptance: signature binding, message reconstruction, replay protection,
//! Ed25519 introspection hardening, relayer gating and the completeness accumulator.

mod common;

use common::*;
use solana_instruction::Instruction;
use solana_signer::Signer;
use stele::error::SteleError;
use stele_core::acceptance::{acceptance_id, accumulate, bitmap_is_set};
use stele_core::constants::{MAX_CHALLENGE_TTL, MAX_ISSUED_AT_SKEW, SHARD_CAPACITY};

fn sign(user: &solana_keypair::Keypair, message: &[u8]) -> [u8; 64] {
    let s = user.sign_message(message);
    let mut out = [0u8; 64];
    out.copy_from_slice(s.as_ref());
    out
}

#[test]
fn records_a_valid_acceptance() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    let a = env.default_accept(7);
    let message = env.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), &a);
    assert!(message.starts_with("Stele Protocol v1 - Accept Agreement\n"));
    assert!(message.contains("Organization: Acme Inc. (unverified)\n"));
    assert!(message.contains(&format!("Account: {}\n", user.pubkey())));
    assert!(message.ends_with("\nRequested by: app.acme.example"));

    let meta = env
        .accept_message(&user, &t, &a, message.as_bytes())
        .expect("acceptance recorded");
    assert!(
        meta.logs.iter().any(|l| l.starts_with("Program data: ")),
        "event emitted"
    );
    println!(
        "record_acceptance compute units: {}",
        meta.compute_units_consumed
    );
    // Measured ≈ 29k CU. The relayer requests a 60k CU limit (ACCEPTANCE_COMPUTE_UNIT_LIMIT in
    // @stelehq/protocol); fail loudly if the program ever grows past that headroom.
    assert!(
        meta.compute_units_consumed < 50_000,
        "CU budget: {}",
        meta.compute_units_consumed
    );

    let shard = env.shard(&t.shard);
    assert!(bitmap_is_set(&shard.bitmap, 7));
    assert!(!bitmap_is_set(&shard.bitmap, 6));
    assert_eq!(shard.accepted_count, 1);
    let message_hash = hash32(message.as_bytes());
    let sig = sign(&user, message.as_bytes());
    let id = acceptance_id(
        &t.version.to_bytes(),
        &user.pubkey().to_bytes(),
        &message_hash,
        &sig,
    );
    assert_eq!(
        shard.accumulator,
        accumulate(&[0u8; 32], &id),
        "accumulator commits to the acceptance"
    );
}

#[test]
fn same_signed_message_cannot_be_recorded_twice() {
    let mut env = Env::new();
    let fx = env.fixture();
    let user = env.funded();
    let a = env.default_accept(1);
    assert_ok(&env.accept(&user, &fx.target, &a));
    assert_stele_err(
        &env.accept(&user, &fx.target, &a),
        SteleError::NonceAlreadyUsed,
    );
    // A fresh challenge (new nonce) is a new, distinct acceptance.
    let a2 = env.default_accept(2);
    assert_ok(&env.accept(&user, &fx.target, &a2));
    assert_eq!(env.shard(&fx.target.shard).accepted_count, 2);
}

#[test]
fn replay_after_expiry_is_rejected() {
    let mut env = Env::new();
    let fx = env.fixture();
    let user = env.funded();
    let a = env.default_accept(3);
    let message = env.acceptance_message(
        &fx.target.org,
        &fx.target.version,
        &fx.target.shard,
        &user.pubkey(),
        &a,
    );
    env.advance(601);
    assert_stele_err(
        &env.accept_message(&user, &fx.target, &a, message.as_bytes()),
        SteleError::AcceptanceExpired,
    );
}

#[test]
fn validity_window_rules() {
    let mut env = Env::new();
    let fx = env.fixture();
    let user = env.funded();
    let now = env.now();
    let mut a = env.default_accept(4);
    a.issued_at = now + MAX_ISSUED_AT_SKEW + 1;
    a.expires_at = a.issued_at + 60;
    assert_stele_err(
        &env.accept(&user, &fx.target, &a),
        SteleError::IssuedInFuture,
    );
    let mut a = env.default_accept(4);
    a.expires_at = a.issued_at + MAX_CHALLENGE_TTL + 1;
    assert_stele_err(
        &env.accept(&user, &fx.target, &a),
        SteleError::InvalidAcceptanceWindow,
    );
    let mut a = env.default_accept(4);
    a.expires_at = a.issued_at;
    assert_stele_err(
        &env.accept(&user, &fx.target, &a),
        SteleError::InvalidAcceptanceWindow,
    );
    // Issued well before the version existed.
    let mut a = env.default_accept(4);
    a.issued_at = now - 3_000;
    a.expires_at = now + 300;
    assert_stele_err(
        &env.accept(&user, &fx.target, &a),
        SteleError::IssuedBeforePublication,
    );
    let mut a = env.default_accept(SHARD_CAPACITY);
    a.nonce_index = SHARD_CAPACITY;
    assert_stele_err(
        &env.accept(&user, &fx.target, &a),
        SteleError::NonceOutOfRange,
    );
}

#[test]
fn signature_is_bound_to_signer_account() {
    let mut env = Env::new();
    let fx = env.fixture();
    let victim = env.funded();
    let attacker = env.funded();
    let a = env.default_accept(5);
    // Message names the victim but the attacker signs it.
    let message = env.acceptance_message(
        &fx.target.org,
        &fx.target.version,
        &fx.target.shard,
        &victim.pubkey(),
        &a,
    );
    assert_stele_err(
        &env.accept_message(&attacker, &fx.target, &a, message.as_bytes()),
        SteleError::MessageMismatch,
    );
}

#[test]
fn forged_signature_fails_in_the_precompile() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let victim = env.funded();
    let attacker = env.funded();
    let a = env.default_accept(6);
    let message = env.acceptance_message(&t.org, &t.version, &t.shard, &victim.pubkey(), &a);
    // Claim the victim's public key with the attacker's signature.
    let forged = sign(&attacker, message.as_bytes());
    let ed = ed25519_ix(&victim.pubkey().to_bytes(), &forged, message.as_bytes());
    let relayer = env.relayer.insecure_clone();
    let rec = env.record_acceptance_ix(
        &relayer.pubkey(),
        &t.org,
        &t.document,
        &t.version,
        &t.shard,
        &a,
    );
    assert_failed(&env.send(&[ed, rec], &relayer, &[]));
    assert!(!bitmap_is_set(&env.shard(&t.shard).bitmap, 6));
}

#[test]
fn signature_cannot_be_reused_for_another_version_document_or_org() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    let a = env.default_accept(10);
    let msg_v1 = env.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), &a);

    // Another organization with an identical-looking document.
    let other_owner = env.funded();
    let other_org = env.create_org(&other_owner, "Acme Inc.", None);
    let (other_doc, res) = env.create_document(
        &other_owner,
        &other_org,
        "terms-of-service",
        "terms-of-service",
        "en-US",
    );
    assert_ok(&res);
    let other_version = env.publish(&other_owner, &other_org, &other_doc, "version one content");
    let relayer = env.relayer.pubkey();
    let (other_shard, res) = env.create_shard(&other_owner, &other_org, 0, &relayer);
    assert_ok(&res);
    let other = Target {
        org: other_org,
        document: other_doc,
        version: other_version,
        shard: other_shard,
    };
    assert_stele_err(
        &env.accept_message(&user, &other, &a, msg_v1.as_bytes()),
        SteleError::MessageMismatch,
    );

    // A newer version of the same document: v1 is no longer acceptable, and the v1 signature does
    // not match v2's reconstruction.
    let v2 = env.publish(&fx.owner, &t.org, &t.document, "version two");
    assert_stele_err(
        &env.accept_message(&user, &t, &a, msg_v1.as_bytes()),
        SteleError::VersionNotCurrent,
    );
    let t2 = Target { version: v2, ..t };
    assert_stele_err(
        &env.accept_message(&user, &t2, &a, msg_v1.as_bytes()),
        SteleError::MessageMismatch,
    );
    // Signing the v2 message works.
    assert_ok(&env.accept(&user, &t2, &a));
}

#[test]
fn devnet_style_message_is_rejected_on_this_network() {
    let mut env = Env::new();
    let fx = env.fixture();
    let user = env.funded();
    let a = env.default_accept(11);
    let message = env.acceptance_message(
        &fx.target.org,
        &fx.target.version,
        &fx.target.shard,
        &user.pubkey(),
        &a,
    );
    let foreign = message.replace("Network: Solana Localnet", "Network: Solana Devnet");
    assert_ne!(foreign, message);
    assert_stele_err(
        &env.accept_message(&user, &fx.target, &a, foreign.as_bytes()),
        SteleError::MessageMismatch,
    );
}

#[test]
fn tampered_human_readable_fields_are_rejected() {
    let mut env = Env::new();
    let fx = env.fixture();
    let user = env.funded();
    let a = env.default_accept(12);
    let message = env.acceptance_message(
        &fx.target.org,
        &fx.target.version,
        &fx.target.shard,
        &user.pubkey(),
        &a,
    );
    for (from, to) in [
        (
            "Organization: Acme Inc. (unverified)",
            "Organization: Acme Inc. (verified: acme.example)",
        ),
        ("Document: Terms of Service", "Document: Friendly Terms"),
        ("Version: 1.0 (#1)", "Version: 2.0 (#1)"),
        (
            "Stele Protocol v1 - Accept Agreement",
            "Stele Protocol v1 - Revoke Agreement",
        ),
    ] {
        let tampered = message.replace(from, to);
        assert_ne!(tampered, message, "replacement applied: {from}");
        assert_stele_err(
            &env.accept_message(&user, &fx.target, &a, tampered.as_bytes()),
            SteleError::MessageMismatch,
        );
    }
}

#[test]
fn request_domain_cannot_inject_lines() {
    let mut env = Env::new();
    let fx = env.fixture();
    let user = env.funded();
    let a = env.default_accept(13);
    let message = env.acceptance_message(
        &fx.target.org,
        &fx.target.version,
        &fx.target.shard,
        &user.pubkey(),
        &a,
    );
    for bad in [
        message.replace(
            "Requested by: app.acme.example",
            "Requested by: app.acme.example\nNote: free money",
        ),
        message.replace(
            "Requested by: app.acme.example",
            "Requested by: App.Acme.Example",
        ),
        message.replace("Requested by: app.acme.example", "Requested by: "),
    ] {
        assert_stele_err(
            &env.accept_message(&user, &fx.target, &a, bad.as_bytes()),
            SteleError::InvalidRequestDomain,
        );
    }
}

#[test]
fn only_the_designated_relayer_can_record() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    let bot = env.funded();
    let a = env.default_accept(20);
    let message = env.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), &a);
    let sig = sign(&user, message.as_bytes());
    let ed = ed25519_ix(&user.pubkey().to_bytes(), &sig, message.as_bytes());
    let rec =
        env.record_acceptance_ix(&bot.pubkey(), &t.org, &t.document, &t.version, &t.shard, &a);
    assert_stele_err(
        &env.send(&[ed, rec], &bot, &[]),
        SteleError::UnauthorizedRelayer,
    );

    // An open shard (zero relayer) accepts any fee payer.
    let (open_shard, res) =
        env.create_shard(&fx.owner, &t.org, 1, &solana_address::Address::default());
    assert_ok(&res);
    let t_open = Target {
        shard: open_shard,
        ..t
    };
    let message = env.acceptance_message(&t.org, &t.version, &open_shard, &user.pubkey(), &a);
    let sig = sign(&user, message.as_bytes());
    let ed = ed25519_ix(&user.pubkey().to_bytes(), &sig, message.as_bytes());
    let rec = env.record_acceptance_ix(
        &bot.pubkey(),
        &t_open.org,
        &t_open.document,
        &t_open.version,
        &t_open.shard,
        &a,
    );
    assert_ok(&env.send(&[ed, rec], &bot, &[]));
}

#[test]
fn shard_must_belong_to_the_organization() {
    let mut env = Env::new();
    let fx = env.fixture();
    let other_owner = env.funded();
    let other_org = env.create_org(&other_owner, "Other Org", None);
    let relayer = env.relayer.pubkey();
    let (other_shard, res) = env.create_shard(&other_owner, &other_org, 0, &relayer);
    assert_ok(&res);
    let user = env.funded();
    let a = env.default_accept(21);
    let t = Target {
        shard: other_shard,
        ..fx.target
    };
    assert_stele_err(
        &env.accept(&user, &t, &a),
        SteleError::ShardOrganizationMismatch,
    );
}

#[test]
fn version_and_document_must_match_the_organization() {
    let mut env = Env::new();
    let fx = env.fixture();
    let other_owner = env.funded();
    let other_org = env.create_org(&other_owner, "Other Org", None);
    let (other_doc, res) =
        env.create_document(&other_owner, &other_org, "terms", "terms-of-service", "en");
    assert_ok(&res);
    let other_version = env.publish(&other_owner, &other_org, &other_doc, "x");
    let user = env.funded();
    let a = env.default_accept(22);
    let relayer = env.relayer.insecure_clone();
    // A validly signed (but irrelevant) message so the precompile passes and the program's own
    // account constraints are what reject the transaction.
    let msg = b"irrelevant";
    let ed = ed25519_ix(&user.pubkey().to_bytes(), &sign(&user, msg), msg);
    // Other org's version under this org's document.
    let rec = env.record_acceptance_ix(
        &relayer.pubkey(),
        &fx.target.org,
        &fx.target.document,
        &other_version,
        &fx.target.shard,
        &a,
    );
    assert_stele_err(
        &env.send(&[ed.clone(), rec], &relayer, &[]),
        SteleError::VersionOrganizationMismatch,
    );
    // Other org's document under this org.
    let rec = env.record_acceptance_ix(
        &relayer.pubkey(),
        &fx.target.org,
        &other_doc,
        &other_version,
        &fx.target.shard,
        &a,
    );
    assert_stele_err(
        &env.send(&[ed, rec], &relayer, &[]),
        SteleError::DocumentOrganizationMismatch,
    );
}

#[allow(clippy::result_large_err)]
fn submit_raw(env: &mut Env, ixs: &[Instruction]) -> TxResult {
    let relayer = env.relayer.insecure_clone();
    env.send(ixs, &relayer, &[])
}

#[test]
fn ed25519_instruction_must_immediately_precede() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    let a = env.default_accept(30);
    let message = env.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), &a);
    let sig = sign(&user, message.as_bytes());
    let relayer = env.relayer.pubkey();
    let rec = env.record_acceptance_ix(&relayer, &t.org, &t.document, &t.version, &t.shard, &a);

    // Missing entirely.
    assert_stele_err(
        &submit_raw(&mut env, std::slice::from_ref(&rec)),
        SteleError::MissingEd25519Instruction,
    );

    // Separated by another (harmless, valid) instruction: a compute-unit-limit request.
    let ed = ed25519_ix(&user.pubkey().to_bytes(), &sig, message.as_bytes());
    let mut cu_data = vec![2u8];
    cu_data.extend_from_slice(&400_000u32.to_le_bytes());
    let compute_budget = Instruction {
        program_id: addr("ComputeBudget111111111111111111111111111111"),
        accounts: vec![],
        data: cu_data,
    };
    let res = submit_raw(&mut env, &[ed.clone(), compute_budget, rec.clone()]);
    assert_stele_err(&res, SteleError::MissingEd25519Instruction);

    // One Ed25519 verification cannot back two acceptances.
    let a2 = env.default_accept(31);
    let rec2 = env.record_acceptance_ix(&relayer, &t.org, &t.document, &t.version, &t.shard, &a2);
    assert_stele_err(
        &submit_raw(&mut env, &[ed, rec, rec2]),
        SteleError::MissingEd25519Instruction,
    );
}

#[test]
fn ed25519_indirection_layout_is_rejected() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    let a = env.default_accept(32);
    let message = env.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), &a);
    let sig = sign(&user, message.as_bytes());
    // Valid signature, but the message offset references instruction index 0 explicitly instead of
    // the canonical "self" marker. The precompile accepts it; the program must not.
    let mut ed = ed25519_ix(&user.pubkey().to_bytes(), &sig, message.as_bytes());
    ed.data[14..16].copy_from_slice(&0u16.to_le_bytes());
    let relayer = env.relayer.pubkey();
    let rec = env.record_acceptance_ix(&relayer, &t.org, &t.document, &t.version, &t.shard, &a);
    assert_stele_err(
        &submit_raw(&mut env, &[ed, rec]),
        SteleError::InvalidEd25519Instruction,
    );
}

#[test]
fn spoofed_instructions_sysvar_is_rejected() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    let a = env.default_accept(33);
    let message = env.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), &a);
    let sig = sign(&user, message.as_bytes());
    let ed = ed25519_ix(&user.pubkey().to_bytes(), &sig, message.as_bytes());
    let relayer = env.relayer.pubkey();
    let mut rec = env.record_acceptance_ix(&relayer, &t.org, &t.document, &t.version, &t.shard, &a);

    // The instructions sysvar is the last account. Any other account in its place — here a real but
    // different sysvar — must be refused, or a forged "instruction list" could vouch for a signature.
    let last = rec.accounts.len() - 1;
    rec.accounts[last].pubkey = addr("SysvarC1ock11111111111111111111111111111111");
    assert_failed(&submit_raw(&mut env, &[ed.clone(), rec.clone()]));

    // The same acceptance with the genuine sysvar succeeds (the failure above was the sysvar check).
    rec.accounts[last].pubkey = addr("Sysvar1nstructions1111111111111111111111111");
    assert!(submit_raw(&mut env, &[ed, rec]).is_ok());
}

#[test]
fn record_acceptance_cannot_be_invoked_through_cpi() {
    let mut env = Env::new();
    let probe = env.deploy_cpi_probe();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    let a = env.default_accept(34);
    let message = env.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), &a);
    let sig = sign(&user, message.as_bytes());
    let ed = ed25519_ix(&user.pubkey().to_bytes(), &sig, message.as_bytes());
    let relayer = env.relayer.pubkey();
    let rec = env.record_acceptance_ix(&relayer, &t.org, &t.document, &t.version, &t.shard, &a);

    // A genuine signature, verified by the instruction right before — but the acceptance arrives
    // through another program. Inside a CPI, introspection describes the caller's top-level
    // instruction, not this one, so the program must refuse before relying on it.
    let mut accounts = vec![ro(program_id())];
    accounts.extend(rec.accounts.iter().cloned());
    let forwarded = Instruction {
        program_id: probe,
        accounts,
        data: rec.data.clone(),
    };
    assert_stele_err(
        &submit_raw(&mut env, &[ed.clone(), forwarded]),
        SteleError::CpiNotAllowed,
    );
    assert_eq!(env.shard(&t.shard).accepted_count, 0);

    // Submitted directly, the same acceptance is recorded (the refusal above was the CPI check).
    assert_ok(&submit_raw(&mut env, &[ed, rec]));
    assert_eq!(env.shard(&t.shard).accepted_count, 1);
}

#[test]
fn verified_domain_appears_in_message_and_expires() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let attestor = env.attestor.insecure_clone();
    let expires = env.now() + 30 * 86_400;
    assert_ok(&env.attest_domain(&attestor, &t.org, "acme.example", expires));

    let user = env.funded();
    let a = env.default_accept(40);
    let message = env.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), &a);
    assert!(message.contains("Organization: Acme Inc. (verified: acme.example)\n"));
    // A message claiming "unverified" no longer matches (and vice versa).
    let downgraded = message.replace("(verified: acme.example)", "(unverified)");
    assert_stele_err(
        &env.accept_message(&user, &t, &a, downgraded.as_bytes()),
        SteleError::MessageMismatch,
    );
    assert_ok(&env.accept_message(&user, &t, &a, message.as_bytes()));

    // After expiry the program requires "(unverified)".
    env.set_time(expires + 1);
    let a2 = env.default_accept(41);
    let message2 = env.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), &a2);
    assert!(message2.contains("(unverified)"));
    assert_ok(&env.accept_message(&user, &t, &a2, message2.as_bytes()));
}

#[test]
fn accumulator_commits_to_every_acceptance_in_order() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let mut expected = [0u8; 32];
    for i in 0..5u32 {
        let user = env.funded();
        let a = env.default_accept(100 + i);
        let message = env.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), &a);
        assert_ok(&env.accept_message(&user, &t, &a, message.as_bytes()));
        let sig = sign(&user, message.as_bytes());
        let id = acceptance_id(
            &t.version.to_bytes(),
            &user.pubkey().to_bytes(),
            &hash32(message.as_bytes()),
            &sig,
        );
        expected = accumulate(&expected, &id);
    }
    let shard = env.shard(&t.shard);
    assert_eq!(shard.accepted_count, 5);
    assert_eq!(shard.accumulator, expected);
}
