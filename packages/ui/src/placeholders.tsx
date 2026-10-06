/** Placeholder highlighting for code samples (server-safe; shared by CodeBlock and CodeTabs). */
import type { ReactNode } from "react";

/** Splits `code` so that every occurrence of a placeholder is wrapped for highlighting. */
export function markPlaceholders(code: string, placeholders: readonly string[]): ReactNode {
  const list = placeholders.filter(Boolean);
  if (list.length === 0) return code;
  const escaped = list
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = code.split(new RegExp(`(${escaped.join("|")})`, "g"));
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span
        key={i}
        title="Placeholder: replace with your own value"
        className="rounded-[3px] bg-accent/10 text-accent underline decoration-accent/60 decoration-dashed underline-offset-[3px]"
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}
