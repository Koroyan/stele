/**
 * SDK end-to-end: the real API (listening on a port) + a real local validator. Also simulates a
 * compromised API to prove the SDK blocks signing. Skipped without a seeded localnet.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toBase58 } from "@stele/protocol";
import {
  acceptDocument,
  confirmProof,
  IntegrityError,
  loadProofRequest,
  loadVerifiedDocument,
  SteleClient,
  type MessageSigner,
} from "@stele/sdk";
import {
  login,
  makeApp,
  realChain,
  testConfig,
  type TestApp,
} from "../../../apps/api/test/helpers.js";
import { FilesystemContentStore } from "../../../apps/api/src/lib/storage.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const DATA = resolve(ROOT, ".data/localnet");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state: any = existsSync(resolve(DATA, "state.json"))
  ? JSON.parse(readFileSync(resolve(DATA, "state.json"), "utf8"))
  : null;
const keypair = (role: string) =>
  Uint8Array.from(JSON.parse(readFileSync(resolve(DATA, `${role}.json`), "utf8")) as number[]);

async function rpcUp(url: string) {
  try {
    return (
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"jsonrpc":"2.0","id":1,"method":"getHealth"}',
      })
    ).ok;
  } catch {
    return false;
  }
}
const available = state !== null && (await rpcUp(state.rpcUrl));

function signerFor(role: string): MessageSigner & { calls: number } {
  const kp = keypair(role);
  const s = {
    address: toBase58(kp.slice(32)),
    calls: 0,
    async signMessage(message: Uint8Array) {
      s.calls++;
      return ed25519.sign(message, kp.slice(0, 32));
    },
  };
  return s;
}

describe.skipIf(!available)("SDK against the real API and validator", () => {
  let t: TestApp;
  let base = "";
  /** Browser-like fetch: sends an Origin header (the API derives the request domain from it). */
  const browserFetch = (tamper?: (url: string, body: string) => string): typeof fetch =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await fetch(input, {
        ...init,
        headers: { ...(init?.headers as Record<string, string>), origin: "http://localhost:3000" },
      });
      if (!tamper) return res;
      const url = String(input);
      const text = new TextDecoder().decode(await res.arrayBuffer());
      return new Response(tamper(url, text), { status: res.status, headers: res.headers });
    }) as typeof fetch;

  beforeAll(async () => {
    const cfg = testConfig({
      SOLANA_RPC_URLS: state.rpcUrl,
      PROGRAM_ID: state.programId,
      RELAYER_KEYPAIR: resolve(DATA, "relayer.json"),
      ATTESTOR_KEYPAIR: resolve(DATA, "attestor.json"),
      HOSTED_ACCEPT_DOMAIN: "localhost",
    });
    t = await makeApp({
      config: cfg,
      chain: await realChain(cfg),
      storage: new FilesystemContentStore(resolve(ROOT, ".data/storage")),
    });
    await t.app.listen({ host: "127.0.0.1", port: 0 });
    const addr = t.app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    // Mirror the seeded organization (as its owner would via the dashboard).
    const { syncOrganization, syncDocument, syncShard } =
      await import("../../../apps/api/src/lib/sync.js");
    await syncOrganization(t.deps.db, t.deps.chain, state.organization);
    await syncDocument(t.deps.db, t.deps.chain, state.documents.terms.address);
    await syncShard(t.deps.db, t.deps.chain, state.shard);
  });
  afterAll(async () => {
    await t?.close();
  });

  it("loads a document verified against the chain and accepts it through the wallet", async () => {
    const client = new SteleClient({ apiBaseUrl: base, fetch: browserFetch() });
    const doc = await loadVerifiedDocument({
      client,
      organization: "acme.example",
      document: "terms-of-service",
      loadPrevious: true,
    });
    expect(doc.organization.verifiedDomain).toBe("acme.example");
    expect(doc.checks.map((c) => c.label)).toEqual([
      "On-chain version",
      "Fingerprint",
      "Content integrity",
    ]);
    expect(doc.previous?.version.version).toBe(doc.version.version - 1);

    const signer = signerFor("user-1");
    const statuses: string[] = [];
    const result = await acceptDocument({
      client,
      verified: doc,
      signer,
      requestDomain: "localhost",
      onStatus: (s) => statuses.push(s),
    });
    expect(result.acceptanceId).toMatch(/^[0-9a-f]{64}$/);
    expect(statuses).toEqual(["requesting", "awaiting-signature", "recording", "recorded"]);
    expect(result.message).toContain(`Account: ${signer.address}`);
  });

  it("refuses to show content that does not match the on-chain commitment (compromised API)", async () => {
    const client = new SteleClient({
      apiBaseUrl: base,
      // Deterministic tampering: alter the first text field of whatever version is current.
      fetch: browserFetch((url, body) =>
        url.includes("/v1/public/content/") ? body.replace('"text":"', '"text":"Amended: ') : body,
      ),
    });
    await expect(
      loadVerifiedDocument({ client, organization: "acme.example", document: "terms-of-service" }),
    ).rejects.toThrow(/does not match its on-chain fingerprint/);
  });

  describe("proofs through the SDK", () => {
    let apiKey = "";
    beforeAll(async () => {
      const owner = await login(t.app, keypair("owner"));
      const synced = await t.app.inject({
        method: "POST",
        url: "/v1/organizations/sync",
        headers: owner.headers,
        payload: { address: state.organization },
      });
      const orgId = synced.json().organization.id as string;
      const key = await t.app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/api-keys`,
        headers: owner.headers,
        payload: { name: "sdk proofs", scopes: ["proofs:write", "proofs:read"] },
      });
      apiKey = key.json().key;
    });
    const newRequest = async () => {
      const res = await fetch(`${base}/v1/proof-requests`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          type: "PURCHASE",
          reference: `sdk-${Date.now()}-${Math.random()}`,
          summary: "Purchase of a notebook",
          details: {
            currency: "USD",
            items: [{ name: "Notebook", quantity: 2, unitPrice: "4.00", total: "8.00" }],
            subtotal: "8.00",
            total: "8.00",
          },
        }),
      });
      expect(res.ok).toBe(true);
      return (await res.json()) as { requestId: string; clientToken: string };
    };

    it("confirms a purchase with a wallet signer and the receipt verifies", async () => {
      const client = new SteleClient({ apiBaseUrl: base, fetch: browserFetch() });
      const { requestId, clientToken } = await newRequest();
      const request = await loadProofRequest({ client, requestId, token: clientToken });
      expect(request.lines).toContain("Total: 8.00 USD");
      const signer = signerFor("user-3");
      const result = await confirmProof({ client, request, signer, requestDomain: "localhost" });
      expect(result.message).toContain(`Statement: ${request.statementHash}`);
      const { receipt } = await client.getProofReceipt(requestId, clientToken);
      expect((receipt as { format: string }).format).toBe("stele-proof-v1");
    });

    it("refuses to show a statement that does not match its hash (compromised API)", async () => {
      const { requestId, clientToken } = await newRequest();
      const evil = new SteleClient({
        apiBaseUrl: base,
        fetch: browserFetch((url, body) =>
          url.includes(`/v1/proof-requests/${requestId}`) ? body.replace('"8.00"', '"0.08"') : body,
        ),
      });
      await expect(
        loadProofRequest({ client: evil, requestId, token: clientToken }),
      ).rejects.toBeInstanceOf(IntegrityError);
    });

    it("blocks signing when the message names a different statement (compromised API)", async () => {
      const { requestId, clientToken } = await newRequest();
      const honest = new SteleClient({ apiBaseUrl: base, fetch: browserFetch() });
      const request = await loadProofRequest({ client: honest, requestId, token: clientToken });
      let tampered = false;
      const evil = new SteleClient({
        apiBaseUrl: base,
        fetch: browserFetch((url, body) => {
          if (!url.endsWith("/challenge")) return body;
          tampered = true;
          return body.replace(/Statement: [0-9a-f]{64}/, `Statement: ${"ab".repeat(32)}`);
        }),
      });
      const signer = signerFor("user-2");
      await expect(
        confirmProof({ client: evil, request, signer, requestDomain: "localhost" }),
      ).rejects.toBeInstanceOf(IntegrityError);
      expect(tampered).toBe(true);
      expect(signer.calls).toBe(0);
    });
  });

  it("blocks signing when the server's message differs from the on-chain data (compromised API)", async () => {
    const honest = new SteleClient({ apiBaseUrl: base, fetch: browserFetch() });
    const doc = await loadVerifiedDocument({
      client: honest,
      organization: "acme.example",
      document: "terms-of-service",
    });
    // Alter the document line of the message, whatever the current title is.
    let tampered = false;
    const evil = new SteleClient({
      apiBaseUrl: base,
      fetch: browserFetch((url, body) => {
        if (!url.endsWith("/v1/acceptance/challenges")) return body;
        tampered = body.includes("Document: ");
        return body.replace("Document: ", "Document: Amended ");
      }),
    });
    const signer = signerFor("user-2");
    const attempt = acceptDocument({
      client: evil,
      verified: doc,
      signer,
      requestDomain: "localhost",
    });
    await expect(attempt).rejects.toBeInstanceOf(IntegrityError);
    await expect(attempt).rejects.toThrow(/does not match the on-chain data/);
    expect(tampered).toBe(true); // the attack really happened
    expect(signer.calls).toBe(0);
  });
});
