/**
 * Sign-In With Solana (CAIP-122 style) for dashboard login. The message format is distinct from
 * acceptance messages (different first line, explicit statement that it authorizes nothing), so a
 * login signature can never be replayed as an acceptance and vice versa.
 */
import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { fromBase58 } from "@stele/protocol";

export const SIWS_STATEMENT =
  "Sign in to Stele. This proves control of this account only. It does not accept any agreement and does not authorize any transaction.";

/**
 * A 128-bit single-use nonce. SIWS (like CAIP-122 and EIP-4361) requires nonces to be alphanumeric,
 * and wallets refuse to display messages whose nonce is not; base64url tokens contain `-` and `_`.
 */
export function siwsNonce(): string {
  return randomBytes(16).toString("hex");
}

export interface SiwsFields {
  domain: string;
  address: string;
  statement: string | null;
  uri: string;
  version: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string | null;
}

export function buildSiwsMessage(f: SiwsFields): string {
  const lines = [`${f.domain} wants you to sign in with your Solana account:`, f.address, ""];
  if (f.statement) lines.push(f.statement, "");
  lines.push(
    `URI: ${f.uri}`,
    `Version: ${f.version}`,
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
  );
  if (f.expirationTime) lines.push(`Expiration Time: ${f.expirationTime}`);
  return lines.join("\n");
}

const HEADER = /^(.+) wants you to sign in with your Solana account:$/;
const KNOWN = [
  "URI",
  "Version",
  "Chain ID",
  "Nonce",
  "Issued At",
  "Expiration Time",
  "Not Before",
  "Request ID",
  "Resources",
];

/** Parses a SIWS message (as produced by wallets' `solana:signIn` or by `buildSiwsMessage`). */
export function parseSiwsMessage(text: string): SiwsFields {
  const lines = text.split("\n");
  const header = HEADER.exec(lines[0] ?? "");
  if (!header) throw new Error("not a Sign-In With Solana message");
  const address = lines[1] ?? "";
  if (lines[2] !== "") throw new Error("malformed SIWS message");
  let i = 3;
  let statement: string | null = null;
  if (lines[i] !== undefined && !KNOWN.some((k) => lines[i]!.startsWith(`${k}:`))) {
    statement = lines[i]!;
    i++;
    if (lines[i] !== "") throw new Error("malformed SIWS statement");
    i++;
  }
  const fields = new Map<string, string>();
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("- ")) continue; // resources
    const sep = line.indexOf(": ");
    const key = sep > 0 ? line.slice(0, sep) : line.replace(/:$/, "");
    if (!KNOWN.includes(key)) throw new Error(`unexpected SIWS field: ${key}`);
    if (fields.has(key)) throw new Error(`duplicate SIWS field: ${key}`);
    fields.set(key, sep > 0 ? line.slice(sep + 2) : "");
  }
  const req = (k: string) => {
    const v = fields.get(k);
    if (!v) throw new Error(`missing SIWS field: ${k}`);
    return v;
  };
  return {
    domain: header[1]!,
    address,
    statement,
    uri: req("URI"),
    version: req("Version"),
    chainId: req("Chain ID"),
    nonce: req("Nonce"),
    issuedAt: req("Issued At"),
    expirationTime: fields.get("Expiration Time") ?? null,
  };
}

export function verifySiwsSignature(
  message: Uint8Array,
  signatureBase58: string,
  addressBase58: string,
): boolean {
  try {
    const sig = fromBase58(signatureBase58);
    const pub = fromBase58(addressBase58);
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed25519.verify(sig, message, pub, { zip215: false });
  } catch {
    return false;
  }
}
