//! Document creation and immutable, chained version publication.

mod common;

use common::*;
use solana_signer::Signer;
use stele::error::SteleError;
use stele_canonical::{Block, Content};

#[test]
fn publishes_a_hash_chained_history() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;

    // Real canonical content for v2.
    let content = Content {
        attachments: vec![],
        blocks: vec![
            Block::Heading {
                level: 1,
                text: "Terms of Service".into(),
            },
            Block::Paragraph {
                text: "Version two adds an arbitration clause.".into(),
            },
        ],
        change_summary: Some("Added arbitration.".into()),
    }
    .canonicalize()
    .unwrap();
    let bytes = content.to_canonical_bytes();
    let content_hash = stele_canonical::content_hash(&bytes);

    let v1 = env.version(&t.version);
    assert_eq!(v1.version, 1);
    assert_eq!(v1.previous_version_hash, [0u8; 32]);

    let mut p = env.next_publish_params(&t.document, "unused");
    p.content_hash = content_hash;
    p.version_label = "2.0".into();
    let (v2_addr, res) = env.publish_with(&fx.owner, &t.org, &t.document, &p, true);
    assert_ok(&res);
    let v3_addr = env.publish(&fx.owner, &t.org, &t.document, "v3");

    let v2 = env.version(&v2_addr);
    let v3 = env.version(&v3_addr);
    let doc = env.document(&t.document);
    assert_eq!(
        v2.previous_version_hash, v1.version_hash,
        "v2 commits to v1"
    );
    assert_eq!(
        v3.previous_version_hash, v2.version_hash,
        "v3 commits to v2"
    );
    assert_eq!(doc.version_count, 3);
    assert_eq!(doc.head_hash, v3.version_hash);
    assert_eq!(to_addr(&doc.current_version), v3_addr);
    assert_eq!(v2.content_hash, content_hash);
    assert_eq!(v2.published_at, env.now());
    assert_eq!(v2.version_label, "2.0");

    // The on-chain fingerprint equals an independent recomputation.
    let mut p2 = p.clone();
    p2.expected_version_hash = None;
    assert_eq!(
        v2.version_hash,
        env.expected_version_hash(&t.org, &t.document, &p2)
    );

    // History is immutable: later publications leave earlier accounts byte-identical.
    let v1_before = env.raw_account(&t.version).unwrap().data;
    env.publish(&fx.owner, &t.org, &t.document, "v4");
    assert_eq!(env.raw_account(&t.version).unwrap().data, v1_before);
}

#[test]
fn rejects_wrong_or_duplicate_version_numbers() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    // Re-publishing version 1 (duplicate PDA) fails.
    let mut p = env.next_publish_params(&t.document, "dup");
    p.version = 1;
    p.previous_version_hash = [0u8; 32];
    let (_, res) = env.publish_with(&fx.owner, &t.org, &t.document, &p, true);
    assert_failed(&res);
    // Skipping a number fails.
    let mut p = env.next_publish_params(&t.document, "skip");
    p.version = 3;
    let (_, res) = env.publish_with(&fx.owner, &t.org, &t.document, &p, true);
    assert_stele_err(&res, SteleError::InvalidVersionNumber);
}

#[test]
fn rejects_incorrect_previous_hash() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let mut p = env.next_publish_params(&t.document, "v2");
    p.previous_version_hash = [9u8; 32];
    let (_, res) = env.publish_with(&fx.owner, &t.org, &t.document, &p, true);
    assert_stele_err(&res, SteleError::PreviousVersionHashMismatch);
}

#[test]
fn rejects_fingerprint_the_publisher_did_not_review() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    // The publisher reviewed a fingerprint for a different title (e.g. a tampered frontend).
    let mut reviewed = env.next_publish_params(&t.document, "v2");
    reviewed.title = "Friendly Terms".into();
    let reviewed_hash = env.expected_version_hash(&t.org, &t.document, &reviewed);
    let mut submitted = reviewed.clone();
    submitted.title = "Harsh Terms".into();
    submitted.expected_version_hash = Some(reviewed_hash);
    let (_, res) = env.publish_with(&fx.owner, &t.org, &t.document, &submitted, true);
    assert_stele_err(&res, SteleError::VersionHashMismatch);
}

#[test]
fn cannot_publish_into_another_organizations_document() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let mallory = env.funded();
    let mallory_org = env.create_org(&mallory, "Mallory Corp", None);
    let p = env.next_publish_params(&t.document, "hostile");
    let (_, res) = env.publish_with(&mallory, &mallory_org, &t.document, &p, true);
    assert_stele_err(&res, SteleError::DocumentOrganizationMismatch);
    // Nor with the victim's organization (not owner/member there).
    let (_, res) = env.publish_with(&mallory, &t.org, &t.document, &p, true);
    assert_stele_err(&res, SteleError::Unauthorized);
}

#[test]
fn version_account_must_be_the_canonical_pda() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let p = env.next_publish_params(&t.document, "v2");
    let expected = env.expected_version_hash(&t.org, &t.document, &p);
    let wrong_pda = version_pda(&t.document, 7);
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
            signer_ro(fx.owner.pubkey()),
            optional(None),
            ro(config_pda()),
            ro(t.org),
            rw(t.document),
            rw(wrong_pda),
            signer_rw(fx.owner.pubkey()),
            ro(system_program()),
        ],
    );
    assert_failed(&env.send(&[i], &fx.owner, &[]));
}

#[test]
fn effective_date_cannot_be_backdated() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let now = env.now();
    let mut p = env.next_publish_params(&t.document, "backdated");
    p.effective_at = now - 86_400;
    let (_, res) = env.publish_with(&fx.owner, &t.org, &t.document, &p, true);
    assert_stele_err(&res, SteleError::InvalidEffectiveAt);
    p.effective_at = now + 6 * 365 * 86_400;
    let (_, res) = env.publish_with(&fx.owner, &t.org, &t.document, &p, true);
    assert_stele_err(&res, SteleError::InvalidEffectiveAt);
    p.effective_at = now + 30 * 86_400;
    let (v, res) = env.publish_with(&fx.owner, &t.org, &t.document, &p, true);
    assert_ok(&res);
    assert_eq!(env.version(&v).effective_at, now + 30 * 86_400);
}

#[test]
fn validates_metadata_fields() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let base = env.next_publish_params(&t.document, "fields");
    type Mutation = Box<dyn Fn(&mut PublishParams)>;
    let cases: Vec<(Mutation, SteleError)> = vec![
        (
            Box::new(|p| p.title = "Terms \u{202E}ecivreS".into()),
            SteleError::InvalidTitle,
        ),
        (Box::new(|p| p.title = "".into()), SteleError::InvalidTitle),
        (
            Box::new(|p| p.title = "x".repeat(65)),
            SteleError::InvalidTitle,
        ),
        (
            Box::new(|p| p.version_label = "v 2".into()),
            SteleError::InvalidVersionLabel,
        ),
        (
            Box::new(|p| p.storage_uri = "javascript:alert(1)".into()),
            SteleError::InvalidStorageUri,
        ),
        (
            Box::new(|p| p.storage_uri = "http://insecure.example/doc".into()),
            SteleError::InvalidStorageUri,
        ),
    ];
    for (mutate, expected) in cases {
        let mut p = base.clone();
        mutate(&mut p);
        let (_, res) = env.publish_with(&fx.owner, &t.org, &t.document, &p, true);
        assert_stele_err(&res, expected);
    }
}

#[test]
fn concurrent_drafts_resolve_to_exactly_one_publication() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let publisher = env.funded();
    assert_ok(&env.add_member(
        &fx.owner,
        &t.org,
        &publisher.pubkey(),
        stele_core::constants::ROLE_PUBLISHER,
    ));
    // Both drafts are prepared against the same head.
    let mut draft_a = env.next_publish_params(&t.document, "draft A");
    let mut draft_b = env.next_publish_params(&t.document, "draft B");
    draft_a.expected_version_hash = Some(env.expected_version_hash(&t.org, &t.document, &draft_a));
    draft_b.expected_version_hash = Some(env.expected_version_hash(&t.org, &t.document, &draft_b));
    let (_, res_a) = env.publish_with(&fx.owner, &t.org, &t.document, &draft_a, true);
    assert_ok(&res_a);
    let (_, res_b) = env.publish_with(&publisher, &t.org, &t.document, &draft_b, true);
    assert_failed(&res_b);
    assert_eq!(env.document(&t.document).version_count, 2);
}

#[test]
fn document_fields_are_validated_and_unique() {
    let mut env = Env::new();
    let owner = env.funded();
    let org = env.create_org(&owner, "Acme Inc.", None);
    let (_, res) = env.create_document(&owner, &org, "Terms", "terms-of-service", "en");
    assert_stele_err(&res, SteleError::InvalidSlug);
    let (_, res) = env.create_document(&owner, &org, "terms", "Terms Of Service", "en");
    assert_stele_err(&res, SteleError::InvalidDocumentType);
    let (_, res) = env.create_document(&owner, &org, "terms", "terms-of-service", "en_US");
    assert_stele_err(&res, SteleError::InvalidLocale);
    let (doc, res) = env.create_document(&owner, &org, "terms", "terms-of-service", "en-US");
    assert_ok(&res);
    let d = env.document(&doc);
    assert_eq!(
        (d.slug.as_str(), d.document_type.as_str(), d.locale.as_str()),
        ("terms", "terms-of-service", "en-US")
    );
    let (_, res) = env.create_document(&owner, &org, "terms", "privacy-policy", "en");
    assert_failed(&res);
    assert_eq!(env.organization(&org).document_count, 1);
}
