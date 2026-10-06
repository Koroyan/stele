//! The forbidden code point set `F` (PROTOCOL_SPEC.md §3.1).
//!
//! These code points are invisible, direction-altering, control, private-use or non-characters.
//! They are rejected everywhere text becomes evidence, which defeats "Trojan Source" bidi attacks,
//! invisible-text smuggling and visually ambiguous hashes.

/// Returns `true` if `c` belongs to the forbidden set `F`.
///
/// Note: U+0009 (TAB), U+000A (LF) and U+000D (CR) are *not* in `F`; they are handled by content
/// normalization. Single-line fields reject them separately (see [`is_line_break_or_tab`]).
pub fn is_forbidden(c: char) -> bool {
    let cp = c as u32;
    if (cp & 0xFFFE) == 0xFFFE {
        // U+xFFFE / U+xFFFF noncharacters in every plane.
        return true;
    }
    matches!(
        cp,
        0x0000..=0x0008
            | 0x000B
            | 0x000C
            | 0x000E..=0x001F
            | 0x007F..=0x009F
            | 0x00AD
            | 0x034F
            | 0x115F
            | 0x1160
            | 0x17B4
            | 0x17B5
            | 0x180E
            | 0x200B
            | 0x202A..=0x202E
            | 0x2060..=0x206F
            | 0x3164
            | 0xE000..=0xF8FF
            | 0xFDD0..=0xFDEF
            | 0xFEFF
            | 0xFFA0
            | 0xFFF9..=0xFFFD
            | 0x1D173..=0x1D17A
            | 0xE0000..=0xE007F
            | 0xF0000..=0xFFFFD
            | 0x100000..=0x10FFFD
    )
}

/// TAB, LF, CR, LINE SEPARATOR, PARAGRAPH SEPARATOR — never allowed in single-line fields.
pub fn is_line_break_or_tab(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forbidden_samples() {
        for c in [
            '\u{0000}',
            '\u{0007}',
            '\u{000B}',
            '\u{001F}',
            '\u{007F}',
            '\u{0085}',
            '\u{009F}',
            '\u{00AD}',
            '\u{200B}',
            '\u{202A}',
            '\u{202E}',
            '\u{2066}',
            '\u{2069}',
            '\u{2060}',
            '\u{FEFF}',
            '\u{FFFD}',
            '\u{E000}',
            '\u{F8FF}',
            '\u{FDD0}',
            '\u{FFFE}',
            '\u{1FFFF}',
            '\u{E0041}',
            '\u{F0000}',
            '\u{10FFFD}',
        ] {
            assert!(is_forbidden(c), "U+{:04X} should be forbidden", c as u32);
        }
    }

    #[test]
    fn allowed_samples() {
        for c in [
            'a', 'Z', ' ', '\t', '\n', '\r', 'é', 'ß', '中', 'ع', 'א', '\u{200C}', '\u{200D}',
            '\u{200E}', '\u{200F}', '\u{061C}', '\u{FE0F}', '😀', '\u{00A0}', '\u{3000}',
        ] {
            assert!(!is_forbidden(c), "U+{:04X} should be allowed", c as u32);
        }
    }
}
