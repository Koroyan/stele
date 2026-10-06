/**
 * Authoring format: a small, unambiguous plain-text syntax that companies type or paste, parsed
 * into typed blocks. Only the resulting **blocks** are canonicalized and hashed — never this text
 * and never HTML.
 *
 *   # Heading 1 / ## Heading 2 / ### Heading 3
 *   - unordered item   (or "* item")
 *   1. ordered item
 *   Blank lines separate paragraphs; single line breaks stay inside a paragraph.
 */
import type { Block, Content, ContentInput, HeadingLevel } from "./content";

export function parseAuthoringText(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (list && list.items.length > 0)
      blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const heading = /^(#{1,3})\s+(.*)$/.exec(line.trimStart());
    const unordered = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);

    if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: heading[1]!.length as HeadingLevel,
        text: heading[2]!,
      });
    } else if (unordered || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      const text = (ordered ?? unordered)![1]!;
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(text);
    } else if (list && /^\s{2,}\S/.test(raw)) {
      // Indented continuation of the previous list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Inverse of `parseAuthoringText` for editing an existing version. */
export function blocksToAuthoringText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if (b.type === "heading") return `${"#".repeat(b.level)} ${b.text}`;
      if (b.type === "paragraph") return b.text;
      return b.items.map((item, i) => `${b.ordered ? `${i + 1}.` : "-"} ${item}`).join("\n");
    })
    .join("\n\n");
}

export function authoringInput(source: string, changeSummary?: string | null): ContentInput {
  return {
    blocks: parseAuthoringText(source),
    changeSummary: changeSummary?.trim() ? changeSummary : null,
    attachments: [],
  };
}

export function contentWordCount(c: Content): number {
  let n = 0;
  for (const b of c.blocks) {
    const texts = b.type === "list" ? b.items : [b.text];
    for (const t of texts) n += t.split(/\s+/).filter(Boolean).length;
  }
  return n;
}
