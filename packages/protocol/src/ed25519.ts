/**
 * Native Ed25519 precompile instruction (canonical single-signature layout) and strict off-chain
 * verification. Off-chain verification uses RFC 8032 strict rules (`zip215: false`), matching the
 * runtime's `verify_strict`.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { address, type Instruction } from "@solana/kit";
import { ProtocolError } from "./errors";

export const ED25519_PROGRAM_ADDRESS = address("Ed25519SigVerify111111111111111111111111111");

const PUBKEY_OFFSET = 16;
const SIGNATURE_OFFSET = 48;
const MESSAGE_OFFSET = 112;
const SELF = 0xffff;

export function buildEd25519InstructionData(
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): Uint8Array {
  if (publicKey.length !== 32 || signature.length !== 64)
    throw new ProtocolError("INVALID_FORMAT", "invalid key or signature length");
  if (message.length > 0xffff) throw new ProtocolError("INVALID_FORMAT", "message too long");
  const data = new Uint8Array(MESSAGE_OFFSET + message.length);
  const view = new DataView(data.buffer);
  data[0] = 1; // num_signatures
  data[1] = 0; // padding
  const offsets = [
    SIGNATURE_OFFSET,
    SELF,
    PUBKEY_OFFSET,
    SELF,
    MESSAGE_OFFSET,
    message.length,
    SELF,
  ];
  offsets.forEach((v, i) => view.setUint16(2 + i * 2, v, true));
  data.set(publicKey, PUBKEY_OFFSET);
  data.set(signature, SIGNATURE_OFFSET);
  data.set(message, MESSAGE_OFFSET);
  return data;
}

export function buildEd25519Instruction(
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): Instruction {
  return {
    programAddress: ED25519_PROGRAM_ADDRESS,
    accounts: [],
    data: buildEd25519InstructionData(publicKey, signature, message),
  };
}

export interface ParsedEd25519 {
  publicKey: Uint8Array;
  signature: Uint8Array;
  message: Uint8Array;
}

/** Parses data in exactly the canonical layout the program accepts; anything else throws. */
export function parseCanonicalEd25519Data(data: Uint8Array): ParsedEd25519 {
  const fail = (why: string): never => {
    throw new ProtocolError("DECODE_ERROR", `non-canonical Ed25519 instruction: ${why}`);
  };
  if (data.length <= MESSAGE_OFFSET) fail("too short");
  if (data[0] !== 1 || data[1] !== 0) fail("must contain exactly one signature");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (o: number) => view.getUint16(o, true);
  if (u16(2) !== SIGNATURE_OFFSET || u16(6) !== PUBKEY_OFFSET || u16(10) !== MESSAGE_OFFSET)
    fail("unexpected offsets");
  if (u16(4) !== SELF || u16(8) !== SELF || u16(14) !== SELF) fail("data must be self-contained");
  if (data.length !== MESSAGE_OFFSET + u16(12)) fail("length mismatch");
  return {
    publicKey: data.slice(PUBKEY_OFFSET, PUBKEY_OFFSET + 32),
    signature: data.slice(SIGNATURE_OFFSET, SIGNATURE_OFFSET + 64),
    message: data.slice(MESSAGE_OFFSET),
  };
}

/** Strict RFC 8032 Ed25519 verification. */
export function verifyEd25519(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, message, publicKey, { zip215: false });
  } catch {
    return false;
  }
}
