/**
 * Browser-side chain access: RPC selection and wallet-signed transactions.
 *
 * Every transaction is simulated first so that program errors (missing role, frozen organization,
 * stale version…) are explained before the wallet prompt. The user's wallet signs; this code never
 * holds keys.
 */
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  isTransactionModifyingSigner,
  isTransactionPartialSigner,
  isTransactionSendingSigner,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signAndSendTransactionMessageWithSigners,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  confirmSignature,
  createRpc,
  describeProgramError,
  explainTransactionError,
  networkByChainId,
  NETWORKS,
  explorerAddressUrl,
  explorerTxUrl,
  signSendAndConfirm,
  type SteleRpc,
} from "@stele/protocol";
import type { NetworkInfo } from "@stele/sdk";
import { PINNED_RPC_URLS } from "./env";

export function rpcUrls(network: NetworkInfo): string[] {
  return PINNED_RPC_URLS.length > 0 ? PINNED_RPC_URLS : network.publicRpcUrls;
}

const rpcCache = new Map<string, SteleRpc>();
export function rpcFor(network: NetworkInfo): SteleRpc {
  const url = rpcUrls(network)[0]!;
  let rpc = rpcCache.get(url);
  if (!rpc) {
    rpc = createRpc(url);
    rpcCache.set(url, rpc);
  }
  return rpc;
}

export class TransactionError extends Error {
  constructor(
    message: string,
    readonly logs: string[] = [],
  ) {
    super(message);
    this.name = "TransactionError";
  }
}

function customCode(err: unknown): number | null {
  // { InstructionError: [index, { Custom: n }] }
  const ie = (err as { InstructionError?: [number, unknown] } | null)?.InstructionError;
  const inner = ie?.[1] as { Custom?: number | bigint } | undefined;
  return inner?.Custom !== undefined ? Number(inner.Custom) : null;
}

function describeSimulation(err: unknown, logs: readonly string[]): string {
  const code = customCode(err);
  const known = code !== null ? describeProgramError(code) : null;
  if (known) return `${known.message} (${known.name})`;
  if (logs.some((l) => l.includes("insufficient lamports") || l.includes("insufficient funds"))) {
    return "Your wallet does not have enough SOL to pay for this transaction and the account rent.";
  }
  const s = JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  if (s.includes("AccountNotFound"))
    return "Your wallet account has no SOL on this network. Fund it to pay transaction fees.";
  return `The transaction would fail: ${s}`;
}

/** Builds, simulates, has the wallet sign, sends and confirms a transaction. Returns its signature. */
export async function sendWithWallet(
  rpc: SteleRpc,
  signer: TransactionSigner,
  instructions: Instruction[],
): Promise<string> {
  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();
  const message = pipe(
    createTransactionMessage({ version: "legacy" }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );

  // Simulate unsigned (sigVerify off) to surface program errors before the wallet prompt.
  const unsigned = getBase64EncodedWireTransaction(compileTransaction(message));
  const sim = await rpc
    .simulateTransaction(unsigned, {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    })
    .send();
  if (sim.value.err)
    throw new TransactionError(describeSimulation(sim.value.err, sim.value.logs ?? []), [
      ...(sim.value.logs ?? []),
    ]);

  try {
    if (isTransactionModifyingSigner(signer) || isTransactionPartialSigner(signer)) {
      return await signSendAndConfirm(rpc, message);
    }
    if (isTransactionSendingSigner(signer)) {
      const signatureBytes = await signAndSendTransactionMessageWithSigners(message);
      const signature = getBase58Decoder().decode(signatureBytes);
      await confirmSignature(rpc, signature, latestBlockhash.lastValidBlockHeight);
      return signature;
    }
  } catch (e) {
    if (isUserRejection(e)) throw new TransactionError("You rejected the request in your wallet.");
    const explained = explainTransactionError(e);
    throw new TransactionError(explained.message, explained.logs);
  }
  throw new TransactionError("The connected wallet cannot sign transactions.");
}

export function isUserRejection(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const msg = cur instanceof Error ? cur.message : String(cur);
    if (/reject|denied|declined|cancel/i.test(msg)) return true;
    if ((cur as { code?: number }).code === 4001) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

export function presetFor(network: NetworkInfo) {
  return (
    networkByChainId(network.chainId) ??
    NETWORKS[(network.cluster as keyof typeof NETWORKS) ?? "localnet"] ??
    NETWORKS.localnet
  );
}

export function txExplorerUrl(network: NetworkInfo, signature: string): string {
  return explorerTxUrl(signature, presetFor(network), rpcUrls(network)[0]);
}

export function addressExplorerUrl(network: NetworkInfo, address: string): string {
  return explorerAddressUrl(address, presetFor(network), rpcUrls(network)[0]);
}
