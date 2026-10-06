/**
 * Forbidden code points `F` and text normalization (PROTOCOL_SPEC.md §3.1, §4.2).
 * Mirrors `crates/stele-core/src/text.rs` and `crates/stele-canonical/src/normalize.rs`.
 */
import { ProtocolError } from "./errors";

/** Whether code point `cp` is in the forbidden set `F`. */
export function isForbiddenCodePoint(cp: number): boolean {
  if ((cp & 0xfffe) === 0xfffe) return true; // noncharacters U+xFFFE / U+xFFFF
  return (
    (cp >= 0x0000 && cp <= 0x0008) ||
    cp === 0x000b ||
    cp === 0x000c ||
    (cp >= 0x000e && cp <= 0x001f) ||
    (cp >= 0x007f && cp <= 0x009f) ||
    cp === 0x00ad ||
    cp === 0x034f ||
    cp === 0x115f ||
    cp === 0x1160 ||
    cp === 0x17b4 ||
    cp === 0x17b5 ||
    cp === 0x180e ||
    cp === 0x200b ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x206f) ||
    cp === 0x3164 ||
    (cp >= 0xd800 && cp <= 0xdfff) ||
    (cp >= 0xe000 && cp <= 0xf8ff) ||
    (cp >= 0xfdd0 && cp <= 0xfdef) ||
    cp === 0xfeff ||
    cp === 0xffa0 ||
    (cp >= 0xfff9 && cp <= 0xfffd) ||
    (cp >= 0x1d173 && cp <= 0x1d17a) ||
    (cp >= 0xe0000 && cp <= 0xe007f) ||
    (cp >= 0xf0000 && cp <= 0xffffd) ||
    (cp >= 0x100000 && cp <= 0x10fffd)
  );
}

/** TAB, LF, CR, LINE SEPARATOR, PARAGRAPH SEPARATOR. */
export function isLineBreakOrTab(cp: number): boolean {
  return cp === 0x09 || cp === 0x0a || cp === 0x0d || cp === 0x2028 || cp === 0x2029;
}

/** First forbidden code point in `s`, or `null`. Lone surrogates count as forbidden. */
export function findForbidden(s: string): number | null {
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (isForbiddenCodePoint(cp)) return cp;
  }
  return null;
}

function collapseSpaces(line: string): string {
  return line.replace(/ +/g, " ").replace(/^ /, "").replace(/ $/, "");
}

export function formatCodePoint(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** `normalize_text` — multi-line text (paragraphs, change summary). */
export function normalizeText(input: string): string {
  // 1. One leading BOM.
  let s = input.startsWith("\u{FEFF}") ? input.slice(1) : input;
  // 2. Line endings → LF.  3. TAB → space.
  s = s
    .replace(/\r\n/g, "\n")
    .replace(/[\r\u0085\u{2028}\u{2029}]/gu, "\n")
    .replace(/\t/g, " ");
  // 4. NFC (lone surrogates are rejected first — they cannot be normalized meaningfully).
  if (!s.isWellFormed())
    throw new ProtocolError("FORBIDDEN_CHARACTER", "text contains a lone surrogate");
  s = s.normalize("NFC");
  // 5. Forbidden code points.
  const bad = findForbidden(s);
  if (bad !== null)
    throw new ProtocolError("FORBIDDEN_CHARACTER", `forbidden character ${formatCodePoint(bad)}`);
  // 6–8. Collapse and trim each line, drop empty lines, join with LF.
  const out = s
    .split("\n")
    .map(collapseSpaces)
    .filter((l) => l.length > 0)
    .join("\n");
  // 9. Reject empty.
  if (out.length === 0) throw new ProtocolError("EMPTY_TEXT", "text is empty after normalization");
  return out;
}

/** `normalize_inline` — single-line text (headings, list items). */
export function normalizeInline(input: string): string {
  return normalizeText(input).replace(/\n/g, " ");
}

export function isCanonicalText(s: string): boolean {
  try {
    return normalizeText(s) === s;
  } catch {
    return false;
  }
}

export function isCanonicalInline(s: string): boolean {
  try {
    return normalizeInline(s) === s;
  } catch {
    return false;
  }
}

/**
 * Normalizes a single-line display string (organization name, title) the way clients must before
 * submitting it on-chain: NFC, whitespace collapsed and trimmed. Validation is separate.
 */
export function normalizeDisplayString(input: string): string {
  return input
    .normalize("NFC")
    .replace(/[\t\r\n\u{2028}\u{2029}]+/gu, " ")
    .replace(/ +/g, " ")
    .trim();
}
