//! SHA-256. On SBF targets `solana-sha256-hasher` uses the `sol_sha256` syscall; natively it uses
//! the `sha2` crate. Both produce standard FIPS 180-4 digests.

/// SHA-256 of a single byte slice.
pub fn sha256(data: &[u8]) -> [u8; 32] {
    solana_sha256_hasher::hash(data).to_bytes()
}

/// SHA-256 of the concatenation of several byte slices (no separators are inserted).
pub fn sha256v(parts: &[&[u8]]) -> [u8; 32] {
    solana_sha256_hasher::hashv(parts).to_bytes()
}

/// Hash used to derive a `DomainRecord` address: SHA-256 of the domain's UTF-8 bytes.
pub fn domain_hash(domain: &str) -> [u8; 32] {
    sha256(domain.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_known_vector() {
        // FIPS 180-4 example: SHA-256("abc").
        let expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assert_eq!(crate::encoding::hex_lower(&sha256(b"abc")), expected);
        assert_eq!(sha256v(&[b"a", b"bc"]), sha256(b"abc"));
    }
}
