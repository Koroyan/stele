/**
 * Layout of the developers references (SDK, on-chain): a sticky contents list and one card per
 * entry — name, signature, what it does, an example. Each entry has an anchor to link to.
 */
import type { ReactNode } from "react";
import { CodeBlock } from "@stele/ui";

export interface RefEntry {
  name: string;
  /** e.g. "function", "class", "method", "type", "instruction" */
  kind: string;
  signature?: string;
  signatureLanguage?: string;
  description: ReactNode;
  example?: string;
  exampleLanguage?: string;
}

export interface RefGroup {
  id: string;
  title: string;
  intro?: ReactNode;
  /** e.g. the import line for the group. */
  importLine?: string;
  entries: RefEntry[];
  /** Free content after the entries (tables). */
  after?: ReactNode;
}

export const anchorOf = (group: string, name: string) =>
  `${group}-${name.replace(/[^A-Za-z0-9_]+/g, "-").replace(/^-|-$/g, "")}`;

export function Reference({
  title,
  lead,
  groups,
}: {
  title: string;
  lead: ReactNode;
  groups: RefGroup[];
}) {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <nav
          aria-label="Contents"
          className="sticky top-32 max-h-[calc(100dvh-9rem)] space-y-5 overflow-y-auto pb-8"
        >
          {groups.map((g) => (
            <div key={g.id}>
              <a
                href={`#${g.id}`}
                className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-fg-subtle hover:text-fg"
              >
                {g.title}
              </a>
              <ul className="mt-2 space-y-1 border-l border-line">
                {g.entries.map((e) => (
                  <li key={e.name}>
                    <a
                      href={`#${anchorOf(g.id, e.name)}`}
                      className="-ml-px block truncate border-l border-transparent py-0.5 pl-3 font-mono text-[12px] text-fg-muted hover:border-line-strong hover:text-fg"
                    >
                      {e.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <h1 className="text-[30px] font-semibold tracking-[-0.025em] text-fg">{title}</h1>
        <div className="mt-2 max-w-3xl text-[14.5px] leading-relaxed text-fg-muted">{lead}</div>
        {groups.map((g) => (
          <section key={g.id} id={g.id} className="mt-12 scroll-mt-32">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">{g.title}</h2>
            {g.intro && (
              <div className="mt-2 max-w-3xl text-[14px] leading-relaxed text-fg-muted">
                {g.intro}
              </div>
            )}
            {g.importLine && (
              <div className="mt-3">
                <CodeBlock code={g.importLine} language="ts" />
              </div>
            )}
            <div className="mt-5 space-y-4">
              {g.entries.map((e) => (
                <article
                  key={e.name}
                  id={anchorOf(g.id, e.name)}
                  className="scroll-mt-32 rounded-2xl border border-line bg-surface p-5"
                >
                  <p className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-[15px] font-semibold text-fg">{e.name}</span>
                    <span className="rounded-full border border-line px-2 py-px text-[11px] text-fg-subtle">
                      {e.kind}
                    </span>
                  </p>
                  {e.signature && (
                    <div className="mt-3">
                      <CodeBlock code={e.signature} language={e.signatureLanguage ?? "ts"} />
                    </div>
                  )}
                  <div className="mt-3 text-[14px] leading-relaxed text-fg-muted">
                    {e.description}
                  </div>
                  {e.example && (
                    <div className="mt-3">
                      <CodeBlock code={e.example} language={e.exampleLanguage ?? "ts"} />
                    </div>
                  )}
                </article>
              ))}
            </div>
            {g.after && <div className="mt-5">{g.after}</div>}
          </section>
        ))}
      </div>
    </div>
  );
}
