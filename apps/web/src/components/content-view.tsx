/**
 * Renders canonical document content as plain React text nodes (never HTML), so a document can
 * never inject markup or scripts into the page. Every block is its own bidi paragraph
 * (`dir="auto"`), and what the canonical form cannot exclude — invisible direction marks, joiners,
 * look-alike words, external links — is spelled out next to the text (PROTOCOL_SPEC.md §4.5).
 */
import {
  SUSPICIOUS_FINDINGS,
  describeFinding,
  inspectContent,
  type Content,
} from "@stele/protocol";
import { cn } from "@stele/ui";

function DisplayNotice({ content }: { content: Content }) {
  const findings = inspectContent(content);
  const suspicious = findings.filter((f) => SUSPICIOUS_FINDINGS.includes(f.kind));
  const links = [
    ...new Set(findings.filter((f) => f.kind === "EXTERNAL_LINK").map((f) => f.value)),
  ];
  if (suspicious.length === 0 && links.length === 0) return null;
  return (
    <div
      role="note"
      className={cn(
        "mt-6 rounded-lg border px-4 py-3 text-[13px]",
        suspicious.length > 0 ? "border-warning-line bg-warning-soft" : "border-line bg-surface-2",
      )}
    >
      {suspicious.length > 0 && (
        <>
          <p className="font-medium text-fg">Read carefully: characters the eye may not catch</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {suspicious.slice(0, 8).map((f, i) => (
              <li key={i}>{describeFinding(f)}</li>
            ))}
            {suspicious.length > 8 && <li>…and {suspicious.length - 8} more</li>}
          </ul>
        </>
      )}
      {links.length > 0 && (
        <p className={cn(suspicious.length > 0 && "mt-2")}>
          The text links to{" "}
          {links.length === 1 ? "an external page" : `${links.length} external pages`}. What{" "}
          {links.length === 1 ? "it says" : "they say"} is not part of the signed content and can
          change.
        </p>
      )}
    </div>
  );
}

export function ContentView({ content, className }: { content: Content; className?: string }) {
  return (
    <div className={cn("space-y-3 text-[14.5px] leading-[1.75] text-fg-muted", className)}>
      {content.blocks.map((b, i) => {
        if (b.type === "heading") {
          const cls =
            b.level === 1
              ? "text-[20px] mt-2"
              : b.level === 2
                ? "text-[16.5px] mt-6"
                : "text-[15px] mt-4";
          const Tag = b.level === 1 ? "h2" : b.level === 2 ? "h3" : "h4";
          return (
            <Tag key={i} dir="auto" className={cn("font-semibold tracking-[-0.01em] text-fg", cls)}>
              {b.text}
            </Tag>
          );
        }
        if (b.type === "paragraph") {
          return (
            <p key={i} dir="auto" className="whitespace-pre-wrap">
              {b.text}
            </p>
          );
        }
        const List = b.ordered ? "ol" : "ul";
        return (
          <List
            key={i}
            className={cn("space-y-1.5 pl-5", b.ordered ? "list-decimal" : "list-disc")}
          >
            {b.items.map((item, j) => (
              <li key={j} dir="auto" className="pl-1 marker:text-fg-subtle">
                {item}
              </li>
            ))}
          </List>
        );
      })}
      {content.changeSummary && (
        <div className="mt-6 rounded-lg border border-line bg-surface-2 px-4 py-3 text-[13px]">
          <p className="font-medium text-fg">Summary of changes (part of the signed content)</p>
          <p dir="auto" className="mt-1 whitespace-pre-wrap">
            {content.changeSummary}
          </p>
        </div>
      )}
      <DisplayNotice content={content} />
    </div>
  );
}
