/**
 * Writes a local-development `.env` (git-ignored) for the localnet setup: embedded database,
 * localnet keys created by `keys.ts`, and freshly generated secrets. Refuses to overwrite.
 *
 *   pnpm --filter @stele/localnet run env
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./keys";

const target = path.join(REPO_ROOT, ".env");
if (existsSync(target) && !process.argv.includes("--force")) {
  console.error(".env already exists (use --force to overwrite)");
  process.exit(1);
}

const template = readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
const values: Record<string, string> = {
  DATABASE_URL: "pglite:../../.data/pglite",
  RUN_INDEXER: "true",
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  IP_HASH_SECRET: randomBytes(24).toString("base64url"),
};

const out = template
  .split("\n")
  .map((line) => {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    return m && values[m[1]!] !== undefined ? `${m[1]}=${values[m[1]!]}` : line;
  })
  .join("\n");

writeFileSync(target, out, { mode: 0o600 });
console.log(`wrote ${target} (embedded database, localnet keys, new secrets)`);
