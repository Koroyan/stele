/**
 * Anchor IDLs, for Stele Verified: turns a program's interface description into the probe template
 * Stele needs — the instruction's data and its accounts, with the user, their passport and the
 * policy recognised by name, fixed accounts filled from the IDL, and PDAs derived from their seeds
 * when they depend only on known accounts. Supports the current IDL format (Anchor 0.30+) and the
 * legacy one.
 */
import { getAddressEncoder, getProgramDerivedAddress, isAddress, type Address } from "@solana/kit";
import { anchorDiscriminator } from "@stelehq/protocol";

export type Role = "user" | "passport" | "accessPass" | "policy" | "address";

export interface IdlArg {
  name: string;
  /** A simple type this page can encode, or null (then the raw data must be given by hand). */
  type: SimpleType | null;
  typeLabel: string;
}
export type SimpleType =
  "u8" | "u16" | "u32" | "u64" | "i8" | "i16" | "i32" | "i64" | "bool" | "pubkey" | "string";

export type Seed =
  | { kind: "const"; value: Uint8Array }
  | { kind: "account"; path: string }
  | { kind: "unsupported" };

export interface IdlAccount {
  name: string;
  signer: boolean;
  writable: boolean;
  /** A fixed address from the IDL (e.g. the system program). */
  address: string | null;
  /** Seeds of a PDA of the program itself, when the IDL gives them. */
  pda: Seed[] | null;
  /** Another program derives this PDA: it cannot be derived here. */
  foreignPda: boolean;
}

export interface IdlInstruction {
  name: string;
  discriminator: Uint8Array;
  accounts: IdlAccount[];
  args: IdlArg[];
}

export interface ParsedIdl {
  name: string | null;
  address: string | null;
  instructions: IdlInstruction[];
}

const SIMPLE = new Set<string>([
  "u8",
  "u16",
  "u32",
  "u64",
  "i8",
  "i16",
  "i32",
  "i64",
  "bool",
  "pubkey",
  "publicKey",
  "string",
]);

const snake = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();

type Json = Record<string, unknown>;

function flatten(accounts: unknown[]): Json[] {
  const out: Json[] = [];
  for (const a of accounts as Json[]) {
    if (Array.isArray(a.accounts)) out.push(...flatten(a.accounts as unknown[]));
    else out.push(a);
  }
  return out;
}

function seedOf(s: Json): Seed {
  if (s.kind === "const" && Array.isArray(s.value))
    return { kind: "const", value: Uint8Array.from(s.value as number[]) };
  // `vault.policy` (a field of an account) is, by Anchor convention (has_one), the account of that
  // name: the derived address is shown, and can still be edited.
  if (s.kind === "account" && typeof s.path === "string")
    return { kind: "account", path: s.path.split(".").at(-1)! };
  return { kind: "unsupported" };
}

/** Parses an Anchor IDL (JSON text or object). Throws a readable error when it is not one. */
export function parseIdl(input: string | object): ParsedIdl {
  let idl: Json;
  try {
    idl = (typeof input === "string" ? JSON.parse(input) : input) as Json;
  } catch {
    throw new Error(
      "This file is not JSON. Upload the IDL your Anchor build produced (target/idl/<program>.json).",
    );
  }
  if (!Array.isArray(idl.instructions))
    throw new Error("No instructions in this file: it is not an Anchor IDL.");
  const meta = (idl.metadata ?? {}) as Json;
  const instructions = (idl.instructions as Json[]).map((ix): IdlInstruction => {
    const name = String(ix.name);
    const discriminator = Array.isArray(ix.discriminator)
      ? Uint8Array.from(ix.discriminator as number[])
      : anchorDiscriminator("global", snake(name));
    const accounts = flatten((ix.accounts as unknown[]) ?? []).map((a): IdlAccount => {
      const pda = a.pda as Json | undefined;
      return {
        name: String(a.name),
        signer: Boolean(a.signer ?? a.isSigner),
        writable: Boolean(a.writable ?? a.isMut),
        address: typeof a.address === "string" ? a.address : null,
        pda:
          pda && Array.isArray(pda.seeds) && !pda.program
            ? (pda.seeds as Json[]).map(seedOf)
            : null,
        foreignPda: Boolean(pda?.program),
      };
    });
    const args = ((ix.args as Json[]) ?? []).map((a): IdlArg => {
      const t = a.type;
      const label = typeof t === "string" ? t : JSON.stringify(t);
      return {
        name: String(a.name),
        type:
          typeof t === "string" && SIMPLE.has(t)
            ? ((t === "publicKey" ? "pubkey" : t) as SimpleType)
            : null,
        typeLabel: label,
      };
    });
    return { name, discriminator, accounts, args };
  });
  return {
    name:
      typeof meta.name === "string" ? meta.name : typeof idl.name === "string" ? idl.name : null,
    // Legacy IDLs carry the address in their metadata, once deployed.
    address:
      typeof idl.address === "string"
        ? idl.address
        : typeof meta.address === "string"
          ? meta.address
          : null,
    instructions,
  };
}

/** What an account most likely is, from its name and flags. */
export function guessRole(account: IdlAccount, signerTaken: boolean): Role {
  const n = snake(account.name);
  if (/passport/.test(n)) return "passport";
  if (/access_?pass/.test(n)) return "accessPass";
  if (/policy/.test(n)) return "policy";
  if (account.signer && !signerTaken) return "user";
  return "address";
}

/** Default values for the arguments (amounts 1, flags false, text empty). */
export function defaultArgValue(arg: IdlArg): string {
  if (!arg.type) return "";
  if (arg.type === "bool") return "false";
  if (arg.type === "string" || arg.type === "pubkey") return "";
  return "1";
}

/** Borsh-encodes one simple argument. Throws a readable error on a bad value. */
function encodeArg(arg: IdlArg, raw: string): Uint8Array {
  const v = raw.trim();
  switch (arg.type) {
    case "bool":
      if (v !== "true" && v !== "false") throw new Error(`${arg.name}: true or false`);
      return Uint8Array.of(v === "true" ? 1 : 0);
    case "string": {
      const bytes = new TextEncoder().encode(raw);
      const out = new Uint8Array(4 + bytes.length);
      new DataView(out.buffer).setUint32(0, bytes.length, true);
      out.set(bytes, 4);
      return out;
    }
    case "pubkey":
      if (!isAddress(v)) throw new Error(`${arg.name}: a Solana address`);
      return new Uint8Array(getAddressEncoder().encode(v as Address));
    default: {
      const bits = Number(arg.type!.slice(1));
      const signed = arg.type!.startsWith("i");
      if (!/^-?\d+$/.test(v)) throw new Error(`${arg.name}: a whole number`);
      let n = BigInt(v);
      const max = 1n << BigInt(signed ? bits - 1 : bits);
      if (signed ? n < -max || n >= max : n < 0n || n >= max)
        throw new Error(`${arg.name}: out of range for ${arg.type}`);
      if (n < 0n) n += 1n << BigInt(bits);
      const out = new Uint8Array(bits / 8);
      for (let i = 0; i < out.length; i++) {
        out[i] = Number(n & 0xffn);
        n >>= 8n;
      }
      return out;
    }
  }
}

/** The instruction data: discriminator + Borsh arguments. */
export function encodeInstructionData(ix: IdlInstruction, values: string[]): Uint8Array {
  const parts = [ix.discriminator, ...ix.args.map((a, i) => encodeArg(a, values[i] ?? ""))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Derives a PDA of `program` from its seeds when they depend only on constants and on accounts
 * whose address is known (fixed, or the policy). Null otherwise (e.g. a per-user account).
 */
export async function derivePda(
  program: Address,
  seeds: Seed[],
  known: Record<string, string | undefined>,
): Promise<string | null> {
  const bytes: Uint8Array[] = [];
  for (const s of seeds) {
    if (s.kind === "const") bytes.push(s.value);
    else if (s.kind === "account") {
      const a = known[s.path];
      if (!a || !isAddress(a)) return null;
      bytes.push(new Uint8Array(getAddressEncoder().encode(a as Address)));
    } else return null;
  }
  const [pda] = await getProgramDerivedAddress({ programAddress: program, seeds: bytes });
  return pda;
}
