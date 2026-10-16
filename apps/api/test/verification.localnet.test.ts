/**
 * Stele Verified against a REAL local validator (skipped without a seeded localnet): the probes run
 * on deployed programs — the Atlas demo vault, which enforces its policy, and the SPL Memo program,
 * which enforces nothing — and ownership is proven with a real memo signed by the upgrade authority.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  generateKeyPairSigner,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  documents,
  eq,
  gatePolicies,
  gatePrograms,
  organizations,
  type ProbeTemplate,
} from "@stele/db";
import {
  GATE_DEMO_PROGRAM_ADDRESS,
  createRpc,
  depositWithPassportInstruction,
  findNonceShardPda,
  signSendAndConfirm,
  toBase58,
  toHex,
  utf8,
} from "@stelehq/protocol";
import { syncOrganization, syncShard } from "../src/lib/sync.js";
import {
  ownershipMemo,
  proveOwnership,
  verifyProtectedProgram,
  verifyRegisteredProgram,
} from "../src/services/verification.js";
import { REPO_ROOT, makeApp, realChain, testConfig, type TestApp } from "./helpers.js";

const DATA = resolve(REPO_ROOT, ".data/localnet");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state: any = existsSync(resolve(DATA, "state.json"))
  ? JSON.parse(readFileSync(resolve(DATA, "state.json"), "utf8"))
  : null;
const demoOrg = existsSync(resolve(REPO_ROOT, ".env"))
  ? /^STELE_DEMO_ORGANIZATION=(\S+)/m.exec(readFileSync(resolve(REPO_ROOT, ".env"), "utf8"))?.[1]
  : undefined;

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
const available =
  state !== null &&
  !!demoOrg &&
  existsSync(resolve(DATA, "live-demo-owner.json")) &&
  existsSync(resolve(DATA, "admin.json")) &&
  (await rpcUp(state.rpcUrl));

const MEMO = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const ORIGIN = "http://localhost:3000";

/** The demo vault's deposit_with_passport, as an organization would describe it. */
function vaultTemplate(vault: Address): ProbeTemplate {
  const placeholder = address("11111111111111111111111111111111");
  const ix = depositWithPassportInstruction({
    investor: placeholder,
    vault,
    policy: placeholder,
    passport: placeholder,
    amount: 1,
  });
  return {
    data: toHex(new Uint8Array(ix.data!)),
    accounts: [
      { role: "user", signer: true, writable: false },
      { role: "address", address: vault, signer: false, writable: true },
      { role: "policy", signer: false, writable: false },
      { role: "passport", signer: false, writable: false },
    ],
  };
}

describe.skipIf(!available)("Stele Verified (real validator)", () => {
  let t: TestApp;
  type Session = { organization: string; document: string; policy: string; vault: string };
  let first: Session;
  let second: Session;

  async function session(): Promise<Session> {
    const res = await t.app.inject({
      method: "POST",
      url: "/v1/demo/sessions",
      headers: { origin: ORIGIN },
      payload: { kind: "gate" },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  }

  async function accept(s: Session) {
    const wallet = await generateKeyPairSigner();
    const ch = await t.app.inject({
      method: "POST",
      url: "/v1/acceptance/challenges",
      headers: { origin: ORIGIN },
      payload: { organization: s.organization, document: s.document, signer: wallet.address },
    });
    expect(ch.statusCode, ch.body).toBe(200);
    const { challengeId, clientBinding, message } = ch.json();
    const [signed] = await wallet.signMessages([{ content: utf8(message), signatures: {} }]);
    const submit = await t.app.inject({
      method: "POST",
      url: `/v1/acceptance/challenges/${challengeId}/submit`,
      headers: { origin: ORIGIN },
      payload: { clientBinding, signature: toBase58(new Uint8Array(signed![wallet.address]!)) },
    });
    expect(submit.statusCode, submit.body).toBe(200);
  }

  const input = async (s: Session, program: Address, template: ProbeTemplate) => {
    const [d] = await t.deps.db.select().from(documents).where(eq(documents.address, s.document));
    const [g] = await t.deps.db
      .select()
      .from(gatePolicies)
      .where(eq(gatePolicies.address, s.policy));
    return {
      program,
      template,
      policy: address(s.policy),
      document: address(s.document),
      documentId: d!.id,
      requiredVersion: g!.requiredVersion,
    };
  };

  beforeAll(async () => {
    const config = testConfig({
      SOLANA_RPC_URLS: state.rpcUrl,
      PROGRAM_ID: state.programId,
      RELAYER_KEYPAIR: resolve(DATA, "relayer.json"),
      ATTESTOR_KEYPAIR: resolve(DATA, "attestor.json"),
      STELE_DEMO_OWNER_KEYPAIR: resolve(DATA, "live-demo-owner.json"),
      STELE_DEMO_ORGANIZATION: demoOrg!,
      STELE_DEMO_SESSIONS_PER_IP: "100",
      HOSTED_ACCEPT_DOMAIN: "localhost",
    });
    t = await makeApp({ config, chain: await realChain(config) });
    await syncOrganization(t.deps.db, t.deps.chain, demoOrg!);
    // The demo organization's nonce shards (the dev API's indexer would have found them).
    for (let i = 0; i < 4; i++) {
      const [shard] = await findNonceShardPda(address(demoOrg!), i, address(state.programId));
      if ((await t.deps.chain.rpc.getAccountInfo(shard, { encoding: "base64" }).send()).value)
        await syncShard(t.deps.db, t.deps.chain, shard);
    }
    first = await session();
    second = await session();
  }, 180_000);

  afterAll(async () => {
    await t?.close();
  });

  it("is incomplete until someone accepted, but already sees the refusal", async () => {
    const r = await verifyProtectedProgram(
      t.deps,
      await input(first, GATE_DEMO_PROGRAM_ADDRESS, vaultTemplate(address(first.vault))),
    );
    expect(r.status).toBe("incomplete");
    expect(r.checks[0]).toMatchObject({
      id: "refuses_without_acceptance",
      outcome: "passed",
      error: "AccessPassMissing",
    });
    expect(r.program.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.program.authorityKind).toBe("key");
  }, 120_000);

  it("verifies a program that enforces the policy", async () => {
    await accept(first);
    const r = await verifyProtectedProgram(
      t.deps,
      await input(first, GATE_DEMO_PROGRAM_ADDRESS, vaultTemplate(address(first.vault))),
    );
    expect(r.checks.map((c) => [c.id, c.outcome])).toEqual([
      ["refuses_without_acceptance", "passed"],
      ["allows_with_acceptance", "passed"],
      ["refuses_borrowed_passport", "passed"],
    ]);
    expect(r.status).toBe("verified");
  }, 180_000);

  it("fails a program that enforces nothing", async () => {
    const r = await verifyProtectedProgram(
      t.deps,
      await input(first, MEMO, {
        data: toHex(utf8("deposit")),
        accounts: [
          { role: "user", signer: true, writable: false },
          { role: "passport", signer: false, writable: false },
        ],
      }),
    );
    expect(r.status).toBe("failed");
    expect(r.checks[0]!.outcome).toBe("failed");
  }, 120_000);

  it("fails a program that enforces another organization's policy", async () => {
    // The first session's vault pins the first policy; claim it for the second policy.
    await accept(second);
    const r = await verifyProtectedProgram(
      t.deps,
      await input(second, GATE_DEMO_PROGRAM_ADDRESS, vaultTemplate(address(first.vault))),
    );
    expect(r.status).toBe("failed");
  }, 180_000);

  it("proves ownership with a memo signed by the upgrade authority, and publishes the result", async () => {
    const rpc = createRpc(state.rpcUrl);
    if (!(await rpc.getAccountInfo(MEMO, { encoding: "base64" }).send()).value) return; // no SPL Memo
    const [org] = await t.deps.db
      .select()
      .from(organizations)
      .where(eq(organizations.address, first.organization));
    const [d] = await t.deps.db
      .select()
      .from(documents)
      .where(eq(documents.address, first.document));
    const [row] = await t.deps.db
      .insert(gatePrograms)
      .values({
        organizationId: org!.id,
        programAddress: GATE_DEMO_PROGRAM_ADDRESS,
        label: "Atlas vault",
        action: "deposit_with_passport",
        policyDocumentId: d!.id,
        mode: "require_current",
        probeTemplate: vaultTemplate(address(first.vault)),
      })
      .returning();
    expect((await verifyRegisteredProgram(t.deps, row!.id)).status).toBe("verified");

    const admin = await createKeyPairSignerFromBytes(
      Uint8Array.from(JSON.parse(readFileSync(resolve(DATA, "admin.json"), "utf8")) as number[]),
    );
    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const signature = await signSendAndConfirm(
      rpc,
      pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(admin, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) =>
          appendTransactionMessageInstructions(
            [
              {
                programAddress: MEMO,
                accounts: [
                  { address: admin.address, role: AccountRole.READONLY_SIGNER, signer: admin },
                ],
                data: utf8(ownershipMemo(GATE_DEMO_PROGRAM_ADDRESS, first.organization)),
              } as never,
            ],
            m,
          ),
      ),
      { commitment: "confirmed" },
    );
    const ownership = await proveOwnership(t.deps, org!.id, row!.id, signature);
    expect(ownership.authority).toBe(admin.address);

    const view = await t.app.inject({
      method: "GET",
      url: `/v1/public/verified/${GATE_DEMO_PROGRAM_ADDRESS}`,
    });
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json()).toMatchObject({
      status: "verified",
      organization: { address: first.organization },
      ownership: { current: true },
    });
    const badge = await t.app.inject({
      method: "GET",
      url: `/v1/public/verified/${GATE_DEMO_PROGRAM_ADDRESS}/badge.svg?theme=light`,
    });
    expect(badge.headers["content-type"]).toContain("image/svg+xml");
    expect(badge.body).toContain("Stele Verified");
  }, 180_000);
});
