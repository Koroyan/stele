//! PDA seeds (PROTOCOL_SPEC.md §2.3) and program-level constants.

pub const CONFIG_SEED: &[u8] = b"config";
pub const ORGANIZATION_SEED: &[u8] = b"organization";
pub const MEMBER_SEED: &[u8] = b"member";
pub const DOMAIN_SEED: &[u8] = b"domain";
pub const DOCUMENT_SEED: &[u8] = b"document";
pub const VERSION_SEED: &[u8] = b"version";
pub const NONCE_SHARD_SEED: &[u8] = b"nonce-shard";

/// Top-level instructions run at stack height 1.
pub const TRANSACTION_LEVEL_STACK_HEIGHT: usize = 1;

/// Canonical layout of a single-signature Ed25519 precompile instruction whose data is entirely
/// self-contained (`*_instruction_index == u16::MAX`).
pub const ED25519_PUBKEY_OFFSET: u16 = 16;
pub const ED25519_SIGNATURE_OFFSET: u16 = 48;
pub const ED25519_MESSAGE_OFFSET: u16 = 112;
pub const ED25519_SELF_INDEX: u16 = u16::MAX;

/// Seed of a passkey signer's enrollment: `[PASSKEY_SIGNER_SEED, organization, account_commitment]`.
pub const PASSKEY_SIGNER_SEED: &[u8] = b"passkey-signer";

/// Canonical layout of a single-signature secp256r1 precompile instruction whose data is entirely
/// self-contained, as `solana_secp256r1_program::new_secp256r1_instruction_with_signature` builds
/// it: 2-byte header, 14-byte offsets, 33-byte compressed key, 64-byte signature, message.
pub const SECP256R1_PUBKEY_OFFSET: u16 = 16;
pub const SECP256R1_SIGNATURE_OFFSET: u16 = 49;
pub const SECP256R1_MESSAGE_OFFSET: u16 = 113;
pub const SECP256R1_SELF_INDEX: u16 = u16::MAX;

/// Seed of a Stele Gate access pass: `[ACCESS_PASS_SEED, document, holder]`.
pub const ACCESS_PASS_SEED: &[u8] = b"access-pass";

/// Seed of a Stele Gate policy: `[POLICY_SEED, document]` (one policy per document).
pub const POLICY_SEED: &[u8] = b"policy";

/// Seed of a Stele Gate passport: `[PASSPORT_SEED, holder]` (one per wallet, every document).
pub const PASSPORT_SEED: &[u8] = b"passport";
