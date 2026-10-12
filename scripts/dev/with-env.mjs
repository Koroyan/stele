#!/usr/bin/env node
/**
 * Runs a command with environment files loaded in order (later files override earlier ones), for
 * tools that do not accept `node --env-file` (Next.js passes it on to its workers and fails).
 *
 *   node scripts/dev/with-env.mjs .env .env.devnet -- pnpm --filter @stele/web run dev
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const split = process.argv.indexOf("--");
if (split < 0 || split === process.argv.length - 1) {
  console.error("usage: with-env.mjs <env files…> -- <command> [args…]");
  process.exit(64);
}
const files = process.argv.slice(2, split);
const [command, ...args] = process.argv.slice(split + 1);
const env = { ...process.env };
for (const file of files) Object.assign(env, parseEnv(readFileSync(resolve(file), "utf8")));
const child = spawn(command, args, { env, stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 1));
