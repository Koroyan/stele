use core::fmt;

/// Canonicalization and canonical-form verification errors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CanonError {
    /// Text contains a forbidden code point (value is the code point).
    ForbiddenCharacter(u32),
    /// Text is empty after normalization.
    EmptyText,
    /// A size limit was exceeded (description names the limit).
    LimitExceeded(&'static str),
    /// The JSON does not match the `stele-content-v1` model.
    InvalidStructure(String),
    /// The bytes are not valid JSON.
    InvalidJson(String),
    /// Text inside stored content is not in canonical form.
    NonCanonicalText,
    /// Stored bytes differ from their canonical re-serialization.
    NonCanonicalBytes,
}

impl fmt::Display for CanonError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CanonError::ForbiddenCharacter(cp) => write!(f, "forbidden character U+{cp:04X}"),
            CanonError::EmptyText => f.write_str("text is empty after normalization"),
            CanonError::LimitExceeded(what) => write!(f, "limit exceeded: {what}"),
            CanonError::InvalidStructure(why) => write!(f, "invalid content structure: {why}"),
            CanonError::InvalidJson(why) => write!(f, "invalid JSON: {why}"),
            CanonError::NonCanonicalText => f.write_str("text is not in canonical form"),
            CanonError::NonCanonicalBytes => {
                f.write_str("bytes are not the canonical serialization")
            }
        }
    }
}

impl std::error::Error for CanonError {}
