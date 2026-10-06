/**
 * Thin client helpers over `@solana/kit` RPC: signing, sending with polling-based confirmation
 * (no websocket requirement), and raw account reads. Used by the relayer, scripts and tests.
 */
import {
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  getBase64EncodedWireTransaction,
  isSolanaError,
  getSignatureFromTransaction,
  signTransactionMessageWithSigners,
  type Address,
  type Commitment,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import { fromBase64 } from "./encoding";
import { describeProgramError } from "./errors";

export type SteleRpc = Rpc<SolanaRpcApi>;

/** Backoff (ms) between retries of a request an RPC endpoint rejected with HTTP 429. */
const RATE_LIMIT_BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000];

/**
 * An RPC client that retries requests rejected with HTTP 429 (rate limited) with backoff. A 429 means
 * the request was not processed, so retrying is safe for every method (re-sending a signed
 * transaction is idempotent: same signature).
 */
export function createRpc(url: string): SteleRpc {
  const transport = createDefaultRpcTransport({ url });
  const retrying: typeof transport = async (config) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await transport(config);
      } catch (e) {
        const limited =
          isSolanaError(e, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) && e.context.statusCode === 429;
        if (!limited || attempt >= RATE_LIMIT_BACKOFF_MS.length) throw e;
        await sleep(RATE_LIMIT_BACKOFF_MS[attempt]!);
      }
    }
  };
  return createSolanaRpcFromTransport(retrying);
}

export class TransactionFailedError extends Error {
  constructor(
    message: string,
    readonly signature: string,
    readonly err: unknown,
    readonly logs: string[] = [],
  ) {
    super(message);
    this.name = "TransactionFailedError";
  }
}

export class TransactionExpiredError extends Error {
  constructor(readonly signature: string) {
    super(`transaction ${signature} expired before confirmation`);
    this.name = "TransactionExpiredError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RANK: Record<string, number> = { processed: 0, confirmed: 1, finalized: 2 };

/** Polls until `commitment` is reached, the transaction fails, or its blockhash expires. */
export async function confirmSignature(
  rpc: SteleRpc,
  signature: string,
  lastValidBlockHeight: bigint,
  commitment: Commitment = "confirmed",
  pollMs = 500,
): Promise<void> {
  for (;;) {
    const { value } = await rpc
      .getSignatureStatuses([signature as never], { searchTransactionHistory: false })
      .send();
    const status = value[0];
    if (status) {
      if (status.err) {
        throw new TransactionFailedError(
          `transaction ${signature} failed: ${JSON.stringify(status.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
          signature,
          status.err,
        );
      }
      if (status.confirmationStatus && RANK[status.confirmationStatus]! >= RANK[commitment]!)
        return;
    } else {
      const height = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
      if (height > lastValidBlockHeight) throw new TransactionExpiredError(signature);
    }
    await sleep(pollMs);
  }
}

/** Signs a fully-specified transaction message with its embedded signers, sends, and confirms. */
export async function signSendAndConfirm(
  rpc: SteleRpc,
  message: Parameters<typeof signTransactionMessageWithSigners>[0] & {
    lifetimeConstraint: { lastValidBlockHeight: bigint };
  },
  opts: { commitment?: Commitment; skipPreflight?: boolean } = {},
): Promise<string> {
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  const wire = getBase64EncodedWireTransaction(signed);
  try {
    await rpc
      .sendTransaction(wire, {
        encoding: "base64",
        preflightCommitment: "confirmed",
        skipPreflight: opts.skipPreflight ?? false,
      })
      .send();
  } catch (e) {
    const logs = extractPreflightLogs(e);
    throw new TransactionFailedError(
      `transaction ${signature} rejected: ${e instanceof Error ? e.message : String(e)}`,
      signature,
      e,
      logs,
    );
  }
  await confirmSignature(
    rpc,
    signature,
    message.lifetimeConstraint.lastValidBlockHeight,
    opts.commitment ?? "confirmed",
  );
  return signature;
}

export interface ExplainedTransactionError {
  /** Custom program error code (e.g. 6042), if any. */
  code: number | null;
  /** Program error name (e.g. `VersionNotCurrent`) when the code belongs to the Stele program. */
  name: string | null;
  message: string;
  logs: string[];
}

/**
 * Turns a failed send/confirm into a precise explanation. Walks the error `cause` chain (kit nests
 * the instruction error under the preflight error) and falls back to program logs.
 */
export function explainTransactionError(e: unknown): ExplainedTransactionError {
  const logs: string[] = e instanceof TransactionFailedError ? [...e.logs] : [];
  let cur: unknown = e instanceof TransactionFailedError ? e.err : e;
  let code: number | null = null;
  const seen = new Set<unknown>();
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const ctx = (cur as { context?: Record<string, unknown> }).context;
    if (ctx) {
      if (code === null && typeof ctx.code === "number") code = ctx.code;
      if (logs.length === 0 && Array.isArray(ctx.logs)) logs.push(...(ctx.logs as string[]));
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  if (code === null) {
    for (const line of logs) {
      const m = /custom program error: (0x[0-9a-f]+)/i.exec(line);
      if (m) code = parseInt(m[1]!, 16);
    }
  }
  const known = code !== null ? describeProgramError(code) : null;
  const fallback = e instanceof Error ? e.message : String(e);
  return {
    code,
    name: known?.name ?? null,
    message: known
      ? `${known.name}: ${known.message}`
      : code !== null
        ? `custom program error ${code}`
        : fallback,
    logs,
  };
}

function extractPreflightLogs(e: unknown): string[] {
  const ctx =
    (e as { context?: { logs?: string[] }; cause?: { context?: { logs?: string[] } } }) ?? {};
  return ctx.context?.logs ?? ctx.cause?.context?.logs ?? [];
}

const CLOCK_SYSVAR = "SysvarC1ock11111111111111111111111111111111" as Address;

/**
 * The cluster's `unix_timestamp` from the Clock sysvar. Acceptance windows and effective dates
 * MUST be computed from cluster time, never from the local machine clock (which may drift).
 */
export async function getClusterUnixTimestamp(
  rpc: SteleRpc,
  commitment: Commitment = "confirmed",
): Promise<number> {
  const data = await fetchAccountData(rpc, CLOCK_SYSVAR, commitment);
  if (!data || data.length < 40) throw new Error("could not read the Clock sysvar");
  // Clock: slot u64 | epoch_start_timestamp i64 | epoch u64 | leader_schedule_epoch u64 | unix_timestamp i64
  return Number(new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(32, true));
}

/** Raw account data (base64-decoded), or `null` if the account does not exist. */
export async function fetchAccountData(
  rpc: SteleRpc,
  address: Address,
  commitment: Commitment = "confirmed",
): Promise<Uint8Array | null> {
  const { value } = await rpc.getAccountInfo(address, { encoding: "base64", commitment }).send();
  return value ? fromBase64(value.data[0]) : null;
}

export async function fetchManyAccountData(
  rpc: SteleRpc,
  addresses: Address[],
  commitment: Commitment = "confirmed",
): Promise<(Uint8Array | null)[]> {
  const out: (Uint8Array | null)[] = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const { value } = await rpc
      .getMultipleAccounts(addresses.slice(i, i + 100), { encoding: "base64", commitment })
      .send();
    for (const v of value) out.push(v ? fromBase64(v.data[0]) : null);
  }
  return out;
}
