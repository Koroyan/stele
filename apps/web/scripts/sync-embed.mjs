/**
 * Publishes the SDK's `<script>` build at /sdk/v1/stele.js: copies packages/sdk/dist/embed into
 * public/sdk/v1 (git-ignored), building it first when it is missing, and publishes its Subresource
 * Integrity hash at /sdk/v1/stele.js.integrity.json so integrators can pin the exact build:
 *   <script src=".../sdk/v1/stele.js" integrity="sha384-…" crossorigin="anonymous" defer></script>
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const WEB = path.resolve(import.meta.dirname, "..");
const SOURCE = path.resolve(WEB, "../../packages/sdk/dist/embed");
const TARGET = path.join(WEB, "public", "sdk", "v1");

if (!existsSync(path.join(SOURCE, "stele.js"))) {
  execSync("pnpm --filter @stele/sdk run build:embed", { stdio: "inherit", cwd: WEB });
}
mkdirSync(TARGET, { recursive: true });
for (const file of ["stele.js", "stele.js.map"]) {
  cpSync(path.join(SOURCE, file), path.join(TARGET, file));
}
const bytes = readFileSync(path.join(TARGET, "stele.js"));
const integrity = {
  file: "stele.js",
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  integrity: `sha384-${createHash("sha384").update(bytes).digest("base64")}`,
};
writeFileSync(
  path.join(TARGET, "stele.js.integrity.json"),
  `${JSON.stringify(integrity, null, 2)}
`,
);
console.log(`sync-embed: /sdk/v1/stele.js ready (${integrity.integrity})`);
