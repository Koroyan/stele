/**
 * Chain access for the verifier. A deliberately small JSON-RPC client (plain `fetch`) plus a
 * consensus wrapper that queries several independent endpoints and refuses to proceed if they
 * disagree. No Stele server is involved.
 *
 * Reads take an explicit commitment: state is always read at the same commitment as the
 * transaction being verified, so a `confirmed` transaction is never judged against older
 * `finalized` state.
 */
import { fromBase64 } from "@stele/protocol";

export type ReadCommitment = "finalized" | "confirmed";

export interface AccountSnapshot {
  address: string;
  owner: string;
  lamports: bigint;
  executable: boolean;
  data: Uint8Array;
}

export interface TransactionSnapshot {
  signature: string;
  slot: number;
  blockTime: number | null;
  /** Raw wire transaction. */
  wire: Uint8Array;
  err: unknown;
  logs: string[];
  /** Network fee charged to the fee payer (lamports), when the endpoint reports it. */
  fee: number | null;
  /** Addresses loaded from lookup tables (v0). */
  loadedWritable: string[];
  loadedReadonly: string[];
  commitment: ReadCommitment;
}

export interface SignatureInfo {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number | null;
}

/** Everything the verifier reads from the chain. */
export interface ChainSource {
  readonly description: string;
  getGenesisHash(): Promise<string>;
  /**
   * Oldest slot whose block the endpoint can still serve (`getFirstAvailableBlock`). Nodes without
   * full history prune old slots; 0 means complete history. Used to tell "this transaction does not
   * exist" apart from "this endpoint no longer has it".
   */
  getFirstAvailableSlot(): Promise<number>;
  getAccount(address: string, commitment?: ReadCommitment): Promise<AccountSnapshot | null>;
  getAccounts(
    addresses: string[],
    commitment?: ReadCommitment,
  ): Promise<(AccountSnapshot | null)[]>;
  getTransaction(signature: string): Promise<TransactionSnapshot | null>;
  getSignaturesForAddress(
    address: string,
    opts?: { before?: string; limit?: number; commitment?: ReadCommitment },
  ): Promise<SignatureInfo[]>;
  /** Signatures of transactions in a block (used to locate a publication transaction by slot). */
  getBlockSignatures(slot: number): Promise<string[] | null>;
  /** Program accounts matching every `memcmp` filter (bytes in base58). */
  findAccounts(programId: string, filters: MemcmpFilter[]): Promise<string[]>;
}

export interface MemcmpFilter {
  offset: number;
  bytesBase58: string;
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export class RpcDisagreementError extends Error {
  constructor(
    message: string,
    readonly details: string[],
  ) {
    super(message);
    this.name = "RpcDisagreementError";
  }
}

type Fetch = typeof fetch;

interface RpcAccount {
  owner: string;
  lamports: number;
  executable: boolean;
  data: [string, string];
}

interface RpcTransaction {
  slot: number;
  blockTime?: number | null;
  transaction: [string, string];
  meta: {
    err: unknown;
    fee?: number;
    logMessages?: string[];
    loadedAddresses?: { writable: string[]; readonly: string[] };
  } | null;
}

/** Single-endpoint JSON-RPC source. */
const RATE_LIMIT_BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000];

export class JsonRpcSource implements ChainSource {
  private id = 0;
  readonly description: string;

  constructor(
    readonly url: string,
    private readonly fetchImpl: Fetch = globalThis.fetch.bind(globalThis),
    private readonly timeoutMs = 20_000,
  ) {
    this.description = url;
  }

  /** Requests rejected with HTTP 429 were not processed: retried with backoff. */
  private async call<T>(method: string, params: unknown[]): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.callOnce<T>(method, params);
      } catch (e) {
        if (
          !(e instanceof RpcError) ||
          !/HTTP 429/.test(e.message) ||
          attempt >= RATE_LIMIT_BACKOFF_MS.length
        )
          throw e;
        await new Promise((r) => setTimeout(r, RATE_LIMIT_BACKOFF_MS[attempt]));
      }
    }
  }

  private async callOnce<T>(method: string, params: unknown[]): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
        signal: controller.signal,
      });
      if (!res.ok) throw new RpcError(`${method}: HTTP ${res.status}`, this.url);
      const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
      if (body.error)
        throw new RpcError(`${method}: ${body.error.message} (${body.error.code})`, this.url);
      return body.result as T;
    } catch (e) {
      if (e instanceof RpcError) throw e;
      throw new RpcError(`${method}: ${e instanceof Error ? e.message : String(e)}`, this.url);
    } finally {
      clearTimeout(timer);
    }
  }

  getGenesisHash(): Promise<string> {
    return this.call<string>("getGenesisHash", []);
  }

  async getFirstAvailableSlot(): Promise<number> {
    return Number(await this.call<number>("getFirstAvailableBlock", []));
  }

  private static toSnapshot(address: string, v: RpcAccount | null): AccountSnapshot | null {
    if (!v) return null;
    return {
      address,
      owner: v.owner,
      lamports: BigInt(v.lamports),
      executable: v.executable,
      data: fromBase64(v.data[0]),
    };
  }

  async getAccount(
    address: string,
    commitment: ReadCommitment = "finalized",
  ): Promise<AccountSnapshot | null> {
    const r = await this.call<{ value: RpcAccount | null }>("getAccountInfo", [
      address,
      { encoding: "base64", commitment },
    ]);
    return JsonRpcSource.toSnapshot(address, r.value);
  }

  async getAccounts(
    addresses: string[],
    commitment: ReadCommitment = "finalized",
  ): Promise<(AccountSnapshot | null)[]> {
    const out: (AccountSnapshot | null)[] = [];
    for (let i = 0; i < addresses.length; i += 100) {
      const chunk = addresses.slice(i, i + 100);
      const r = await this.call<{ value: (RpcAccount | null)[] }>("getMultipleAccounts", [
        chunk,
        { encoding: "base64", commitment },
      ]);
      r.value.forEach((v, j) => out.push(JsonRpcSource.toSnapshot(chunk[j]!, v)));
    }
    return out;
  }

  async getTransaction(signature: string): Promise<TransactionSnapshot | null> {
    for (const commitment of ["finalized", "confirmed"] as const) {
      const r = await this.call<RpcTransaction | null>("getTransaction", [
        signature,
        { encoding: "base64", commitment, maxSupportedTransactionVersion: 0 },
      ]);
      if (r) {
        return {
          signature,
          slot: r.slot,
          blockTime: r.blockTime ?? null,
          wire: fromBase64(r.transaction[0]),
          err: r.meta?.err ?? null,
          logs: r.meta?.logMessages ?? [],
          fee: typeof r.meta?.fee === "number" ? r.meta.fee : null,
          loadedWritable: r.meta?.loadedAddresses?.writable ?? [],
          loadedReadonly: r.meta?.loadedAddresses?.readonly ?? [],
          commitment,
        };
      }
    }
    return null;
  }

  async getSignaturesForAddress(
    address: string,
    opts: { before?: string; limit?: number; commitment?: ReadCommitment } = {},
  ): Promise<SignatureInfo[]> {
    const r = await this.call<SignatureInfo[]>("getSignaturesForAddress", [
      address,
      {
        commitment: opts.commitment ?? "finalized",
        limit: opts.limit ?? 1000,
        ...(opts.before ? { before: opts.before } : {}),
      },
    ]);
    return r.map((s) => ({
      signature: s.signature,
      slot: s.slot,
      err: s.err ?? null,
      blockTime: s.blockTime ?? null,
    }));
  }

  async getBlockSignatures(slot: number): Promise<string[] | null> {
    try {
      const r = await this.call<{ signatures: string[] } | null>("getBlock", [
        slot,
        {
          transactionDetails: "signatures",
          rewards: false,
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        },
      ]);
      return r?.signatures ?? null;
    } catch {
      return null;
    }
  }

  async findAccounts(programId: string, filters: MemcmpFilter[]): Promise<string[]> {
    const r = await this.call<{ pubkey: string }[]>("getProgramAccounts", [
      programId,
      {
        encoding: "base64",
        commitment: "finalized",
        filters: filters.map((f) => ({ memcmp: { offset: f.offset, bytes: f.bytesBase58 } })),
        dataSlice: { offset: 0, length: 0 },
      },
    ]);
    return r.map((a) => a.pubkey);
  }
}

function fingerprint(v: unknown): string {
  return JSON.stringify(v, (_k, x) => {
    if (typeof x === "bigint") return x.toString();
    if (x instanceof Uint8Array) return Array.from(x).join(",");
    return x;
  });
}

/**
 * Queries every source and requires identical answers. With one source this is a passthrough.
 * Sources that fail are reported; if fewer than `quorum` sources answer, the query fails.
 */
export class ConsensusSource implements ChainSource {
  readonly description: string;

  constructor(
    private readonly sources: ChainSource[],
    private readonly quorum = sources.length,
  ) {
    if (sources.length === 0) throw new Error("at least one chain source is required");
    this.description = sources.map((s) => s.description).join(", ");
  }

  private async agree<T>(
    what: string,
    run: (s: ChainSource) => Promise<T>,
    normalize: (v: T) => unknown = (v) => v,
  ): Promise<T> {
    const settled = await Promise.allSettled(this.sources.map(run));
    const answers: { source: string; value: T }[] = [];
    const failures: string[] = [];
    settled.forEach((r, i) => {
      const source = this.sources[i]!.description;
      if (r.status === "fulfilled") answers.push({ source, value: r.value });
      else
        failures.push(
          `${source}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
        );
    });
    if (answers.length < this.quorum) {
      throw new RpcError(
        `${what}: only ${answers.length}/${this.sources.length} endpoints answered (${failures.join("; ")})`,
        this.description,
      );
    }
    const first = fingerprint(normalize(answers[0]!.value));
    const disagreeing = answers
      .filter((a) => fingerprint(normalize(a.value)) !== first)
      .map((a) => a.source);
    if (disagreeing.length > 0) {
      throw new RpcDisagreementError(`${what}: endpoints returned different data`, [
        answers[0]!.source,
        ...disagreeing,
      ]);
    }
    return answers[0]!.value;
  }

  getGenesisHash() {
    return this.agree("getGenesisHash", (s) => s.getGenesisHash());
  }
  /** The most conservative answer: the newest "oldest available slot" among the endpoints. */
  async getFirstAvailableSlot() {
    const all = await Promise.all(this.sources.map((s) => s.getFirstAvailableSlot()));
    return Math.max(...all);
  }
  getAccount(address: string, commitment?: ReadCommitment) {
    return this.agree(`getAccount(${address})`, (s) => s.getAccount(address, commitment));
  }
  getAccounts(addresses: string[], commitment?: ReadCommitment) {
    return this.agree("getAccounts", (s) => s.getAccounts(addresses, commitment));
  }
  getTransaction(signature: string) {
    // Commitment may legitimately differ between nodes for very recent transactions.
    return this.agree(
      `getTransaction(${signature.slice(0, 12)}…)`,
      (s) => s.getTransaction(signature),
      (t) => (t ? { ...t, commitment: undefined } : null),
    );
  }
  getSignaturesForAddress(
    address: string,
    opts?: { before?: string; limit?: number; commitment?: ReadCommitment },
  ) {
    return this.sources[0]!.getSignaturesForAddress(address, opts);
  }
  getBlockSignatures(slot: number) {
    return this.sources[0]!.getBlockSignatures(slot);
  }
  findAccounts(programId: string, filters: MemcmpFilter[]) {
    return this.agree(
      "getProgramAccounts",
      (s) => s.findAccounts(programId, filters),
      (v) => [...v].sort(),
    );
  }
}
