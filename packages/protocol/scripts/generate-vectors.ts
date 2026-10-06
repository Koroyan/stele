/**
 * Generates the language-neutral test vectors in `spec/test-vectors/`.
 *
 * Expected outputs are computed with this TypeScript implementation; the Rust implementation must
 * reproduce every byte (`crates/stele-canonical/tests/vectors.rs`), and the TypeScript tests guard
 * against regressions (`packages/protocol/test/vectors.test.ts`). Anchor values (SHA-256 of "abc",
 * calendar dates) are additionally hard-coded in both test suites.
 *
 * Run: pnpm --filter @stele/protocol vectors
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ed25519 } from "@noble/curves/ed25519.js";
import { p256 } from "@noble/curves/nist.js";
import {
  acceptanceId,
  accumulate,
  batchId,
  batchLeafHash,
  merkleProof,
  merkleRoot,
  buildEnrollmentStatement,
  buildPasskeyAcceptanceMessage,
  buildRotationStatement,
  checkAuthenticatorData,
  checkClientData,
  passkeyAcceptanceId,
  PasskeyCheckFailure,
  PASSKEY_ACCEPTANCE_TAG,
  PASSKEY_ENROLL_TAG,
  PASSKEY_ROTATE_TAG,
  concatBytes,
  toBase64Url,
  webauthnChallenge,
  buildAcceptanceMessage,
  buildProofMessage,
  commitmentFor,
  fromBase58,
  fromHex,
  parseStatement,
  proofId,
  serializeStatement,
  statementHash,
  canonicalizeContent,
  contentHash,
  formatRfc3339,
  fromUtf8,
  messageHash,
  normalizeInline,
  normalizeText,
  serializeContent,
  sha256,
  toBase58,
  toHex,
  utf8,
  validateChainId,
  validateDocumentType,
  validateLocale,
  validateNetworkLabel,
  validateOrgName,
  validateRequestDomain,
  validateSlug,
  validateStorageUri,
  validateTitle,
  validateVerifiedDomain,
  validateVersionLabel,
  versionHash,
  versionJson,
  type ContentInput,
  type VersionFields,
} from "../src/index";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../spec/test-vectors");
mkdirSync(root, { recursive: true });

function write(name: string, value: unknown): void {
  writeFileSync(resolve(root, name), JSON.stringify(value, null, 2) + "\n");
  console.log(`wrote spec/test-vectors/${name}`);
}

function attempt<T>(f: () => T): { ok: T } | { error: string } {
  try {
    return { ok: f() };
  } catch (e) {
    return { error: (e as { code?: string }).code ?? "ERROR" };
  }
}

/** Deterministic 32-byte value from a label (for reproducible keys/addresses). */
const seed32 = (label: string) => sha256(utf8(label));
const fixedBytes = (byte: number, n: number) => new Uint8Array(n).fill(byte);

// ---- 1. text normalization -----------------------------------------------------------------------

const textCases: { name: string; input: string }[] = [
  { name: "plain ascii", input: "Hello world" },
  {
    name: "crlf, cr, trailing spaces, blank lines",
    input: "Line one  \r\n\r\nLine two\rLine three   \n\n\n",
  },
  { name: "leading bom and indentation", input: "\u{FEFF}   Indented start\n    indented line" },
  { name: "tabs become spaces", input: "a\tb\t\tc" },
  { name: "space runs collapse", input: "a     b  c" },
  { name: "nfd to nfc", input: "Cafe\u{301} re\u{301}sume\u{301}" },
  { name: "unicode line separators", input: "one\u{2028}two\u{2029}three\u0085four" },
  { name: "emoji and zwj sequence", input: "Team 👩\u{200D}💻 rocks 🇪🇺" },
  { name: "rtl arabic", input: "شروط الخدمة\nالإصدار ٣" },
  { name: "rtl hebrew with marks", input: "תנאי שימוש \u{200F}(גרסה 3)" },
  { name: "cjk with ideographic space", input: "利用規約\u{3000}第3版" },
  { name: "nbsp preserved", input: "Article\u{A0}1 : Objet" },
  { name: "persian zwnj preserved", input: "می\u{200C}خواهم" },
  { name: "json specials", input: 'Quote " backslash \\ slash /' },
  { name: "only whitespace", input: " \t \r\n \u{3000}".replace("\u{3000}", "") },
  { name: "bidi override rejected", input: "Pay \u{202E}0001\u{202C} USD" },
  { name: "bidi isolate rejected", input: "a\u{2066}b\u{2069}c" },
  { name: "zero width space rejected", input: "in\u{200B}visible" },
  { name: "soft hyphen rejected", input: "co\u{AD}operate" },
  { name: "tag characters rejected", input: "hi\u{E0041}\u{E0042}" },
  { name: "private use rejected", input: "icon \u{E000}" },
  { name: "nul rejected", input: "a\u0000b" },
  { name: "c1 control rejected", input: "a\u009Bb" },
  { name: "replacement character rejected", input: "broken � text" },
  { name: "noncharacter rejected", input: "x﷐y" },
  { name: "interior bom rejected", input: "a\u{FEFF}b" },
];

write("text-normalization.json", {
  description:
    "normalize_text / normalize_inline (PROTOCOL_SPEC.md §4.2). `error` is the failure class.",
  cases: textCases.map((c) => ({
    name: c.name,
    input: c.input,
    text: attempt(() => normalizeText(c.input)),
    inline: attempt(() => normalizeInline(c.input)),
  })),
});

// ---- 2. content canonicalization -----------------------------------------------------------------

const contentCases: { name: string; input: ContentInput }[] = [
  {
    name: "minimal",
    input: { blocks: [{ type: "paragraph", text: "Hello" }] },
  },
  {
    name: "terms of service",
    input: {
      blocks: [
        { type: "heading", level: 1, text: "  Terms of   Service " },
        {
          type: "paragraph",
          text: "These Terms govern your use of the service.\r\nPlease read them carefully.",
        },
        { type: "heading", level: 2, text: "1. Acceptance" },
        {
          type: "list",
          ordered: true,
          items: ["You are 18 or older.", "You accept\nthese terms."],
        },
        { type: "list", ordered: false, items: ["No abuse", "No scraping"] },
        { type: "heading", level: 3, text: "1.1 Définitions" },
        { type: "paragraph", text: 'Le "Service" désigne…' },
      ],
      changeSummary: "Added section 1.1\r\n\r\nClarified age requirement.",
    },
  },
  {
    name: "with attachment",
    input: {
      blocks: [{ type: "paragraph", text: "See Annex A." }],
      attachments: [
        {
          mediaType: "application/pdf",
          name: "annex-a.pdf",
          sha256: toHex(fixedBytes(0xab, 32)),
          size: 48213,
        },
      ],
      changeSummary: null,
    },
  },
  {
    name: "multilingual",
    input: {
      blocks: [
        { type: "heading", level: 1, text: "利用規約" },
        { type: "paragraph", text: "شروط الخدمة" },
        { type: "paragraph", text: "Cafe\u{301} 👩\u{200D}💻" },
      ],
    },
  },
];

write("content.json", {
  description: "stele-content-v1 canonicalization: canonical bytes (UTF-8 JSON) and content hash.",
  cases: contentCases.map((c) => {
    const canonical = canonicalizeContent(c.input);
    const bytes = serializeContent(canonical);
    return {
      name: c.name,
      input: c.input,
      canonical: fromUtf8(bytes),
      contentHash: toHex(contentHash(bytes)),
    };
  }),
  invalidCanonical: [
    {
      name: "whitespace",
      bytes:
        '{ "attachments":[],"blocks":[{"text":"a","type":"paragraph"}],"changeSummary":null,"format":"stele-content-v1"}',
    },
    {
      name: "key order",
      bytes:
        '{"attachments":[],"blocks":[{"type":"paragraph","text":"a"}],"changeSummary":null,"format":"stele-content-v1"}',
    },
    {
      name: "extra key",
      bytes:
        '{"attachments":[],"blocks":[{"text":"a","type":"paragraph"}],"changeSummary":null,"extra":true,"format":"stele-content-v1"}',
    },
    {
      name: "non-nfc text",
      bytes:
        '{"attachments":[],"blocks":[{"text":"Cafe\u{301}","type":"paragraph"}],"changeSummary":null,"format":"stele-content-v1"}',
    },
    {
      name: "uncollapsed spaces",
      bytes:
        '{"attachments":[],"blocks":[{"text":"a  b","type":"paragraph"}],"changeSummary":null,"format":"stele-content-v1"}',
    },
    {
      name: "duplicate key",
      bytes:
        '{"attachments":[],"blocks":[{"text":"a","type":"paragraph"}],"changeSummary":null,"format":"stele-content-v1","format":"stele-content-v1"}',
    },
    {
      name: "wrong format",
      bytes:
        '{"attachments":[],"blocks":[{"text":"a","type":"paragraph"}],"changeSummary":null,"format":"stele-content-v2"}',
    },
    {
      name: "empty blocks",
      bytes: '{"attachments":[],"blocks":[],"changeSummary":null,"format":"stele-content-v1"}',
    },
    {
      name: "float level",
      bytes:
        '{"attachments":[],"blocks":[{"level":1.0,"text":"a","type":"heading"}],"changeSummary":null,"format":"stele-content-v1"}',
    },
    {
      name: "escaped unicode",
      bytes:
        '{"attachments":[],"blocks":[{"text":"\\u0061","type":"paragraph"}],"changeSummary":null,"format":"stele-content-v1"}',
    },
  ],
});

// ---- 3. version fingerprints -----------------------------------------------------------------------

const program = "6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV";
const org = toBase58(seed32("organization"));
const doc = toBase58(seed32("document"));
const v1Fields: VersionFields = {
  chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  program,
  organization: org,
  document: doc,
  documentType: "terms-of-service",
  locale: "en-US",
  version: 1,
  previousVersionHash: null,
  title: "Terms of Service",
  versionLabel: "1.0",
  effectiveAt: 0,
  contentHash: fixedBytes(0x11, 32),
};
const v1 = versionHash(v1Fields);
const v2Fields: VersionFields = {
  ...v1Fields,
  version: 2,
  previousVersionHash: v1,
  title: 'Terms of "Service" — Europe',
  versionLabel: "2.0-eu",
  effectiveAt: 1_798_761_600,
  contentHash: fixedBytes(0x22, 32),
};
const mainnetFields: VersionFields = {
  ...v1Fields,
  chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};
const encodeFields = (f: VersionFields) => ({
  ...f,
  effectiveAt: Number(f.effectiveAt),
  previousVersionHash: f.previousVersionHash ? toHex(f.previousVersionHash) : null,
  contentHash: toHex(f.contentHash),
});

write("version.json", {
  description:
    "stele-version-v1 JSON and fingerprint. The program computes the same bytes on-chain.",
  cases: [
    { name: "version 1, effective upon publication", fields: v1Fields },
    { name: "version 2 chained, escaped title, effective date", fields: v2Fields },
    { name: "same as version 1 but mainnet (network separation)", fields: mainnetFields },
  ].map((c) => ({
    name: c.name,
    fields: encodeFields(c.fields),
    json: versionJson(c.fields),
    versionHash: toHex(versionHash(c.fields)),
  })),
});

// ---- 4. RFC 3339 ---------------------------------------------------------------------------------------

write("rfc3339.json", {
  description: "Unix seconds → YYYY-MM-DDTHH:MM:SSZ (proleptic Gregorian, UTC).",
  cases: [
    0, 59, 86_399, 951_782_400, 1_700_000_000, 1_790_000_000, 4_107_542_399, 4_107_542_400,
    253_402_300_799,
  ].map((t) => ({
    timestamp: t,
    formatted: formatRfc3339(t),
  })),
  invalid: [-1, 253_402_300_800],
});

// ---- 5. acceptance messages --------------------------------------------------------------------------

const signerSecret = seed32("acceptance-signer");
const signerPublic = ed25519.getPublicKey(signerSecret);
const messageCases = [
  {
    name: "verified organization",
    fields: {
      orgName: "Acme Inc.",
      orgVerifiedDomain: "acme.example",
      title: "Terms of Service",
      versionLabel: "3.2",
      version: 3,
      versionHash: toHex(versionHash(v2Fields)),
      signer: toBase58(signerPublic),
      networkLabel: "Solana Devnet",
      issuedAt: 1_790_000_000,
      expiresAt: 1_790_000_600,
      shardId: 0,
      nonceIndex: 42,
      nonceTag: "0123456789abcdef",
    },
    requestDomain: "app.acme.example",
  },
  {
    name: "unverified organization with parentheses in name",
    fields: {
      orgName: "Acme (Europe) GmbH",
      orgVerifiedDomain: null,
      title: "Allgemeine Geschäftsbedingungen",
      versionLabel: "2026.09",
      version: 12,
      versionHash: toHex(v1),
      signer: toBase58(signerPublic),
      networkLabel: "Solana Mainnet",
      issuedAt: 1_800_000_000,
      expiresAt: 1_800_003_600,
      shardId: 65_535,
      nonceIndex: 65_535,
      nonceTag: "ffffffffffffffff",
    },
    requestDomain: "localhost",
  },
];

write("acceptance-message.json", {
  description: "stele-acceptance-v1 messages. The program rebuilds lines 1–11 from chain state.",
  cases: messageCases.map((c) => {
    const message = buildAcceptanceMessage(
      {
        ...c.fields,
        versionHash: Uint8Array.from(Buffer.from(c.fields.versionHash, "hex")),
        nonceTag: Uint8Array.from(Buffer.from(c.fields.nonceTag, "hex")),
      },
      c.requestDomain,
    );
    const signature = ed25519.sign(utf8(message), signerSecret);
    return { ...c, message, messageHash: toHex(messageHash(message)), signature: toHex(signature) };
  }),
  signerPublicKey: toHex(signerPublic),
});

// ---- 6. acceptance id + accumulator ---------------------------------------------------------------------

const versionAccount = seed32("version-account");
let acc: Uint8Array = new Uint8Array(32);
const chain = [0, 1, 2].map((i) => {
  const msgHash = messageHash(`message ${i}`);
  const sig = fixedBytes(i + 1, 64);
  const id = acceptanceId(versionAccount, signerPublic, msgHash, sig);
  acc = accumulate(acc, id);
  return {
    messageHash: toHex(msgHash),
    signature: toHex(sig),
    acceptanceId: toHex(id),
    accumulatorAfter: toHex(acc),
  };
});
write("acceptance-id.json", {
  description: "acceptance_id and shard accumulator (initial accumulator = 32 zero bytes).",
  version: toHex(versionAccount),
  signer: toHex(signerPublic),
  chain,
});

// ---- 7. field validation ---------------------------------------------------------------------------------

const validators: Record<string, [(s: string) => void, string[]]> = {
  orgName: [
    validateOrgName,
    [
      "Acme Inc.",
      "株式会社アクメ",
      "x".repeat(40),
      "",
      " Acme",
      "Acme ",
      "Acme  Inc",
      "A\nB",
      "Acme\u{202E}",
      "x".repeat(41),
      "a\u{200B}b",
    ],
  ],
  title: [
    validateTitle,
    ["Terms of Service", 'Terms "Service"', "é".repeat(30), "é".repeat(31), "Terms\tof"],
  ],
  slug: [
    validateSlug,
    ["terms-of-service", "tos2", "-tos", "tos-", "terms--of", "Terms", "terms_of", "a".repeat(33)],
  ],
  documentType: [validateDocumentType, ["privacy-policy", "Privacy"]],
  locale: [
    validateLocale,
    ["en", "en-US", "zh-Hant-TW", "es-419", "sr-Latn", "EN", "en-us", "en-US-x", "e", "en_US"],
  ],
  versionLabel: [
    validateVersionLabel,
    ["3.2", "v1.0.0-rc.1", "2026.09+eu", ".1", "1 0", "12345678901234567"],
  ],
  storageUri: [
    validateStorageUri,
    [
      "ar://abc",
      "ipfs://bafy",
      "https://cdn.example/x",
      "http://cdn.example/x",
      "javascript:alert(1)",
      "ar://",
      "ar://a b",
    ],
  ],
  verifiedDomain: [
    validateVerifiedDomain,
    [
      "acme.example",
      "xn--80ak6aa92e.com",
      "localhost",
      "Acme.example",
      "acme",
      "-a.example",
      "a.example.",
      "10.0.0.1",
    ],
  ],
  requestDomain: [
    validateRequestDomain,
    ["localhost", "app.acme.example", "acme.example:443", "a.example\nEvil: x"],
  ],
  chainId: [
    validateChainId,
    ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "solana:localnet", "eip155:1", "solana:"],
  ],
  networkLabel: [validateNetworkLabel, ["Solana Mainnet", "Solana  Mainnet", "Solana-Mainnet", ""]],
};

write("validation.json", {
  description:
    "Field validation (PROTOCOL_SPEC.md §3): `valid` must match in every implementation.",
  fields: Object.fromEntries(
    Object.entries(validators).map(([field, [fn, values]]) => [
      field,
      values.map((value) => ({ value, valid: !("error" in attempt(() => fn(value))) })),
    ]),
  ),
});

// ---- 8. proofs: anchor messages, proof ids, statements ------------------------------------------------

const proofOrg = toBase58(seed32("proof-organization"));
const proofCases = [
  {
    name: "purchase, verified organization",
    fields: {
      proofType: 1,
      orgName: "Northwind Shop",
      orgVerifiedDomain: "northwind.example",
      organization: proofOrg,
      statementHash: toHex(seed32("statement-1")),
      signer: toBase58(signerPublic),
      networkLabel: "Solana Devnet",
      chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      issuedAt: 1_790_000_000,
      expiresAt: 1_790_000_600,
      shardId: 0,
      nonceIndex: 7,
      nonceTag: "0123456789abcdef",
    },
    requestDomain: "shop.northwind.example",
  },
  {
    name: "subscription cancellation, unverified, maximum nonce",
    fields: {
      proofType: 13,
      orgName: "Ünïcode Ltd",
      orgVerifiedDomain: null,
      organization: proofOrg,
      statementHash: toHex(seed32("statement-2")),
      signer: toBase58(signerPublic),
      networkLabel: "Solana Localnet",
      chainId: "solana:localnet",
      issuedAt: 1_800_000_000,
      expiresAt: 1_800_003_600,
      shardId: 65_535,
      nonceIndex: 65_535,
      nonceTag: "ffffffffffffffff",
    },
    requestDomain: "localhost",
  },
];

write("proof-message.json", {
  description:
    "stele-proof-v1 anchor messages and proof ids. The program rebuilds lines 1–12 from chain state.",
  cases: proofCases.map((c) => {
    const message = buildProofMessage(
      {
        ...c.fields,
        statementHash: fromHex(c.fields.statementHash, 32),
        nonceTag: fromHex(c.fields.nonceTag, 8),
      },
      c.requestDomain,
    );
    const signature = ed25519.sign(utf8(message), signerSecret);
    const id = proofId(
      fromBase58(c.fields.organization),
      signerPublic,
      fromHex(c.fields.statementHash, 32),
      messageHash(message),
      signature,
    );
    return {
      ...c,
      message,
      messageHash: toHex(messageHash(message)),
      signature: toHex(signature),
      proofId: toHex(id),
    };
  }),
  signerPublicKey: toHex(signerPublic),
});

const statement = parseStatement({
  format: "stele-statement-v1",
  type: "PURCHASE",
  network: {
    chainId: "solana:localnet",
    programId: "6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV",
  },
  organization: { address: proofOrg, name: "Northwind Shop", domain: "northwind.example" },
  reference: "order-1042",
  createdAt: "2026-09-21T14:13:20Z",
  summary: "Purchase of 2 items from Northwind Shop",
  details: {
    currency: "EUR",
    items: [
      { sku: "TEA-01", name: "Earl Grey (250 g)", quantity: 2, unitPrice: "6.50", total: "13.00" },
      { name: "Café crème — «bio»", quantity: 1, unitPrice: "4.25", total: "4.25" },
    ],
    subtotal: "17.25",
    shipping: "3.90",
    total: "21.15",
    paymentMethod: "Visa •••• 4242",
    buyer: { commitment: commitmentFor("buyer@example.com", toHex(seed32("buyer-salt"))) },
  },
  salt: toHex(seed32("statement-salt")),
});
write("statement.json", {
  description:
    "stele-statement-v1 canonical serialization (sorted keys, no whitespace) and statement hash.",
  statement,
  canonical: fromUtf8(serializeStatement(statement)),
  statementHash: toHex(statementHash(statement)),
  commitment: {
    value: "buyer@example.com",
    salt: toHex(seed32("buyer-salt")),
    commitment: commitmentFor("buyer@example.com", toHex(seed32("buyer-salt"))),
  },
});

// ---- stele/2 native passkeys (P-256) -------------------------------------------------------------

const p256Secret = seed32("passkey-p256-signer");
const p256Public = p256.getPublicKey(p256Secret, true);
const p256Next = p256.getPublicKey(seed32("passkey-p256-next"), true);
const rpId = "acme.example";
const passkeyCases = [
  {
    name: "verified organization",
    fields: {
      orgName: "Acme Inc.",
      orgVerifiedDomain: "acme.example",
      title: "Terms of Service",
      versionLabel: "3.2",
      version: 3,
      versionHash: toHex(seed32("version-hash")),
      networkLabel: "Solana Devnet",
      issuedAt: 1_790_000_000,
      expiresAt: 1_790_000_600,
      shardId: 0,
      nonceIndex: 42,
      nonceTag: "0123456789abcdef",
    },
    requestDomain: "shop.acme.example",
    origin: "https://shop.acme.example",
  },
  {
    name: "unverified organization on localhost",
    fields: {
      orgName: "Ünïcode Ltd",
      orgVerifiedDomain: null,
      title: "Privacy Policy",
      versionLabel: "1.0-beta",
      version: 1,
      versionHash: toHex(seed32("version-hash-2")),
      networkLabel: "Solana Localnet",
      issuedAt: 1_800_000_000,
      expiresAt: 1_800_003_600,
      shardId: 65_535,
      nonceIndex: 65_535,
      nonceTag: "ffffffffffffffff",
    },
    requestDomain: "localhost",
    origin: "http://localhost:3000",
  },
];

const authData = (rp: string, flags: number, extra: number[] = []) =>
  concatBytes(
    sha256(utf8(rp)),
    Uint8Array.of(flags),
    Uint8Array.of(0, 0, 0, 5),
    Uint8Array.from(extra),
  );
const clientDataFor = (challenge: Uint8Array, origin: string, tail = ',"crossOrigin":false}') =>
  `{"type":"webauthn.get","challenge":"${toBase64Url(challenge)}","origin":"${origin}"${tail}`;
const outcome = <T>(f: () => T): { ok: T } | { error: string } => {
  try {
    return { ok: f() };
  } catch (e) {
    if (e instanceof PasskeyCheckFailure) return { error: e.code };
    throw e;
  }
};

const passkeyOrg = toBase58(seed32("passkey-organization"));
const commitment = seed32("passkey-account");
const vectorChallenge = seed32("passkey-check-challenge");
write("passkey-p256.json", {
  description:
    "stele/2 native passkey vectors: stele-acceptance-v2 messages, WebAuthn challenges and signed bytes, acceptance ids, enrollment and rotation statements, and the clientDataJSON / authenticatorData rules (PROTOCOL_SPEC.md §17).",
  signerPublicKey: toHex(p256Public),
  rpId,
  acceptances: passkeyCases.map((c) => {
    const message = buildPasskeyAcceptanceMessage(
      {
        ...c.fields,
        versionHash: fromHex(c.fields.versionHash, 32),
        nonceTag: fromHex(c.fields.nonceTag, 8),
        signer: p256Public,
      },
      c.requestDomain,
    );
    const challenge = webauthnChallenge(PASSKEY_ACCEPTANCE_TAG, message);
    const clientData = clientDataFor(challenge, c.origin);
    const auth = authData(c.requestDomain === "localhost" ? "localhost" : rpId, 0x05);
    const signed = concatBytes(auth, sha256(utf8(clientData)));
    const signature = p256.sign(signed, p256Secret, { prehash: true, lowS: true });
    return {
      ...c,
      message,
      messageHash: toHex(sha256(utf8(message))),
      challenge: toHex(challenge),
      clientDataJSON: clientData,
      authenticatorData: toHex(auth),
      signedBytes: toHex(signed),
      signature: toHex(signature),
      acceptanceId: toHex(
        passkeyAcceptanceId(
          seed32("version-account"),
          p256Public,
          sha256(utf8(message)),
          signature,
        ),
      ),
      versionAccount: toHex(seed32("version-account")),
    };
  }),
  enrollment: (() => {
    const statement = buildEnrollmentStatement({
      organization: passkeyOrg as never,
      accountCommitment: commitment,
      signer: p256Public,
      rpId,
      networkLabel: "Solana Devnet",
      issuedAt: 1_790_000_000,
      expiresAt: 1_790_000_600,
    });
    return {
      organization: passkeyOrg,
      accountCommitment: toHex(commitment),
      statement,
      challenge: toHex(webauthnChallenge(PASSKEY_ENROLL_TAG, statement)),
    };
  })(),
  rotation: (() => {
    const statement = buildRotationStatement({
      organization: passkeyOrg as never,
      accountCommitment: commitment,
      previous: p256Public,
      next: p256Next,
      networkLabel: "Solana Devnet",
      issuedAt: 1_790_000_000,
      expiresAt: 1_790_000_600,
    });
    return {
      newSignerPublicKey: toHex(p256Next),
      statement,
      challenge: toHex(webauthnChallenge(PASSKEY_ROTATE_TAG, statement)),
    };
  })(),
  clientDataChecks: {
    challenge: toHex(vectorChallenge),
    requestDomain: "shop.acme.example",
    cases: [
      ["valid", clientDataFor(vectorChallenge, "https://shop.acme.example")],
      [
        "valid without crossOrigin",
        clientDataFor(vectorChallenge, "https://shop.acme.example", "}"),
      ],
      [
        "valid with extra keys",
        clientDataFor(
          vectorChallenge,
          "https://shop.acme.example",
          ',"crossOrigin":false,"other_keys_can_be_added_here":"x"}',
        ),
      ],
      ["wrong challenge", clientDataFor(seed32("other"), "https://shop.acme.example")],
      [
        "registration ceremony",
        clientDataFor(vectorChallenge, "https://shop.acme.example").replace(
          "webauthn.get",
          "webauthn.create",
        ),
      ],
      ["foreign origin", clientDataFor(vectorChallenge, "https://evil.example")],
      ["plain http", clientDataFor(vectorChallenge, "http://shop.acme.example")],
      ["origin with port", clientDataFor(vectorChallenge, "https://shop.acme.example:8443")],
      [
        "cross-origin frame",
        clientDataFor(vectorChallenge, "https://shop.acme.example", ',"crossOrigin":true}'),
      ],
      [
        "topOrigin present",
        clientDataFor(
          vectorChallenge,
          "https://shop.acme.example",
          ',"crossOrigin":false,"topOrigin":"https://evil.example"}',
        ),
      ],
      [
        "bytes glued after origin",
        clientDataFor(vectorChallenge, "https://shop.acme.example", "x}"),
      ],
      [
        "whitespace",
        clientDataFor(vectorChallenge, "https://shop.acme.example").replace('"type":', '"type": '),
      ],
    ].map(([name, clientData]) => ({
      name,
      clientDataJSON: clientData,
      expected: outcome(() =>
        checkClientData(utf8(clientData!), vectorChallenge, "shop.acme.example"),
      ),
    })),
  },
  authenticatorDataChecks: {
    rpId,
    cases: [
      ["user present and verified", authData(rpId, 0x05)],
      ["backup flags are ignored", authData(rpId, 0x1d)],
      ["extension data, flagged", authData(rpId, 0x85, [0xa0])],
      ["presence only", authData(rpId, 0x01)],
      ["verification only", authData(rpId, 0x04)],
      ["another relying party", authData("evil.example", 0x05)],
      ["attested credential data", authData(rpId, 0x45)],
      ["undeclared extension bytes", authData(rpId, 0x05, [0xa0])],
      ["truncated", authData(rpId, 0x05).subarray(0, 36)],
    ].map(([name, bytes]) => ({
      name,
      authenticatorData: toHex(bytes as Uint8Array),
      expected: outcome(() => checkAuthenticatorData(bytes as Uint8Array, rpId)),
    })),
  },
});

// ---- MERKLE_BATCHED evidence mode -------------------------------------------------------------------

const batchOrg = toBase58(seed32("batch-organization"));
const batchShard = toBase58(seed32("batch-shard"));
write("batch.json", {
  description:
    "MERKLE_BATCHED vectors: leaf and node hashing, roots with promoted unpaired nodes, every inclusion proof, and the anchored batch id (PROTOCOL_SPEC.md §17.9).",
  trees: [1, 2, 3, 4, 5, 7, 8, 13].map((n) => {
    const leaves = Array.from({ length: n }, (_, i) => {
      const id = seed32(`batch-acceptance-${n}-${i}`);
      const protocol = (i % 2 === 0 ? 1 : 2) as 1 | 2;
      return { protocol, acceptanceId: toHex(id), leaf: toHex(batchLeafHash(protocol, id)) };
    });
    const hashes = leaves.map((l) => fromHex(l.leaf, 32));
    return {
      leafCount: n,
      leaves,
      root: toHex(merkleRoot(hashes)),
      proofs: hashes.map((_, i) => merkleProof(hashes, i).map(toHex)),
    };
  }),
  batchIds: [0n, 7n, 18_446_744_073_709_551_615n].map((sequence) => ({
    organization: batchOrg,
    nonceShard: batchShard,
    root: toHex(seed32("batch-root")),
    leafCount: 64,
    sequence: sequence.toString(),
    batchId: toHex(
      batchId(batchOrg as never, batchShard as never, seed32("batch-root"), 64, sequence),
    ),
  })),
});
