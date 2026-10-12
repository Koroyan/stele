"use client";
/** Line-level comparison of two document versions (rendered as text; markers are never color-only). */
import { useMemo, useState } from "react";
import { diffLines } from "diff";
import { contentToPlainLines, type Content } from "@stelehq/protocol";
import { cn } from "@stele/ui";

interface Row {
  kind: "same" | "added" | "removed";
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

function buildRows(before: string, after: string): Row[] {
  const rows: Row[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const part of diffLines(before, after)) {
    const lines = part.value.replace(/\n$/, "").split("\n");
    for (const text of lines) {
      if (part.added) rows.push({ kind: "added", text, oldNo: null, newNo: newNo++ });
      else if (part.removed) rows.push({ kind: "removed", text, oldNo: oldNo++, newNo: null });
      else rows.push({ kind: "same", text, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return rows;
}

export function DiffView({
  before,
  after,
  beforeLabel,
  afterLabel,
}: {
  before: Content;
  after: Content;
  beforeLabel: string;
  afterLabel: string;
}) {
  const [onlyChanges, setOnlyChanges] = useState(true);
  const rows = useMemo(
    () =>
      buildRows(
        `${contentToPlainLines(before).join("\n")}\n`,
        `${contentToPlainLines(after).join("\n")}\n`,
      ),
    [before, after],
  );
  const added = rows.filter((r) => r.kind === "added").length;
  const removed = rows.filter((r) => r.kind === "removed").length;

  // Collapse long unchanged stretches, keeping 2 lines of context around each change.
  const visible = useMemo(() => {
    if (!onlyChanges) return rows.map((r) => ({ row: r, gap: 0 }));
    const keep = new Set<number>();
    rows.forEach((r, i) => {
      if (r.kind !== "same")
        for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < rows.length) keep.add(k);
    });
    const out: { row: Row | null; gap: number }[] = [];
    let gap = 0;
    rows.forEach((r, i) => {
      if (keep.has(i)) {
        if (gap > 0) out.push({ row: null, gap });
        gap = 0;
        out.push({ row: r, gap: 0 });
      } else gap++;
    });
    if (gap > 0) out.push({ row: null, gap });
    return out;
  }, [rows, onlyChanges]);

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface-2 px-4 py-2.5 text-[12.5px]">
        <span className="text-fg-muted">
          <span className="text-fg">{beforeLabel}</span> →{" "}
          <span className="text-fg">{afterLabel}</span>
        </span>
        <span className="font-mono text-accent">+{added}</span>
        <span className="font-mono text-danger">−{removed}</span>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-fg-muted">
          <input
            type="checkbox"
            checked={onlyChanges}
            onChange={(e) => setOnlyChanges(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          Only changed sections
        </label>
      </div>
      {added + removed === 0 ? (
        <p className="px-4 py-6 text-[13.5px] text-fg-muted">
          The visible text is identical. Metadata such as the title, label or effective date may
          still differ.
        </p>
      ) : (
        <div className="max-h-[560px] overflow-auto font-mono text-[12.5px] leading-[1.7]">
          <table className="w-full border-collapse">
            <tbody>
              {visible.map((v, i) =>
                v.row === null ? (
                  <tr key={`gap-${i}`}>
                    <td
                      colSpan={4}
                      className="bg-bg-raised px-4 py-1 text-center text-[11.5px] text-fg-subtle"
                    >
                      {v.gap} unchanged line{v.gap === 1 ? "" : "s"}
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={i}
                    className={cn(
                      v.row.kind === "added" && "bg-accent-soft",
                      v.row.kind === "removed" && "bg-danger-soft",
                    )}
                  >
                    <td className="w-10 select-none px-2 text-right align-top text-fg-subtle">
                      {v.row.oldNo ?? ""}
                    </td>
                    <td className="w-10 select-none px-2 text-right align-top text-fg-subtle">
                      {v.row.newNo ?? ""}
                    </td>
                    <td
                      className={cn(
                        "w-5 select-none text-center align-top",
                        v.row.kind === "added"
                          ? "text-accent"
                          : v.row.kind === "removed"
                            ? "text-danger"
                            : "text-fg-subtle",
                      )}
                      aria-label={
                        v.row.kind === "added"
                          ? "added"
                          : v.row.kind === "removed"
                            ? "removed"
                            : undefined
                      }
                    >
                      {v.row.kind === "added" ? "+" : v.row.kind === "removed" ? "−" : ""}
                    </td>
                    <td
                      className={cn(
                        "whitespace-pre-wrap break-words py-0.5 pr-4",
                        v.row.kind === "removed"
                          ? "text-fg-muted line-through decoration-danger/50"
                          : "text-fg",
                      )}
                    >
                      {v.row.text || " "}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
