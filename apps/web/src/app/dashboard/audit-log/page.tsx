"use client";
/**
 * Audit log of dashboard and API actions. Entries are append-only (enforced by a database trigger)
 * and hash-chained, so deleting or editing history breaks the chain — which "Verify integrity"
 * detects. On-chain actions also link to their transactions, the stronger record.
 */
import { Fragment, useState } from "react";
import { Alert, Button, CheckCircleIcon, EmptyState, ListIcon } from "@stele/ui";
import { actionLabel } from "@/components/dashboard/labels";
import { LoadingRows, PageHeader, Panel, Table, Td, TxLink } from "@/components/dashboard/ui";
import { api, errorMessage } from "@/lib/api";
import { useDashboard } from "@/lib/dashboard";
import { formatDateTime, shortAddress } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface Entry {
  id: number;
  sequence: number;
  actorType: "user" | "api_key" | "system";
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  txSignature: string | null;
  createdAt: string;
  prevHash: string;
  entryHash: string;
}

interface ChainCheck {
  valid: boolean;
  entries: number;
  headHash: string;
  brokenAtSequence: number | null;
  reason: string | null;
}

export default function AuditLogPage() {
  const { org } = useDashboard();
  const first = useApi<{ entries: Entry[] }>(
    org ? `/v1/organizations/${org.id}/audit-log?limit=100` : null,
  );
  const [older, setOlder] = useState<Entry[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [check, setCheck] = useState<ChainCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const entries = [...(first.data?.entries ?? []), ...older];
  const oldest = entries[entries.length - 1]?.sequence;

  async function more() {
    if (!org || !oldest) return;
    setLoadingMore(true);
    try {
      const { entries: next } = await api<{ entries: Entry[] }>(
        `/v1/organizations/${org.id}/audit-log?limit=100&beforeSequence=${oldest}`,
      );
      setOlder((o) => [...o, ...next]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  async function verify() {
    if (!org) return;
    setChecking(true);
    setError(null);
    try {
      setCheck(await api<ChainCheck>(`/v1/organizations/${org.id}/audit-log/verify`));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Append-only, hash-chained record of actions taken through Stele for this organization. IP addresses are stored only as keyed hashes and never shown."
        actions={
          <Button size="sm" variant="secondary" loading={checking} onClick={() => void verify()}>
            Verify integrity
          </Button>
        }
      />
      {check &&
        (check.valid ? (
          <Alert tone="success" title="Hash chain intact">
            Every entry links to its predecessor; no entry was altered or removed ({check.entries}{" "}
            entries checked). Head hash{" "}
            <span className="font-mono text-[12px]">{check.headHash.slice(0, 16)}…</span> — record
            it externally to detect a full rewrite later.
          </Alert>
        ) : (
          <Alert tone="danger" title="Hash chain broken">
            {check.reason ?? "An entry does not match its recorded hash."}
            {check.brokenAtSequence
              ? ` First inconsistency at sequence ${check.brokenAtSequence}.`
              : ""}{" "}
            Treat the database as tampered with and rely on on-chain records.
          </Alert>
        ))}
      {error && <Alert tone="danger">{error}</Alert>}
      <Panel title="Entries" bodyClassName="p-0 sm:p-0">
        {first.loading && !first.data ? (
          <LoadingRows />
        ) : entries.length === 0 ? (
          <EmptyState icon={<ListIcon className="h-5 w-5" />} title="No entries yet" />
        ) : (
          <>
            <Table head={["#", "Time (UTC)", "Action", "Actor", "Target", "Transaction", ""]}>
              {entries.map((e) => (
                <Fragment key={e.sequence}>
                  <tr>
                    <Td mono>{e.sequence}</Td>
                    <Td className="whitespace-nowrap">{formatDateTime(e.createdAt)}</Td>
                    <Td>
                      <span className="text-fg">{actionLabel(e.action)}</span>
                      <p className="font-mono text-[11px] text-fg-subtle">{e.action}</p>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-fg-subtle">
                        {e.actorType === "api_key" ? "API key" : e.actorType}
                      </span>
                      <p className="font-mono text-[11.5px]">{shortAddress(e.actorId, 6, 4)}</p>
                    </Td>
                    <Td mono>{e.targetId ? shortAddress(e.targetId, 8, 6) : "—"}</Td>
                    <Td>
                      <TxLink signature={e.txSignature} />
                    </Td>
                    <Td className="text-right">
                      <button
                        type="button"
                        className="text-[12.5px] text-fg-muted hover:text-fg"
                        aria-expanded={expanded === e.sequence}
                        onClick={() => setExpanded(expanded === e.sequence ? null : e.sequence)}
                      >
                        {expanded === e.sequence ? "Hide" : "Details"}
                      </button>
                    </Td>
                  </tr>
                  {expanded === e.sequence && (
                    <tr>
                      <td colSpan={7} className="bg-bg-raised px-6 py-4">
                        <pre className="overflow-x-auto font-mono text-[11.5px] leading-relaxed text-fg-muted">
                          {JSON.stringify(
                            {
                              metadata: e.metadata,
                              targetType: e.targetType,
                              prevHash: e.prevHash,
                              entryHash: e.entryHash,
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </Table>
            {oldest !== undefined && oldest > 1 && (
              <div className="border-t border-line px-6 py-3">
                <Button size="sm" variant="ghost" loading={loadingMore} onClick={() => void more()}>
                  Load older entries
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>
      <p className="flex items-center gap-2 text-[12.5px] text-fg-subtle">
        <CheckCircleIcon className="h-4 w-4" /> On-chain actions are also recorded on Solana, which
        no database administrator can alter.
      </p>
    </div>
  );
}
