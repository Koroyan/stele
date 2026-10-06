//! `record_proof`: signed business statements (purchases, refunds, consents, ...) with the same
//! guarantees as acceptances — rebuilt anchor message, runtime-verified signature, replay
//! protection shared with acceptances, organization and network binding.

mod common;

use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;
use stele::error::SteleError;
use stele_core::acceptance::{accumulate, bitmap_is_set};
use stele_core::proof::proof_id;

#[test]
fn records_a_purchase_proof() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let customer = Keypair::new(); // no SOL needed
    let p = env.default_proof(11);
    let message = env.proof_message(&t.org, &t.shard, &customer.pubkey(), &p);
    assert!(message.starts_with("Stele Protocol v1 - Record Proof\n"));
    assert!(message.contains("\nType: Purchase\n"));
    assert!(message.contains(&format!("\nOrganization ID: {}\n", t.org)));
    assert!(message.contains(&format!(
        "\nStatement: {}\n",
        stele_core::encoding::hex_lower(&p.statement_hash)
    )));
    assert!(message.contains("\nChain: solana:localnet\n"));
    println!("purchase anchor message: {} bytes", message.len());

    let meta = env
        .prove_message(&customer, &t.org, &t.shard, &p, message.as_bytes())
        .expect("proof recorded");
    println!(
        "record_proof compute units: {}",
        meta.compute_units_consumed
    );
    assert!(meta.compute_units_consumed < 50_000);

    let shard = env.shard(&t.shard);
    assert!(bitmap_is_set(&shard.bitmap, 11));
    assert_eq!(shard.accepted_count, 1);
    let sig = customer.sign_message(message.as_bytes());
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(sig.as_ref());
    let id = proof_id(
        &t.org.to_bytes(),
        &customer.pubkey().to_bytes(),
        &p.statement_hash,
        &hash32(message.as_bytes()),
        &sig_bytes,
    );
    assert_eq!(shard.accumulator, accumulate(&[0u8; 32], &id));
}

#[test]
fn every_proof_type_records_and_reserved_types_are_rejected() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let customer = Keypair::new();
    for (i, (code, _)) in stele_core::proof::PROOF_TYPES.iter().enumerate() {
        let mut p = env.default_proof(100 + i as u32);
        p.proof_type = *code;
        assert_ok(&env.prove(&customer, &t.org, &t.shard, &p));
    }
    for reserved in [0u8, 18, 200] {
        let mut p = env.default_proof(1);
        p.proof_type = reserved;
        // The message cannot even be built for a reserved type; sign a purchase message instead.
        let mut purchase = p.clone();
        purchase.proof_type = 1;
        let message = env.proof_message(&t.org, &t.shard, &customer.pubkey(), &purchase);
        assert_stele_err(
            &env.prove_message(&customer, &t.org, &t.shard, &p, message.as_bytes()),
            SteleError::InvalidProofType,
        );
    }
}

#[test]
fn statement_hash_and_type_are_bound_to_the_signature() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let customer = Keypair::new();
    let p = env.default_proof(1);
    let message = env.proof_message(&t.org, &t.shard, &customer.pubkey(), &p);

    // Same signature, different statement hash in the instruction.
    let mut other = p.clone();
    other.statement_hash = hash32(b"a different order");
    assert_stele_err(
        &env.prove_message(&customer, &t.org, &t.shard, &other, message.as_bytes()),
        SteleError::MessageMismatch,
    );
    // Same signature, recorded as a refund instead of a purchase.
    let mut refund = p.clone();
    refund.proof_type = 7;
    assert_stele_err(
        &env.prove_message(&customer, &t.org, &t.shard, &refund, message.as_bytes()),
        SteleError::MessageMismatch,
    );
    // Zero statement hash.
    let mut zero = p.clone();
    zero.statement_hash = [0u8; 32];
    assert_stele_err(
        &env.prove(&customer, &t.org, &t.shard, &zero),
        SteleError::InvalidStatementHash,
    );
    // The genuine one still records.
    assert_ok(&env.prove_message(&customer, &t.org, &t.shard, &p, message.as_bytes()));
}

#[test]
fn a_proof_cannot_be_moved_to_another_organization_even_with_the_same_name() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    // Same display name, different organization.
    let other_owner = env.funded();
    let twin = env.create_org(&other_owner, "Acme Inc.", None);
    let relayer = env.relayer.pubkey();
    let (twin_shard, res) = env.create_shard(&other_owner, &twin, 0, &relayer);
    assert_ok(&res);

    let customer = Keypair::new();
    let p = env.default_proof(5);
    let message = env.proof_message(&t.org, &t.shard, &customer.pubkey(), &p);
    assert_stele_err(
        &env.prove_message(&customer, &twin, &twin_shard, &p, message.as_bytes()),
        SteleError::MessageMismatch,
    );
}

#[test]
fn replay_is_rejected_and_nonces_are_shared_with_acceptances() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let customer = Keypair::new();
    let p = env.default_proof(3);
    assert_ok(&env.prove(&customer, &t.org, &t.shard, &p));
    assert_stele_err(
        &env.prove(&customer, &t.org, &t.shard, &p),
        SteleError::NonceAlreadyUsed,
    );
    // An acceptance cannot reuse a nonce consumed by a proof, and vice versa.
    assert_stele_err(
        &env.accept(&customer, &t, &env.default_accept(3)),
        SteleError::NonceAlreadyUsed,
    );
    assert_ok(&env.accept(&customer, &t, &env.default_accept(4)));
    assert_stele_err(
        &env.prove(&customer, &t.org, &t.shard, &env.default_proof(4)),
        SteleError::NonceAlreadyUsed,
    );
    assert_eq!(env.shard(&t.shard).accepted_count, 2);
}

#[test]
fn an_acceptance_signature_cannot_be_recorded_as_a_proof() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let customer = Keypair::new();
    let a = env.default_accept(8);
    let acceptance = env.acceptance_message(&t.org, &t.version, &t.shard, &customer.pubkey(), &a);
    let p = env.default_proof(8);
    assert_stele_err(
        &env.prove_message(&customer, &t.org, &t.shard, &p, acceptance.as_bytes()),
        SteleError::MessageMismatch,
    );
}

#[test]
fn signer_network_and_time_rules() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let customer = Keypair::new();
    let impostor = Keypair::new();
    let p = env.default_proof(1);

    // The Account line names the customer, but the impostor signs.
    let message = env.proof_message(&t.org, &t.shard, &customer.pubkey(), &p);
    assert_stele_err(
        &env.prove_message(&impostor, &t.org, &t.shard, &p, message.as_bytes()),
        SteleError::MessageMismatch,
    );
    // A message for another chain.
    let devnet = message.replace("Chain: solana:localnet", "Chain: solana:devnet");
    assert_stele_err(
        &env.prove_message(&customer, &t.org, &t.shard, &p, devnet.as_bytes()),
        SteleError::MessageMismatch,
    );
    // Injected lines in the request domain.
    let injected = format!("{message}\nType: Refund");
    assert_stele_err(
        &env.prove_message(&customer, &t.org, &t.shard, &p, injected.as_bytes()),
        SteleError::InvalidRequestDomain,
    );
    // Expired.
    let message = env.proof_message(&t.org, &t.shard, &customer.pubkey(), &p);
    env.advance(601);
    assert_stele_err(
        &env.prove_message(&customer, &t.org, &t.shard, &p, message.as_bytes()),
        SteleError::AcceptanceExpired,
    );
    // Issued in the future.
    let mut future = env.default_proof(2);
    future.issued_at = env.now() + 10_000;
    future.expires_at = future.issued_at + 60;
    assert_stele_err(
        &env.prove(&customer, &t.org, &t.shard, &future),
        SteleError::IssuedInFuture,
    );
}

#[test]
fn only_the_designated_relayer_records_proofs() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let customer = Keypair::new();
    let p = env.default_proof(1);
    let message = env.proof_message(&t.org, &t.shard, &customer.pubkey(), &p);
    let sig = customer.sign_message(message.as_bytes());
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(sig.as_ref());
    let intruder = env.funded();
    let ixs = vec![
        ed25519_ix(
            &customer.pubkey().to_bytes(),
            &sig_bytes,
            message.as_bytes(),
        ),
        env.record_proof_ix(&intruder.pubkey(), &t.org, &t.shard, &p),
    ];
    assert_stele_err(
        &env.send(&ixs, &intruder, &[]),
        SteleError::UnauthorizedRelayer,
    );
}

#[test]
fn frozen_organizations_and_paused_protocol_record_nothing() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let customer = Keypair::new();
    let admin = env.admin.insecure_clone();
    assert_ok(&env.set_paused(&admin, true));
    assert_stele_err(
        &env.prove(&customer, &t.org, &t.shard, &env.default_proof(1)),
        SteleError::ProtocolPaused,
    );
}
