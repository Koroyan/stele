//! Stele Gate: policies set by the organization, access passes written only by verified
//! acceptances, and a protected program (the Atlas vault demo) whose `deposit` calls
//! `stele_gate::require_current` — so a direct call without a current pass fails on-chain.

#![allow(clippy::result_large_err)]

mod common;

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData};
use common::*;
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;
use stele::error::SteleError;
use stele::state::{AccessPass, GatePolicy};
use stele_gate::GateError;
use stele_gate_demo::Vault;

const GATE_DEMO_SO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../target/deploy/stele_gate_demo.so"
);

fn vault_program() -> Address {
    to_addr(&stele_gate_demo::ID)
}

fn deploy_vault_program(env: &mut Env) {
    let so = std::fs::read(GATE_DEMO_SO).expect(
        "missing target/deploy/stele_gate_demo.so — run scripts/dev/build-program.sh first",
    );
    env.svm
        .add_program(vault_program(), &so)
        .expect("load the vault demo");
}

fn access_pass_pda(document: &Address, holder: &Address) -> Address {
    pda(&[
        stele::constants::ACCESS_PASS_SEED,
        document.as_ref(),
        holder.as_ref(),
    ])
}

fn policy_pda(document: &Address) -> Address {
    pda(&[stele::constants::POLICY_SEED, document.as_ref()])
}

fn vault_pda(policy: &Address) -> Address {
    Address::find_program_address(
        &[stele_gate_demo::VAULT_SEED, policy.as_ref()],
        &vault_program(),
    )
    .0
}

fn gate_err(e: GateError) -> u32 {
    e as u32
}

fn vault_err(e: stele_gate_demo::VaultError) -> u32 {
    e.into()
}

// ---- policies ---------------------------------------------------------------------------------------

fn policy_ix(
    authority: &Address,
    t: &Target,
    version: &Address,
    create: bool,
    membership: Option<Address>,
) -> Instruction {
    let mut accounts = vec![
        signer_ro(*authority),
        optional(membership),
        ro(config_pda()),
        ro(t.org),
        ro(t.document),
        ro(*version),
        rw(policy_pda(&t.document)),
    ];
    if create {
        accounts.push(signer_rw(*authority));
        accounts.push(ro(system_program()));
        ix(stele::instruction::CreatePolicy {}, accounts)
    } else {
        ix(stele::instruction::SetPolicyRequirement {}, accounts)
    }
}

fn create_policy(env: &mut Env, owner: &Keypair, t: &Target, version: &Address) -> TxResult {
    let i = policy_ix(&owner.pubkey(), t, version, true, None);
    env.send(&[i], owner, &[])
}

fn require_version(env: &mut Env, owner: &Keypair, t: &Target, version: &Address) -> TxResult {
    let i = policy_ix(&owner.pubkey(), t, version, false, None);
    env.send(&[i], owner, &[])
}

fn policy(env: &Env, document: &Address) -> GatePolicy {
    let acc = env
        .raw_account(&policy_pda(document))
        .expect("policy exists");
    GatePolicy::try_deserialize(&mut acc.data.as_slice()).expect("policy")
}

// ---- gated acceptance -------------------------------------------------------------------------------

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

fn signed_ed25519(env: &Env, user: &Keypair, t: &Target, a: &AcceptParams) -> Instruction {
    let message = env.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), a);
    let sig = user.sign_message(message.as_bytes());
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(sig.as_ref());
    ed25519_ix(&user.pubkey().to_bytes(), &sig_bytes, message.as_bytes())
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
    let ed = signed_ed25519(env, user, t, a);
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

// ---- the protected program ----------------------------------------------------------------------------

fn create_vault(env: &mut Env, manager: &Keypair, policy: &Address) -> TxResult {
    let i = Instruction {
        program_id: vault_program(),
        accounts: vec![
            signer_rw(manager.pubkey()),
            ro(*policy),
            rw(vault_pda(policy)),
            ro(system_program()),
        ],
        data: stele_gate_demo::instruction::CreateVault {
            name: "Atlas Real Estate Vault".into(),
        }
        .data(),
    };
    env.send(&[i], manager, &[])
}

fn deposit_ix(
    investor: &Address,
    vault: &Address,
    policy: &Address,
    pass: &Address,
) -> Instruction {
    Instruction {
        program_id: vault_program(),
        accounts: vec![
            AccountMeta::new_readonly(*investor, true),
            rw(*vault),
            ro(*policy),
            ro(*pass),
        ],
        data: stele_gate_demo::instruction::Deposit {
            amount: 5_000_000_000, // 5,000 demo USDC
        }
        .data(),
    }
}

/// A direct call to `deposit`, as a script or the CLI would make it (no frontend, no SDK).
fn deposit(
    env: &mut Env,
    investor: &Keypair,
    vault: &Address,
    policy: &Address,
    pass: &Address,
) -> TxResult {
    let i = deposit_ix(&investor.pubkey(), vault, policy, pass);
    let relayer = env.relayer.insecure_clone();
    env.send(&[i], &relayer, &[investor])
}

fn vault(env: &Env, a: &Address) -> Vault {
    let acc = env.raw_account(a).expect("vault");
    Vault::try_deserialize(&mut acc.data.as_slice()).expect("vault")
}

/// Organization + Investor Offering Terms v1 + policy (requires v1) + vault.
struct Setup {
    env: Env,
    owner: Keypair,
    t: Target,
    policy: Address,
    vault: Address,
}

fn setup() -> Setup {
    let mut env = Env::new();
    deploy_vault_program(&mut env);
    let fx = env.fixture();
    let t = fx.target;
    assert_ok(&create_policy(&mut env, &fx.owner, &t, &t.version));
    let policy = policy_pda(&t.document);
    let manager = env.funded();
    assert_ok(&create_vault(&mut env, &manager, &policy));
    Setup {
        vault: vault_pda(&policy),
        env,
        owner: fx.owner,
        t,
        policy,
    }
}

/// Overwrites an account in the test VM (to model states the real program never produces).
fn forge(env: &mut Env, at: &Address, owner: &Address, data: Vec<u8>) {
    env.svm
        .set_account(
            *at,
            Account {
                lamports: 10_000_000,
                data,
                owner: *owner,
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("set account");
}

// ---- tests: policies ----------------------------------------------------------------------------------

#[test]
fn the_organization_sets_and_raises_the_required_version() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let stranger = env.funded();

    // Only an authority of the organization may create the policy.
    let i = policy_ix(&stranger.pubkey(), &t, &t.version, true, None);
    assert_stele_err(&env.send(&[i], &stranger, &[]), SteleError::Unauthorized);

    assert_ok(&create_policy(&mut env, &fx.owner, &t, &t.version));
    let p = policy(&env, &t.document);
    assert_eq!(p.organization, to_pk(&t.org));
    assert_eq!(p.document, to_pk(&t.document));
    assert_eq!(p.required_version, 1);
    assert_eq!(
        p.required_version_hash,
        env.version(&t.version).version_hash
    );
    // One policy per document.
    env.advance(1);
    assert_failed(&create_policy(&mut env, &fx.owner, &t, &t.version));

    // A version of another document cannot be required.
    let (other, res) = env.create_document(&fx.owner, &t.org, "other", "other", "en-US");
    assert_ok(&res);
    let other_v1 = env.publish(&fx.owner, &t.org, &other, "other text");
    assert_stele_err(
        &require_version(&mut env, &fx.owner, &t, &other_v1),
        SteleError::VersionDocumentMismatch,
    );

    // Publishing v2 does not change the requirement; the organization raises it explicitly.
    env.advance(60);
    let v2 = env.publish(&fx.owner, &t.org, &t.document, "version two content");
    assert_eq!(policy(&env, &t.document).required_version, 1);
    let i = policy_ix(&stranger.pubkey(), &t, &v2, false, None);
    assert_stele_err(&env.send(&[i], &stranger, &[]), SteleError::Unauthorized);
    assert_ok(&require_version(&mut env, &fx.owner, &t, &v2));
    let p = policy(&env, &t.document);
    assert_eq!(p.required_version, 2);
    assert_eq!(p.required_version_hash, env.version(&v2).version_hash);
}

// ---- tests: access passes -----------------------------------------------------------------------------

#[test]
fn a_gated_acceptance_creates_the_holders_pass_and_the_user_pays_nothing() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    let before = env.lamports(&user.pubkey());
    let a = env.default_accept(1);

    let meta = accept_gated(&mut env, &user, &t, &a).expect("gated acceptance recorded");
    let p = pass(&env, &t.document, &user.pubkey());
    assert_eq!(p.organization, to_pk(&t.org));
    assert_eq!(p.document, to_pk(&t.document));
    assert_eq!(p.holder, to_pk(&user.pubkey()));
    assert_eq!(p.version, to_pk(&t.version));
    assert_eq!(p.version_hash, env.version(&t.version).version_hash);
    assert_eq!(p.version_number, 1);
    assert_eq!(p.acceptance_count, 1);
    assert_ne!(p.acceptance_id, [0u8; 32]);
    // It is an ordinary acceptance too: same shard, nonce and accumulator (the Proof record).
    assert_eq!(env.shard(&t.shard).accepted_count, 1);
    assert_eq!(
        env.lamports(&user.pubkey()),
        before,
        "the user pays nothing"
    );
    let size = env
        .raw_account(&access_pass_pda(&t.document, &user.pubkey()))
        .unwrap()
        .data
        .len();
    assert_eq!(size, stele_gate::ACCESS_PASS_LEN);
    println!(
        "gated acceptance: {} CU, pass {size} bytes",
        meta.compute_units_consumed
    );
}

#[test]
fn a_wallet_cannot_record_the_same_version_twice() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    let a = env.default_accept(40);
    accept_gated(&mut env, &user, &t, &a).expect("first acceptance recorded");
    env.advance(1);
    let again = env.default_accept(41);
    assert_stele_err(
        &accept_gated(&mut env, &user, &t, &again),
        SteleError::AccessPassAlreadyCurrent,
    );
    let p = pass(&env, &t.document, &user.pubkey());
    assert_eq!((p.version_number, p.acceptance_count), (1, 1));
    assert_eq!(
        env.shard(&t.shard).accepted_count,
        1,
        "nothing recorded twice"
    );
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
    let message = env
        .acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), &a)
        .replace("Acme Inc.", "Acme Inc!");
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
fn gated_acceptance_cannot_be_invoked_through_cpi() {
    let mut env = Env::new();
    let probe = env.deploy_cpi_probe();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    let a = env.default_accept(8);
    let ed = signed_ed25519(&env, &user, &t, &a);
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

// ---- tests: the protected deposit ---------------------------------------------------------------------

#[test]
fn deposits_require_the_current_offering_terms() {
    let Setup {
        mut env,
        owner,
        t,
        policy,
        vault: v,
    } = setup();
    let investor = env.funded();
    let my_pass = access_pass_pda(&t.document, &investor.pubkey());

    // 1. No pass: a direct call to deposit() fails on-chain.
    assert_custom(
        &deposit(&mut env, &investor, &v, &policy, &my_pass),
        gate_err(GateError::AccessPassMissing),
    );

    // 2. Accept v1 (records the Proof acceptance and creates the pass): deposit succeeds.
    let a = env.default_accept(10);
    assert_ok(&accept_gated(&mut env, &investor, &t, &a));
    let meta = deposit(&mut env, &investor, &v, &policy, &my_pass).expect("deposit with v1");
    println!(
        "deposit with require_current: {} CU",
        meta.compute_units_consumed
    );
    assert_eq!(vault(&env, &v).deposit_count, 1);
    assert_eq!(vault(&env, &v).total_deposited, 5_000_000_000);

    // 3. The organization publishes v2. Until it requires v2, v1 still satisfies the policy.
    env.advance(60);
    let v2 = env.publish(&owner, &t.org, &t.document, "offering terms v2");
    env.advance(1);
    assert_ok(&deposit(&mut env, &investor, &v, &policy, &my_pass));

    // 4. It requires v2: the v1 pass is outdated and the deposit fails.
    assert_ok(&require_version(&mut env, &owner, &t, &v2));
    env.advance(1);
    assert_custom(
        &deposit(&mut env, &investor, &v, &policy, &my_pass),
        gate_err(GateError::AccessPassOutdated),
    );

    // 5. Accept v2: the same pass now names v2 and the deposit succeeds.
    let t2 = Target { version: v2, ..t };
    let a2 = env.default_accept(11);
    assert_ok(&accept_gated(&mut env, &investor, &t2, &a2));
    env.advance(1);
    assert_ok(&deposit(&mut env, &investor, &v, &policy, &my_pass));
    assert_eq!(vault(&env, &v).deposit_count, 3);
    let p = pass(&env, &t.document, &investor.pubkey());
    assert_eq!((p.version_number, p.acceptance_count), (2, 2));
    // The v1 acceptance stays on record: both acceptances are in the shard's accumulator.
    assert_eq!(env.shard(&t.shard).accepted_count, 2);
}

#[test]
fn direct_bypass_attempts_fail_on_chain() {
    let Setup {
        mut env,
        owner,
        t,
        policy,
        vault: v,
    } = setup();
    let alice = env.funded();
    let mallory = env.funded();
    let alices_pass = access_pass_pda(&t.document, &alice.pubkey());
    let a = env.default_accept(20);
    assert_ok(&accept_gated(&mut env, &alice, &t, &a));
    let relayer = env.relayer.insecure_clone();

    // Wrong wallet: Mallory presents Alice's valid pass.
    assert_custom(
        &deposit(&mut env, &mallory, &v, &policy, &alices_pass),
        gate_err(GateError::AccessPassMismatch),
    );

    // Unsigned holder: Alice's pass and Alice as investor, without Alice's signature.
    let mut i = deposit_ix(&alice.pubkey(), &v, &policy, &alices_pass);
    i.accounts[0].is_signer = false;
    assert_failed(&env.send(&[i], &relayer, &[]));

    // Wrong policy: Mallory's own organization, document, policy and pass.
    let m_org = env.create_org(&mallory, "Mallory Ltd", None);
    let (m_doc, res) = env.create_document(&mallory, &m_org, "terms", "terms-of-service", "en-US");
    assert_ok(&res);
    let m_v1 = env.publish(&mallory, &m_org, &m_doc, "anything goes");
    let relayer_pk = relayer.pubkey();
    let (m_shard, res) = env.create_shard(&mallory, &m_org, 0, &relayer_pk);
    assert_ok(&res);
    let m = Target {
        org: m_org,
        document: m_doc,
        version: m_v1,
        shard: m_shard,
    };
    assert_ok(&create_policy(&mut env, &mallory, &m, &m_v1));
    let a = env.default_accept(21);
    assert_ok(&accept_gated(&mut env, &mallory, &m, &a));
    let m_policy = policy_pda(&m_doc);
    let m_pass = access_pass_pda(&m_doc, &mallory.pubkey());
    // … the vault pins its own policy,
    assert_custom(
        &deposit(&mut env, &mallory, &v, &m_policy, &m_pass),
        vault_err(stele_gate_demo::VaultError::WrongPolicy),
    );
    // … and a pass for another organization's document never satisfies this policy.
    assert_custom(
        &deposit(&mut env, &mallory, &v, &policy, &m_pass),
        gate_err(GateError::AccessPassMismatch),
    );

    // Reused pass from another document (another policy) of the same organization.
    let (doc2, res) = env.create_document(&owner, &t.org, "privacy", "privacy-policy", "en-US");
    assert_ok(&res);
    let d2v1 = env.publish(&owner, &t.org, &doc2, "privacy text");
    let t_doc2 = Target {
        document: doc2,
        version: d2v1,
        ..t
    };
    let a = env.default_accept(22);
    assert_ok(&accept_gated(&mut env, &mallory, &t_doc2, &a));
    assert_custom(
        &deposit(
            &mut env,
            &mallory,
            &v,
            &policy,
            &access_pass_pda(&doc2, &mallory.pubkey()),
        ),
        gate_err(GateError::AccessPassMismatch),
    );

    // Forged pass: Alice's pass data, holder rewritten to Mallory, in an account Mallory controls.
    let alice_data = env.raw_account(&alices_pass).unwrap().data;
    let mut forged_data = alice_data.clone();
    forged_data[72..104].copy_from_slice(mallory.pubkey().as_ref());
    let lookalike = Keypair::new().pubkey();
    forge(&mut env, &lookalike, &system_program(), forged_data.clone());
    assert_custom(
        &deposit(&mut env, &mallory, &v, &policy, &lookalike),
        gate_err(GateError::AccessPassInvalid),
    );
    // … even Stele-owned (impossible on-chain, modelled here) but off the canonical address.
    forge(&mut env, &lookalike, &program_id(), forged_data);
    assert_custom(
        &deposit(&mut env, &mallory, &v, &policy, &lookalike),
        gate_err(GateError::AccessPassInvalid),
    );
    // … or a system account at Mallory's own pass address (the address of "no pass").
    let m_pass_here = access_pass_pda(&t.document, &mallory.pubkey());
    forge(&mut env, &m_pass_here, &system_program(), alice_data);
    assert_custom(
        &deposit(&mut env, &mallory, &v, &policy, &m_pass_here),
        gate_err(GateError::AccessPassMissing),
    );

    assert_eq!(vault(&env, &v).deposit_count, 0, "no bypass deposited");
    assert_ok(&deposit(&mut env, &alice, &v, &policy, &alices_pass));
}

#[test]
fn forged_policies_and_fingerprints_are_rejected() {
    let Setup {
        mut env,
        t,
        policy: real_policy,
        vault: v,
        ..
    } = setup();
    let alice = env.funded();
    let alices_pass = access_pass_pda(&t.document, &alice.pubkey());
    let a = env.default_accept(30);
    assert_ok(&accept_gated(&mut env, &alice, &t, &a));

    // A vault pinned to a "policy" off its canonical address (modelled: Stele-owned).
    let mut fake = policy(&env, &t.document);
    fake.required_version = 0;
    let mut data = Vec::new();
    fake.try_serialize(&mut data).unwrap();
    let fake_policy = Keypair::new().pubkey();
    forge(&mut env, &fake_policy, &program_id(), data);
    let manager = env.funded();
    assert_ok(&create_vault(&mut env, &manager, &fake_policy));
    let fake_vault = vault_pda(&fake_policy);
    assert_custom(
        &deposit(&mut env, &alice, &fake_vault, &fake_policy, &alices_pass),
        gate_err(GateError::InvalidPolicy),
    );

    // A vault cannot even be opened for a non-Stele account.
    let not_policy = env.funded().pubkey();
    assert_custom(
        &create_vault(&mut env, &manager, &not_policy),
        vault_err(stele_gate_demo::VaultError::NotAStelePolicy),
    );

    // The pass names the required version number with a different fingerprint (corrupted state).
    let mut p = pass(&env, &t.document, &alice.pubkey());
    p.version_hash[0] ^= 0xff;
    let mut data = Vec::new();
    p.try_serialize(&mut data).unwrap();
    forge(&mut env, &alices_pass, &program_id(), data);
    assert_custom(
        &deposit(&mut env, &alice, &v, &real_policy, &alices_pass),
        gate_err(GateError::FingerprintMismatch),
    );
}
