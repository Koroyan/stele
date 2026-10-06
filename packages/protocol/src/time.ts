/** RFC 3339 (PROTOCOL_SPEC.md §7.3). Mirrors `crates/stele-core/src/time.rs`. */
import { MAX_RFC3339_TIMESTAMP } from "./constants";
import { ProtocolError } from "./errors";

/** Howard Hinnant's days-from-civil inverse (proleptic Gregorian). */
export function civilFromDays(days: number): [number, number, number] {
  const z = days + 719_468;
  const era = Math.floor((z >= 0 ? z : z - 146_096) / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1_460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [m <= 2 ? y + 1 : y, m, d];
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

export function toUnixSeconds(t: number | bigint): number {
  const n = typeof t === "bigint" ? Number(t) : t;
  if (!Number.isSafeInteger(n))
    throw new ProtocolError("INVALID_TIMESTAMP", "timestamp is not an integer");
  return n;
}

/** `YYYY-MM-DDTHH:MM:SSZ` for `0 ≤ t ≤ 253402300799`. */
export function formatRfc3339(t: number | bigint): string {
  const s = toUnixSeconds(t);
  if (s < 0 || s > MAX_RFC3339_TIMESTAMP)
    throw new ProtocolError("INVALID_TIMESTAMP", "timestamp out of range");
  const days = Math.floor(s / 86_400);
  const secs = s % 86_400;
  const [y, m, d] = civilFromDays(days);
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}T${pad(Math.floor(secs / 3_600), 2)}:${pad(Math.floor((secs % 3_600) / 60), 2)}:${pad(secs % 60, 2)}Z`;
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

/** Strict inverse of `formatRfc3339`; rejects anything it would not produce. */
export function parseRfc3339(s: string): number {
  const m = RFC3339.exec(s);
  if (!m) throw new ProtocolError("INVALID_TIMESTAMP", `not an RFC 3339 UTC timestamp: ${s}`);
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
  // Date.UTC maps years 0–99 to 1900–1999; the round trip below rejects those and invalid dates.
  const t = Math.floor(ms / 1000);
  if (!Number.isFinite(ms) || formatRfc3339(t) !== s) {
    throw new ProtocolError("INVALID_TIMESTAMP", `invalid or non-canonical timestamp: ${s}`);
  }
  return t;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
