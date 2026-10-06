//! `stele-version-v1` — the version JSON and its fingerprint (PROTOCOL_SPEC.md §5).
//!
//! The on-chain program calls [`version_hash`] during `publish_version` using only on-chain values
//! and validated arguments, so the fingerprint can never disagree with on-chain metadata.

use crate::constants::VERSION_FORMAT;
use crate::encoding::{base58_pubkey, push_hex_lower, push_u64};
use crate::hash::sha256;

/// Every input of the version fingerprint.
#[derive(Debug, Clone, Copy)]
pub struct VersionFields<'a> {
    pub chain_id: &'a str,
    pub program: &'a [u8; 32],
    pub organization: &'a [u8; 32],
    pub document: &'a [u8; 32],
    pub document_type: &'a str,
    pub locale: &'a str,
    /// Version number, ≥ 1.
    pub version: u32,
    /// `None` exactly for version 1.
    pub previous_version_hash: Option<&'a [u8; 32]>,
    pub title: &'a str,
    pub version_label: &'a str,
    /// `0` means "effective upon publication" and serializes as `null`.
    pub effective_at: i64,
    pub content_hash: &'a [u8; 32],
}

/// Appends `s` as a JSON string literal using RFC 8785 (JCS) escaping rules.
pub fn push_json_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\u{0C}' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => {
                const HEX: &[u8; 16] = b"0123456789abcdef";
                let v = c as u32;
                out.push_str("\\u00");
                out.push(HEX[((v >> 4) & 0xf) as usize] as char);
                out.push(HEX[(v & 0xf) as usize] as char);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

fn push_i64(out: &mut String, v: i64) {
    if v < 0 {
        out.push('-');
        push_u64(out, v.unsigned_abs());
    } else {
        push_u64(out, v as u64);
    }
}

/// Builds the canonical version JSON. Members are emitted in JCS (sorted) order.
pub fn version_json(f: &VersionFields<'_>) -> String {
    let mut s = String::with_capacity(640);
    s.push_str("{\"chainId\":");
    push_json_string(&mut s, f.chain_id);
    s.push_str(",\"contentHash\":\"");
    push_hex_lower(&mut s, f.content_hash);
    s.push_str("\",\"document\":\"");
    s.push_str(&base58_pubkey(f.document));
    s.push_str("\",\"documentType\":");
    push_json_string(&mut s, f.document_type);
    s.push_str(",\"effectiveAt\":");
    if f.effective_at == 0 {
        s.push_str("null");
    } else {
        push_i64(&mut s, f.effective_at);
    }
    s.push_str(",\"format\":\"");
    s.push_str(VERSION_FORMAT);
    s.push_str("\",\"locale\":");
    push_json_string(&mut s, f.locale);
    s.push_str(",\"organization\":\"");
    s.push_str(&base58_pubkey(f.organization));
    s.push_str("\",\"previousVersionHash\":");
    match f.previous_version_hash {
        None => s.push_str("null"),
        Some(h) => {
            s.push('"');
            push_hex_lower(&mut s, h);
            s.push('"');
        }
    }
    s.push_str(",\"program\":\"");
    s.push_str(&base58_pubkey(f.program));
    s.push_str("\",\"title\":");
    push_json_string(&mut s, f.title);
    s.push_str(",\"version\":");
    push_u64(&mut s, u64::from(f.version));
    s.push_str(",\"versionLabel\":");
    push_json_string(&mut s, f.version_label);
    s.push('}');
    s
}

/// The document fingerprint: SHA-256 of the canonical version JSON.
pub fn version_hash(f: &VersionFields<'_>) -> [u8; 32] {
    sha256(version_json(f).as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_escaping() {
        let mut s = String::new();
        push_json_string(&mut s, "a\"b\\c\nd\u{1}é");
        assert_eq!(s, "\"a\\\"b\\\\c\\nd\\u0001é\"");
    }

    #[test]
    fn version_json_shape() {
        let zero = [0u8; 32];
        let one = [1u8; 32];
        let f = VersionFields {
            chain_id: "solana:localnet",
            program: &one,
            organization: &one,
            document: &one,
            document_type: "terms-of-service",
            locale: "en-US",
            version: 1,
            previous_version_hash: None,
            title: "Terms of \"Service\"",
            version_label: "1.0",
            effective_at: 0,
            content_hash: &zero,
        };
        let json = version_json(&f);
        assert!(json.starts_with("{\"chainId\":\"solana:localnet\",\"contentHash\":\"0000"));
        assert!(json.contains("\"effectiveAt\":null,\"format\":\"stele-version-v1\""));
        assert!(json.contains("\"previousVersionHash\":null"));
        assert!(json.contains("\"title\":\"Terms of \\\"Service\\\"\""));
        assert!(json.ends_with("\"version\":1,\"versionLabel\":\"1.0\"}"));
        assert_eq!(version_hash(&f), sha256(json.as_bytes()));
    }
}
