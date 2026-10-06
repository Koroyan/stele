//! LiteSVM test harness for the Stele program.
//!
//! * Loads the **compiled** `target/deploy/stele.so` (build with `cargo build-sbf` first).
//! * Deploys it with the upgradeable loader and a known upgrade authority, so the real
//!   upgrade-authority gate on `initialize_protocol` is exercised.
//! * Uses the native Ed25519 precompile — signatures are real and really verified.
//! * Controls the cluster clock for time-lock and expiry tests.

#![allow(dead_code)]
// LiteSVM's failure type is large; boxing it would only add noise to every test.
#![allow(clippy::result_large_err)]

use anchor_lang::{AccountDeserialize, InstructionData};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;
use stele::state::{
    Document, DocumentVersion, Member, NonceShard, Organization, ProtocolConfig, ShardSponsorship,
};
use stele_core::message::{acceptance_message, AcceptanceMessageFields};
use stele_core::proof::{proof_message, ProofMessageFields};
use stele_core::version::{version_hash, VersionFields};

pub type Pk = anchor_lang::prelude::Pubkey;
pub type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

pub const CHAIN_ID: &str = "solana:localnet";
pub const NETWORK_LABEL: &str = "Solana Localnet";
pub const START_TIME: i64 = 1_790_000_000;
pub const REQUEST_DOMAIN: &str = "app.acme.example";

pub fn to_pk(a: &Address) -> Pk {
    Pk::new_from_array(a.to_bytes())
}

pub fn to_addr(p: &Pk) -> Address {
    Address::new_from_array(p.to_bytes())
}

pub fn program_id() -> Address {
    to_addr(&stele::ID)
}

pub fn addr(s: &str) -> Address {
    s.parse().expect("valid address")
}

pub fn system_program() -> Address {
    addr("11111111111111111111111111111111")
}

pub fn instructions_sysvar() -> Address {
    addr("Sysvar1nstructions1111111111111111111111111")
}

pub fn compute_budget_program() -> Address {
    addr("ComputeBudget111111111111111111111111111111")
}

pub fn ed25519_program() -> Address {
    addr("Ed25519SigVerify111111111111111111111111111")
}

pub fn upgradeable_loader() -> Address {
    addr("BPFLoaderUpgradeab1e11111111111111111111111")
}

pub fn pda(seeds: &[&[u8]]) -> Address {
    Address::find_program_address(seeds, &program_id()).0
}

pub fn config_pda() -> Address {
    pda(&[b"config"])
}
pub fn organization_pda(creator: &Address, seed: &[u8; 32]) -> Address {
    pda(&[b"organization", creator.as_ref(), seed])
}
pub fn member_pda(org: &Address, member: &Address) -> Address {
    pda(&[b"member", org.as_ref(), member.as_ref()])
}
pub fn domain_pda(domain: &str) -> Address {
    pda(&[b"domain", &stele_core::hash::domain_hash(domain)])
}
pub fn document_pda(org: &Address, slug: &str) -> Address {
    pda(&[b"document", org.as_ref(), slug.as_bytes()])
}
pub fn version_pda(document: &Address, version: u32) -> Address {
    pda(&[b"version", document.as_ref(), &version.to_le_bytes()])
}
pub fn shard_pda(org: &Address, shard_id: u16) -> Address {
    pda(&[b"nonce-shard", org.as_ref(), &shard_id.to_le_bytes()])
}

pub fn cu_limit_ix(units: u32) -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction {
        program_id: compute_budget_program(),
        accounts: vec![],
        data,
    }
}

pub fn cu_price_ix(micro_lamports: u64) -> Instruction {
    let mut data = vec![3u8];
    data.extend_from_slice(&micro_lamports.to_le_bytes());
    Instruction {
        program_id: compute_budget_program(),
        accounts: vec![],
        data,
    }
}

/// `SystemInstruction::Transfer`.
pub fn transfer_ix(from: &Address, to: &Address, lamports: u64) -> Instruction {
    let mut data = 2u32.to_le_bytes().to_vec();
    data.extend_from_slice(&lamports.to_le_bytes());
    Instruction {
        program_id: system_program(),
        accounts: vec![AccountMeta::new(*from, true), AccountMeta::new(*to, false)],
        data,
    }
}

pub fn ro(a: Address) -> AccountMeta {
    AccountMeta::new_readonly(a, false)
}
pub fn rw(a: Address) -> AccountMeta {
    AccountMeta::new(a, false)
}
pub fn signer_ro(a: Address) -> AccountMeta {
    AccountMeta::new_readonly(a, true)
}
pub fn signer_rw(a: Address) -> AccountMeta {
    AccountMeta::new(a, true)
}
/// Anchor encodes `None` optional accounts as the program ID.
pub fn optional(a: Option<Address>) -> AccountMeta {
    ro(a.unwrap_or_else(program_id))
}

pub fn ix(data: impl InstructionData, accounts: Vec<AccountMeta>) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts,
        data: data.data(),
    }
}

/// Canonical single-signature Ed25519 precompile instruction.
pub fn ed25519_ix(pubkey: &[u8; 32], signature: &[u8; 64], message: &[u8]) -> Instruction {
    let mut data = vec![1u8, 0];
    for v in [
        48u16,
        u16::MAX,
        16,
        u16::MAX,
        112,
        message.len() as u16,
        u16::MAX,
    ] {
        data.extend_from_slice(&v.to_le_bytes());
    }
    data.extend_from_slice(pubkey);
    data.extend_from_slice(signature);
    data.extend_from_slice(message);
    Instruction {
        program_id: ed25519_program(),
        accounts: vec![],
        data,
    }
}

pub fn error_code(e: stele::error::SteleError) -> u32 {
    e.into()
}

/// Asserts that a transaction failed with the given custom program error code.
pub fn assert_custom(res: &TxResult, code: u32) {
    match res {
        Ok(_) => panic!("expected failure with Custom({code}), but the transaction succeeded"),
        Err(e) => {
            let s = format!("{:?}", e.err);
            assert!(
                s.contains(&format!("Custom({code})")),
                "expected Custom({code}), got {s}\nlogs:\n{}",
                e.meta.logs.join("\n")
            );
        }
    }
}

pub fn assert_stele_err(res: &TxResult, e: stele::error::SteleError) {
    assert_custom(res, error_code(e));
}

/// Asserts failure without asserting the exact reason (used for runtime/precompile rejections).
pub fn assert_failed(res: &TxResult) {
    assert!(res.is_err(), "expected the transaction to fail");
}

pub fn assert_ok(res: &TxResult) {
    if let Err(e) = res {
        panic!(
            "transaction failed: {:?}\nlogs:\n{}",
            e.err,
            e.meta.logs.join("\n")
        );
    }
}

pub fn hash32(bytes: &[u8]) -> [u8; 32] {
    stele_core::hash::sha256(bytes)
}

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub attestor: Keypair,
    pub relayer: Keypair,
}

impl Env {
    /// Program deployed, protocol initialized.
    pub fn new() -> Self {
        let mut env = Self::bare();
        let admin_pk = env.admin.pubkey();
        let attestor_pk = env.attestor.pubkey();
        let res = env.initialize_protocol(
            &env.admin.insecure_clone(),
            admin_pk,
            attestor_pk,
            CHAIN_ID,
            NETWORK_LABEL,
        );
        assert_ok(&res);
        env
    }

    /// Program deployed (upgrade authority = `admin`), protocol NOT initialized.
    pub fn bare() -> Self {
        let mut svm = LiteSVM::new();
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/stele.so");
        let so = std::fs::read(path)
            .expect("missing target/deploy/stele.so — run cargo build-sbf first");
        svm.add_program(program_id(), &so).expect("load program");
        let admin = Keypair::new();
        let attestor = Keypair::new();
        let relayer = Keypair::new();
        set_upgrade_authority(&mut svm, Some(&admin.pubkey()));
        for k in [&admin, &attestor, &relayer] {
            svm.airdrop(&k.pubkey(), 100_000_000_000).unwrap();
        }
        let mut env = Env {
            svm,
            admin,
            attestor,
            relayer,
        };
        env.set_time(START_TIME);
        env
    }

    /// Deploys the CPI forwarder test fixture (`tests/programs/cpi-probe`) and returns its address.
    pub fn deploy_cpi_probe(&mut self) -> Address {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../target/deploy/stele_cpi_probe.so"
        );
        let so = std::fs::read(path).expect(
            "missing target/deploy/stele_cpi_probe.so — run cargo build-sbf --manifest-path \
             tests/programs/cpi-probe/Cargo.toml --sbf-out-dir target/deploy first",
        );
        let id = Keypair::new().pubkey();
        self.svm.add_program(id, &so).expect("load CPI probe");
        id
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn set_time(&mut self, t: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = t;
        clock.slot += 1;
        self.svm.set_sysvar(&clock);
    }

    pub fn advance(&mut self, seconds: i64) {
        let t = self.now() + seconds;
        self.set_time(t);
    }

    pub fn funded(&mut self) -> Keypair {
        let k = Keypair::new();
        self.svm.airdrop(&k.pubkey(), 50_000_000_000).unwrap();
        k
    }

    /// Sends a transaction paid by `payer`, signed by `payer` + `signers` (deduplicated).
    pub fn send(&mut self, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) -> TxResult {
        let mut all: Vec<&Keypair> = vec![payer];
        for s in signers {
            if !all.iter().any(|k| k.pubkey() == s.pubkey()) {
                all.push(s);
            }
        }
        let tx = Transaction::new_signed_with_payer(
            ixs,
            Some(&payer.pubkey()),
            &all,
            self.svm.latest_blockhash(),
        );
        let res = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        res
    }

    pub fn raw_account(&self, a: &Address) -> Option<Account> {
        self.svm.get_account(a)
    }

    pub fn account<T: AccountDeserialize>(&self, a: &Address) -> T {
        let acc = self.svm.get_account(a).expect("account exists");
        T::try_deserialize(&mut acc.data.as_slice()).expect("deserialize")
    }

    pub fn config(&self) -> ProtocolConfig {
        self.account(&config_pda())
    }
    pub fn organization(&self, a: &Address) -> Organization {
        self.account(a)
    }
    pub fn member(&self, a: &Address) -> Member {
        self.account(a)
    }
    pub fn document(&self, a: &Address) -> Document {
        self.account(a)
    }
    pub fn version(&self, a: &Address) -> DocumentVersion {
        self.account(a)
    }
    /// The sponsorship trailer of a shard, if enabled.
    pub fn sponsorship(&self, shard: &Address) -> Option<ShardSponsorship> {
        let acc = self.svm.get_account(shard).expect("shard exists");
        (acc.data.len() > NonceShard::ACCOUNT_SIZE)
            .then(|| bytemuck::pod_read_unaligned(&acc.data[NonceShard::ACCOUNT_SIZE..]))
    }
    pub fn lamports(&self, a: &Address) -> u64 {
        self.svm.get_account(a).map(|acc| acc.lamports).unwrap_or(0)
    }
    pub fn shard(&self, a: &Address) -> NonceShard {
        let acc = self.svm.get_account(a).expect("shard exists");
        assert!(
            acc.data.len() == NonceShard::ACCOUNT_SIZE
                || acc.data.len() == ShardSponsorship::SPONSORED_ACCOUNT_SIZE
        );
        bytemuck::pod_read_unaligned::<NonceShard>(&acc.data[8..NonceShard::ACCOUNT_SIZE])
    }

    // ---- protocol ------------------------------------------------------------------------------

    pub fn initialize_protocol(
        &mut self,
        authority: &Keypair,
        admin: Address,
        attestor: Address,
        chain_id: &str,
        network_label: &str,
    ) -> TxResult {
        let program_data =
            Address::find_program_address(&[program_id().as_ref()], &upgradeable_loader()).0;
        let i = ix(
            stele::instruction::InitializeProtocol {
                args: stele::instructions::InitializeProtocolArgs {
                    admin: to_pk(&admin),
                    domain_attestor: to_pk(&attestor),
                    chain_id: chain_id.to_string(),
                    network_label: network_label.to_string(),
                },
            },
            vec![
                signer_rw(authority.pubkey()),
                rw(config_pda()),
                ro(program_id()),
                ro(program_data),
                ro(system_program()),
            ],
        );
        self.send(&[i], authority, &[])
    }

    pub fn set_paused(&mut self, admin: &Keypair, paused: bool) -> TxResult {
        let i = ix(
            stele::instruction::SetProtocolPaused { paused },
            vec![signer_ro(admin.pubkey()), rw(config_pda())],
        );
        self.send(&[i], admin, &[])
    }

    // ---- organizations -------------------------------------------------------------------------

    pub fn try_create_org(
        &mut self,
        creator: &Keypair,
        seed: [u8; 32],
        name: &str,
        owner: &Address,
        recovery: Option<&Address>,
    ) -> (Address, TxResult) {
        let org = organization_pda(&creator.pubkey(), &seed);
        let i = ix(
            stele::instruction::CreateOrganization {
                args: stele::instructions::CreateOrganizationArgs {
                    seed,
                    name: name.to_string(),
                    owner: to_pk(owner),
                    recovery: recovery.map(to_pk),
                },
            },
            vec![
                signer_ro(creator.pubkey()),
                ro(config_pda()),
                rw(org),
                signer_rw(creator.pubkey()),
                ro(system_program()),
            ],
        );
        let res = self.send(&[i], creator, &[]);
        (org, res)
    }

    /// Creates an organization owned by `owner` with optional recovery; returns its address.
    pub fn create_org(
        &mut self,
        owner: &Keypair,
        name: &str,
        recovery: Option<&Address>,
    ) -> Address {
        let seed = rand_seed(&owner.pubkey(), name);
        let (org, res) = self.try_create_org(owner, seed, name, &owner.pubkey(), recovery);
        assert_ok(&res);
        org
    }

    pub fn org_authority_ix(
        &self,
        data: impl InstructionData,
        authority: &Address,
        org: &Address,
    ) -> Instruction {
        ix(data, vec![signer_ro(*authority), rw(*org)])
    }

    pub fn org_call(
        &mut self,
        data: impl InstructionData,
        authority: &Keypair,
        org: &Address,
    ) -> TxResult {
        let i = self.org_authority_ix(data, &authority.pubkey(), org);
        self.send(&[i], authority, &[])
    }

    // ---- members -------------------------------------------------------------------------------

    pub fn add_member(
        &mut self,
        authority: &Keypair,
        org: &Address,
        member: &Address,
        roles: u8,
    ) -> TxResult {
        let authority_membership = self.membership_of(org, &authority.pubkey());
        let i = ix(
            stele::instruction::AddMember {
                args: stele::instructions::AddMemberArgs {
                    member: to_pk(member),
                    roles,
                },
            },
            vec![
                signer_ro(authority.pubkey()),
                optional(authority_membership),
                rw(*org),
                rw(member_pda(org, member)),
                signer_rw(authority.pubkey()),
                ro(system_program()),
            ],
        );
        self.send(&[i], authority, &[])
    }

    /// The member PDA of `key` if it exists on-chain.
    pub fn membership_of(&self, org: &Address, key: &Address) -> Option<Address> {
        let m = member_pda(org, key);
        self.svm
            .get_account(&m)
            .filter(|a| !a.data.is_empty())
            .map(|_| m)
    }

    pub fn manage_member(
        &mut self,
        data: impl InstructionData,
        authority: &Keypair,
        org: &Address,
        member: &Address,
        use_membership: bool,
    ) -> TxResult {
        let authority_membership = if use_membership {
            self.membership_of(org, &authority.pubkey())
        } else {
            None
        };
        let i = ix(
            data,
            vec![
                signer_ro(authority.pubkey()),
                optional(authority_membership),
                ro(*org),
                rw(member_pda(org, member)),
            ],
        );
        self.send(&[i], authority, &[])
    }

    // ---- domains -------------------------------------------------------------------------------

    pub fn attest_domain(
        &mut self,
        attestor: &Keypair,
        org: &Address,
        domain: &str,
        expires_at: i64,
    ) -> TxResult {
        let i = ix(
            stele::instruction::AttestDomain {
                args: stele::instructions::AttestDomainArgs {
                    domain: domain.to_string(),
                    domain_hash: stele_core::hash::domain_hash(domain),
                    expires_at,
                },
            },
            vec![
                signer_ro(attestor.pubkey()),
                ro(config_pda()),
                rw(*org),
                rw(domain_pda(domain)),
                signer_rw(attestor.pubkey()),
                ro(system_program()),
            ],
        );
        self.send(&[i], attestor, &[])
    }

    pub fn revoke_domain(
        &mut self,
        authority: &Keypair,
        org: &Address,
        domain: &str,
        rent_payer: &Address,
    ) -> TxResult {
        let i = ix(
            stele::instruction::RevokeDomain {},
            vec![
                signer_ro(authority.pubkey()),
                ro(config_pda()),
                rw(*org),
                rw(domain_pda(domain)),
                rw(*rent_payer),
            ],
        );
        self.send(&[i], authority, &[])
    }

    // ---- documents -----------------------------------------------------------------------------

    pub fn create_document(
        &mut self,
        authority: &Keypair,
        org: &Address,
        slug: &str,
        document_type: &str,
        locale: &str,
    ) -> (Address, TxResult) {
        let document = document_pda(org, slug);
        let membership = self.membership_of(org, &authority.pubkey());
        let i = ix(
            stele::instruction::CreateDocument {
                args: stele::instructions::CreateDocumentArgs {
                    slug: slug.to_string(),
                    document_type: document_type.to_string(),
                    locale: locale.to_string(),
                },
            },
            vec![
                signer_ro(authority.pubkey()),
                optional(membership),
                ro(config_pda()),
                rw(*org),
                rw(document),
                signer_rw(authority.pubkey()),
                ro(system_program()),
            ],
        );
        let res = self.send(&[i], authority, &[]);
        (document, res)
    }

    /// Version fingerprint computed exactly as the program will compute it.
    pub fn expected_version_hash(
        &self,
        org: &Address,
        document: &Address,
        p: &PublishParams,
    ) -> [u8; 32] {
        let doc = self.document(document);
        let config = self.config();
        let program = program_id().to_bytes();
        let org_b = org.to_bytes();
        let doc_b = document.to_bytes();
        version_hash(&VersionFields {
            chain_id: &config.chain_id,
            program: &program,
            organization: &org_b,
            document: &doc_b,
            document_type: &doc.document_type,
            locale: &doc.locale,
            version: p.version,
            previous_version_hash: if p.version == 1 {
                None
            } else {
                Some(&p.previous_version_hash)
            },
            title: &p.title,
            version_label: &p.version_label,
            effective_at: p.effective_at,
            content_hash: &p.content_hash,
        })
    }

    /// Default publish parameters for the next version of `document`.
    pub fn next_publish_params(&self, document: &Address, content: &str) -> PublishParams {
        let doc = self.document(document);
        let n = doc.version_count + 1;
        PublishParams {
            version: n,
            previous_version_hash: doc.head_hash,
            content_hash: hash32(content.as_bytes()),
            title: "Terms of Service".to_string(),
            version_label: format!("{n}.0"),
            effective_at: 0,
            storage_uri: format!("ar://content-{n}"),
            expected_version_hash: None,
        }
    }

    pub fn publish_with(
        &mut self,
        authority: &Keypair,
        org: &Address,
        document: &Address,
        p: &PublishParams,
        use_membership: bool,
    ) -> (Address, TxResult) {
        let version_addr = version_pda(document, p.version);
        let expected = p
            .expected_version_hash
            .unwrap_or_else(|| self.expected_version_hash(org, document, p));
        let membership = if use_membership {
            self.membership_of(org, &authority.pubkey())
        } else {
            None
        };
        let i = ix(
            stele::instruction::PublishVersion {
                args: stele::instructions::PublishVersionArgs {
                    version: p.version,
                    previous_version_hash: p.previous_version_hash,
                    content_hash: p.content_hash,
                    title: p.title.clone(),
                    version_label: p.version_label.clone(),
                    effective_at: p.effective_at,
                    storage_uri: p.storage_uri.clone(),
                    expected_version_hash: expected,
                },
            },
            vec![
                signer_ro(authority.pubkey()),
                optional(membership),
                ro(config_pda()),
                ro(*org),
                rw(*document),
                rw(version_addr),
                signer_rw(authority.pubkey()),
                ro(system_program()),
            ],
        );
        let res = self.send(&[i], authority, &[]);
        (version_addr, res)
    }

    /// Publishes the next version with default parameters; panics on failure.
    pub fn publish(
        &mut self,
        authority: &Keypair,
        org: &Address,
        document: &Address,
        content: &str,
    ) -> Address {
        let p = self.next_publish_params(document, content);
        let (v, res) = self.publish_with(authority, org, document, &p, true);
        assert_ok(&res);
        v
    }

    // ---- shards & acceptance -------------------------------------------------------------------

    pub fn create_shard(
        &mut self,
        authority: &Keypair,
        org: &Address,
        shard_id: u16,
        relayer: &Address,
    ) -> (Address, TxResult) {
        let shard = shard_pda(org, shard_id);
        let membership = self.membership_of(org, &authority.pubkey());
        let i = ix(
            stele::instruction::CreateNonceShard {
                args: stele::instructions::CreateNonceShardArgs {
                    shard_id,
                    relayer: to_pk(relayer),
                },
            },
            vec![
                signer_ro(authority.pubkey()),
                optional(membership),
                ro(config_pda()),
                ro(*org),
                rw(shard),
                signer_rw(authority.pubkey()),
                ro(system_program()),
            ],
        );
        let res = self.send(&[i], authority, &[]);
        (shard, res)
    }

    /// The exact message the program will reconstruct for these parameters.
    pub fn acceptance_message(
        &self,
        org: &Address,
        version: &Address,
        shard: &Address,
        signer: &Address,
        a: &AcceptParams,
    ) -> String {
        let o = self.organization(org);
        let v = self.version(version);
        let s = self.shard(shard);
        let config = self.config();
        let now = self.now();
        let signer_b = signer.to_bytes();
        acceptance_message(
            &AcceptanceMessageFields {
                org_name: &o.name,
                org_verified_domain: o.verified_domain_at(now),
                title: &v.title,
                version_label: &v.version_label,
                version: v.version,
                version_hash: &v.version_hash,
                signer: &signer_b,
                network_label: &config.network_label,
                issued_at: a.issued_at,
                expires_at: a.expires_at,
                shard_id: s.shard_id,
                nonce_index: a.nonce_index,
                nonce_tag: &a.nonce_tag,
            },
            &a.request_domain,
        )
        .expect("message")
    }

    pub fn record_acceptance_ix(
        &self,
        relayer: &Address,
        org: &Address,
        document: &Address,
        version: &Address,
        shard: &Address,
        a: &AcceptParams,
    ) -> Instruction {
        ix(
            stele::instruction::RecordAcceptance {
                nonce_index: a.nonce_index,
                nonce_tag: a.nonce_tag,
                issued_at: a.issued_at,
                expires_at: a.expires_at,
            },
            vec![
                signer_ro(*relayer),
                ro(config_pda()),
                ro(*org),
                ro(*document),
                ro(*version),
                rw(*shard),
                ro(instructions_sysvar()),
            ],
        )
    }

    /// Full happy-path acceptance: build message from state, user signs, relayer submits.
    pub fn accept(&mut self, user: &Keypair, t: &Target, a: &AcceptParams) -> TxResult {
        let message = self.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), a);
        self.accept_message(user, t, a, message.as_bytes())
    }

    /// Submits an arbitrary message signed by `user` (for tampering tests).
    pub fn accept_message(
        &mut self,
        user: &Keypair,
        t: &Target,
        a: &AcceptParams,
        message: &[u8],
    ) -> TxResult {
        let sig = user.sign_message(message);
        let mut sig_bytes = [0u8; 64];
        sig_bytes.copy_from_slice(sig.as_ref());
        let ed = ed25519_ix(&user.pubkey().to_bytes(), &sig_bytes, message);
        let relayer = self.relayer.insecure_clone();
        let rec = self.record_acceptance_ix(
            &relayer.pubkey(),
            &t.org,
            &t.document,
            &t.version,
            &t.shard,
            a,
        );
        self.send(&[ed, rec], &relayer, &[])
    }

    /// Owner + organization + document + v1 + shard 0 (relayer-gated) — the common fixture.
    pub fn fixture(&mut self) -> Fixture {
        let owner = self.funded();
        let org = self.create_org(&owner, "Acme Inc.", None);
        let (document, res) = self.create_document(
            &owner,
            &org,
            "terms-of-service",
            "terms-of-service",
            "en-US",
        );
        assert_ok(&res);
        let version = self.publish(&owner, &org, &document, "version one content");
        let relayer = self.relayer.pubkey();
        let (shard, res) = self.create_shard(&owner, &org, 0, &relayer);
        assert_ok(&res);
        Fixture {
            owner,
            target: Target {
                org,
                document,
                version,
                shard,
            },
        }
    }

    // ---- fee sponsorship -----------------------------------------------------------------------

    pub fn enable_sponsorship(
        &mut self,
        authority: &Keypair,
        org: &Address,
        shard: &Address,
        max_fee_per_record: u64,
        daily_limit: u64,
    ) -> TxResult {
        let membership = self.membership_of(org, &authority.pubkey());
        let i = ix(
            stele::instruction::EnableShardSponsorship {
                limits: stele::instructions::SponsorLimits {
                    max_fee_per_record,
                    daily_limit,
                },
            },
            vec![
                signer_ro(authority.pubkey()),
                optional(membership),
                ro(*org),
                rw(*shard),
                signer_rw(authority.pubkey()),
                ro(system_program()),
            ],
        );
        self.send(&[i], authority, &[])
    }

    pub fn update_sponsorship(
        &mut self,
        authority: &Keypair,
        org: &Address,
        shard: &Address,
        max_fee_per_record: u64,
        daily_limit: u64,
        paused: bool,
    ) -> TxResult {
        let membership = self.membership_of(org, &authority.pubkey());
        let i = ix(
            stele::instruction::UpdateShardSponsorship {
                args: stele::instructions::UpdateShardSponsorshipArgs {
                    limits: stele::instructions::SponsorLimits {
                        max_fee_per_record,
                        daily_limit,
                    },
                    paused,
                },
            },
            vec![
                signer_ro(authority.pubkey()),
                optional(membership),
                ro(*org),
                rw(*shard),
            ],
        );
        self.send(&[i], authority, &[])
    }

    pub fn withdraw_sponsorship(
        &mut self,
        owner: &Keypair,
        org: &Address,
        shard: &Address,
        destination: &Address,
        amount: u64,
    ) -> TxResult {
        let i = ix(
            stele::instruction::WithdrawShardSponsorship { amount },
            vec![
                signer_ro(owner.pubkey()),
                ro(*org),
                rw(*shard),
                rw(*destination),
            ],
        );
        self.send(&[i], owner, &[])
    }

    /// Anyone can fund a sponsored shard with a plain system transfer.
    pub fn deposit(&mut self, from: &Keypair, to: &Address, lamports: u64) {
        let i = transfer_ix(&from.pubkey(), to, lamports);
        assert_ok(&self.send(&[i], from, &[]));
    }

    /// The relayer's transaction as the API builds it: compute budget, Ed25519 verification,
    /// `record_acceptance`.
    pub fn accept_with_budget(
        &mut self,
        user: &Keypair,
        t: &Target,
        a: &AcceptParams,
        budget: &[Instruction],
    ) -> TxResult {
        let message = self.acceptance_message(&t.org, &t.version, &t.shard, &user.pubkey(), a);
        let sig = user.sign_message(message.as_bytes());
        let mut sig_bytes = [0u8; 64];
        sig_bytes.copy_from_slice(sig.as_ref());
        let ed = ed25519_ix(&user.pubkey().to_bytes(), &sig_bytes, message.as_bytes());
        let relayer = self.relayer.insecure_clone();
        let mut rec = self.record_acceptance_ix(
            &relayer.pubkey(),
            &t.org,
            &t.document,
            &t.version,
            &t.shard,
            a,
        );
        rec.accounts[0] = signer_rw(relayer.pubkey());
        let mut ixs = budget.to_vec();
        ixs.push(ed);
        ixs.push(rec);
        self.send(&ixs, &relayer, &[])
    }

    // ---- proofs --------------------------------------------------------------------------------

    /// The exact anchor message the program will reconstruct for these parameters.
    pub fn proof_message(
        &self,
        org: &Address,
        shard: &Address,
        signer: &Address,
        p: &ProofParams,
    ) -> String {
        let o = self.organization(org);
        let s = self.shard(shard);
        let config = self.config();
        let now = self.now();
        let org_b = org.to_bytes();
        let signer_b = signer.to_bytes();
        proof_message(
            &ProofMessageFields {
                proof_type: p.proof_type,
                org_name: &o.name,
                org_verified_domain: o.verified_domain_at(now),
                organization: &org_b,
                statement_hash: &p.statement_hash,
                signer: &signer_b,
                network_label: &config.network_label,
                chain_id: &config.chain_id,
                issued_at: p.issued_at,
                expires_at: p.expires_at,
                shard_id: s.shard_id,
                nonce_index: p.nonce_index,
                nonce_tag: &p.nonce_tag,
            },
            &p.request_domain,
        )
        .expect("proof message")
    }

    pub fn record_proof_ix(
        &self,
        relayer: &Address,
        org: &Address,
        shard: &Address,
        p: &ProofParams,
    ) -> Instruction {
        let accounts = vec![
            signer_rw(*relayer),
            ro(config_pda()),
            ro(*org),
            rw(*shard),
            ro(instructions_sysvar()),
        ];
        ix(
            stele::instruction::RecordProof {
                args: stele::instructions::RecordProofArgs {
                    proof_type: p.proof_type,
                    statement_hash: p.statement_hash,
                    nonce_index: p.nonce_index,
                    nonce_tag: p.nonce_tag,
                    issued_at: p.issued_at,
                    expires_at: p.expires_at,
                },
            },
            accounts,
        )
    }

    /// Signs `message` as `user` and submits it through `record_proof` (for tampering tests).
    pub fn prove_message(
        &mut self,
        user: &Keypair,
        org: &Address,
        shard: &Address,
        p: &ProofParams,
        message: &[u8],
    ) -> TxResult {
        let sig = user.sign_message(message);
        let mut sig_bytes = [0u8; 64];
        sig_bytes.copy_from_slice(sig.as_ref());
        let ed = ed25519_ix(&user.pubkey().to_bytes(), &sig_bytes, message);
        let relayer = self.relayer.insecure_clone();
        let rec = self.record_proof_ix(&relayer.pubkey(), org, shard, p);
        self.send(&[cu_limit_ix(60_000), ed, rec], &relayer, &[])
    }

    /// Happy path: anchor message rebuilt from state, signed by `user`, recorded by the relayer.
    pub fn prove(
        &mut self,
        user: &Keypair,
        org: &Address,
        shard: &Address,
        p: &ProofParams,
    ) -> TxResult {
        let message = self.proof_message(org, shard, &user.pubkey(), p);
        self.prove_message(user, org, shard, p, message.as_bytes())
    }

    pub fn default_proof(&self, nonce_index: u32) -> ProofParams {
        let now = self.now();
        ProofParams {
            proof_type: 1,
            statement_hash: hash32(b"example purchase statement"),
            nonce_index,
            nonce_tag: [0x7e; 8],
            issued_at: now,
            expires_at: now + 600,
            request_domain: REQUEST_DOMAIN.to_string(),
        }
    }

    pub fn default_accept(&self, nonce_index: u32) -> AcceptParams {
        let now = self.now();
        AcceptParams {
            nonce_index,
            nonce_tag: [0x5a; 8],
            issued_at: now,
            expires_at: now + 600,
            request_domain: REQUEST_DOMAIN.to_string(),
        }
    }
}

#[derive(Clone)]
pub struct PublishParams {
    pub version: u32,
    pub previous_version_hash: [u8; 32],
    pub content_hash: [u8; 32],
    pub title: String,
    pub version_label: String,
    pub effective_at: i64,
    pub storage_uri: String,
    /// `None` = compute the correct fingerprint.
    pub expected_version_hash: Option<[u8; 32]>,
}

#[derive(Clone)]
pub struct AcceptParams {
    pub nonce_index: u32,
    pub nonce_tag: [u8; 8],
    pub issued_at: i64,
    pub expires_at: i64,
    pub request_domain: String,
}

#[derive(Clone)]
pub struct ProofParams {
    pub proof_type: u8,
    pub statement_hash: [u8; 32],
    pub nonce_index: u32,
    pub nonce_tag: [u8; 8],
    pub issued_at: i64,
    pub expires_at: i64,
    pub request_domain: String,
}

#[derive(Clone, Copy)]
pub struct Target {
    pub org: Address,
    pub document: Address,
    pub version: Address,
    pub shard: Address,
}

pub struct Fixture {
    pub owner: Keypair,
    pub target: Target,
}

/// Deterministic per-call seed (unique enough for tests).
pub fn rand_seed(owner: &Address, name: &str) -> [u8; 32] {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    stele_core::hash::sha256v(&[owner.as_ref(), name.as_bytes(), &n.to_le_bytes()])
}

/// Rewrites the ProgramData header so `authority` is the upgrade authority.
pub fn set_upgrade_authority(svm: &mut LiteSVM, authority: Option<&Address>) {
    let program_data =
        Address::find_program_address(&[program_id().as_ref()], &upgradeable_loader()).0;
    let mut acc = svm.get_account(&program_data).expect("programdata");
    // bincode(UpgradeableLoaderState::ProgramData { slot, upgrade_authority_address }):
    // u32 variant tag (3) | u64 slot | Option<Pubkey> (u8 tag + 32 bytes)
    assert_eq!(&acc.data[0..4], &3u32.to_le_bytes(), "programdata variant");
    match authority {
        Some(a) => {
            acc.data[12] = 1;
            acc.data[13..45].copy_from_slice(a.as_ref());
        }
        None => {
            acc.data[12] = 0;
            acc.data[13..45].fill(0);
        }
    }
    svm.set_account(program_data, acc).expect("set programdata");
}
