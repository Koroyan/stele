//! Field validation (PROTOCOL_SPEC.md §3). Validation never repairs input: a value is either
//! exactly acceptable or rejected.

use crate::constants::*;
use crate::error::CoreError;
use crate::text::{is_forbidden, is_line_break_or_tab};

/// Display strings: organization names and document titles (§3.2).
pub fn validate_display_string(s: &str, max_len: usize) -> Result<(), CoreError> {
    if s.is_empty() {
        return Err(CoreError::Empty);
    }
    if s.len() > max_len {
        return Err(CoreError::TooLong);
    }
    if s.chars()
        .any(|c| is_forbidden(c) || is_line_break_or_tab(c))
    {
        return Err(CoreError::ForbiddenCharacter);
    }
    if s.starts_with(' ') || s.ends_with(' ') || s.contains("  ") {
        return Err(CoreError::InvalidWhitespace);
    }
    Ok(())
}

pub fn validate_org_name(s: &str) -> Result<(), CoreError> {
    validate_display_string(s, MAX_ORG_NAME_LEN)
}

pub fn validate_title(s: &str) -> Result<(), CoreError> {
    validate_display_string(s, MAX_TITLE_LEN)
}

/// `^[a-z0-9]+(-[a-z0-9]+)*$` with a byte limit.
fn validate_kebab(s: &str, max_len: usize) -> Result<(), CoreError> {
    if s.is_empty() {
        return Err(CoreError::Empty);
    }
    if s.len() > max_len {
        return Err(CoreError::TooLong);
    }
    let bytes = s.as_bytes();
    if bytes[0] == b'-' || bytes[bytes.len() - 1] == b'-' || s.contains("--") {
        return Err(CoreError::InvalidFormat);
    }
    if !bytes
        .iter()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
    {
        return Err(CoreError::InvalidFormat);
    }
    Ok(())
}

pub fn validate_slug(s: &str) -> Result<(), CoreError> {
    validate_kebab(s, MAX_SLUG_LEN)
}

pub fn validate_document_type(s: &str) -> Result<(), CoreError> {
    validate_kebab(s, MAX_DOCUMENT_TYPE_LEN)
}

/// `^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$`, ≤ 16 bytes.
pub fn validate_locale(s: &str) -> Result<(), CoreError> {
    if s.is_empty() {
        return Err(CoreError::Empty);
    }
    if s.len() > MAX_LOCALE_LEN {
        return Err(CoreError::TooLong);
    }
    let mut parts = s.split('-');
    let language = parts.next().ok_or(CoreError::InvalidFormat)?;
    if !(2..=3).contains(&language.len()) || !language.bytes().all(|b| b.is_ascii_lowercase()) {
        return Err(CoreError::InvalidFormat);
    }
    let mut next = parts.next();
    if let Some(script) = next {
        if script.len() == 4 {
            let b = script.as_bytes();
            if !(b[0].is_ascii_uppercase() && b[1..].iter().all(|c| c.is_ascii_lowercase())) {
                return Err(CoreError::InvalidFormat);
            }
            next = parts.next();
        }
    }
    if let Some(region) = next {
        let ok = (region.len() == 2 && region.bytes().all(|b| b.is_ascii_uppercase()))
            || (region.len() == 3 && region.bytes().all(|b| b.is_ascii_digit()));
        if !ok {
            return Err(CoreError::InvalidFormat);
        }
    }
    if parts.next().is_some() {
        return Err(CoreError::InvalidFormat);
    }
    Ok(())
}

/// `^[A-Za-z0-9][A-Za-z0-9._+-]{0,15}$`.
pub fn validate_version_label(s: &str) -> Result<(), CoreError> {
    if s.is_empty() {
        return Err(CoreError::Empty);
    }
    if s.len() > MAX_VERSION_LABEL_LEN {
        return Err(CoreError::TooLong);
    }
    let b = s.as_bytes();
    if !b[0].is_ascii_alphanumeric() {
        return Err(CoreError::InvalidFormat);
    }
    if !b
        .iter()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'+' | b'-'))
    {
        return Err(CoreError::InvalidFormat);
    }
    Ok(())
}

/// Printable ASCII with an allow-listed scheme and a non-empty remainder.
pub fn validate_storage_uri(s: &str) -> Result<(), CoreError> {
    if s.is_empty() {
        return Err(CoreError::Empty);
    }
    if s.len() > MAX_STORAGE_URI_LEN {
        return Err(CoreError::TooLong);
    }
    if !s.bytes().all(|b| (0x21..=0x7e).contains(&b)) {
        return Err(CoreError::InvalidFormat);
    }
    let rest = ["ar://", "ipfs://", "https://"]
        .iter()
        .find_map(|p| s.strip_prefix(p))
        .ok_or(CoreError::InvalidFormat)?;
    if rest.is_empty() {
        return Err(CoreError::InvalidFormat);
    }
    Ok(())
}

/// Hostname per §3.4. `allow_localhost` is true only for request domains.
pub fn validate_hostname(s: &str, max_len: usize, allow_localhost: bool) -> Result<(), CoreError> {
    if s.is_empty() {
        return Err(CoreError::Empty);
    }
    if s.len() > max_len {
        return Err(CoreError::TooLong);
    }
    if s == "localhost" {
        return if allow_localhost {
            Ok(())
        } else {
            Err(CoreError::InvalidFormat)
        };
    }
    let mut labels = 0usize;
    let mut last: &str = "";
    for label in s.split('.') {
        let b = label.as_bytes();
        if b.is_empty() || b.len() > 63 {
            return Err(CoreError::InvalidFormat);
        }
        if b[0] == b'-' || b[b.len() - 1] == b'-' {
            return Err(CoreError::InvalidFormat);
        }
        if !b
            .iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
        {
            return Err(CoreError::InvalidFormat);
        }
        labels += 1;
        last = label;
    }
    if labels < 2 || last.bytes().all(|c| c.is_ascii_digit()) {
        return Err(CoreError::InvalidFormat);
    }
    Ok(())
}

pub fn validate_verified_domain(s: &str) -> Result<(), CoreError> {
    validate_hostname(s, MAX_VERIFIED_DOMAIN_LEN, false)
}

pub fn validate_request_domain(s: &str) -> Result<(), CoreError> {
    validate_hostname(s, MAX_REQUEST_DOMAIN_LEN, true)
}

/// `^solana:[A-Za-z0-9]{1,32}$`.
pub fn validate_chain_id(s: &str) -> Result<(), CoreError> {
    if s.len() > MAX_CHAIN_ID_LEN {
        return Err(CoreError::TooLong);
    }
    let rest = s.strip_prefix("solana:").ok_or(CoreError::InvalidFormat)?;
    if rest.is_empty() || !rest.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(CoreError::InvalidFormat);
    }
    Ok(())
}

/// 1–16 bytes of `[A-Za-z0-9 ]`, no leading, trailing or repeated spaces.
pub fn validate_network_label(s: &str) -> Result<(), CoreError> {
    if s.is_empty() {
        return Err(CoreError::Empty);
    }
    if s.len() > MAX_NETWORK_LABEL_LEN {
        return Err(CoreError::TooLong);
    }
    if !s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b' ') {
        return Err(CoreError::InvalidFormat);
    }
    if s.starts_with(' ') || s.ends_with(' ') || s.contains("  ") {
        return Err(CoreError::InvalidWhitespace);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_strings() {
        assert!(validate_org_name("Acme Inc.").is_ok());
        assert!(validate_org_name("株式会社アクメ").is_ok());
        assert_eq!(validate_org_name(""), Err(CoreError::Empty));
        assert_eq!(
            validate_org_name(" Acme"),
            Err(CoreError::InvalidWhitespace)
        );
        assert_eq!(
            validate_org_name("Acme  Inc"),
            Err(CoreError::InvalidWhitespace)
        );
        assert_eq!(
            validate_org_name("Acme\nInc"),
            Err(CoreError::ForbiddenCharacter)
        );
        assert_eq!(
            validate_org_name("Acme\u{202E}cnI"),
            Err(CoreError::ForbiddenCharacter)
        );
        assert_eq!(validate_org_name(&"a".repeat(41)), Err(CoreError::TooLong));
        assert!(validate_title(&"é".repeat(30)).is_ok()); // 60 bytes
        assert_eq!(validate_title(&"é".repeat(31)), Err(CoreError::TooLong));
    }

    #[test]
    fn identifiers() {
        assert!(validate_slug("terms-of-service").is_ok());
        assert!(validate_slug("tos2").is_ok());
        assert!(validate_slug("-tos").is_err());
        assert!(validate_slug("tos-").is_err());
        assert!(validate_slug("terms--of").is_err());
        assert!(validate_slug("Terms").is_err());
        assert!(validate_slug("terms_of").is_err());
        assert!(validate_locale("en").is_ok());
        assert!(validate_locale("en-US").is_ok());
        assert!(validate_locale("zh-Hant-TW").is_ok());
        assert!(validate_locale("es-419").is_ok());
        assert!(validate_locale("sr-Latn").is_ok());
        assert!(validate_locale("EN").is_err());
        assert!(validate_locale("en-us").is_err());
        assert!(validate_locale("en-US-x").is_err());
        assert!(validate_locale("e").is_err());
        assert!(validate_version_label("3.2").is_ok());
        assert!(validate_version_label("v1.0.0-rc.1").is_ok());
        assert!(validate_version_label("2026.09+eu").is_ok());
        assert!(validate_version_label(".1").is_err());
        assert!(validate_version_label("1 0").is_err());
        assert!(validate_version_label("12345678901234567").is_err());
    }

    #[test]
    fn hostnames() {
        assert!(validate_verified_domain("acme.example").is_ok());
        assert!(validate_verified_domain("xn--80ak6aa92e.com").is_ok());
        assert!(validate_verified_domain("localhost").is_err());
        assert!(validate_request_domain("localhost").is_ok());
        assert!(validate_request_domain("app.acme.example").is_ok());
        assert!(validate_request_domain("Acme.example").is_err());
        assert!(validate_request_domain("acme").is_err());
        assert!(validate_request_domain("acme.example.").is_err());
        assert!(validate_request_domain("-acme.example").is_err());
        assert!(validate_request_domain("acme.example:443").is_err());
        assert!(validate_request_domain("10.0.0.1").is_err());
        assert!(validate_request_domain("acme.example\nEvil: x").is_err());
    }

    #[test]
    fn misc() {
        assert!(validate_storage_uri("ar://abc").is_ok());
        assert!(validate_storage_uri("https://cdn.example/x").is_ok());
        assert!(validate_storage_uri("http://cdn.example/x").is_err());
        assert!(validate_storage_uri("javascript:alert(1)").is_err());
        assert!(validate_storage_uri("ar://").is_err());
        assert!(validate_storage_uri("ar://a b").is_err());
        assert!(validate_chain_id("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp").is_ok());
        assert!(validate_chain_id("solana:localnet").is_ok());
        assert!(validate_chain_id("eip155:1").is_err());
        assert!(validate_chain_id("solana:").is_err());
        assert!(validate_network_label("Solana Mainnet").is_ok());
        assert!(validate_network_label("Solana  Mainnet").is_err());
        assert!(validate_network_label("Solana-Mainnet").is_err());
    }
}
