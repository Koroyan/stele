//! Text normalization (PROTOCOL_SPEC.md §4.2).

use stele_core::text::is_forbidden;
use unicode_normalization::UnicodeNormalization;

use crate::error::CanonError;

/// Replaces runs of U+0020 with one space and trims leading/trailing U+0020.
fn collapse_spaces(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut pending_space = false;
    for c in line.chars() {
        if c == ' ' {
            if !out.is_empty() {
                pending_space = true;
            }
        } else {
            if pending_space {
                out.push(' ');
                pending_space = false;
            }
            out.push(c);
        }
    }
    out
}

/// `normalize_text` — multi-line text (paragraphs, change summary).
pub fn normalize_text(input: &str) -> Result<String, CanonError> {
    // 1. Strip one leading BOM.
    let s = input.strip_prefix('\u{FEFF}').unwrap_or(input);

    // 2. Line endings → LF; 3. TAB → space.
    let mut unified = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                unified.push('\n');
            }
            '\u{0085}' | '\u{2028}' | '\u{2029}' => unified.push('\n'),
            '\t' => unified.push(' '),
            other => unified.push(other),
        }
    }

    // 4. NFC.
    let nfc: String = unified.nfc().collect();

    // 5. Reject forbidden code points.
    if let Some(c) = nfc.chars().find(|c| is_forbidden(*c)) {
        return Err(CanonError::ForbiddenCharacter(c as u32));
    }

    // 6–8. Collapse/trim each line, drop empty lines, join with LF.
    let mut out = String::with_capacity(nfc.len());
    for line in nfc.split('\n') {
        let collapsed = collapse_spaces(line);
        if collapsed.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&collapsed);
    }

    // 9. Reject empty.
    if out.is_empty() {
        return Err(CanonError::EmptyText);
    }
    Ok(out)
}

/// `normalize_inline` — single-line text (headings, list items).
pub fn normalize_inline(input: &str) -> Result<String, CanonError> {
    Ok(normalize_text(input)?.replace('\n', " "))
}

/// Whether `s` is already canonical multi-line text.
pub fn is_canonical_text(s: &str) -> bool {
    normalize_text(s).map(|n| n == s).unwrap_or(false)
}

/// Whether `s` is already canonical single-line text.
pub fn is_canonical_inline(s: &str) -> bool {
    normalize_inline(s).map(|n| n == s).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_endings_whitespace_and_bom() {
        assert_eq!(
            normalize_text("\u{FEFF}  Hello\t\tworld  \r\n\r\n\rSecond   line \u{2028}Third")
                .unwrap(),
            "Hello world\nSecond line\nThird"
        );
    }

    #[test]
    fn nfc_composition() {
        // "é" as e + COMBINING ACUTE ACCENT composes to U+00E9.
        assert_eq!(
            normalize_text("Caf\u{0065}\u{0301}").unwrap(),
            "Caf\u{00E9}"
        );
    }

    #[test]
    fn forbidden_and_empty() {
        assert_eq!(
            normalize_text("pay \u{202E}0001\u{202C} USD"),
            Err(CanonError::ForbiddenCharacter(0x202E))
        );
        assert_eq!(
            normalize_text("a\u{200B}b"),
            Err(CanonError::ForbiddenCharacter(0x200B))
        );
        assert_eq!(normalize_text(" \r\n\t "), Err(CanonError::EmptyText));
        assert_eq!(normalize_text("x\u{0085}y").unwrap(), "x\ny");
    }

    #[test]
    fn inline() {
        assert_eq!(normalize_inline("  Section\n 1 ").unwrap(), "Section 1");
        assert!(is_canonical_inline("Section 1"));
        assert!(!is_canonical_inline("Section  1"));
        assert!(is_canonical_text("a\nb"));
        assert!(!is_canonical_text("a\n\nb"));
    }
}
