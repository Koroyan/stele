//! Stele Gate passports: one account per wallet for every accepted document, written only by
//! verified acceptances (`record_passport_acceptance`), read in place by protected programs
//! (`stele_gate::require_current_passport`); every deposit returns to whoever paid it.
//!
//! The `bench_*` tests (ignored by default) measure cost and compute at scale:
//! `cargo test --release -p stele --test passport -- --ignored --nocapture --test-threads=1`
//! (`STELE_BENCH_USERS` and `STELE_BENCH_ACCEPTANCES` override the largest sizes.)

#![allow(clippy::result_large_err)]

mod common;

use anchor_lang::{AccountDeserialize, InstructionData};
use common::*;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::{v0, AddressLookupTableAccount, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;
use solana_transaction::Transaction;
use stele::error::SteleError;
use stele::instructions::passport::{ENTRY_PAYER, PASSPORT_ENTRY_LEN, PASSPORT_HEADER_LEN};
use stele_gate::GateError;
use stele_gate_demo::Vault;

const GATE_DEMO_SO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../target/deploy/stele_gate_demo.so"
);

fn vault_program() -> Address {
    to_addr(&stele_gate_demo::ID)
}

fn passport_and_bump(holder: &Address) -> (Address, u8) {
    Address::find_program_address(
        &[stele::constants::PASSPORT_SEED, holder.as_ref()],
        &program_id(),
    )
}

fn passport_pda(holder: &Address) -> Address {
    passport_and_bump(holder).0
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

// ---- setup ------------------------------------------------------------------------------------

fn deploy_vault_program(env: &mut Env) {
    let so = std::fs::read(GATE_DEMO_SO).expect("missing target/deploy/stele_gate_demo.so");
    env.svm
        .add_program(vault_program(), &so)
        .expect("load the vault demo");
}

fn create_policy_ix(owner: &Address, t: &Target) -> Instruction {
    ix(
        stele::instruction::CreatePolicy {},
        vec![
            signer_ro(*owner),
            optional(None),
            ro(config_pda()),
            ro(t.org),
            ro(t.document),
            ro(t.version),
            rw(policy_pda(&t.document)),
            signer_rw(*owner),
            ro(system_program()),
        ],
    )
}

fn require_version_ix(owner: &Address, t: &Target) -> Instruction {
    ix(
        stele::instruction::SetPolicyRequirement {},
        vec![
            signer_ro(*owner),
            optional(None),
            ro(config_pda()),
            ro(t.org),
            ro(t.document),
            ro(t.version),
            rw(policy_pda(&t.document)),
        ],
    )
}

fn create_vault_ix(manager: &Address, policy: &Address) -> Instruction {
    Instruction {
        program_id: vault_program(),
        accounts: vec![
            signer_rw(*manager),
            ro(*policy),
            rw(vault_pda(policy)),
            ro(system_program()),
        ],
        data: stele_gate_demo::instruction::CreateVault {
            name: "Atlas Real Estate Vault".into(),
        }
        .data(),
    }
}

/// A gated document: document + v1 + policy (requires v1) + optional vault, on `base`'s shard.
fn gated_document(
    env: &mut Env,
    owner: &Keypair,
    base: &Target,
    slug: &str,
    vault: bool,
) -> Target {
    let (document, res) = env.create_document(owner, &base.org, slug, "offering-terms", "en-US");
    assert_ok(&res);
    let version = env.publish(owner, &base.org, &document, &format!("{slug} v1"));
    let t = Target {
        org: base.org,
        document,
        version,
        shard: base.shard,
    };
    assert_ok(&env.send(&[create_policy_ix(&owner.pubkey(), &t)], owner, &[]));
    if vault {
        let policy = policy_pda(&document);
        assert_ok(&env.send(&[create_vault_ix(&owner.pubkey(), &policy)], owner, &[]));
    }
    t
}

// ---- passport acceptance ----------------------------------------------------------------------

fn passport_ix_with(
    relayer: &Address,
    rent_payer: &Address,
    passport: &Address,
    bump: u8,
    t: &Target,
    a: &AcceptParams,
) -> Instruction {
    ix(
        stele::instruction::RecordPassportAcceptance {
            nonce_index: a.nonce_index,
            nonce_tag: a.nonce_tag,
            issued_at: a.issued_at,
            expires_at: a.expires_at,
            passport_bump: bump,
        },
        vec![
            signer_rw(*relayer),
            signer_rw(*rent_payer),
            ro(config_pda()),
            ro(t.org),
            ro(t.document),
            ro(t.version),
            rw(t.shard),
            rw(*passport),
            ro(system_program()),
            ro(instructions_sysvar()),
        ],
    )
}

fn passport_ix(
    relayer: &Address,
    rent_payer: &Address,
    holder: &Address,
    t: &Target,
    a: &AcceptParams,
) -> Instruction {
    let (passport, bump) = passport_and_bump(holder);
    passport_ix_with(relayer, rent_payer, &passport, bump, t, a)
}

fn signed_ed25519(env: &Env, user: &Keypair, t: &Target, a: &AcceptParams) -> Instruction {
    let message = env.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), a);
    let sig = user.sign_message(message.as_bytes());
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(sig.as_ref());
    ed25519_ix(&user.pubkey().to_bytes(), &sig_bytes, message.as_bytes())
}

fn signer_list<'a>(payer: &'a Keypair, signers: &[&'a Keypair]) -> Vec<&'a Keypair> {
    let mut all: Vec<&Keypair> = vec![payer];
    for s in signers {
        if !all.iter().any(|k| k.pubkey() == s.pubkey()) {
            all.push(s);
        }
    }
    all
}

/// Legacy transaction; returns the result and the serialized size in bytes.
fn send_sized(
    env: &mut Env,
    ixs: &[Instruction],
    payer: &Keypair,
    signers: &[&Keypair],
) -> (TxResult, usize) {
    let all = signer_list(payer, signers);
    let tx = Transaction::new_signed_with_payer(
        ixs,
        Some(&payer.pubkey()),
        &all,
        env.svm.latest_blockhash(),
    );
    let size = 1 + 64 * tx.signatures.len() + tx.message.serialize().len();
    let res = env.svm.send_transaction(tx);
    env.svm.expire_blockhash();
    (res, size)
}

/// Version-0 transaction with an address lookup table; returns the result and the size in bytes.
fn send_v0(
    env: &mut Env,
    ixs: &[Instruction],
    payer: &Keypair,
    signers: &[&Keypair],
    table: &AddressLookupTableAccount,
) -> (TxResult, usize) {
    let all = signer_list(payer, signers);
    let message = v0::Message::try_compile(
        &payer.pubkey(),
        ixs,
        std::slice::from_ref(table),
        env.svm.latest_blockhash(),
    )
    .expect("compile v0");
    let message = VersionedMessage::V0(message);
    let size_message = message.serialize().len();
    let tx = VersionedTransaction::try_new(message, &all).expect("sign v0");
    let size = 1 + 64 * tx.signatures.len() + size_message;
    let res = env.svm.send_transaction(tx);
    env.svm.expire_blockhash();
    (res, size)
}

/// An active address lookup table holding `addresses` (state written directly, as the ALT
/// program would after `create` + `extend` in an earlier slot).
fn lookup_table(env: &mut Env, addresses: Vec<Address>) -> AddressLookupTableAccount {
    let key = Keypair::new().pubkey();
    let mut data = Vec::with_capacity(56 + 32 * addresses.len());
    data.extend_from_slice(&1u32.to_le_bytes()); // ProgramState::LookupTable
    data.extend_from_slice(&u64::MAX.to_le_bytes()); // deactivation_slot: active
    data.extend_from_slice(&0u64.to_le_bytes()); // last_extended_slot
    data.push(0); // last_extended_slot_start_index
    data.push(1); // authority: Some
    data.extend_from_slice(env.admin.pubkey().as_ref());
    data.extend_from_slice(&[0, 0]); // padding
    for a in &addresses {
        data.extend_from_slice(a.as_ref());
    }
    let lamports = env.svm.minimum_balance_for_rent_exemption(data.len());
    env.svm
        .set_account(
            key,
            solana_account::Account {
                lamports,
                data,
                owner: addr("AddressLookupTab1e1111111111111111111111111"),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    env.advance(1);
    AddressLookupTableAccount { key, addresses }
}

/// The user signs the ordinary acceptance message; the relayer records it into the user's
/// passport, `rent_payer` paying any new deposit.
fn accept_into_passport(
    env: &mut Env,
    user: &Keypair,
    rent_payer: &Keypair,
    t: &Target,
    a: &AcceptParams,
) -> (TxResult, usize) {
    let ed = signed_ed25519(env, user, t, a);
    let relayer = env.relayer.insecure_clone();
    let rec = passport_ix(
        &relayer.pubkey(),
        &rent_payer.pubkey(),
        &user.pubkey(),
        t,
        a,
    );
    send_sized(env, &[ed, rec], &relayer, &[rent_payer])
}

fn deposit_ix(investor: &Address, policy: &Address, passport: &Address) -> Instruction {
    Instruction {
        program_id: vault_program(),
        accounts: vec![
            AccountMeta::new_readonly(*investor, true),
            rw(vault_pda(policy)),
            ro(*policy),
            ro(*passport),
        ],
        data: stele_gate_demo::instruction::DepositWithPassport {
            amount: 5_000_000_000,
        }
        .data(),
    }
}

/// The investor deposits directly (their own transaction and fee), presenting `passport`.
fn deposit(env: &mut Env, investor: &Keypair, t: &Target, passport: &Address) -> (TxResult, usize) {
    let i = deposit_ix(&investor.pubkey(), &policy_pda(&t.document), passport);
    send_sized(env, &[i], investor, &[])
}

fn manage_ix(
    close: bool,
    authority: &Address,
    passport: &Address,
    refund_to: &Address,
    document: Option<&Address>,
) -> Instruction {
    let accounts = vec![signer_ro(*authority), rw(*passport), rw(*refund_to)];
    if close {
        ix(stele::instruction::ClosePassport {}, accounts)
    } else {
        ix(
            stele::instruction::RemovePassportEntry {
                document: to_pk(document.expect("document")),
            },
            accounts,
        )
    }
}

/// Passport entries as (document, version_number, accepted_at, payer).
fn entries(env: &Env, holder: &Address) -> Vec<(Address, u32, i64, Address)> {
    let acc = env.raw_account(&passport_pda(holder)).expect("passport");
    let d = acc.data;
    let count = u32::from_le_bytes(d[40..44].try_into().unwrap()) as usize;
    assert_eq!(d.len(), PASSPORT_HEADER_LEN + count * PASSPORT_ENTRY_LEN);
    (0..count)
        .map(|i| {
            let at = PASSPORT_HEADER_LEN + i * PASSPORT_ENTRY_LEN;
            (
                Address::new_from_array(d[at..at + 32].try_into().unwrap()),
                u32::from_le_bytes(d[at + 32..at + 36].try_into().unwrap()),
                i64::from_le_bytes(d[at + 36..at + 44].try_into().unwrap()),
                Address::new_from_array(
                    d[at + ENTRY_PAYER..at + ENTRY_PAYER + 32]
                        .try_into()
                        .unwrap(),
                ),
            )
        })
        .collect()
}

fn header_rent(env: &Env) -> u64 {
    env.svm
        .minimum_balance_for_rent_exemption(PASSPORT_HEADER_LEN)
}

fn entry_rent(env: &Env) -> u64 {
    env.svm
        .minimum_balance_for_rent_exemption(PASSPORT_HEADER_LEN + PASSPORT_ENTRY_LEN)
        - header_rent(env)
}

struct Setup {
    env: Env,
    owner: Keypair,
    base: Target,
    nonce: u32,
}

impl Setup {
    fn new() -> Self {
        let mut env = Env::new();
        deploy_vault_program(&mut env);
        let fx = env.fixture();
        Setup {
            env,
            owner: fx.owner,
            base: fx.target,
            nonce: 0,
        }
    }
    fn next(&mut self) -> AcceptParams {
        let a = self.env.default_accept(self.nonce);
        self.nonce += 1;
        a
    }
    fn document(&mut self, slug: &str) -> Target {
        let owner = self.owner.insecure_clone();
        let base = self.base;
        gated_document(&mut self.env, &owner, &base, slug, true)
    }
}

// ---- functional ---------------------------------------------------------------------------------

#[test]
fn first_acceptance_creates_the_passport_and_admits_the_deposit() {
    let mut s = Setup::new();
    let t = s.document("offering-terms");
    let user = s.env.funded();
    let pp = passport_pda(&user.pubkey());

    let (res, _) = deposit(&mut s.env, &user, &t, &pp);
    assert_custom(&res, gate_err(GateError::AccessPassMissing));

    let before = s.env.lamports(&user.pubkey());
    let a = s.next();
    let (res, _) = accept_into_passport(&mut s.env, &user, &user, &t, &a);
    assert_ok(&res);
    let paid = before - s.env.lamports(&user.pubkey());
    assert_eq!(paid, header_rent(&s.env) + entry_rent(&s.env));
    assert_eq!(
        s.env.lamports(&pp),
        paid,
        "the deposit sits in the passport"
    );
    let e = entries(&s.env, &user.pubkey());
    assert_eq!(e.len(), 1);
    assert_eq!((e[0].0, e[0].1, e[0].3), (t.document, 1, user.pubkey()));

    assert_ok(&deposit(&mut s.env, &user, &t, &pp).0);
    let v: Vault = {
        let acc = s
            .env
            .raw_account(&vault_pda(&policy_pda(&t.document)))
            .unwrap();
        Vault::try_deserialize(&mut acc.data.as_slice()).unwrap()
    };
    assert_eq!(v.deposit_count, 1);
}

#[test]
fn entries_stay_sorted_and_each_document_is_checked_independently() {
    let mut s = Setup::new();
    let docs: Vec<Target> = (0..6).map(|i| s.document(&format!("doc-{i}"))).collect();
    let user = s.env.funded();
    let pp = passport_pda(&user.pubkey());
    for i in [4usize, 0, 2] {
        let a = s.next();
        assert_ok(&accept_into_passport(&mut s.env, &user, &user, &docs[i], &a).0);
    }
    let e = entries(&s.env, &user.pubkey());
    assert_eq!(e.len(), 3);
    assert!(
        e.windows(2).all(|w| w[0].0.to_bytes() < w[1].0.to_bytes()),
        "sorted"
    );
    for (i, t) in docs.iter().enumerate() {
        let (res, _) = deposit(&mut s.env, &user, t, &pp);
        if i % 2 == 0 {
            assert_ok(&res);
        } else {
            assert_custom(&res, gate_err(GateError::AccessPassMissing));
        }
    }
}

#[test]
fn a_newer_version_advances_the_entry_in_place_and_old_entries_become_outdated() {
    let mut s = Setup::new();
    let mut t = s.document("offering-terms");
    let user = s.env.funded();
    let pp = passport_pda(&user.pubkey());
    let a = s.next();
    assert_ok(&accept_into_passport(&mut s.env, &user, &user, &t, &a).0);

    let owner = s.owner.insecure_clone();
    t.version = s
        .env
        .publish(&owner, &t.org, &t.document, "offering-terms v2");
    assert_ok(
        &s.env
            .send(&[require_version_ix(&owner.pubkey(), &t)], &owner, &[]),
    );
    assert_custom(
        &deposit(&mut s.env, &user, &t, &pp).0,
        gate_err(GateError::AccessPassOutdated),
    );

    let size_before = s.env.raw_account(&pp).unwrap().data.len();
    let before = s.env.lamports(&user.pubkey());
    let a = s.next();
    assert_ok(&accept_into_passport(&mut s.env, &user, &user, &t, &a).0);
    assert_eq!(
        s.env.raw_account(&pp).unwrap().data.len(),
        size_before,
        "no growth"
    );
    assert_eq!(s.env.lamports(&user.pubkey()), before, "no new deposit");
    assert_eq!(entries(&s.env, &user.pubkey())[0].1, 2);
    assert_ok(&deposit(&mut s.env, &user, &t, &pp).0);

    let a = s.next();
    assert_stele_err(
        &accept_into_passport(&mut s.env, &user, &user, &t, &a).0,
        SteleError::AccessPassAlreadyCurrent,
    );
}

#[test]
fn the_passport_is_always_the_signers_whatever_account_the_relayer_names() {
    let mut s = Setup::new();
    let t = s.document("offering-terms");
    let user = s.env.funded();
    let victim = s.env.funded();
    let relayer = s.env.relayer.insecure_clone();

    // The relayer names the victim's passport for the user's signature.
    let a = s.next();
    let ed = signed_ed25519(&s.env, &user, &t, &a);
    let (victim_pp, victim_bump) = passport_and_bump(&victim.pubkey());
    let rec = passport_ix_with(
        &relayer.pubkey(),
        &relayer.pubkey(),
        &victim_pp,
        victim_bump,
        &t,
        &a,
    );
    assert_stele_err(
        &s.env.send(&[ed, rec], &relayer, &[]),
        SteleError::PassportMismatch,
    );
    assert!(s.env.raw_account(&victim_pp).is_none());

    // A wrong bump for the right passport fails the address check (no on-chain search).
    let a = s.next();
    let ed = signed_ed25519(&s.env, &user, &t, &a);
    let (pp, bump) = passport_and_bump(&user.pubkey());
    let rec = passport_ix_with(
        &relayer.pubkey(),
        &relayer.pubkey(),
        &pp,
        bump.wrapping_sub(1),
        &t,
        &a,
    );
    assert_stele_err(
        &s.env.send(&[ed, rec], &relayer, &[]),
        SteleError::PassportMismatch,
    );
}

#[test]
fn another_wallets_passport_or_a_forged_account_is_refused() {
    let mut s = Setup::new();
    let t = s.document("offering-terms");
    let alice = s.env.funded();
    let mallory = s.env.funded();
    let a = s.next();
    assert_ok(&accept_into_passport(&mut s.env, &alice, &alice, &t, &a).0);

    let alices = passport_pda(&alice.pubkey());
    assert_custom(
        &deposit(&mut s.env, &mallory, &t, &alices).0,
        gate_err(GateError::AccessPassMismatch),
    );

    let mut data = s.env.raw_account(&alices).unwrap().data;
    data[8..40].copy_from_slice(mallory.pubkey().as_ref());
    let forged = Keypair::new().pubkey();
    s.env
        .svm
        .set_account(
            forged,
            solana_account::Account {
                lamports: 10_000_000,
                data,
                owner: system_program(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    assert_custom(
        &deposit(&mut s.env, &mallory, &t, &forged).0,
        gate_err(GateError::AccessPassInvalid),
    );

    // The investor must sign (the vault's `Signer` refuses first; the gate would too).
    let mut i2 = deposit_ix(&alice.pubkey(), &policy_pda(&t.document), &alices);
    i2.accounts[0] = AccountMeta::new_readonly(alice.pubkey(), false);
    let relayer = s.env.relayer.insecure_clone();
    assert_failed(&s.env.send(&[i2], &relayer, &[]));
}

#[test]
fn every_deposit_returns_to_whoever_paid_it() {
    let mut s = Setup::new();
    let t1 = s.document("doc-investor-paid");
    let t2 = s.document("doc-company-paid");
    let user = s.env.funded();
    let company = s.env.funded();
    let pp = passport_pda(&user.pubkey());
    let a = s.next();
    assert_ok(&accept_into_passport(&mut s.env, &user, &user, &t1, &a).0);
    let a = s.next();
    let company_before = s.env.lamports(&company.pubkey());
    assert_ok(&accept_into_passport(&mut s.env, &user, &company, &t2, &a).0);
    assert_eq!(
        company_before - s.env.lamports(&company.pubkey()),
        entry_rent(&s.env)
    );
    let payers: Vec<Address> = entries(&s.env, &user.pubkey())
        .iter()
        .map(|e| e.3)
        .collect();
    assert!(payers.contains(&company.pubkey()) && payers.contains(&user.pubkey()));

    // The holder cannot redirect the company's deposit to themselves.
    let i = manage_ix(
        false,
        &user.pubkey(),
        &pp,
        &user.pubkey(),
        Some(&t2.document),
    );
    assert_stele_err(
        &s.env.send(&[i], &user, &[]),
        SteleError::PassportRefundMismatch,
    );
    // A stranger cannot remove anyone's entry.
    let stranger = s.env.funded();
    let i = manage_ix(
        false,
        &stranger.pubkey(),
        &pp,
        &company.pubkey(),
        Some(&t2.document),
    );
    assert_stele_err(
        &s.env.send(&[i], &stranger, &[]),
        SteleError::PassportUnauthorized,
    );
    // Closing is refused while the company's deposit is still inside.
    let i = manage_ix(true, &user.pubkey(), &pp, &user.pubkey(), None);
    assert_stele_err(
        &s.env.send(&[i], &user, &[]),
        SteleError::PassportHasOtherDeposits,
    );

    // The company removes the entry it paid for: exactly that deposit comes back to it.
    let before = s.env.lamports(&company.pubkey());
    let i = manage_ix(
        false,
        &company.pubkey(),
        &pp,
        &company.pubkey(),
        Some(&t2.document),
    );
    assert_ok(&s.env.send(&[i], &company, &[]));
    assert_eq!(
        s.env.lamports(&company.pubkey()),
        before + entry_rent(&s.env) - 5_000
    );
    assert_custom(
        &deposit(&mut s.env, &user, &t2, &pp).0,
        gate_err(GateError::AccessPassMissing),
    );
    assert_ok(&deposit(&mut s.env, &user, &t1, &pp).0);

    // Now everything inside is the investor's: closing returns it all to them.
    let held = s.env.lamports(&pp);
    let before = s.env.lamports(&user.pubkey());
    let shard_before = s.env.shard(&t1.shard);
    let i = manage_ix(true, &user.pubkey(), &pp, &user.pubkey(), None);
    assert_ok(&s.env.send(&[i], &user, &[]));
    assert_eq!(s.env.lamports(&user.pubkey()), before + held - 5_000);
    assert!(s
        .env
        .raw_account(&pp)
        .map(|a| a.lamports == 0)
        .unwrap_or(true));
    assert_custom(
        &deposit(&mut s.env, &user, &t1, &pp).0,
        gate_err(GateError::AccessPassMissing),
    );
    // The acceptance evidence is untouched.
    assert_eq!(shard_before.bitmap, s.env.shard(&t1.shard).bitmap);

    // Accepting again creates a fresh passport.
    let owner = s.owner.insecure_clone();
    let mut t1b = t1;
    t1b.version = s.env.publish(&owner, &t1.org, &t1.document, "doc v2");
    let a = s.next();
    assert_ok(&accept_into_passport(&mut s.env, &user, &user, &t1b, &a).0);
    assert_eq!(entries(&s.env, &user.pubkey()).len(), 1);
}

#[test]
fn a_company_paid_passport_closes_back_to_the_company() {
    let mut s = Setup::new();
    let t = s.document("offering-terms");
    let user = s.env.funded();
    let company = s.env.funded();
    let pp = passport_pda(&user.pubkey());
    let user_before = s.env.lamports(&user.pubkey());
    let a = s.next();
    assert_ok(&accept_into_passport(&mut s.env, &user, &company, &t, &a).0);
    assert_eq!(
        s.env.lamports(&user.pubkey()),
        user_before,
        "the investor paid nothing"
    );
    let held = s.env.lamports(&pp);
    // The holder may close it, but the money goes back to the company, never to the holder.
    let i = manage_ix(true, &user.pubkey(), &pp, &user.pubkey(), None);
    assert_stele_err(
        &s.env.send(&[i], &user, &[]),
        SteleError::PassportRefundMismatch,
    );
    let before = s.env.lamports(&company.pubkey());
    let i = manage_ix(true, &user.pubkey(), &pp, &company.pubkey(), None);
    assert_ok(&s.env.send(&[i], &user, &[]));
    assert_eq!(s.env.lamports(&company.pubkey()), before + held);
}

#[test]
fn a_prefunded_passport_address_is_still_created() {
    let mut s = Setup::new();
    let t = s.document("offering-terms");
    let user = s.env.funded();
    let pp = passport_pda(&user.pubkey());
    let griefer = s.env.funded();
    s.env.deposit(&griefer, &pp, 1_000_000);
    let a = s.next();
    assert_ok(&accept_into_passport(&mut s.env, &user, &user, &t, &a).0);
    assert_ok(&deposit(&mut s.env, &user, &t, &pp).0);
}

#[test]
fn v0_transactions_with_a_lookup_table_fit_the_worst_case() {
    // Longest names the protocol allows and the longest request domain.
    let mut env = Env::new();
    deploy_vault_program(&mut env);
    let owner = env.funded();
    let org = env.create_org(&owner, &"N".repeat(40), None);
    let (document, res) =
        env.create_document(&owner, &org, &"s".repeat(32), "offering-terms", "en-US");
    assert_ok(&res);
    let p = env.next_publish_params(&document, "worst case");
    let p = PublishParams {
        title: "T".repeat(60),
        version_label: "L".repeat(16),
        ..p
    };
    let (version, res) = env.publish_with(&owner, &org, &document, &p, true);
    assert_ok(&res);
    let relayer_pk = env.relayer.pubkey();
    let (shard, res) = env.create_shard(&owner, &org, 0, &relayer_pk);
    assert_ok(&res);
    let t = Target {
        org,
        document,
        version,
        shard,
    };
    assert_ok(&env.send(&[create_policy_ix(&owner.pubkey(), &t)], &owner, &[]));
    let table = lookup_table(
        &mut env,
        vec![
            config_pda(),
            org,
            document,
            version,
            shard,
            system_program(),
            instructions_sysvar(),
        ],
    );
    let user = env.funded();
    let mut a = env.default_accept(0);
    a.request_domain = format!("{}.example", "r".repeat(40));
    let ed = signed_ed25519(&env, &user, &t, &a);
    let relayer = env.relayer.insecure_clone();
    let rec = passport_ix(&relayer.pubkey(), &user.pubkey(), &user.pubkey(), &t, &a);
    let ixs = [cu_limit_ix(80_000), cu_price_ix(20_000), ed, rec];
    let (res, size) = send_v0(&mut env, &ixs, &relayer, &[&user], &table);
    assert_ok(&res);
    println!("worst-case investor-paid passport acceptance, v0 + lookup table: {size} bytes");
    assert!(size <= 1_232, "{size} bytes");
}

// ---- measurements -------------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct Stat {
    n: u64,
    sum: u64,
    min: u64,
    max: u64,
}

impl Stat {
    fn new() -> Self {
        Stat {
            n: 0,
            sum: 0,
            min: u64::MAX,
            max: 0,
        }
    }
    fn add(&mut self, v: u64) {
        self.n += 1;
        self.sum += v;
        self.min = self.min.min(v);
        self.max = self.max.max(v);
    }
    fn avg(&self) -> u64 {
        self.sum.checked_div(self.n).unwrap_or(0)
    }
    fn show(&self) -> String {
        format!("{}/{}/{}", self.min, self.avg(), self.max)
    }
}

fn cu(res: &TxResult) -> u64 {
    match res {
        Ok(m) => m.compute_units_consumed,
        Err(e) => panic!("transaction failed: {:?}", e.err),
    }
}

fn bench_env() -> Setup {
    let mut s = Setup::new();
    // Scale runs keep no per-transaction history (millions of transactions).
    let svm = std::mem::take(&mut s.env.svm);
    s.env.svm = svm
        .with_transaction_history(0)
        .with_log_bytes_limit(Some(0));
    s
}

fn env_usize(name: &str, default: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

/// Transaction sizes, legacy vs v0 + lookup table, for every flow.
#[test]
#[ignore]
fn bench_transaction_sizes() {
    let mut s = Setup::new();
    let t = s.document("offering-terms");
    let table = lookup_table(
        &mut s.env,
        vec![
            config_pda(),
            t.org,
            t.document,
            t.version,
            t.shard,
            system_program(),
            instructions_sysvar(),
        ],
    );
    let relayer = s.env.relayer.insecure_clone();
    println!("\n== TRANSACTION SIZE (limit 1,232 bytes; with compute-budget instructions) ==");
    println!("flow | legacy | v0 + lookup table");
    for (label, investor_pays) in [
        ("passport, investor pays deposit", true),
        ("passport, company pays deposit", false),
    ] {
        let mut sizes = vec![];
        for v0 in [false, true] {
            let user = s.env.funded();
            let a = s.next();
            let ed = signed_ed25519(&s.env, &user, &t, &a);
            let payer = if investor_pays {
                user.insecure_clone()
            } else {
                relayer.insecure_clone()
            };
            let rec = passport_ix(&relayer.pubkey(), &payer.pubkey(), &user.pubkey(), &t, &a);
            let ixs = [cu_limit_ix(80_000), cu_price_ix(20_000), ed, rec];
            let (res, size) = if v0 {
                send_v0(&mut s.env, &ixs, &relayer, &[&payer], &table)
            } else {
                send_sized(&mut s.env, &ixs, &relayer, &[&payer])
            };
            assert_ok(&res);
            sizes.push(size);
        }
        println!("{label} | {} | {}", sizes[0], sizes[1]);
    }
    let mut sizes = vec![];
    for v0 in [false, true] {
        let user = Keypair::new();
        let a = s.next();
        let ed = signed_ed25519(&s.env, &user, &t, &a);
        let rec = s.env.record_acceptance_ix(
            &relayer.pubkey(),
            &t.org,
            &t.document,
            &t.version,
            &t.shard,
            &a,
        );
        let ixs = [cu_limit_ix(60_000), cu_price_ix(20_000), ed, rec];
        let (res, size) = if v0 {
            send_v0(&mut s.env, &ixs, &relayer, &[], &table)
        } else {
            send_sized(&mut s.env, &ixs, &relayer, &[])
        };
        assert_ok(&res);
        sizes.push(size);
    }
    println!("Proof acceptance (direct) | {} | {}", sizes[0], sizes[1]);
}

/// One investor accepts 1 … 10,000 documents into one passport.
#[test]
#[ignore]
fn bench_one_user_many_documents() {
    let mut s = bench_env();
    // 10,000 documents cost the organization ~86 SOL of document, version and policy rent.
    s.env
        .svm
        .airdrop(&s.owner.pubkey(), 1_000_000_000_000)
        .unwrap();
    let user = s.env.funded();
    let pp = passport_pda(&user.pubkey());
    let milestones = [1usize, 10, 100, 1_000, 5_000, 10_000];
    let mut accept_cu = Stat::new();
    let mut fee = Stat::new();
    let mut prev_held = 0u64;
    let mut prev_m = 0usize;
    let mut first: Option<Target> = None;
    let started = std::time::Instant::now();
    println!("\n== ONE INVESTOR, MANY DOCUMENTS (one passport, investor pays) ==");
    println!("docs | passport bytes | deposit held (lamports) | added per new doc | accept CU min/avg/max | relayer fee | deposit CU first/last doc | investor deposit-tx fee | elapsed");
    let mut created = 0usize;
    for &m in &milestones {
        let mut last = None;
        while created < m {
            let vault = created == 0 || created + 1 == m;
            let owner = s.owner.insecure_clone();
            let base = s.base;
            let t = gated_document(&mut s.env, &owner, &base, &format!("d{created}"), vault);
            let a = s.next();
            let relayer_before = s.env.lamports(&s.env.relayer.pubkey());
            let (res, _) = accept_into_passport(&mut s.env, &user, &user, &t, &a);
            accept_cu.add(cu(&res));
            fee.add(relayer_before - s.env.lamports(&s.env.relayer.pubkey()));
            first.get_or_insert(t);
            last = Some(t);
            created += 1;
        }
        let held = s.env.lamports(&pp);
        let bytes = s.env.raw_account(&pp).unwrap().data.len();
        let per_doc = (held - prev_held) / (m - prev_m) as u64;
        prev_held = held;
        prev_m = m;
        let before = s.env.lamports(&user.pubkey());
        let (r1, _) = deposit(&mut s.env, &user, first.as_ref().unwrap(), &pp);
        let dep_fee = before - s.env.lamports(&user.pubkey());
        let (r2, _) = deposit(&mut s.env, &user, last.as_ref().unwrap(), &pp);
        println!(
            "{m} | {bytes} | {held} | {per_doc} | {} | {} | {} / {} | {dep_fee} | {:.1}s",
            accept_cu.show(),
            fee.avg(),
            cu(&r1),
            cu(&r2),
            started.elapsed().as_secs_f64()
        );
    }
}

/// 1 … 1,000,000 investors, one document each, one deposit each; then 10,000 re-accept v2.
#[test]
#[ignore]
fn bench_many_users_one_document() {
    let max_users = env_usize("STELE_BENCH_USERS", 1_000_000) as u64;
    let mut s = bench_env();
    let t = s.document("offering-terms");
    let owner = s.owner.insecure_clone();
    let relayer_pk = s.env.relayer.pubkey();
    let mut milestones: Vec<u64> = [
        1u64, 10, 100, 1_000, 10_000, 100_000, 250_000, 500_000, 1_000_000,
    ]
    .into_iter()
    .filter(|m| *m <= max_users)
    .collect();
    if milestones.last() != Some(&max_users) {
        milestones.push(max_users);
    }
    let mut accept_cu = Stat::new();
    let mut deposit_cu = Stat::new();
    let mut fee = Stat::new();
    let mut held = Stat::new();
    let mut dep_fee = Stat::new();
    let mut shard_id = 0u16;
    let mut target = t;
    let mut users: Vec<Keypair> = Vec::new();
    let keep = 10_000usize;
    let started = std::time::Instant::now();
    println!("\n== MANY INVESTORS, ONE DOCUMENT (investor pays the deposit) ==");
    println!("investors | shards | accept CU min/avg/max | relayer fee | deposit per investor | deposit CU min/avg/max | investor deposit-tx fee | deposits held total (SOL) | elapsed");
    let mut done = 0u64;
    for &m in &milestones {
        while done < m {
            if s.nonce as usize >= 65_536 {
                shard_id += 1;
                let (shard, res) = s
                    .env
                    .create_shard(&owner, &target.org, shard_id, &relayer_pk);
                assert_ok(&res);
                target.shard = shard;
                s.nonce = 0;
            }
            let user = Keypair::new();
            s.env.svm.airdrop(&user.pubkey(), 10_000_000).unwrap();
            let a = s.next();
            let relayer_before = s.env.lamports(&relayer_pk);
            let user_before = s.env.lamports(&user.pubkey());
            let (res, _) = accept_into_passport(&mut s.env, &user, &user, &target, &a);
            accept_cu.add(cu(&res));
            fee.add(relayer_before - s.env.lamports(&relayer_pk));
            held.add(user_before - s.env.lamports(&user.pubkey()));
            let before = s.env.lamports(&user.pubkey());
            let (res, _) = deposit(&mut s.env, &user, &target, &passport_pda(&user.pubkey()));
            deposit_cu.add(cu(&res));
            dep_fee.add(before - s.env.lamports(&user.pubkey()));
            if users.len() < keep {
                users.push(user);
            }
            done += 1;
        }
        println!(
            "{m} | {} | {} | {} | {} | {} | {} | {:.4} | {:.1}s",
            shard_id + 1,
            accept_cu.show(),
            fee.avg(),
            held.avg(),
            deposit_cu.show(),
            dep_fee.avg(),
            held.sum as f64 / 1e9,
            started.elapsed().as_secs_f64()
        );
    }

    // The fund publishes v2 and requires it; the first investors re-accept (in-place update).
    let mut t2 = target;
    t2.version = s
        .env
        .publish(&owner, &t.org, &t.document, "offering-terms v2");
    assert_ok(
        &s.env
            .send(&[require_version_ix(&owner.pubkey(), &t2)], &owner, &[]),
    );
    let mut re_cu = Stat::new();
    let mut re_paid = Stat::new();
    let mut outdated = 0u64;
    for user in &users {
        if s.nonce as usize >= 65_536 {
            shard_id += 1;
            let (shard, res) = s.env.create_shard(&owner, &t2.org, shard_id, &relayer_pk);
            assert_ok(&res);
            t2.shard = shard;
            s.nonce = 0;
        }
        let pp = passport_pda(&user.pubkey());
        if deposit(&mut s.env, user, &t2, &pp).0.is_err() {
            outdated += 1;
        }
        let a = s.next();
        let before = s.env.lamports(&user.pubkey());
        let (res, _) = accept_into_passport(&mut s.env, user, user, &t2, &a);
        re_cu.add(cu(&res));
        re_paid.add(before - s.env.lamports(&user.pubkey()));
        assert_ok(&deposit(&mut s.env, user, &t2, &pp).0);
    }
    println!(
        "\nv2 re-acceptance by {n} investors: refused before re-accepting {outdated}/{n} | accept CU min/avg/max {} | extra deposit per investor {} lamports | total elapsed {:.1}s",
        re_cu.show(),
        re_paid.avg(),
        started.elapsed().as_secs_f64(),
        n = users.len()
    );
}

/// Stele Proof: 1 … 1,000,000 direct acceptances, then 500 Merkle batch anchors per size.
#[test]
#[ignore]
fn bench_proof_acceptances() {
    let max = env_usize("STELE_BENCH_ACCEPTANCES", 1_000_000) as u64;
    let mut s = bench_env();
    let owner = s.owner.insecure_clone();
    let mut t = s.base;
    let mut milestones: Vec<u64> = [
        1u64, 10, 100, 1_000, 10_000, 100_000, 250_000, 500_000, 1_000_000,
    ]
    .into_iter()
    .filter(|m| *m <= max)
    .collect();
    if milestones.last() != Some(&max) {
        milestones.push(max);
    }
    let mut acc_cu = Stat::new();
    let mut fee = Stat::new();
    let mut size = Stat::new();
    let mut nonce = 0u32;
    let mut shard_id = 0u16;
    let shard_rent = s.env.lamports(&t.shard);
    let relayer = s.env.relayer.insecure_clone();
    let started = std::time::Instant::now();
    println!("\n== STELE PROOF: DIRECT ACCEPTANCES ==");
    println!("acceptances | shards (rent each {shard_rent}) | CU min/avg/max | tx bytes max | relayer fee | shard rent per acceptance | elapsed");
    let mut done = 0u64;
    for &m in &milestones {
        while done < m {
            if nonce as usize >= 65_536 {
                shard_id += 1;
                let (shard, res) = s
                    .env
                    .create_shard(&owner, &t.org, shard_id, &relayer.pubkey());
                assert_ok(&res);
                t.shard = shard;
                nonce = 0;
            }
            let user = Keypair::new();
            let a = s.env.default_accept(nonce);
            nonce += 1;
            let ed = signed_ed25519(&s.env, &user, &t, &a);
            let rec = s.env.record_acceptance_ix(
                &relayer.pubkey(),
                &t.org,
                &t.document,
                &t.version,
                &t.shard,
                &a,
            );
            let before = s.env.lamports(&relayer.pubkey());
            let (res, sz) = send_sized(&mut s.env, &[ed, rec], &relayer, &[]);
            acc_cu.add(cu(&res));
            size.add(sz as u64);
            fee.add(before - s.env.lamports(&relayer.pubkey()));
            done += 1;
        }
        let shards = shard_id as u64 + 1;
        println!(
            "{m} | {shards} | {} | {} | {} | {} | {:.1}s",
            acc_cu.show(),
            size.max,
            fee.avg(),
            shards * shard_rent / m,
            started.elapsed().as_secs_f64()
        );
    }

    println!("\n== STELE PROOF: MERKLE BATCH ANCHORS (500 anchors per size) ==");
    println!("leaves per anchor | anchor CU min/avg/max | anchor fee | fee per acceptance (lamports) | acceptances anchored");
    for leaves in [1u32, 64, 1_024, 65_536] {
        let mut c = Stat::new();
        let mut f = Stat::new();
        for k in 0..500u32 {
            let root = hash32(format!("root-{leaves}-{k}").as_bytes());
            let i = ix(
                stele::instruction::AnchorAcceptanceBatch {
                    args: stele::instructions::AnchorAcceptanceBatchArgs {
                        batch_root: root,
                        leaf_count: leaves,
                    },
                },
                vec![
                    signer_rw(relayer.pubkey()),
                    ro(config_pda()),
                    ro(t.org),
                    rw(t.shard),
                    ro(instructions_sysvar()),
                ],
            );
            let before = s.env.lamports(&relayer.pubkey());
            let (res, _) = send_sized(&mut s.env, &[i], &relayer, &[]);
            c.add(cu(&res));
            f.add(before - s.env.lamports(&relayer.pubkey()));
        }
        println!(
            "{leaves} | {} | {} | {:.4} | {}",
            c.show(),
            f.avg(),
            f.avg() as f64 / leaves as f64,
            leaves as u64 * 500
        );
    }
}
