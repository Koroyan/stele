//! Text encodings used in human-readable protocol artifacts.

const HEX: &[u8; 16] = b"0123456789abcdef";

/// Lowercase hexadecimal.
pub fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    push_hex_lower(&mut out, bytes);
    out
}

/// Appends lowercase hexadecimal to `out`.
pub fn push_hex_lower(out: &mut String, bytes: &[u8]) {
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
}

/// Solana-style base58 (Bitcoin alphabet) of a 32-byte public key.
pub fn base58_pubkey(bytes: &[u8; 32]) -> String {
    bs58::encode(bytes).into_string()
}

/// Appends the decimal representation of an unsigned integer.
pub fn push_u64(out: &mut String, mut value: u64) {
    if value == 0 {
        out.push('0');
        return;
    }
    let mut buf = [0u8; 20];
    let mut i = buf.len();
    while value > 0 {
        i -= 1;
        buf[i] = b'0' + (value % 10) as u8;
        value /= 10;
    }
    for &d in &buf[i..] {
        out.push(d as char);
    }
}

/// Appends a zero-padded decimal of exactly `width` digits (`value` must fit).
pub fn push_padded(out: &mut String, value: u64, width: usize) {
    let mut buf = [b'0'; 20];
    let mut v = value;
    let mut i = buf.len();
    while v > 0 {
        i -= 1;
        buf[i] = b'0' + (v % 10) as u8;
        v /= 10;
    }
    let start = buf.len().saturating_sub(width);
    for &d in &buf[start.min(i)..] {
        out.push(d as char);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_and_decimal() {
        assert_eq!(hex_lower(&[0x00, 0xab, 0xff]), "00abff");
        let mut s = String::new();
        push_u64(&mut s, 0);
        push_u64(&mut s, 4_294_967_295);
        assert_eq!(s, "04294967295");
        let mut p = String::new();
        push_padded(&mut p, 7, 2);
        push_padded(&mut p, 2026, 4);
        push_padded(&mut p, 0, 2);
        assert_eq!(p, "07202600");
    }

    #[test]
    fn base58_system_program() {
        assert_eq!(
            base58_pubkey(&[0u8; 32]),
            "11111111111111111111111111111111"
        );
    }
}
