//! Native passkey (WebAuthn ES256 / P-256) acceptances and enrollment (stele/2).
//!
//! Signatures are real: a software authenticator (OpenSSL P-256) produces WebAuthn assertions —
//! `authenticatorData ‖ SHA-256(clientDataJSON)` signed with a low-S ECDSA signature — and the
//! runtime's secp256r1 precompile verifies them. Every test then attacks one link of the chain
//! from the precompile to the recorded acceptance.

#![allow(clippy::result_large_err)]

mod common;

use common::*;
use openssl::bn::BigNumContext;
use openssl::ec::{EcGroup, EcKey, PointConversionForm};
use openssl::nid::Nid;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_secp256r1_program::{new_secp256r1_instruction_with_signature, sign_message};
use solana_signer::Signer;
use stele::error::SteleError;
use stele::instructions::{
    EnrollPasskeySignerArgs, PasskeyAssertion, RecordPasskeyAcceptanceArgs,
    RecoverPasskeySignerArgs, RotatePasskeySignerArgs,
};
use stele::state::{
    PasskeySigner, PASSKEY_KIND_ENROLLED, PASSKEY_KIND_ORGANIZATION_RECOVERY, PASSKEY_KIND_ROTATED,
    PASSKEY_STATUS_ACTIVE, PASSKEY_STATUS_REVOKED,
};
use stele_core::passkey::{
    base64url, enrollment_statement, passkey_acceptance_message, rotation_statement,
    webauthn_challenge, PasskeyAcceptanceFields, FLAG_ATTESTED_CREDENTIAL_DATA, FLAG_USER_PRESENT,
    FLAG_USER_VERIFIED, PASSKEY_ACCEPTANCE_TAG, PASSKEY_ENROLL_TAG, PASSKEY_ROTATE_TAG,
};

const RP_ID: &str = "acme.example";
const ORIGIN: &str = "https://app.acme.example";
const UV: u8 = FLAG_USER_PRESENT | FLAG_USER_VERIFIED;

// ---- a software WebAuthn authenticator ----------------------------------------------------------

struct Passkey {
    der: Vec<u8>,
    public: [u8; 33],
}

impl Passkey {
    fn new() -> Self {
        let group = EcGroup::from_curve_name(Nid::X9_62_PRIME256V1).unwrap();
        let key = EcKey::generate(&group).unwrap();
        let mut ctx = BigNumContext::new().unwrap();
        let bytes = key
            .public_key()
            .to_bytes(&group, PointConversionForm::COMPRESSED, &mut ctx)
            .unwrap();
        let mut public = [0u8; 33];
        public.copy_from_slice(&bytes);
        Passkey {
            der: key.private_key_to_der().unwrap(),
            public,
        }
    }

    fn sign(&self, data: &[u8]) -> [u8; 64] {
        sign_message(data, &self.der).unwrap()
    }
}

/// How the browser and authenticator behaved during one ceremony.
#[derive(Clone)]
struct Ceremony {
    kind: &'static str,
    origin: String,
    rp_id: String,
    flags: u8,
    /// Everything after the origin's closing quote.
    tail: String,
    /// Authenticator data bytes after rpIdHash ‖ flags ‖ signCount (extensions).
    extra: Vec<u8>,
}

impl Default for Ceremony {
    fn default() -> Self {
        Ceremony {
            kind: "webauthn.get",
            origin: ORIGIN.into(),
            rp_id: RP_ID.into(),
            flags: UV,
            tail: ",\"crossOrigin\":false}".into(),
            extra: vec![],
        }
    }
}

struct Assertion {
    signed: Vec<u8>,
    client_data: Vec<u8>,
    signature: [u8; 64],
}

fn assert_with(pk: &Passkey, challenge: &[u8; 32], c: &Ceremony) -> Assertion {
    let client_data = format!(
        "{{\"type\":\"{}\",\"challenge\":\"{}\",\"origin\":\"{}\"{}",
        c.kind,
        base64url(challenge),
        c.origin,
        c.tail
    )
    .into_bytes();
    let mut signed = hash32(c.rp_id.as_bytes()).to_vec();
    signed.push(c.flags);
    signed.extend_from_slice(&[0, 0, 0, 1]);
    signed.extend_from_slice(&c.extra);
    signed.extend_from_slice(&hash32(&client_data));
    let signature = pk.sign(&signed);
    Assertion {
        signed,
        client_data,
        signature,
    }
}

fn precompile(public: &[u8; 33], a: &Assertion) -> Instruction {
    new_secp256r1_instruction_with_signature(&a.signed, &a.signature, public)
}

// ---- acceptance helpers -------------------------------------------------------------------------

fn passkey_message(env: &Env, t: &Target, signer: &[u8; 33], a: &AcceptParams) -> String {
    let o = env.organization(&t.org);
    let v = env.version(&t.version);
    let s = env.shard(&t.shard);
    let config = env.config();
    passkey_acceptance_message(
        &PasskeyAcceptanceFields {
            org_name: &o.name,
            org_verified_domain: o.verified_domain_at(env.now()),
            title: &v.title,
            version_label: &v.version_label,
            version: v.version,
            version_hash: &v.version_hash,
            signer,
            network_label: &config.network_label,
            issued_at: a.issued_at,
            expires_at: a.expires_at,
            shard_id: s.shard_id,
            nonce_index: a.nonce_index,
            nonce_tag: &a.nonce_tag,
        },
        &a.request_domain,
    )
    .unwrap()
}

fn record_ix(
    relayer: &Address,
    t: &Target,
    a: &AcceptParams,
    rp_id: &str,
    client_data: Vec<u8>,
    enrollment: Option<Address>,
) -> Instruction {
    ix(
        stele::instruction::RecordPasskeyAcceptance {
            args: RecordPasskeyAcceptanceArgs {
                nonce_index: a.nonce_index,
                nonce_tag: a.nonce_tag,
                issued_at: a.issued_at,
                expires_at: a.expires_at,
                assertion: PasskeyAssertion {
                    request_domain: a.request_domain.clone(),
                    rp_id: rp_id.into(),
                    client_data_json: client_data,
                },
            },
        },
        vec![
            signer_rw(*relayer),
            ro(config_pda()),
            ro(t.org),
            ro(t.document),
            ro(t.version),
            rw(t.shard),
            optional(enrollment),
            ro(instructions_sysvar()),
        ],
    )
}

fn send(env: &mut Env, ixs: &[Instruction]) -> TxResult {
    let relayer = env.relayer.insecure_clone();
    env.send(ixs, &relayer, &[])
}

/// The full browser + relayer flow; `tweak` changes what the browser/authenticator does.
fn accept(
    env: &mut Env,
    pk: &Passkey,
    t: &Target,
    a: &AcceptParams,
    c: &Ceremony,
    enrollment: Option<Address>,
) -> TxResult {
    let message = passkey_message(env, t, &pk.public, a);
    let challenge = webauthn_challenge(PASSKEY_ACCEPTANCE_TAG, message.as_bytes());
    let assertion = assert_with(pk, &challenge, c);
    let relayer = env.relayer.pubkey();
    let rec = record_ix(
        &relayer,
        t,
        a,
        &c.rp_id,
        assertion.client_data.clone(),
        enrollment,
    );
    send(env, &[precompile(&pk.public, &assertion), rec])
}

fn ok_accept(env: &mut Env, pk: &Passkey, t: &Target, nonce: u32) -> TxResult {
    let a = env.default_accept(nonce);
    accept(env, pk, t, &a, &Ceremony::default(), None)
}

// ---- happy path ---------------------------------------------------------------------------------

#[test]
fn records_a_native_passkey_acceptance_the_user_pays_nothing_for() {
    let mut env = Env::new();
    let fx = env.fixture();
    let pk = Passkey::new();
    let relayer = env.relayer.pubkey();
    let before = env.lamports(&relayer);

    let meta = ok_accept(&mut env, &pk, &fx.target, 7).expect("passkey acceptance recorded");
    println!(
        "record_passkey_acceptance: {} compute units, relayer paid {} lamports",
        meta.compute_units_consumed,
        before - env.lamports(&relayer)
    );
    assert_eq!(env.shard(&fx.target.shard).accepted_count, 1);
    assert!(
        meta.logs.iter().any(|l| l.starts_with("Program data: ")),
        "PasskeyAcceptanceRecorded emitted"
    );
    // One relayer signature + one secp256r1 precompile signature.
    assert_eq!(before - env.lamports(&relayer), 10_000);

    // The same signed acceptance can never be recorded twice.
    let a = env.default_accept(7);
    assert_stele_err(
        &accept(&mut env, &pk, &fx.target, &a, &Ceremony::default(), None),
        SteleError::NonceAlreadyUsed,
    );
    // Localhost pages may use http://localhost:<port>.
    let mut a = env.default_accept(8);
    a.request_domain = "localhost".into();
    let c = Ceremony {
        origin: "http://localhost:3000".into(),
        rp_id: "localhost".into(),
        ..Ceremony::default()
    };
    assert_ok(&accept(&mut env, &pk, &fx.target, &a, &c, None));
}

#[test]
fn extension_data_and_parent_relying_parties_are_accepted() {
    let mut env = Env::new();
    let fx = env.fixture();
    let pk = Passkey::new();
    let a = env.default_accept(1);
    let c = Ceremony {
        flags: UV | stele_core::passkey::FLAG_EXTENSION_DATA,
        extra: vec![0xa0],
        tail: ",\"crossOrigin\":false,\"other_keys_can_be_added_here\":\"x\"}".into(),
        ..Ceremony::default()
    };
    assert_ok(&accept(&mut env, &pk, &fx.target, &a, &c, None));
    // A relying party equal to the requesting host also works.
    let a = env.default_accept(2);
    let c = Ceremony {
        rp_id: REQUEST_DOMAIN.into(),
        ..Ceremony::default()
    };
    assert_ok(&accept(&mut env, &pk, &fx.target, &a, &c, None));
}

// ---- WebAuthn binding attacks -------------------------------------------------------------------

#[test]
fn the_assertion_must_be_for_exactly_this_acceptance() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let pk = Passkey::new();
    let a = env.default_accept(1);
    let message = passkey_message(&env, &t, &pk.public, &a);

    // Each tampered field changes the message the program rebuilds, so the signed challenge no
    // longer matches: fingerprint, version, organization, network, document title, window, nonce,
    // signer key and requesting site.
    let v = env.version(&t.version);
    let tampered = [
        message.replace(
            &stele_core::encoding::hex_lower(&v.version_hash),
            &"00".repeat(32),
        ),
        message.replace("Version: ", "Version: 9"),
        message.replace("Organization: Acme Inc.", "Organization: Acne Inc."),
        message.replace("Solana Localnet", "Solana Mainnet"),
        message.replace("Document: ", "Document: Old "),
        message.replace("Expires: ", "Expires: 1"),
        message.replace("Nonce: 0-1-", "Nonce: 0-2-"),
        message.replace("Stele Protocol v2", "Stele Protocol v1"),
        message.replace(REQUEST_DOMAIN, "evil.acme.example"),
    ];
    for (i, m) in tampered.iter().enumerate() {
        assert_ne!(m, &message, "tamper {i} changed nothing");
        let challenge = webauthn_challenge(PASSKEY_ACCEPTANCE_TAG, m.as_bytes());
        let assertion = assert_with(&pk, &challenge, &Ceremony::default());
        let rec = record_ix(
            &env.relayer.pubkey(),
            &t,
            &a,
            RP_ID,
            assertion.client_data.clone(),
            None,
        );
        assert_stele_err(
            &send(&mut env, &[precompile(&pk.public, &assertion), rec]),
            SteleError::InvalidClientData,
        );
    }
    // The right message under another statement kind (an enrollment challenge) is refused too.
    let challenge = webauthn_challenge(PASSKEY_ENROLL_TAG, message.as_bytes());
    let assertion = assert_with(&pk, &challenge, &Ceremony::default());
    let rec = record_ix(
        &env.relayer.pubkey(),
        &t,
        &a,
        RP_ID,
        assertion.client_data.clone(),
        None,
    );
    assert_stele_err(
        &send(&mut env, &[precompile(&pk.public, &assertion), rec]),
        SteleError::InvalidClientData,
    );
    assert_eq!(env.shard(&t.shard).accepted_count, 0);
    assert_ok(&ok_accept(&mut env, &pk, &t, 1));
}

#[test]
fn browser_attested_origin_and_ceremony_type_are_enforced() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let pk = Passkey::new();
    let cases: Vec<(Ceremony, SteleError)> = vec![
        (
            Ceremony {
                origin: "https://evil.example".into(),
                ..Ceremony::default()
            },
            SteleError::OriginMismatch,
        ),
        (
            Ceremony {
                origin: "http://app.acme.example".into(),
                ..Ceremony::default()
            },
            SteleError::OriginMismatch,
        ),
        (
            Ceremony {
                origin: "https://app.acme.example:8443".into(),
                ..Ceremony::default()
            },
            SteleError::OriginMismatch,
        ),
        (
            Ceremony {
                kind: "webauthn.create",
                ..Ceremony::default()
            },
            SteleError::InvalidClientData,
        ),
        (
            Ceremony {
                tail: ",\"crossOrigin\":true,\"topOrigin\":\"https://evil.example\"}".into(),
                ..Ceremony::default()
            },
            SteleError::CrossOriginCeremony,
        ),
        (
            Ceremony {
                tail: "x}".into(),
                ..Ceremony::default()
            },
            SteleError::InvalidClientData,
        ),
    ];
    for (i, (c, err)) in cases.into_iter().enumerate() {
        let a = env.default_accept(i as u32);
        assert_stele_err(&accept(&mut env, &pk, &t, &a, &c, None), err);
    }
    assert_eq!(env.shard(&t.shard).accepted_count, 0);
}

#[test]
fn relying_party_and_user_verification_are_enforced() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let pk = Passkey::new();
    let cases: Vec<(Ceremony, SteleError)> = vec![
        // Authenticator data names another relying party than the one claimed.
        (
            Ceremony {
                rp_id: "evil.example".into(),
                ..Ceremony::default()
            },
            SteleError::RelyingPartyMismatch,
        ),
        // No user verification (presence only), no presence, neither.
        (
            Ceremony {
                flags: FLAG_USER_PRESENT,
                ..Ceremony::default()
            },
            SteleError::UserNotVerified,
        ),
        (
            Ceremony {
                flags: FLAG_USER_VERIFIED,
                ..Ceremony::default()
            },
            SteleError::UserNotVerified,
        ),
        // Registration-style authenticator data in an assertion; undeclared extension bytes.
        (
            Ceremony {
                flags: UV | FLAG_ATTESTED_CREDENTIAL_DATA,
                ..Ceremony::default()
            },
            SteleError::InvalidAuthenticatorData,
        ),
        (
            Ceremony {
                extra: vec![0xa0],
                ..Ceremony::default()
            },
            SteleError::InvalidAuthenticatorData,
        ),
    ];
    for (i, (c, err)) in cases.into_iter().enumerate() {
        let a = env.default_accept(i as u32);
        let res = if c.rp_id == "evil.example" {
            // Claim the right RP ID while the authenticator data names another one.
            let message = passkey_message(&env, &t, &pk.public, &a);
            let challenge = webauthn_challenge(PASSKEY_ACCEPTANCE_TAG, message.as_bytes());
            let assertion = assert_with(&pk, &challenge, &c);
            let rec = record_ix(
                &env.relayer.pubkey(),
                &t,
                &a,
                RP_ID,
                assertion.client_data.clone(),
                None,
            );
            send(&mut env, &[precompile(&pk.public, &assertion), rec])
        } else {
            accept(&mut env, &pk, &t, &a, &c, None)
        };
        assert_stele_err(&res, err);
    }
    // A relying party that does not cover the requesting site, even if consistently signed.
    let a = env.default_accept(9);
    let c = Ceremony {
        rp_id: "other.example".into(),
        ..Ceremony::default()
    };
    assert_stele_err(
        &accept(&mut env, &pk, &t, &a, &c, None),
        SteleError::RelyingPartyMismatch,
    );
    assert_eq!(env.shard(&t.shard).accepted_count, 0);
}

#[test]
fn client_data_must_be_the_one_that_was_signed() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let pk = Passkey::new();
    let a = env.default_accept(1);
    let message = passkey_message(&env, &t, &pk.public, &a);
    let challenge = webauthn_challenge(PASSKEY_ACCEPTANCE_TAG, message.as_bytes());
    let assertion = assert_with(&pk, &challenge, &Ceremony::default());
    // Valid-looking client data for the same challenge, but not the bytes whose hash was signed.
    let swapped = format!(
        "{{\"type\":\"webauthn.get\",\"challenge\":\"{}\",\"origin\":\"{ORIGIN}\"}}",
        base64url(&challenge)
    )
    .into_bytes();
    let rec = record_ix(&env.relayer.pubkey(), &t, &a, RP_ID, swapped, None);
    assert_stele_err(
        &send(&mut env, &[precompile(&pk.public, &assertion), rec]),
        SteleError::ClientDataHashMismatch,
    );
}

// ---- precompile introspection attacks ---------------------------------------------------------------

#[test]
fn the_precompile_must_verify_this_key_this_signature_and_these_bytes() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let pk = Passkey::new();
    let other = Passkey::new();
    let a = env.default_accept(1);
    let message = passkey_message(&env, &t, &pk.public, &a);
    let challenge = webauthn_challenge(PASSKEY_ACCEPTANCE_TAG, message.as_bytes());
    let good = assert_with(&pk, &challenge, &Ceremony::default());
    let relayer = env.relayer.pubkey();
    let rec = || record_ix(&relayer, &t, &a, RP_ID, good.client_data.clone(), None);

    // Public-key substitution: the precompile fails (signature not by this key).
    assert_failed(&send(&mut env, &[precompile(&other.public, &good), rec()]));
    // Signature substitution: a signature over other bytes.
    let forged = Assertion {
        signature: pk.sign(b"something else"),
        ..assert_with(&pk, &challenge, &Ceremony::default())
    };
    assert_failed(&send(&mut env, &[precompile(&pk.public, &forged), rec()]));
    // Message substitution: valid signature, but over bytes with another client-data hash.
    let other_bytes = assert_with(&pk, &[9u8; 32], &Ceremony::default());
    assert_stele_err(
        &send(&mut env, &[precompile(&pk.public, &other_bytes), rec()]),
        SteleError::ClientDataHashMismatch,
    );
    // High-S (malleable) signature: rejected by the precompile.
    let mut high_s = good.signature;
    let order: [u8; 32] = [
        0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xFF, 0xBC, 0xE6, 0xFA, 0xAD, 0xA7, 0x17, 0x9E, 0x84, 0xF3, 0xB9, 0xCA, 0xC2, 0xFC, 0x63,
        0x25, 0x51,
    ];
    // s' = n - s: the same signature in its malleated (high-S) form.
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let d = i16::from(order[i]) - i16::from(good.signature[32 + i]) - borrow;
        borrow = i16::from(d < 0);
        high_s[32 + i] = d.rem_euclid(256) as u8;
    }
    assert_failed(&send(
        &mut env,
        &[
            new_secp256r1_instruction_with_signature(&good.signed, &high_s, &pk.public),
            rec(),
        ],
    ));
    // r = 0.
    let mut zero_r = good.signature;
    zero_r[..32].fill(0);
    assert_failed(&send(
        &mut env,
        &[
            new_secp256r1_instruction_with_signature(&good.signed, &zero_r, &pk.public),
            rec(),
        ],
    ));
    assert_eq!(env.shard(&t.shard).accepted_count, 0);
    assert_ok(&send(&mut env, &[precompile(&pk.public, &good), rec()]));
}

#[test]
fn the_precompile_layout_and_position_are_strict() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let pk = Passkey::new();
    let a = env.default_accept(1);
    let message = passkey_message(&env, &t, &pk.public, &a);
    let challenge = webauthn_challenge(PASSKEY_ACCEPTANCE_TAG, message.as_bytes());
    let good = assert_with(&pk, &challenge, &Ceremony::default());
    let relayer = env.relayer.pubkey();
    let rec = record_ix(&relayer, &t, &a, RP_ID, good.client_data.clone(), None);
    let pre = precompile(&pk.public, &good);

    // Missing entirely; or another program's instruction in its place.
    assert_stele_err(
        &send(&mut env, std::slice::from_ref(&rec)),
        SteleError::MissingSecp256r1Instruction,
    );
    let noop = transfer_ix(&relayer, &relayer, 0);
    assert_stele_err(
        &send(&mut env, &[noop.clone(), rec.clone()]),
        SteleError::MissingSecp256r1Instruction,
    );
    // Not immediately preceding (an instruction in between).
    assert_stele_err(
        &send(&mut env, &[pre.clone(), noop, rec.clone()]),
        SteleError::MissingSecp256r1Instruction,
    );
    // Offsets that name an instruction explicitly (even itself) instead of u16::MAX: the bytes
    // could then come from another instruction. The runtime accepts this one; the program refuses.
    let mut explicit = pre.clone();
    for field in [4usize, 8, 14] {
        explicit.data[field..field + 2].copy_from_slice(&0u16.to_le_bytes());
    }
    assert_stele_err(
        &send(&mut env, &[explicit, rec.clone()]),
        SteleError::InvalidSecp256r1Instruction,
    );
    // Accounts attached to the precompile instruction.
    let mut with_accounts = pre.clone();
    with_accounts
        .accounts
        .push(AccountMeta::new_readonly(relayer, false));
    assert_stele_err(
        &send(&mut env, &[with_accounts, rec.clone()]),
        SteleError::InvalidSecp256r1Instruction,
    );
    // Two signatures in one precompile instruction (both genuine).
    let mut two = pre.clone();
    two.data[0] = 2;
    let offsets = two.data[2..16].to_vec();
    two.data.splice(16..16, offsets);
    for field in [16usize, 20, 24] {
        let v = u16::from_le_bytes([two.data[field], two.data[field + 1]]) + 14;
        two.data[field..field + 2].copy_from_slice(&v.to_le_bytes());
    }
    for field in [2usize, 6, 10] {
        let v = u16::from_le_bytes([two.data[field], two.data[field + 1]]) + 14;
        two.data[field..field + 2].copy_from_slice(&v.to_le_bytes());
    }
    assert_stele_err(
        &send(&mut env, &[two, rec.clone()]),
        SteleError::InvalidSecp256r1Instruction,
    );
    assert_eq!(env.shard(&t.shard).accepted_count, 0);
    assert_ok(&send(&mut env, &[pre, rec]));
}

#[test]
fn passkey_acceptances_cannot_arrive_through_cpi() {
    let mut env = Env::new();
    let probe = env.deploy_cpi_probe();
    let fx = env.fixture();
    let t = fx.target;
    let pk = Passkey::new();
    let a = env.default_accept(1);
    let message = passkey_message(&env, &t, &pk.public, &a);
    let challenge = webauthn_challenge(PASSKEY_ACCEPTANCE_TAG, message.as_bytes());
    let good = assert_with(&pk, &challenge, &Ceremony::default());
    let rec = record_ix(
        &env.relayer.pubkey(),
        &t,
        &a,
        RP_ID,
        good.client_data.clone(),
        None,
    );
    let mut accounts = vec![ro(program_id())];
    accounts.extend(rec.accounts.iter().cloned());
    let forwarded = Instruction {
        program_id: probe,
        accounts,
        data: rec.data.clone(),
    };
    assert_stele_err(
        &send(&mut env, &[precompile(&pk.public, &good), forwarded]),
        SteleError::CpiNotAllowed,
    );
    assert_ok(&send(&mut env, &[precompile(&pk.public, &good), rec]));
}

#[test]
fn wallet_and_passkey_acceptances_share_one_nonce_space() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let user = env.funded();
    assert_ok(&env.accept(&user, &t, &env.default_accept(5)));
    let pk = Passkey::new();
    assert_stele_err(
        &ok_accept(&mut env, &pk, &t, 5),
        SteleError::NonceAlreadyUsed,
    );
    assert_ok(&ok_accept(&mut env, &pk, &t, 6));
    assert_eq!(env.shard(&t.shard).accepted_count, 2);
}

// ---- enrollment -------------------------------------------------------------------------------

fn enrollment_pda(org: &Address, commitment: &[u8; 32]) -> Address {
    pda(&[b"passkey-signer", org.as_ref(), commitment])
}

fn enroll(
    env: &mut Env,
    pk: &Passkey,
    t: &Target,
    commitment: [u8; 32],
    relayer: &Keypair,
) -> TxResult {
    let now = env.now();
    let statement = enrollment_statement(
        &t.org.to_bytes(),
        &commitment,
        &pk.public,
        RP_ID,
        NETWORK_LABEL,
        now,
        now + 600,
    )
    .unwrap();
    let challenge = webauthn_challenge(PASSKEY_ENROLL_TAG, statement.as_bytes());
    let assertion = assert_with(pk, &challenge, &Ceremony::default());
    let i = ix(
        stele::instruction::EnrollPasskeySigner {
            args: EnrollPasskeySignerArgs {
                account_commitment: commitment,
                credential_id_hash: [0x77; 32],
                issued_at: now,
                expires_at: now + 600,
                assertion: PasskeyAssertion {
                    request_domain: REQUEST_DOMAIN.into(),
                    rp_id: RP_ID.into(),
                    client_data_json: assertion.client_data.clone(),
                },
            },
        },
        vec![
            signer_rw(relayer.pubkey()),
            ro(config_pda()),
            ro(t.org),
            ro(t.shard),
            rw(enrollment_pda(&t.org, &commitment)),
            ro(system_program()),
            ro(instructions_sysvar()),
        ],
    );
    env.send(&[precompile(&pk.public, &assertion), i], relayer, &[])
}

fn rotate(
    env: &mut Env,
    signer: &Passkey,
    next: &Passkey,
    t: &Target,
    commitment: [u8; 32],
) -> TxResult {
    let now = env.now();
    let statement = rotation_statement(
        &t.org.to_bytes(),
        &commitment,
        &signer.public,
        &next.public,
        NETWORK_LABEL,
        now,
        now + 600,
    )
    .unwrap();
    let challenge = webauthn_challenge(PASSKEY_ROTATE_TAG, statement.as_bytes());
    let assertion = assert_with(signer, &challenge, &Ceremony::default());
    let relayer = env.relayer.insecure_clone();
    let i = ix(
        stele::instruction::RotatePasskeySigner {
            args: RotatePasskeySignerArgs {
                new_signer: next.public,
                new_credential_id_hash: [0x78; 32],
                issued_at: now,
                expires_at: now + 600,
                assertion: PasskeyAssertion {
                    request_domain: REQUEST_DOMAIN.into(),
                    rp_id: RP_ID.into(),
                    client_data_json: assertion.client_data.clone(),
                },
            },
        },
        vec![
            signer_ro(relayer.pubkey()),
            ro(config_pda()),
            ro(t.org),
            rw(enrollment_pda(&t.org, &commitment)),
            ro(instructions_sysvar()),
        ],
    );
    env.send(&[precompile(&signer.public, &assertion), i], &relayer, &[])
}

fn manage(
    env: &mut Env,
    authority: &Keypair,
    t: &Target,
    commitment: [u8; 32],
    recover_to: Option<&Passkey>,
) -> TxResult {
    let membership = env.membership_of(&t.org, &authority.pubkey());
    let accounts = vec![
        signer_ro(authority.pubkey()),
        optional(membership),
        ro(t.org),
        rw(enrollment_pda(&t.org, &commitment)),
    ];
    let i = match recover_to {
        Some(next) => ix(
            stele::instruction::RecoverPasskeySigner {
                args: RecoverPasskeySignerArgs {
                    new_signer: next.public,
                    new_credential_id_hash: [0x79; 32],
                    rp_id_hash: hash32(RP_ID.as_bytes()),
                },
            },
            accounts,
        ),
        None => ix(stele::instruction::RevokePasskeySigner {}, accounts),
    };
    env.send(&[i], authority, &[])
}

fn enrolled(env: &Env, t: &Target, commitment: &[u8; 32]) -> PasskeySigner {
    env.account(&enrollment_pda(&t.org, commitment))
}

#[test]
fn enrollment_binds_one_key_to_one_account_and_is_enforced_at_acceptance() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let pk = Passkey::new();
    let commitment = hash32(b"account commitment of user 1");
    let relayer = env.relayer.insecure_clone();
    assert_ok(&enroll(&mut env, &pk, &t, commitment, &relayer));
    let e = enrolled(&env, &t, &commitment);
    assert_eq!(e.signer_key, pk.public);
    assert_eq!(e.status, PASSKEY_STATUS_ACTIVE);
    assert_eq!(e.kind, PASSKEY_KIND_ENROLLED);
    assert_eq!(e.generation, 1);
    assert_eq!(e.rp_id_hash, hash32(RP_ID.as_bytes()));

    // The same account cannot be enrolled twice (no silent replacement of its key).
    let intruder = Passkey::new();
    assert_failed(&enroll(&mut env, &intruder, &t, commitment, &relayer));
    assert_eq!(enrolled(&env, &t, &commitment).signer_key, pk.public);

    let enrollment = Some(enrollment_pda(&t.org, &commitment));
    let a = env.default_accept(1);
    assert_ok(&accept(
        &mut env,
        &pk,
        &t,
        &a,
        &Ceremony::default(),
        enrollment,
    ));
    // Another key cannot sign as this enrolled account.
    let a = env.default_accept(2);
    assert_stele_err(
        &accept(
            &mut env,
            &intruder,
            &t,
            &a,
            &Ceremony::default(),
            enrollment,
        ),
        SteleError::EnrollmentMismatch,
    );
    // An enrollment of another organization cannot be used.
    let other_owner = env.funded();
    let other_org = env.create_org(&other_owner, "Other Inc.", None);
    let relayer_pk = env.relayer.pubkey();
    let (other_shard, res) = env.create_shard(&other_owner, &other_org, 0, &relayer_pk);
    assert_ok(&res);
    let other = Target {
        org: other_org,
        shard: other_shard,
        ..t
    };
    let other_commitment = hash32(b"user at other org");
    assert_ok(&enroll(&mut env, &pk, &other, other_commitment, &relayer));
    let a = env.default_accept(3);
    assert_stele_err(
        &accept(
            &mut env,
            &pk,
            &t,
            &a,
            &Ceremony::default(),
            Some(enrollment_pda(&other_org, &other_commitment)),
        ),
        SteleError::EnrollmentMismatch,
    );
}

#[test]
fn only_a_designated_relayer_enrolls_and_only_with_the_new_keys_own_signature() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let pk = Passkey::new();
    let commitment = hash32(b"user 2");
    let stranger = env.funded();
    assert_stele_err(
        &enroll(&mut env, &pk, &t, commitment, &stranger),
        SteleError::UnauthorizedRelayer,
    );
    // An enrollment statement signed by another key than the one being enrolled is just a
    // signature by that other key: the program enrolls the key that actually signed.
    let relayer = env.relayer.insecure_clone();
    assert_ok(&enroll(&mut env, &pk, &t, commitment, &relayer));
    assert_eq!(enrolled(&env, &t, &commitment).signer_key, pk.public);
    // The zero commitment is refused.
    assert_stele_err(
        &enroll(&mut env, &Passkey::new(), &t, [0u8; 32], &relayer),
        SteleError::InvalidAccountCommitment,
    );
}

#[test]
fn rotation_needs_the_current_key_and_retires_it() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let old = Passkey::new();
    let new = Passkey::new();
    let commitment = hash32(b"user 3");
    let relayer = env.relayer.insecure_clone();
    assert_ok(&enroll(&mut env, &old, &t, commitment, &relayer));
    let enrollment = Some(enrollment_pda(&t.org, &commitment));
    let a = env.default_accept(1);
    assert_ok(&accept(
        &mut env,
        &old,
        &t,
        &a,
        &Ceremony::default(),
        enrollment,
    ));

    // Someone else's key cannot authorize a rotation.
    let attacker = Passkey::new();
    assert_stele_err(
        &rotate(&mut env, &attacker, &new, &t, commitment),
        SteleError::EnrollmentMismatch,
    );
    assert_ok(&rotate(&mut env, &old, &new, &t, commitment));
    let e = enrolled(&env, &t, &commitment);
    assert_eq!(e.signer_key, new.public);
    assert_eq!(e.previous_key, old.public);
    assert_eq!(e.kind, PASSKEY_KIND_ROTATED);
    assert_eq!(e.generation, 2);

    // After rotation the old key no longer signs for the account; the new one does.
    let a = env.default_accept(2);
    assert_stele_err(
        &accept(&mut env, &old, &t, &a, &Ceremony::default(), enrollment),
        SteleError::EnrollmentMismatch,
    );
    assert_ok(&accept(
        &mut env,
        &new,
        &t,
        &a,
        &Ceremony::default(),
        enrollment,
    ));
    // The same rotation cannot be replayed (its new key is already current), and the retired key
    // cannot rotate the account to yet another key.
    assert_stele_err(
        &rotate(&mut env, &old, &new, &t, commitment),
        SteleError::InvalidSignerKey,
    );
    assert_stele_err(
        &rotate(&mut env, &old, &Passkey::new(), &t, commitment),
        SteleError::EnrollmentMismatch,
    );
    // The acceptance signed by the old key before rotation stays recorded.
    assert_eq!(env.shard(&t.shard).accepted_count, 2);
}

#[test]
fn organization_recovery_is_explicit_and_needs_the_organizations_own_authority() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    let lost = Passkey::new();
    let replacement = Passkey::new();
    let commitment = hash32(b"user 4");
    let relayer = env.relayer.insecure_clone();
    assert_ok(&enroll(&mut env, &lost, &t, commitment, &relayer));

    // Neither the relayer (Stele) nor a stranger can recover an account's signer.
    assert_stele_err(
        &manage(&mut env, &relayer, &t, commitment, Some(&replacement)),
        SteleError::Unauthorized,
    );
    let stranger = env.funded();
    assert_stele_err(
        &manage(&mut env, &stranger, &t, commitment, Some(&replacement)),
        SteleError::Unauthorized,
    );
    // The organization owner can — and it is recorded as a recovery, not a rotation.
    assert_ok(&manage(
        &mut env,
        &fx.owner,
        &t,
        commitment,
        Some(&replacement),
    ));
    let e = enrolled(&env, &t, &commitment);
    assert_eq!(e.kind, PASSKEY_KIND_ORGANIZATION_RECOVERY);
    assert_eq!(e.previous_key, lost.public);
    assert_eq!(e.signer_key, replacement.public);
    let enrollment = Some(enrollment_pda(&t.org, &commitment));
    let a = env.default_accept(1);
    assert_stele_err(
        &accept(&mut env, &lost, &t, &a, &Ceremony::default(), enrollment),
        SteleError::EnrollmentMismatch,
    );
    assert_ok(&accept(
        &mut env,
        &replacement,
        &t,
        &a,
        &Ceremony::default(),
        enrollment,
    ));

    // An admin member can revoke; a revoked enrollment signs nothing.
    let admin = env.funded();
    assert_ok(&env.add_member(
        &fx.owner,
        &t.org,
        &admin.pubkey(),
        stele_core::constants::ROLE_ADMIN,
    ));
    assert_ok(&manage(&mut env, &admin, &t, commitment, None));
    assert_eq!(
        enrolled(&env, &t, &commitment).status,
        PASSKEY_STATUS_REVOKED
    );
    let a = env.default_accept(2);
    assert_stele_err(
        &accept(
            &mut env,
            &replacement,
            &t,
            &a,
            &Ceremony::default(),
            enrollment,
        ),
        SteleError::EnrollmentNotActive,
    );
    // Without the enrollment the key still produces a key-only acceptance (no account claim).
    assert_ok(&accept(
        &mut env,
        &replacement,
        &t,
        &a,
        &Ceremony::default(),
        None,
    ));
}

// ---- fee sponsorship ------------------------------------------------------------------------------

#[test]
fn a_sponsored_shard_reimburses_passkey_acceptances_exactly() {
    let mut env = Env::new();
    let fx = env.fixture();
    let t = fx.target;
    assert_ok(&env.enable_sponsorship(&fx.owner, &t.org, &t.shard, 50_000, 1_000_000));
    let funder = env.funded();
    env.deposit(&funder, &t.shard, 1_000_000_000);
    let pk = Passkey::new();
    let a = env.default_accept(1);
    let message = passkey_message(&env, &t, &pk.public, &a);
    let challenge = webauthn_challenge(PASSKEY_ACCEPTANCE_TAG, message.as_bytes());
    let assertion = assert_with(&pk, &challenge, &Ceremony::default());
    let relayer = env.relayer.pubkey();
    let rec = record_ix(&relayer, &t, &a, RP_ID, assertion.client_data.clone(), None);
    let relayer_before = env.lamports(&relayer);
    let shard_before = env.lamports(&t.shard);
    let meta = send(
        &mut env,
        &[
            cu_limit_ix(80_000),
            cu_price_ix(10_000),
            precompile(&pk.public, &assertion),
            rec,
        ],
    )
    .expect("sponsored passkey acceptance");
    println!(
        "sponsored record_passkey_acceptance: {} compute units",
        meta.compute_units_consumed
    );
    let paid = shard_before - env.lamports(&t.shard);
    // 2 signatures (relayer + secp256r1) × 5,000 + ceil(80,000 × 10,000 / 1e6).
    assert_eq!(paid, 10_800);
    assert_eq!(env.lamports(&relayer), relayer_before, "relayer made whole");
}
