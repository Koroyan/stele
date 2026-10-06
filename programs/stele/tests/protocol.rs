//! Protocol configuration: initialization gate, pause, attestor and admin rotation.

mod common;

use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;
use stele::error::SteleError;

#[test]
fn only_upgrade_authority_can_initialize() {
    let mut env = Env::bare();
    let attacker = env.funded();
    let admin = env.admin.pubkey();
    let attestor = env.attestor.pubkey();
    let res = env.initialize_protocol(
        &attacker,
        attacker.pubkey(),
        attacker.pubkey(),
        CHAIN_ID,
        NETWORK_LABEL,
    );
    assert_stele_err(&res, SteleError::NotUpgradeAuthority);

    let authority = env.admin.insecure_clone();
    let res = env.initialize_protocol(&authority, admin, attestor, CHAIN_ID, NETWORK_LABEL);
    assert_ok(&res);
    let config = env.config();
    assert_eq!(config.chain_id, CHAIN_ID);
    assert_eq!(config.network_label, NETWORK_LABEL);
    assert_eq!(to_addr(&config.admin), admin);
    assert!(!config.paused);
}

#[test]
fn cannot_initialize_twice() {
    let mut env = Env::new();
    let authority = env.admin.insecure_clone();
    let res = env.initialize_protocol(
        &authority,
        authority.pubkey(),
        authority.pubkey(),
        "solana:other",
        "Solana Devnet",
    );
    assert_failed(&res);
    assert_eq!(
        env.config().chain_id,
        CHAIN_ID,
        "immutable network identity"
    );
}

#[test]
fn immutable_program_cannot_be_initialized() {
    let mut env = Env::bare();
    set_upgrade_authority(&mut env.svm, None);
    let authority = env.admin.insecure_clone();
    let res = env.initialize_protocol(
        &authority,
        authority.pubkey(),
        authority.pubkey(),
        CHAIN_ID,
        NETWORK_LABEL,
    );
    assert_stele_err(&res, SteleError::NotUpgradeAuthority);
}

#[test]
fn initialization_validates_network_identity() {
    let mut env = Env::bare();
    let authority = env.admin.insecure_clone();
    let pk = authority.pubkey();
    assert_stele_err(
        &env.initialize_protocol(&authority, pk, pk, "eip155:1", NETWORK_LABEL),
        SteleError::InvalidChainId,
    );
    assert_stele_err(
        &env.initialize_protocol(&authority, pk, pk, CHAIN_ID, "Solana\nMainnet"),
        SteleError::InvalidNetworkLabel,
    );
    assert_stele_err(
        &env.initialize_protocol(&authority, pk, pk, CHAIN_ID, "Solana  Localnet"),
        SteleError::InvalidNetworkLabel,
    );
}

#[test]
fn pause_blocks_new_evidence_but_not_incident_response() {
    let mut env = Env::new();
    let fx = env.fixture();
    let admin = env.admin.insecure_clone();
    assert_ok(&env.set_paused(&admin, true));

    // Organization creation, document creation, publication and acceptance are blocked.
    let owner2 = env.funded();
    let (_, res) = env.try_create_org(&owner2, [7u8; 32], "Paused Co", &owner2.pubkey(), None);
    assert_stele_err(&res, SteleError::ProtocolPaused);
    let (_, res) =
        env.create_document(&fx.owner, &fx.target.org, "privacy", "privacy-policy", "en");
    assert_stele_err(&res, SteleError::ProtocolPaused);
    let p = env.next_publish_params(&fx.target.document, "v2");
    let (_, res) = env.publish_with(&fx.owner, &fx.target.org, &fx.target.document, &p, true);
    assert_stele_err(&res, SteleError::ProtocolPaused);
    let user = env.funded();
    let a = env.default_accept(1);
    assert_stele_err(
        &env.accept(&user, &fx.target, &a),
        SteleError::ProtocolPaused,
    );

    // Incident response (freeze) still works while paused.
    assert_ok(&env.org_call(
        stele::instruction::FreezeOrganization {},
        &fx.owner,
        &fx.target.org,
    ));

    // Only the admin can unpause.
    let stranger = env.funded();
    assert_stele_err(&env.set_paused(&stranger, false), SteleError::Unauthorized);
    assert_ok(&env.set_paused(&admin, false));
}

#[test]
fn attestor_rotation_and_two_step_admin_transfer() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let new_attestor = Keypair::new();
    let stranger = env.funded();

    let i = ix(
        stele::instruction::SetDomainAttestor {
            attestor: to_pk(&new_attestor.pubkey()),
        },
        vec![signer_ro(stranger.pubkey()), rw(config_pda())],
    );
    assert_stele_err(&env.send(&[i], &stranger, &[]), SteleError::Unauthorized);
    let i = ix(
        stele::instruction::SetDomainAttestor {
            attestor: to_pk(&new_attestor.pubkey()),
        },
        vec![signer_ro(admin.pubkey()), rw(config_pda())],
    );
    assert_ok(&env.send(&[i], &admin, &[]));
    assert_eq!(
        to_addr(&env.config().domain_attestor),
        new_attestor.pubkey()
    );

    let next_admin = env.funded();
    let propose = ix(
        stele::instruction::ProposeProtocolAdmin {
            new_admin: to_pk(&next_admin.pubkey()),
        },
        vec![signer_ro(admin.pubkey()), rw(config_pda())],
    );
    assert_ok(&env.send(&[propose], &admin, &[]));
    // Still the old admin until accepted.
    assert_eq!(to_addr(&env.config().admin), admin.pubkey());
    let accept_by_stranger = ix(
        stele::instruction::AcceptProtocolAdmin {},
        vec![signer_ro(stranger.pubkey()), rw(config_pda())],
    );
    assert_stele_err(
        &env.send(&[accept_by_stranger], &stranger, &[]),
        SteleError::Unauthorized,
    );
    let accept = ix(
        stele::instruction::AcceptProtocolAdmin {},
        vec![signer_ro(next_admin.pubkey()), rw(config_pda())],
    );
    assert_ok(&env.send(&[accept], &next_admin, &[]));
    assert_eq!(to_addr(&env.config().admin), next_admin.pubkey());
    // Old admin lost its powers.
    assert_stele_err(&env.set_paused(&admin, true), SteleError::Unauthorized);
}
