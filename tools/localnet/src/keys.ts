/**
 * Local development keypairs in `.data/localnet/` (git-ignored). Solana CLI JSON format
 * (64-byte array: secret ‖ public). NEVER use these keys on devnet or mainnet.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";
import { toBase58 } from "@stele/protocol";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const DATA_DIR = resolve(REPO_ROOT, ".data/localnet");
export const STORAGE_DIR = resolve(REPO_ROOT, ".data/storage");

export const ROLES = [
  "admin",
  "attestor",
  "relayer",
  "owner",
  "recovery",
  "publisher",
  "user-1",
  "user-2",
  "user-3",
  "demo-owner",
] as const;
export type Role = (typeof ROLES)[number];

export function keypairPath(role: Role): string {
  return resolve(DATA_DIR, `${role}.json`);
}

export function ensureKeypair(role: Role): Uint8Array {
  const path = keypairPath(role);
  if (existsSync(path)) return Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]);
  const secret = ed25519.utils.randomSecretKey();
  const bytes = new Uint8Array(64);
  bytes.set(secret, 0);
  bytes.set(ed25519.getPublicKey(secret), 32);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(bytes)), { mode: 0o600 });
  return bytes;
}

export async function signer(role: Role): Promise<KeyPairSigner> {
  return createKeyPairSignerFromBytes(ensureKeypair(role));
}

export function publicKeyOf(role: Role): string {
  return toBase58(ensureKeypair(role).slice(32));
}

// `pnpm --filter @stele/localnet keys` prints the public keys (the validator needs admin's).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const role of ROLES) console.log(`${role.padEnd(10)} ${publicKeyOf(role)}`);
}
