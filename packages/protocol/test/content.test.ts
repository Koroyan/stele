import { describe, expect, it } from "vitest";
import {
  ProtocolError,
  blocksToAuthoringText,
  canonicalizeContent,
  contentToPlainLines,
  fromUtf8,
  parseAuthoringText,
  parseCanonicalContent,
  serializeContent,
  utf8,
  validateOrgName,
  validateRequestDomain,
  validationError,
} from "../src/index";

describe("canonicalization", () => {
  it("produces identical bytes for logically identical input from different platforms", () => {
    const windows = {
      blocks: [{ type: "paragraph" as const, text: "Cafe\u{301} terms\r\nLine two \r\n" }],
    };
    const mac = { blocks: [{ type: "paragraph" as const, text: "Café terms\nLine two" }] };
    const a = serializeContent(canonicalizeContent(windows));
    const b = serializeContent(canonicalizeContent(mac));
    expect(fromUtf8(a)).toBe(fromUtf8(b));
  });

  it("rejects Trojan-Source bidi controls and invisible characters", () => {
    for (const text of ["Pay \u{202E}0001", "a\u{200B}b", "x\u{2066}y", "hidden\u{E0041}"]) {
      expect(() => canonicalizeContent({ blocks: [{ type: "paragraph", text }] })).toThrow(
        ProtocolError,
      );
    }
  });

  it("enforces structure and limits", () => {
    expect(() => canonicalizeContent({ blocks: [] })).toThrow(/at least one block/);
    expect(() =>
      canonicalizeContent({ blocks: [{ type: "list", ordered: true, items: [] }] }),
    ).toThrow();
    expect(() =>
      canonicalizeContent({ blocks: [{ type: "paragraph", text: "x".repeat(20_001) }] }),
    ).toThrow(/paragraph/);
    expect(() =>
      canonicalizeContent({
        blocks: [{ type: "paragraph", text: "a" }],
        attachments: [
          { mediaType: "text/html" as never, name: "x.html", sha256: "a".repeat(64), size: 1 },
        ],
      }),
    ).toThrow(/media type/);
  });

  it("canonical parse rejects any byte-level variation", () => {
    const bytes = serializeContent(
      canonicalizeContent({ blocks: [{ type: "paragraph", text: "Hello" }] }),
    );
    expect(parseCanonicalContent(bytes).blocks).toHaveLength(1);
    const text = fromUtf8(bytes);
    expect(() => parseCanonicalContent(utf8(text + "\n"))).toThrow();
    expect(() => parseCanonicalContent(utf8(text.replace("Hello", "Hello ")))).toThrow();
    expect(() => parseCanonicalContent(new Uint8Array([0xff, 0xfe]))).toThrow();
  });
});

describe("authoring format", () => {
  const source = [
    "# Terms of Service",
    "",
    "These terms govern",
    "your use of the service.",
    "",
    "## 1. Eligibility",
    "- You are 18 or older",
    "- You live on Earth",
    "  (continued line)",
    "",
    "1. First",
    "2. Second",
  ].join("\n");

  it("parses headings, paragraphs and lists", () => {
    const blocks = parseAuthoringText(source);
    expect(blocks).toEqual([
      { type: "heading", level: 1, text: "Terms of Service" },
      { type: "paragraph", text: "These terms govern\nyour use of the service." },
      { type: "heading", level: 2, text: "1. Eligibility" },
      {
        type: "list",
        ordered: false,
        items: ["You are 18 or older", "You live on Earth (continued line)"],
      },
      { type: "list", ordered: true, items: ["First", "Second"] },
    ]);
  });

  it("round-trips through canonical content", () => {
    const canonical = canonicalizeContent({ blocks: parseAuthoringText(source) });
    const again = canonicalizeContent({
      blocks: parseAuthoringText(blocksToAuthoringText(canonical.blocks)),
    });
    expect(again).toEqual(canonical);
    expect(contentToPlainLines(canonical)[0]).toBe("# Terms of Service");
  });
});

describe("field validation", () => {
  it("reports readable errors", () => {
    expect(validationError(validateOrgName, "Acme  Inc")).toMatch(/repeated spaces/);
    expect(validationError(validateRequestDomain, "evil.example\nX")).toMatch(/request domain/);
    expect(validationError(validateOrgName, "Acme Inc.")).toBeNull();
  });
});
