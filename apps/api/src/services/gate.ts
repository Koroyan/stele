/**
 * Stele Gate (PROTOCOL_SPEC.md §18) for organizations: policies, the access passes their
 * acceptances created, the Solana programs that require them, what those programs recently allowed
 * or rejected, and live checks of the requirement against the cluster.
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
  depositInstruction,
  depositWithPassportInstruction,
  describeProgramError,
  explainGateFailure,
  findAccessPassPda,
  findPassportPda,
  findVaultPda,
  readAccess,
} from "@stelehq/protocol";
import {
  accessPasses,
  and,
  desc,
  documents,
  documentVersions,
  eq,
  gatePolicies,
  gatePrograms,
  inArray,
  organizations,
  sql,
} from "@stele/db";
import type { Deps } from "../deps.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { syncPolicy } from "../lib/sync.js";

// ---- explaining failures ---------------------------------------------------------------------------

export interface GateFailure {
  /** The program whose instruction failed. */
  program: string | null;
  code: number | null;
  /** "stele-gate" (require_current), "stele" (Stele program) or "program" (the app's own error). */
  source: "stele" | "stele-gate" | "program" | "runtime";
  name: string;
  message: string;
}

/** Explains a failed transaction from its logs. */
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
    const known = explainGateFailure(address(program), code);
    if (known) return { program, code, ...known };
    if (program === steleProgram) {
      const stele = describeProgramError(code);
      if (stele) return { program, code, source: "stele", ...stele };
    }
    return {
      program,
      code,
      source: "program",
      name: `Custom(${code})`,
      message: `The program returned error ${code}`,
    };
  }
  const anchorError = logs.find((l) => /AnchorError/.test(l));
  const failed = logs.find((l) => / failed: /.test(l));
  return {
    program: failed?.match(/^Program (\w+) failed/)?.[1] ?? null,
    code: null,
    source: "runtime",
    name: anchorError?.match(/Error Code: (\w+)/)?.[1] ?? "TransactionFailed",
    message: (
      anchorError ??
      failed ??
      JSON.stringify(err, (_k, v: unknown) => (typeof v === "bigint" ? Number(v) : v))
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
  status: "MISSING" | "OUTDATED" | "VALID";
  policy: string;
  document: string;
  holder: string;
  accessPass: string;
  requiredVersion: number;
  pass: {
    version: string;
    versionNumber: number;
    acceptedAt: number;
    acceptanceCount: number;
  } | null;
  /** Gate v3: the holder's passport and its entry for the policy's document. */
  passport: string | null;
  passportEntry: { versionNumber: number; acceptedAt: number } | null;
  /** Which account satisfies (or comes closest to satisfying) the policy. */
  storage: "pass" | "passport" | null;
}

/** Reads a policy and the holder's pass from Solana (UX only: enforcement is on-chain). */
export async function accessStatus(
  deps: Deps,
  i: { policy: string; holder: string },
): Promise<AccessView> {
  const e = await readAccess(deps.chain.rpc, {
    policy: address(i.policy),
    holder: address(i.holder),
    programAddress: deps.chain.programAddress,
  }).catch(() => {
    throw notFound("Policy");
  });
  return {
    status: e.status,
    policy: e.policy,
    document: e.document,
    holder: e.holder,
    accessPass: e.accessPass,
    requiredVersion: e.requiredVersion,
    pass: e.pass
      ? {
          version: e.pass.version,
          versionNumber: e.pass.versionNumber,
          acceptedAt: Number(e.pass.acceptedAt),
          acceptanceCount: e.pass.acceptanceCount,
        }
      : null,
    passport: e.passport ?? null,
    passportEntry: e.passportEntry
      ? {
          versionNumber: e.passportEntry.versionNumber,
          acceptedAt: Number(e.passportEntry.acceptedAt),
        }
      : null,
    storage: e.storage ?? null,
  };
}

// ---- organization: policies, passes, programs --------------------------------------------------------

/** After the organization's wallet created or changed a policy on-chain: mirror it. */
export async function refreshPolicy(deps: Deps, organizationId: string, policy: string) {
  const synced = await syncPolicy(deps.db, deps.chain, policy);
  if (!synced) throw notFound("Policy");
  const [doc] = await deps.db.select().from(documents).where(eq(documents.id, synced.documentId));
  if (doc?.organizationId !== organizationId) throw notFound("Policy");
  return synced;
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
  const policies = await deps.db
    .select()
    .from(gatePolicies)
    .where(eq(gatePolicies.organizationId, organizationId));
  const policyByDoc = new Map(policies.map((p) => [p.documentId, p]));
  const counts = await deps.db
    .select({
      documentId: accessPasses.documentId,
      total: sql<number>`count(*)::int`,
      current: sql<number>`count(*) filter (where ${accessPasses.versionNumber} >= ${gatePolicies.requiredVersion})::int`,
    })
    .from(accessPasses)
    .innerJoin(gatePolicies, eq(gatePolicies.documentId, accessPasses.documentId))
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
    steleProgram: deps.chain.programAddress as string,
    demoProgram: GATE_DEMO_PROGRAM_ADDRESS as string,
    documents: docs.map((d) => {
      const c = byDoc.get(d.id);
      const v = d.currentVersionAddress ? labels.get(d.currentVersionAddress) : undefined;
      const p = policyByDoc.get(d.id);
      return {
        id: d.id,
        address: d.address,
        slug: d.slug,
        documentType: d.documentType,
        versionCount: d.versionCount,
        currentVersion: d.currentVersionAddress
          ? {
              address: d.currentVersionAddress,
              number: v?.number ?? d.versionCount,
              label: v?.label ?? null,
              title: v?.title ?? null,
            }
          : null,
        policy: p
          ? {
              address: p.address,
              requiredVersion: p.requiredVersion,
              requiredVersionHash: p.requiredVersionHash,
              updatedAt: p.updatedAt,
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
      probeTemplate: p.probeTemplate,
      verification: p.verification,
      ownership: p.ownership,
      createdAt: p.createdAt,
    })),
    recentPasses: recent.map((p) => {
      const policy = policyByDoc.get(p.documentId);
      return {
        holder: p.holder,
        document: docById.get(p.documentId)?.slug ?? null,
        versionNumber: p.versionNumber,
        current: policy ? p.versionNumber >= policy.requiredVersion : false,
        acceptedAt: p.acceptedAt,
        txSignature: p.txSignature,
      };
    }),
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
    conds.push(sql`${accessPasses.versionNumber} >= ${gatePolicies.requiredVersion}`);
  if (q.status === "outdated")
    conds.push(sql`${accessPasses.versionNumber} < ${gatePolicies.requiredVersion}`);
  const rows = await deps.db
    .select({ p: accessPasses, d: documents, g: gatePolicies })
    .from(accessPasses)
    .innerJoin(documents, eq(documents.id, accessPasses.documentId))
    .innerJoin(gatePolicies, eq(gatePolicies.documentId, accessPasses.documentId))
    .where(and(...conds))
    .orderBy(desc(accessPasses.acceptedAt))
    .limit(q.limit)
    .offset(q.offset);
  return {
    passes: rows.map(({ p, d, g }) => ({
      address: p.address,
      holder: p.holder,
      storage: p.storage,
      depositPayer: p.depositPayer,
      document: { id: d.id, address: d.address, slug: d.slug },
      versionAddress: p.versionAddress,
      versionNumber: p.versionNumber,
      versionHash: p.versionHash,
      requiredVersion: g.requiredVersion,
      status: p.versionNumber >= g.requiredVersion ? ("current" as const) : ("outdated" as const),
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
  },
) {
  const [row] = await deps.db
    .select({ d: documents, g: gatePolicies })
    .from(documents)
    .innerJoin(gatePolicies, eq(gatePolicies.documentId, documents.id))
    .where(
      and(eq(documents.id, input.policyDocumentId), eq(documents.organizationId, organizationId)),
    );
  if (!row)
    throw conflict(
      "not_a_policy",
      "Create a Gate policy for this document before a program can require it",
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
  const values = { ...input, mode: "require_current", policyDocumentId: row.d.id };
  const [saved] = await deps.db
    .insert(gatePrograms)
    .values({ organizationId, ...values })
    .onConflictDoUpdate({
      target: [gatePrograms.organizationId, gatePrograms.programAddress],
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  return saved!;
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
    .select({ p: gatePrograms, d: documents, g: gatePolicies })
    .from(gatePrograms)
    .innerJoin(documents, eq(documents.id, gatePrograms.policyDocumentId))
    .innerJoin(gatePolicies, eq(gatePolicies.documentId, documents.id))
    .where(and(eq(gatePrograms.id, programId), eq(gatePrograms.organizationId, organizationId)));
  if (!p) throw notFound("Program");
  return p;
}

export type ActivityOutcome = "allowed" | "rejected";

/**
 * Recent transactions of a protected program, as the cluster reports them: succeeded ("allowed")
 * or failed ("rejected"), with the reason read from the transaction's logs.
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
      outcome: (s.err ? "rejected" : "allowed") as ActivityOutcome,
      failure,
    });
  }
  const summary = {
    allowed: out.filter((a) => a.outcome === "allowed").length,
    rejectedMissing: out.filter((a) => a.failure?.name === "AccessPassMissing").length,
    rejectedOutdated: out.filter((a) => a.failure?.name === "AccessPassOutdated").length,
    rejectedOther: out.filter(
      (a) =>
        a.outcome === "rejected" &&
        a.failure?.name !== "AccessPassMissing" &&
        a.failure?.name !== "AccessPassOutdated",
    ).length,
  };
  return { program: p.programAddress, activity: out, summary };
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
 * Live checks against the cluster:
 * * for the Stele demo vault, by simulating its protected `deposit` (nothing is signed or sent);
 * * for any other program — whose instruction layout Stele cannot know — by applying the
 *   `require_current` rule to the real pass and policy accounts on Solana. Your program's own test
 *   suite must still run the same scenarios against its instruction (see the Testing tab).
 */
export async function runProbes(deps: Deps, organizationId: string, programId: string) {
  const { p, d, g } = await orgProgram(deps, organizationId, programId);
  const policy = address(g.address);
  const passes = await deps.db
    .select()
    .from(accessPasses)
    .where(eq(accessPasses.documentId, d.id))
    .orderBy(desc(accessPasses.acceptedAt))
    .limit(200);
  const current = passes.find((x) => x.versionNumber >= g.requiredVersion) ?? null;
  const outdated = passes.find((x) => x.versionNumber < g.requiredVersion) ?? null;
  // A fresh random wallet: it has never accepted anything.
  const stranger = getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));
  // The demo vault's deposit can be simulated only when a vault exists for this policy (the live
  // demo creates one per session); otherwise the require_current rule is applied directly.
  const [vault] =
    p.programAddress === GATE_DEMO_PROGRAM_ADDRESS ? await findVaultPda(policy) : [null];
  const demo =
    vault !== null &&
    (await deps.chain.rpc.getAccountInfo(vault, { encoding: "base64" }).send()).value !== null;
  const [org] = await deps.db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  const storage: "pass" | "passport" =
    (org?.settings.gateStorage ?? "passport") === "pass" ? "pass" : "passport";
  /** The account `holder` would present: their passport (Gate v3) or their AccessPass. */
  const passOf = async (holder: Address) =>
    storage === "passport"
      ? (await findPassportPda(holder, deps.chain.programAddress))[0]
      : (await findAccessPassPda(address(d.address), holder, deps.chain.programAddress))[0];

  /** Runs one scenario: `holder` presents `pass` (an AccessPass or a passport, per `kind`). */
  const probe = async (
    holder: Address,
    pass: Address,
    kind: string = storage,
  ): Promise<Simulation> => {
    if (demo) {
      return simulate(deps, [
        kind === "passport"
          ? depositWithPassportInstruction({
              investor: holder,
              vault: vault!,
              policy,
              passport: pass,
              amount: 1,
            })
          : depositInstruction({
              investor: holder,
              vault: vault!,
              policy,
              accessPass: pass,
              amount: 1,
            }),
      ]);
    }
    const e = await readAccess(deps.chain.rpc, {
      policy,
      holder,
      programAddress: deps.chain.programAddress,
    });
    const presentedOwn = pass === e.accessPass || pass === e.passport;
    const ok = presentedOwn && e.status === "VALID";
    return {
      ok,
      unitsConsumed: null,
      logs: [],
      failure: ok
        ? null
        : {
            program: null,
            code: null,
            source: "stele-gate",
            name: !presentedOwn
              ? "AccessPassMismatch"
              : e.status === "OUTDATED"
                ? "AccessPassOutdated"
                : "AccessPassMissing",
            message: "Evaluated against Solana with the require_current rule",
          },
    };
  };
  const subject = demo ? `${p.action}()` : "require_current";

  const scenarios = [
    {
      id: "missing_pass",
      label: `No AccessPass → ${subject}`,
      expect: "reject" as const,
      reason: "AccessPassMissing",
      run: async () => probe(stranger, await passOf(stranger)),
      skip: null,
    },
    {
      id: "current_pass",
      label: `Current AccessPass → ${subject}`,
      expect: "allow" as const,
      reason: null,
      run: current
        ? async () => probe(address(current.holder), address(current.address), current.storage)
        : null,
      skip: "No wallet has accepted the required version yet",
    },
    {
      id: "outdated_pass",
      label: `AccessPass for an older version → ${subject}`,
      expect: "reject" as const,
      reason: "AccessPassOutdated",
      run: outdated
        ? async () => probe(address(outdated.holder), address(outdated.address), outdated.storage)
        : null,
      skip: "No pass for an older version exists (require a newer version to create one)",
    },
    {
      id: "direct_bypass",
      label: `Direct call with someone else's AccessPass → ${subject}`,
      expect: "reject" as const,
      reason: "AccessPassMismatch",
      run: passes[0]
        ? async () => probe(stranger, address(passes[0]!.address), passes[0]!.storage)
        : null,
      skip: "No access pass exists yet",
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
        detail: s.skip!,
        failure: null,
      });
      continue;
    }
    const sim = await s.run();
    // A rejection counts only when the AccessPass check refused it, not any other failure.
    const otherReason = !sim.ok && s.reason !== null && sim.failure?.name !== s.reason;
    const asExpected = s.expect === "allow" ? sim.ok : !sim.ok && !otherReason;
    results.push({
      id: s.id,
      label: s.label,
      expect: s.expect,
      outcome: asExpected ? "passed" : "failed",
      detail: sim.ok
        ? sim.unitsConsumed !== null
          ? `Executed (${sim.unitsConsumed} compute units)`
          : "Satisfies the policy"
        : otherReason
          ? `Rejected for another reason, not by the AccessPass check (expected ${s.reason}): ${sim.failure?.name}: ${sim.failure?.message}`
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
