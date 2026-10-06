//! `stele/2` native passkey signatures (PROTOCOL_SPEC.md §17).
//!
//! A WebAuthn ES256 (P-256) credential signs through the platform authenticator — Face ID, Touch
//! ID, Windows Hello, a phone or a security key — and its private key never leaves it. Solana's
//! `secp256r1` precompile verifies the signature; the Stele program and every verifier then apply
//! exactly the rules in this module to bind that signature to an acceptance:
//!
//! * the acceptance message (`stele-acceptance-v2`) is rebuilt from on-chain state and names the
//!   signer as `passkey-p256 <compressed public key in hex>`;
//! * the WebAuthn challenge is `SHA-256(tag ‖ message)`, with a distinct tag per statement kind;
//! * the precompile-verified bytes are `authenticatorData ‖ SHA-256(clientDataJSON)` — exactly
//!   what a WebAuthn assertion signs;
//! * `clientDataJSON` must begin with the serialization browsers produce for
//!   `navigator.credentials.get()` naming that challenge and the requesting site's origin, and must
//!   not be a cross-origin (embedded) ceremony;
//! * the authenticator data must name the relying party and carry both the user-present and the
//!   user-verified flags.
//!
//! The origin in `clientDataJSON` is written by the browser, not by page scripts, which is what
//! makes "Requested by" browser-attested in this mode (stele/1 wallet signatures have no such
//! attestation). A non-browser client that talks to an authenticator directly can write any
//! origin; the guarantee is as strong as the user's browser.

use crate::constants::{MAX_REQUEST_DOMAIN_LEN, MESSAGE_STATEMENT, REQUESTED_BY_PREFIX};
use crate::encoding::{base58_pubkey, push_hex_lower, push_u64};
use crate::error::CoreError;
use crate::hash::{sha256, sha256v};
use crate::message::push_organization_line;
use crate::time::format_rfc3339;
use crate::validate::{validate_hostname, validate_request_domain};

/// Compressed SEC1 P-256 public key.
pub const P256_PUBLIC_KEY_LEN: usize = 33;
/// Compact `r ‖ s` signature (the precompile requires low-S).
pub const P256_SIGNATURE_LEN: usize = 64;
/// Upper bound for `clientDataJSON` (browsers produce ~120–260 bytes).
pub const MAX_CLIENT_DATA_LEN: usize = 512;
/// `rpIdHash ‖ flags ‖ signCount`.
pub const AUTHENTICATOR_DATA_MIN_LEN: usize = 37;
/// Longest relying-party ID accepted (same limit as request domains).
pub const MAX_RP_ID_LEN: usize = MAX_REQUEST_DOMAIN_LEN;

pub const FLAG_USER_PRESENT: u8 = 0x01;
pub const FLAG_USER_VERIFIED: u8 = 0x04;
pub const FLAG_ATTESTED_CREDENTIAL_DATA: u8 = 0x40;
pub const FLAG_EXTENSION_DATA: u8 = 0x80;

/// First line of the `stele-acceptance-v2` message.
pub const PASSKEY_MESSAGE_HEADER: &str = "Stele Protocol v2 - Accept Agreement";
/// Algorithm label of P-256 passkey signers in messages and statements.
pub const P256_SIGNER_LABEL: &str = "passkey-p256";

pub const PASSKEY_ACCEPTANCE_TAG: &[u8] = b"stele:v2:passkey-acceptance\x00";
pub const PASSKEY_ACCEPTANCE_ID_TAG: &[u8] = b"stele:v2:passkey-acceptance-id\x00";
pub const PASSKEY_ENROLL_TAG: &[u8] = b"stele:v2:passkey-enroll\x00";
pub const PASSKEY_ROTATE_TAG: &[u8] = b"stele:v2:passkey-rotate\x00";

pub const ENROLL_HEADER: &str = "Stele Protocol v2 - Enroll Passkey Signer";
pub const ROTATE_HEADER: &str = "Stele Protocol v2 - Rotate Passkey Signer";

/// Every input of the `stele-acceptance-v2` message except the request domain.
#[derive(Debug, Clone, Copy)]
pub struct PasskeyAcceptanceFields<'a> {
    pub org_name: &'a str,
    /// The organization's verified domain **if it is valid at recording time**, else `None`.
    pub org_verified_domain: Option<&'a str>,
    pub title: &'a str,
    pub version_label: &'a str,
    pub version: u32,
    pub version_hash: &'a [u8; 32],
    pub signer: &'a [u8; P256_PUBLIC_KEY_LEN],
    pub network_label: &'a str,
    pub issued_at: i64,
    pub expires_at: i64,
    pub shard_id: u16,
    pub nonce_index: u32,
    pub nonce_tag: &'a [u8; 8],
}

fn push_signer(m: &mut String, key: &[u8; P256_PUBLIC_KEY_LEN]) {
    m.push_str(P256_SIGNER_LABEL);
    m.push(' ');
    push_hex_lower(m, key);
}

/// The complete `stele-acceptance-v2` message for a validated request domain:
///
/// ```text
/// Stele Protocol v2 - Accept Agreement
/// I accept the exact document version below.
/// Organization: <name> (verified: <domain>) | (unverified)
/// Document: <title>
/// Version: <label> (#<n>)
/// Fingerprint: <64 hex>
/// Signer: passkey-p256 <66 hex>
/// Network: <label>
/// Issued: <RFC 3339>
/// Expires: <RFC 3339>
/// Nonce: <shard>-<index>-<16 hex>
/// Requested by: <hostname>
/// ```
pub fn passkey_acceptance_message(
    f: &PasskeyAcceptanceFields<'_>,
    request_domain: &str,
) -> Result<String, CoreError> {
    validate_request_domain(request_domain)?;
    let issued = format_rfc3339(f.issued_at)?;
    let expires = format_rfc3339(f.expires_at)?;
    let mut m = String::with_capacity(700);
    m.push_str(PASSKEY_MESSAGE_HEADER);
    m.push('\n');
    m.push_str(MESSAGE_STATEMENT);
    push_organization_line(&mut m, f.org_name, f.org_verified_domain);
    m.push_str("\nDocument: ");
    m.push_str(f.title);
    m.push_str("\nVersion: ");
    m.push_str(f.version_label);
    m.push_str(" (#");
    push_u64(&mut m, u64::from(f.version));
    m.push_str(")\nFingerprint: ");
    push_hex_lower(&mut m, f.version_hash);
    m.push_str("\nSigner: ");
    push_signer(&mut m, f.signer);
    m.push_str("\nNetwork: ");
    m.push_str(f.network_label);
    m.push_str("\nIssued: ");
    m.push_str(&issued);
    m.push_str("\nExpires: ");
    m.push_str(&expires);
    m.push_str("\nNonce: ");
    push_u64(&mut m, u64::from(f.shard_id));
    m.push('-');
    push_u64(&mut m, u64::from(f.nonce_index));
    m.push('-');
    push_hex_lower(&mut m, f.nonce_tag);
    m.push('\n');
    m.push_str(REQUESTED_BY_PREFIX);
    m.push_str(request_domain);
    Ok(m)
}

/// Statement a new passkey signs to enroll under an organization and an account commitment.
#[allow(clippy::too_many_arguments)]
pub fn enrollment_statement(
    organization: &[u8; 32],
    account_commitment: &[u8; 32],
    signer: &[u8; P256_PUBLIC_KEY_LEN],
    rp_id: &str,
    network_label: &str,
    issued_at: i64,
    expires_at: i64,
) -> Result<String, CoreError> {
    validate_rp_id(rp_id)?;
    let mut m = String::with_capacity(400);
    m.push_str(ENROLL_HEADER);
    m.push_str("\nOrganization: ");
    m.push_str(&base58_pubkey(organization));
    m.push_str("\nAccount commitment: ");
    push_hex_lower(&mut m, account_commitment);
    m.push_str("\nSigner: ");
    push_signer(&mut m, signer);
    m.push_str("\nRelying party: ");
    m.push_str(rp_id);
    m.push_str("\nNetwork: ");
    m.push_str(network_label);
    m.push_str("\nIssued: ");
    m.push_str(&format_rfc3339(issued_at)?);
    m.push_str("\nExpires: ");
    m.push_str(&format_rfc3339(expires_at)?);
    Ok(m)
}

/// Statement the current passkey signs to hand its enrollment over to a new key.
#[allow(clippy::too_many_arguments)]
pub fn rotation_statement(
    organization: &[u8; 32],
    account_commitment: &[u8; 32],
    previous: &[u8; P256_PUBLIC_KEY_LEN],
    next: &[u8; P256_PUBLIC_KEY_LEN],
    network_label: &str,
    issued_at: i64,
    expires_at: i64,
) -> Result<String, CoreError> {
    let mut m = String::with_capacity(400);
    m.push_str(ROTATE_HEADER);
    m.push_str("\nOrganization: ");
    m.push_str(&base58_pubkey(organization));
    m.push_str("\nAccount commitment: ");
    push_hex_lower(&mut m, account_commitment);
    m.push_str("\nPrevious signer: ");
    push_signer(&mut m, previous);
    m.push_str("\nNew signer: ");
    push_signer(&mut m, next);
    m.push_str("\nNetwork: ");
    m.push_str(network_label);
    m.push_str("\nIssued: ");
    m.push_str(&format_rfc3339(issued_at)?);
    m.push_str("\nExpires: ");
    m.push_str(&format_rfc3339(expires_at)?);
    Ok(m)
}

/// The WebAuthn challenge for `message` under a statement-kind `tag`.
pub fn webauthn_challenge(tag: &[u8], message: &[u8]) -> [u8; 32] {
    sha256v(&[tag, message])
}

/// `H("stele:v2:passkey-acceptance-id\0" ‖ version ‖ signer ‖ message_hash ‖ signature)`.
pub fn passkey_acceptance_id(
    version: &[u8; 32],
    signer: &[u8; P256_PUBLIC_KEY_LEN],
    message_hash: &[u8; 32],
    signature: &[u8; P256_SIGNATURE_LEN],
) -> [u8; 32] {
    sha256v(&[
        PASSKEY_ACCEPTANCE_ID_TAG,
        version,
        signer,
        message_hash,
        signature,
    ])
}

/// A compressed SEC1 point prefix (the precompile checks that the point is on the curve).
pub fn is_compressed_p256_key(key: &[u8; P256_PUBLIC_KEY_LEN]) -> bool {
    key[0] == 0x02 || key[0] == 0x03
}

/// A WebAuthn relying-party ID: a hostname (no scheme, port or trailing dot).
pub fn validate_rp_id(rp_id: &str) -> Result<(), CoreError> {
    validate_hostname(rp_id, MAX_RP_ID_LEN, true)
}

/// Whether `rp_id` may serve `request_domain` (equal, or a parent at a label boundary). Browsers
/// additionally refuse public suffixes as relying parties.
pub fn rp_id_covers(rp_id: &str, request_domain: &str) -> bool {
    if rp_id == request_domain {
        return true;
    }
    request_domain.len() > rp_id.len() + 1
        && request_domain.ends_with(rp_id)
        && request_domain.as_bytes()[request_domain.len() - rp_id.len() - 1] == b'.'
}

const B64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Unpadded base64url, as WebAuthn encodes the challenge in `clientDataJSON`.
pub fn base64url(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        let chars = chunk.len() + 1;
        for i in 0..chars {
            out.push(B64URL[((n >> (18 - 6 * i)) & 0x3f) as usize] as char);
        }
    }
    out
}

/// Whether `origin` is the browser origin of a page on `request_domain`: `https://<domain>`, or
/// `http://localhost[:port]` for local development.
pub fn origin_matches(origin: &str, request_domain: &str) -> bool {
    if let Some(host) = origin.strip_prefix("https://") {
        return host == request_domain;
    }
    if request_domain == "localhost" {
        if let Some(rest) = origin.strip_prefix("http://localhost") {
            return match rest.strip_prefix(':') {
                None => rest.is_empty(),
                Some(port) => {
                    !port.is_empty()
                        && port.len() <= 5
                        && port.bytes().all(|b| b.is_ascii_digit())
                        && !port.starts_with('0')
                }
            };
        }
    }
    false
}

/// Checks `clientDataJSON` of an assertion: `{"type":"webauthn.get","challenge":"<b64url>",
/// "origin":"<origin>"` exactly as browsers serialize it, an origin of the requesting site, and no
/// cross-origin ceremony. Returns the origin.
pub fn check_client_data<'a>(
    client_data: &'a [u8],
    challenge: &[u8; 32],
    request_domain: &str,
) -> Result<&'a str, CoreError> {
    if client_data.len() > MAX_CLIENT_DATA_LEN {
        return Err(CoreError::InvalidClientData);
    }
    let text = core::str::from_utf8(client_data).map_err(|_| CoreError::InvalidClientData)?;
    let mut expected = String::with_capacity(80);
    expected.push_str("{\"type\":\"webauthn.get\",\"challenge\":\"");
    expected.push_str(&base64url(challenge));
    expected.push_str("\",\"origin\":\"");
    let rest = text
        .strip_prefix(expected.as_str())
        .ok_or(CoreError::InvalidClientData)?;
    let end = rest.find('"').ok_or(CoreError::InvalidClientData)?;
    let origin = &rest[..end];
    if origin.contains('\\') || !origin_matches(origin, request_domain) {
        return Err(CoreError::OriginMismatch);
    }
    let tail = &rest[end + 1..];
    if !(tail == "}" || tail.starts_with(',')) {
        return Err(CoreError::InvalidClientData);
    }
    // Browsers serialize crossOrigin right after origin; an embedded (cross-origin) ceremony is
    // refused, as is any topOrigin (present only for cross-origin ceremonies).
    if let Some(value) = tail.strip_prefix(",\"crossOrigin\":") {
        if !value.starts_with("false") {
            return Err(CoreError::CrossOriginCeremony);
        }
    }
    if tail.contains("\"topOrigin\"") || tail.contains("\"crossOrigin\":true") {
        return Err(CoreError::CrossOriginCeremony);
    }
    Ok(origin)
}

/// Checks assertion authenticator data: the relying party, user presence and user verification,
/// no attested credential data, and extension data only when flagged. Returns the flags.
pub fn check_authenticator_data(authenticator_data: &[u8], rp_id: &str) -> Result<u8, CoreError> {
    if authenticator_data.len() < AUTHENTICATOR_DATA_MIN_LEN {
        return Err(CoreError::InvalidAuthenticatorData);
    }
    if authenticator_data[..32] != sha256(rp_id.as_bytes()) {
        return Err(CoreError::RelyingPartyMismatch);
    }
    let flags = authenticator_data[32];
    if flags & FLAG_USER_PRESENT == 0 || flags & FLAG_USER_VERIFIED == 0 {
        return Err(CoreError::UserNotVerified);
    }
    if flags & FLAG_ATTESTED_CREDENTIAL_DATA != 0 {
        return Err(CoreError::InvalidAuthenticatorData);
    }
    let has_extensions = authenticator_data.len() > AUTHENTICATOR_DATA_MIN_LEN;
    if has_extensions != (flags & FLAG_EXTENSION_DATA != 0) {
        return Err(CoreError::InvalidAuthenticatorData);
    }
    Ok(flags)
}

/// What a verified WebAuthn assertion established.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssertionFacts<'a> {
    pub authenticator_data: &'a [u8],
    pub client_data_hash: [u8; 32],
    pub origin: &'a str,
    pub flags: u8,
}

/// Binds precompile-verified bytes (`authenticatorData ‖ SHA-256(clientDataJSON)`) to `challenge`,
/// the requesting site and the relying party.
pub fn check_assertion<'a>(
    signed: &'a [u8],
    client_data: &'a [u8],
    challenge: &[u8; 32],
    request_domain: &str,
    rp_id: &str,
) -> Result<AssertionFacts<'a>, CoreError> {
    validate_request_domain(request_domain)?;
    validate_rp_id(rp_id)?;
    if !rp_id_covers(rp_id, request_domain) {
        return Err(CoreError::RelyingPartyMismatch);
    }
    if signed.len() < AUTHENTICATOR_DATA_MIN_LEN + 32 {
        return Err(CoreError::InvalidAuthenticatorData);
    }
    let (authenticator_data, hash) = signed.split_at(signed.len() - 32);
    let client_data_hash = sha256(client_data);
    if hash != client_data_hash {
        return Err(CoreError::ClientDataHashMismatch);
    }
    let origin = check_client_data(client_data, challenge, request_domain)?;
    let flags = check_authenticator_data(authenticator_data, rp_id)?;
    Ok(AssertionFacts {
        authenticator_data,
        client_data_hash,
        origin,
        flags,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: [u8; 33] = {
        let mut k = [0x11u8; 33];
        k[0] = 0x02;
        k
    };

    fn fields<'a>(hash: &'a [u8; 32], tag: &'a [u8; 8]) -> PasskeyAcceptanceFields<'a> {
        PasskeyAcceptanceFields {
            org_name: "Acme Inc.",
            org_verified_domain: Some("acme.example"),
            title: "Terms of Service",
            version_label: "3.2",
            version: 3,
            version_hash: hash,
            signer: &KEY,
            network_label: "Solana Devnet",
            issued_at: 1_790_000_000,
            expires_at: 1_790_000_600,
            shard_id: 0,
            nonce_index: 42,
            nonce_tag: tag,
        }
    }

    fn client_data(challenge: &[u8; 32], origin: &str, tail: &str) -> Vec<u8> {
        format!(
            "{{\"type\":\"webauthn.get\",\"challenge\":\"{}\",\"origin\":\"{origin}\"{tail}",
            base64url(challenge)
        )
        .into_bytes()
    }

    fn auth_data(rp_id: &str, flags: u8) -> Vec<u8> {
        let mut a = sha256(rp_id.as_bytes()).to_vec();
        a.push(flags);
        a.extend_from_slice(&[0, 0, 0, 7]);
        a
    }

    #[test]
    fn message_layout() {
        let hash = [0xab; 32];
        let tag = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef];
        let m = passkey_acceptance_message(&fields(&hash, &tag), "shop.acme.example").unwrap();
        let expected = format!(
            "Stele Protocol v2 - Accept Agreement\n\
             I accept the exact document version below.\n\
             Organization: Acme Inc. (verified: acme.example)\n\
             Document: Terms of Service\n\
             Version: 3.2 (#3)\n\
             Fingerprint: {}\n\
             Signer: passkey-p256 02{}\n\
             Network: Solana Devnet\n\
             Issued: 2026-09-21T14:13:20Z\n\
             Expires: 2026-09-21T14:23:20Z\n\
             Nonce: 0-42-0123456789abcdef\n\
             Requested by: shop.acme.example",
            "ab".repeat(32),
            "11".repeat(32)
        );
        assert_eq!(m, expected);
        assert!(passkey_acceptance_message(&fields(&hash, &tag), "evil.example\nx").is_err());
    }

    #[test]
    fn base64url_matches_rfc4648() {
        assert_eq!(base64url(b""), "");
        assert_eq!(base64url(b"f"), "Zg");
        assert_eq!(base64url(b"fo"), "Zm8");
        assert_eq!(base64url(b"foo"), "Zm9v");
        assert_eq!(base64url(b"foob"), "Zm9vYg");
        assert_eq!(base64url(&[0xfb, 0xff]), "-_8");
        assert_eq!(base64url(&[0u8; 32]).len(), 43);
    }

    #[test]
    fn origins() {
        assert!(origin_matches(
            "https://shop.acme.example",
            "shop.acme.example"
        ));
        assert!(!origin_matches(
            "http://shop.acme.example",
            "shop.acme.example"
        ));
        assert!(!origin_matches(
            "https://shop.acme.example:8443",
            "shop.acme.example"
        ));
        assert!(!origin_matches("https://evil.example", "shop.acme.example"));
        assert!(origin_matches("http://localhost", "localhost"));
        assert!(origin_matches("http://localhost:3000", "localhost"));
        assert!(!origin_matches("http://localhost:03000", "localhost"));
        assert!(!origin_matches("http://localhost:", "localhost"));
        assert!(!origin_matches(
            "http://localhost.evil.example",
            "localhost"
        ));
        assert!(rp_id_covers("acme.example", "shop.acme.example"));
        assert!(rp_id_covers("acme.example", "acme.example"));
        assert!(!rp_id_covers("acme.example", "evilacme.example"));
        assert!(!rp_id_covers("shop.acme.example", "acme.example"));
    }

    #[test]
    fn client_data_rules() {
        let challenge = [7u8; 32];
        let ok = client_data(
            &challenge,
            "https://shop.acme.example",
            ",\"crossOrigin\":false}",
        );
        assert_eq!(
            check_client_data(&ok, &challenge, "shop.acme.example"),
            Ok("https://shop.acme.example")
        );
        // Older browsers omit crossOrigin; extra keys after it are allowed.
        let bare = client_data(&challenge, "https://shop.acme.example", "}");
        assert!(check_client_data(&bare, &challenge, "shop.acme.example").is_ok());
        let extra = client_data(
            &challenge,
            "https://shop.acme.example",
            ",\"crossOrigin\":false,\"other_keys_can_be_added_here\":\"x\"}",
        );
        assert!(check_client_data(&extra, &challenge, "shop.acme.example").is_ok());

        let wrong_challenge = client_data(&[8u8; 32], "https://shop.acme.example", "}");
        assert_eq!(
            check_client_data(&wrong_challenge, &challenge, "shop.acme.example"),
            Err(CoreError::InvalidClientData)
        );
        let create = String::from_utf8(ok.clone())
            .unwrap()
            .replace("webauthn.get", "webauthn.create")
            .into_bytes();
        assert!(check_client_data(&create, &challenge, "shop.acme.example").is_err());
        let wrong_origin = client_data(&challenge, "https://evil.example", "}");
        assert_eq!(
            check_client_data(&wrong_origin, &challenge, "shop.acme.example"),
            Err(CoreError::OriginMismatch)
        );
        let cross = client_data(
            &challenge,
            "https://shop.acme.example",
            ",\"crossOrigin\":true}",
        );
        assert_eq!(
            check_client_data(&cross, &challenge, "shop.acme.example"),
            Err(CoreError::CrossOriginCeremony)
        );
        let top = client_data(
            &challenge,
            "https://shop.acme.example",
            ",\"x\":1,\"topOrigin\":\"https://evil.example\"}",
        );
        assert_eq!(
            check_client_data(&top, &challenge, "shop.acme.example"),
            Err(CoreError::CrossOriginCeremony)
        );
        let glued = client_data(&challenge, "https://shop.acme.example", "x}");
        assert!(check_client_data(&glued, &challenge, "shop.acme.example").is_err());
        let escaped = client_data(&challenge, "https://shop.acme.example\\", "}");
        assert!(check_client_data(&escaped, &challenge, "shop.acme.example").is_err());
        let spaced = String::from_utf8(ok.clone())
            .unwrap()
            .replace("\"type\":", "\"type\": ")
            .into_bytes();
        assert!(check_client_data(&spaced, &challenge, "shop.acme.example").is_err());
        let long = client_data(&challenge, "https://shop.acme.example", &"}".repeat(600));
        assert!(check_client_data(&long, &challenge, "shop.acme.example").is_err());
    }

    #[test]
    fn authenticator_data_rules() {
        let uv = FLAG_USER_PRESENT | FLAG_USER_VERIFIED;
        assert_eq!(
            check_authenticator_data(&auth_data("acme.example", uv), "acme.example"),
            Ok(uv)
        );
        assert_eq!(
            check_authenticator_data(&auth_data("evil.example", uv), "acme.example"),
            Err(CoreError::RelyingPartyMismatch)
        );
        for flags in [FLAG_USER_PRESENT, FLAG_USER_VERIFIED, 0] {
            assert_eq!(
                check_authenticator_data(&auth_data("acme.example", flags), "acme.example"),
                Err(CoreError::UserNotVerified)
            );
        }
        assert!(check_authenticator_data(
            &auth_data("acme.example", uv | FLAG_ATTESTED_CREDENTIAL_DATA),
            "acme.example"
        )
        .is_err());
        let mut with_ext = auth_data("acme.example", uv);
        with_ext.extend_from_slice(&[0xa0]);
        assert!(check_authenticator_data(&with_ext, "acme.example").is_err());
        let mut flagged = auth_data("acme.example", uv | FLAG_EXTENSION_DATA);
        flagged.extend_from_slice(&[0xa0]);
        assert!(check_authenticator_data(&flagged, "acme.example").is_ok());
        assert!(check_authenticator_data(&[0u8; 36], "acme.example").is_err());
    }

    #[test]
    fn assertion_binding() {
        let challenge = [3u8; 32];
        let cd = client_data(
            &challenge,
            "https://shop.acme.example",
            ",\"crossOrigin\":false}",
        );
        let mut signed = auth_data("acme.example", FLAG_USER_PRESENT | FLAG_USER_VERIFIED);
        signed.extend_from_slice(&sha256(&cd));
        let facts = check_assertion(
            &signed,
            &cd,
            &challenge,
            "shop.acme.example",
            "acme.example",
        )
        .unwrap();
        assert_eq!(facts.origin, "https://shop.acme.example");
        assert_eq!(facts.client_data_hash, sha256(&cd));

        // Client data that is not the one hashed into the signed bytes.
        let other = client_data(&challenge, "https://shop.acme.example", "}");
        assert_eq!(
            check_assertion(
                &signed,
                &other,
                &challenge,
                "shop.acme.example",
                "acme.example"
            ),
            Err(CoreError::ClientDataHashMismatch)
        );
        // Relying party that does not cover the requesting site.
        assert_eq!(
            check_assertion(
                &signed,
                &cd,
                &challenge,
                "shop.acme.example",
                "other.example"
            ),
            Err(CoreError::RelyingPartyMismatch)
        );
        // Truncated signed bytes.
        assert!(check_assertion(
            &signed[..60],
            &cd,
            &challenge,
            "shop.acme.example",
            "acme.example"
        )
        .is_err());
    }

    #[test]
    fn statements_and_ids_are_domain_separated() {
        let org = [1u8; 32];
        let commitment = [2u8; 32];
        let next = {
            let mut k = [0x22u8; 33];
            k[0] = 0x03;
            k
        };
        let enroll = enrollment_statement(
            &org,
            &commitment,
            &KEY,
            "acme.example",
            "Solana Devnet",
            1_790_000_000,
            1_790_000_600,
        )
        .unwrap();
        assert!(enroll.starts_with("Stele Protocol v2 - Enroll Passkey Signer\nOrganization: "));
        assert!(enroll.contains(&format!("\nSigner: passkey-p256 02{}\n", "11".repeat(32))));
        let rotate = rotation_statement(
            &org,
            &commitment,
            &KEY,
            &next,
            "Solana Devnet",
            1_790_000_000,
            1_790_000_600,
        )
        .unwrap();
        assert!(rotate.contains("\nNew signer: passkey-p256 03"));
        let a = webauthn_challenge(PASSKEY_ACCEPTANCE_TAG, enroll.as_bytes());
        let b = webauthn_challenge(PASSKEY_ENROLL_TAG, enroll.as_bytes());
        assert_ne!(a, b);
        assert!(is_compressed_p256_key(&KEY));
        assert!(!is_compressed_p256_key(&[4u8; 33]));
        let id = passkey_acceptance_id(&[0u8; 32], &KEY, &[1u8; 32], &[2u8; 64]);
        assert_ne!(id, [0u8; 32]);
    }
}
