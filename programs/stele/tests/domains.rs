//! Domain attestations: uniqueness, authorization, expiry, revocation.

mod common;

use common::*;
use solana_signer::Signer;
use stele::error::SteleError;

#[test]
fn attestor_verifies_a_domain() {
    let mut env = Env::new();
    let owner = env.funded();
    let org = env.create_org(&owner, "Acme Inc.", None);
    let attestor = env.attestor.insecure_clone();
    let expires = env.now() + 365 * 86_400;
    assert_ok(&env.attest_domain(&attestor, &org, "acme.example", expires));
    let o = env.organization(&org);
    assert_eq!(o.verified_domain, "acme.example");
    assert_eq!(o.domain_expires_at, expires);
    let record: stele::state::DomainRecord = env.account(&domain_pda("acme.example"));
    assert_eq!(to_addr(&record.organization), org);
    assert_eq!(record.domain, "acme.example");
}

#[test]
fn only_the_attestor_can_attest() {
    let mut env = Env::new();
    let owner = env.funded();
    let org = env.create_org(&owner, "Acme Inc.", None);
    let expires = env.now() + 86_400;
    // Not even the organization owner can self-attest.
    assert_stele_err(
        &env.attest_domain(&owner, &org, "acme.example", expires),
        SteleError::UnauthorizedAttestor,
    );
}

#[test]
fn a_domain_belongs_to_at_most_one_organization() {
    let mut env = Env::new();
    let owner_a = env.funded();
    let owner_b = env.funded();
    let org_a = env.create_org(&owner_a, "Stripe", None);
    let org_b = env.create_org(&owner_b, "Stripe", None);
    let attestor = env.attestor.insecure_clone();
    let expires = env.now() + 86_400;
    assert_ok(&env.attest_domain(&attestor, &org_a, "stripe.example", expires));
    assert_failed(&env.attest_domain(&attestor, &org_b, "stripe.example", expires));
    assert!(env.organization(&org_b).verified_domain.is_empty());

    // After revocation (e.g. domain transferred), it can be attested to the new holder.
    let rent_payer = attestor.pubkey();
    assert_ok(&env.revoke_domain(&attestor, &org_a, "stripe.example", &rent_payer));
    assert!(env.organization(&org_a).verified_domain.is_empty());
    assert!(env
        .raw_account(&domain_pda("stripe.example"))
        .map(|a| a.data.is_empty())
        .unwrap_or(true));
    assert_ok(&env.attest_domain(&attestor, &org_b, "stripe.example", expires));
    assert_eq!(env.organization(&org_b).verified_domain, "stripe.example");
}

#[test]
fn validates_domains_and_expiry() {
    let mut env = Env::new();
    let owner = env.funded();
    let org = env.create_org(&owner, "Acme Inc.", None);
    let attestor = env.attestor.insecure_clone();
    let now = env.now();
    for bad in [
        "Acme.example",
        "localhost",
        "acme",
        "xn--80ak6aa92e.com.",
        "acme.example:443",
    ] {
        assert_stele_err(
            &env.attest_domain(&attestor, &org, bad, now + 86_400),
            SteleError::InvalidDomain,
        );
    }
    assert_stele_err(
        &env.attest_domain(&attestor, &org, "acme.example", now),
        SteleError::InvalidDomainExpiry,
    );
    assert_stele_err(
        &env.attest_domain(&attestor, &org, "acme.example", now + 401 * 86_400),
        SteleError::InvalidDomainExpiry,
    );

    // Hash mismatch between the seed hash and the domain string.
    let i = ix(
        stele::instruction::AttestDomain {
            args: stele::instructions::AttestDomainArgs {
                domain: "acme.example".into(),
                domain_hash: stele_core::hash::domain_hash("other.example"),
                expires_at: now + 86_400,
            },
        },
        vec![
            signer_ro(attestor.pubkey()),
            ro(config_pda()),
            rw(org),
            rw(domain_pda("other.example")),
            signer_rw(attestor.pubkey()),
            ro(system_program()),
        ],
    );
    assert_stele_err(
        &env.send(&[i], &attestor, &[]),
        SteleError::DomainHashMismatch,
    );
}

#[test]
fn one_verified_domain_per_organization_and_owner_can_relinquish() {
    let mut env = Env::new();
    let owner = env.funded();
    let stranger = env.funded();
    let org = env.create_org(&owner, "Acme Inc.", None);
    let attestor = env.attestor.insecure_clone();
    let expires = env.now() + 86_400;
    assert_ok(&env.attest_domain(&attestor, &org, "acme.example", expires));
    assert_stele_err(
        &env.attest_domain(&attestor, &org, "acme2.example", expires),
        SteleError::OrganizationAlreadyHasDomain,
    );
    let rent_payer = attestor.pubkey();
    assert_stele_err(
        &env.revoke_domain(&stranger, &org, "acme.example", &rent_payer),
        SteleError::Unauthorized,
    );
    assert_ok(&env.revoke_domain(&owner, &org, "acme.example", &rent_payer));
    assert!(env.organization(&org).verified_domain.is_empty());
}
