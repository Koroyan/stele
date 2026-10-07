"use client";
/** Stele Gate overview: the protected program, the policy it requires, passes and recent results. */
import Link from "next/link";
import { Alert, Badge, Card, buttonClasses } from "@stele/ui";
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
          <Link href="/dashboard/gate/programs" className={buttonClasses("primary", "md")}>
            Integration wizard
          </Link>
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
                  caption="The version a pass must name (or a later one)"
                />
                <Fact
                  label="AccessPasses"
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
                    No AccessPass yet. They appear when a wallet accepts a Gate policy.
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
