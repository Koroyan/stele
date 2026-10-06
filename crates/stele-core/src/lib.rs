//! # stele-core
//!
//! The single Rust implementation of the Stele protocol rules that must be identical everywhere:
//! field validation, the `stele-version-v1` fingerprint, the `stele-acceptance-v1` message,
//! RFC 3339 formatting, acceptance identifiers and the shard accumulator.
//!
//! This crate is used **on-chain** by the `stele` program (hashing uses the `sol_sha256` syscall on
//! SBF targets) and **off-chain** by tooling and tests. Every function is deterministic and
//! allocation-bounded by the protocol's field limits.
//!
//! The normative definition is `PROTOCOL_SPEC.md`; cross-language agreement with the TypeScript
//! implementation is enforced by the JSON vectors in `spec/test-vectors/`.

#![forbid(unsafe_code)]

pub mod acceptance;
pub mod batch;
pub mod constants;
pub mod encoding;
pub mod error;
pub mod fees;
pub mod hash;
pub mod message;
pub mod passkey;
pub mod proof;
pub mod text;
pub mod time;
pub mod validate;
pub mod version;

pub use error::CoreError;
