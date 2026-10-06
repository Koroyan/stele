//! `stele-proof-v1` — signed records of business events other than document acceptance
//! (PROTOCOL_SPEC.md §12).
//!
//! A proof anchors the SHA-256 of an off-chain **statement** (for example a purchase: merchant,
//! order reference, items, totals, the policy versions in force) together with a runtime-verified
//! Ed25519 signature over a short, human-readable **anchor message**. As with acceptances, the
//! program rebuilds every line of the anchor message except the request domain from on-chain state
//! and its own arguments, so the signed bytes are fully determined and cannot be swapped.
//!
//! The statement itself never goes on-chain: it can contain personal or commercially sensitive
//! data. It carries a random salt so its hash cannot be brute-forced from guessable contents.

use crate::constants::{PROOF_HEADER, PROOF_ID_TAG, PROOF_STATEMENT_LINE, REQUESTED_BY_PREFIX};
use crate::encoding::{base58_pubkey, push_hex_lower, push_u64};
use crate::error::CoreError;
use crate::hash::sha256v;
use crate::message::push_organization_line;
use crate::time::format_rfc3339;
use crate::validate::validate_request_domain;

/// Proof types as `(code, name)`. `0` is reserved for document acceptance, which has its own
/// instruction and message (`record_acceptance`). Codes are part of the protocol and never reused.
pub const PROOF_TYPES: [(u8, &str); 17] = [
    (1, "PURCHASE"),
    (2, "SALE"),
    (3, "ORDER"),
    (4, "PAYMENT"),
    (5, "RECEIPT"),
    (6, "INVOICE"),
    (7, "REFUND"),
    (8, "CANCELLATION"),
    (9, "DELIVERY"),
    (10, "RETURN"),
    (11, "WARRANTY"),
    (12, "SUBSCRIPTION_START"),
    (13, "SUBSCRIPTION_CANCEL"),
    (14, "QUOTE_ACCEPTANCE"),
    (15, "CONTRACT"),
    (16, "CONSENT"),
    (17, "POLICY_ACCEPTANCE"),
];

/// The label shown on the `Type:` line, or `None` for an unknown or reserved code.
///
/// A `match` rather than a lookup in a table of string slices: on SBF a table of `&str` is
/// relocated data, and the program must not depend on how the loader resolves it.
pub fn proof_type_label(proof_type: u8) -> Option<&'static str> {
    Some(match proof_type {
        1 => "Purchase",
        2 => "Sale",
        3 => "Order",
        4 => "Payment",
        5 => "Receipt",
        6 => "Invoice",
        7 => "Refund",
        8 => "Cancellation",
        9 => "Delivery",
        10 => "Return",
        11 => "Warranty",
        12 => "Subscription start",
        13 => "Subscription cancellation",
        14 => "Quote acceptance",
        15 => "Contract",
        16 => "Consent",
        17 => "Policy acceptance",
        _ => return None,
    })
}

/// Every input of the anchor message except the request domain.
#[derive(Debug, Clone, Copy)]
pub struct ProofMessageFields<'a> {
    pub proof_type: u8,
    pub org_name: &'a str,
    /// The organization's verified domain **if it is valid at recording time**, else `None`.
    pub org_verified_domain: Option<&'a str>,
    pub organization: &'a [u8; 32],
    pub statement_hash: &'a [u8; 32],
    pub signer: &'a [u8; 32],
    pub network_label: &'a str,
    pub chain_id: &'a str,
    pub issued_at: i64,
    pub expires_at: i64,
    pub shard_id: u16,
    pub nonce_index: u32,
    pub nonce_tag: &'a [u8; 8],
}

/// Lines 1–12 followed by `\nRequested by: ` (everything before the request domain).
pub fn proof_message_prefix(f: &ProofMessageFields<'_>) -> Result<String, CoreError> {
    let label = proof_type_label(f.proof_type).ok_or(CoreError::InvalidFormat)?;
    let issued = format_rfc3339(f.issued_at)?;
    let expires = format_rfc3339(f.expires_at)?;
    let mut m = String::with_capacity(660);
    m.push_str(PROOF_HEADER);
    m.push('\n');
    m.push_str(PROOF_STATEMENT_LINE);
    m.push_str("\nType: ");
    m.push_str(label);
    push_organization_line(&mut m, f.org_name, f.org_verified_domain);
    m.push_str("\nOrganization ID: ");
    m.push_str(&base58_pubkey(f.organization));
    m.push_str("\nStatement: ");
    push_hex_lower(&mut m, f.statement_hash);
    m.push_str("\nAccount: ");
    m.push_str(&base58_pubkey(f.signer));
    m.push_str("\nNetwork: ");
    m.push_str(f.network_label);
    m.push_str("\nChain: ");
    m.push_str(f.chain_id);
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

/// The complete anchor message for a validated request domain.
pub fn proof_message(
    f: &ProofMessageFields<'_>,
    request_domain: &str,
) -> Result<String, CoreError> {
    validate_request_domain(request_domain)?;
    let mut m = proof_message_prefix(f)?;
    m.push_str(request_domain);
    Ok(m)
}

/// `proof_id = H("stele:v1:proof\0" || organization || signer || statement_hash || message_hash || signature)`.
pub fn proof_id(
    organization: &[u8; 32],
    signer: &[u8; 32],
    statement_hash: &[u8; 32],
    message_hash: &[u8; 32],
    signature: &[u8; 64],
) -> [u8; 32] {
    sha256v(&[
        PROOF_ID_TAG,
        organization,
        signer,
        statement_hash,
        message_hash,
        signature,
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message::extract_request_domain;

    fn fields<'a>(
        org: &'a [u8; 32],
        statement: &'a [u8; 32],
        signer: &'a [u8; 32],
        tag: &'a [u8; 8],
    ) -> ProofMessageFields<'a> {
        ProofMessageFields {
            proof_type: 1,
            org_name: "Northwind Shop",
            org_verified_domain: Some("northwind.example"),
            organization: org,
            statement_hash: statement,
            signer,
            network_label: "Solana Devnet",
            chain_id: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
            issued_at: 1_790_000_000,
            expires_at: 1_790_000_600,
            shard_id: 0,
            nonce_index: 7,
            nonce_tag: tag,
        }
    }

    #[test]
    fn full_message_layout() {
        let org = [0u8; 32];
        let statement = [0xcd; 32];
        let signer = [0u8; 32];
        let tag = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef];
        let m = proof_message(&fields(&org, &statement, &signer, &tag), "shop.example").unwrap();
        let expected = format!(
            "Stele Protocol v1 - Record Proof\n\
             I confirm the statement identified below.\n\
             Type: Purchase\n\
             Organization: Northwind Shop (verified: northwind.example)\n\
             Organization ID: 11111111111111111111111111111111\n\
             Statement: {}\n\
             Account: 11111111111111111111111111111111\n\
             Network: Solana Devnet\n\
             Chain: solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1\n\
             Issued: 2026-09-21T14:13:20Z\n\
             Expires: 2026-09-21T14:23:20Z\n\
             Nonce: 0-7-0123456789abcdef\n\
             Requested by: shop.example",
            "cd".repeat(32)
        );
        assert_eq!(m, expected);
    }

    #[test]
    fn types_and_extraction() {
        let org = [1u8; 32];
        let statement = [2u8; 32];
        let signer = [3u8; 32];
        let tag = [0u8; 8];
        let mut f = fields(&org, &statement, &signer, &tag);
        for (code, name) in PROOF_TYPES {
            f.proof_type = code;
            let label = proof_type_label(code).unwrap();
            // The label is the name in sentence case ("SUBSCRIPTION_CANCEL" reads as
            // "Subscription cancellation").
            let normalized = label.to_uppercase().replace(' ', "_");
            assert!(normalized.starts_with(name), "{name} -> {label}");
            let p = proof_message_prefix(&f).unwrap();
            assert!(p.contains(&format!("\nType: {label}\n")));
        }
        assert_eq!(
            PROOF_TYPES.len(),
            (1..=255u8)
                .filter(|c| proof_type_label(*c).is_some())
                .count()
        );
        for reserved in [0u8, 18, 255] {
            f.proof_type = reserved;
            assert_eq!(proof_message_prefix(&f), Err(CoreError::InvalidFormat));
        }
        f.proof_type = 7;
        f.org_verified_domain = None;
        let prefix = proof_message_prefix(&f).unwrap();
        assert!(prefix.contains("Organization: Northwind Shop (unverified)\n"));
        let msg = format!("{prefix}localhost");
        assert_eq!(
            extract_request_domain(msg.as_bytes(), prefix.as_bytes()).unwrap(),
            "localhost"
        );
    }

    #[test]
    fn worst_case_length() {
        let org = [0xff; 32];
        let statement = [0xff; 32];
        let signer = [0xff; 32];
        let tag = [0xff; 8];
        let mut f = fields(&org, &statement, &signer, &tag);
        let name = "N".repeat(40);
        let domain = format!("{}.example", "d".repeat(40));
        f.proof_type = 13;
        f.org_name = &name;
        f.org_verified_domain = Some(&domain);
        f.network_label = "Solana Localnet!";
        f.shard_id = u16::MAX;
        f.nonce_index = 65_535;
        let request = format!("{}.example", "r".repeat(40));
        let m = proof_message(&f, &request).unwrap();
        assert!(m.len() <= 660, "anchor message is {} bytes", m.len());
    }

    #[test]
    fn proof_ids_bind_every_input() {
        let a = [1u8; 32];
        let b = [2u8; 32];
        let base = proof_id(&a, &a, &a, &a, &[0u8; 64]);
        assert_ne!(base, proof_id(&b, &a, &a, &a, &[0u8; 64]));
        assert_ne!(base, proof_id(&a, &b, &a, &a, &[0u8; 64]));
        assert_ne!(base, proof_id(&a, &a, &b, &a, &[0u8; 64]));
        assert_ne!(base, proof_id(&a, &a, &a, &b, &[0u8; 64]));
        assert_ne!(base, proof_id(&a, &a, &a, &a, &[1u8; 64]));
    }
}
