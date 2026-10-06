/**
 * What-you-see-is-what-you-sign analysis of canonical content (PROTOCOL_SPEC.md §4.5).
 *
 * `stele-canonical-v1` already rejects the code points that can silently change what a reader sees
 * (bidi embeddings, overrides and isolates, zero-width space, BOM, tag characters, private use…).
 * Its rules are frozen — changing them would break existing content hashes — so the remaining
 * risks are *reported*, deterministically, wherever a document is published, shown or verified:
 *
 *   BIDI_MARK           LRM / RLM / ALM: legitimate in right-to-left text, but invisible and able to
 *                       reorder neighbouring numbers and punctuation;
 *   JOINER              ZWNJ / ZWJ: required by some scripts and emoji, invisible elsewhere;
 *   VARIATION_SELECTOR  invisible glyph variants;
 *   MIXED_SCRIPT_WORD   a word mixing Latin with Cyrillic or Greek letters (look-alike spoofing);
 *   EXTERNAL_LINK       an http(s) URL: whatever it points to can change after acceptance and is NOT
 *                       covered by the content hash;
 *   PINNED_REFERENCE    `stele:version:<fingerprint>` — a reference to another Stele document
 *                       version, which verifiers resolve on-chain.
 */
import type { Content } from "./content";

export type ContentFindingKind =
  | "BIDI_MARK"
  | "JOINER"
  | "VARIATION_SELECTOR"
  | "MIXED_SCRIPT_WORD"
  | "EXTERNAL_LINK"
  | "PINNED_REFERENCE";

export interface ContentFinding {
  kind: ContentFindingKind;
  /** Block index in `content.blocks` (list items: the list's block). */
  block: number;
  /** For list blocks: the item index. */
  item?: number;
  /** The code point (`U+200F`), the word, the URL or the fingerprint. */
  value: string;
}

/** Findings that may change what a reader perceives (worth a warning). */
export const SUSPICIOUS_FINDINGS: readonly ContentFindingKind[] = [
  "BIDI_MARK",
  "JOINER",
  "VARIATION_SELECTOR",
  "MIXED_SCRIPT_WORD",
];

const INVISIBLE: Record<number, ContentFindingKind> = {
  0x061c: "BIDI_MARK",
  0x200e: "BIDI_MARK",
  0x200f: "BIDI_MARK",
  0x200c: "JOINER",
  0x200d: "JOINER",
};
const isVariationSelector = (cp: number) =>
  (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);

const WORD = /[\p{L}\p{M}]+/gu;
const LATIN = /\p{Script=Latin}/u;
const LOOKALIKE = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"]+/giu;
export const PINNED_REFERENCE_PATTERN = /\bstele:version:([0-9a-f]{64})\b/gu;

const codePoint = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

function inspectText(text: string, at: { block: number; item?: number }, out: ContentFinding[]) {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const kind = INVISIBLE[cp] ?? (isVariationSelector(cp) ? "VARIATION_SELECTOR" : null);
    if (kind) out.push({ kind, ...at, value: codePoint(cp) });
  }
  for (const [word] of text.matchAll(WORD))
    if (LATIN.test(word) && LOOKALIKE.test(word))
      out.push({ kind: "MIXED_SCRIPT_WORD", ...at, value: word });
  for (const [url] of text.matchAll(URL_PATTERN))
    out.push({ kind: "EXTERNAL_LINK", ...at, value: url.replace(/[.,;:)\]]+$/u, "") });
  for (const [, fingerprint] of text.matchAll(PINNED_REFERENCE_PATTERN))
    out.push({ kind: "PINNED_REFERENCE", ...at, value: fingerprint! });
}

/** Deterministic findings, in document order. Empty for plain text. */
export function inspectContent(
  content: Pick<Content, "blocks" | "changeSummary">,
): ContentFinding[] {
  const out: ContentFinding[] = [];
  content.blocks.forEach((b, block) => {
    if (b.type === "list") b.items.forEach((t, item) => inspectText(t, { block, item }, out));
    else inspectText(b.text, { block }, out);
  });
  if (content.changeSummary) inspectText(content.changeSummary, { block: -1 }, out);
  return out;
}

/** One-line human description of a finding. */
export function describeFinding(f: ContentFinding): string {
  const where =
    f.block < 0
      ? "change summary"
      : `block ${f.block + 1}${f.item !== undefined ? `, item ${f.item + 1}` : ""}`;
  switch (f.kind) {
    case "BIDI_MARK":
      return `${where}: invisible direction mark ${f.value}`;
    case "JOINER":
      return `${where}: invisible joiner ${f.value}`;
    case "VARIATION_SELECTOR":
      return `${where}: invisible variation selector ${f.value}`;
    case "MIXED_SCRIPT_WORD":
      return `${where}: "${f.value}" mixes Latin with look-alike Cyrillic/Greek letters`;
    case "EXTERNAL_LINK":
      return `${where}: link ${f.value} — its content is not covered by this document's hash`;
    case "PINNED_REFERENCE":
      return `${where}: references Stele version ${f.value.slice(0, 16)}…`;
  }
}
