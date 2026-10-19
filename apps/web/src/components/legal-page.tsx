/** The page of one of Stele's own legal documents (/terms, /privacy). */
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Content } from "@stelehq/protocol";
import { LegalDocument, type PublishedLegal } from "@/components/legal-document";
import { Markdown } from "@/components/markdown";
import { loadDoc } from "@/lib/docs";
import { getPublic } from "@/lib/server";

/** The current published version, read server-side so the text is in the HTML. */
async function published(slug: string): Promise<PublishedLegal | null> {
  const platform = await getPublic<{ organization: string | null }>("/v1/public/platform");
  if (!platform?.organization) return null;
  const doc = await getPublic<{
    versions: { number: number; label: string; contentHash: string }[];
  }>(`/v1/public/organizations/${platform.organization}/documents/${slug}`);
  const current = doc?.versions.at(-1);
  if (!current) return null;
  const parsed = await getPublic<{ content: Content }>(
    `/v1/public/content/${current.contentHash}/parsed`,
  );
  return parsed ? { content: parsed.content, label: current.label, number: current.number } : null;
}

export async function LegalPage({
  slug,
  title,
  lead,
}: {
  slug: "terms-of-service" | "privacy-policy";
  title: string;
  lead: string;
}) {
  const source = await loadDoc(slug);
  if (!source) notFound();
  // The repository text starts with its own title; the page shows the title above it.
  const markdown = source.markdown.replace(/^#\s+.*\n+/, "");
  const current = await published(slug);
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <p className="text-[12.5px] font-medium uppercase tracking-[0.12em] text-accent">Legal</p>
      <h1 className="mt-3 text-[34px] font-semibold tracking-[-0.025em] text-fg sm:text-[42px]">
        {title}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">{lead}</p>
      <div className="mt-10">
        <LegalDocument
          slug={slug}
          published={current}
          fallback={
            <div className="prose-stele">
              <Markdown markdown={markdown} file={source.entry.file} />
            </div>
          }
        />
      </div>
      <p className="mt-12 border-t border-line pt-6 text-[13.5px] text-fg-muted">
        Questions?{" "}
        <Link href="/contact" className="text-accent hover:underline">
          Contact us
        </Link>
        . See also the{" "}
        {slug === "terms-of-service" ? (
          <Link href="/privacy" className="text-accent hover:underline">
            Privacy Policy
          </Link>
        ) : (
          <Link href="/terms" className="text-accent hover:underline">
            Terms of Service
          </Link>
        )}
        .
      </p>
    </div>
  );
}
