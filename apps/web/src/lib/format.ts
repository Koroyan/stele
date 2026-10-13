/** Display formatting. Dates are shown in UTC with an explicit zone so evidence is unambiguous. */

export function shortAddress(a: string | null | undefined, head = 4, tail = 4): string {
  if (!a) return "—";
  return a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
}

function toDate(v: string | number | Date | bigint | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "bigint") return new Date(Number(v) * 1000);
  if (typeof v === "number") return new Date(v < 1e11 ? v * 1000 : v);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DATE = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

export function formatDate(v: Parameters<typeof toDate>[0]): string {
  const d = toDate(v);
  return d ? DATE.format(d) : "—";
}

export function formatDateTime(v: Parameters<typeof toDate>[0]): string {
  const d = toDate(v);
  return d ? `${DATE_TIME.format(d)} UTC` : "—";
}

export function formatIso(v: Parameters<typeof toDate>[0]): string {
  const d = toDate(v);
  return d ? d.toISOString().replace(".000Z", "Z") : "—";
}

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function relativeTime(v: Parameters<typeof toDate>[0], now = Date.now()): string {
  const d = toDate(v);
  if (!d) return "—";
  const s = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return "just now";
  if (abs < 3_600) return RTF.format(Math.round(s / 60), "minute");
  if (abs < 86_400) return RTF.format(Math.round(s / 3_600), "hour");
  if (abs < 86_400 * 30) return RTF.format(Math.round(s / 86_400), "day");
  return formatDate(d);
}

const NUM = new Intl.NumberFormat("en-US");
export const formatNumber = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : NUM.format(n);

export function formatPercent(r: number | null | undefined): string {
  if (r === null || r === undefined) return "—";
  return `${(r * 100).toFixed(r >= 0.995 || r === 0 ? 0 : 1)}%`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const formatSol = (lamports: bigint | number) =>
  `${(Number(lamports) / LAMPORTS_PER_SOL).toLocaleString("en-US", { maximumFractionDigits: 6 })} SOL`;

/** Exact to the second, in UTC: "2026-10-12 12:23:15 UTC". */
export function formatExactUtc(v: Parameters<typeof toDate>[0]): string {
  const d = toDate(v);
  return d ? `${d.toISOString().slice(0, 19).replace("T", " ")} UTC` : "—";
}

/** "UTC+04:00" for an offset in minutes east of UTC. */
export function utcOffsetLabel(minutes: number): string {
  const m = Math.abs(minutes);
  return `UTC${minutes < 0 ? "-" : "+"}${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** The same instant in another UTC offset: "16:23:15 (UTC+04:00)". */
export function formatAtOffset(v: Parameters<typeof toDate>[0], minutes: number): string {
  const d = toDate(v);
  if (!d) return "—";
  const shifted = new Date(d.getTime() + minutes * 60_000);
  return `${shifted.toISOString().slice(11, 19)} (${utcOffsetLabel(minutes)})`;
}
