/**
 * Minimal, strict Borsh reader/writer for the program's accounts, instructions and events.
 * Hand-written (not generated) so the verifier's trusted decoding surface is small and auditable:
 * every read is bounds-checked, booleans must be 0/1, strings must be valid UTF-8 within limits.
 */
import { getAddressDecoder, getAddressEncoder, type Address } from "@solana/kit";
import { fromUtf8, utf8 } from "./encoding";
import { ProtocolError } from "./errors";

export class BorshReader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  private need(n: number): void {
    if (this.offset + n > this.data.length)
      throw new ProtocolError("DECODE_ERROR", "unexpected end of data");
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  u64(): bigint {
    this.need(8);
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }

  i64(): bigint {
    this.need(8);
    const v = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return v;
  }

  bool(): boolean {
    const b = this.u8();
    if (b > 1) throw new ProtocolError("DECODE_ERROR", "invalid boolean");
    return b === 1;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const v = this.data.slice(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }

  address(): Address {
    return getAddressDecoder().decode(this.bytes(32));
  }

  string(maxBytes: number): string {
    const len = this.u32();
    if (len > maxBytes)
      throw new ProtocolError("DECODE_ERROR", `string longer than ${maxBytes} bytes`);
    return fromUtf8(this.bytes(len));
  }

  option<T>(read: () => T): T | null {
    const tag = this.u8();
    if (tag === 0) return null;
    if (tag === 1) return read();
    throw new ProtocolError("DECODE_ERROR", "invalid option tag");
  }
}

export class BorshWriter {
  private chunks: Uint8Array[] = [];

  raw(b: Uint8Array): this {
    this.chunks.push(new Uint8Array(b));
    return this;
  }

  u8(n: number): this {
    return this.raw(Uint8Array.of(n));
  }

  u16(n: number): this {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n, true);
    return this.raw(b);
  }

  u32(n: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return this.raw(b);
  }

  u64(n: bigint | number): this {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
    return this.raw(b);
  }

  i64(n: bigint | number): this {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, BigInt(n), true);
    return this.raw(b);
  }

  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }

  fixed(b: Uint8Array, length: number): this {
    if (b.length !== length) throw new ProtocolError("INVALID_FORMAT", `expected ${length} bytes`);
    return this.raw(b);
  }

  address(a: Address): this {
    return this.raw(new Uint8Array(getAddressEncoder().encode(a)));
  }

  string(s: string): this {
    const b = utf8(s);
    return this.u32(b.length).raw(b);
  }

  optionAddress(a: Address | null): this {
    return a === null ? this.u8(0) : this.u8(1).address(a);
  }

  toBytes(): Uint8Array {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}
