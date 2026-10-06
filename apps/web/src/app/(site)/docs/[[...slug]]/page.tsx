import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRightIcon, Card, cn } from "@stele/ui";
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
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[220px_1fr]">
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
            Stele documentation
          </h1>
          <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-fg-muted">
            How Stele works, how to add verifiable acceptance to your site, how anyone can check the
            evidence, and the open protocol and security design behind it.
          </p>
          {DOC_GROUPS.map((g) => (
            <section key={g} className="mt-10">
              <h2 className="text-[13px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
                {g}
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {DOCS.filter((d) => d.group === g).map((d) => (
                  <Link key={d.slug} href={`/docs/${d.slug}`} className="group">
                    <Card className="h-full p-5 transition-colors group-hover:border-accent-line">
                      <p className="flex items-center justify-between text-[15px] font-semibold text-fg">
                        {d.title}
                        <ArrowRightIcon className="h-4 w-4 text-fg-subtle transition-colors group-hover:text-accent" />
                      </p>
                      <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">
                        {d.summary}
                      </p>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  const [doc, context] = await Promise.all([loadDoc(key), docContext()]);
  if (!doc) notFound();
  const toc = outline(doc.markdown);

  return (
    <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_220px]">
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
