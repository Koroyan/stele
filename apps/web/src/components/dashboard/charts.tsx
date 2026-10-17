"use client";
/**
 * Dashboard charts, hand-built in SVG on the dataviz method: thin marks with 4px rounded data ends
 * on the baseline, 2px surface gaps, recessive axes, a hover tooltip on every mark, a legend with
 * direct labels for two series, and a table view. Colors are validated on the dashboard's dark
 * surface (#0e141d): categorical #3987e5 / #d95926 / #199e70, ordinal blue #86b6ef → #1c5cab.
 * Text always wears text tokens — never a series color.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@stele/ui";

export const SERIES = { blue: "#3987e5", orange: "#d95926", aqua: "#199e70" } as const;
export const ORDINAL = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab"] as const;
const NEUTRAL = "#4b5a6e";

const fmt = (n: number) => n.toLocaleString("en-US");

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A rectangle with a 4px rounded top: the data end sits away from the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0 || w <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

interface Tip {
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string; color?: string }[];
}

/** Keeps the tooltip (about 180px wide) inside the chart. */
function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x, 92), Math.max(92, width - 92));
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 min-w-[140px] -translate-x-1/2 -translate-y-full rounded-lg border border-line-strong bg-surface-3 px-3 py-2 text-[12px] shadow-lg"
      style={{ left, top: Math.max(tip.y - 8, 70) }}
    >
      <p className="mb-1 text-fg-muted">{tip.title}</p>
      {tip.rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 whitespace-nowrap">
          {r.color && (
            <span className="inline-block h-[2px] w-3 rounded" style={{ background: r.color }} />
          )}
          <span className="font-semibold tabular-nums text-fg">{r.value}</span>
          <span className="text-fg-muted">{r.label}</span>
        </p>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-fg-muted">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-[3px]"
            style={{ background: i.color }}
          />
          {i.label}
          {i.value && <span className="font-medium tabular-nums text-fg">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Stacked daily bars (two series), with a table view. */
export function StackedDaily({
  data,
  series,
  height = 190,
}: {
  data: { date: string; values: number[] }[];
  series: { label: string; color: string }[];
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const left = 34;
  const bottom = 22;
  const plotW = Math.max(0, width - left);
  const plotH = height - bottom - 6;
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0));
  const max = niceMax(Math.max(0, ...totals));
  const slot = data.length > 0 ? plotW / data.length : 0;
  const barW = Math.max(1, slot - 2);
  const y = (v: number) => 6 + plotH - (v / max) * plotH;
  const label = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const ticks = [0, max / 2, max];
  const xLabels = data.length > 1 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : [0];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Legend
          items={series.map((s, i) => ({
            ...s,
            value: fmt(data.reduce((a, d) => a + (d.values[i] ?? 0), 0)),
          }))}
        />
        <button
          type="button"
          onClick={() => setTable((t) => !t)}
          className="text-[12px] text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
        >
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>
      {table ? (
        <div className="max-h-[260px] overflow-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12.5px]">
            <thead className="sticky top-0 bg-surface-2 text-fg-subtle">
              <tr>
                <th className="px-3 py-1.5 font-medium">Day (UTC)</th>
                {series.map((s) => (
                  <th key={s.label} className="px-3 py-1.5 text-right font-medium">
                    {s.label}
                  </th>
                ))}
                <th className="px-3 py-1.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={d.date} className="border-t border-line">
                  <td className="px-3 py-1 text-fg-muted">{label(d.date)}</td>
                  {d.values.map((v, j) => (
                    <td key={j} className="px-3 py-1 text-right tabular-nums text-fg">
                      {fmt(v)}
                    </td>
                  ))}
                  <td className="px-3 py-1 text-right tabular-nums text-fg">{fmt(totals[i]!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative" onPointerLeave={() => (setTip(null), setHover(null))}>
          {width > 0 && (
            <svg width={width} height={height} role="img" aria-label="Acceptances per day">
              {ticks.map((t) => (
                <g key={t}>
                  <line
                    x1={left}
                    x2={width}
                    y1={y(t)}
                    y2={y(t)}
                    stroke="currentColor"
                    className="text-line-strong"
                    strokeDasharray={t === 0 ? undefined : "2 4"}
                  />
                  <text
                    x={left - 8}
                    y={y(t) + 4}
                    textAnchor="end"
                    className="fill-fg-subtle text-[10.5px] tabular-nums"
                  >
                    {fmt(t)}
                  </text>
                </g>
              ))}
              {data.map((d, i) => {
                const x = left + i * slot + 1;
                let base = 0;
                const segs = d.values.map((v, j) => {
                  const top = base + v;
                  const isTop = d.values.slice(j + 1).every((n) => n === 0);
                  const y0 = y(top);
                  // 2px surface gap between stacked segments.
                  const h = y(base) - y0 - (base > 0 ? 2 : 0);
                  base = top;
                  if (v === 0 || h <= 0) return null;
                  return (
                    <path
                      key={j}
                      d={
                        isTop
                          ? topRounded(x, y0, barW, h)
                          : `M${x},${y0}H${x + barW}V${y0 + h}H${x}Z`
                      }
                      fill={series[j]!.color}
                      opacity={hover === null || hover === i ? 1 : 0.55}
                    />
                  );
                });
                return <g key={d.date}>{segs}</g>;
              })}
              {data.map((d, i) => (
                <rect
                  key={`hit-${d.date}`}
                  x={left + i * slot}
                  y={0}
                  width={Math.max(slot, 1)}
                  height={height - bottom}
                  fill="transparent"
                  onPointerMove={() => {
                    setHover(i);
                    setTip({
                      x: left + i * slot + slot / 2,
                      y: y(totals[i]!),
                      title: `${label(d.date)} (UTC)`,
                      rows: [
                        ...series.map((s, j) => ({
                          label: s.label,
                          value: fmt(d.values[j] ?? 0),
                          color: s.color,
                        })),
                        { label: "total", value: fmt(totals[i]!) },
                      ],
                    });
                  }}
                />
              ))}
              {xLabels.map((i) => (
                <text
                  key={`x-${i}`}
                  x={left + i * slot + slot / 2}
                  y={height - 6}
                  textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
                  className="fill-fg-subtle text-[10.5px]"
                >
                  {data[i] ? label(data[i]!.date) : ""}
                </text>
              ))}
            </svg>
          )}
          <Tooltip tip={tip} width={width} />
        </div>
      )}
    </div>
  );
}

/** 24 hourly bars, one series (the title names it). */
export function HourBars({ hours, height = 150 }: { hours: number[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const bottom = 20;
  const plotH = height - bottom - 4;
  const max = niceMax(Math.max(0, ...hours));
  const slot = width / 24;
  const y = (v: number) => 4 + plotH - (v / max) * plotH;
  return (
    <div ref={ref} className="relative" onPointerLeave={() => (setTip(null), setHover(null))}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Acceptances by local hour">
          <line
            x1={0}
            x2={width}
            y1={y(0)}
            y2={y(0)}
            stroke="currentColor"
            className="text-line-strong"
          />
          {hours.map((v, h) => (
            <g key={h}>
              <path
                d={topRounded(h * slot + 1, y(v), Math.max(1, slot - 2), y(0) - y(v))}
                fill={SERIES.blue}
                opacity={hover === null || hover === h ? 1 : 0.55}
              />
              <rect
                x={h * slot}
                y={0}
                width={slot}
                height={height - bottom}
                fill="transparent"
                onPointerMove={() => {
                  setHover(h);
                  setTip({
                    x: h * slot + slot / 2,
                    y: y(v),
                    title: `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00 local`,
                    rows: [{ label: "acceptances", value: fmt(v) }],
                  });
                }}
              />
            </g>
          ))}
          {[0, 6, 12, 18, 23].map((h) => (
            <text
              key={h}
              x={h * slot + slot / 2}
              y={height - 5}
              textAnchor="middle"
              className="fill-fg-subtle text-[10.5px] tabular-nums"
            >
              {String(h).padStart(2, "0")}
            </text>
          ))}
        </svg>
      )}
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

/** Ranked horizontal bars with direct value labels; "Other" in neutral. */
export function RankedBars({
  rows,
  empty,
  color = SERIES.blue,
}: {
  rows: { label: string; count: number }[];
  empty: ReactNode;
  color?: string;
}) {
  if (rows.length === 0) return <p className="text-[13px] text-fg-subtle">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.count));
  const total = rows.reduce((a, r) => a + r.count, 0);
  return (
    <ul className="grid gap-2.5">
      {rows.map((r) => (
        <li
          key={r.label}
          title={`${r.label}: ${fmt(r.count)} (${Math.round((r.count / total) * 100)}%)`}
        >
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="truncate text-fg-muted">{r.label}</span>
            <span className="tabular-nums text-fg">
              {fmt(r.count)}{" "}
              <span className="text-fg-subtle">{Math.round((r.count / total) * 100)}%</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-surface-3">
            <div
              className="h-1.5 rounded-full"
              style={{
                width: `${Math.max(2, (r.count / max) * 100)}%`,
                background: r.label === "Other" ? NEUTRAL : color,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Funnel stages as ordinal bars (one hue, light → dark), each with its share of the first. */
export function Funnel({ stages }: { stages: { label: string; count: number; hint?: string }[] }) {
  const first = stages[0]?.count ?? 0;
  return (
    <ol className="grid gap-3">
      {stages.map((s, i) => {
        const share = first > 0 ? s.count / first : 0;
        return (
          <li key={s.label}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="text-fg">
                {s.label}
                {s.hint && <span className="ml-2 text-[12px] text-fg-subtle">{s.hint}</span>}
              </span>
              <span className="tabular-nums text-fg">
                {fmt(s.count)}{" "}
                {i > 0 && first > 0 && (
                  <span className="text-fg-subtle">{Math.round(share * 100)}%</span>
                )}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 rounded-full bg-surface-3">
              <div
                className="h-2.5 rounded-full"
                style={{
                  width: `${first > 0 ? Math.max(1.5, share * 100) : 0}%`,
                  background: ORDINAL[Math.min(i, ORDINAL.length - 1)],
                }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A two-part bar: the part on the current version, and the part that still has to accept. */
export function CoverageBar({
  onCurrent,
  needs,
  className,
}: {
  onCurrent: number;
  needs: number;
  className?: string;
}) {
  const total = onCurrent + needs;
  const p = total > 0 ? (onCurrent / total) * 100 : 0;
  return (
    <div className={cn("flex h-2.5 gap-[2px] overflow-hidden rounded-full", className)}>
      {onCurrent > 0 && (
        <div className="h-full rounded-full" style={{ width: `${p}%`, background: SERIES.blue }} />
      )}
      {needs > 0 && (
        <div
          className="h-full flex-1 rounded-full bg-warning"
          title={`${fmt(needs)} still on an older version`}
        />
      )}
    </div>
  );
}
