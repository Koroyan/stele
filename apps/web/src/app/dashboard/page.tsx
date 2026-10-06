"use client";

import Link from "next/link";
import { ArrowRightIcon, Badge, Card, CheckIcon, Stat, buttonClasses, cn } from "@stele/ui";
import { AcceptanceChart } from "@/components/dashboard/acceptance-chart";
import { actionLabel } from "@/components/dashboard/labels";
import { LoadingRows, PageHeader, Panel, Table, Td, TxLink } from "@/components/dashboard/ui";
import { useDashboard } from "@/lib/dashboard";
import { formatNumber, formatPercent, relativeTime, shortAddress } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface Stats {
  documents: number;
  versions: number;
  acceptancesTotal: number;
  acceptances30d: number;
  challenges30d: number;
  completionRate30d: number | null;
  daily: { day: string; n: number }[];
  recentAcceptances: {
    acceptanceId: string;
    signer: string;
    blockTime: string | null;
    versionNumber: number;
    documentSlug: string;
    transactionSignature: string;
    commitment: string;
  }[];
  activity: {
    action: string;
    targetId: string | null;
    txSignature: string | null;
    createdAt: string;
    metadata: Record<string, unknown>;
  }[];
}

function Checklist() {
  const { detail } = useDashboard();
  const stats = useApi<Stats>(detail ? `/v1/organizations/${detail.organization.id}/stats` : null);
  if (!detail) return null;
  const items = [
    { done: true, label: "Organization created on Solana", href: "/dashboard/organization" },
    {
      done: detail.shards.some((s) => s.status === "active" && s.relayerIsStele),
      label: "Acceptances enabled",
      href: "/dashboard/organization#shards",
    },
    {
      done: Boolean(detail.organization.verifiedDomain),
      label: "Domain verified",
      href: "/dashboard/organization#domain",
    },
    {
      done: (stats.data?.versions ?? 0) > 0,
      label: "First version published",
      href: "/dashboard/documents",
    },
    {
      done: Boolean(detail.organization.recoveryAddress),
      label: "Recovery authority set",
      href: "/dashboard/security",
    },
    {
      done: detail.members.some((m) => m.active && m.roles & 2),
      label: "Publisher added to the team",
      href: "/dashboard/team",
    },
  ];
  const remaining = items.filter((i) => !i.done).length;
  if (remaining === 0) return null;
  return (
    <Panel
      title="Set up your organization"
      description={`${items.length - remaining} of ${items.length} complete`}
    >
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <li key={i.label}>
            <Link
              href={i.href}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3.5 py-3 text-[13px] transition-colors",
                i.done
                  ? "border-line text-fg-subtle"
                  : "border-line-strong text-fg hover:border-accent-line",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                  i.done ? "border-accent-line bg-accent-soft text-accent" : "border-line-strong",
                )}
              >
                {i.done && <CheckIcon className="h-3 w-3" />}
              </span>
              <span className={cn(i.done && "line-through decoration-fg-subtle/50")}>
                {i.label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function OverviewPage() {
  const { org } = useDashboard();
  const stats = useApi<Stats>(org ? `/v1/organizations/${org.id}/stats` : null);
  const s = stats.data;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description="Activity across your published agreements. Counts come from on-chain events indexed by Stele; any acceptance can be re-verified independently."
        actions={
          <Link href="/dashboard/documents/new" className={buttonClasses("primary", "sm")}>
            New document
          </Link>
        }
      />

      <Checklist />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Acceptances, last 30 days"
          value={s ? formatNumber(s.acceptances30d) : "—"}
          caption={s ? `${formatNumber(s.acceptancesTotal)} all time` : " "}
        />
        <Stat
          label="Completion rate, 30 days"
          value={s ? formatPercent(s.completionRate30d) : "—"}
          caption={s ? `${formatNumber(s.challenges30d)} signing requests issued` : " "}
        />
        <Stat
          label="Documents"
          value={s ? formatNumber(s.documents) : "—"}
          caption="With on-chain accounts"
        />
        <Stat
          label="Published versions"
          value={s ? formatNumber(s.versions) : "—"}
          caption="Immutable, fingerprinted"
        />
      </div>

      <Card className="px-5 py-5 sm:px-6">
        {s ? <AcceptanceChart daily={s.daily} /> : <LoadingRows label="Loading activity…" />}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Recent acceptances"
          actions={
            <Link
              href="/dashboard/acceptances"
              className="inline-flex items-center gap-1 text-[12.5px] text-fg-muted hover:text-fg"
            >
              All acceptances <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
          }
          bodyClassName="p-0 sm:p-0"
        >
          {!s ? (
            <LoadingRows />
          ) : s.recentAcceptances.length === 0 ? (
            <p className="px-6 py-8 text-[13px] text-fg-muted">
              No acceptances yet. Share a document&apos;s acceptance link or embed the SDK
              component.
            </p>
          ) : (
            <Table head={["Signer", "Document", "When", "Status", ""]}>
              {s.recentAcceptances.map((a) => (
                <tr key={a.acceptanceId}>
                  <Td mono>{shortAddress(a.signer, 5, 5)}</Td>
                  <Td>
                    <span className="text-fg">{a.documentSlug}</span>{" "}
                    <span className="text-fg-subtle">v#{a.versionNumber}</span>
                  </Td>
                  <Td>{relativeTime(a.blockTime)}</Td>
                  <Td>
                    {a.commitment === "finalized" ? (
                      <Badge tone="neutral">Finalized</Badge>
                    ) : (
                      <Badge tone="neutral">Confirmed</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    <Link
                      href={`/receipt/${a.acceptanceId}`}
                      className="text-[12.5px] text-accent hover:text-accent-strong"
                    >
                      Receipt
                    </Link>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>

        <Panel
          title="Recent activity"
          actions={
            <Link
              href="/dashboard/audit-log"
              className="inline-flex items-center gap-1 text-[12.5px] text-fg-muted hover:text-fg"
            >
              Audit log <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
          }
        >
          {!s ? (
            <LoadingRows />
          ) : s.activity.length === 0 ? (
            <p className="text-[13px] text-fg-muted">Nothing yet.</p>
          ) : (
            <ol className="space-y-4">
              {s.activity.map((a, i) => (
                <li key={i} className="flex gap-3">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-fg-subtle"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] text-fg">{actionLabel(a.action)}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-fg-subtle">
                      {relativeTime(a.createdAt)}
                      {a.targetId && (
                        <span className="truncate font-mono">{shortAddress(a.targetId, 6, 4)}</span>
                      )}
                      {a.txSignature && <TxLink signature={a.txSignature} />}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}
