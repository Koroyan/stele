/**
 * `stele-statement-v1` — the off-chain statement a proof commits to (PROTOCOL_SPEC.md §12.2).
 *
 * A statement is a JSON object serialized canonically (keys sorted by UTF-16 code units, no
 * insignificant whitespace, integers only, NFC strings). Its SHA-256 is the `statement_hash`
 * recorded on-chain and shown on the `Statement:` line the customer signs.
 *
 * Privacy: the statement never goes on-chain. It always carries a random 256-bit `salt`, so the
 * on-chain hash cannot be confirmed by guessing likely contents. Fields that should not travel with
 * every copy of a receipt (a buyer's email or address) can be replaced by salted commitments; the
 * opening is kept by the parties and disclosed only when needed.
 *
 * Validation is hand-written (no schema library) so that browsers confirming a purchase load only a
 * few kilobytes.
 */
import { STATEMENT_FORMAT } from "./constants";
import { fromUtf8, toHex, utf8 } from "./encoding";
import { ProtocolError } from "./errors";
import { sha256, sha256v } from "./hash";
import { PROOF_TYPES, type ProofTypeName } from "./proof";
import { formatRfc3339, parseRfc3339 } from "./time";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export const MAX_STATEMENT_BYTES = 16_384;

function canonicalize(v: unknown, path: string): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v))
      throw new ProtocolError(
        "INVALID_STRUCTURE",
        `${path}: numbers must be safe integers (use decimal strings for amounts)`,
      );
    return String(v);
  }
  if (typeof v === "string") {
    if (v !== v.normalize("NFC"))
      throw new ProtocolError("NON_CANONICAL_TEXT", `${path}: text must be NFC`);
    // Lone surrogates cannot be encoded as UTF-8.
    if (/[\uD800-\uDFFF]/.test(v.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")))
      throw new ProtocolError("NON_CANONICAL_TEXT", `${path}: invalid Unicode`);
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map((x, i) => canonicalize(x, `${path}[${i}]`)).join(",")}]`;
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    for (const [k, x] of entries)
      if (x === undefined) throw new ProtocolError("INVALID_STRUCTURE", `${path}.${k}: undefined`);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${canonicalize(k, path)}:${canonicalize(x, `${path}.${k}`)}`).join(",")}}`;
  }
  throw new ProtocolError("INVALID_STRUCTURE", `${path}: unsupported value`);
}

/** Canonical UTF-8 bytes of a JSON value. */
export function canonicalJson(v: unknown): Uint8Array {
  return utf8(canonicalize(v, "$"));
}

// ---- model ------------------------------------------------------------------------------------------

export interface Commitment {
  /** `sha256:<hex>` — a salted commitment to a value that is not disclosed in the statement. */
  commitment: string;
}

export interface LineItem {
  sku?: string;
  name: string;
  quantity: number;
  unitPrice: string;
  total: string;
}

/** Details of PURCHASE / SALE / ORDER / RECEIPT / INVOICE statements (amounts are decimal strings). */
export interface CommerceDetails {
  currency: string;
  items: LineItem[];
  subtotal: string;
  tax?: string;
  shipping?: string;
  discount?: string;
  total: string;
  /** Display-safe payment description, e.g. "Visa •••• 4242". Never a full card number. */
  paymentMethod?: string;
  buyer?: Commitment;
  deliveryAddress?: Commitment;
}

/** A policy in force when the statement was made, linked to its acceptance record. */
export interface PolicyRef {
  title: string;
  version: number;
  fingerprint: string;
  acceptanceId?: string;
}

export interface Statement {
  format: typeof STATEMENT_FORMAT;
  type: ProofTypeName;
  network: { chainId: string; programId: string };
  organization: { address: string; name: string; domain: string | null };
  /** The organization's reference for the transaction (order number, invoice number…). */
  reference: string;
  createdAt: string;
  /** One sentence shown to the signer above the details. */
  summary: string;
  details: { [k: string]: JsonValue };
  policies?: PolicyRef[];
  /** For REFUND / CANCELLATION / RETURN / DELIVERY: the proof this one refers to. */
  relatesTo?: string;
  salt: string;
}

// ---- validation -------------------------------------------------------------------------------------

const AMOUNT = /^-?(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/;
const HEX32 = /^[0-9a-f]{64}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const COMMITMENT = /^sha256:[0-9a-f]{64}$/;

class Check {
  constructor(private readonly prefix: string) {}
  fail(path: string, why: string): never {
    throw new ProtocolError("INVALID_STRUCTURE", `${this.prefix}${path || "(root)"}: ${why}`);
  }
  object(v: unknown, path: string, allowed: string[], required: string[]): Record<string, unknown> {
    if (typeof v !== "object" || v === null || Array.isArray(v)) this.fail(path, "expected object");
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o))
      if (!allowed.includes(k)) this.fail(path ? `${path}.${k}` : k, "unrecognized key");
    for (const k of required)
      if (o[k] === undefined) this.fail(path ? `${path}.${k}` : k, "required");
    return o;
  }
  string(
    v: unknown,
    path: string,
    opts: { min?: number; max?: number; re?: RegExp; what?: string } = {},
  ): string {
    if (typeof v !== "string") this.fail(path, "expected string");
    const s = v as string;
    if (s.length < (opts.min ?? 1)) this.fail(path, "too short");
    if (opts.max !== undefined && s.length > opts.max) this.fail(path, "too long");
    if (opts.re && !opts.re.test(s)) this.fail(path, `expected ${opts.what ?? "a valid value"}`);
    return s;
  }
  int(v: unknown, path: string, min = 0): number {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min)
      this.fail(path, `expected an integer ≥ ${min}`);
    return v as number;
  }
  optional<T>(v: unknown, f: (x: unknown) => T): T | undefined {
    return v === undefined ? undefined : f(v);
  }
}

const TYPE_NAMES = new Set<string>(PROOF_TYPES.map((t) => t.name));
const COMMERCE_TYPES = new Set<string>(["PURCHASE", "SALE", "ORDER", "RECEIPT", "INVOICE"]);

function rfc3339(c: Check, v: unknown, path: string): string {
  const s = c.string(v, path, { max: 20 });
  try {
    if (formatRfc3339(parseRfc3339(s)) === s) return s;
  } catch {
    // fall through
  }
  return c.fail(path, "expected an RFC 3339 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)");
}

function commitment(c: Check, v: unknown, path: string): Commitment {
  const o = c.object(v, path, ["commitment"], ["commitment"]);
  return {
    commitment: c.string(o.commitment, `${path}.commitment`, {
      re: COMMITMENT,
      what: "sha256:<hex>",
    }),
  };
}

/** Validates the details of a commerce statement (structure only; see `checkCommerceTotals`). */
export function parseCommerceDetails(v: unknown, prefix = ""): CommerceDetails {
  const c = new Check(prefix);
  const o = c.object(
    v,
    "",
    [
      "currency",
      "items",
      "subtotal",
      "tax",
      "shipping",
      "discount",
      "total",
      "paymentMethod",
      "buyer",
      "deliveryAddress",
    ],
    ["currency", "items", "subtotal", "total"],
  );
  const amount = (x: unknown, p: string) =>
    c.string(x, p, { re: AMOUNT, what: "a decimal amount string" });
  if (!Array.isArray(o.items) || o.items.length < 1 || o.items.length > 100)
    c.fail("items", "expected 1–100 line items");
  const items = (o.items as unknown[]).map((item, i): LineItem => {
    const p = `items.${i}`;
    const it = c.object(
      item,
      p,
      ["sku", "name", "quantity", "unitPrice", "total"],
      ["name", "quantity", "unitPrice", "total"],
    );
    const out: LineItem = {
      name: c.string(it.name, `${p}.name`, { max: 200 }),
      quantity: c.int(it.quantity, `${p}.quantity`, 1),
      unitPrice: amount(it.unitPrice, `${p}.unitPrice`),
      total: amount(it.total, `${p}.total`),
    };
    const sku = c.optional(it.sku, (x) => c.string(x, `${p}.sku`, { max: 64 }));
    if (sku !== undefined) out.sku = sku;
    return out;
  });
  const d: CommerceDetails = {
    currency: c.string(o.currency, "currency", { re: /^[A-Z]{3}$/, what: "an ISO 4217 code" }),
    items,
    subtotal: amount(o.subtotal, "subtotal"),
    total: amount(o.total, "total"),
  };
  for (const k of ["tax", "shipping", "discount"] as const) {
    const x = c.optional(o[k], (y) => amount(y, k));
    if (x !== undefined) d[k] = x;
  }
  const pm = c.optional(o.paymentMethod, (x) => c.string(x, "paymentMethod", { max: 64 }));
  if (pm !== undefined) d.paymentMethod = pm;
  if (o.buyer !== undefined) d.buyer = commitment(c, o.buyer, "buyer");
  if (o.deliveryAddress !== undefined)
    d.deliveryAddress = commitment(c, o.deliveryAddress, "deliveryAddress");
  return d;
}

/** Validates an untrusted statement object (structure, type-specific details, size). */
export function parseStatement(json: unknown): Statement {
  const c = new Check("invalid statement: ");
  const o = c.object(
    json,
    "",
    [
      "format",
      "type",
      "network",
      "organization",
      "reference",
      "createdAt",
      "summary",
      "details",
      "policies",
      "relatesTo",
      "salt",
    ],
    [
      "format",
      "type",
      "network",
      "organization",
      "reference",
      "createdAt",
      "summary",
      "details",
      "salt",
    ],
  );
  if (o.format !== STATEMENT_FORMAT) c.fail("format", `expected "${STATEMENT_FORMAT}"`);
  const type = c.string(o.type, "type");
  if (!TYPE_NAMES.has(type)) c.fail("type", "unknown proof type");
  const net = c.object(o.network, "network", ["chainId", "programId"], ["chainId", "programId"]);
  const org = c.object(
    o.organization,
    "organization",
    ["address", "name", "domain"],
    ["address", "name"],
  );
  if (!("domain" in org)) c.fail("organization.domain", "required (null when unverified)");
  if (typeof o.details !== "object" || o.details === null || Array.isArray(o.details))
    c.fail("details", "expected object");
  const s: Statement = {
    format: STATEMENT_FORMAT,
    type: type as ProofTypeName,
    network: {
      chainId: c.string(net.chainId, "network.chainId", { max: 39 }),
      programId: c.string(net.programId, "network.programId", {
        re: BASE58,
        what: "a base58 address",
      }),
    },
    organization: {
      address: c.string(org.address, "organization.address", {
        re: BASE58,
        what: "a base58 address",
      }),
      name: c.string(org.name, "organization.name", { max: 40 }),
      domain: org.domain === null ? null : c.string(org.domain, "organization.domain", { max: 48 }),
    },
    reference: c.string(o.reference, "reference", { max: 128 }),
    createdAt: rfc3339(c, o.createdAt, "createdAt"),
    summary: c.string(o.summary, "summary", { max: 280 }),
    details: o.details as Statement["details"],
    salt: c.string(o.salt, "salt", { re: HEX32, what: "32 bytes of hex" }),
  };
  if (o.policies !== undefined) {
    if (!Array.isArray(o.policies) || o.policies.length > 10)
      c.fail("policies", "expected at most 10 policies");
    s.policies = (o.policies as unknown[]).map((p, i) => {
      const path = `policies.${i}`;
      const x = c.object(
        p,
        path,
        ["title", "version", "fingerprint", "acceptanceId"],
        ["title", "version", "fingerprint"],
      );
      const ref: PolicyRef = {
        title: c.string(x.title, `${path}.title`, { max: 60 }),
        version: c.int(x.version, `${path}.version`, 1),
        fingerprint: c.string(x.fingerprint, `${path}.fingerprint`, {
          re: HEX32,
          what: "32 bytes of hex",
        }),
      };
      const id = c.optional(x.acceptanceId, (y) =>
        c.string(y, `${path}.acceptanceId`, { re: HEX32, what: "32 bytes of hex" }),
      );
      if (id !== undefined) ref.acceptanceId = id;
      return ref;
    });
  }
  if (o.relatesTo !== undefined)
    s.relatesTo = c.string(o.relatesTo, "relatesTo", { re: HEX32, what: "a proof id" });
  if (COMMERCE_TYPES.has(s.type))
    parseCommerceDetails(s.details, `invalid ${s.type.toLowerCase()} details: `);
  if (serializeStatement(s).length > MAX_STATEMENT_BYTES)
    throw new ProtocolError("LIMIT_EXCEEDED", `statement exceeds ${MAX_STATEMENT_BYTES} bytes`);
  return s;
}

export function serializeStatement(s: Statement): Uint8Array {
  return canonicalJson(s);
}

/** `statement_hash` = SHA-256 of the canonical statement bytes. */
export function statementHash(s: Statement): Uint8Array {
  return sha256(serializeStatement(s));
}

/** Parses canonical statement bytes and rejects any non-canonical encoding. */
export function parseCanonicalStatement(bytes: Uint8Array): Statement {
  let json: unknown;
  try {
    json = JSON.parse(fromUtf8(bytes));
  } catch {
    throw new ProtocolError("INVALID_JSON", "statement is not valid JSON");
  }
  const s = parseStatement(json);
  const canonical = serializeStatement(s);
  if (canonical.length !== bytes.length || !canonical.every((b, i) => b === bytes[i]))
    throw new ProtocolError("NON_CANONICAL_BYTES", "statement bytes are not canonical");
  return s;
}

export function newSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** A salted commitment to `value` plus the opening needed to prove it later. */
export function commit(value: string): {
  commitment: string;
  opening: { value: string; salt: string };
} {
  const salt = newSalt();
  return { commitment: commitmentFor(value, salt), opening: { value, salt } };
}

export function commitmentFor(value: string, saltHex: string): string {
  return `sha256:${toHex(sha256v(utf8("stele:v1:commitment\u0000"), utf8(saltHex), utf8(value)))}`;
}

export function openCommitment(
  commitment: string,
  opening: { value: string; salt: string },
): boolean {
  return commitmentFor(opening.value, opening.salt) === commitment;
}

/** Sums line items and checks the totals (exact decimal arithmetic in 1e-8 units). */
export function checkCommerceTotals(d: CommerceDetails): string | null {
  const units = (a: string | undefined) => {
    if (a === undefined) return 0n;
    const neg = a.startsWith("-");
    const [w, f = ""] = (neg ? a.slice(1) : a).split(".");
    const v = BigInt(w!) * 100_000_000n + BigInt(f.padEnd(8, "0"));
    return neg ? -v : v;
  };
  for (const [i, item] of d.items.entries())
    if (units(item.unitPrice) * BigInt(item.quantity) !== units(item.total))
      return `item ${i + 1}: ${item.quantity} × ${item.unitPrice} ≠ ${item.total}`;
  const subtotal = d.items.reduce((n, item) => n + units(item.total), 0n);
  if (subtotal !== units(d.subtotal)) return `subtotal ${d.subtotal} ≠ sum of items`;
  const total = subtotal + units(d.tax) + units(d.shipping) - units(d.discount);
  if (total !== units(d.total)) return `total ${d.total} ≠ subtotal + tax + shipping − discount`;
  return null;
}

/** Human-readable lines for showing a statement before it is signed. */
export function describeStatement(s: Statement): string[] {
  const lines = [
    s.summary,
    `Reference: ${s.reference}`,
    `Merchant: ${s.organization.name}${s.organization.domain ? ` (${s.organization.domain})` : ""}`,
  ];
  if (COMMERCE_TYPES.has(s.type)) {
    const d = s.details as unknown as CommerceDetails;
    for (const item of d.items)
      lines.push(`${item.quantity} × ${item.name} — ${item.total} ${d.currency}`);
    if (d.shipping) lines.push(`Shipping: ${d.shipping} ${d.currency}`);
    if (d.tax) lines.push(`Tax: ${d.tax} ${d.currency}`);
    if (d.discount) lines.push(`Discount: −${d.discount} ${d.currency}`);
    lines.push(`Total: ${d.total} ${d.currency}`);
    if (d.paymentMethod) lines.push(`Payment: ${d.paymentMethod}`);
  }
  for (const p of s.policies ?? [])
    lines.push(`Policy: ${p.title} v${p.version} (${p.fingerprint.slice(0, 12)}…)`);
  if (s.relatesTo) lines.push(`Relates to proof ${s.relatesTo.slice(0, 16)}…`);
  return lines;
}
