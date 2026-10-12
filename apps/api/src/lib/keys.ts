/**
 * Loads operational keypairs (relayer, attestor). Accepted forms: a file path to a Solana CLI JSON
 * keypair, an inline JSON byte array, or base58 of the 64-byte keypair. Key material is never
 * logged; production deployments should mount keys from a secret manager or use an HSM-backed
 * signer behind the same interface.
 */
import { readFileSync } from "node:fs";
import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";
import { fromBase58 } from "@stelehq/protocol";

export function parseKeypairBytes(spec: string): Uint8Array {
  const trimmed = spec.trim();
  let bytes: Uint8Array;
  if (trimmed.startsWith("[")) {
    bytes = Uint8Array.from(JSON.parse(trimmed) as number[]);
  } else if (/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(trimmed)) {
    bytes = fromBase58(trimmed);
  } else {
    bytes = Uint8Array.from(JSON.parse(readFileSync(trimmed, "utf8")) as number[]);
  }
  if (bytes.length !== 64) throw new Error("keypair must be 64 bytes (secret ‖ public)");
  return bytes;
}

export async function loadSigner(spec: string): Promise<KeyPairSigner> {
  return createKeyPairSignerFromBytes(parseKeypairBytes(spec));
}
