/**
 * Markdown renderer for repository documentation. Raw HTML in Markdown is NOT rendered (no
 * rehype-raw), so documentation cannot inject markup; links are rewritten to site routes.
 *
 * Documentation extensions (all plain Markdown, so the files still read well on GitHub):
 * - fenced code blocks get a language label, a copy button and highlighted placeholders;
 * - consecutive fenced blocks labelled `tab=Name` (```python tab=Python) become one block with a
 *   tab per language; the reader's language choice applies to every group and is remembered;
 * - `https://app.stele.example` is replaced with this Stele app's address, and an
 *   `<!-- stele:networks -->` comment with the base URL of every network's Stele app;
 * - a ```flow block (one step per line) renders as a step diagram;
 * - `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and `[!CAUTION]` blockquotes render as
 *   callouts, and `> [!DETAILS] Title` as a collapsible section.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertIcon,
  ArrowRightIcon,
  CodeBlock,
  CodeTabs,
  CopyButton,
  InfoIcon,
  cn,
  type CodeTab,
} from "@stele/ui";
import { REPO_URL } from "@/lib/env";
import { DOC_PLACEHOLDERS, headingId, resolveDocLink } from "@/lib/docs";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node)
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

/* eslint-disable @typescript-eslint/no-explicit-any -- minimal mdast traversal */
/** Marks GitHub-style alert blockquotes (`> [!WARNING]`) and `> [!DETAILS] Title` sections. */
function remarkCallouts() {
  const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|DETAILS)\][ \t]*([^\n]*)\n?/;
  const walk = (node: any) => {
    if (node.type === "blockquote") {
      const paragraph = node.children?.[0];
      const first = paragraph?.type === "paragraph" ? paragraph.children?.[0] : null;
      const match = first?.type === "text" ? MARKER.exec(first.value) : null;
      if (match) {
        const kind = match[1]!.toLowerCase();
        first.value = first.value.slice(match[0].length);
        if (first.value === "") paragraph.children.shift();
        if (paragraph.children.length === 0) node.children.shift();
        node.data = {
          ...node.data,
          hProperties: { "data-callout": kind, "data-title": match[2]?.trim() ?? "" },
        };
      }
    }
    node.children?.forEach(walk);
  };
  return (tree: any) => walk(tree);
}

/**
 * Merges consecutive fenced code blocks labelled `tab=Name` (or `tab="Two words"`) into one tab
 * group, and turns `<!-- stele:networks -->` into the networks table.
 */
function remarkDocBlocks() {
  const TAB = /(?:^|\s)tab=(?:"([^"]+)"|(\S+))/;
  const walk = (node: any) => {
    if (!Array.isArray(node.children)) return;
    const out: any[] = [];
    for (const child of node.children) {
      const tab = child.type === "code" ? TAB.exec(child.meta ?? "") : null;
      if (tab) {
        const entry: CodeTab = {
          label: (tab[1] ?? tab[2])!,
          code: child.value,
          ...(child.lang ? { language: child.lang } : {}),
        };
        const last = out[out.length - 1];
        if (last?.type === "codeTabs") last.tabs.push(entry);
        else out.push({ type: "codeTabs", tabs: [entry], data: { hName: "div" } });
        continue;
      }
      if (child.type === "html" && /^<!--\s*stele:networks\s*-->$/.test(child.value.trim())) {
        out.push({
          type: "steleNetworks",
          data: { hName: "div", hProperties: { "data-stele-networks": "" } },
        });
        continue;
      }
      walk(child);
      out.push(child);
    }
    for (const group of out)
      if (group.type === "codeTabs")
        group.data.hProperties = { "data-code-tabs": JSON.stringify(group.tabs) };
    node.children = out;
  };
  return (tree: any) => walk(tree);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** One network's Stele app, for the base URL table. */
export interface DocNetwork {
  label: string;
  /** API base URL (`…/api/v1`), or `null` when that network is not offered. */
  baseUrl: string | null;
  current: boolean;
  test: boolean;
}

/** Facts about this deployment that documentation samples are filled in with. */
export interface DocContext {
  /** This Stele app's origin, replacing `https://app.stele.example`. */
  origin: string;
  /** Test networks issue `stl_test_` API keys. */
  testNetwork: boolean;
  networks: DocNetwork[];
}

function fillIn(markdown: string, context: DocContext | undefined): string {
  if (!context) return markdown;
  const host = new URL(context.origin).host;
  let out = markdown
    .replaceAll("https://app.stele.example", context.origin)
    .replaceAll("app.stele.example", host);
  if (context.testNetwork) out = out.replaceAll("stl_live_…", "stl_test_…");
  return out;
}

function Networks({ networks }: { networks: DocNetwork[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Network</th>
          <th scope="col">Base URL</th>
        </tr>
      </thead>
      <tbody>
        {networks.map((n) => (
          <tr key={n.label}>
            <td className="whitespace-nowrap">
              {n.label}
              {n.current && <span className="ml-2 text-[12px] text-accent">this site</span>}
              {n.test && <span className="ml-2 text-[12px] text-fg-subtle">test</span>}
            </td>
            <td>
              {n.baseUrl ? (
                <span className="inline-flex items-center gap-1">
                  <code>{n.baseUrl}</code>
                  <CopyButton value={n.baseUrl} label={`Copy the ${n.label} base URL`} />
                </span>
              ) : (
                <span className="text-fg-subtle">Not available</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const CALLOUTS: Record<string, { title: string; className: string; icon: ReactNode }> = {
  note: {
    title: "Note",
    className: "border-line-strong bg-surface",
    icon: <InfoIcon className="h-4 w-4 text-fg-muted" />,
  },
  tip: {
    title: "Tip",
    className: "border-accent-line bg-accent/5",
    icon: <InfoIcon className="h-4 w-4 text-accent" />,
  },
  important: {
    title: "Important",
    className: "border-accent-line bg-accent/5",
    icon: <InfoIcon className="h-4 w-4 text-accent" />,
  },
  warning: {
    title: "Warning",
    className: "border-warning/40 bg-warning/5",
    icon: <AlertIcon className="h-4 w-4 text-warning" />,
  },
  caution: {
    title: "Caution",
    className: "border-danger/40 bg-danger/5",
    icon: <AlertIcon className="h-4 w-4 text-danger" />,
  },
};

function Flow({ steps }: { steps: string[] }) {
  return (
    <ol className="doc-flow my-6 flex flex-col items-start gap-0" aria-label="Flow">
      {steps.map((step, i) => (
        <li key={i} className="flex flex-col items-start">
          <span className="rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-[13.5px] text-fg">
            <span className="mr-2 font-mono text-[11.5px] text-accent">
              {String(i + 1).padStart(2, "0")}
            </span>
            {step}
          </span>
          {i < steps.length - 1 && (
            <ArrowRightIcon aria-hidden="true" className="ml-5 h-4 w-4 rotate-90 text-fg-subtle" />
          )}
        </li>
      ))}
    </ol>
  );
}

export function Markdown({
  markdown,
  file,
  context,
}: {
  markdown: string;
  file: string;
  context?: DocContext;
}) {
  const heading = (Tag: "h1" | "h2" | "h3" | "h4") =>
    function Heading({ children }: { children?: ReactNode }) {
      const id = headingId(textOf(children));
      return (
        <Tag id={id} className="group scroll-mt-24">
          {children}
          {Tag !== "h1" && (
            <a
              href={`#${id}`}
              aria-label="Link to this section"
              className="ml-2 text-fg-subtle no-underline opacity-0 transition-opacity group-hover:opacity-100"
            >
              #
            </a>
          )}
        </Tag>
      );
    };

  const components: Components = {
    h1: heading("h1"),
    h2: heading("h2"),
    h3: heading("h3"),
    h4: heading("h4"),
    a({ href, children }) {
      const target = href ? resolveDocLink(href, file) : null;
      if (target === null) {
        // Source files may link to the public repository; documents without a page on this site
        // are internal and are never linked, not even to the repository.
        if (href && REPO_URL && !/^[a-z]+:/i.test(href) && !/\.md(#|$)/i.test(href)) {
          return (
            <a
              href={`${REPO_URL.replace(/\/$/, "")}/blob/main/${href.replace(/^(\.\.\/)+/, "")}`}
              rel="noreferrer noopener"
            >
              {children}
            </a>
          );
        }
        return <span className="font-medium text-fg">{children}</span>;
      }
      if (target.startsWith("/") || target.startsWith("#"))
        return <Link href={target}>{children}</Link>;
      return (
        <a href={target} rel="noreferrer noopener">
          {children}
        </a>
      );
    },
    pre({ children }) {
      // Fenced code: <pre><code class="language-x">…</code></pre>
      const child = Array.isArray(children) ? children[0] : children;
      const props = (child as { props?: { className?: string; children?: ReactNode } } | null)
        ?.props;
      const language = /language-([\w-]+)/.exec(props?.className ?? "")?.[1];
      const code = textOf(props?.children).replace(/\n$/, "");
      if (language === "flow")
        return (
          <Flow
            steps={code
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)}
          />
        );
      return (
        <CodeBlock
          className="doc-code"
          code={code}
          language={language}
          placeholders={language === "json" ? [] : DOC_PLACEHOLDERS}
        />
      );
    },
    blockquote(props) {
      const { children } = props;
      const kind = (props as Record<string, unknown>)["data-callout"] as string | undefined;
      const title = ((props as Record<string, unknown>)["data-title"] as string | undefined) ?? "";
      if (kind === "details") {
        return (
          <details className="doc-details group my-5 rounded-xl border border-line bg-surface">
            <summary className="cursor-pointer select-none px-4 py-3 text-[14px] font-medium text-fg">
              {title || "Details"}
            </summary>
            <div className="border-t border-line px-4 pb-1 pt-4">{children}</div>
          </details>
        );
      }
      const callout = kind ? CALLOUTS[kind] : undefined;
      if (!callout) return <blockquote>{children}</blockquote>;
      return (
        <div
          role="note"
          className={cn("doc-callout my-5 rounded-xl border px-4 py-3", callout.className)}
        >
          <p className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold text-fg">
            {callout.icon}
            {title || callout.title}
          </p>
          <div className="text-[14px]">{children}</div>
        </div>
      );
    },
    div(props) {
      const { node: _node, children, ...rest } = props;
      const tabs = (rest as Record<string, unknown>)["data-code-tabs"];
      if (typeof tabs === "string") {
        const parsed = JSON.parse(tabs) as CodeTab[];
        return (
          <CodeTabs
            className="doc-code"
            tabs={parsed}
            placeholders={parsed.every((t) => t.language === "json") ? [] : DOC_PLACEHOLDERS}
          />
        );
      }
      if ("data-stele-networks" in rest)
        return context ? <Networks networks={context.networks} /> : null;
      return <div {...rest}>{children}</div>;
    },
    img({ alt }) {
      // Documentation images are not loaded (keeps the CSP tight); show their description.
      return <span className="text-fg-subtle">[{alt ?? "image"}]</span>;
    },
  };

  return (
    <div className="prose-stele">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCallouts, remarkDocBlocks]}
        components={components}
        skipHtml
      >
        {fillIn(markdown, context)}
      </ReactMarkdown>
    </div>
  );
}
