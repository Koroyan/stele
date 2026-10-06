//! Organization lifecycle, ownership transfer, recovery authority and freeze semantics.

mod common;

use common::*;
use solana_signer::Signer;
use stele::error::SteleError;
use stele_core::constants::{FROZEN_BY_OWNER, FROZEN_BY_RECOVERY, RECOVERY_DELAY};

#[test]
fn creates_organization_with_validated_name() {
    let mut env = Env::new();
    let owner = env.funded();
    let org = env.create_org(&owner, "Acme Inc.", None);
    let o = env.organization(&org);
    assert_eq!(o.name, "Acme Inc.");
    assert_eq!(to_addr(&o.owner), owner.pubkey());
    assert_eq!(to_addr(&o.creator), owner.pubkey());
    assert!(o.verified_domain.is_empty());
    assert!(!o.frozen);

    for bad in [
        "",
        " Acme",
        "Acme ",
        "Acme  Inc",
        "Acme\u{202E}cnI",
        "Ac\u{200B}me",
        "A\nB",
    ] {
        let (_, res) = env.try_create_org(
            &owner,
            rand_seed(&owner.pubkey(), bad),
            bad,
            &owner.pubkey(),
            None,
        );
        assert_stele_err(&res, SteleError::InvalidOrganizationName);
    }
    let long = "x".repeat(41);
    let (_, res) = env.try_create_org(
        &owner,
        rand_seed(&owner.pubkey(), &long),
        &long,
        &owner.pubkey(),
        None,
    );
    assert_stele_err(&res, SteleError::InvalidOrganizationName);
}

#[test]
fn organization_address_cannot_be_front_run() {
    let mut env = Env::new();
    let victim = env.funded();
    let attacker = env.funded();
    let seed = [42u8; 32];
    let victims_address = organization_pda(&victim.pubkey(), &seed);
    // The attacker tries to occupy the victim's intended address: seeds include the creator.
    let i = ix(
        stele::instruction::CreateOrganization {
            args: stele::instructions::CreateOrganizationArgs {
                seed,
                name: "Squatter".into(),
                owner: to_pk(&attacker.pubkey()),
                recovery: None,
            },
        },
        vec![
            signer_ro(attacker.pubkey()),
            ro(config_pda()),
            rw(victims_address),
            signer_rw(attacker.pubkey()),
            ro(system_program()),
        ],
    );
    assert_failed(&env.send(&[i], &attacker, &[]));
    let (org, res) = env.try_create_org(&victim, seed, "Victim Co", &victim.pubkey(), None);
    assert_ok(&res);
    assert_eq!(org, victims_address);
}

#[test]
fn only_owner_can_rename() {
    let mut env = Env::new();
    let owner = env.funded();
    let other = env.funded();
    let org = env.create_org(&owner, "Acme Inc.", None);
    let res = env.org_call(
        stele::instruction::UpdateOrganization {
            name: "Evil".into(),
        },
        &other,
        &org,
    );
    assert_stele_err(&res, SteleError::Unauthorized);
    assert_ok(&env.org_call(
        stele::instruction::UpdateOrganization {
            name: "Acme Corporation".into(),
        },
        &owner,
        &org,
    ));
    assert_eq!(env.organization(&org).name, "Acme Corporation");
}

#[test]
fn two_step_ownership_transfer() {
    let mut env = Env::new();
    let owner = env.funded();
    let next = env.funded();
    let stranger = env.funded();
    let org = env.create_org(&owner, "Acme Inc.", None);

    assert_stele_err(
        &env.org_call(stele::instruction::AcceptOwnership {}, &next, &org),
        SteleError::NoPendingOwner,
    );
    assert_ok(&env.org_call(
        stele::instruction::ProposeOwner {
            new_owner: to_pk(&next.pubkey()),
        },
        &owner,
        &org,
    ));
    assert_stele_err(
        &env.org_call(stele::instruction::AcceptOwnership {}, &stranger, &org),
        SteleError::Unauthorized,
    );
    // Owner is unchanged until acceptance.
    assert_eq!(to_addr(&env.organization(&org).owner), owner.pubkey());
    assert_ok(&env.org_call(stele::instruction::AcceptOwnership {}, &next, &org));
    let o = env.organization(&org);
    assert_eq!(to_addr(&o.owner), next.pubkey());
    assert_eq!(
        to_addr(&o.pending_owner),
        solana_address::Address::default()
    );
    // Previous owner has no powers.
    assert_stele_err(
        &env.org_call(
            stele::instruction::UpdateOrganization { name: "Old".into() },
            &owner,
            &org,
        ),
        SteleError::Unauthorized,
    );

    // Cancel flow.
    assert_ok(&env.org_call(
        stele::instruction::ProposeOwner {
            new_owner: to_pk(&stranger.pubkey()),
        },
        &next,
        &org,
    ));
    assert_ok(&env.org_call(stele::instruction::CancelOwnerTransfer {}, &next, &org));
    assert_stele_err(
        &env.org_call(stele::instruction::AcceptOwnership {}, &stranger, &org),
        SteleError::NoPendingOwner,
    );
}

#[test]
fn recovery_change_is_time_locked_once_set() {
    let mut env = Env::new();
    let owner = env.funded();
    let recovery = env.funded();
    let thief_recovery = env.funded();
    let org = env.create_org(&owner, "Acme Inc.", Some(&recovery.pubkey()));
    assert_eq!(to_addr(&env.organization(&org).recovery), recovery.pubkey());

    // A thief holding the owner key cannot instantly replace the recovery key.
    assert_ok(&env.org_call(
        stele::instruction::ProposeRecovery {
            new_recovery: Some(to_pk(&thief_recovery.pubkey())),
        },
        &owner,
        &org,
    ));
    assert_eq!(to_addr(&env.organization(&org).recovery), recovery.pubkey());
    assert_stele_err(
        &env.org_call(stele::instruction::ApplyRecoveryChange {}, &owner, &org),
        SteleError::TimelockNotElapsed,
    );
    // The real recovery key vetoes during the delay.
    assert_ok(&env.org_call(stele::instruction::CancelRecoveryChange {}, &recovery, &org));
    env.advance(RECOVERY_DELAY + 1);
    assert_stele_err(
        &env.org_call(stele::instruction::ApplyRecoveryChange {}, &owner, &org),
        SteleError::NoPendingRecoveryChange,
    );

    // A legitimate change completes after the delay.
    let new_recovery = env.funded();
    assert_ok(&env.org_call(
        stele::instruction::ProposeRecovery {
            new_recovery: Some(to_pk(&new_recovery.pubkey())),
        },
        &owner,
        &org,
    ));
    env.advance(RECOVERY_DELAY);
    assert_ok(&env.org_call(stele::instruction::ApplyRecoveryChange {}, &owner, &org));
    assert_eq!(
        to_addr(&env.organization(&org).recovery),
        new_recovery.pubkey()
    );
}

#[test]
fn recovery_cannot_equal_owner() {
    let mut env = Env::new();
    let owner = env.funded();
    let (_, res) = env.try_create_org(
        &owner,
        [1u8; 32],
        "Acme Inc.",
        &owner.pubkey(),
        Some(&owner.pubkey()),
    );
    assert_stele_err(&res, SteleError::RecoveryEqualsOwner);
}

#[test]
fn owner_freeze_blocks_publication_and_acceptance() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    assert_ok(&env.org_call(stele::instruction::FreezeOrganization {}, &fx.owner, &t.org));
    let o = env.organization(&t.org);
    assert!(o.frozen);
    assert_eq!(o.frozen_by, FROZEN_BY_OWNER);

    let p = env.next_publish_params(&t.document, "v2");
    let (_, res) = env.publish_with(&fx.owner, &t.org, &t.document, &p, true);
    assert_stele_err(&res, SteleError::OrganizationFrozen);
    let user = env.funded();
    let a = env.default_accept(0);
    assert_stele_err(&env.accept(&user, &t, &a), SteleError::OrganizationFrozen);

    // The owner can still manage members during its own freeze (e.g. revoke a compromised key).
    let member = env.funded();
    assert_ok(&env.add_member(
        &fx.owner,
        &t.org,
        &member.pubkey(),
        stele_core::constants::ROLE_PUBLISHER,
    ));

    assert_ok(&env.org_call(
        stele::instruction::UnfreezeOrganization {},
        &fx.owner,
        &t.org,
    ));
    let a = env.default_accept(0);
    assert_ok(&env.accept(&user, &t, &a));
}

#[test]
fn recovery_lock_and_time_locked_owner_takeover() {
    let mut env = Env::new();
    let owner = env.funded(); // assume compromised
    let recovery = env.funded();
    let new_owner = env.funded();
    let org = env.create_org(&owner, "Acme Inc.", Some(&recovery.pubkey()));

    // Recovery freezes; the compromised owner can neither unfreeze nor act.
    assert_ok(&env.org_call(stele::instruction::FreezeOrganization {}, &recovery, &org));
    assert_eq!(env.organization(&org).frozen_by, FROZEN_BY_RECOVERY);
    assert_stele_err(
        &env.org_call(stele::instruction::UnfreezeOrganization {}, &owner, &org),
        SteleError::OrganizationLockedByRecovery,
    );
    assert_stele_err(
        &env.org_call(
            stele::instruction::UpdateOrganization {
                name: "Pwned".into(),
            },
            &owner,
            &org,
        ),
        SteleError::OrganizationLockedByRecovery,
    );
    let accomplice = env.funded();
    let res = env.add_member(
        &owner,
        &org,
        &accomplice.pubkey(),
        stele_core::constants::ROLE_PUBLISHER,
    );
    assert_stele_err(&res, SteleError::OrganizationLockedByRecovery);

    // Recovery schedules the takeover; the locked owner cannot cancel it.
    assert_ok(&env.org_call(
        stele::instruction::InitiateOwnerRecovery {
            new_owner: to_pk(&new_owner.pubkey()),
        },
        &recovery,
        &org,
    ));
    assert_stele_err(
        &env.org_call(stele::instruction::CancelOwnerRecovery {}, &owner, &org),
        SteleError::OrganizationLockedByRecovery,
    );
    assert_stele_err(
        &env.org_call(stele::instruction::ExecuteOwnerRecovery {}, &recovery, &org),
        SteleError::TimelockNotElapsed,
    );
    env.advance(RECOVERY_DELAY);
    assert_ok(&env.org_call(stele::instruction::ExecuteOwnerRecovery {}, &recovery, &org));

    let o = env.organization(&org);
    assert_eq!(to_addr(&o.owner), new_owner.pubkey());
    assert!(o.frozen);
    assert_eq!(
        o.frozen_by, FROZEN_BY_OWNER,
        "freeze control handed to the new owner"
    );
    assert_ok(&env.org_call(
        stele::instruction::UnfreezeOrganization {},
        &new_owner,
        &org,
    ));
    assert_stele_err(
        &env.org_call(
            stele::instruction::UpdateOrganization { name: "Old".into() },
            &owner,
            &org,
        ),
        SteleError::Unauthorized,
    );
}

#[test]
fn owner_can_veto_takeover_when_not_locked() {
    let mut env = Env::new();
    let owner = env.funded();
    let recovery = env.funded(); // assume compromised
    let thief = env.funded();
    let org = env.create_org(&owner, "Acme Inc.", Some(&recovery.pubkey()));
    assert_ok(&env.org_call(
        stele::instruction::InitiateOwnerRecovery {
            new_owner: to_pk(&thief.pubkey()),
        },
        &recovery,
        &org,
    ));
    assert_ok(&env.org_call(stele::instruction::CancelOwnerRecovery {}, &owner, &org));
    env.advance(RECOVERY_DELAY + 1);
    assert_stele_err(
        &env.org_call(stele::instruction::ExecuteOwnerRecovery {}, &recovery, &org),
        SteleError::NoPendingOwnerRecovery,
    );
    assert_eq!(to_addr(&env.organization(&org).owner), owner.pubkey());
}

#[test]
fn strangers_cannot_freeze_or_recover() {
    let mut env = Env::new();
    let owner = env.funded();
    let stranger = env.funded();
    let org = env.create_org(&owner, "Acme Inc.", None);
    assert_stele_err(
        &env.org_call(stele::instruction::FreezeOrganization {}, &stranger, &org),
        SteleError::Unauthorized,
    );
    assert_stele_err(
        &env.org_call(
            stele::instruction::InitiateOwnerRecovery {
                new_owner: to_pk(&stranger.pubkey()),
            },
            &stranger,
            &org,
        ),
        SteleError::NoRecoveryAuthority,
    );
}
