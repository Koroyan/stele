/** Seeded localnet state and throwaway keys written by `pnpm localnet:keys` / `localnet:seed`. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const DATA = resolve(REPO_ROOT, ".data/localnet");

export interface SeedState {
  rpcUrl: string;
  programId: string;
  chainId: string;
  organization: string;
  domain: string;
  owner: string;
  publisher: string;
  documents: Record<
    string,
    { address: string; versions: { address: string; number: number; fingerprint: string }[] }
  >;
  acceptances: { user: string; signer: string; signature: string }[];
}

export function seedState(): SeedState | null {
  const file = resolve(DATA, "state.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as SeedState) : null;
}

/** 64-byte Solana CLI keypair (secret ‖ public) for a localnet role. */
export function keypair(role: string): Uint8Array {
  return Uint8Array.from(
    JSON.parse(readFileSync(resolve(DATA, `${role}.json`), "utf8")) as number[],
  );
}
