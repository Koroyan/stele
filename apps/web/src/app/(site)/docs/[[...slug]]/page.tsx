import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowRightIcon,
  Card,
  FileIcon,
  GateIcon,
  PlayIcon,
  SearchIcon,
  ShieldIcon,
  buttonClasses,
  cn,
} from "@stele/ui";
import { Markdown, type DocContext } from "@/components/markdown";
import { DOC_GROUPS, DOCS, loadDoc, outline } from "@/lib/docs";
import { getNetworkMenu } from "@/lib/networks";
import { siteOrigin } from "@/lib/origin";

type Params = { slug?: string[] };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const entry = slug?.length ? DOCS.find((d) => d.slug === slug.join("/")) : null;
  return entry ? { title: entry.title, description: entry.summary } : { title: "Documentation" };
}

/** This deployment's address and networks, filled into the samples. */
async function docContext(): Promise<DocContext> {
  const [origin, menu] = await Promise.all([siteOrigin(), getNetworkMenu()]);
  if (!menu)
    return {
      origin,
      testNetwork: false,
      networks: [
        { label: "This Stele app", baseUrl: `${origin}/api/v1`, current: true, test: false },
      ],
    };
  return {
    origin,
    testNetwork: menu.current.test,
    networks: menu.choices.map((c) => ({
      label: c.label,
      baseUrl: c.current ? `${origin}/api/v1` : c.url ? `${c.url}/api/v1` : null,
      current: c.current,
      test: c.test,
    })),
  };
}

/** The four questions most readers arrive with, each answered by one guide. */
const START: { href: string; icon: ReactNode; title: string; body: string; meta: string }[] = [
  {
    href: "/docs/overview",
    icon: <ShieldIcon className="h-5 w-5" />,
    title: "What is Stele?",
    body: "The two products in plain words: prove what was agreed, and enforce what must be agreed.",
    meta: "3-minute read",
  },
  {
    href: "/docs/get-started",
    icon: <FileIcon className="h-5 w-5" />,
    title: "Add Stele Proof to your website",
    body: "Publish your terms, add the acceptance widget, confirm each acceptance from your server.",
    meta: "Copy-paste guide · any language",
  },
  {
    href: "/docs/gate-guide",
    icon: <GateIcon className="h-5 w-5" />,
    title: "Add Stele Gate to your Solana program",
    body: "One call in your program, an “Accept & Continue” window in your app.",
    meta: "Step by step · about 15 minutes",
  },
  {
    href: "/docs/verification",
    icon: <SearchIcon className="h-5 w-5" />,
    title: "Check an agreement",
    body: "Verify a receipt or a transaction yourself, against Solana — without asking Stele.",
    meta: "No account needed",
  },
];

function Sidebar({ active }: { active: string | null }) {
  return (
    <nav aria-label="Documentation" className="space-y-7">
      <Link
        href="/docs"
        className={cn(
          "block text-[13.5px] font-medium",
          active === null ? "text-accent" : "text-fg hover:text-accent",
        )}
      >
        All documentation
      </Link>
      {DOC_GROUPS.map((g) => (
        <div key={g}>
          <p className="text-[11.5px] font-medium uppercase tracking-[0.1em] text-fg-subtle">{g}</p>
          <ul className="mt-3 space-y-1.5 border-l border-line">
            {DOCS.filter((d) => d.group === g).map((d) => (
              <li key={d.slug}>
                <Link
                  href={`/docs/${d.slug}`}
                  aria-current={active === d.slug ? "page" : undefined}
                  className={cn(
                    "-ml-px block border-l py-0.5 pl-3 text-[13.5px] transition-colors",
                    active === d.slug
                      ? "border-accent text-fg"
                      : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export default async function DocsPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const key = slug?.length ? slug.join("/") : null;

  if (key === null) {
    return (
      <div className="mx-auto grid grid-cols-1 max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <Sidebar active={null} />
          </div>
        </aside>
        <div>
          <p className="text-[12.5px] font-medium uppercase tracking-[0.12em] text-accent">
            Documentation
          </p>
          <h1 className="mt-3 text-[34px] font-semibold tracking-[-0.03em] text-fg">
            Where do you want to start?
          </h1>
          <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-fg-muted">
            Pick the question you have. Every guide starts in plain words; the technical detail
            comes after.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {START.map((s) => (
              <Link key={s.href} href={s.href} className="group">
                <Card className="flex h-full flex-col p-5 transition-colors group-hover:border-accent-line sm:p-6">
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent-line bg-accent-soft text-accent"
                    aria-hidden="true"
                  >
                    {s.icon}
                  </span>
                  <p className="mt-4 flex items-start justify-between gap-3 text-[17px] font-semibold text-fg">
                    {s.title}
                    <ArrowRightIcon className="mt-1 h-4 w-4 shrink-0 text-fg-subtle transition-colors group-hover:text-accent" />
                  </p>
                  <p className="mt-1.5 flex-1 text-[14px] leading-relaxed text-fg-muted">
                    {s.body}
                  </p>
                  <p className="mt-4 text-[12.5px] font-medium text-fg-subtle">{s.meta}</p>
                </Card>
              </Link>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <p className="text-[15px] font-semibold text-fg">Prefer to see it first?</p>
              <p className="mt-1 text-[14px] text-fg-muted">
                The live demo takes two minutes — no wallet, no sign-up, no fees.
              </p>
            </div>
            <Link href="/demo" className={buttonClasses("primary", "md", "shrink-0")}>
              <PlayIcon className="h-4 w-4" /> Try the live demo
            </Link>
          </div>

          <h2 className="mt-14 text-[20px] font-semibold tracking-[-0.02em] text-fg">
            All documentation
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2">
            {DOC_GROUPS.map((g) => (
              <section key={g}>
                <h3 className="text-[12px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
                  {g}
                </h3>
                <ul className="mt-3 space-y-3">
                  {DOCS.filter((d) => d.group === g).map((d) => (
                    <li key={d.slug}>
                      <Link href={`/docs/${d.slug}`} className="group block">
                        <span className="text-[14.5px] font-medium text-fg group-hover:text-accent">
                          {d.title}
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-relaxed text-fg-muted">
                          {d.summary}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Stele's own legal documents live on their verified pages.
  if (key === "terms-of-service") redirect("/terms");
  if (key === "privacy-policy") redirect("/privacy");
  const [doc, context] = await Promise.all([loadDoc(key), docContext()]);
  if (!doc) notFound();
  const toc = outline(doc.markdown);

  return (
    <div className="mx-auto grid grid-cols-1 max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_220px]">
      <aside className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100dvh-8rem)] overflow-y-auto pb-8">
          <Sidebar active={doc.entry.slug} />
        </div>
      </aside>
      <article className="min-w-0 max-w-3xl">
        <p className="mb-6 text-[12.5px] text-fg-subtle">
          <Link href="/docs" className="hover:text-fg">
            Docs
          </Link>{" "}
          / {doc.entry.group} / <span className="text-fg-muted">{doc.entry.title}</span>
        </p>
        <Markdown markdown={doc.markdown} file={doc.entry.file} context={context} />
      </article>
      {toc.length > 1 && (
        <aside className="hidden xl:block">
          <div className="sticky top-24 max-h-[calc(100dvh-8rem)] overflow-y-auto">
            <p className="text-[11.5px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
              On this page
            </p>
            <ul className="mt-3 space-y-2">
              {toc.map((h) => (
                <li key={h.id}>
                  <a
                    href={`#${h.id}`}
                    className="block text-[12.5px] leading-snug text-fg-muted hover:text-fg"
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
    </div>
  );
}
