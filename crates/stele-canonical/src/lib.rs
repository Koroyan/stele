//! # stele-canonical
//!
//! Rust reference implementation of `stele-canonical-v1` (PROTOCOL_SPEC.md §4): text
//! normalization, the `stele-content-v1` model, RFC 8785 serialization and the content hash.
//!
//! It mirrors `@stele/protocol` (TypeScript) exactly; both are tested against the shared vectors in
//! `spec/test-vectors/`. Canonicalization happens **once**, at authoring time. Verification hashes
//! the stored canonical bytes and checks that they are canonical — it never re-normalizes text a
//! user saw.

#![forbid(unsafe_code)]

mod content;
mod error;
mod normalize;

pub use content::{
    content_hash, parse_canonical, Attachment, Block, Content, ALLOWED_MEDIA_TYPES,
    MAX_ATTACHMENTS, MAX_ATTACHMENT_SIZE, MAX_BLOCKS, MAX_CANONICAL_BYTES,
    MAX_CHANGE_SUMMARY_BYTES, MAX_HEADING_BYTES, MAX_LIST_ITEMS, MAX_LIST_ITEM_BYTES,
    MAX_PARAGRAPH_BYTES,
};
pub use error::CanonError;
pub use normalize::{is_canonical_inline, is_canonical_text, normalize_inline, normalize_text};
