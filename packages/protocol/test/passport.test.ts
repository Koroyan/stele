/**
 * Stele Gate passports: the account layout (checked against the Rust constants), entry lookup and
 * the instruction encodings the API sends.
 */
import { readFileSync } from "node:fs";
import { address, type Address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DISCRIMINATORS,
  BorshWriter,
  INSTRUCTION_DISCRIMINATORS,
  PASSPORT_ENTRY_LEN,
  PASSPORT_HEADER_LEN,
  closePassportInstruction,
  decodePassport,
  decodeRecordAcceptanceArgs,
  findPassportPda,
  passportEntry,
  recordPassportAcceptanceInstruction,
  removePassportEntryInstruction,
} from "../src";

const rust = readFileSync(
  new URL("../../../programs/stele/src/instructions/passport.rs", import.meta.url),
  "utf8",
);
const rustConst = (name: string) =>
  Number(new RegExp(`pub const ${name}: usize = (\\d+);`).exec(rust)?.[1]);

const holder = address("4DxyhirLWuro467qdFGYU8RX3jpjXBFPxCAKvX1Ryqcz");
const docA = address("9ZKs8WbAmgYKAKLqmzaYR5pyRZi6fdop91mwDWDwZrgk");
const docB = address("2bLoDhaEJD2k6Asn7NXpDjtDpuN9HhSurZtPb1cXK4Ns");
const payer = address("BLECAww6xiFLr89hgXg3eJwiN1VitX4ML8Z6yE8yPgMS");

function passportBytes(entries: { document: Address; version: number }[]): Uint8Array {
  const w = new BorshWriter();
  w.fixed(ACCOUNT_DISCRIMINATORS.Passport, 8)
    .address(holder)
    .u32(entries.length)
    .u8(254)
    .address(payer);
  for (const e of entries) w.address(e.document).u32(e.version).i64(1_790_000_000n).address(payer);
  return w.toBytes();
}

describe("Stele Gate passports", () => {
  it("uses the program's layout", () => {
    expect(PASSPORT_HEADER_LEN).toBe(rustConst("PASSPORT_HEADER_LEN"));
    expect(PASSPORT_ENTRY_LEN).toBe(rustConst("PASSPORT_ENTRY_LEN"));
  });

  it("decodes entries and finds a document", () => {
    const data = passportBytes([
      { document: docA, version: 3 },
      { document: docB, version: 1 },
    ]);
    expect(data.length).toBe(PASSPORT_HEADER_LEN + 2 * PASSPORT_ENTRY_LEN);
    const p = decodePassport(data);
    expect(p.holder).toBe(holder);
    expect(p.basePayer).toBe(payer);
    expect(p.entries).toHaveLength(2);
    expect(passportEntry(p, docA)?.versionNumber).toBe(3);
    expect(passportEntry(p, docB)?.payer).toBe(payer);
    expect(passportEntry(p, payer)).toBeNull();
  });

  it("refuses a passport whose length does not match its count", () => {
    const data = passportBytes([{ document: docA, version: 1 }]);
    expect(() => decodePassport(data.subarray(0, data.length - 1))).toThrow();
  });

  it("encodes record_passport_acceptance with the bump after the acceptance arguments", async () => {
    const [passport, bump] = await findPassportPda(holder);
    const ix = recordPassportAcceptanceInstruction({
      relayer: payer,
      rentPayer: holder,
      config: payer,
      organization: payer,
      document: docA,
      version: docB,
      nonceShard: payer,
      passport,
      passportBump: bump,
      nonceIndex: 7,
      nonceTag: new Uint8Array(8).fill(9),
      issuedAt: 100n,
      expiresAt: 700n,
    });
    const data = ix.data!;
    expect(data.subarray(0, 8)).toEqual(INSTRUCTION_DISCRIMINATORS.record_passport_acceptance);
    expect(data.length).toBe(8 + 4 + 8 + 8 + 8 + 1);
    expect(data[data.length - 1]).toBe(bump);
    expect(decodeRecordAcceptanceArgs(new Uint8Array(data))).toMatchObject({
      nonceIndex: 7,
      issuedAt: 100n,
      expiresAt: 700n,
    });
    expect(ix.accounts).toHaveLength(10);
    expect(ix.accounts![7]!.address).toBe(passport);
  });

  it("encodes removal and closing", () => {
    const rm = removePassportEntryInstruction({
      authority: holder,
      passport: payer,
      refundTo: payer,
      document: docA,
    });
    expect(rm.data!.subarray(0, 8)).toEqual(INSTRUCTION_DISCRIMINATORS.remove_passport_entry);
    expect(rm.data!.length).toBe(40);
    const close = closePassportInstruction({ authority: holder, passport: payer, refundTo: payer });
    expect(close.data!).toEqual(INSTRUCTION_DISCRIMINATORS.close_passport);
  });
});
