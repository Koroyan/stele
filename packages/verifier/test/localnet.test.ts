/**
 * Verifier integration tests against a REAL local validator seeded by `@stele/localnet`
 * (`scripts/localnet/validator.sh` + `pnpm --filter @stele/localnet seed`). Skipped when no seeded
 * localnet is available. Adversarial cases wrap the real RPC to simulate lying infrastructure.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConsensusSource,
  JsonRpcSource,
  receiptFromReport,
  verifyAcceptance,
  verifyDocumentVersion,
  type ChainSource,
  type VerificationReport,
  type VerifierOptions,
} from "../src/index";
import { decodeDocumentVersion, BorshWriter, ACCOUNT_DISCRIMINATORS } from "@stelehq/protocol";

const ROOT = resolve(import.meta.dirname, "../../..");
const STATE = resolve(ROOT, ".data/localnet/state.json");
const STORAGE = resolve(ROOT, ".data/storage/sha256");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state: any = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : null;

async function rpcUp(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"jsonrpc":"2.0","id":1,"method":"getHealth"}',
    });
    return r.ok;
  } catch {
    return false;
  }
}

const available = state !== null && (await rpcUp(state.rpcUrl));

/** Serves `http://mirror.test/<sha256>` from the local content store; optionally tampers. */
function mirrorFetch(tamper = false): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const m = /^http:\/\/mirror\.test\/([0-9a-f]{64})$/.exec(url);
    if (!m) return new Response("not found", { status: 404 });
    const path = resolve(STORAGE, m[1]!);
    if (!existsSync(path)) return new Response("not found", { status: 404 });
    let bytes = new Uint8Array(readFileSync(path));
    if (tamper)
      bytes = new TextEncoder().encode(
        new TextDecoder().decode(bytes).replace("18 years", "13 years"),
      );
    return new Response(bytes, { status: 200 });
  }) as typeof fetch;
}

function options(chain: ChainSource, extra: Partial<VerifierOptions> = {}): VerifierOptions {
  return {
    chain,
    programId: state.programId,
    content: { mirrors: ["http://mirror.test"], ipfsGateways: [], arweaveGateways: [] },
    fetchImpl: mirrorFetch(),
    ...extra,
  };
}

const failed = (r: VerificationReport) =>
  r.checks.filter((c) => c.status === "fail").map((c) => `${c.id}: ${c.detail}`);
const statusOf = (r: VerificationReport, id: string) => r.checks.find((c) => c.id === id)?.status;

/** Wraps a chain source and rewrites the data of one account (a lying RPC). */
function tamperAccount(
  inner: ChainSource,
  target: string,
  rewrite: (data: Uint8Array) => Uint8Array,
): ChainSource {
  const fix = <T extends { address: string; data: Uint8Array } | null>(a: T): T =>
    a && a.address === target ? { ...a, data: rewrite(a.data) } : a;
  return {
    description: `tampered(${inner.description})`,
    getGenesisHash: () => inner.getGenesisHash(),
    getFirstAvailableSlot: () => inner.getFirstAvailableSlot(),
    getAccount: async (a, c) => fix(await inner.getAccount(a, c)),
    getAccounts: async (as, c) => (await inner.getAccounts(as, c)).map(fix),
    getTransaction: (s) => inner.getTransaction(s),
    getSignaturesForAddress: (a, o) => inner.getSignaturesForAddress(a, o),
    getBlockSignatures: (s) => inner.getBlockSignatures(s),
    findAccounts: (p, f) => inner.findAccounts(p, f),
  };
}

/** Re-encodes a DocumentVersion with a different title (as a malicious upgrade or RPC might). */
function retitle(data: Uint8Array): Uint8Array {
  const v = decodeDocumentVersion(data);
  const w = new BorshWriter().raw(ACCOUNT_DISCRIMINATORS.DocumentVersion);
  w.address(v.document)
    .address(v.organization)
    .raw(v.versionHash)
    .raw(v.contentHash)
    .raw(v.previousVersionHash)
    .address(v.publisher);
  w.i64(v.effectiveAt)
    .i64(v.publishedAt)
    .u64(v.publishedSlot)
    .u32(v.version)
    .u8(v.publisherRole)
    .u8(v.bump);
  w.string("Friendlier Terms").string(v.versionLabel).string(v.storageUri);
  const out = new Uint8Array(data.length);
  out.set(w.toBytes());
  return out;
}

describe.skipIf(!available)("verifier against a real local validator", () => {
  const real = () => new JsonRpcSource(state.rpcUrl);
  const termsV2 = () => state.documents.terms.versions[1];
  const acceptanceTx = () => state.acceptances[0].signature;

  it("verifies a real acceptance end-to-end", async () => {
    const r = await verifyAcceptance({ transactionSignature: acceptanceTx() }, options(real()));
    expect(failed(r)).toEqual([]);
    expect(["VALID", "VALID_WITH_WARNINGS"]).toContain(r.verdict);
    expect(statusOf(r, "signature.ed25519")).toBe("pass");
    expect(statusOf(r, "message.rebuild")).toBe("pass");
    expect(statusOf(r, "nonce.consumed")).toBe("pass");
    expect(statusOf(r, "version.publication")).toBe("pass");
    expect(statusOf(r, "content.integrity")).toBe("pass");
    expect(statusOf(r, "chain.links")).toBe("pass");
    expect(r.facts.acceptance?.signer).toBe(state.acceptances[0].signer);
    expect(r.facts.version?.number).toBe(2);
    expect(r.facts.history).toHaveLength(1);
  });

  it("verifies a document version by address and by fingerprint", async () => {
    const byAddress = await verifyDocumentVersion(
      { versionAddress: termsV2().address },
      options(real()),
    );
    expect(failed(byAddress)).toEqual([]);
    expect(byAddress.facts.version?.fingerprint).toBe(termsV2().fingerprint);
    const byFingerprint = await verifyDocumentVersion(
      { fingerprint: termsV2().fingerprint },
      options(real()),
    );
    expect(statusOf(byFingerprint, "version.lookup")).toBe("pass");
    expect(byFingerprint.facts.version?.address).toBe(termsV2().address);
  });

  it("issues receipts only from verified facts and detects forged receipt claims", async () => {
    const report = await verifyAcceptance(
      { transactionSignature: acceptanceTx() },
      options(real()),
    );
    const receipt = receiptFromReport(report, { includeContent: true });
    const again = await verifyAcceptance({ receipt }, options(real()));
    expect(statusOf(again, "receipt.consistency")).toBe("pass");
    expect(statusOf(again, "content.integrity")).toBe("pass");

    const forged = {
      ...receipt,
      acceptance: { ...receipt.acceptance, signer: state.acceptances[1].signer },
    };
    const forgedReport = await verifyAcceptance({ receipt: forged }, options(real()));
    expect(forgedReport.verdict).toBe("INVALID");
    expect(statusOf(forgedReport, "receipt.consistency")).toBe("fail");

    // Every individual claim is checked: altering any one of them makes the receipt a forgery.
    const firstBlock = receipt.content!.blocks[0] as Record<string, unknown>;
    const tamperings: [string, typeof receipt][] = [
      ["version.title", { ...receipt, version: { ...receipt.version, title: "Forged Terms" } }],
      ["version.label", { ...receipt, version: { ...receipt.version, label: "9.9" } }],
      ["version.effectiveAt", { ...receipt, version: { ...receipt.version, effectiveAt: 1 } }],
      [
        "version.storageUri",
        { ...receipt, version: { ...receipt.version, storageUri: "https://evil.example/terms" } },
      ],
      ["document.slug", { ...receipt, document: { ...receipt.document, slug: "other-terms" } }],
      [
        "organization.name",
        { ...receipt, organization: { ...receipt.organization, name: "Evil Corp" } },
      ],
      [
        "organization.verifiedDomain",
        { ...receipt, organization: { ...receipt.organization, verifiedDomain: "evil.example" } },
      ],
      ["network.label", { ...receipt, network: { ...receipt.network, label: "Solana Mainnet" } }],
      [
        "acceptance.requestDomain",
        { ...receipt, acceptance: { ...receipt.acceptance, requestDomain: "evil.example" } },
      ],
      [
        "acceptance.nonce",
        {
          ...receipt,
          acceptance: {
            ...receipt.acceptance,
            nonce: { ...receipt.acceptance.nonce, index: receipt.acceptance.nonce.index + 1 },
          },
        },
      ],
      [
        "transaction.blockTime",
        {
          ...receipt,
          transaction: {
            ...receipt.transaction,
            blockTime: (receipt.transaction.blockTime ?? 0) + 3600,
          },
        },
      ],
      [
        "content",
        {
          ...receipt,
          content: {
            ...receipt.content!,
            blocks: [
              { ...firstBlock, text: `${String(firstBlock.text ?? "")} (amended)` },
              ...receipt.content!.blocks.slice(1),
            ],
          },
        },
      ],
    ];
    for (const [field, tampered] of tamperings) {
      const r = await verifyAcceptance({ receipt: tampered }, options(real()));
      expect(r.verdict, `tampered ${field}`).toBe("INVALID");
      expect(
        r.checks.find((c) => c.id === "receipt.consistency")?.detail,
        `tampered ${field}`,
      ).toContain(field);
    }
  });

  it("rejects content that does not match the on-chain commitment", async () => {
    const r = await verifyDocumentVersion(
      { versionAddress: termsV2().address },
      options(real(), { fetchImpl: mirrorFetch(true) }),
    );
    expect(r.verdict).toBe("INVALID");
    expect(statusOf(r, "content.integrity")).toBe("fail");
  });

  it("detects a version account rewritten after publication (lying RPC / malicious upgrade)", async () => {
    const r = await verifyDocumentVersion(
      { versionAddress: termsV2().address },
      options(tamperAccount(real(), termsV2().address, retitle)),
    );
    expect(r.verdict).toBe("INVALID");
    expect(statusOf(r, "version.fingerprint")).toBe("fail");
    expect(statusOf(r, "version.publication")).toBe("fail");
  });

  it("refuses to conclude when RPC endpoints disagree", async () => {
    const chain = new ConsensusSource([real(), tamperAccount(real(), termsV2().address, retitle)]);
    const r = await verifyDocumentVersion({ versionAddress: termsV2().address }, options(chain));
    expect(r.verdict).toBe("INCONCLUSIVE");
  });

  it("rejects evidence from an unexpected network", async () => {
    const r = await verifyAcceptance(
      { transactionSignature: acceptanceTx() },
      options(real(), { expectedChainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }),
    );
    expect(r.verdict).toBe("INVALID");
    expect(statusOf(r, "network.expected")).toBe("fail");
  });

  it("calls a missing transaction inconclusive unless the endpoint holds that history", async () => {
    const fake = "5".repeat(87);
    const base = tamperAccount(real(), "none", (d) => d);
    const pruned = await verifyAcceptance(
      { transactionSignature: fake },
      options({ ...base, getFirstAvailableSlot: async () => 1_000_000_000 }),
    );
    expect(pruned.verdict).toBe("INCONCLUSIVE");
    expect(statusOf(pruned, "tx.status")).toBe("error");
    const complete = await verifyAcceptance(
      { transactionSignature: fake },
      options({ ...base, getFirstAvailableSlot: async () => 0 }),
    );
    expect(complete.verdict).toBe("INVALID");
    expect(statusOf(complete, "tx.status")).toBe("fail");
  });

  it("rejects a transaction that is not an acceptance", async () => {
    const r = await verifyAcceptance(
      { transactionSignature: termsV2().signature },
      options(real()),
    );
    expect(r.verdict).toBe("INVALID");
    expect(statusOf(r, "tx.shape")).toBe("fail");
  });
});
