//! Validation and construction errors.

use core::fmt;

/// Errors produced by protocol validation or construction. The on-chain program maps each
/// failure to a field-specific program error so callers learn *which* field was rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoreError {
    /// The value is empty.
    Empty,
    /// The value exceeds its byte limit.
    TooLong,
    /// The value contains a forbidden code point (PROTOCOL_SPEC.md §3.1) or a line break.
    ForbiddenCharacter,
    /// Leading, trailing or repeated spaces.
    InvalidWhitespace,
    /// The value does not match its required syntax.
    InvalidFormat,
    /// A timestamp is outside the representable range.
    InvalidTimestamp,
    /// The message does not start with the expected reconstruction.
    MessageMismatch,
    /// WebAuthn `clientDataJSON` is not an assertion for the expected challenge.
    InvalidClientData,
    /// The browser-attested origin is not the requesting site.
    OriginMismatch,
    /// The WebAuthn ceremony ran in a cross-origin frame.
    CrossOriginCeremony,
    /// WebAuthn authenticator data is malformed.
    InvalidAuthenticatorData,
    /// The relying party does not match or does not cover the requesting site.
    RelyingPartyMismatch,
    /// The authenticator did not report user presence and user verification.
    UserNotVerified,
    /// The signed client-data hash is not the hash of the supplied `clientDataJSON`.
    ClientDataHashMismatch,
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            CoreError::Empty => "value is empty",
            CoreError::TooLong => "value exceeds its length limit",
            CoreError::ForbiddenCharacter => "value contains a forbidden character",
            CoreError::InvalidWhitespace => "value has leading, trailing or repeated spaces",
            CoreError::InvalidFormat => "value has an invalid format",
            CoreError::InvalidTimestamp => "timestamp is out of range",
            CoreError::MessageMismatch => "message does not match the expected reconstruction",
            CoreError::InvalidClientData => {
                "client data is not an assertion for the expected challenge"
            }
            CoreError::OriginMismatch => "the browser origin is not the requesting site",
            CoreError::CrossOriginCeremony => "the passkey ceremony ran in a cross-origin frame",
            CoreError::InvalidAuthenticatorData => "authenticator data is malformed",
            CoreError::RelyingPartyMismatch => {
                "the relying party does not match the requesting site"
            }
            CoreError::UserNotVerified => "the authenticator did not verify the user",
            CoreError::ClientDataHashMismatch => "client data does not match the signed hash",
        };
        f.write_str(s)
    }
}

impl std::error::Error for CoreError {}
