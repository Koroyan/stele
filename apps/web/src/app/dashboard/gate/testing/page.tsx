"use client";
/** Live checks of a registered program's Gate requirement, and its recent on-chain results. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, CodeBlock, Select } from "@stele/ui";
import {
  EnableGate,
  GateTabs,
  type GateOverview,
  type ProbeReport,
  type ProgramActivity,
} from "@/components/dashboard/gate";
import { LoadingRows, PageHeader, Panel, Table, Td, TxLink } from "@/components/dashboard/ui";
import { api, errorMessage } from "@/lib/api";
import { useDashboard } from "@/lib/dashboard";
import { formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { ProbeResults } from "./probe-results";

export default function GateTestingPage() {
  const { detail } = useDashboard();
  const orgId = detail?.organization.id;
  const enabled = detail?.organization.settings.products?.gate === true;
  const overview = useApi<GateOverview>(
    orgId && enabled ? `/v1/organizations/${orgId}/gate` : null,
  );
  const [programId, setProgramId] = useState("");
  const [report, setReport] = useState<ProbeReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const first = overview.data?.programs[0];
    if (!programId && first) setProgramId(first.id);
  }, [overview.data, programId]);
  const activity = useApi<ProgramActivity>(
    orgId && programId ? `/v1/organizations/${orgId}/gate/programs/${programId}/activity` : null,
  );
  if (!detail) return null;
  const program = overview.data?.programs.find((p) => p.id === programId) ?? null;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setReport(
        await api<ProbeReport>(`/v1/organizations/${orgId}/gate/programs/${programId}/test`, {
          method: "POST",
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Testing"
        description="Check the requirement live, and see what the program actually allowed and rejected on-chain."
      />
      {!enabled ? (
        <EnableGate />
      ) : (
        <>
          <GateTabs />
          {(overview.data?.programs.length ?? 0) === 0 && !overview.loading ? (
            <Alert tone="info" className="mt-6">
              Register a program first —{" "}
              <Link href="/dashboard/gate/programs" className="text-accent">
                Program integration
              </Link>
              .
            </Alert>
          ) : (
            <>
              <Panel
                className="mt-6"
                title="Live checks"
                description="No AccessPass → reject · current pass → success · outdated pass → reject · someone else's pass (direct call) → reject."
                actions={
                  <div className="flex flex-wrap gap-2">
                    <Select
                      aria-label="Program"
                      value={programId}
                      onChange={(e) => {
                        setProgramId(e.target.value);
                        setReport(null);
                      }}
                      className="w-64"
                    >
                      {overview.data?.programs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </Select>
                    <Button onClick={() => void run()} loading={busy} disabled={!programId}>
                      Run
                    </Button>
                  </div>
                }
              >
                {error && <Alert tone="danger">{error}</Alert>}
                {report ? (
                  <ProbeResults report={report} />
                ) : (
                  <p className="text-[13px] text-fg-muted">
                    Runs on {overview.data?.network}. Simulations are free: nothing is signed or
                    sent.
                  </p>
                )}
              </Panel>

              <Panel className="mt-6" title="In your own test suite">
                <p className="mb-3 text-[13px] text-fg-muted">
                  The same scenarios against your instruction (LiteSVM shown; any harness works):
                </p>
                <CodeBlock
                  language="rust"
                  code={`// No pass: a direct call fails on-chain.
assert_custom(&call_${program?.action ?? "deposit"}(&mut env, &user, &pass), 7602); // AccessPassMissing
// Accept the required version, then it succeeds.
assert_ok(&accept_gated(&mut env, &user, &terms, &params));
assert_ok(&call_${program?.action ?? "deposit"}(&mut env, &user, &pass));
// Require a newer version: the old pass fails.
assert_custom(&call_${program?.action ?? "deposit"}(&mut env, &user, &pass), 7605); // AccessPassOutdated
// Someone else's pass fails too.
assert_custom(&call_${program?.action ?? "deposit"}(&mut env, &other, &pass), 7604); // AccessPassMismatch`}
                />
              </Panel>

              <Panel className="mt-6" title="Recent on-chain results" bodyClassName="px-0 py-0">
                {activity.loading && !activity.data ? (
                  <LoadingRows />
                ) : (activity.data?.activity.length ?? 0) === 0 ? (
                  <p className="px-6 py-6 text-[13px] text-fg-muted">No transactions yet.</p>
                ) : (
                  <Table head={["Result", "Reason", "Time", "Transaction"]}>
                    {activity.data!.activity.map((a) => (
                      <tr key={a.signature}>
                        <Td>
                          <Badge tone={a.outcome === "allowed" ? "verified" : "danger"}>
                            {a.outcome === "allowed" ? "Allowed" : "Rejected"}
                          </Badge>
                        </Td>
                        <Td>{a.failure ? `${a.failure.name} — ${a.failure.message}` : "—"}</Td>
                        <Td>{a.blockTime ? formatDateTime(new Date(a.blockTime * 1000)) : "—"}</Td>
                        <Td>
                          <TxLink signature={a.signature} />
                        </Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Panel>
            </>
          )}
        </>
      )}
    </>
  );
}
