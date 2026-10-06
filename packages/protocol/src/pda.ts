/** Program-derived addresses (PROTOCOL_SPEC.md §2.3). */
import { address, getAddressEncoder, getProgramDerivedAddress, type Address } from "@solana/kit";
import { DEFAULT_PROGRAM_ADDRESS } from "./constants";
import { utf8 } from "./encoding";
import { domainHash } from "./hash";

export const SEEDS = {
  config: "config",
  organization: "organization",
  member: "member",
  domain: "domain",
  document: "document",
  version: "version",
  nonceShard: "nonce-shard",
  passkeySigner: "passkey-signer",
} as const;

const addressBytes = (a: Address): Uint8Array => new Uint8Array(getAddressEncoder().encode(a));

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function u16le(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

export type Pda = readonly [Address, number];

async function derive(programAddress: Address, seeds: (string | Uint8Array)[]): Promise<Pda> {
  return getProgramDerivedAddress({
    programAddress,
    seeds: seeds.map((s) => (typeof s === "string" ? utf8(s) : s)),
  });
}

const defaultProgram = () => address(DEFAULT_PROGRAM_ADDRESS);

export const findConfigPda = (programAddress: Address = defaultProgram()) =>
  derive(programAddress, [SEEDS.config]);

export const findOrganizationPda = (
  creator: Address,
  seed: Uint8Array,
  programAddress: Address = defaultProgram(),
) => derive(programAddress, [SEEDS.organization, addressBytes(creator), seed]);

export const findMemberPda = (
  organization: Address,
  member: Address,
  programAddress: Address = defaultProgram(),
) => derive(programAddress, [SEEDS.member, addressBytes(organization), addressBytes(member)]);

export const findDomainRecordPda = (domain: string, programAddress: Address = defaultProgram()) =>
  derive(programAddress, [SEEDS.domain, domainHash(domain)]);

export const findDocumentPda = (
  organization: Address,
  slug: string,
  programAddress: Address = defaultProgram(),
) => derive(programAddress, [SEEDS.document, addressBytes(organization), utf8(slug)]);

export const findVersionPda = (
  document: Address,
  version: number,
  programAddress: Address = defaultProgram(),
) => derive(programAddress, [SEEDS.version, addressBytes(document), u32le(version)]);

export const findNonceShardPda = (
  organization: Address,
  shardId: number,
  programAddress: Address = defaultProgram(),
) => derive(programAddress, [SEEDS.nonceShard, addressBytes(organization), u16le(shardId)]);

/** A passkey signer's enrollment: one per (organization, account commitment). */
export const findPasskeySignerPda = (
  organization: Address,
  accountCommitment: Uint8Array,
  programAddress: Address = defaultProgram(),
) => derive(programAddress, [SEEDS.passkeySigner, addressBytes(organization), accountCommitment]);

export const BPF_UPGRADEABLE_LOADER_ADDRESS = address(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

export const findProgramDataAddress = (programAddress: Address = defaultProgram()) =>
  getProgramDerivedAddress({
    programAddress: BPF_UPGRADEABLE_LOADER_ADDRESS,
    seeds: [addressBytes(programAddress)],
  });
