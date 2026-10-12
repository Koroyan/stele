/**
 * Minimal, strict decoder for Solana wire transactions (legacy and v0). Written out by hand so the
 * verifier's trusted surface is small and independent of client-library internals.
 */
import { toBase58 } from "@stelehq/protocol";

export interface DecodedInstruction {
  index: number;
  programId: string;
  accounts: string[];
  data: Uint8Array;
}

export interface DecodedTransaction {
  version: "legacy" | 0;
  signatures: Uint8Array[];
  numRequiredSignatures: number;
  accountKeys: string[];
  recentBlockhash: string;
  instructions: DecodedInstruction[];
}

class Cursor {
  offset = 0;
  constructor(readonly bytes: Uint8Array) {}
  need(n: number) {
    if (this.offset + n > this.bytes.length) throw new Error("truncated transaction");
  }
  u8(): number {
    this.need(1);
    return this.bytes[this.offset++]!;
  }
  /** Solana "short vec" compact-u16. */
  compactU16(): number {
    let value = 0;
    for (let shift = 0; shift < 21; shift += 7) {
      const b = this.u8();
      value |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return value;
    }
    throw new Error("invalid compact-u16");
  }
  take(n: number): Uint8Array {
    this.need(n);
    const v = this.bytes.slice(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }
}

export function decodeWireTransaction(
  wire: Uint8Array,
  loadedWritable: string[] = [],
  loadedReadonly: string[] = [],
): DecodedTransaction {
  const c = new Cursor(wire);
  const numSigs = c.compactU16();
  const signatures = Array.from({ length: numSigs }, () => c.take(64));

  let version: "legacy" | 0 = "legacy";
  const first = c.u8();
  let numRequiredSignatures = first;
  if (first & 0x80) {
    const v = first & 0x7f;
    if (v !== 0) throw new Error(`unsupported transaction version ${v}`);
    version = 0;
    numRequiredSignatures = c.u8();
  }
  c.u8(); // num readonly signed
  c.u8(); // num readonly unsigned
  const numKeys = c.compactU16();
  const staticKeys = Array.from({ length: numKeys }, () => toBase58(c.take(32)));
  const recentBlockhash = toBase58(c.take(32));
  const numIx = c.compactU16();
  const raw = Array.from({ length: numIx }, () => {
    const programIndex = c.u8();
    const accounts = Array.from({ length: c.compactU16() }, () => c.u8());
    const data = c.take(c.compactU16());
    return { programIndex, accounts, data };
  });
  if (version === 0) {
    const lookups = c.compactU16();
    for (let i = 0; i < lookups; i++) {
      c.take(32);
      c.take(c.compactU16());
      c.take(c.compactU16());
    }
  }
  if (c.offset !== wire.length) throw new Error("trailing bytes after transaction");

  const accountKeys = [...staticKeys, ...loadedWritable, ...loadedReadonly];
  const key = (i: number) => {
    const k = accountKeys[i];
    if (k === undefined) throw new Error(`account index ${i} out of range`);
    return k;
  };
  const instructions = raw.map((ix, index) => {
    // Program IDs must be static keys (v0 rule).
    if (ix.programIndex >= staticKeys.length)
      throw new Error("program id loaded from a lookup table");
    return {
      index,
      programId: key(ix.programIndex),
      accounts: ix.accounts.map(key),
      data: ix.data,
    };
  });
  return { version, signatures, numRequiredSignatures, accountKeys, recentBlockhash, instructions };
}
