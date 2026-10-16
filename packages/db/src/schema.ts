/**
 * PostgreSQL schema for the Stele platform.
 *
 * THIS DATABASE IS AN INDEX AND A CACHE, NEVER EVIDENCE. Every on-chain fact stored here
 * (organizations, versions, acceptances) can be rebuilt from Solana and content storage, and every
 * receipt shown to users is re-verified against the chain. Secrets are stored only as hashes
 * (session tokens, API keys) or encrypted with a key that is not in the database (webhook secrets).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

// ---- identity & sessions -------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletAddress: text("wallet_address").notNull().unique(),
  displayName: text("display_name"),
  email: text("email"),
  createdAt: createdAt(),
  lastLoginAt: ts("last_login_at"),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the session token; the token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    csrfTokenHash: text("csrf_token_hash").notNull(),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    /** Absolute expiry. */
    expiresAt: ts("expires_at").notNull(),
    /** Time of the last fresh wallet signature (step-up authentication for sensitive actions). */
    reauthenticatedAt: ts("reauthenticated_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const authChallenges = pgTable("auth_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletAddress: text("wallet_address").notNull(),
  nonce: text("nonce").notNull().unique(),
  message: text("message").notNull(),
  issuedAt: ts("issued_at").notNull(),
  expiresAt: ts("expires_at").notNull(),
  consumedAt: ts("consumed_at"),
});

// ---- organizations (mirror of on-chain state + off-chain settings) --------------------------------

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  address: text("address").notNull().unique(),
  creatorAddress: text("creator_address").notNull(),
  name: text("name").notNull(),
  ownerAddress: text("owner_address").notNull(),
  recoveryAddress: text("recovery_address"),
  verifiedDomain: text("verified_domain"),
  domainVerifiedAt: ts("domain_verified_at"),
  domainExpiresAt: ts("domain_expires_at"),
  frozen: boolean("frozen").notNull().default(false),
  frozenBy: integer("frozen_by").notNull().default(0),
  /** Off-chain settings: e.g. { requireAcceptanceSessions: boolean }. */
  settings: jsonb("settings").$type<OrganizationSettings>().notNull().default({}),
  chainSyncedAt: ts("chain_synced_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const SIGNING_POLICIES = [
  "WALLET_ONLY",
  "PASSKEY_ONLY",
  "WALLET_OR_PASSKEY",
  "ACCOUNT_AND_PASSKEY",
] as const;
export type SigningPolicy = (typeof SIGNING_POLICIES)[number];

export interface OrganizationSettings {
  /** Require a server-issued acceptance session token to open an acceptance challenge. */
  requireAcceptanceSessions?: boolean;
  /** Extra hosts allowed to request acceptances (beyond the verified domain and Stele's host). */
  allowedRequestDomains?: string[];
  /**
   * How users may sign. Default WALLET_ONLY (the behavior before walletless signing existed).
   * ACCOUNT_AND_PASSKEY = passkey-protected key bound to the organization's own user account
   * (acceptance session with externalUserRef required).
   */
  signingPolicy?: SigningPolicy;
  /**
   * Where Stele Gate records a wallet's acceptance: "passport" (Gate v3, default: one account per
   * wallet for every document) or "pass" (Gate v2: one AccessPass per document and wallet).
   */
  gateStorage?: "passport" | "pass";
  /** Who pays network fees: Stele's relayer (quota) or the organization's sponsored shard. */
  feeSponsor?: "stele" | "organization";
  /** When the organization's sponsorship cannot pay, Stele may pay within its quota. */
  sponsorFallbackToStele?: boolean;
  /** Alert when a sponsored shard's spendable balance drops below this (lamports). */
  sponsorLowBalanceLamports?: number;
  /**
   * How acceptances are anchored (PROTOCOL_SPEC.md §17.9). DIRECT_ONCHAIN (default): one
   * transaction per acceptance, signature verified by the program. MERKLE_BATCHED: the relayer
   * verifies signatures off-chain and anchors Merkle roots; verifiers re-check each signature.
   */
  evidenceMode?: "DIRECT_ONCHAIN" | "MERKLE_BATCHED";
  /**
   * Which Stele products the organization uses (chosen at onboarding, changeable later). Proof —
   * record and verify agreements — is always available; Gate adds access passes and protected
   * Solana actions. Absent = Proof only.
   */
  products?: { gate?: boolean };
}

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    memberAddress: text("member_address").notNull(),
    roles: integer("roles").notNull(),
    active: boolean("active").notNull(),
    compromisedSince: ts("compromised_since"),
    label: text("label"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("org_members_unique").on(t.organizationId, t.memberAddress)],
);

export const domainStatus = pgEnum("domain_status", [
  "pending",
  "verified",
  "failed",
  "revoked",
  "expired",
]);

export const domainVerifications = pgTable(
  "domain_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    status: domainStatus("status").notNull().default("pending"),
    txtName: text("txt_name").notNull(),
    txtValue: text("txt_value").notNull(),
    requestedBy: uuid("requested_by").references(() => users.id),
    lastCheckedAt: ts("last_checked_at"),
    lastError: text("last_error"),
    attestationTx: text("attestation_tx"),
    verifiedAt: ts("verified_at"),
    expiresAt: ts("expires_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("domain_verifications_org_idx").on(t.organizationId),
    index("domain_verifications_domain_idx").on(t.domain),
  ],
);

// ---- documents and versions -----------------------------------------------------------------------

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    address: text("address").notNull().unique(),
    slug: text("slug").notNull(),
    documentType: text("document_type").notNull(),
    locale: text("locale").notNull(),
    versionCount: integer("version_count").notNull().default(0),
    headHash: text("head_hash"),
    currentVersionAddress: text("current_version_address"),
    /**
     * Stele Gate policy: wallet acceptances are recorded with `record_gated_acceptance`, which also
     * creates or advances the signer's on-chain access pass. An off-chain routing choice; the pass
     * itself can only be written by a verified acceptance.
     */
    gated: boolean("gated").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("documents_org_slug_unique").on(t.organizationId, t.slug)],
);

export const draftStatus = pgEnum("draft_status", ["draft", "prepared", "published", "abandoned"]);

/** Drafts are mutable working copies — explicitly NOT evidence. */
export const documentDrafts = pgTable(
  "document_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    versionLabel: text("version_label").notNull(),
    effectiveAt: bigint("effective_at", { mode: "number" }),
    source: text("source").notNull(),
    changeSummary: text("change_summary"),
    status: draftStatus("status").notNull().default("draft"),
    preparedVersionNumber: integer("prepared_version_number"),
    preparedContentHash: text("prepared_content_hash"),
    preparedVersionHash: text("prepared_version_hash"),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("drafts_document_idx").on(t.documentId)],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    address: text("address").notNull().unique(),
    number: integer("number").notNull(),
    versionHash: text("version_hash").notNull().unique(),
    contentHash: text("content_hash").notNull(),
    previousVersionHash: text("previous_version_hash"),
    title: text("title").notNull(),
    versionLabel: text("version_label").notNull(),
    effectiveAt: bigint("effective_at", { mode: "number" }),
    publishedAt: ts("published_at").notNull(),
    publishedSlot: bigint("published_slot", { mode: "number" }).notNull(),
    publisherAddress: text("publisher_address").notNull(),
    publisherRole: integer("publisher_role").notNull(),
    storageUri: text("storage_uri").notNull(),
    publishTx: text("publish_tx"),
    finalized: boolean("finalized").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("versions_document_number_unique").on(t.documentId, t.number)],
);

/** Content-addressed archive index (bytes live in the storage provider). */
export const contentObjects = pgTable("content_objects", {
  contentHash: text("content_hash").primaryKey(),
  byteSize: integer("byte_size").notNull(),
  cid: text("cid").notNull(),
  locations: jsonb("locations")
    .$type<{ provider: string; uri: string; storedAt: string }[]>()
    .notNull()
    .default([]),
  createdAt: createdAt(),
});

// ---- acceptance pipeline --------------------------------------------------------------------------

export const shardStatus = pgEnum("shard_status", ["active", "full", "retired"]);

export const nonceShards = pgTable(
  "nonce_shards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    address: text("address").notNull().unique(),
    shardId: integer("shard_id").notNull(),
    relayerAddress: text("relayer_address").notNull(),
    /** Allocation cursor: indices below it have been handed out (never reused). */
    nextIndex: integer("next_index").notNull().default(0),
    status: shardStatus("status").notNull().default("active"),
    /** Mirror of the on-chain sponsorship trailer (null = not enabled). Refreshed from the chain. */
    sponsorship: jsonb("sponsorship").$type<ShardSponsorshipMirror | null>(),
    sponsorshipSyncedAt: ts("sponsorship_synced_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("shards_org_shard_unique").on(t.organizationId, t.shardId)],
);

export interface ShardSponsorshipMirror {
  paused: boolean;
  maxFeePerRecord: number;
  dailyLimit: number;
  spentToday: number;
  currentDay: number;
  totalReimbursed: number;
  reimbursedCount: number;
  totalWithdrawn: number;
  balanceLamports: number;
  rentExemptLamports: number;
}

/** Server-issued, single-purpose tokens that let a company gate and attribute acceptances. */
export const acceptanceSessions = pgTable(
  "acceptance_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    /** Opaque identifier from the company's own system (never sent on-chain). */
    externalUserRef: text("external_user_ref"),
    createdByApiKeyId: uuid("created_by_api_key_id"),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("acceptance_sessions_org_idx").on(t.organizationId)],
);

export const challengeStatus = pgEnum("challenge_status", [
  "issued",
  "submitted",
  "confirmed",
  "finalized",
  "failed",
  "expired",
]);

export const acceptanceChallenges = pgTable(
  "acceptance_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionAddress: text("version_address").notNull(),
    shardRowId: uuid("shard_row_id")
      .notNull()
      .references(() => nonceShards.id),
    nonceIndex: integer("nonce_index").notNull(),
    nonceTag: text("nonce_tag").notNull(),
    signerAddress: text("signer_address").notNull(),
    requestDomain: text("request_domain").notNull(),
    /** Cluster time (Unix seconds). */
    issuedAt: bigint("issued_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    message: text("message").notNull(),
    status: challengeStatus("status").notNull().default("issued"),
    /** SHA-256 of the browser binding secret; submission must present the secret. */
    clientBindingHash: text("client_binding_hash").notNull(),
    acceptanceSessionId: uuid("acceptance_session_id").references(() => acceptanceSessions.id),
    externalUserRef: text("external_user_ref"),
    /** "wallet", "passkey" (PRF-protected Stele key) or "passkey_p256" (native passkey, stele/2). */
    signerType: text("signer_type").notNull().default("wallet"),
    signerIdentityId: uuid("signer_identity_id"),
    /** The user-verified WebAuthn assertion over this message (passkey signers). */
    passkeyAssertion: jsonb("passkey_assertion").$type<PasskeyAssertionRecord | null>(),
    txSignature: text("tx_signature"),
    acceptanceId: text("acceptance_id"),
    failureReason: text("failure_reason"),
    /**
     * Off-chain audit trail, recorded when the signature is submitted (never on-chain): the
     * signer's IP address (AES-256-GCM under ENCRYPTION_KEY) and the browser's time zone.
     */
    signerIpCiphertext: text("signer_ip_ciphertext"),
    signerTimeZone: text("signer_time_zone"),
    signerUtcOffsetMinutes: integer("signer_utc_offset_minutes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("challenges_shard_nonce_unique").on(t.shardRowId, t.nonceIndex),
    index("challenges_status_idx").on(t.status, t.expiresAt),
  ],
);

export const acceptanceCommitment = pgEnum("acceptance_commitment", ["confirmed", "finalized"]);

/** Index of on-chain acceptances. Rebuildable from the ledger. */
export const acceptances = pgTable(
  "acceptances",
  {
    acceptanceId: text("acceptance_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionAddress: text("version_address").notNull(),
    versionNumber: integer("version_number").notNull(),
    signerAddress: text("signer_address").notNull(),
    /** The recording transaction (MERKLE_BATCHED: the batch anchor, shared by its leaves). */
    txSignature: text("tx_signature").notNull(),
    slot: bigint("slot", { mode: "number" }).notNull(),
    blockTime: ts("block_time"),
    issuedAt: bigint("issued_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    nonceShardAddress: text("nonce_shard_address").notNull(),
    nonceIndex: integer("nonce_index").notNull(),
    messageHash: text("message_hash").notNull(),
    requestDomain: text("request_domain").notNull(),
    commitment: acceptanceCommitment("commitment").notNull().default("confirmed"),
    challengeId: uuid("challenge_id").references(() => acceptanceChallenges.id),
    externalUserRef: text("external_user_ref"),
    signerType: text("signer_type").notNull().default("wallet"),
    /**
     * stele/2 (native passkey): the signed message text. Only its hash is on-chain (inside the
     * WebAuthn challenge); null when the indexer could not rebuild it from chain state.
     */
    signedMessage: text("signed_message"),
    /** stele/2: WebAuthn evidence read from the transaction (authenticatorData, clientDataJSON, …). */
    signerEvidence: jsonb("signer_evidence").$type<Record<string, unknown> | null>(),
    /** stele/2: the signer's on-chain enrollment at recording time (account mode). */
    enrollmentAddress: text("enrollment_address"),
    evidenceMode: text("evidence_mode")
      .$type<"DIRECT_ONCHAIN" | "MERKLE_BATCHED">()
      .notNull()
      .default("DIRECT_ONCHAIN"),
    /** MERKLE_BATCHED: the anchored batch and this leaf's position. */
    batchId: uuid("batch_id"),
    leafIndex: integer("leaf_index"),
    feePayer: text("fee_payer"),
    feeLamports: bigint("fee_lamports", { mode: "number" }),
    /** Lamports the organization's sponsored shard reimbursed (null = Stele paid). */
    reimbursedLamports: bigint("reimbursed_lamports", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [
    // One direct acceptance per transaction; batched leaves share their anchor transaction.
    uniqueIndex("acceptances_direct_tx_unique")
      .on(t.txSignature)
      .where(sql`evidence_mode = 'DIRECT_ONCHAIN'`),
    index("acceptances_tx_idx").on(t.txSignature),
    index("acceptances_org_time_idx").on(t.organizationId, t.blockTime),
    // Keyset pagination (newest first): GET /v1/acceptances?cursor=…
    index("acceptances_org_slot_idx").on(t.organizationId, t.slot, t.acceptanceId),
    index("acceptances_version_idx").on(t.versionAddress),
    index("acceptances_signer_idx").on(t.signerAddress),
    index("acceptances_external_ref_idx").on(t.organizationId, t.externalUserRef),
  ],
);

// ---- walletless signers (passkey-protected Stele keys) ----------------------------------------------

export interface PasskeyAssertionRecord {
  credentialId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

export interface WrappedKeyRecord {
  format: "stele-wrapped-key-v1";
  salt: string;
  iv: string;
  ciphertext: string;
}

/** "pending": a native passkey whose possession proof / on-chain enrollment is not done yet. */
export const identityStatus = pgEnum("signer_identity_status", [
  "active",
  "rotated",
  "revoked",
  "pending",
]);

/**
 * Signing algorithms of walletless identities:
 *   "ed25519-prf" — stele/1: an Ed25519 key encrypted under the passkey's PRF output (legacy path);
 *   "p256-native" — stele/2: the passkey's own P-256 key signs (verified by the secp256r1
 *                   precompile); its private key never leaves the authenticator.
 */
export type SignerAlgorithm = "ed25519-prf" | "p256-native";

/** Evidence that a native passkey holds its key and agreed to its enrollment (self-authenticating). */
export interface EnrollmentEvidenceRecord {
  statement: string;
  assertion: PasskeyAssertionRecord;
  /** On-chain enrollment (account mode): the transaction that created or changed it. */
  txSignature: string | null;
}

/**
 * A walletless signer: an Ed25519 public key whose private key exists only encrypted (under passkey
 * PRF outputs or recovery kits). The server stores NO private key and NO key that can decrypt one.
 * Identities are per organization (no cross-site linkability).
 */
export const signerIdentities = pgTable(
  "signer_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Base58 Ed25519 key ("ed25519-prf") or `p256:<66 hex>` compressed P-256 key ("p256-native"). */
    publicKey: text("public_key").notNull().unique(),
    algorithm: text("algorithm").$type<SignerAlgorithm>().notNull().default("ed25519-prf"),
    /** WebAuthn relying-party ID the identity's passkeys belong to (the signing site's host). */
    rpId: text("rp_id").notNull(),
    /** The organization's account for this signer (ACCOUNT_AND_PASSKEY policy); never on-chain. */
    externalUserRef: text("external_user_ref"),
    status: identityStatus("status").notNull().default("active"),
    /** Previous identity this one replaces, and how the replacement was authorized. */
    rotatedFromId: uuid("rotated_from_id"),
    rotationKind: text("rotation_kind"),
    rotationStatement: text("rotation_statement"),
    /** Signature of the previous key over the rotation statement (endorsed rotations only). */
    rotationPreviousSignature: text("rotation_previous_signature"),
    revokedReason: text("revoked_reason"),
    /**
     * Native passkeys bound to an account: the random per-account salt (hex, kept off-chain) and the
     * salted commitment SHA-256(tag ‖ org ‖ salt ‖ externalUserRef) the on-chain enrollment holds.
     */
    accountSalt: text("account_salt"),
    accountCommitment: text("account_commitment"),
    /** On-chain PasskeySigner PDA (native passkeys in account mode). */
    enrollmentAddress: text("enrollment_address"),
    /** The statement the passkey signed when it was enrolled (possession proof), with its assertion. */
    enrollmentEvidence: jsonb("enrollment_evidence").$type<EnrollmentEvidenceRecord | null>(),
    createdAt: createdAt(),
    statusChangedAt: ts("status_changed_at"),
  },
  (t) => [
    index("signer_identities_org_idx").on(t.organizationId),
    index("signer_identities_enrollment_idx").on(t.enrollmentAddress),
    index("signer_identities_account_idx").on(t.organizationId, t.externalUserRef),
  ],
);

export const passkeyCredentials = pgTable(
  "passkey_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => signerIdentities.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(),
    /** SubjectPublicKeyInfo (base64url) and COSE algorithm. */
    publicKey: text("public_key").notNull(),
    algorithm: integer("algorithm").notNull(),
    rpId: text("rp_id").notNull(),
    signCount: bigint("sign_count", { mode: "number" }).notNull().default(0),
    /**
     * PRF identities only (null for native P-256 passkeys, whose key never leaves the authenticator):
     * non-secret WebAuthn PRF input (base64url) and the signing seed encrypted under its output.
     */
    prfSalt: text("prf_salt"),
    wrappedKey: jsonb("wrapped_key").$type<WrappedKeyRecord>(),
    /** PRF identities: statement binding this passkey to the key, signed by the key and endorsed by the passkey. */
    keyStatement: text("key_statement"),
    keySignature: text("key_signature"),
    statementAssertion: jsonb("statement_assertion").$type<PasskeyAssertionRecord>(),
    backedUp: boolean("backed_up").notNull().default(false),
    label: text("label"),
    createdAt: createdAt(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("passkey_credentials_identity_idx").on(t.identityId)],
);

export const recoveryKits = pgTable(
  "recovery_kits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => signerIdentities.id, { onDelete: "cascade" }),
    /** Public kit identifier derived from the kit secret (the secret is never sent to Stele). */
    kitId: text("kit_id").notNull().unique(),
    wrappedKey: jsonb("wrapped_key").$type<WrappedKeyRecord>().notNull(),
    keyStatement: text("key_statement").notNull(),
    keySignature: text("key_signature").notNull(),
    createdAt: createdAt(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("recovery_kits_identity_idx").on(t.identityId)],
);

/** One-time WebAuthn ceremony challenges (registration and identification). */
export const passkeyChallenges = pgTable("passkey_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(),
  challenge: text("challenge").notNull(),
  rpId: text("rp_id").notNull(),
  externalUserRef: text("external_user_ref"),
  acceptanceSessionId: uuid("acceptance_session_id"),
  /** For "add_passkey" / "rotate": the identity concerned. */
  identityId: uuid("identity_id"),
  /**
   * Native passkeys: the statement the passkey must sign (enrollment or rotation) and its window
   * (cluster seconds); the WebAuthn challenge is SHA-256(tag ‖ statement).
   */
  statement: text("statement"),
  details: jsonb("details").$type<Record<string, unknown> | null>(),
  expiresAt: ts("expires_at").notNull(),
  consumedAt: ts("consumed_at"),
  createdAt: createdAt(),
});

// ---- generic proofs -------------------------------------------------------------------------------------

export const proofRequestStatus = pgEnum("proof_request_status", [
  "open",
  "issued",
  "submitted",
  "confirmed",
  "failed",
  "expired",
]);

/**
 * A statement the organization asks a customer to confirm (purchase, refund, consent…). Created by
 * the organization's server; the customer's browser receives only the request ID and a client token.
 */
export const proofRequests = pgTable(
  "proof_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientTokenHash: text("client_token_hash").notNull(),
    proofType: text("proof_type").notNull(),
    /** The canonical stele-statement-v1 object (organization data; contains the random salt). */
    statement: jsonb("statement").$type<Record<string, unknown>>().notNull(),
    statementHash: text("statement_hash").notNull(),
    reference: text("reference").notNull(),
    externalUserRef: text("external_user_ref"),
    createdByApiKeyId: uuid("created_by_api_key_id"),
    expiresAt: ts("expires_at").notNull(),
    status: proofRequestStatus("status").notNull().default("open"),
    // Challenge (set when the customer is about to sign).
    shardRowId: uuid("shard_row_id").references(() => nonceShards.id),
    nonceIndex: integer("nonce_index"),
    nonceTag: text("nonce_tag"),
    signerAddress: text("signer_address"),
    signerType: text("signer_type"),
    signerIdentityId: uuid("signer_identity_id"),
    requestDomain: text("request_domain"),
    issuedAt: bigint("issued_at", { mode: "number" }),
    challengeExpiresAt: bigint("challenge_expires_at", { mode: "number" }),
    message: text("message"),
    clientBindingHash: text("client_binding_hash"),
    passkeyAssertion: jsonb("passkey_assertion").$type<PasskeyAssertionRecord | null>(),
    txSignature: text("tx_signature"),
    proofId: text("proof_id"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("proof_requests_org_idx").on(t.organizationId, t.createdAt),
    index("proof_requests_reference_idx").on(t.organizationId, t.reference),
  ],
);

/** Index of on-chain proofs. Rebuildable from the ledger (except the off-chain statement). */
export const proofs = pgTable(
  "proofs",
  {
    proofId: text("proof_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    proofType: text("proof_type").notNull(),
    statementHash: text("statement_hash").notNull(),
    reference: text("reference"),
    signerAddress: text("signer_address").notNull(),
    signerType: text("signer_type").notNull().default("wallet"),
    txSignature: text("tx_signature").notNull(),
    slot: bigint("slot", { mode: "number" }).notNull(),
    blockTime: ts("block_time"),
    issuedAt: bigint("issued_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    nonceShardAddress: text("nonce_shard_address").notNull(),
    nonceIndex: integer("nonce_index").notNull(),
    messageHash: text("message_hash").notNull(),
    requestDomain: text("request_domain").notNull(),
    commitment: acceptanceCommitment("commitment").notNull().default("confirmed"),
    proofRequestId: uuid("proof_request_id").references(() => proofRequests.id),
    externalUserRef: text("external_user_ref"),
    feePayer: text("fee_payer"),
    feeLamports: bigint("fee_lamports", { mode: "number" }),
    reimbursedLamports: bigint("reimbursed_lamports", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("proofs_org_time_idx").on(t.organizationId, t.blockTime),
    index("proofs_org_slot_idx").on(t.organizationId, t.slot, t.proofId),
    index("proofs_reference_idx").on(t.organizationId, t.reference),
    index("proofs_signer_idx").on(t.signerAddress),
  ],
);

/** Every relayed recording and who paid for it (Stele quota accounting and the sponsorship history). */
export const sponsoredTransactions = pgTable(
  "sponsored_transactions",
  {
    txSignature: text("tx_signature").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recordKind: text("record_kind").notNull(),
    recordId: text("record_id").notNull(),
    feePayer: text("fee_payer").notNull(),
    feeLamports: bigint("fee_lamports", { mode: "number" }).notNull(),
    /** "stele" or "organization" (the organization's shard reimbursed the fee). */
    sponsor: text("sponsor").notNull(),
    reimbursedLamports: bigint("reimbursed_lamports", { mode: "number" }).notNull().default(0),
    nonceShardAddress: text("nonce_shard_address").notNull(),
    /** Recordings this transaction carried (a batch anchor counts each of its acceptances). */
    recordCount: integer("record_count").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [index("sponsored_tx_org_time_idx").on(t.organizationId, t.createdAt)],
);

// ---- MERKLE_BATCHED acceptances ------------------------------------------------------------------

/** A Merkle root the relayer anchored (or is anchoring) for one organization shard. */
export const acceptanceBatches = pgTable(
  "acceptance_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    shardRowId: uuid("shard_row_id")
      .notNull()
      .references(() => nonceShards.id),
    root: text("root").notNull(),
    leafCount: integer("leaf_count").notNull(),
    /** "anchoring" | "anchored" | "failed". */
    status: text("status").notNull().default("anchoring"),
    /** The on-chain batch id (from the AcceptanceBatchAnchored event). */
    onchainBatchId: text("onchain_batch_id"),
    txSignature: text("tx_signature").unique(),
    slot: bigint("slot", { mode: "number" }),
    /** SHA-256 of the published manifest (every leaf's evidence) in the content store. */
    manifestHash: text("manifest_hash"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    anchoredAt: ts("anchored_at"),
  },
  (t) => [index("acceptance_batches_org_idx").on(t.organizationId, t.createdAt)],
);

/**
 * An acceptance whose signature the relayer verified off-chain, waiting to be anchored (or
 * anchored). `evidence` is the complete BatchedEvidence minus the batch proof: what any verifier
 * needs besides the chain.
 */
export const batchLeaves = pgTable(
  "batch_leaves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    challengeId: uuid("challenge_id").references(() => acceptanceChallenges.id),
    shardRowId: uuid("shard_row_id")
      .notNull()
      .references(() => nonceShards.id),
    acceptanceId: text("acceptance_id").notNull().unique(),
    leafHash: text("leaf_hash").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    /** "pending" | "anchored" | "expired". */
    status: text("status").notNull().default("pending"),
    batchId: uuid("batch_id").references(() => acceptanceBatches.id),
    leafIndex: integer("leaf_index"),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("batch_leaves_pending_idx").on(t.status, t.shardRowId, t.createdAt)],
);

// ---- billing ---------------------------------------------------------------------------------------

/**
 * A request to buy recording credits, paid on-chain in SOL straight to the treasury address. The
 * payment transaction must carry `reference` (a fresh random address) in its transfer instruction,
 * so it can be found and attributed without trusting anything the browser says.
 */
export const billingInvoices = pgTable(
  "billing_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    pack: text("pack").notNull(),
    credits: integer("credits").notNull(),
    lamports: bigint("lamports", { mode: "number" }).notNull(),
    treasury: text("treasury").notNull(),
    reference: text("reference").notNull().unique(),
    /** "open" until a matching payment is verified on-chain, then "paid". */
    status: text("status").notNull().default("open"),
    txSignature: text("tx_signature").unique(),
    payer: text("payer"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    paidAt: ts("paid_at"),
  },
  (t) => [index("billing_invoices_org_time_idx").on(t.organizationId, t.createdAt)],
);

/**
 * Credit movements: purchases (+), recordings beyond the monthly free allowance (-), grants (+).
 * The balance is the sum; (kind, reference) makes every movement idempotent.
 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    /** "purchase" (reference: invoice ID), "recording" (record ID) or "grant". */
    kind: text("kind").notNull(),
    reference: text("reference").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("credit_ledger_kind_reference_idx").on(t.kind, t.reference),
    index("credit_ledger_org_idx").on(t.organizationId),
  ],
);

// ---- integrations -----------------------------------------------------------------------------------

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Public, non-secret identifier shown in the UI and used for lookup (e.g. `stl_live_8f3a…`). */
    prefix: text("prefix").notNull().unique(),
    /** SHA-256 of the full key. */
    secretHash: text("secret_hash").notNull(),
    scopes: text("scopes").array().notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    lastUsedAt: ts("last_used_at"),
    expiresAt: ts("expires_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("api_keys_org_idx").on(t.organizationId)],
);

export const webhookStatus = pgEnum("webhook_status", ["active", "disabled"]);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    description: text("description"),
    events: text("events").array().notNull(),
    /** AES-256-GCM ciphertext of the signing secret (key held outside the database). */
    secretCiphertext: text("secret_ciphertext").notNull(),
    status: webhookStatus("status").notNull().default("active"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("webhooks_org_idx").on(t.organizationId)],
);

export const deliveryStatus = pgEnum("delivery_status", ["pending", "delivered", "failed", "dead"]);

/** Transactional outbox for webhook deliveries. */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: deliveryStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    lastResponseStatus: integer("last_response_status"),
    lastError: text("last_error"),
    deliveredAt: ts("delivered_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("deliveries_due_idx").on(t.status, t.nextAttemptAt),
    uniqueIndex("deliveries_endpoint_event_unique").on(t.endpointId, t.eventId),
  ],
);

// ---- tamper-evident audit log -----------------------------------------------------------------------

export const actorType = pgEnum("actor_type", ["user", "api_key", "system"]);

/**
 * Append-only, hash-chained per organization: `entry_hash = SHA-256(prev_hash ‖ canonical(entry))`.
 * Editing or deleting any row breaks every later hash; the chain head can be exported or anchored.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    sequence: integer("sequence").notNull(),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    txSignature: text("tx_signature"),
    ipHash: text("ip_hash"),
    createdAt: ts("created_at").notNull(),
    prevHash: text("prev_hash").notNull(),
    entryHash: text("entry_hash").notNull(),
  },
  (t) => [
    uniqueIndex("audit_org_sequence_unique").on(t.organizationId, t.sequence),
    index("audit_org_time_idx").on(t.organizationId, t.createdAt),
  ],
);

// ---- infrastructure -----------------------------------------------------------------------------------

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

export const indexerState = pgTable("indexer_state", {
  id: text("id").primaryKey(),
  /** Newest fully processed transaction signature (cursor for getSignaturesForAddress). */
  lastSignature: text("last_signature"),
  lastSlot: bigint("last_slot", { mode: "number" }),
  updatedAt: ts("updated_at")
    .notNull()
    .default(sql`now()`),
});

// ---- Stele Gate ----------------------------------------------------------------------------------

/**
 * Index of on-chain access passes (PROTOCOL_SPEC.md §18), rebuilt from `AccessPassUpdated` events.
 * A cache for the dashboard — never evidence: protected programs read the account on Solana.
 */
export const accessPasses = pgTable(
  "access_passes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /**
     * The account that holds the holder's Gate state for this document: their AccessPass, or
     * their passport (one passport covers many documents, so the address is not unique here).
     */
    address: text("address").notNull(),
    /** "pass" (per-document AccessPass, Gate v2) or "passport" (Gate v3). */
    storage: text("storage").notNull().default("pass"),
    /** Passport entries: who paid the deposit (refunded to them on removal). */
    depositPayer: text("deposit_payer"),
    holder: text("holder").notNull(),
    versionAddress: text("version_address").notNull(),
    versionNumber: integer("version_number").notNull(),
    /** Fingerprint of the accepted version (hex). */
    versionHash: text("version_hash"),
    acceptanceId: text("acceptance_id").notNull(),
    acceptanceCount: integer("acceptance_count").notNull(),
    acceptedAt: ts("accepted_at").notNull(),
    firstAcceptedAt: ts("first_accepted_at").notNull(),
    slot: bigint("slot", { mode: "number" }).notNull(),
    txSignature: text("tx_signature").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("access_passes_document_idx").on(t.documentId),
    uniqueIndex("access_passes_document_holder_unique").on(t.documentId, t.holder),
  ],
);

/** Solana programs an organization protects with Stele Gate (registry for the dashboard). */
/** Who a probe account stands for; "address" is a fixed account. */
export type ProbeAccountRole = "user" | "passport" | "accessPass" | "policy" | "address";

/** The protected instruction, with placeholders the verification fills per scenario. */
export interface ProbeTemplate {
  /** Instruction data, hex. */
  data: string;
  accounts: { role: ProbeAccountRole; address?: string; signer: boolean; writable: boolean }[];
}

export interface ProbeCheck {
  id: "refuses_without_acceptance" | "allows_with_acceptance" | "refuses_borrowed_passport";
  outcome: "passed" | "failed" | "skipped";
  /** The error the program returned, if any (e.g. AccessPassMissing). */
  error: string | null;
  detail: string;
}

export interface ProgramVerification {
  status: "verified" | "failed" | "incomplete";
  checks: ProbeCheck[];
  checkedAt: string;
  /** When the current run of "verified" started (kept across re-checks of the same binary). */
  verifiedSince: string | null;
  program: {
    /** sha256 of the deployed code (trailing zero padding removed). */
    codeHash: string | null;
    deployedSlot: number | null;
    upgradeAuthority: string | null;
    /** immutable · program (a PDA, e.g. a multisig) · key (a single wallet) */
    authorityKind: "immutable" | "program" | "key";
  };
  /** The policy version the probes required. */
  requiredVersion: number;
  reason: string | null;
}

export interface ProgramOwnership {
  authority: string;
  signature: string;
  provenAt: string;
}

export const gatePrograms = pgTable(
  "gate_programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    programAddress: text("program_address").notNull(),
    label: text("label").notNull(),
    /** The protected action as the developer names it (e.g. "place_bet"). */
    action: text("action").notNull(),
    policyDocumentId: uuid("policy_document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** "check" (stele-gate verify_access) or "strict" (check_access CPI). */
    mode: text("mode").notNull(),
    /** How to call the protected instruction, for the verification probes (Stele Verified). */
    probeTemplate: jsonb("probe_template").$type<ProbeTemplate | null>(),
    /** The latest verification of the deployed program (re-run after every upgrade). */
    verification: jsonb("verification").$type<ProgramVerification | null>(),
    /** Proof that the program's upgrade authority links it to this organization. */
    ownership: jsonb("ownership").$type<ProgramOwnership | null>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("gate_programs_org_program_unique").on(t.organizationId, t.programAddress)],
);

/**
 * Public live-demo sessions (devnet/localnet only): each visitor gets an own policy document under the
 * operator's demo organization, so publishing v2 in one session never changes another's. Budgeted
 * per IP and per day; never used on mainnet.
 */
export const demoSessions = pgTable(
  "demo_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    /** "gate" (policy + protected market) or "proof" (terms + receipt). */
    kind: text("kind").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    marketAddress: text("market_address"),
    ipHash: text("ip_hash").notNull(),
    publishCount: integer("publish_count").notNull().default(1),
    actionCount: integer("action_count").notNull().default(0),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("demo_sessions_ip_idx").on(t.ipHash, t.createdAt)],
);

/**
 * Index of on-chain Gate policies (PROTOCOL_SPEC.md §18.2), mirrored from the policy accounts. The
 * account on Solana is authoritative; protected programs read it there.
 */
export const gatePolicies = pgTable("gate_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  documentId: uuid("document_id")
    .notNull()
    .unique()
    .references(() => documents.id, { onDelete: "cascade" }),
  address: text("address").notNull().unique(),
  requiredVersion: integer("required_version").notNull(),
  requiredVersionHash: text("required_version_hash").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
