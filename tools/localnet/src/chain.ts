/** Shared localnet helpers: sending transactions, storing content and publishing versions. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import {
  DEFAULT_PROGRAM_ADDRESS,
  authoringInput,
  canonicalizeContent,
  confirmSignature,
  findConfigPda,
  preparePublication,
  publishVersionInstruction,
  signSendAndConfirm,
  toHex,
  type SteleRpc,
} from "@stelehq/protocol";
import { STORAGE_DIR } from "./keys.js";

export const RPC_URL = process.env.STELE_RPC_URL ?? "http://127.0.0.1:8899";
export const PROGRAM = address(process.env.STELE_PROGRAM_ID ?? DEFAULT_PROGRAM_ADDRESS);

/** CAIP-2 IDs of the public clusters; localnet tools refuse to touch them. */
export const PUBLIC_NETWORKS = new Set([
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", // mainnet
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", // devnet
  "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z", // testnet
]);

export async function send(
  rpc: SteleRpc,
  feePayer: KeyPairSigner,
  instructions: Instruction[],
): Promise<string> {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return signSendAndConfirm(rpc, message, { commitment: "confirmed" });
}

export async function airdrop(rpc: SteleRpc, to: Address, sol: number): Promise<void> {
  const sig = await rpc.requestAirdrop(to, lamports(BigInt(sol) * 1_000_000_000n)).send();
  const { value } = await rpc.getLatestBlockhash().send();
  await confirmSignature(rpc, sig, value.lastValidBlockHeight, "confirmed");
}

/** Writes canonical content where the API's filesystem content store serves it from. */
export function storeContent(bytes: Uint8Array, hash: Uint8Array): void {
  const dir = resolve(STORAGE_DIR, "sha256");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, toHex(hash)), bytes);
}

export interface PublishOptions {
  rpc: SteleRpc;
  publisher: KeyPairSigner;
  membership: Address | null;
  organization: Address;
  document: Address;
  title: string;
  versionLabel: string;
  source: string;
  changeSummary?: string | null;
  effectiveAt?: number;
}

/** Canonicalizes, stores and publishes one version; the program recomputes the fingerprint. */
export async function publishVersion(o: PublishOptions) {
  const content = canonicalizeContent(authoringInput(o.source, o.changeSummary ?? null));
  const effectiveAt = o.effectiveAt ?? 0;
  const prepared = await preparePublication({
    rpc: o.rpc,
    programAddress: PROGRAM,
    organization: o.organization,
    document: o.document,
    title: o.title,
    versionLabel: o.versionLabel,
    effectiveAt,
    content,
  });
  storeContent(prepared.contentBytes, prepared.contentHash);
  const [config] = await findConfigPda(PROGRAM);
  const signature = await send(o.rpc, o.publisher, [
    publishVersionInstruction({
      programAddress: PROGRAM,
      authority: o.publisher,
      membership: o.membership,
      config,
      organization: o.organization,
      document: o.document,
      versionAccount: prepared.versionAccount,
      payer: o.publisher,
      version: prepared.versionNumber,
      previousVersionHash: prepared.previousVersionHash,
      contentHash: prepared.contentHash,
      title: o.title,
      versionLabel: o.versionLabel,
      effectiveAt,
      storageUri: prepared.storageUri,
      expectedVersionHash: prepared.versionHash,
    }),
  ]);
  console.log(
    `  published ${o.title} ${o.versionLabel} (#${prepared.versionNumber}) fingerprint ${toHex(prepared.versionHash).slice(0, 16)}… tx ${signature.slice(0, 16)}…`,
  );
  return {
    address: prepared.versionAccount,
    number: prepared.versionNumber,
    fingerprint: toHex(prepared.versionHash),
    contentHash: toHex(prepared.contentHash),
    signature,
  };
}
