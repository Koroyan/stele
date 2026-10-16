/**
 * Stele Verified — the pure parts: reading program accounts, recognising the Stele check's errors,
 * building probe instructions, ownership memos and the badge image.
 */
import { createHash } from "node:crypto";
import { AccountRole, address, getAddressEncoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { probeInstruction, toBase58, utf8 } from "@stelehq/protocol";
import { badgeSvg } from "../src/lib/badge-svg.js";
import {
  codeHashOf,
  gateErrorOf,
  memoSignedBy,
  ownershipMemo,
  programDataFacts,
  validateTemplate,
} from "../src/services/verification.js";
import type { Simulation } from "../src/services/gate.js";

const PROGRAM = address("A6DBoANAavtbG2ARK6PihqzMjhtbcZUbLnTMAWn339uR");
const AUTHORITY = "C6q9uiQsmxy5E2hx3hjv1i36i98vXvtBF35Hfq54GJ4p";
const fill = {
  user: address("4DxyhirLWuro467qdFGYU8RX3jpjXBFPxCAKvX1Ryqcz"),
  passport: address("HajBAhJa5PuCJ2Ag2AdYX6qyjPe62jsecostg7j4tX3y"),
  accessPass: address("9fZqgGKaf98xuxsH1NUMegFksETzWgG3f2J55WGGB6Mh"),
  policy: address("5cLhAAbrFmcAHNq214PcKoCEAgh1QvurrxpSst3R2HnR"),
};
const template = {
  data: "0a0b",
  accounts: [
    { role: "user" as const, signer: true, writable: false },
    { role: "address" as const, address: AUTHORITY, signer: false, writable: true },
    { role: "policy" as const, signer: false, writable: false },
    { role: "passport" as const, signer: false, writable: false },
  ],
};

function programData(authority: string | null, code: Uint8Array, slot = 42n): Uint8Array {
  const d = new Uint8Array(45 + code.length);
  const v = new DataView(d.buffer);
  v.setUint32(0, 3, true);
  v.setBigUint64(4, slot, true);
  if (authority) {
    d[12] = 1;
    d.set(getAddressEncoder().encode(address(authority)), 13);
  }
  d.set(code, 45);
  return d;
}

const sim = (logs: string[], failure: Simulation["failure"]): Simulation => ({
  ok: failure === null,
  failure,
  logs,
  unitsConsumed: 1,
});

describe("program facts", () => {
  it("hashes the code without the zero padding of an extended account", () => {
    const code = new Uint8Array([1, 2, 3, 0, 4]);
    const padded = new Uint8Array([...code, 0, 0, 0, 0]);
    const expected = createHash("sha256").update(code).digest("hex");
    expect(codeHashOf(code)).toBe(expected);
    expect(codeHashOf(padded)).toBe(expected);
  });

  it("reads the deployment slot and the upgrade authority", () => {
    const facts = programDataFacts(programData(AUTHORITY, new Uint8Array([7, 7]), 99n));
    expect(facts).toMatchObject({
      deployedSlot: 99,
      upgradeAuthority: AUTHORITY,
      authorityKind: "key",
    });
    expect(facts.codeHash).toBe(codeHashOf(new Uint8Array([7, 7])));
  });

  it("tells a program-controlled authority (a multisig vault PDA) from a key and from none", () => {
    // The Stele passport above is a PDA: off the curve, like a Squads vault.
    expect(programDataFacts(programData(fill.passport, new Uint8Array([1]))).authorityKind).toBe(
      "program",
    );
    expect(programDataFacts(programData(null, new Uint8Array([1]))).authorityKind).toBe(
      "immutable",
    );
  });

  it("reads a header-only slice (the monitor's cheap check)", () => {
    const header = programData(AUTHORITY, new Uint8Array()).subarray(0, 45);
    expect(programDataFacts(header)).toMatchObject({ codeHash: null, deployedSlot: 42 });
  });
});

describe("the Stele check's errors", () => {
  it("recognises the stele-gate crate's codes", () => {
    expect(
      gateErrorOf(
        sim([], {
          program: PROGRAM,
          code: 7602,
          source: "stele-gate",
          name: "AccessPassMissing",
          message: "",
        }),
      ),
    ).toBe("AccessPassMissing");
  });

  it("recognises an inlined check by its Anchor error name", () => {
    const logs = [
      "Program log: AnchorError occurred. Error Code: AccessPassMismatch. Error Number: 6004. Error Message: x.",
    ];
    expect(
      gateErrorOf(
        sim(logs, {
          program: PROGRAM,
          code: 6004,
          source: "program",
          name: "Custom(6004)",
          message: "",
        }),
      ),
    ).toBe("AccessPassMismatch");
  });

  it("does not count other failures, or success, as the Stele check", () => {
    const logs = [
      "Program log: AnchorError occurred. Error Code: InsufficientFunds. Error Number: 6001.",
    ];
    expect(
      gateErrorOf(
        sim(logs, {
          program: PROGRAM,
          code: 6001,
          source: "program",
          name: "Custom(6001)",
          message: "",
        }),
      ),
    ).toBeNull();
    expect(gateErrorOf(sim([], null))).toBeNull();
  });
});

describe("probe templates", () => {
  it("fills the placeholders and keeps signer and writable flags", () => {
    const ix = probeInstruction(PROGRAM, template, fill);
    expect(ix.programAddress).toBe(PROGRAM);
    expect(ix.accounts).toEqual([
      { address: fill.user, role: AccountRole.READONLY_SIGNER },
      { address: AUTHORITY, role: AccountRole.WRITABLE },
      { address: fill.policy, role: AccountRole.READONLY },
      { address: fill.passport, role: AccountRole.READONLY },
    ]);
    expect([...ix.data!]).toEqual([10, 11]);
  });

  it("refuses templates the probes cannot use", () => {
    expect(() => validateTemplate(template)).not.toThrow();
    const without = (role: string) => ({
      ...template,
      accounts: template.accounts.filter((a) => a.role !== role),
    });
    expect(() => validateTemplate(without("user"))).toThrow(/user/);
    expect(() => validateTemplate(without("passport"))).toThrow(/passport/);
    expect(() =>
      validateTemplate({
        ...template,
        accounts: template.accounts.map((a) => (a.role === "user" ? { ...a, signer: false } : a)),
      }),
    ).toThrow(/signer/);
    expect(() =>
      validateTemplate({
        ...template,
        accounts: [...template.accounts, { role: "accessPass", signer: false, writable: false }],
      }),
    ).toThrow(/either/);
    expect(() => validateTemplate({ ...template, data: "abc" })).toThrow(/hex/);
  });
});

describe("ownership memos", () => {
  const memo = ownershipMemo(PROGRAM, "4uUQvTV11eYcpugMWswvh4Hggpt7dThHbkout9VG1j68");
  const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
  const tx = (o: {
    text?: string;
    signers?: string[];
    memoAccounts?: string[];
    err?: unknown;
    inner?: boolean;
  }) => {
    const signers = o.signers ?? [AUTHORITY];
    const keys = [...signers, MEMO, ...(o.memoAccounts ?? [])];
    const ix = {
      programIdIndex: signers.length,
      accounts: (o.memoAccounts ?? []).map((_, i) => signers.length + 1 + i),
      data: toBase58(utf8(o.text ?? memo)),
    };
    return {
      transaction: {
        message: {
          accountKeys: keys,
          header: { numRequiredSignatures: signers.length },
          instructions: o.inner ? [] : [ix],
        },
      },
      meta: { err: o.err ?? null, innerInstructions: o.inner ? [{ instructions: [ix] }] : [] },
    };
  };

  it("accepts the exact memo signed by the authority", () => {
    expect(memoSignedBy(tx({}), memo, AUTHORITY)).toBe(true);
  });

  it("accepts a multisig vault that signs the memo through its program (inner instruction)", () => {
    const vault = fill.passport;
    expect(
      memoSignedBy(tx({ signers: [fill.user], memoAccounts: [vault], inner: true }), memo, vault),
    ).toBe(true);
  });

  it("refuses another text, another signer or a failed transaction", () => {
    expect(memoSignedBy(tx({ text: `${memo} ` }), memo, AUTHORITY)).toBe(false);
    expect(memoSignedBy(tx({ signers: [fill.user] }), memo, AUTHORITY)).toBe(false);
    expect(memoSignedBy(tx({ err: { InstructionError: [0, "x"] } }), memo, AUTHORITY)).toBe(false);
  });
});

describe("badge image", () => {
  it("says verified only when verified, in both themes", () => {
    expect(badgeSvg("verified", "dark")).toContain("Stele Verified");
    expect(badgeSvg("verified", "light")).toContain("#047857");
    for (const s of ["failed", "incomplete", "unverified"] as const)
      expect(badgeSvg(s)).not.toContain("Stele Verified");
    expect(badgeSvg("failed")).toContain("Not verified");
  });
});
