/**
 * DOM helpers shared by the SDK's framework-free components (the acceptance widget and the Gate
 * modal). Strings always become text nodes — content is never parsed as HTML.
 */
import { SUSPICIOUS_FINDINGS, describeFinding, type Block } from "@stelehq/protocol";
import type { VerifiedDocument } from "./verified-document";

export type Child = Node | string | null | undefined | false;

/** Creates an element; strings become text nodes (never parsed as HTML). */
export function h(
  tag: string,
  attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...children: Child[]
): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "function") el.addEventListener(key.replace(/^on/, ""), value);
    else if (value === true) el.setAttribute(key, "");
    else if (value !== false) el.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

export function present(children: Child[]): (Node | string)[] {
  return children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false);
}

/** Each block is its own bidi paragraph (`dir="auto"`): direction marks cannot leak across blocks. */
export function renderBlocks(blocks: Block[]): HTMLElement[] {
  return blocks.map((b) => {
    if (b.type === "heading") return h("h3", { dir: "auto" }, b.text);
    if (b.type === "paragraph") return h("p", { dir: "auto" }, b.text);
    return h(b.ordered ? "ol" : "ul", {}, ...b.items.map((item) => h("li", { dir: "auto" }, item)));
  });
}

/** Tells the reader, before signing, what the text contains that the eye may not catch. */
export function displayNotice(doc: VerifiedDocument): HTMLElement | null {
  const suspicious = doc.displayFindings.filter((f) => SUSPICIOUS_FINDINGS.includes(f.kind));
  const links = doc.displayFindings.filter((f) => f.kind === "EXTERNAL_LINK");
  if (suspicious.length === 0 && links.length === 0) return null;
  return h(
    "div",
    { class: suspicious.length > 0 ? "alert error" : "note", role: "note" },
    suspicious.length > 0
      ? `Read carefully: this text contains characters that can change how it reads — ${suspicious
          .slice(0, 3)
          .map(describeFinding)
          .join("; ")}${suspicious.length > 3 ? "; …" : ""}.`
      : "",
    links.length > 0
      ? ` The text links to ${links.length} external page(s); what they say is not part of what you sign.`
      : "",
  );
}

export function applyStyles(root: ShadowRoot, css: string): void {
  // Constructable stylesheets are not subject to the host page's style-src policy; fall back to a
  // <style> element where they are unavailable.
  if ("adoptedStyleSheets" in root && typeof CSSStyleSheet !== "undefined") {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
      return;
    } catch {
      // fall through
    }
  }
  root.append(h("style", {}, css));
}
