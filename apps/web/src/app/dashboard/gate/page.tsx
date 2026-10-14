"use client";
/** Stele Gate overview: the protected program, the policy it requires, accepted wallets and recent results. */
import Link from "next/link";
import { Alert, ArrowRightIcon, Badge, Card, CheckIcon, buttonClasses, cn } from "@stele/ui";
import {
  EnableGate,
  GateTabs,
  documentTitle,
  type GateOverview,
  type ProgramActivity,
} from "@/components/dashboard/gate";
import { LoadingRows, PageHeader, Panel, Table, Td, TxLink } from "@/components/dashboard/ui";
import { useDashboard } from "@/lib/dashboard";
import { formatDateTime, shortAddress } from "@/lib/format";
import { useApi } from "@/lib/use-api";

function Fact({
  label,
  value,
  caption,
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
}) {
  return (
    <Card className="px-5 py-4">
      <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
        {label}
      </p>
      <div className="mt-1.5 min-h-[28px] text-[17px] font-semibold tracking-[-0.01em] text-fg">
        {value}
      </div>
      {caption && <p className="mt-1 text-[12.5px] text-fg-muted">{caption}</p>}
    </Card>
  );
}

interface SetupStep {
  done: boolean;
  title: string;
  hint: string;
  href: string;
}

/** The integration as four steps; the first open one is highlighted as "Next". */
function GateSetup({ steps }: { steps: SetupStep[] }) {
  const next = steps.findIndex((s) => !s.done);
  if (next === -1) return null;
  return (
    <Panel
      className="mt-6"
      title="Set up Stele Gate"
      description={`${steps.filter((s) => s.done).length} of ${steps.length} done — follow the steps in order.`}
    >
      <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, i) => (
          <li key={step.title}>
            <Link
              href={step.href}
              className={cn(
                "flex h-full flex-col rounded-xl border px-4 py-3.5 transition-colors",
                i === next
                  ? "border-accent-line bg-accent-soft/40 hover:bg-accent-soft/60"
                  : step.done
                    ? "border-line"
                    : "border-line-strong hover:border-accent-line",
              )}
            >
              <span className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10.5px]",
                    step.done
                      ? "border-accent-line bg-accent-soft text-accent"
                      : "border-line-strong text-fg-muted",
                  )}
                  aria-hidden="true"
                >
                  {step.done ? <CheckIcon className="h-3 w-3" /> : i + 1}
                </span>
                <span
                  className={cn(
                    "text-[13.5px] font-medium",
                    step.done ? "text-fg-subtle line-through decoration-fg-subtle/50" : "text-fg",
                  )}
                >
                  {step.title}
                </span>
                {step.done && <span className="sr-only">(done)</span>}
                {i === next && (
                  <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-accent">
                    Next <ArrowRightIcon className="h-3.5 w-3.5" />
                  </span>
                )}
              </span>
              <span className="mt-1.5 pl-[30px] text-[12.5px] leading-relaxed text-fg-muted">
                {step.hint}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export default function GateOverviewPage() {
  const { detail } = useDashboard();
  const orgId = detail?.organization.id;
  const enabled = detail?.organization.settings.products?.gate === true;
  const overview = useApi<GateOverview>(
    orgId && enabled ? `/v1/organizations/${orgId}/gate` : null,
  );
  const program = overview.data?.programs[0] ?? null;
  const activity = useApi<ProgramActivity>(
    orgId && program ? `/v1/organizations/${orgId}/gate/programs/${program.id}/activity` : null,
  );
  if (!detail) return null;

  const policyDoc =
    overview.data?.documents.find((d) => d.id === program?.policyDocumentId) ??
    overview.data?.documents.find((d) => d.policy) ??
    null;
  const totals = (overview.data?.documents ?? []).reduce(
    (acc, d) => ({
      total: acc.total + d.passes.total,
      current: acc.current + d.passes.current,
      outdated: acc.outdated + d.passes.outdated,
    }),
    { total: 0, current: 0, outdated: 0 },
  );

  return (
    <>
      <PageHeader
        title="Stele Gate"
        description="Require the current version of your terms before a protected Solana action. Your program enforces it with require_current(); this page shows the state on Solana."
        actions={
          enabled ? (
            <Link href="/dashboard/gate/programs" className={buttonClasses("primary", "md")}>
              Integration wizard
            </Link>
          ) : undefined
        }
      />
      {!enabled ? (
        <EnableGate />
      ) : (
        <>
          <GateTabs />
          {overview.error && (
            <Alert tone="danger" className="mt-6">
              {overview.error.message}
            </Alert>
          )}
          {overview.loading && !overview.data ? (
            <LoadingRows />
          ) : overview.data ? (
            <>
              <GateSetup
                steps={[
                  {
                    done: overview.data.documents.some((d) => d.versionCount > 0),
                    title: "Publish your terms",
                    hint: "The document users must accept, e.g. your Offering Terms.",
                    href: "/dashboard/documents",
                  },
                  {
                    done: Boolean(policyDoc?.policy),
                    title: "Create a policy",
                    hint: "Choose the document and the version a protected action requires.",
                    href: "/dashboard/gate/policies",
                  },
                  {
                    done: Boolean(program),
                    title: "Connect your program",
                    hint: "Register it and add one call, require_current(), to the protected instruction.",
                    href: "/dashboard/gate/programs",
                  },
                  {
                    done:
                      (activity.data?.summary.rejectedMissing ?? 0) +
                        (activity.data?.summary.rejectedOutdated ?? 0) >
                      0,
                    title: "Test the bypass",
                    hint: "Check that a wallet without a current acceptance is refused on-chain.",
                    href: "/dashboard/gate/testing",
                  },
                ]}
              />
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Fact
                  label="Protected program"
                  value={
                    program ? (
                      <span className="font-mono text-[15px]">
                        {shortAddress(program.programAddress, 4, 4)}
                      </span>
                    ) : (
                      <span className="text-fg-muted">None yet</span>
                    )
                  }
                  caption={
                    program ? (
                      `${program.label} · ${program.action}()`
                    ) : (
                      <Link href="/dashboard/gate/programs" className="text-accent">
                        Register your program
                      </Link>
                    )
                  }
                />
                <Fact label="Network" value={overview.data.network} />
                <Fact
                  label="Required policy"
                  value={
                    policyDoc ? (
                      documentTitle(policyDoc)
                    ) : (
                      <span className="text-fg-muted">No policy</span>
                    )
                  }
                  caption={
                    policyDoc?.policy ? (
                      <>
                        requires v{policyDoc.policy.requiredVersion} · latest published v
                        {policyDoc.versionCount}
                      </>
                    ) : (
                      <Link href="/dashboard/gate/policies" className="text-accent">
                        Create a policy
                      </Link>
                    )
                  }
                />
                <Fact
                  label="Current version"
                  value={policyDoc?.policy ? `v${policyDoc.policy.requiredVersion}` : "—"}
                  caption="The version a wallet must have accepted (or a later one)"
                />
                <Fact
                  label="Accepted wallets"
                  value={totals.total.toLocaleString()}
                  caption={`${totals.current} satisfy the policy · ${totals.outdated} outdated`}
                />
                <Fact
                  label="Current integration"
                  value={
                    program && policyDoc?.policy ? (
                      <Badge tone="verified">Active</Badge>
                    ) : (
                      <Badge tone="warning">Not set up</Badge>
                    )
                  }
                  caption={
                    program && policyDoc?.policy
                      ? "Program registered, policy on-chain"
                      : "Finish the integration wizard"
                  }
                />
              </div>

              <Panel
                className="mt-6"
                title="Recent gate results"
                description={
                  program
                    ? `Transactions of ${program.label} as Solana reports them: executed, or rejected with the reason from the logs.`
                    : "Register a protected program to see what it allowed and rejected."
                }
                bodyClassName="px-0 py-0"
              >
                {!program ? (
                  <p className="px-6 py-6 text-[13px] text-fg-muted">No program registered yet.</p>
                ) : activity.loading && !activity.data ? (
                  <LoadingRows />
                ) : activity.data ? (
                  <>
                    <div className="flex flex-wrap gap-2 px-6 py-4">
                      <Badge tone="verified">Allowed {activity.data.summary.allowed}</Badge>
                      <Badge tone="danger">
                        Rejected · outdated {activity.data.summary.rejectedOutdated}
                      </Badge>
                      <Badge tone="danger">
                        Rejected · missing {activity.data.summary.rejectedMissing}
                      </Badge>
                      <Badge>Rejected · other {activity.data.summary.rejectedOther}</Badge>
                    </div>
                    <Table head={["Result", "Reason", "Time", "Transaction"]}>
                      {activity.data.activity.slice(0, 10).map((a) => (
                        <tr key={a.signature}>
                          <Td>
                            <Badge tone={a.outcome === "allowed" ? "verified" : "danger"}>
                              {a.outcome === "allowed" ? "Allowed" : "Rejected"}
                            </Badge>
                          </Td>
                          <Td>{a.failure ? `${a.failure.name}` : "—"}</Td>
                          <Td>
                            {a.blockTime ? formatDateTime(new Date(a.blockTime * 1000)) : "—"}
                          </Td>
                          <Td>
                            <TxLink signature={a.signature} />
                          </Td>
                        </tr>
                      ))}
                    </Table>
                  </>
                ) : (
                  <p className="px-6 py-6 text-[13px] text-danger">{activity.error?.message}</p>
                )}
              </Panel>

              <Panel className="mt-6" title="Latest acceptances" bodyClassName="px-0 py-0">
                {overview.data.recentPasses.length === 0 ? (
                  <p className="px-6 py-6 text-[13px] text-fg-muted">
                    No acceptance yet. They appear when a wallet accepts a Gate policy.
                  </p>
                ) : (
                  <Table
                    head={["Wallet", "Document", "Version", "Status", "Accepted", "Transaction"]}
                  >
                    {overview.data.recentPasses.map((p) => (
                      <tr key={p.txSignature}>
                        <Td mono>{shortAddress(p.holder, 5, 5)}</Td>
                        <Td>{p.document}</Td>
                        <Td>v{p.versionNumber}</Td>
                        <Td>
                          <Badge tone={p.current ? "verified" : "warning"}>
                            {p.current ? "Satisfies policy" : "Outdated"}
                          </Badge>
                        </Td>
                        <Td>{formatDateTime(p.acceptedAt)}</Td>
                        <Td>
                          <TxLink signature={p.txSignature} />
                        </Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Panel>
            </>
          ) : null}
        </>
      )}
    </>
  );
}
