/**
 * Unit tests for security primitives: SSRF policy, webhooks, encryption, audit chain, SIWS, the
 * billing rules (credit packs, payment matching) and the relayer transaction allowlist.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { auditLog, organizations, webhookDeliveries, webhookEndpoints } from "@stele/db";
import { createTestDb } from "@stele/db/testing";
import type { DbHandle } from "@stele/db";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import { address, generateKeyPairSigner } from "@solana/kit";
import {
  DEFAULT_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
  buildEd25519Instruction,
  enrollPasskeySignerInstruction,
  recordAcceptanceInstruction,
  recordPasskeyAcceptanceInstruction,
  recoverPasskeySignerInstruction,
  rotatePasskeySignerInstruction,
  secp256r1Instruction,
  toBase58,
  utf8,
} from "@stelehq/protocol";
import { parseCreditPacks } from "../src/config.js";
import { appendAudit, verifyAuditChain } from "../src/lib/audit.js";
import { matchPayment } from "../src/services/billing.js";
import { decrypt, encrypt, hmacSha256Hex } from "../src/lib/crypto.js";
import { buildSiwsMessage, parseSiwsMessage, SIWS_STATEMENT } from "../src/lib/siws.js";
import { isPublicIp, validateOutboundUrl } from "../src/lib/ssrf.js";
import { assertSponsoredRecordingShape } from "../src/lib/tx-policy.js";
import { dispatchDueWebhooks, enqueueWebhook, signPayload } from "../src/lib/webhooks.js";

let h: DbHandle;
beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => {
  await h.close();
});

describe("SSRF policy", () => {
  it("classifies addresses", () => {
    for (const ip of [
      "10.1.2.3",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.5.4",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
      "224.0.0.1",
    ]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
      expect(isPublicIp(ip), ip).toBe(true);
  });

  it("rejects dangerous webhook URLs", () => {
    const prod = { allowInsecureLoopback: false };
    for (const url of [
      "http://example.com/hook",
      "https://user:pw@example.com/",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.5/x",
      "https://localhost/x",
      "ftp://example.com",
      "https://svc.internal/x",
      "https://[::1]/x",
    ]) {
      expect(() => validateOutboundUrl(url, prod), url).toThrow();
    }
    expect(validateOutboundUrl("https://hooks.example.com/stele", prod).hostname).toBe(
      "hooks.example.com",
    );
    expect(
      validateOutboundUrl("http://localhost:9999/hook", { allowInsecureLoopback: true }).port,
    ).toBe("9999");
  });
});

describe("encryption at rest", () => {
  it("round-trips and detects tampering", () => {
    const key = randomBytes(32);
    const ct = encrypt("whsec_example", key);
    expect(decrypt(ct, key)).toBe("whsec_example");
    const bytes = Buffer.from(ct, "base64");
    bytes[bytes.length - 20]! ^= 1;
    expect(() => decrypt(bytes.toString("base64"), key)).toThrow();
    expect(() => decrypt(ct, randomBytes(32))).toThrow();
  });
});

describe("webhooks", () => {
  it("signs t.body with HMAC-SHA256", () => {
    const sig = signPayload("whsec_x", 1_700_000_000, '{"a":1}');
    expect(sig).toBe(`t=1700000000,v1=${hmacSha256Hex("whsec_x", '1700000000.{"a":1}')}`);
  });

  it("delivers through the outbox with retries and backoff", async () => {
    const key = randomBytes(32);
    const [org] = await h.db
      .insert(organizations)
      .values({ address: "OrgHooks", creatorAddress: "c", name: "Hooks", ownerAddress: "o" })
      .returning();
    const [ep] = await h.db
      .insert(webhookEndpoints)
      .values({
        organizationId: org!.id,
        url: "https://hooks.example.com/x",
        events: ["agreement.accepted"],
        secretCiphertext: encrypt("whsec_test", key),
      })
      .returning();
    expect(
      await enqueueWebhook(
        h.db,
        org!.id,
        "agreement.accepted",
        { acceptanceId: "a".repeat(64) },
        "evt_1",
      ),
    ).toBe(1);
    expect(await enqueueWebhook(h.db, org!.id, "document.version_published", {}, "evt_2")).toBe(0); // not subscribed

    const seen: { headers: Record<string, string>; body: string }[] = [];
    let ok = false;
    const post = async (_url: URL, body: string, headers: Record<string, string>) => {
      seen.push({ headers, body });
      return { status: ok ? 200 : 500, body: "" };
    };
    const opts = { encryptionKey: key, urlPolicy: { allowInsecureLoopback: false }, post };
    expect(await dispatchDueWebhooks(h.db, opts)).toEqual({ delivered: 0, failed: 1 });
    const [failed] = await h.db.select().from(webhookDeliveries);
    expect(failed!.status).toBe("failed");
    expect(failed!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 50_000);

    // Verify the receiver-side signature check works on what was sent.
    const sent = seen[0]!;
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sent.headers["stele-signature"]!)!;
    expect(hmacSha256Hex("whsec_test", `${t}.${sent.body}`)).toBe(v1);
    expect(JSON.parse(sent.body).type).toBe("agreement.accepted");

    ok = true;
    expect(
      await dispatchDueWebhooks(h.db, { ...opts, now: () => new Date(Date.now() + 3_600_000) }),
    ).toEqual({ delivered: 1, failed: 0 });
    const [delivered] = await h.db.select().from(webhookDeliveries);
    expect(delivered!.status).toBe("delivered");
    void ep;
  });
});

describe("audit log", () => {
  it("hash-chains entries and detects out-of-band insertion", async () => {
    const [org] = await h.db
      .insert(organizations)
      .values({ address: "OrgAudit", creatorAddress: "c", name: "Audit", ownerAddress: "o" })
      .returning();
    for (const action of ["document.created", "version.published", "api_key.created"]) {
      await appendAudit(h.db, {
        organizationId: org!.id,
        actorType: "user",
        actorId: "u1",
        action,
        metadata: { n: action.length },
      });
    }
    const report = await verifyAuditChain(h.db, org!.id);
    expect(report).toMatchObject({ valid: true, entries: 3 });

    // A DBA inserting a forged entry (the trigger blocks edits, not inserts) breaks the chain.
    await h.db.insert(auditLog).values({
      organizationId: org!.id,
      sequence: 4,
      actorType: "system",
      actorId: "dba",
      action: "api_key.revoked",
      metadata: {},
      createdAt: new Date(),
      prevHash: report.headHash,
      entryHash: "f".repeat(64),
    });
    const broken = await verifyAuditChain(h.db, org!.id);
    expect(broken.valid).toBe(false);
    expect(broken.brokenAtSequence).toBe(4);
  });
});

describe("SIWS messages", () => {
  it("round-trips and rejects unknown fields", () => {
    const fields = {
      domain: "app.stele.example",
      address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      statement: SIWS_STATEMENT,
      uri: "https://app.stele.example",
      version: "1",
      chainId: "mainnet",
      nonce: "abc123",
      issuedAt: "2026-09-28T00:00:00.000Z",
      expirationTime: "2026-09-28T00:10:00.000Z",
    };
    const msg = buildSiwsMessage(fields);
    expect(parseSiwsMessage(msg)).toEqual(fields);
    expect(() => parseSiwsMessage(`${msg}\nInjected: field`)).toThrow();
    expect(() => parseSiwsMessage("Stele Protocol v1 - Accept Agreement\n…")).toThrow();
  });
});

describe("billing", () => {
  it("parses credit packs exactly and rejects malformed ones", () => {
    expect(parseCreditPacks("100000:4, 10000:0.5")).toEqual([
      { id: "10000", credits: 10_000, lamports: 500_000_000 },
      { id: "100000", credits: 100_000, lamports: 4_000_000_000 },
    ]);
    expect(parseCreditPacks("1:0.000000001")).toEqual([{ id: "1", credits: 1, lamports: 1 }]);
    for (const bad of ["10000", "10000:-1", "0:1", "1:0", "1:0.0000000001", "5:1,5:2", "a:1"])
      expect(() => parseCreditPacks(bad), bad).toThrow(/STELE_CREDIT_PACKS/);
  });

  it("accepts only a transfer of at least the amount, to the treasury, carrying the reference", () => {
    const treasury = "Treasury1111111111111111111111111111111111";
    const reference = "Reference111111111111111111111111111111111";
    const transfer = (
      lamports: bigint,
      accounts: string[],
      programId: string = SYSTEM_PROGRAM_ADDRESS,
    ) => {
      const data = new Uint8Array(12);
      const view = new DataView(data.buffer);
      view.setUint32(0, 2, true);
      view.setBigUint64(4, lamports, true);
      return { index: 0, programId, accounts, data };
    };
    const expected = { treasury, reference, lamports: 1_000 };
    const payer = "Payer11111111111111111111111111111111111111";
    const ok = { instructions: [transfer(1_000n, [payer, treasury, reference])] };
    expect(matchPayment(ok, expected)).toEqual({ payer, lamports: 1_000n });
    for (const tx of [
      { instructions: [transfer(999n, [payer, treasury, reference])] }, // underpaid
      { instructions: [transfer(1_000n, [payer, payer, reference])] }, // elsewhere
      { instructions: [transfer(1_000n, [payer, treasury])] }, // no reference
      { instructions: [transfer(1_000n, [reference, treasury, payer])] }, // reference as payer
      {
        instructions: [
          transfer(
            1_000n,
            [payer, treasury, reference],
            "Other111111111111111111111111111111111111111",
          ),
        ],
      }, // not the System Program
    ])
      expect(matchPayment(tx, expected)).toBeNull();
  });
});

describe("relayer transaction policy", () => {
  it("pairs Ed25519 only with stele/1 recordings and secp256r1 only with native-passkey instructions", async () => {
    const relayer = await generateKeyPairSigner();
    const other = await generateKeyPairSigner();
    const programAddress = address(DEFAULT_PROGRAM_ADDRESS);
    const a = (n: number) => address(toBase58(new Uint8Array(32).fill(n)));
    const opts = { programAddress, relayer: relayer.address, maxPriorityFeeMicroLamports: 0n };
    const limit = getSetComputeUnitLimitInstruction({ units: 80_000 });
    const key = Uint8Array.of(2, ...new Uint8Array(32).fill(7));
    const secp = secp256r1Instruction(key, new Uint8Array(64).fill(1), new Uint8Array(69).fill(3));
    const ed = buildEd25519Instruction(
      new Uint8Array(32).fill(5),
      new Uint8Array(64).fill(6),
      utf8("message"),
    );
    const assertion = {
      requestDomain: "shop.example",
      rpId: "shop.example",
      clientDataJson: utf8("{}"),
    };
    const base = { programAddress, relayer, config: a(1), organization: a(2) };
    const recordPasskey = recordPasskeyAcceptanceInstruction({
      ...base,
      document: a(3),
      version: a(4),
      nonceShard: a(5),
      enrollment: null,
      nonceIndex: 1,
      nonceTag: new Uint8Array(8),
      issuedAt: 1,
      expiresAt: 2,
      assertion,
    });
    const enroll = enrollPasskeySignerInstruction({
      ...base,
      nonceShard: a(5),
      enrollment: a(6),
      accountCommitment: new Uint8Array(32).fill(9),
      credentialIdHash: new Uint8Array(32),
      issuedAt: 1,
      expiresAt: 2,
      assertion,
    });
    const rotate = rotatePasskeySignerInstruction({
      ...base,
      enrollment: a(6),
      newSigner: key,
      newCredentialIdHash: new Uint8Array(32),
      issuedAt: 1,
      expiresAt: 2,
      assertion,
    });
    const recordV1 = recordAcceptanceInstruction({
      ...base,
      document: a(3),
      version: a(4),
      nonceShard: a(5),
      nonceIndex: 1,
      nonceTag: new Uint8Array(8),
      issuedAt: 1,
      expiresAt: 2,
    });
    // Recovery is signed by the organization's own wallet, never by the relayer.
    const recover = recoverPasskeySignerInstruction({
      programAddress,
      authority: relayer,
      membership: null,
      organization: a(2),
      enrollment: a(6),
      newSigner: key,
      newCredentialIdHash: new Uint8Array(32),
      rpIdHash: new Uint8Array(32),
    });
    const recordByOther = recordPasskeyAcceptanceInstruction({
      ...base,
      relayer: other,
      document: a(3),
      version: a(4),
      nonceShard: a(5),
      enrollment: null,
      nonceIndex: 1,
      nonceTag: new Uint8Array(8),
      issuedAt: 1,
      expiresAt: 2,
      assertion,
    });
    const indirect = { ...secp, data: Uint8Array.from(secp.data!) };
    indirect.data[4] = 0; // signature read from instruction 0 instead of itself
    const withAccounts = { ...secp, accounts: [{ address: a(9), role: 0 }] } as typeof secp;

    for (const ok of [
      [limit, secp, recordPasskey],
      [limit, secp, enroll],
      [limit, secp, rotate],
      [limit, ed, recordV1],
    ])
      expect(() => assertSponsoredRecordingShape(ok, opts)).not.toThrow();
    for (const bad of [
      [limit, secp, recordV1],
      [limit, ed, recordPasskey],
      [limit, ed, enroll],
      [limit, indirect, recordPasskey],
      [limit, withAccounts, recordPasskey],
      [limit, secp, recover],
      [limit, secp, recordByOther],
      [limit, recordPasskey, secp],
    ])
      expect(() => assertSponsoredRecordingShape(bad, opts)).toThrow(/refusing to sign/);
  });
});
