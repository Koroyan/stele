/**
 * Bundles the PUBLIC documentation for the AI assistant into dist/knowledge.json: only the files of
 * the website's public catalog (apps/web/src/lib/docs.ts) — operator documentation never reaches the
 * assistant, as it never reaches the website.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const API = path.resolve(import.meta.dirname, "..");
const REPO = path.resolve(API, "../..");
const catalog = readFileSync(path.join(REPO, "apps/web/src/lib/docs.ts"), "utf8");
const entries = [
  ...catalog.matchAll(/slug: "([^"]+)",\s*file: "([^"]+\.md)",\s*title: "([^"]+)"/g),
].map((m) => ({ slug: m[1], file: m[2], title: m[3] }));
if (entries.length === 0) throw new Error("build-knowledge: no documents in the public catalog");

const docs = entries.map((e) => ({
  ...e,
  markdown: readFileSync(path.join(REPO, e.file), "utf8"),
}));
mkdirSync(path.join(API, "dist"), { recursive: true });
writeFileSync(path.join(API, "dist", "knowledge.json"), JSON.stringify(docs));
console.log(`build-knowledge: ${docs.length} public documents`);
