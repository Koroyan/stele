"use client";
/**
 * Daily recorded acceptances (single series). Bars use the validated chart token
 * (--color-chart-1, checked for lightness band, chroma and ≥3:1 contrast on the card surface),
 * ≤24px wide with 4px rounded data-ends and 2px gaps; values appear in a hover tooltip and in the
 * table view. No legend: the title names the series.
 */
import { useMemo, useState } from "react";
import { cn } from "@stele/ui";
import { formatDate, formatNumber } from "@/lib/format";

interface Point {
  day: string;
  n: number;
}

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i),
    );
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

export function AcceptanceChart({ daily }: { daily: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const series = useMemo(() => {
    const map = new Map(daily.map((d) => [d.day, Number(d.n)]));
    return lastNDays(30).map((day) => ({ day, n: map.get(day) ?? 0 }));
  }, [daily]);
  const total = series.reduce((a, p) => a + p.n, 0);
  const max = niceMax(Math.max(...series.map((p) => p.n), 0));
  const ticks = [max, max / 2, 0];

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">
            Recorded acceptances per day
          </h2>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">
            Last 30 days (UTC) · {formatNumber(total)} total · from indexed on-chain events
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 text-[12.5px] text-fg-muted hover:text-fg"
          onClick={() => setTable((t) => !t)}
          aria-pressed={table}
        >
          {table ? "Show chart" : "View as table"}
        </button>
      </div>

      {table ? (
        <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12.5px]">
            <thead className="sticky top-0 bg-surface-2 text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Date (UTC)
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Acceptances
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...series].reverse().map((p) => (
                <tr key={p.day}>
                  <td className="px-3 py-1.5 text-fg-muted">{formatDate(`${p.day}T00:00:00Z`)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-fg">{formatNumber(p.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="mt-5"
          role="img"
          aria-label={`Bar chart of recorded acceptances per day over the last 30 days; ${total} in total, peak ${Math.max(...series.map((p) => p.n))} in one day.`}
        >
          <div className="relative grid grid-cols-[36px_1fr] gap-2">
            {/* y axis labels */}
            <div className="relative h-44" aria-hidden="true">
              {ticks.map((t, i) => (
                <span
                  key={i}
                  className="absolute right-0 -translate-y-1/2 font-mono text-[10.5px] text-fg-subtle"
                  style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}
                >
                  {formatNumber(t)}
                </span>
              ))}
            </div>
            <div className="relative h-44">
              {/* recessive gridlines */}
              {ticks.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "absolute inset-x-0 h-px",
                    i === ticks.length - 1 ? "bg-line-strong" : "bg-line",
                  )}
                  style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}
                  aria-hidden="true"
                />
              ))}
              <div
                className="absolute inset-0 flex items-end gap-[2px]"
                onMouseLeave={() => setHover(null)}
              >
                {series.map((p, i) => (
                  <div
                    key={p.day}
                    className="relative flex h-full min-w-0 flex-1 items-end justify-center"
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    tabIndex={0}
                    aria-label={`${formatDate(`${p.day}T00:00:00Z`)}: ${p.n} acceptances`}
                  >
                    <div
                      className="w-full max-w-[24px] rounded-t-[4px] transition-opacity"
                      style={{
                        height: p.n > 0 ? `${Math.max((p.n / max) * 100, 1.5)}%` : "0%",
                        backgroundColor: "var(--color-chart-1)",
                        opacity: hover === null || hover === i ? 1 : 0.55,
                      }}
                    />
                    {hover === i && (
                      <div
                        role="tooltip"
                        className={cn(
                          "pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-lg border border-line-strong bg-surface-3 px-2.5 py-1.5 text-[12px] shadow-xl",
                          i < 4
                            ? "left-0"
                            : i > series.length - 5
                              ? "right-0"
                              : "left-1/2 -translate-x-1/2",
                        )}
                      >
                        <span className="text-fg-muted">{formatDate(`${p.day}T00:00:00Z`)}</span>
                        <span className="ml-2 font-mono font-medium text-fg">
                          {formatNumber(p.n)}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div
            className="ml-[44px] mt-2 flex justify-between font-mono text-[10.5px] text-fg-subtle"
            aria-hidden="true"
          >
            <span>{formatDate(`${series[0]!.day}T00:00:00Z`)}</span>
            <span>{formatDate(`${series[15]!.day}T00:00:00Z`)}</span>
            <span>{formatDate(`${series[29]!.day}T00:00:00Z`)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
