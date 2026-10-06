/**
 * Completes Next's standalone output so `node .next/standalone/apps/web/server.js` runs as is,
 * locally and in the container image:
 *
 * - copies the client assets (`.next/static`, and `public/` if present) next to the server; Next
 *   leaves that step to the deployer;
 * - copies the Markdown the /docs pages render into the standalone root, where the server looks
 *   for it by default (STELE_REPO_ROOT overrides). Only the files in the public catalog
 *   (src/lib/docs.ts) are copied: internal operator documentation never reaches the web server;
 * - on Windows, re-creates package links as directory junctions. Next writes them as file symlinks
 *   when a link is created before its target, and Node refuses to follow those (EPERM).
 */
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";

const WEB = path.resolve(import.meta.dirname, "..");
const REPO = path.resolve(WEB, "../..");
const STANDALONE = path.join(WEB, ".next", "standalone");
// The public catalog's files, read from its `file: "…"` entries.
const CATALOG = readFileSync(path.join(WEB, "src", "lib", "docs.ts"), "utf8");
const DOCS = [...CATALOG.matchAll(/\bfile: "([^"]+\.md)"/g)].map((m) => m[1]);
if (DOCS.length === 0) throw new Error("prepare-standalone: no documents found in src/lib/docs.ts");

if (!existsSync(STANDALONE)) {
  console.log("prepare-standalone: no standalone output (STELE_STANDALONE=false); nothing to do");
  process.exit(0);
}

const app = path.join(STANDALONE, path.relative(REPO, WEB));
cpSync(path.join(WEB, ".next", "static"), path.join(app, ".next", "static"), { recursive: true });
if (existsSync(path.join(WEB, "public"))) {
  cpSync(path.join(WEB, "public"), path.join(app, "public"), { recursive: true });
}
// Start from a clean slate so documents removed from the catalog do not linger from earlier builds.
rmSync(path.join(STANDALONE, "docs"), { recursive: true, force: true });
for (const stale of readdirSync(STANDALONE).filter((f) => f.endsWith(".md"))) {
  rmSync(path.join(STANDALONE, stale));
}
for (const entry of DOCS) {
  cpSync(path.join(REPO, entry), path.join(STANDALONE, entry));
}

let relinked = 0;
function relink(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const link = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = readlinkSync(link);
      // Next writes relative links; absolute ones are junctions from an earlier run.
      if (path.isAbsolute(target)) continue;
      const resolved = path.resolve(dir, target);
      if (statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
        rmSync(link);
        symlinkSync(resolved, link, "junction");
        relinked++;
      }
    } else if (entry.isDirectory()) {
      relink(link);
    }
  }
}
if (process.platform === "win32") relink(path.join(STANDALONE, "node_modules"));

console.log(
  `prepare-standalone: ${DOCS.length} public documents; run node ${path.relative(WEB, path.join(app, "server.js"))}` +
    (relinked ? ` (${relinked} package links re-created as junctions)` : ""),
);
