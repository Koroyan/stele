//! Merkle-batched acceptances (`MERKLE_BATCHED` evidence mode): the designated relayer anchors a
//! root of acceptances verified off-chain. The program verifies no user signature here, so the
//! tests check what it DOES guarantee: who may anchor, what is accepted, that the batch enters the
//! shard's append-only accumulator exactly like the direct records around it, and that a sponsored
//! shard reimburses exactly one signature's fee.

#![allow(clippy::result_large_err)]

mod common;

use common::*;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_signer::Signer;
use stele::error::SteleError;
use stele::instructions::AnchorAcceptanceBatchArgs;
use stele_core::acceptance::accumulate;
use stele_core::batch::{
    batch_id, leaf_hash, merkle_root, LEAF_PROTOCOL_STELE_1, MAX_BATCH_LEAVES,
};

fn anchor_ix(relayer: &Keypair, t: &Target, batch_root: [u8; 32], leaf_count: u32) -> Instruction {
    ix(
        stele::instruction::AnchorAcceptanceBatch {
            args: AnchorAcceptanceBatchArgs {
                batch_root,
                leaf_count,
            },
        },
        vec![
            signer_rw(relayer.pubkey()),
            ro(config_pda()),
            ro(t.org),
            rw(t.shard),
            ro(instructions_sysvar()),
        ],
    )
}

fn root_of(n: u8) -> [u8; 32] {
    let leaves: Vec<[u8; 32]> = (0..n)
        .map(|i| leaf_hash(LEAF_PROTOCOL_STELE_1, &[i; 32]))
        .collect();
    merkle_root(&leaves).unwrap()
}

#[test]
fn a_batch_enters_the_shard_log_between_direct_records() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    assert_ok(&env.accept(&user, &t, &env.default_accept(1)));
    let before = env.shard(&t.shard);

    let relayer = env.relayer.insecure_clone();
    let root = root_of(5);
    let res = env.send(
        &[cu_limit_ix(20_000), anchor_ix(&relayer, &t, root, 5)],
        &relayer,
        &[],
    );
    assert_ok(&res);
    let meta = res.unwrap();
    println!(
        "anchor_acceptance_batch compute units: {}",
        meta.compute_units_consumed
    );
    assert!(meta.compute_units_consumed < 10_000);
    let after = env.shard(&t.shard);
    let id = batch_id(
        &t.org.to_bytes(),
        &t.shard.to_bytes(),
        &root,
        5,
        before.accepted_count,
    );
    assert_eq!(after.accumulator, accumulate(&before.accumulator, &id));
    assert_eq!(after.accepted_count, before.accepted_count + 5);
    // No nonce is consumed by a batch: replay protection is off-chain in this mode.
    assert_eq!(after.bitmap, before.bitmap);

    // The same root again is a different log entry (its position differs), never a silent no-op.
    assert_ok(&env.send(&[anchor_ix(&relayer, &t, root, 5)], &relayer, &[]));
    assert_eq!(
        env.shard(&t.shard).accepted_count,
        before.accepted_count + 10
    );
    // Direct records keep working after batches.
    assert_ok(&env.accept(&user, &t, &env.default_accept(2)));
}

#[test]
fn only_the_designated_relayer_may_anchor() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let stranger = env.funded();
    assert_stele_err(
        &env.send(&[anchor_ix(&stranger, &t, root_of(2), 2)], &stranger, &[]),
        SteleError::UnauthorizedRelayer,
    );
    // An open shard (no designated relayer) accepts no batches at all.
    let (open, res) = env.create_shard(&fx.owner, &t.org, 7, &solana_address::Address::default());
    assert_ok(&res);
    let open_target = Target {
        org: t.org,
        document: t.document,
        version: t.version,
        shard: open,
    };
    let relayer = env.relayer.insecure_clone();
    for who in [&relayer, &stranger] {
        assert_stele_err(
            &env.send(&[anchor_ix(who, &open_target, root_of(2), 2)], who, &[]),
            SteleError::UnauthorizedRelayer,
        );
    }
}

#[test]
fn rejects_empty_oversized_and_misdirected_batches() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let relayer = env.relayer.insecure_clone();
    for (root, count) in [
        (root_of(1), 0),
        (root_of(1), MAX_BATCH_LEAVES + 1),
        ([0u8; 32], 1),
    ] {
        assert_stele_err(
            &env.send(&[anchor_ix(&relayer, &t, root, count)], &relayer, &[]),
            SteleError::InvalidBatch,
        );
    }
    // A shard of another organization.
    let other = env.fixture();
    let mixed = Target {
        org: t.org,
        document: t.document,
        version: t.version,
        shard: other.target.shard,
    };
    assert_stele_err(
        &env.send(&[anchor_ix(&relayer, &mixed, root_of(2), 2)], &relayer, &[]),
        SteleError::ShardOrganizationMismatch,
    );
    // Paused protocol.
    let admin = env.admin.insecure_clone();
    assert_ok(&env.set_paused(&admin, true));
    assert_stele_err(
        &env.send(&[anchor_ix(&relayer, &t, root_of(2), 2)], &relayer, &[]),
        SteleError::ProtocolPaused,
    );
}

#[test]
fn batches_cannot_arrive_through_cpi() {
    let mut env = Env::new();
    let probe = env.deploy_cpi_probe();
    let fx = env.fixture();
    let t = fx.target;
    let relayer = env.relayer.insecure_clone();
    let real = anchor_ix(&relayer, &t, root_of(3), 3);
    let mut accounts = vec![ro(program_id())];
    accounts.extend(real.accounts.iter().cloned());
    let forwarded = Instruction {
        program_id: probe,
        accounts,
        data: real.data.clone(),
    };
    assert_stele_err(
        &env.send(&[forwarded], &relayer, &[]),
        SteleError::CpiNotAllowed,
    );
    assert_ok(&env.send(&[real], &relayer, &[]));
}

#[test]
fn a_sponsored_shard_reimburses_one_signature_per_batch() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    assert_ok(&env.enable_sponsorship(&fx.owner, &t.org, &t.shard, 50_000, 1_000_000));
    let funder = env.funded();
    env.deposit(&funder, &t.shard, 1_000_000_000);
    let relayer = env.relayer.insecure_clone();
    let relayer_before = env.lamports(&relayer.pubkey());
    let shard_before = env.lamports(&t.shard);
    assert_ok(&env.send(
        &[
            cu_limit_ix(20_000),
            cu_price_ix(10_000),
            anchor_ix(&relayer, &t, root_of(64), 64),
        ],
        &relayer,
        &[],
    ));
    // 1 signature × 5,000 + ceil(20,000 CU × 10,000 µ-lamports / 1e6) = 5,200 lamports.
    let paid = shard_before - env.lamports(&t.shard);
    assert_eq!(paid, 5_200);
    assert_eq!(env.lamports(&relayer.pubkey()), relayer_before);
    assert_eq!(env.sponsorship(&t.shard).unwrap().reimbursed_count, 1);
}
