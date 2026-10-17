/**
 * Northwind Rewards: Stele Gate in a real app. Depositing points into the Rewards vault (a Solana
 * program) requires the Rewards Club Terms — and the PROGRAM checks it, on-chain, whoever sends the
 * transaction. The page shows the Stele Verified badge, the customer's status (`gate.check`), the
 * "Accept & Deposit" flow (`gate.gate`), and a direct call that skips Stele and is refused on-chain.
 *
 * The customer signs the deposit with their wallet; the shop pays its network fee, so customers
 * need no SOL. The server only ever submits transactions it built itself.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";
import {
  createRpc,
  decodePassportDepositedFromLogs,
  depositWithPassportInstruction,
  findPassportPda,
  fromBase64,
  steleCheckRefusal,
} from "@stelehq/protocol";

export const GATE = process.env.STELE_GATE_POLICY
  ? {
      document: process.env.STELE_GATE_DOCUMENT ?? "rewards-club-terms",
      policy: address(process.env.STELE_GATE_POLICY),
      vault: address(process.env.STELE_GATE_VAULT!),
      program: address(process.env.STELE_GATE_PROGRAM!),
    }
  : null;

const rpc = createRpc((process.env.STELE_RPC_URLS ?? "http://127.0.0.1:8899").split(",")[0]!);
const feePayer = process.env.SHOP_FEE_PAYER_KEYPAIR
  ? createKeyPairSignerFromBytes(
      Uint8Array.from(
        JSON.parse(readFileSync(process.env.SHOP_FEE_PAYER_KEYPAIR, "utf8")) as number[],
      ),
    )
  : null;

/** 25 points (the demo vault counts 6 decimals). */
const AMOUNT = 25_000_000n;
/** Transactions this server built and will submit (by id), for a few minutes. */
const issued = new Map<string, { message: Uint8Array; at: number }>();

export interface DepositResult {
  ok: boolean;
  signature: string;
  /** The Stele check (or other error) that refused the deposit on-chain. */
  refusal: string | null;
  points: number | null;
  termsVersion: number | null;
}

/** Builds the customer's deposit, signed by the shop as fee payer; the customer signs next. */
export async function buildDeposit(investor: string): Promise<{ id: string; transaction: string }> {
  if (!GATE || !feePayer) throw new Error("Run `pnpm localnet:demo` to set up the Rewards vault.");
  const payer = await feePayer;
  const user = address(investor);
  const [passport] = await findPassportPda(user);
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(payer.address, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          depositWithPassportInstruction({
            investor: user,
            vault: GATE.vault,
            policy: GATE.policy,
            passport,
            amount: AMOUNT,
          }),
        ],
        m,
      ),
  );
  const tx = await partiallySignTransaction([payer.keyPair], compileTransaction(message));
  const id = randomUUID();
  issued.set(id, { message: new Uint8Array(tx.messageBytes), at: Date.now() });
  for (const [k, v] of issued) if (Date.now() - v.at > 5 * 60_000) issued.delete(k);
  return { id, transaction: getBase64EncodedWireTransaction(tx) };
}

/**
 * Submits a deposit the customer signed — only if it is exactly the one this server built. Sent
 * without preflight, so a refusal is a real failed transaction on Solana, with its reason.
 */
export async function submitDeposit(id: string, transaction: string): Promise<DepositResult> {
  const expected = issued.get(id);
  if (!expected) throw new Error("Unknown or expired deposit; start again.");
  issued.delete(id);
  const tx = getTransactionDecoder().decode(fromBase64(transaction));
  const same =
    tx.messageBytes.length === expected.message.length &&
    tx.messageBytes.every((b, i) => b === expected.message[i]);
  if (!same) throw new Error("This is not the deposit the shop prepared.");
  const signature = await rpc
    .sendTransaction(transaction as never, { encoding: "base64", skipPreflight: true })
    .send();
  for (let i = 0; i < 60; i++) {
    const result = await rpc
      .getTransaction(signature, {
        commitment: "confirmed",
        encoding: "json",
        maxSupportedTransactionVersion: 0,
      })
      .send();
    if (result) {
      const logs = [...(result.meta?.logMessages ?? [])];
      const ok = !result.meta?.err;
      const event = ok ? (decodePassportDepositedFromLogs(logs)[0] ?? null) : null;
      return {
        ok,
        signature,
        refusal: ok
          ? null
          : (steleCheckRefusal(logs) ??
            logs.map((l) => /Error Code: (\w+)\./.exec(l)?.[1]).find(Boolean) ??
            "failed"),
        points: event ? Number(event.totalDeposited) / 1_000_000 : null,
        termsVersion: event?.termsVersionNumber ?? null,
      };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Not confirmed in time: ${signature}`);
}

export const feePayerAddress = async (): Promise<Address | null> =>
  feePayer ? (await feePayer).address : null;
