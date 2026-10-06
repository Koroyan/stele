/**
 * `stele-content-v1` and `stele-canonical-v1` (PROTOCOL_SPEC.md §4).
 * Mirrors `crates/stele-canonical/src/content.rs`. Canonicalization happens once, at authoring time;
 * verification hashes stored bytes and proves they are canonical.
 */
import { CONTENT_FORMAT } from "./constants";
import { fromUtf8, toHex, utf8, utf8Length } from "./encoding";
import { ProtocolError } from "./errors";
import { sha256 } from "./hash";
import { isCanonicalInline, isCanonicalText, normalizeInline, normalizeText } from "./text";

export const CONTENT_LIMITS = {
  blocks: 5_000,
  headingBytes: 500,
  paragraphBytes: 20_000,
  listItems: 500,
  listItemBytes: 5_000,
  changeSummaryBytes: 2_000,
  attachments: 20,
  attachmentNameBytes: 128,
  attachmentSize: 26_214_400,
  canonicalBytes: 2_097_152,
} as const;

export const ALLOWED_MEDIA_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
] as const;
export type MediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

export type HeadingLevel = 1 | 2 | 3;

export type Block =
  | { type: "heading"; level: HeadingLevel; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] };

export interface Attachment {
  mediaType: MediaType;
  name: string;
  /** Lowercase hex SHA-256 of the attachment bytes. */
  sha256: string;
  size: number;
}

export interface Content {
  attachments: Attachment[];
  blocks: Block[];
  changeSummary: string | null;
}

/** Loose authoring input (anything may be un-normalized). */
export interface ContentInput {
  attachments?: Attachment[];
  blocks: Block[];
  changeSummary?: string | null;
}

function limit(cond: boolean, what: string): void {
  if (!cond) throw new ProtocolError("LIMIT_EXCEEDED", `limit exceeded: ${what}`);
}

function structure(cond: boolean, why: string): asserts cond {
  if (!cond) throw new ProtocolError("INVALID_STRUCTURE", `invalid content structure: ${why}`);
}

function validateAttachment(a: Attachment): void {
  structure(
    (ALLOWED_MEDIA_TYPES as readonly string[]).includes(a.mediaType),
    `media type ${a.mediaType} is not allowed`,
  );
  structure(
    utf8Length(a.name) <= CONTENT_LIMITS.attachmentNameBytes &&
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(a.name),
    `invalid attachment name ${JSON.stringify(a.name)}`,
  );
  structure(/^[0-9a-f]{64}$/.test(a.sha256), "attachment sha256 must be 64 lowercase hex");
  structure(Number.isSafeInteger(a.size), "attachment size must be an integer");
  limit(a.size >= 1 && a.size <= CONTENT_LIMITS.attachmentSize, "attachment size");
}

/** Normalizes all text and validates all limits. */
export function canonicalizeContent(input: ContentInput): Content {
  structure(
    Array.isArray(input.blocks) && input.blocks.length > 0,
    "at least one block is required",
  );
  limit(input.blocks.length <= CONTENT_LIMITS.blocks, "blocks");
  const blocks: Block[] = input.blocks.map((block) => {
    switch (block.type) {
      case "heading": {
        structure(
          block.level === 1 || block.level === 2 || block.level === 3,
          "heading level must be 1, 2 or 3",
        );
        const text = normalizeInline(block.text);
        limit(utf8Length(text) <= CONTENT_LIMITS.headingBytes, "heading text");
        return { type: "heading", level: block.level, text };
      }
      case "paragraph": {
        const text = normalizeText(block.text);
        limit(utf8Length(text) <= CONTENT_LIMITS.paragraphBytes, "paragraph text");
        return { type: "paragraph", text };
      }
      case "list": {
        structure(
          Array.isArray(block.items) && block.items.length > 0,
          "list must have at least one item",
        );
        limit(block.items.length <= CONTENT_LIMITS.listItems, "list items");
        const items = block.items.map((item) => {
          const t = normalizeInline(item);
          limit(utf8Length(t) <= CONTENT_LIMITS.listItemBytes, "list item");
          return t;
        });
        return { type: "list", ordered: Boolean(block.ordered), items };
      }
      default:
        structure(false, `unknown block type ${JSON.stringify((block as { type: unknown }).type)}`);
    }
  });
  let changeSummary: string | null = null;
  if (input.changeSummary !== undefined && input.changeSummary !== null) {
    changeSummary = normalizeText(input.changeSummary);
    limit(utf8Length(changeSummary) <= CONTENT_LIMITS.changeSummaryBytes, "change summary");
  }
  const attachments = input.attachments ?? [];
  limit(attachments.length <= CONTENT_LIMITS.attachments, "attachments");
  attachments.forEach((a, i) => {
    validateAttachment(a);
    structure(
      !attachments.slice(0, i).some((b) => b.name === a.name),
      `duplicate attachment name ${JSON.stringify(a.name)}`,
    );
  });
  const content: Content = {
    attachments: attachments.map((a) => ({
      mediaType: a.mediaType,
      name: a.name,
      sha256: a.sha256,
      size: a.size,
    })),
    blocks,
    changeSummary,
  };
  limit(serializeContent(content).length <= CONTENT_LIMITS.canonicalBytes, "canonical size");
  return content;
}

/** JSON string literal; identical to RFC 8785 escaping for well-formed strings. */
const str = (s: string) => JSON.stringify(s);

/** RFC 8785 serialization of canonical content (members in sorted order). */
export function serializeContent(c: Content): Uint8Array {
  const attachments = c.attachments
    .map(
      (a) =>
        `{"mediaType":${str(a.mediaType)},"name":${str(a.name)},"sha256":${str(a.sha256)},"size":${a.size}}`,
    )
    .join(",");
  const blocks = c.blocks
    .map((b) => {
      switch (b.type) {
        case "heading":
          return `{"level":${b.level},"text":${str(b.text)},"type":"heading"}`;
        case "paragraph":
          return `{"text":${str(b.text)},"type":"paragraph"}`;
        case "list":
          return `{"items":[${b.items.map(str).join(",")}],"ordered":${b.ordered ? "true" : "false"},"type":"list"}`;
      }
    })
    .join(",");
  const summary = c.changeSummary === null ? "null" : str(c.changeSummary);
  return utf8(
    `{"attachments":[${attachments}],"blocks":[${blocks}],"changeSummary":${summary},"format":"${CONTENT_FORMAT}"}`,
  );
}

/** `content_hash = SHA-256(canonical content bytes)`. */
export function contentHash(canonicalBytes: Uint8Array): Uint8Array {
  return sha256(canonicalBytes);
}

export function contentHashHex(canonicalBytes: Uint8Array): string {
  return toHex(contentHash(canonicalBytes));
}

// ---- Parsing stored bytes --------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function isObject(v: Json | undefined): v is { [k: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function exactKeys(v: Json | undefined, keys: string[], what: string): { [k: string]: Json } {
  structure(isObject(v), `${what} must be an object`);
  const actual = Object.keys(v);
  structure(
    actual.length === keys.length && keys.every((k) => Object.hasOwn(v, k)),
    `${what} must have exactly the keys ${keys.join(", ")}`,
  );
  return v;
}

function getString(o: { [k: string]: Json }, k: string): string {
  const v = o[k];
  structure(typeof v === "string", `${k} must be a string`);
  return v;
}

function canonicalText(s: string, inline: boolean): string {
  if (!(inline ? isCanonicalInline(s) : isCanonicalText(s))) {
    throw new ProtocolError("NON_CANONICAL_TEXT", "text is not in canonical form");
  }
  return s;
}

/**
 * Proves `bytes` are canonical `stele-content-v1` (§4.5): valid UTF-8 JSON, exact model, canonical
 * text, and byte-identical re-serialization. Returns the parsed content.
 */
export function parseCanonicalContent(bytes: Uint8Array): Content {
  limit(bytes.length <= CONTENT_LIMITS.canonicalBytes, "canonical size");
  let root: Json;
  try {
    root = JSON.parse(fromUtf8(bytes)) as Json;
  } catch (e) {
    throw new ProtocolError(
      "INVALID_JSON",
      `invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const obj = exactKeys(root, ["attachments", "blocks", "changeSummary", "format"], "content");
  structure(getString(obj, "format") === CONTENT_FORMAT, `format must be ${CONTENT_FORMAT}`);

  const rawAttachments = obj["attachments"];
  structure(Array.isArray(rawAttachments), "attachments must be an array");
  const attachments: Attachment[] = rawAttachments.map((a) => {
    const ao = exactKeys(a, ["mediaType", "name", "sha256", "size"], "attachment");
    const size = ao["size"];
    structure(typeof size === "number" && Number.isSafeInteger(size), "size must be an integer");
    return {
      mediaType: getString(ao, "mediaType") as MediaType,
      name: getString(ao, "name"),
      sha256: getString(ao, "sha256"),
      size,
    };
  });

  const rawBlocks = obj["blocks"];
  structure(Array.isArray(rawBlocks), "blocks must be an array");
  const blocks: Block[] = rawBlocks.map((b) => {
    structure(isObject(b), "block must be an object");
    const kind = b["type"];
    if (kind === "heading") {
      const bo = exactKeys(b, ["level", "text", "type"], "heading");
      const level = bo["level"];
      structure(level === 1 || level === 2 || level === 3, "heading level must be 1, 2 or 3");
      return { type: "heading", level, text: canonicalText(getString(bo, "text"), true) };
    }
    if (kind === "paragraph") {
      const bo = exactKeys(b, ["text", "type"], "paragraph");
      return { type: "paragraph", text: canonicalText(getString(bo, "text"), false) };
    }
    if (kind === "list") {
      const bo = exactKeys(b, ["items", "ordered", "type"], "list");
      const ordered = bo["ordered"];
      structure(typeof ordered === "boolean", "ordered must be a boolean");
      const items = bo["items"];
      structure(Array.isArray(items), "items must be an array");
      return {
        type: "list",
        ordered,
        items: items.map((item) => {
          structure(typeof item === "string", "list items must be strings");
          return canonicalText(item, true);
        }),
      };
    }
    structure(false, `unknown block type ${JSON.stringify(kind)}`);
  });

  const rawSummary = obj["changeSummary"];
  structure(
    rawSummary === null || typeof rawSummary === "string",
    "changeSummary must be a string or null",
  );
  const parsed: Content = {
    attachments,
    blocks,
    changeSummary: rawSummary === null ? null : canonicalText(rawSummary, false),
  };
  // canonicalize() re-applies every limit and must be a no-op on canonical input.
  const recanonical = canonicalizeContent(parsed);
  const reserialized = serializeContent(recanonical);
  if (reserialized.length !== bytes.length || !reserialized.every((b, i) => b === bytes[i])) {
    throw new ProtocolError("NON_CANONICAL_BYTES", "bytes are not the canonical serialization");
  }
  return parsed;
}

/** Plain-text rendering used for diffs and previews (not part of the hash). */
export function contentToPlainLines(c: Content): string[] {
  const lines: string[] = [];
  for (const b of c.blocks) {
    if (b.type === "heading") lines.push(`${"#".repeat(b.level)} ${b.text}`);
    else if (b.type === "paragraph") lines.push(...b.text.split("\n"));
    else b.items.forEach((item, i) => lines.push(`${b.ordered ? `${i + 1}.` : "-"} ${item}`));
    lines.push("");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
