//! `stele-acceptance-v1` — the human-readable acceptance message (PROTOCOL_SPEC.md §7).
//!
//! The on-chain program rebuilds the message **prefix** (lines 1–11 plus `Requested by: `) from
//! on-chain state and its own arguments, requires the Ed25519-verified message to start with it,
//! and validates the remainder as a hostname. Because hostnames cannot contain line breaks, the
//! signed bytes are fully determined by on-chain state, arguments and the validated domain.

use crate::constants::*;
use crate::encoding::{base58_pubkey, push_hex_lower, push_u64};
use crate::error::CoreError;
use crate::time::format_rfc3339;
use crate::validate::validate_request_domain;

/// Every input of the acceptance message except the request domain.
#[derive(Debug, Clone, Copy)]
pub struct AcceptanceMessageFields<'a> {
    pub org_name: &'a str,
    /// The organization's verified domain **if it is valid at recording time**, else `None`.
    pub org_verified_domain: Option<&'a str>,
    pub title: &'a str,
    pub version_label: &'a str,
    pub version: u32,
    pub version_hash: &'a [u8; 32],
    pub signer: &'a [u8; 32],
    pub network_label: &'a str,
    pub issued_at: i64,
    pub expires_at: i64,
    pub shard_id: u16,
    pub nonce_index: u32,
    pub nonce_tag: &'a [u8; 8],
}

/// Lines 1–11 followed by `\nRequested by: ` (everything before the request domain).
pub fn acceptance_message_prefix(f: &AcceptanceMessageFields<'_>) -> Result<String, CoreError> {
    let issued = format_rfc3339(f.issued_at)?;
    let expires = format_rfc3339(f.expires_at)?;
    let mut m = String::with_capacity(640);
    m.push_str(MESSAGE_HEADER);
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
    m.push_str("\nAccount: ");
    m.push_str(&base58_pubkey(f.signer));
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
    Ok(m)
}

/// Appends `\nOrganization: <name> (verified: <domain>)` or `... (unverified)`.
pub(crate) fn push_organization_line(m: &mut String, name: &str, verified_domain: Option<&str>) {
    m.push_str("\nOrganization: ");
    m.push_str(name);
    match verified_domain {
        Some(domain) if !domain.is_empty() => {
            m.push_str(" (verified: ");
            m.push_str(domain);
            m.push(')');
        }
        _ => m.push_str(" (unverified)"),
    }
}

/// The complete message for a validated request domain.
pub fn acceptance_message(
    f: &AcceptanceMessageFields<'_>,
    request_domain: &str,
) -> Result<String, CoreError> {
    validate_request_domain(request_domain)?;
    let mut m = acceptance_message_prefix(f)?;
    m.push_str(request_domain);
    Ok(m)
}

/// Checks that `message` starts with `prefix` and returns the validated request domain that
/// follows it. This is the only part of the signed message not reconstructed from state.
pub fn extract_request_domain<'m>(message: &'m [u8], prefix: &[u8]) -> Result<&'m str, CoreError> {
    let rest = message
        .strip_prefix(prefix)
        .ok_or(CoreError::MessageMismatch)?;
    let domain = core::str::from_utf8(rest).map_err(|_| CoreError::MessageMismatch)?;
    validate_request_domain(domain)?;
    Ok(domain)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fields<'a>(
        hash: &'a [u8; 32],
        signer: &'a [u8; 32],
        tag: &'a [u8; 8],
    ) -> AcceptanceMessageFields<'a> {
        AcceptanceMessageFields {
            org_name: "Acme Inc.",
            org_verified_domain: Some("acme.example"),
            title: "Terms of Service",
            version_label: "3.2",
            version: 3,
            version_hash: hash,
            signer,
            network_label: "Solana Devnet",
            issued_at: 1_790_000_000,
            expires_at: 1_790_000_600,
            shard_id: 0,
            nonce_index: 42,
            nonce_tag: tag,
        }
    }

    #[test]
    fn full_message_layout() {
        let hash = [0xab; 32];
        let signer = [0u8; 32];
        let tag = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef];
        let m = acceptance_message(&fields(&hash, &signer, &tag), "app.acme.example").unwrap();
        let expected = format!(
            "Stele Protocol v1 - Accept Agreement\n\
             I accept the exact document version below.\n\
             Organization: Acme Inc. (verified: acme.example)\n\
             Document: Terms of Service\n\
             Version: 3.2 (#3)\n\
             Fingerprint: {}\n\
             Account: 11111111111111111111111111111111\n\
             Network: Solana Devnet\n\
             Issued: 2026-09-21T14:13:20Z\n\
             Expires: 2026-09-21T14:23:20Z\n\
             Nonce: 0-42-0123456789abcdef\n\
             Requested by: app.acme.example",
            "ab".repeat(32)
        );
        assert_eq!(m, expected);
        assert!(!m.ends_with('\n'));
    }

    #[test]
    fn unverified_and_extraction() {
        let hash = [7u8; 32];
        let signer = [9u8; 32];
        let tag = [0u8; 8];
        let mut f = fields(&hash, &signer, &tag);
        f.org_verified_domain = None;
        let prefix = acceptance_message_prefix(&f).unwrap();
        assert!(prefix.contains("Organization: Acme Inc. (unverified)\n"));
        assert!(prefix.ends_with("\nRequested by: "));
        let msg = format!("{prefix}localhost");
        assert_eq!(
            extract_request_domain(msg.as_bytes(), prefix.as_bytes()).unwrap(),
            "localhost"
        );
        let injected = format!("{prefix}evil.example\nOrganization: Other");
        assert!(extract_request_domain(injected.as_bytes(), prefix.as_bytes()).is_err());
        assert_eq!(
            extract_request_domain(b"Stele Protocol v2", prefix.as_bytes()),
            Err(CoreError::MessageMismatch)
        );
    }
}
