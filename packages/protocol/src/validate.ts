/**
 * Field validation (PROTOCOL_SPEC.md §3). Mirrors `crates/stele-core/src/validate.rs`.
 * Validators throw `ProtocolError`; `is*` helpers return booleans.
 */
import { LIMITS } from "./constants";
import { utf8Length } from "./encoding";
import { ProtocolError } from "./errors";
import { findForbidden, formatCodePoint, isLineBreakOrTab } from "./text";

function fail(
  code: ConstructorParameters<typeof ProtocolError>[0],
  field: string,
  detail: string,
): never {
  throw new ProtocolError(code, `${field}: ${detail}`);
}

function checkLength(field: string, s: string, max: number): void {
  if (s.length === 0) fail("EMPTY", field, "must not be empty");
  if (utf8Length(s) > max) fail("TOO_LONG", field, `must be at most ${max} bytes`);
}

export function validateDisplayString(field: string, s: string, max: number): void {
  checkLength(field, s, max);
  if (!s.isWellFormed()) fail("FORBIDDEN_CHARACTER", field, "contains a lone surrogate");
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (isLineBreakOrTab(cp)) fail("FORBIDDEN_CHARACTER", field, "must be a single line");
  }
  const bad = findForbidden(s);
  if (bad !== null)
    fail("FORBIDDEN_CHARACTER", field, `contains forbidden character ${formatCodePoint(bad)}`);
  if (s.startsWith(" ") || s.endsWith(" ") || s.includes("  ")) {
    fail("INVALID_WHITESPACE", field, "has leading, trailing or repeated spaces");
  }
}

export const validateOrgName = (s: string) =>
  validateDisplayString("organization name", s, LIMITS.orgName);
export const validateTitle = (s: string) => validateDisplayString("title", s, LIMITS.title);

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateSlug(s: string): void {
  checkLength("slug", s, LIMITS.slug);
  if (!KEBAB.test(s))
    fail("INVALID_FORMAT", "slug", "must be lowercase letters, digits and single hyphens");
}

export function validateDocumentType(s: string): void {
  checkLength("document type", s, LIMITS.documentType);
  if (!KEBAB.test(s))
    fail("INVALID_FORMAT", "document type", "must be lowercase letters, digits and single hyphens");
}

const LOCALE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$/;

export function validateLocale(s: string): void {
  checkLength("locale", s, LIMITS.locale);
  if (!LOCALE.test(s))
    fail("INVALID_FORMAT", "locale", "must look like en, en-US, zh-Hant-TW or es-419");
}

const VERSION_LABEL = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,15}$/;

export function validateVersionLabel(s: string): void {
  checkLength("version label", s, LIMITS.versionLabel);
  if (!VERSION_LABEL.test(s))
    fail("INVALID_FORMAT", "version label", "allowed characters: A-Z a-z 0-9 . _ + -");
}

export function validateStorageUri(s: string): void {
  checkLength("storage URI", s, LIMITS.storageUri);
  if (!/^[\x21-\x7e]+$/.test(s)) fail("INVALID_FORMAT", "storage URI", "must be printable ASCII");
  const prefix = ["ar://", "ipfs://", "https://"].find((p) => s.startsWith(p));
  if (!prefix || s.length === prefix.length) {
    fail("INVALID_FORMAT", "storage URI", "must start with ar://, ipfs:// or https://");
  }
}

const LABEL = /^[a-z0-9-]{1,63}$/;

export function validateHostname(
  field: string,
  s: string,
  max: number,
  allowLocalhost: boolean,
): void {
  checkLength(field, s, max);
  if (s === "localhost") {
    if (allowLocalhost) return;
    fail("INVALID_FORMAT", field, "localhost is not allowed");
  }
  const labels = s.split(".");
  if (labels.length < 2) fail("INVALID_FORMAT", field, "must have at least two labels");
  for (const label of labels) {
    if (!LABEL.test(label) || label.startsWith("-") || label.endsWith("-")) {
      fail("INVALID_FORMAT", field, "invalid label (lowercase LDH, punycode for IDNs)");
    }
  }
  if (/^[0-9]+$/.test(labels[labels.length - 1]!))
    fail("INVALID_FORMAT", field, "top-level label cannot be numeric");
}

export const validateVerifiedDomain = (s: string) =>
  validateHostname("domain", s, LIMITS.verifiedDomain, false);
export const validateRequestDomain = (s: string) =>
  validateHostname("request domain", s, LIMITS.requestDomain, true);

export function validateChainId(s: string): void {
  if (s.length > LIMITS.chainId || !/^solana:[A-Za-z0-9]{1,32}$/.test(s)) {
    fail("INVALID_FORMAT", "chain id", "must be a CAIP-2 Solana chain id");
  }
}

export function validateNetworkLabel(s: string): void {
  checkLength("network label", s, LIMITS.networkLabel);
  if (!/^[A-Za-z0-9 ]+$/.test(s))
    fail("INVALID_FORMAT", "network label", "allowed characters: letters, digits, space");
  if (s.startsWith(" ") || s.endsWith(" ") || s.includes("  ")) {
    fail("INVALID_WHITESPACE", "network label", "has leading, trailing or repeated spaces");
  }
}

/** Wraps a validator into a boolean predicate. */
export function isValid(validator: (s: string) => void, s: string): boolean {
  try {
    validator(s);
    return true;
  } catch {
    return false;
  }
}

/** Returns the validation error message or `null`. */
export function validationError(validator: (s: string) => void, s: string): string | null {
  try {
    validator(s);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
