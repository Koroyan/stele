"use client";
/**
 * Stele Verified, step by step: describe how the protected instruction is called (from the
 * program's IDL), let Stele check the deployed program, optionally prove ownership with the upgrade
 * authority, and add the badge.
 */
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AccountRole, address } from "@solana/kit";
import { utf8 } from "@stelehq/protocol";
import {
  Alert,
  Badge,
  Button,
  CheckIcon,
  CodeTabs,
  ExternalIcon,
  Fingerprint,
  Input,
  Select,
  XIcon,
  cn,
} from "@stele/ui";
import {
  EnableGate,
  GateTabs,
  documentTitle,
  type GateOverview,
  type ProbeTemplate,
  type ProgramVerification,
} from "@/components/dashboard/gate";
import { PageHeader, Panel, TxLink, useTransaction } from "@/components/dashboard/ui";
import { api, errorMessage } from "@/lib/api";
import { useDashboard } from "@/lib/dashboard";
import { formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useWallet } from "@/lib/wallet";
import { InstructionEditor, ROLE_LABELS } from "./instruction-editor";

const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const DEMO_IDL = "/examples/stele_gate_demo.idl.json";

const SCENARIOS: Record<string, string> = {
  refuses_without_acceptance: "A wallet that never accepted your terms is refused",
  allows_with_acceptance: "A wallet that accepted the required version gets through",
  refuses_borrowed_passport: "Someone else's acceptance doesn't work",
};

function StepTitle({ n, done, children }: { n: number; done: boolean; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className={cn(
          "grid h-6 w-6 flex-none place-items-center rounded-full text-[12px] font-semibold",
          done ? "bg-verified-soft text-verified" : "bg-accent-soft text-accent",
        )}
      >
        {done ? <CheckIcon className="h-3.5 w-3.5" /> : n}
      </span>
      <span className="min-w-0">{children}</span>
    </span>
  );
}

function StatusBadge({ v }: { v: ProgramVerification | null }) {
  if (!v) return <Badge tone="neutral">Not checked</Badge>;
  if (v.status === "verified") return <Badge tone="verified">Verified</Badge>;
  if (v.status === "failed") return <Badge tone="danger">Not verified</Badge>;
  return <Badge tone="warning">One step left</Badge>;
}

/** What to change when a check fails, in plain words. */
function advice(
  v: ProgramVerification,
  program: { label: string; programAddress: string },
  policy: { address: string; title: string; version: number } | null,
): ReactNode {
  const failed = v.checks.find((c) => c.outcome === "failed");
  if (!failed) return null;
  const error = failed.error ?? "";
  const policyNote = policy ? (
    <>
      {" "}
      <Fingerprint value={policy.address} /> — the policy of {policy.title} v{policy.version}
    </>
  ) : null;
  if (error === "InvalidPolicy" || failed.id === "allows_with_acceptance")
    return (
      <>
        Your program checks a different policy than the one registered for it. Pin
        {policyNote ?? " this program's policy"} in your program and deploy — or, if the program is
        meant for another document, register it with that document&apos;s policy.
      </>
    );
  if (error === "InstructionFallbackNotFound" || error === "InstructionMissing")
    return (
      <>
        The program {program.label} (<Fingerprint value={program.programAddress} />) has no such
        instruction: the IDL in step 1 belongs to another program. If you have several programs,
        choose the right one at the top of this page.
      </>
    );
  if (error === "InstructionDidNotDeserialize")
    return <>The arguments don&apos;t match the instruction — check them in step 1.</>;
  if (/^(Account|Constraint)/.test(error))
    return (
      <>
        An account in step 1 is not what the program expects (
        <code className="font-mono">{error}</code>). Check the fixed accounts&apos; addresses and
        the order of the accounts.
      </>
    );
  if (failed.id === "refuses_without_acceptance")
    return error ? (
      <>
        The call stopped at <code className="font-mono">{error}</code> before the Stele check.
        Usually an account or an argument in step 1 is wrong — or the Stele check is not in this
        instruction.
      </>
    ) : (
      <>
        Your program let a wallet through without accepting. Add{" "}
        <code className="font-mono">stele_gate::require_current_passport(…)</code> at the start of
        the instruction (see{" "}
        <Link href="/dashboard/gate/programs" className="text-accent">
          Program integration
        </Link>
        ), deploy, then check again.
      </>
    );
  return (
    <>
      Pass the transaction&apos;s signer as the user to the Stele check, so another wallet&apos;s
      passport is refused.
    </>
  );
}

export default function GateVerificationPage() {
  const { detail } = useDashboard();
  const wallet = useWallet();
  const tx = useTransaction();
  const orgId = detail?.organization.id;
  const enabled = detail?.organization.settings.products?.gate === true;
  const overview = useApi<GateOverview>(
    orgId && enabled ? `/v1/organizations/${orgId}/gate` : null,
  );
  const [programId, setProgramId] = useState("");
  const program = overview.data?.programs.find((p) => p.id === programId) ?? null;
  useEffect(() => {
    // The organization's own program first, before the demo vault.
    const programs = overview.data?.programs ?? [];
    const first =
      programs.find((p) => p.programAddress !== overview.data?.demoProgram) ?? programs[0];
    if (!programId && first) setProgramId(first.id);
  }, [overview.data, programId]);

  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memo, setMemo] = useState<string | null>(null);
  const [signature, setSignature] = useState("");
  useEffect(() => {
    setChanging(false);
    setMemo(null);
    if (!orgId || !programId) return;
    api<{ memo: string }>(`/v1/organizations/${orgId}/gate/programs/${programId}/ownership`)
      .then((r) => setMemo(r.memo))
      .catch(() => setMemo(null));
  }, [orgId, programId]);

  if (!detail) return null;
  const canAdmin = detail.role === "owner" || detail.role === "admin";
  const doc = overview.data?.documents.find((d) => d.id === program?.policyDocumentId) ?? null;
  const policyAddress = doc?.policy?.address ?? null;
  const v = program?.verification ?? null;
  const template = program?.probeTemplate ?? null;
  const authority = v?.program.upgradeAuthority ?? null;
  const ownershipCurrent = !!program?.ownership && program.ownership.authority === authority;
  const ownershipDone = ownershipCurrent || v?.program.authorityKind === "immutable";
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const pageUrl = program ? `${origin}/verified/${program.programAddress}` : "";
  const badgeUrl = program
    ? `${origin}/api/v1/public/verified/${program.programAddress}/badge.svg`
    : "";
  const acceptUrl = doc ? `/accept/${detail.organization.address}/${doc.slug}` : null;

  async function verify(next?: ProbeTemplate) {
    if (!program) return;
    setBusy(true);
    setError(null);
    try {
      if (next)
        await api(`/v1/organizations/${orgId}/gate/programs/${program.id}/probe`, {
          method: "PUT",
          body: next,
        });
      await api(`/v1/organizations/${orgId}/gate/programs/${program.id}/verify`, {
        method: "POST",
      });
      setChanging(false);
      overview.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitOwnership(sig: string) {
    if (!program) return;
    setError(null);
    try {
      await api(`/v1/organizations/${orgId}/gate/programs/${program.id}/ownership`, {
        body: { signature: sig.trim() },
      });
      setSignature("");
      overview.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function signMemo() {
    if (!memo) return;
    await tx.run(
      (signer) => [
        {
          programAddress: address(MEMO_PROGRAM),
          accounts: [{ address: signer.address, role: AccountRole.READONLY_SIGNER, signer }],
          data: utf8(memo),
        } as never,
      ],
      submitOwnership,
    );
  }

  const headline = !v
    ? template
      ? "Run the check to get your badge."
      : "Three steps to your badge."
    : v.status === "verified"
      ? "Your program is Stele Verified."
      : v.status === "incomplete"
        ? "Almost there: one wallet must accept your terms."
        : "Not verified yet — see what to change below.";

  return (
    <>
      <PageHeader
        title="Verification"
        description="The Stele Verified badge shows your users that your deployed program refuses anyone who hasn't accepted your current terms. Stele checks it on-chain, and again after every upgrade."
      />
      {!enabled ? (
        <EnableGate />
      ) : (
        <>
          <GateTabs />
          {(overview.data?.programs.length ?? 0) === 0 && !overview.loading ? (
            <Panel
              className="mt-6"
              title={
                <StepTitle n={1} done={false}>
                  Register your program
                </StepTitle>
              }
            >
              <p className="text-[13.5px] text-fg-muted">
                Verification works on a program registered with Stele: its address, and the policy
                it requires.
              </p>
              <Link
                href="/dashboard/gate/programs"
                className="mt-4 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-[13.5px] font-medium text-accent-ink"
              >
                Register a program
              </Link>
            </Panel>
          ) : program ? (
            <div className="mt-6 space-y-6">
              {/* Where things stand: the program, its status and the live badge. */}
              <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {(overview.data?.programs.length ?? 0) > 1 ? (
                      <Select
                        title="Choose the program to verify"
                        aria-label="Program"
                        value={programId}
                        onChange={(e) => setProgramId(e.target.value)}
                        className="w-auto"
                      >
                        {overview.data!.programs.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label} · {p.programAddress.slice(0, 6)}…
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="text-[14px] font-semibold text-fg">{program.label}</span>
                    )}
                    <StatusBadge v={v} />
                  </div>
                  <p className="mt-2 text-[17px] font-semibold tracking-[-0.01em] text-fg">
                    {headline}
                  </p>
                  <p className="mt-1 text-[12.5px] text-fg-subtle">
                    Program <Fingerprint value={program.programAddress} />
                    {doc && (
                      <>
                        {" "}
                        · requires {documentTitle(doc)} v{doc.policy?.requiredVersion}
                      </>
                    )}
                  </p>
                </div>
                <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="flex-none">
                  {/* Re-fetched after each check, so it shows the new status. */}
                  <img
                    src={`${badgeUrl}?theme=dark&v=${encodeURIComponent(v?.checkedAt ?? "")}`}
                    alt="Your badge"
                    width={200}
                    height={40}
                  />
                </a>
              </div>

              {error && <Alert tone="danger">{error}</Alert>}

              <Panel
                title={
                  <StepTitle n={1} done={!!template && !changing}>
                    Show Stele how your protected instruction is called
                  </StepTitle>
                }
                description="Stele simulates this call on your deployed program with test wallets — nothing is signed or sent, and nothing is spent."
              >
                {template && !changing ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-fg-muted">
                      <span className="mr-1">Saved:</span>
                      {template.accounts.map((a, i) => (
                        <Badge key={i} tone={a.role === "address" ? "neutral" : "accent"}>
                          {a.role === "address"
                            ? `fixed ${a.address?.slice(0, 4)}…`
                            : ROLE_LABELS[a.role].replace(/^(The user's|Your) /, "")}
                        </Badge>
                      ))}
                    </div>
                    {canAdmin && (
                      <Button variant="secondary" size="sm" onClick={() => setChanging(true)}>
                        Change
                      </Button>
                    )}
                  </div>
                ) : (
                  <InstructionEditor
                    key={program.id}
                    programAddress={program.programAddress}
                    programLabel={program.label}
                    policyAddress={policyAddress}
                    action={program.action}
                    saved={template}
                    example={
                      program.programAddress === overview.data?.demoProgram ? DEMO_IDL : null
                    }
                    busy={busy}
                    disabled={!canAdmin}
                    onSubmit={(t) => void verify(t)}
                    onCancel={template ? () => setChanging(false) : null}
                  />
                )}
                {!canAdmin && (
                  <p className="mt-3 text-[12.5px] text-fg-subtle">
                    An owner or admin can change this.
                  </p>
                )}
              </Panel>

              <Panel
                title={
                  <StepTitle n={2} done={v?.status === "verified"}>
                    The check
                  </StepTitle>
                }
                description="Repeated automatically after every upgrade of your program, and at least every six hours."
                actions={
                  template && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      disabled={busy || !canAdmin}
                      onClick={() => void verify()}
                    >
                      Check again
                    </Button>
                  )
                }
              >
                {!v ? (
                  <p className="text-[13px] text-fg-muted">
                    {template ? "Not checked yet." : "Complete step 1 first."}
                  </p>
                ) : (
                  <div className="grid gap-5">
                    <ol className="grid gap-3">
                      {v.checks.map((c) => (
                        <li key={c.id} className="flex gap-3">
                          <span
                            className={cn(
                              "grid h-6 w-6 flex-none place-items-center rounded-full",
                              c.outcome === "passed"
                                ? "bg-verified-soft text-verified"
                                : c.outcome === "failed"
                                  ? "bg-danger-soft text-danger"
                                  : "bg-surface-3 text-fg-subtle",
                            )}
                          >
                            {c.outcome === "passed" ? (
                              <CheckIcon className="h-3.5 w-3.5" />
                            ) : c.outcome === "failed" ? (
                              <XIcon className="h-3.5 w-3.5" />
                            ) : (
                              "–"
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[14px] font-medium text-fg">
                              {SCENARIOS[c.id] ?? c.id}
                            </p>
                            <p className="text-[13px] text-fg-muted">
                              {c.detail}
                              {c.error && (
                                <code className="ml-2 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11.5px]">
                                  {c.error}
                                </code>
                              )}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                    {v.status === "failed" && (
                      <Alert tone="warning">
                        <span className="font-medium text-fg">What to change: </span>
                        {advice(
                          v,
                          program,
                          doc?.policy
                            ? {
                                address: doc.policy.address,
                                title: documentTitle(doc),
                                version: doc.policy.requiredVersion,
                              }
                            : null,
                        )}
                      </Alert>
                    )}
                    {v.status === "incomplete" && (
                      <Alert tone="info">
                        To test the “let through” case, Stele needs one wallet that accepted version{" "}
                        {v.requiredVersion}. Accept it once with any wallet
                        {acceptUrl && (
                          <>
                            {" "}
                            —{" "}
                            <a
                              href={acceptUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-accent hover:underline"
                            >
                              open the acceptance page
                            </a>
                          </>
                        )}{" "}
                        — then press <em>Check again</em>.
                      </Alert>
                    )}
                    <p className="text-[12.5px] text-fg-subtle">
                      Checked {formatDateTime(v.checkedAt)} · code{" "}
                      {v.program.codeHash ? <Fingerprint value={v.program.codeHash} /> : "—"} ·
                      upgradeable by{" "}
                      {v.program.authorityKind === "immutable"
                        ? "nobody (immutable)"
                        : v.program.authorityKind === "program"
                          ? "a program (e.g. a multisig)"
                          : "a single key"}
                    </p>
                  </div>
                )}
              </Panel>

              <Panel
                title={
                  <StepTitle n={3} done={ownershipDone}>
                    Prove the program is yours{" "}
                    <span className="font-normal text-fg-subtle">(recommended)</span>
                  </StepTitle>
                }
                description="So nobody can claim your program: its upgrade authority signs a short note naming the program and your organization. The badge page shows it."
                actions={
                  ownershipDone ? (
                    <Badge tone="verified">Proven</Badge>
                  ) : (
                    <Badge tone="neutral">Not proven</Badge>
                  )
                }
              >
                {!v ? (
                  <p className="text-[13px] text-fg-muted">Run the check first.</p>
                ) : !authority ? (
                  <p className="text-[13px] text-fg-muted">
                    Nothing to do: this program is immutable — nobody can change it, the strongest
                    case.
                  </p>
                ) : (
                  <div className="grid gap-4">
                    <p className="text-[13px] text-fg-muted">
                      Connect the upgrade authority <Fingerprint value={authority} /> and sign — it
                      costs one network fee.
                      {v.program.authorityKind === "program" &&
                        " It is a program-controlled account (for example a Squads multisig): create a transaction in it with the Memo program and the text below, then paste its signature."}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        onClick={() => void signMemo()}
                        loading={tx.pending}
                        disabled={!memo || tx.pending || wallet.address !== authority || !canAdmin}
                      >
                        Sign the ownership note
                      </Button>
                      {wallet.address !== authority && (
                        <span className="text-[12.5px] text-fg-subtle">
                          {wallet.address
                            ? "The connected wallet is not the upgrade authority."
                            : "Connect the upgrade authority's wallet first."}
                        </span>
                      )}
                      {tx.signature && <TxLink signature={tx.signature} />}
                    </div>
                    {tx.error && <Alert tone="danger">{tx.error}</Alert>}
                    <details className="text-[13px] text-fg-muted">
                      <summary className="cursor-pointer select-none text-fg-subtle hover:text-fg">
                        Signing somewhere else (CLI, multisig)?
                      </summary>
                      <div className="mt-3 grid gap-3">
                        {memo && (
                          <code className="break-all rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-[12.5px] text-fg">
                            {memo}
                          </code>
                        )}
                        <p className="text-[12.5px]">
                          Send a Memo-program transaction with this text, signed by the upgrade
                          authority, then paste its signature.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Input
                            aria-label="Memo transaction signature"
                            value={signature}
                            onChange={(e) => setSignature(e.target.value)}
                            placeholder="Transaction signature"
                            className="min-w-0 flex-1 font-mono"
                          />
                          <Button
                            variant="secondary"
                            onClick={() => void submitOwnership(signature)}
                            disabled={!signature.trim() || !canAdmin}
                          >
                            Check
                          </Button>
                        </div>
                      </div>
                    </details>
                    {program.ownership && (
                      <p className="text-[12.5px] text-fg-subtle">
                        {ownershipCurrent ? "Proven" : "Proven by a previous authority"}{" "}
                        {formatDateTime(program.ownership.provenAt)} ·{" "}
                        <TxLink signature={program.ownership.signature} />
                      </p>
                    )}
                  </div>
                )}
              </Panel>

              <Panel
                title={
                  <StepTitle n={4} done={v?.status === "verified"}>
                    Add the badge to your site
                  </StepTitle>
                }
                description="Paste this where users take the protected action. It shows the live status and opens the evidence — and only counts on your verified domains."
                actions={
                  <a
                    href={pageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"
                  >
                    Public page <ExternalIcon className="h-3.5 w-3.5" />
                  </a>
                }
              >
                <div className="grid gap-4">
                  <CodeTabs
                    tabs={[
                      {
                        label: "HTML",
                        language: "html",
                        code: `<script src="${origin}/sdk/v1/stele.js" defer></script>\n<span data-stele-verified="${program.programAddress}"></span>`,
                      },
                      {
                        label: "React",
                        language: "tsx",
                        code: `import { SteleVerifiedBadge } from "@stelehq/sdk/react";\n\n<SteleVerifiedBadge program="${program.programAddress}" apiBaseUrl="${origin}/api" />`,
                      },
                      {
                        label: "Markdown",
                        language: "md",
                        code: `[![Stele Verified](${badgeUrl})](${pageUrl})`,
                      },
                    ]}
                  />
                  {v?.status !== "verified" && (
                    <p className="text-[12.5px] text-fg-subtle">
                      You can add it now: until the check passes it reads “Verification pending”.
                    </p>
                  )}
                  <p className="text-[12.5px] text-fg-subtle">
                    Your verified domains decide where the badge is valid —{" "}
                    <Link href="/dashboard/organization" className="text-accent">
                      Organization
                    </Link>
                    . Elsewhere it reads “Not valid on this site”.
                  </p>
                </div>
              </Panel>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
