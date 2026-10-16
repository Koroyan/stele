/**
 * Stele Verified: proof that a deployed Solana program really enforces an organization's Gate
 * policy — checked on the program's own behaviour, not on anything the organization says.
 *
 * The organization describes how its protected instruction is called (a probe template). Stele
 * then simulates that instruction against the deployed program (nothing is signed or sent):
 *
 *   1. a wallet that never accepted the terms   → must be refused by the Stele check (AccessPassMissing)
 *   2. a wallet that accepted the required version → must NOT be refused by the Stele check
 *   3. a wallet presenting someone else's passport → must be refused by the Stele check
 *
 * A program passes only if it behaves like this for this organization's policy. The deployed code
 * is fingerprinted; the monitor re-runs the probes whenever the program is upgraded (or its upgrade
 * authority changes) and at least every few hours, so a badge never outlives the code it vouches for.
 *
 * Ownership is separate: the program's upgrade authority proves it with a memo transaction naming
 * the program and the organization.
 */
import { createHash } from "node:crypto";
import { address, getAddressDecoder, isOffCurveAddress, type Address } from "@solana/kit";
import {
  findAccessPassPda,
  findPassportPda,
  fromBase58,
  fromBase64,
  probeInstruction,
  probePassed,
  steleCheckRefusal,
  type ProbeFill,
  readAccess,
} from "@stelehq/protocol";
import {
  accessPasses,
  and,
  desc,
  documents,
  documentVersions,
  domainVerifications,
  eq,
  gatePolicies,
  gatePrograms,
  gte,
  isNotNull,
  organizations,
  type ProbeCheck,
  type ProbeTemplate,
  type ProgramOwnership,
  type ProgramVerification,
} from "@stele/db";
import type { Deps } from "../deps.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { enqueueWebhook } from "../lib/webhooks.js";
import { simulate, type Simulation } from "./gate.js";

// ---- the program on chain ------------------------------------------------------------------------------

const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
/** UpgradeableLoaderState::ProgramData header: tag u32, slot u64, Option<Pubkey> authority. */
const PROGRAMDATA_HEADER = 45;

export interface ProgramFacts {
  codeHash: string | null;
  deployedSlot: number | null;
  upgradeAuthority: string | null;
  authorityKind: "immutable" | "program" | "key";
}

/** sha256 of the code, with the zero padding of an extended program account removed. */
export function codeHashOf(code: Uint8Array): string {
  let end = code.length;
  while (end > 0 && code[end - 1] === 0) end--;
  return createHash("sha256").update(code.subarray(0, end)).digest("hex");
}

/** Decodes an upgradeable ProgramData account header (and hashes the code when it is present). */
export function programDataFacts(data: Uint8Array): ProgramFacts {
  if (
    data.length < PROGRAMDATA_HEADER ||
    new DataView(data.buffer, data.byteOffset).getUint32(0, true) !== 3
  )
    throw new Error("not a ProgramData account");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const deployedSlot = Number(view.getBigUint64(4, true));
  const authority = data[12] === 1 ? getAddressDecoder().decode(data.subarray(13, 45)) : null;
  return {
    codeHash:
      data.length > PROGRAMDATA_HEADER ? codeHashOf(data.subarray(PROGRAMDATA_HEADER)) : null,
    deployedSlot,
    upgradeAuthority: authority,
    authorityKind:
      authority === null ? "immutable" : isOffCurveAddress(authority) ? "program" : "key",
  };
}

/**
 * Reads what the chain says about `program`: its code fingerprint, last deployment and who can
 * change it. `withCode: false` reads only the 45-byte header (the monitor's cheap check).
 */
export async function inspectProgram(
  deps: Deps,
  program: Address,
  { withCode = true }: { withCode?: boolean } = {},
): Promise<ProgramFacts> {
  const { value } = await deps.chain.rpc.getAccountInfo(program, { encoding: "base64" }).send();
  if (!value || !value.executable)
    throw badRequest("program_not_found", `No executable program at ${program}`);
  const data = fromBase64(value.data[0]);
  if (value.owner !== UPGRADEABLE_LOADER) {
    // Programs of the older loaders cannot be upgraded: the account holds the code itself.
    return {
      codeHash: codeHashOf(data),
      deployedSlot: null,
      upgradeAuthority: null,
      authorityKind: "immutable",
    };
  }
  const programData = getAddressDecoder().decode(data.subarray(4, 36));
  const { value: pd } = await deps.chain.rpc
    .getAccountInfo(programData, {
      encoding: "base64",
      ...(withCode ? {} : { dataSlice: { offset: 0, length: PROGRAMDATA_HEADER } }),
    })
    .send();
  if (!pd) throw badRequest("program_not_found", `The program data of ${program} is missing`);
  return programDataFacts(fromBase64(pd.data[0]));
}

// ---- probes ----------------------------------------------------------------------------------------------

/** The Stele check that refused a simulation, or null when no Stele check refused it. */
export function gateErrorOf(sim: Simulation): string | null {
  if (sim.ok || !sim.failure) return null;
  if (sim.failure.source === "stele-gate") return sim.failure.name;
  return steleCheckRefusal(sim.logs);
}

/** Structural checks a template must pass before anything is simulated. */
export function validateTemplate(t: ProbeTemplate): void {
  const users = t.accounts.filter((a) => a.role === "user");
  if (users.length !== 1 || !users[0]!.signer)
    throw badRequest("invalid_template", "Mark exactly one account as the user, and as a signer");
  if (!t.accounts.some((a) => a.role === "passport" || a.role === "accessPass"))
    throw badRequest("invalid_template", "Add the user's passport (or access pass) account");
  if (
    t.accounts.some((a) => a.role === "passport") &&
    t.accounts.some((a) => a.role === "accessPass")
  )
    throw badRequest("invalid_template", "Use either a passport or an access pass, not both");
  for (const a of t.accounts) {
    if (a.role !== "address") continue;
    try {
      address(a.address ?? "");
    } catch {
      throw badRequest("invalid_template", `Not a valid account address: ${a.address ?? ""}`);
    }
  }
  if (!/^([0-9a-f]{2})*$/i.test(t.data))
    throw badRequest("invalid_template", "Instruction data must be hex bytes");
}

const randomWallet = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));

async function fillFor(
  deps: Deps,
  user: Address,
  document: Address,
  policy: Address,
): Promise<ProbeFill> {
  const [[passport], [accessPass]] = await Promise.all([
    findPassportPda(user, deps.chain.programAddress),
    findAccessPassPda(document, user, deps.chain.programAddress),
  ]);
  return { user, passport, accessPass, policy };
}

/**
 * A wallet whose acceptance satisfies the policy right now, in the storage the template presents
 * (taken from the index, then confirmed on chain). Simulations need no key, only the address.
 */
async function currentHolder(
  deps: Deps,
  i: { documentId: string; policy: Address; requiredVersion: number; storage: "passport" | "pass" },
): Promise<Address | null> {
  const rows = await deps.db
    .select({ holder: accessPasses.holder })
    .from(accessPasses)
    .where(
      and(
        eq(accessPasses.documentId, i.documentId),
        eq(accessPasses.storage, i.storage),
        gte(accessPasses.versionNumber, i.requiredVersion),
      ),
    )
    .orderBy(desc(accessPasses.acceptedAt))
    .limit(8);
  for (const { holder } of rows) {
    const e = await readAccess(deps.chain.rpc, {
      policy: i.policy,
      holder: address(holder),
      programAddress: deps.chain.programAddress,
    }).catch(() => null);
    const accepted =
      i.storage === "passport" ? e?.passportEntry?.versionNumber : e?.pass?.versionNumber;
    if (accepted !== undefined && accepted >= i.requiredVersion) return address(holder);
  }
  return null;
}

export interface VerifyInput {
  program: Address;
  template: ProbeTemplate;
  policy: Address;
  document: Address;
  documentId: string;
  requiredVersion: number;
}

/** Runs the three probes against the deployed program. Pure verification: nothing is stored. */
export async function verifyProtectedProgram(
  deps: Deps,
  i: VerifyInput,
): Promise<Omit<ProgramVerification, "verifiedSince">> {
  validateTemplate(i.template);
  const facts = await inspectProgram(deps, i.program);
  const storage = i.template.accounts.some((a) => a.role === "passport") ? "passport" : "pass";
  const run = (fill: ProbeFill) => simulate(deps, [probeInstruction(i.program, i.template, fill)]);
  const stranger = await fillFor(deps, randomWallet(), i.document, i.policy);
  const holderAddress = await currentHolder(deps, { ...i, storage });
  const holder = holderAddress ? await fillFor(deps, holderAddress, i.document, i.policy) : null;
  const noHolder = `No wallet has accepted version ${i.requiredVersion} yet: accept it once with any wallet, then check again`;

  const checks: ProbeCheck[] = [];
  // 1. Never accepted: the Stele check must be what refuses it.
  {
    const sim = await run(stranger);
    const gate = gateErrorOf(sim);
    checks.push({
      id: "refuses_without_acceptance",
      outcome: probePassed("refuses_without_acceptance", gate) ? "passed" : "failed",
      error: gate ?? sim.failure?.name ?? null,
      detail:
        gate === "AccessPassMissing"
          ? "Refused on-chain by the Stele check"
          : sim.ok
            ? "The program ran the action for a wallet that never accepted the terms"
            : `Refused, but not by the Stele check (${sim.failure?.name}): the check must run in this instruction`,
    });
  }
  // 2. Accepted the required version: no Stele check may refuse it.
  if (!holder) {
    checks.push({
      id: "allows_with_acceptance",
      outcome: "skipped",
      error: null,
      detail: noHolder,
    });
  } else {
    const sim = await run(holder);
    const gate = gateErrorOf(sim);
    checks.push({
      id: "allows_with_acceptance",
      outcome: probePassed("allows_with_acceptance", gate) ? "passed" : "failed",
      error: gate ?? sim.failure?.name ?? null,
      detail:
        gate !== null
          ? `Refused by the Stele check (${gate}) although the wallet accepted version ${i.requiredVersion}: the program checks another policy`
          : sim.ok
            ? "Allowed: the action ran"
            : `Allowed by the Stele check; the simulated action then stopped at ${sim.failure?.name} (expected without funds)`,
    });
  }
  // 3. Someone else's passport: the Stele check must refuse it.
  if (!holder) {
    checks.push({
      id: "refuses_borrowed_passport",
      outcome: "skipped",
      error: null,
      detail: noHolder,
    });
  } else {
    const sim = await run({
      ...stranger,
      passport: holder.passport,
      accessPass: holder.accessPass,
    });
    const gate = gateErrorOf(sim);
    const refused = probePassed("refuses_borrowed_passport", gate);
    checks.push({
      id: "refuses_borrowed_passport",
      outcome: refused ? "passed" : "failed",
      error: gate ?? sim.failure?.name ?? null,
      detail: refused
        ? "Refused on-chain by the Stele check"
        : sim.ok || gate === null
          ? "Another wallet's acceptance opened the action"
          : `Refused with ${gate}`,
    });
  }

  const failed = checks.find((c) => c.outcome === "failed");
  const skipped = checks.find((c) => c.outcome === "skipped");
  return {
    status: failed ? "failed" : skipped ? "incomplete" : "verified",
    checks,
    checkedAt: new Date().toISOString(),
    program: facts,
    requiredVersion: i.requiredVersion,
    holder: holderAddress,
    reason: failed?.detail ?? skipped?.detail ?? null,
  };
}

// ---- registered programs -----------------------------------------------------------------------------

async function registered(deps: Deps, programId: string, organizationId?: string) {
  const [row] = await deps.db
    .select({ p: gatePrograms, d: documents, g: gatePolicies })
    .from(gatePrograms)
    .innerJoin(documents, eq(documents.id, gatePrograms.policyDocumentId))
    .innerJoin(gatePolicies, eq(gatePolicies.documentId, documents.id))
    .where(
      organizationId
        ? and(eq(gatePrograms.id, programId), eq(gatePrograms.organizationId, organizationId))
        : eq(gatePrograms.id, programId),
    );
  if (!row) throw notFound("Program");
  return row;
}

/** Saves the probe template of a registered program (validated, not yet run). */
export async function saveProbeTemplate(
  deps: Deps,
  organizationId: string,
  programId: string,
  template: ProbeTemplate,
) {
  await registered(deps, programId, organizationId);
  validateTemplate(template);
  await deps.db
    .update(gatePrograms)
    .set({ probeTemplate: template, updatedAt: new Date() })
    .where(eq(gatePrograms.id, programId));
}

/** Verifies a registered program, stores the result and reports a status change by webhook. */
export async function verifyRegisteredProgram(
  deps: Deps,
  programId: string,
  organizationId?: string,
): Promise<ProgramVerification> {
  const { p, d, g } = await registered(deps, programId, organizationId);
  if (!p.probeTemplate)
    throw conflict("no_probe_template", "Describe how the protected instruction is called first");
  const result = await verifyProtectedProgram(deps, {
    program: address(p.programAddress),
    template: p.probeTemplate,
    policy: address(g.address),
    document: address(d.address),
    documentId: d.id,
    requiredVersion: g.requiredVersion,
  });
  const previous = p.verification;
  const sameCode = previous?.program.codeHash === result.program.codeHash;
  const verification: ProgramVerification = {
    ...result,
    verifiedSince:
      result.status !== "verified"
        ? null
        : previous?.status === "verified" && sameCode && previous.verifiedSince
          ? previous.verifiedSince
          : result.checkedAt,
  };
  await deps.db.update(gatePrograms).set({ verification }).where(eq(gatePrograms.id, p.id));
  if (previous?.status !== verification.status) {
    await enqueueWebhook(deps.db, p.organizationId, "gate.program_verification_changed", {
      program: p.programAddress,
      status: verification.status,
      previousStatus: previous?.status ?? null,
      reason: verification.reason,
      codeHash: verification.program.codeHash,
    });
  }
  return verification;
}

/**
 * The monitor: re-verifies a program when its code or upgrade authority changed (a cheap header
 * read) and at least every `maxAgeMs`. Safe to run in several processes.
 */
export async function monitorVerifiedPrograms(
  deps: Deps,
  maxAgeMs = 6 * 3_600_000,
): Promise<number> {
  const rows = await deps.db
    .select({
      id: gatePrograms.id,
      program: gatePrograms.programAddress,
      v: gatePrograms.verification,
    })
    .from(gatePrograms)
    .where(isNotNull(gatePrograms.probeTemplate));
  let rechecked = 0;
  for (const r of rows) {
    try {
      let due = !r.v || Date.now() - Date.parse(r.v.checkedAt) > maxAgeMs;
      if (!due) {
        const now = await inspectProgram(deps, address(r.program), { withCode: false });
        due =
          now.deployedSlot !== r.v!.program.deployedSlot ||
          now.upgradeAuthority !== r.v!.program.upgradeAuthority;
      }
      if (due) {
        await verifyRegisteredProgram(deps, r.id);
        rechecked++;
      }
    } catch (e) {
      deps.logger.warn({ err: e, program: r.program }, "program verification failed to run");
    }
  }
  return rechecked;
}

// ---- ownership ---------------------------------------------------------------------------------------

const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** The memo the upgrade authority signs to link a program to an organization. */
export const ownershipMemo = (program: string, organization: string) =>
  `stele-verify ${program} ${organization}`;

interface JsonInstruction {
  programIdIndex: number;
  accounts: number[];
  data: string;
}

/**
 * True when a confirmed transaction carries `memo` from the Memo program with `authority` among
 * its signers — directly, or as a memo account (the Memo program refuses unsigned accounts, so a
 * multisig vault signing through its program counts).
 */
export function memoSignedBy(
  tx: {
    transaction: {
      message: {
        accountKeys: string[];
        header: { numRequiredSignatures: number };
        instructions: JsonInstruction[];
      };
    };
    meta: {
      err: unknown;
      loadedAddresses?: { writable: string[]; readonly: string[] };
      innerInstructions?: { instructions: JsonInstruction[] }[] | null;
    } | null;
  },
  memo: string,
  authority: string,
): boolean {
  if (!tx.meta || tx.meta.err) return false;
  const keys = [
    ...tx.transaction.message.accountKeys,
    ...(tx.meta.loadedAddresses?.writable ?? []),
    ...(tx.meta.loadedAddresses?.readonly ?? []),
  ];
  const signers = keys.slice(0, tx.transaction.message.header.numRequiredSignatures);
  const all = [
    ...tx.transaction.message.instructions,
    ...(tx.meta.innerInstructions ?? []).flatMap((i) => i.instructions),
  ];
  return all.some((ix) => {
    if (keys[ix.programIdIndex] !== MEMO_PROGRAM) return false;
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(fromBase58(ix.data));
    } catch {
      return false;
    }
    if (text !== memo) return false;
    const accounts = ix.accounts.map((a) => keys[a]);
    return signers.includes(authority) || accounts.includes(authority);
  });
}

/** A registered program's address and its organization's on-chain address (for the memo). */
export async function programAndOrg(deps: Deps, organizationId: string, programId: string) {
  const { p } = await registered(deps, programId, organizationId);
  const [org] = await deps.db
    .select({ address: organizations.address })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return { programAddress: p.programAddress, organization: org!.address };
}

/** Records the ownership proof of a registered program: a memo signed by its upgrade authority. */
export async function proveOwnership(
  deps: Deps,
  organizationId: string,
  programId: string,
  signature: string,
): Promise<ProgramOwnership> {
  const { p } = await registered(deps, programId, organizationId);
  const facts = await inspectProgram(deps, address(p.programAddress), { withCode: false });
  if (!facts.upgradeAuthority)
    throw conflict(
      "immutable_program",
      "This program is immutable: it has no upgrade authority to prove ownership with",
    );
  const [org] = await deps.db
    .select({ address: organizations.address })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  const tx = await deps.chain.rpc
    .getTransaction(signature as never, {
      encoding: "json",
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    })
    .send()
    .catch(() => null);
  if (!tx)
    throw badRequest("transaction_not_found", "Transaction not found (wait for confirmation)");
  const memo = ownershipMemo(p.programAddress, org!.address);
  if (!memoSignedBy(tx as never, memo, facts.upgradeAuthority))
    throw badRequest(
      "ownership_not_proven",
      `The transaction must carry the memo "${memo}" signed by the upgrade authority ${facts.upgradeAuthority}`,
    );
  const ownership: ProgramOwnership = {
    authority: facts.upgradeAuthority,
    signature,
    provenAt: new Date().toISOString(),
  };
  await deps.db.update(gatePrograms).set({ ownership }).where(eq(gatePrograms.id, p.id));
  return ownership;
}

// ---- public view -------------------------------------------------------------------------------------

export interface VerifiedView {
  program: string;
  network: { label: string; cluster: string };
  status: "verified" | "failed" | "incomplete" | "unverified";
  checkedAt: string | null;
  verifiedSince: string | null;
  organization: { name: string; address: string; domains: string[] };
  policy: string;
  document: { address: string; title: string; slug: string; requiredVersion: number };
  /** The deployed code that was checked. */
  code: ProgramFacts | null;
  ownership: (ProgramOwnership & { current: boolean }) | null;
  checks: ProbeCheck[];
  reason: string | null;
  /** Everything needed to re-run the probes without Stele: the instruction and the accepted wallet. */
  recheck: { template: ProbeTemplate; holder: string | null } | null;
}

/** What anyone may see about a program's verification (the badge and stele.site/verified/…). */
export async function verifiedView(deps: Deps, program: string): Promise<VerifiedView> {
  const rows = await deps.db
    .select({ p: gatePrograms, d: documents, g: gatePolicies, o: organizations })
    .from(gatePrograms)
    .innerJoin(documents, eq(documents.id, gatePrograms.policyDocumentId))
    .innerJoin(gatePolicies, eq(gatePolicies.documentId, documents.id))
    .innerJoin(organizations, eq(organizations.id, gatePrograms.organizationId))
    .where(and(eq(gatePrograms.programAddress, program), isNotNull(gatePrograms.probeTemplate)));
  if (rows.length === 0) throw notFound("Verification");
  // Several organizations may register the same address; only the one whose policy the program
  // enforces can pass, so a verified row wins, then a proven owner, then the latest check.
  const rank = (r: (typeof rows)[number]) =>
    (r.p.verification?.status === "verified" ? 4 : 0) +
    (r.p.ownership ? 2 : 0) +
    (r.p.verification ? 1 : 0);
  const best = rows.sort((a, b) => rank(b) - rank(a))[0]!;
  const { p, d, g, o } = best;
  const v = p.verification;
  const [domains, [version]] = await Promise.all([
    verifiedDomains(deps, o.id),
    d.currentVersionAddress
      ? deps.db
          .select({ title: documentVersions.title })
          .from(documentVersions)
          .where(eq(documentVersions.address, d.currentVersionAddress))
      : Promise.resolve([]),
  ]);
  return {
    program: p.programAddress,
    network: { label: deps.config.network.label, cluster: deps.config.network.cluster },
    status: v?.status ?? "unverified",
    checkedAt: v?.checkedAt ?? null,
    verifiedSince: v?.verifiedSince ?? null,
    organization: { name: o.name, address: o.address, domains },
    policy: g.address,
    document: {
      address: d.address,
      title: version?.title ?? d.slug,
      slug: d.slug,
      requiredVersion: g.requiredVersion,
    },
    code: v?.program ?? null,
    ownership: p.ownership
      ? { ...p.ownership, current: p.ownership.authority === v?.program.upgradeAuthority }
      : null,
    checks: v?.checks ?? [],
    reason: v?.reason ?? null,
    recheck: p.probeTemplate ? { template: p.probeTemplate, holder: v?.holder ?? null } : null,
  };
}

async function verifiedDomains(deps: Deps, organizationId: string): Promise<string[]> {
  const rows = await deps.db
    .select({ domain: domainVerifications.domain, status: domainVerifications.status })
    .from(domainVerifications)
    .where(eq(domainVerifications.organizationId, organizationId));
  return [...new Set(rows.filter((r) => r.status === "verified").map((r) => r.domain))];
}
