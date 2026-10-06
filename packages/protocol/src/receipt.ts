/**
 * `stele-receipt-v1` — an UNSIGNED convenience bundle (PROTOCOL_SPEC.md §10). Every field is a
 * claim that a verifier checks against the chain; nothing in a receipt is trusted on its own.
 */
import { z } from "zod";
import { PROOF_RECEIPT_FORMAT, RECEIPT_FORMAT, RECEIPT_V2_FORMAT } from "./constants";
import { PROOF_TYPES, type ProofTypeName } from "./proof";

const hex32 = z.string().regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hex characters");
const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,88}$/, "expected base58");
const int = z.number().int().nonnegative();
const b64url = z.string().regex(/^[A-Za-z0-9_-]+$/, "expected base64url");

export const passkeyAssertionSchema = z
  .object({
    credentialId: b64url.max(1366),
    authenticatorData: b64url.max(4096),
    clientDataJSON: b64url.max(4096),
    signature: b64url.max(1024),
  })
  .strict();

/**
 * How the signing key was controlled. `WALLET` is the signer's own statement and cannot be proven
 * beyond the key itself. `PASSKEY_PROTECTED_STELE_KEY` carries evidence a verifier checks: a key
 * statement signed by the key and endorsed by the passkey, and a user-verified passkey assertion
 * over this exact signed message. No biometric data is involved or included.
 */
export const signerEvidenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("WALLET") }).strict(),
  z
    .object({
      type: z.literal("PASSKEY_PROTECTED_STELE_KEY"),
      passkey: z
        .object({
          credentialId: b64url.max(1366),
          publicKey: b64url.max(1024),
          algorithm: z.number().int(),
          rpId: z.string().max(253),
        })
        .strict(),
      keyStatement: z
        .object({
          statement: z.string().max(2048),
          keySignature: b64url.max(128),
          passkeyAssertion: passkeyAssertionSchema,
        })
        .strict(),
      assertion: passkeyAssertionSchema,
    })
    .strict(),
]);
export type SignerEvidence = z.infer<typeof signerEvidenceSchema>;

/**
 * Who paid the network fee. The fee payer never authorizes anything: a different fee payer cannot
 * change what the user signed. `ORGANIZATION` means the organization's sponsored nonce shard
 * reimbursed the relayer (a `SponsorReimbursed` event in the same transaction).
 */
export const feeEvidenceSchema = z
  .object({
    payer: base58,
    sponsor: z.enum(["STELE", "ORGANIZATION"]),
    feeLamports: int,
    reimbursedLamports: int.nullable(),
  })
  .strict();
export type FeeEvidence = z.infer<typeof feeEvidenceSchema>;

const contentSchema = z.object({
  attachments: z.array(
    z
      .object({
        mediaType: z.string(),
        name: z.string(),
        sha256: z.string(),
        size: z.number().int(),
      })
      .strict(),
  ),
  blocks: z.array(z.record(z.string(), z.unknown())),
  changeSummary: z.string().nullable(),
  format: z.literal("stele-content-v1"),
});

export const receiptSchema = z
  .object({
    format: z.literal(RECEIPT_FORMAT),
    acceptanceId: hex32,
    network: z.object({ chainId: z.string(), label: z.string(), programId: base58 }),
    transaction: z.object({ signature: base58, slot: int, blockTime: int.nullable() }),
    acceptance: z.object({
      signer: base58,
      message: z.string().max(4096),
      messageHash: hex32,
      signature: base58,
      issuedAt: int,
      expiresAt: int,
      nonce: z.object({ shardId: int, index: int, tag: z.string().regex(/^[0-9a-f]{16}$/) }),
      requestDomain: z.string(),
    }),
    organization: z.object({
      address: base58,
      name: z.string(),
      verifiedDomain: z.string().nullable(),
    }),
    document: z.object({
      address: base58,
      slug: z.string(),
      documentType: z.string(),
      locale: z.string(),
    }),
    version: z.object({
      address: base58,
      number: z.number().int().positive(),
      label: z.string(),
      title: z.string(),
      versionHash: hex32,
      contentHash: hex32,
      previousVersionHash: hex32.nullable(),
      effectiveAt: int.nullable(),
      publishedAt: int,
      publishedSlot: int,
      storageUri: z.string(),
    }),
    content: contentSchema.optional(),
    /** Optional (added with walletless signing): absent in older receipts, which still verify. */
    signer: signerEvidenceSchema.optional(),
    fees: feeEvidenceSchema.optional(),
    generatedAt: z.string(),
  })
  .strict();

export type Receipt = z.infer<typeof receiptSchema>;

const hex = (n: number) =>
  z.string().regex(new RegExp(`^[0-9a-f]{${n}}$`), `expected ${n} lowercase hex characters`);

/**
 * `stele-receipt/2` — an UNSIGNED bundle for:
 *
 * * a stele/2 acceptance (a native passkey's P-256 WebAuthn signature) recorded directly
 *   (`DIRECT_ONCHAIN`: the secp256r1 precompile verified it), or
 * * a stele/1 or stele/2 acceptance anchored in a Merkle batch (`MERKLE_BATCHED`: the program
 *   verified NO signature; every verifier checks it off-chain, plus the inclusion proof).
 *
 * Only the message HASH is on-chain for stele/2 (inside the WebAuthn challenge) and nothing but a
 * root for batched leaves, so the receipt carries the exact signed text and signature evidence; a
 * verifier checks every claim against the chain. The document text (content) is included by
 * default. stele/1 acceptances recorded directly keep `stele-receipt-v1`.
 */
const nonceSchema = z
  .object({ shardId: int, index: int, tag: z.string().regex(/^[0-9a-f]{16}$/) })
  .strict();

export const receiptV2Schema = z
  .object({
    format: z.literal(RECEIPT_V2_FORMAT),
    protocol: z.enum(["stele/1", "stele/2"]),
    acceptanceId: hex32,
    /** How the record is anchored (PROTOCOL_SPEC.md §17.9). */
    evidenceMode: z.enum(["DIRECT_ONCHAIN", "MERKLE_BATCHED"]),
    network: z.object({ chainId: z.string(), label: z.string(), programId: base58 }).strict(),
    /** The recording transaction (MERKLE_BATCHED: the batch anchor). */
    transaction: z.object({ signature: base58, slot: int, blockTime: int.nullable() }).strict(),
    acceptance: z
      .object({
        /** The exact text that was signed (stele-acceptance-v1 or -v2). */
        message: z.string().max(4096),
        messageHash: hex32,
        /** stele/2: the WebAuthn challenge SHA-256(PASSKEY_ACCEPTANCE_TAG ‖ message). */
        challenge: hex32.nullable(),
        /** stele/1: the Ed25519 signature (base58) over the message. */
        signature: base58.nullable(),
        issuedAt: int,
        expiresAt: int,
        nonce: nonceSchema,
        requestDomain: z.string(),
      })
      .strict(),
    signer: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("NATIVE_PASSKEY"),
          /** ECDSA P-256 with SHA-256 over WebAuthn data (COSE ES256). */
          algorithm: z.literal("ES256"),
          /** Compressed P-256 public key. */
          publicKey: hex(66),
          /** On-chain enrollment (account-bound signers) — a salted commitment, no personal data. */
          enrollment: z.object({ address: base58, accountCommitment: hex32 }).strict().nullable(),
        })
        .strict(),
      z
        .object({
          type: z.literal("ED25519_KEY"),
          algorithm: z.literal("Ed25519"),
          publicKey: base58,
          /** How the key was controlled (wallet, or a PRF-protected Stele key with its evidence). */
          evidence: signerEvidenceSchema.optional(),
        })
        .strict(),
    ]),
    /** stele/2: exactly what the P-256 key signed. No biometric data exists in WebAuthn. */
    webauthn: z
      .object({
        authenticatorData: b64url.max(4096),
        clientDataJSON: b64url.max(4096),
        /** Compact r ‖ s (low-S). */
        signature: hex(128),
        rpId: z.string().max(253),
      })
      .strict()
      .optional(),
    /**
     * Who vouches for the requesting site. BROWSER_ATTESTED: the browser wrote the origin into
     * clientDataJSON, which the key signed. MERCHANT_CLAIMED: the relaying server wrote the site
     * into the message (signed, so unalterable, but not browser-attested).
     */
    origin: z
      .object({
        attestation: z.enum(["BROWSER_ATTESTED", "MERCHANT_CLAIMED"]),
        origin: z.string().max(300).nullable(),
        requestDomain: z.string(),
      })
      .strict(),
    /** MERKLE_BATCHED: the leaf's inclusion proof (verified at the ANCHORED leaf count). */
    batch: z
      .object({
        root: hex32,
        batchId: hex32,
        leafIndex: int,
        leafCount: int,
        proof: z.array(hex32).max(17),
      })
      .strict()
      .optional(),
    organization: z
      .object({ address: base58, name: z.string(), verifiedDomain: z.string().nullable() })
      .strict(),
    document: z
      .object({
        address: base58,
        slug: z.string(),
        documentType: z.string(),
        locale: z.string(),
      })
      .strict(),
    version: z
      .object({
        address: base58,
        number: z.number().int().positive(),
        label: z.string(),
        title: z.string(),
        versionHash: hex32,
        contentHash: hex32,
        previousVersionHash: hex32.nullable(),
        effectiveAt: int.nullable(),
        publishedAt: int,
        publishedSlot: int,
        storageUri: z.string(),
      })
      .strict(),
    content: contentSchema.optional(),
    fees: feeEvidenceSchema.optional(),
    generatedAt: z.string(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (r.protocol === "stele/2") {
      if (r.signer.type !== "NATIVE_PASSKEY") issue("stele/2 receipts name a native passkey");
      if (!r.webauthn || !r.acceptance.challenge) issue("stele/2 receipts carry WebAuthn data");
      if (r.origin.attestation !== "BROWSER_ATTESTED")
        issue("stele/2 origins are browser-attested");
    } else {
      if (r.signer.type !== "ED25519_KEY") issue("stele/1 receipts name an Ed25519 key");
      if (r.webauthn || r.acceptance.challenge) issue("stele/1 receipts carry no WebAuthn data");
      if (!r.acceptance.signature) issue("stele/1 receipts carry the Ed25519 signature");
      if (r.evidenceMode === "DIRECT_ONCHAIN")
        issue("stele/1 acceptances recorded directly use stele-receipt-v1");
    }
    if ((r.evidenceMode === "MERKLE_BATCHED") !== Boolean(r.batch))
      issue("a batch proof is present exactly for MERKLE_BATCHED receipts");
  });

export type ReceiptV2 = z.infer<typeof receiptV2Schema>;

export function parseReceiptV2(json: unknown): ReceiptV2 {
  const result = receiptV2Schema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `invalid receipt: ${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "schema violation"}`,
    );
  }
  return result.data;
}

/** Parses either receipt format (by its `format` field). */
export function parseAnyReceipt(json: unknown): Receipt | ReceiptV2 {
  const format = (json as { format?: unknown } | null)?.format;
  return format === RECEIPT_V2_FORMAT ? parseReceiptV2(json) : parseReceipt(json);
}

/** Parses untrusted receipt JSON; throws a readable error on schema violations. */
export function parseReceipt(json: unknown): Receipt {
  const result = receiptSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `invalid receipt: ${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "schema violation"}`,
    );
  }
  return result.data;
}

const proofTypeNames = PROOF_TYPES.map((t) => t.name) as [ProofTypeName, ...ProofTypeName[]];

/** `stele-proof-v1` — an unsigned bundle for a recorded proof (PROTOCOL_SPEC.md §12.4). */
export const proofReceiptSchema = z
  .object({
    format: z.literal(PROOF_RECEIPT_FORMAT),
    proofId: hex32,
    network: z.object({ chainId: z.string(), label: z.string(), programId: base58 }),
    transaction: z.object({ signature: base58, slot: int, blockTime: int.nullable() }),
    proof: z.object({
      type: z.enum(proofTypeNames),
      signer: base58,
      message: z.string().max(4096),
      messageHash: hex32,
      signature: base58,
      statementHash: hex32,
      issuedAt: int,
      expiresAt: int,
      nonce: z.object({ shardId: int, index: int, tag: z.string().regex(/^[0-9a-f]{16}$/) }),
      requestDomain: z.string(),
    }),
    organization: z.object({
      address: base58,
      name: z.string(),
      verifiedDomain: z.string().nullable(),
    }),
    /** The full statement (validated separately by `parseStatement`). */
    statement: z.record(z.string(), z.unknown()),
    signer: signerEvidenceSchema.optional(),
    fees: feeEvidenceSchema.optional(),
    generatedAt: z.string(),
  })
  .strict();

export type ProofReceipt = z.infer<typeof proofReceiptSchema>;

export function parseProofReceipt(json: unknown): ProofReceipt {
  const result = proofReceiptSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `invalid proof receipt: ${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "schema violation"}`,
    );
  }
  return result.data;
}

/**
 * The evidence of one batched acceptance, as published in a batch manifest and stored by relayers:
 * everything a verifier needs besides the chain (PROTOCOL_SPEC.md §17.9). Untrusted input.
 */
export const batchedEvidenceSchema = z
  .object({
    protocol: z.enum(["stele/1", "stele/2"]),
    acceptanceId: hex32,
    versionAddress: base58,
    message: z.string().max(4096),
    /** stele/1: the Ed25519 signature (base58). */
    signature: base58.nullable(),
    signer: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("NATIVE_PASSKEY"),
          algorithm: z.literal("ES256"),
          publicKey: hex(66),
          enrollment: z.object({ address: base58, accountCommitment: hex32 }).strict().nullable(),
        })
        .strict(),
      z
        .object({
          type: z.literal("ED25519_KEY"),
          algorithm: z.literal("Ed25519"),
          publicKey: base58,
          evidence: signerEvidenceSchema.optional(),
        })
        .strict(),
    ]),
    webauthn: z
      .object({
        authenticatorData: b64url.max(4096),
        clientDataJSON: b64url.max(4096),
        signature: hex(128),
        rpId: z.string().max(253),
      })
      .strict()
      .optional(),
    batch: z
      .object({
        root: hex32,
        batchId: hex32,
        leafIndex: int,
        leafCount: int,
        proof: z.array(hex32).max(17),
      })
      .strict(),
  })
  .strict();

export type BatchedEvidence = z.infer<typeof batchedEvidenceSchema>;

/** A batch manifest: every leaf's evidence (published so leaves stay provable without one party). */
export const BATCH_MANIFEST_FORMAT = "stele-batch-manifest/1";
export interface BatchManifest {
  format: typeof BATCH_MANIFEST_FORMAT;
  organization: string;
  nonceShard: string;
  root: string;
  leafCount: number;
  leaves: BatchedEvidence[];
}
