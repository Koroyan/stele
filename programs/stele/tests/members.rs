//! Membership, roles, revocation and key-compromise reporting.

mod common;

use common::*;
use solana_signer::Signer;
use stele::error::SteleError;
use stele_core::constants::{
    PUBLISHER_ROLE_MEMBER, PUBLISHER_ROLE_OWNER, ROLE_ADMIN, ROLE_PUBLISHER,
};

#[test]
fn publisher_member_can_publish_and_is_attributed() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let publisher = env.funded();
    assert_ok(&env.add_member(&fx.owner, &t.org, &publisher.pubkey(), ROLE_PUBLISHER));
    assert_eq!(env.organization(&t.org).member_count, 1);

    let v2 = env.publish(&publisher, &t.org, &t.document, "v2 by publisher");
    let v = env.version(&v2);
    assert_eq!(to_addr(&v.publisher), publisher.pubkey());
    assert_eq!(v.publisher_role, PUBLISHER_ROLE_MEMBER);
    assert_eq!(env.version(&t.version).publisher_role, PUBLISHER_ROLE_OWNER);
}

#[test]
fn non_members_and_wrong_roles_cannot_publish() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let outsider = env.funded();
    let p = env.next_publish_params(&t.document, "unauthorized");
    let (_, res) = env.publish_with(&outsider, &t.org, &t.document, &p, true);
    assert_stele_err(&res, SteleError::Unauthorized);

    // An ADMIN without PUBLISHER cannot publish (but can create documents).
    let admin = env.funded();
    assert_ok(&env.add_member(&fx.owner, &t.org, &admin.pubkey(), ROLE_ADMIN));
    let (_, res) = env.publish_with(&admin, &t.org, &t.document, &p, true);
    assert_stele_err(&res, SteleError::Unauthorized);
    let (_, res) = env.create_document(&admin, &t.org, "privacy-policy", "privacy-policy", "en");
    assert_ok(&res);
}

#[test]
fn membership_of_another_member_cannot_be_borrowed() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let publisher = env.funded();
    let outsider = env.funded();
    assert_ok(&env.add_member(&fx.owner, &t.org, &publisher.pubkey(), ROLE_PUBLISHER));
    // The outsider passes the publisher's membership PDA: seeds bind it to the signer.
    let p = env.next_publish_params(&t.document, "borrowed");
    let expected = env.expected_version_hash(&t.org, &t.document, &p);
    let i = ix(
        stele::instruction::PublishVersion {
            args: stele::instructions::PublishVersionArgs {
                version: p.version,
                previous_version_hash: p.previous_version_hash,
                content_hash: p.content_hash,
                title: p.title.clone(),
                version_label: p.version_label.clone(),
                effective_at: 0,
                storage_uri: p.storage_uri.clone(),
                expected_version_hash: expected,
            },
        },
        vec![
            signer_ro(outsider.pubkey()),
            ro(member_pda(&t.org, &publisher.pubkey())),
            ro(config_pda()),
            ro(t.org),
            rw(t.document),
            rw(version_pda(&t.document, p.version)),
            signer_rw(outsider.pubkey()),
            ro(system_program()),
        ],
    );
    assert_failed(&env.send(&[i], &outsider, &[]));
    assert_eq!(env.document(&t.document).version_count, 1);
}

#[test]
fn revoked_member_loses_authority_immediately() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let publisher = env.funded();
    assert_ok(&env.add_member(&fx.owner, &t.org, &publisher.pubkey(), ROLE_PUBLISHER));
    assert_ok(&env.manage_member(
        stele::instruction::RevokeMember {},
        &fx.owner,
        &t.org,
        &publisher.pubkey(),
        true,
    ));
    let m = env.member(&member_pda(&t.org, &publisher.pubkey()));
    assert!(
        m.revoked_at > 0,
        "revocation is a timestamp, the record persists"
    );
    let p = env.next_publish_params(&t.document, "after revoke");
    let (_, res) = env.publish_with(&publisher, &t.org, &t.document, &p, true);
    assert_stele_err(&res, SteleError::Unauthorized);
    // Re-activation by the owner works for non-compromised members.
    assert_ok(&env.manage_member(
        stele::instruction::UpdateMember {
            roles: ROLE_PUBLISHER,
        },
        &fx.owner,
        &t.org,
        &publisher.pubkey(),
        true,
    ));
    let (_, res) = env.publish_with(&publisher, &t.org, &t.document, &p, true);
    assert_ok(&res);
}

#[test]
fn admins_cannot_manage_admins_or_grant_admin() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let admin_a = env.funded();
    let admin_b = env.funded();
    let publisher = env.funded();
    assert_ok(&env.add_member(&fx.owner, &t.org, &admin_a.pubkey(), ROLE_ADMIN));
    assert_ok(&env.add_member(&fx.owner, &t.org, &admin_b.pubkey(), ROLE_ADMIN));

    // Admin may add a publisher…
    assert_ok(&env.add_member(&admin_a, &t.org, &publisher.pubkey(), ROLE_PUBLISHER));
    // …but not grant ADMIN, not escalate a publisher, not revoke another admin.
    let newbie = env.funded();
    assert_stele_err(
        &env.add_member(
            &admin_a,
            &t.org,
            &newbie.pubkey(),
            ROLE_ADMIN | ROLE_PUBLISHER,
        ),
        SteleError::CannotManageAdmin,
    );
    assert_stele_err(
        &env.manage_member(
            stele::instruction::UpdateMember { roles: ROLE_ADMIN },
            &admin_a,
            &t.org,
            &publisher.pubkey(),
            true,
        ),
        SteleError::CannotManageAdmin,
    );
    assert_stele_err(
        &env.manage_member(
            stele::instruction::RevokeMember {},
            &admin_a,
            &t.org,
            &admin_b.pubkey(),
            true,
        ),
        SteleError::CannotManageAdmin,
    );
    // The owner can.
    assert_ok(&env.manage_member(
        stele::instruction::RevokeMember {},
        &fx.owner,
        &t.org,
        &admin_b.pubkey(),
        true,
    ));
}

#[test]
fn role_bits_are_validated() {
    let mut env = Env::new();
    let fx = env.fixture();
    let m = env.funded();
    assert_stele_err(
        &env.add_member(&fx.owner, &fx.target.org, &m.pubkey(), 0),
        SteleError::InvalidRoles,
    );
    assert_stele_err(
        &env.add_member(&fx.owner, &fx.target.org, &m.pubkey(), 0b100),
        SteleError::InvalidRoles,
    );
}

#[test]
fn key_compromise_reporting() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let publisher = env.funded();
    assert_ok(&env.add_member(&fx.owner, &t.org, &publisher.pubkey(), ROLE_PUBLISHER));
    env.advance(1_000);
    let now = env.now();

    // Future timestamps are rejected.
    assert_stele_err(
        &env.manage_member(
            stele::instruction::ReportKeyCompromise {
                compromised_since: now + 10,
            },
            &fx.owner,
            &t.org,
            &publisher.pubkey(),
            true,
        ),
        SteleError::InvalidCompromiseTime,
    );
    // Self-report (the holder noticed the theft).
    assert_ok(&env.manage_member(
        stele::instruction::ReportKeyCompromise {
            compromised_since: now - 500,
        },
        &publisher,
        &t.org,
        &publisher.pubkey(),
        false,
    ));
    let m = env.member(&member_pda(&t.org, &publisher.pubkey()));
    assert_eq!(m.compromised_since, now - 500);
    assert_eq!(m.compromise_reported_at, now);
    assert!(m.revoked_at > 0, "compromise implies revocation");

    // The claimed start can only move earlier, never later.
    assert_ok(&env.manage_member(
        stele::instruction::ReportKeyCompromise {
            compromised_since: now - 100,
        },
        &fx.owner,
        &t.org,
        &publisher.pubkey(),
        true,
    ));
    assert_eq!(
        env.member(&member_pda(&t.org, &publisher.pubkey()))
            .compromised_since,
        now - 500
    );

    // A compromised key can never be re-activated.
    assert_stele_err(
        &env.manage_member(
            stele::instruction::UpdateMember {
                roles: ROLE_PUBLISHER,
            },
            &fx.owner,
            &t.org,
            &publisher.pubkey(),
            true,
        ),
        SteleError::MemberCompromised,
    );
    let outsider = env.funded();
    assert_stele_err(
        &env.manage_member(
            stele::instruction::ReportKeyCompromise {
                compromised_since: now - 1,
            },
            &outsider,
            &t.org,
            &publisher.pubkey(),
            false,
        ),
        SteleError::Unauthorized,
    );
}
