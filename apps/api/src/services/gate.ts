/**
 * Stele Gate (PROTOCOL_SPEC.md §18) for organizations: which documents are policies, the access
 * passes their acceptances created, the Solana programs that require them, what those programs
 * recently allowed or rejected, and live checks of the requirement against the cluster.
 *
 * Everything here reads Solana or simulates against it; the database is an index for the dashboard.
 * Enforcement is on-chain — in the protected program — and nothing in this file can grant access.
 */
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from "@solana/kit";
import {
  GATE_DEMO_PROGRAM_ADDRESS,
  checkAccessInstruction,
  describeGateError,
  describeProgramError,
  findAccessPassPda,
  findMarketPda,
  placeBetInstruction,
  readAccess,
  type AccessEvaluation,
} from "@stele/protocol";
import {
  accessPasses,
  and,
  desc,
  documents,
  documentVersions,
  eq,
  gatePrograms,
  inArray,
  organizations,
  sql,
} from "@stele/db";
import type { Deps } from "../deps.js";
import { badRequest, conflict, notFound } from "../errors.js";

// ---- explaining failures ---------------------------------------------------------------------------

export interface GateFailure {
  /** The program whose instruction failed (the innermost one for a CPI). */
  program: string | null;
  code: number | null;
  /** "stele" (Stele program error), "stele-gate" (check-mode crate error) or "program". */
  source: "stele" | "stele-gate" | "program" | "runtime";
  name: string;
  message: string;
}

/** Explains a failed transaction from its logs (innermost failing program first). */
export function explainFailure(
  steleProgram: Address,
  err: unknown,
  logs: readonly string[],
): GateFailure {
  for (const line of logs) {
    const m = line.match(/^Program (\w+) failed: custom program error: 0x([0-9a-f]+)/i);
    if (!m) continue;
    const program = m[1]!;
    const code = Number.parseInt(m[2]!, 16);
    const gate = describeGateError(code);
    if (gate) return { program, code, source: "stele-gate", ...gate };
    if (program === steleProgram) {
      const known = describeProgramError(code);
      if (known) return { program, code, source: "stele", ...known };
    }
    return {
      program,
      code,
      source: "program",
      name: `Custom(${code})`,
      message: `The program returned error ${code}`,
    };
  }
  const failed = logs.find((l) => / failed: /.test(l));
  return {
    program: failed?.match(/^Program (\w+) failed/)?.[1] ?? null,
    code: null,
    source: "runtime",
    name: "TransactionFailed",
    message: (
      failed ?? JSON.stringify(err, (_k, v: unknown) => (typeof v === "bigint" ? Number(v) : v))
    ).slice(0, 300),
  };
}

export interface Simulation {
  ok: boolean;
  failure: GateFailure | null;
  unitsConsumed: number | null;
  logs: string[];
}

/** Simulates instructions with the relayer as (unsigned) fee payer; nothing is sent or signed. */
export async function simulate(deps: Deps, instructions: Instruction[]): Promise<Simulation> {
  const { value: blockhash } = await deps.chain.rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(deps.chain.relayer.address, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const wire = getBase64EncodedWireTransaction(compileTransaction(message));
  const { value } = await deps.chain.rpc
    .simulateTransaction(wire, {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    })
    .send();
  const logs = [...(value.logs ?? [])];
  return {
    ok: value.err === null,
    failure: value.err === null ? null : explainFailure(deps.chain.programAddress, value.err, logs),
    unitsConsumed: value.unitsConsumed === undefined ? null : Number(value.unitsConsumed),
    logs,
  };
}

// ---- public access check -----------------------------------------------------------------------------

export interface AccessView {
  status: AccessEvaluation["status"];
  document: string;
  holder: string;
  accessPass: string;
  currentVersion: { address: string | null; number: number };
  requiredVersionNumber: number;
  pass: {
    version: string;
    versionNumber: number;
    acceptedAt: number;
    acceptanceCount: number;
  } | null;
}

/** Reads the holder's pass and the policy document from Solana (UX only: enforcement is on-chain). */
export async function accessStatus(
  deps: Deps,
  i: { document: string; holder: string; minVersion?: number },
): Promise<AccessView> {
  const e = await readAccess(deps.chain.rpc, {
    document: address(i.document),
    holder: address(i.holder),
    requirement: { minVersion: i.minVersion ?? 0 },
    programAddress: deps.chain.programAddress,
  }).catch((err: unknown) => {
    throw notFound(
      err instanceof Error && /not found/.test(err.message) ? "Policy document" : "Access",
    );
  });
  return {
    status: e.status,
    document: e.document,
    holder: e.holder,
    accessPass: e.accessPass,
    currentVersion: { address: e.currentVersion, number: e.currentVersionNumber },
    requiredVersionNumber: e.requiredVersionNumber,
    pass: e.pass
      ? {
          version: e.pass.version,
          versionNumber: e.pass.versionNumber,
          acceptedAt: Number(e.pass.acceptedAt),
          acceptanceCount: e.pass.acceptanceCount,
        }
      : null,
  };
}

// ---- organization: policies, passes, programs --------------------------------------------------------

async function orgDocument(deps: Deps, organizationId: string, documentId: string) {
  const [doc] = await deps.db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)));
  if (!doc) throw notFound("Document");
  return doc;
}

export async function setDocumentGate(
  deps: Deps,
  organizationId: string,
  documentId: string,
  gated: boolean,
) {
  const doc = await orgDocument(deps, organizationId, documentId);
  if (!gated) {
    const [inUse] = await deps.db
      .select({ id: gatePrograms.id })
      .from(gatePrograms)
      .where(eq(gatePrograms.policyDocumentId, doc.id));
    if (inUse)
      throw conflict(
        "policy_in_use",
        "A registered program requires this policy; remove the program first",
      );
  }
  await deps.db
    .update(documents)
    .set({ gated, updatedAt: new Date() })
    .where(eq(documents.id, doc.id));
  return { documentId: doc.id, gated };
}

async function versionLabels(deps: Deps, addresses: string[]) {
  if (addresses.length === 0)
    return new Map<string, { title: string; label: string; number: number }>();
  const rows = await deps.db
    .select({
      address: documentVersions.address,
      title: documentVersions.title,
      label: documentVersions.versionLabel,
      number: documentVersions.number,
    })
    .from(documentVersions)
    .where(inArray(documentVersions.address, addresses));
  return new Map(
    rows.map((r) => [r.address, { title: r.title, label: r.label, number: r.number }]),
  );
}

export async function gateOverview(deps: Deps, organizationId: string) {
  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  const docs = await deps.db
    .select()
    .from(documents)
    .where(eq(documents.organizationId, organizationId))
    .orderBy(documents.slug);
  const counts = await deps.db
    .select({
      documentId: accessPasses.documentId,
      total: sql<number>`count(*)::int`,
      current: sql<number>`count(*) filter (where ${accessPasses.versionAddress} = ${documents.currentVersionAddress})::int`,
    })
    .from(accessPasses)
    .innerJoin(documents, eq(documents.id, accessPasses.documentId))
    .where(eq(accessPasses.organizationId, organizationId))
    .groupBy(accessPasses.documentId);
  const byDoc = new Map(counts.map((c) => [c.documentId, c]));
  const labels = await versionLabels(
    deps,
    docs.map((d) => d.currentVersionAddress).filter((a): a is string => !!a),
  );
  const programs = await deps.db
    .select()
    .from(gatePrograms)
    .where(eq(gatePrograms.organizationId, organizationId))
    .orderBy(gatePrograms.createdAt);
  const recent = await deps.db
    .select()
    .from(accessPasses)
    .where(eq(accessPasses.organizationId, organizationId))
    .orderBy(desc(accessPasses.acceptedAt))
    .limit(8);
  const docById = new Map(docs.map((d) => [d.id, d]));
  return {
    enabled: org?.settings.products?.gate === true,
    network: deps.config.network.label,
    steleProgram: deps.chain.programAddress,
    demoProgram: GATE_DEMO_PROGRAM_ADDRESS,
    documents: docs.map((d) => {
      const c = byDoc.get(d.id);
      const v = d.currentVersionAddress ? labels.get(d.currentVersionAddress) : undefined;
      return {
        id: d.id,
        address: d.address,
        slug: d.slug,
        documentType: d.documentType,
        gated: d.gated,
        currentVersion: d.currentVersionAddress
          ? {
              address: d.currentVersionAddress,
              number: v?.number ?? d.versionCount,
              label: v?.label ?? null,
              title: v?.title ?? null,
            }
          : null,
        passes: {
          total: c?.total ?? 0,
          current: c?.current ?? 0,
          outdated: (c?.total ?? 0) - (c?.current ?? 0),
        },
      };
    }),
    programs: programs.map((p) => ({
      id: p.id,
      programAddress: p.programAddress,
      label: p.label,
      action: p.action,
      mode: p.mode,
      policyDocumentId: p.policyDocumentId,
      isDemo: p.programAddress === GATE_DEMO_PROGRAM_ADDRESS,
      createdAt: p.createdAt,
    })),
    recentPasses: recent.map((p) => ({
      holder: p.holder,
      document: docById.get(p.documentId)?.slug ?? null,
      versionNumber: p.versionNumber,
      current: docById.get(p.documentId)?.currentVersionAddress === p.versionAddress,
      acceptedAt: p.acceptedAt,
      txSignature: p.txSignature,
    })),
  };
}

export async function listAccessPasses(
  deps: Deps,
  organizationId: string,
  q: { documentId?: string; status?: "current" | "outdated"; limit: number; offset: number },
) {
  const conds = [eq(accessPasses.organizationId, organizationId)];
  if (q.documentId) conds.push(eq(accessPasses.documentId, q.documentId));
  if (q.status === "current")
    conds.push(sql`${accessPasses.versionAddress} = ${documents.currentVersionAddress}`);
  if (q.status === "outdated")
    conds.push(sql`${accessPasses.versionAddress} <> ${documents.currentVersionAddress}`);
  const rows = await deps.db
    .select({ p: accessPasses, d: documents })
    .from(accessPasses)
    .innerJoin(documents, eq(documents.id, accessPasses.documentId))
    .where(and(...conds))
    .orderBy(desc(accessPasses.acceptedAt))
    .limit(q.limit)
    .offset(q.offset);
  return {
    passes: rows.map(({ p, d }) => ({
      address: p.address,
      holder: p.holder,
      document: { id: d.id, address: d.address, slug: d.slug },
      versionAddress: p.versionAddress,
      versionNumber: p.versionNumber,
      currentVersionNumber: d.versionCount,
      status:
        p.versionAddress === d.currentVersionAddress ? ("current" as const) : ("outdated" as const),
      acceptanceId: p.acceptanceId,
      acceptanceCount: p.acceptanceCount,
      acceptedAt: p.acceptedAt,
      firstAcceptedAt: p.firstAcceptedAt,
      txSignature: p.txSignature,
    })),
  };
}

export async function registerProgram(
  deps: Deps,
  organizationId: string,
  input: {
    programAddress: string;
    label: string;
    action: string;
    policyDocumentId: string;
    mode: "check" | "strict";
  },
) {
  const doc = await orgDocument(deps, organizationId, input.policyDocumentId);
  if (!doc.gated)
    throw conflict(
      "not_a_policy",
      "Make the document a Gate policy before a program can require it",
    );
  if (input.programAddress === deps.chain.programAddress)
    throw badRequest("invalid_program", "The Stele program cannot be a protected program");
  const { value } = await deps.chain.rpc
    .getAccountInfo(address(input.programAddress), { encoding: "base64" })
    .send();
  if (!value || !value.executable)
    throw badRequest(
      "program_not_found",
      `No executable program at ${input.programAddress} on ${deps.config.network.label}`,
    );
  const [row] = await deps.db
    .insert(gatePrograms)
    .values({ organizationId, ...input, policyDocumentId: doc.id })
    .onConflictDoUpdate({
      target: [gatePrograms.organizationId, gatePrograms.programAddress],
      set: {
        label: input.label,
        action: input.action,
        policyDocumentId: doc.id,
        mode: input.mode,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

export async function removeProgram(deps: Deps, organizationId: string, programId: string) {
  const deleted = await deps.db
    .delete(gatePrograms)
    .where(and(eq(gatePrograms.id, programId), eq(gatePrograms.organizationId, organizationId)))
    .returning({ id: gatePrograms.id });
  if (deleted.length === 0) throw notFound("Program");
  return { removed: programId };
}

async function orgProgram(deps: Deps, organizationId: string, programId: string) {
  const [p] = await deps.db
    .select({ p: gatePrograms, d: documents })
    .from(gatePrograms)
    .innerJoin(documents, eq(documents.id, gatePrograms.policyDocumentId))
    .where(and(eq(gatePrograms.id, programId), eq(gatePrograms.organizationId, organizationId)));
  if (!p) throw notFound("Program");
  return p;
}

/**
 * Recent transactions of a protected program, as the cluster reports them: succeeded ("allowed") or
 * failed ("rejected"), with the reason read from the transaction's logs.
 */
export async function programActivity(deps: Deps, organizationId: string, programId: string) {
  const { p } = await orgProgram(deps, organizationId, programId);
  const sigs = await deps.chain.rpc
    .getSignaturesForAddress(address(p.programAddress), { limit: 20, commitment: "confirmed" })
    .send();
  const out = [];
  let explained = 0;
  for (const s of sigs) {
    let failure: GateFailure | null = null;
    if (s.err && explained < 10) {
      explained++;
      const tx = await deps.chain.rpc
        .getTransaction(s.signature, {
          encoding: "json",
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        })
        .send()
        .catch(() => null);
      failure = explainFailure(deps.chain.programAddress, s.err, tx?.meta?.logMessages ?? []);
    }
    out.push({
      signature: s.signature,
      slot: Number(s.slot),
      blockTime: s.blockTime === null ? null : Number(s.blockTime),
      outcome: s.err ? ("rejected" as const) : ("allowed" as const),
      failure,
    });
  }
  return { program: p.programAddress, activity: out };
}

export interface ProbeResult {
  id: string;
  label: string;
  expect: "reject" | "allow";
  outcome: "passed" | "failed" | "skipped";
  detail: string;
  failure: GateFailure | null;
}

/**
 * Live checks against the cluster, by simulation (nothing is signed or sent):
 * * the policy requirement itself, through Stele's `check_access` — for any registered program;
 * * the protected action end to end — only for the Stele Gate demo program, whose instruction
 *   layout Stele knows. Other programs run the same scenarios in their own test suite.
 */
export async function runProbes(deps: Deps, organizationId: string, programId: string) {
  const { p, d } = await orgProgram(deps, organizationId, programId);
  const document = address(d.address);
  const passes = await deps.db
    .select()
    .from(accessPasses)
    .where(eq(accessPasses.documentId, d.id))
    .orderBy(desc(accessPasses.acceptedAt))
    .limit(200);
  const current = passes.find((x) => x.versionAddress === d.currentVersionAddress) ?? null;
  const outdated = passes.find((x) => x.versionAddress !== d.currentVersionAddress) ?? null;
  // A fresh random wallet: it has never accepted anything.
  const stranger = getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));
  const demo = p.programAddress === GATE_DEMO_PROGRAM_ADDRESS;
  const [market] = demo ? await findMarketPda(document) : [null];

  /** The instruction under test for `holder` presenting `pass`. */
  const action = (holder: Address, pass: Address): Instruction =>
    demo
      ? placeBetInstruction({
          bettor: holder,
          market: market!,
          policyDocument: document,
          accessPass: pass,
          side: 1,
          stake: 1,
          strict: p.mode === "strict",
          steleProgram: deps.chain.programAddress,
        })
      : checkAccessInstruction({
          programAddress: deps.chain.programAddress,
          document,
          accessPass: pass,
          holder,
        });
  const subject = demo ? `${p.action} (${p.mode} mode)` : "check_access";
  const passOf = async (holder: Address) =>
    (await findAccessPassPda(document, holder, deps.chain.programAddress))[0];

  const scenarios: {
    id: string;
    label: string;
    expect: "reject" | "allow";
    run: (() => Promise<Simulation>) | null;
    skipReason?: string;
  }[] = [
    {
      id: "no_pass",
      label: `No access pass → ${subject}`,
      expect: "reject",
      run: async () => simulate(deps, [action(stranger, await passOf(stranger))]),
    },
    {
      id: "current_pass",
      label: `Current access pass → ${subject}`,
      expect: "allow",
      run: current
        ? async () => simulate(deps, [action(address(current.holder), address(current.address))])
        : null,
      skipReason: "No wallet has accepted the current version yet",
    },
    {
      id: "outdated_pass",
      label: `Access pass for an older version → ${subject}`,
      expect: "reject",
      run: outdated
        ? async () => simulate(deps, [action(address(outdated.holder), address(outdated.address))])
        : null,
      skipReason: "No pass for an older version exists (publish a new version to create one)",
    },
    {
      id: "direct_bypass",
      label: `Direct call presenting someone else's pass → ${subject}`,
      expect: "reject",
      run: passes[0]
        ? async () => simulate(deps, [action(stranger, address(passes[0]!.address))])
        : null,
      skipReason: "No access pass exists yet",
    },
  ];
  const results: ProbeResult[] = [];
  for (const s of scenarios) {
    if (!s.run) {
      results.push({
        id: s.id,
        label: s.label,
        expect: s.expect,
        outcome: "skipped",
        detail: s.skipReason!,
        failure: null,
      });
      continue;
    }
    const sim = await s.run();
    const asExpected = s.expect === "allow" ? sim.ok : !sim.ok;
    results.push({
      id: s.id,
      label: s.label,
      expect: s.expect,
      outcome: asExpected ? "passed" : "failed",
      detail: sim.ok
        ? `Executed (${sim.unitsConsumed ?? "?"} compute units)`
        : `${sim.failure?.name}: ${sim.failure?.message}`,
      failure: sim.failure,
    });
  }
  return {
    program: p.programAddress,
    scope: demo ? ("protected_action" as const) : ("policy_requirement" as const),
    network: deps.config.network.label,
    results,
    simulatedAt: new Date().toISOString(),
  };
}
