"use client";
/** Results of the live Gate checks (simulations against the cluster; nothing is signed or sent). */
import { Badge } from "@stele/ui";
import type { ProbeReport } from "@/components/dashboard/gate";
import { formatDateTime } from "@/lib/format";

export function ProbeResults({ report }: { report: ProbeReport }) {
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line rounded-xl border border-line">
        {report.results.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
          >
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-fg">{r.label}</p>
              <p className="mt-0.5 text-[12.5px] text-fg-muted">
                Expected: {r.expect === "allow" ? "success" : "reject"} · {r.detail}
              </p>
            </div>
            <Badge
              tone={
                r.outcome === "passed" ? "verified" : r.outcome === "failed" ? "danger" : "neutral"
              }
            >
              {r.outcome === "passed"
                ? "✓ As expected"
                : r.outcome === "failed"
                  ? "✕ Unexpected"
                  : "Skipped"}
            </Badge>
          </li>
        ))}
      </ul>
      <p className="text-[12px] leading-relaxed text-fg-subtle">
        {report.scope === "protected_action"
          ? "Simulated against the protected instruction on "
          : "Evaluated with the require_current rule against the real policy and passes on "}
        {report.network} at {formatDateTime(report.simulatedAt)}.{" "}
        {report.scope === "policy_requirement" &&
          "Stele cannot call your instruction for you: run the same four scenarios in your program's own tests."}
      </p>
    </div>
  );
}
