"use client";
/**
 * Insights: what the organization needs to know about its people and their acceptances — volume
 * and trend, how many finish once asked and how fast, how they sign, who still has to accept the
 * current version (with a downloadable list), when and where they sign (time zone, never IP), the
 * sites the requests come from, cost, proofs and the Gate.
 */
import { useState } from "react";
import { Alert, Button, Card, DownloadIcon, Select, cn } from "@stele/ui";
import {
  CoverageBar,
  Funnel,
  HourBars,
  Legend,
  RankedBars,
  SERIES,
  StackedDaily,
} from "@/components/dashboard/charts";
import { PageHeader, Panel } from "@/components/dashboard/ui";
import { useDashboard } from "@/lib/dashboard";
import { useApi } from "@/lib/use-api";

interface Analytics {
  range: { from: string; to: string; days: number };
  totals: {
    acceptances: number;
    previousAcceptances: number;
    people: number;
    previousPeople: number;
    completionRate: number | null;
    previousCompletionRate: number | null;
    medianSecondsToSign: number | null;
    feeLamports: number;
    feePerAcceptance: number | null;
  };
  funnel: {
    requested: number;
    signed: number;
    recorded: number;
    finalized: number;
    expired: number;
    failed: number;
  };
  daily: { date: string; wallet: number; passkey: number }[];
  methods: { wallet: number; passkey: number };
  hours: number[];
  timeZones: { label: string; count: number }[];
  domains: { label: string; count: number }[];
  failures: { reason: string; count: number }[];
  coverage: {
    documentId: string;
    slug: string;
    title: string;
    currentVersion: number;
    people: number;
    onCurrent: number;
    needsReacceptance: number;
    versions: { number: number; people: number }[];
  }[];
  proofs: { type: string; count: number }[];
  gate: { current: number; outdated: number };
}

const PERIODS = [7, 30, 90] as const;
const fmt = (n: number) => n.toLocaleString("en-US");

function delta(now: number, before: number, days: number): string | null {
  if (before === 0) return now > 0 ? `new in the last ${days} days` : null;
  const change = ((now - before) / before) * 100;
  const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "•";
  return `${arrow} ${Math.abs(Math.round(change))}% vs previous ${days} days`;
}

function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

function Kpi({ label, value, caption }: { label: string; value: string; caption?: string | null }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-[12.5px] text-fg-muted">{label}</p>
      <p className="mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-fg">
        {value}
      </p>
      <p className="mt-2 min-h-[16px] text-[12px] text-fg-subtle">{caption ?? ""}</p>
    </Card>
  );
}

export default function InsightsPage() {
  const { detail } = useDashboard();
  const orgId = detail?.organization.id;
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [documentId, setDocumentId] = useState("");
  const [allCoverage, setAllCoverage] = useState(false);
  const query = new URLSearchParams({ days: String(days) });
  if (documentId) query.set("documentId", documentId);
  const a = useApi<Analytics>(orgId ? `/v1/organizations/${orgId}/analytics?${query}` : null);
  const docs = useApi<{
    documents: { id: string; slug: string; currentVersion: { title: string } | null }[];
  }>(orgId ? `/v1/organizations/${orgId}/documents` : null);
  if (!detail) return null;
  const d = a.data;
  const t = d?.totals;

  return (
    <>
      <PageHeader
        title="Insights"
        description="Who accepted, how many finished once asked, how fast, how they sign, and who still has to accept your current versions."
      />

      {/* Filters: one row, above everything they scope. */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div
          className="inline-flex rounded-xl border border-line bg-surface p-1"
          role="group"
          aria-label="Period"
        >
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setDays(p)}
              aria-pressed={days === p}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                days === p ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg",
              )}
            >
              Last {p} days
            </button>
          ))}
        </div>
        <div className="w-56">
          <Select
            aria-label="Document"
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value)}
          >
            <option value="">All documents</option>
            {(docs.data?.documents ?? []).map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.currentVersion?.title ?? doc.slug}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {a.error && (
        <Alert tone="danger" className="mt-6">
          {a.error.message}
        </Alert>
      )}

      {d && t && (
        <div className={cn("mt-6 space-y-6 transition-opacity", a.loading && "opacity-60")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Acceptances"
              value={fmt(t.acceptances)}
              caption={delta(t.acceptances, t.previousAcceptances, days)}
            />
            <Kpi
              label="People"
              value={fmt(t.people)}
              caption={
                delta(t.people, t.previousPeople, days) ?? "Your user IDs, or their signing keys"
              }
            />
            <Kpi
              label="Completion"
              value={t.completionRate === null ? "—" : `${Math.round(t.completionRate * 100)}%`}
              caption={
                t.completionRate === null
                  ? "No signing requests in this period"
                  : t.previousCompletionRate === null
                    ? "of signing requests ended on Solana"
                    : `${t.completionRate >= t.previousCompletionRate ? "▲" : "▼"} ${Math.abs(
                        Math.round((t.completionRate - t.previousCompletionRate) * 100),
                      )} pts vs previous ${days} days`
              }
            />
            <Kpi
              label="Median time to sign"
              value={duration(t.medianSecondsToSign)}
              caption="From the request to the record on Solana"
            />
          </div>

          <Panel
            title="Acceptances per day"
            description={`${fmt(t.acceptances)} in the last ${days} days, by how people signed.`}
          >
            <StackedDaily
              data={d.daily.map((x) => ({ date: x.date, values: [x.wallet, x.passkey] }))}
              series={[
                { label: "Wallet", color: SERIES.blue },
                { label: "Passkey (no wallet)", color: SERIES.orange },
              ]}
            />
          </Panel>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Panel
              title="From request to record"
              description="Signing requests your site made in this period, and how far each got."
            >
              {d.funnel.requested === 0 ? (
                <p className="text-[13px] text-fg-subtle">
                  No signing requests in this period. Acceptances recorded outside the Stele API
                  (for example by your own relayer) are counted above but have no request.
                </p>
              ) : (
                <>
                  <Funnel
                    stages={[
                      { label: "Requested", count: d.funnel.requested, hint: "terms shown" },
                      { label: "Signed", count: d.funnel.signed },
                      { label: "Recorded on Solana", count: d.funnel.recorded },
                      { label: "Finalized", count: d.funnel.finalized },
                    ]}
                  />
                  <p className="mt-4 text-[12.5px] text-fg-subtle">
                    Not completed: {fmt(d.funnel.expired)} expired unsigned
                    {d.funnel.failed > 0 && ` · ${fmt(d.funnel.failed)} failed`}
                    {d.failures.length > 0 &&
                      ` (${d.failures.map((f) => `${f.reason} ×${f.count}`).join(", ")})`}
                  </p>
                </>
              )}
            </Panel>

            <Panel
              title="When people sign"
              description="Hour of day in each signer's own time zone."
            >
              {d.hours.some((h) => h > 0) ? (
                <HourBars hours={d.hours} />
              ) : (
                <p className="text-[13px] text-fg-subtle">
                  No signer time zone recorded in this period.
                </p>
              )}
            </Panel>
          </div>

          <Panel
            title="Current versions"
            description="Each person's latest acceptance, by document. Download who still has to accept the current version."
          >
            {d.coverage.length === 0 ? (
              <p className="text-[13px] text-fg-subtle">No acceptances yet.</p>
            ) : (
              <div className="grid gap-5">
                <Legend
                  items={[
                    { label: "On the current version", color: SERIES.blue },
                    { label: "Must accept again", color: "var(--color-warning)" },
                  ]}
                />
                {[...d.coverage]
                  // Documents where people must accept again come first.
                  .sort((x, y) => y.needsReacceptance - x.needsReacceptance || y.people - x.people)
                  .slice(0, allCoverage ? undefined : 6)
                  .map((c) => (
                    <div key={c.documentId} className="grid gap-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-[14px] font-medium text-fg">
                          {c.title}{" "}
                          <span className="text-[12.5px] font-normal text-fg-subtle">
                            current: v{c.currentVersion}
                          </span>
                        </p>
                        <p className="text-[13px] tabular-nums text-fg">
                          {fmt(c.onCurrent)} of {fmt(c.people)} on v{c.currentVersion}{" "}
                          <span className="text-fg-subtle">
                            ({Math.round((c.onCurrent / c.people) * 100)}%)
                          </span>
                        </p>
                      </div>
                      <CoverageBar onCurrent={c.onCurrent} needs={c.needsReacceptance} />
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-fg-subtle">
                        <span>
                          {c.versions
                            .slice(0, 5)
                            .map((v) => `v${v.number}: ${fmt(v.people)}`)
                            .join(" · ")}
                        </span>
                        {c.needsReacceptance > 0 && (
                          <a
                            href={`/api/v1/organizations/${orgId}/analytics/reacceptance?documentId=${c.documentId}&format=csv`}
                            className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                          >
                            <DownloadIcon className="h-3.5 w-3.5" />
                            {fmt(c.needsReacceptance)} must accept again (CSV)
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                {d.coverage.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setAllCoverage((v) => !v)}
                    className="justify-self-start text-[12.5px] font-medium text-accent hover:underline"
                  >
                    {allCoverage ? "Show fewer" : `Show all ${d.coverage.length} documents`}
                  </button>
                )}
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Panel title="How people sign">
              <RankedBars
                rows={[
                  { label: "Wallet", count: d.methods.wallet },
                  { label: "Passkey (no wallet)", count: d.methods.passkey },
                ].filter((r) => r.count > 0)}
                empty="No acceptances in this period."
              />
            </Panel>
            <Panel title="Where requests come from" description="The site that asked.">
              <RankedBars rows={d.domains} empty="No acceptances in this period." />
            </Panel>
            <Panel title="Signers' time zones" description="Reported by the browser — never an IP.">
              <RankedBars rows={d.timeZones} empty="No time zone recorded in this period." />
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Network fees"
              value={`${(t.feeLamports / 1e9).toFixed(4)} SOL`}
              caption={
                t.feePerAcceptance === null
                  ? null
                  : `${fmt(t.feePerAcceptance)} lamports per acceptance · users pay nothing`
              }
            />
            <Kpi
              label="Proofs"
              value={fmt(d.proofs.reduce((x, p) => x + p.count, 0))}
              caption={
                d.proofs.length
                  ? d.proofs.map((p) => `${p.type} ${p.count}`).join(" · ")
                  : "Purchases, refunds, consents"
              }
            />
            <Kpi
              label="Gate: wallets cleared"
              value={fmt(d.gate.current)}
              caption="Satisfy your policies right now"
            />
            <Kpi
              label="Gate: must accept again"
              value={fmt(d.gate.outdated)}
              caption="Their accepted version is older than required"
            />
          </div>

          <p className="text-[12px] text-fg-subtle">
            Days are UTC. Counts come from Stele&apos;s index of your on-chain evidence; every
            acceptance can be verified on Solana.{" "}
            <Button
              variant="ghost"
              size="sm"
              className="ml-1 h-auto px-1 py-0 text-[12px]"
              onClick={a.reload}
            >
              Refresh
            </Button>
          </p>
        </div>
      )}
    </>
  );
}
