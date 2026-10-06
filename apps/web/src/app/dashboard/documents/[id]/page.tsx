"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  DOCUMENT_TYPE_LABELS,
  groupedFingerprint,
  type Content,
  type DocumentType,
} from "@stele/protocol";
import {
  Alert,
  Badge,
  Button,
  Card,
  CodeBlock,
  CopyButton,
  Dialog,
  EmptyState,
  Fingerprint,
  PenIcon,
  Select,
  Spinner,
  Tabs,
  buttonClasses,
} from "@stele/ui";
import { ContentView } from "@/components/content-view";
import { DiffView } from "@/components/diff-view";
import { LoadingRows, PageHeader, Panel, TxLink } from "@/components/dashboard/ui";
import { api, errorMessage } from "@/lib/api";
import { addressExplorerUrl } from "@/lib/chain";
import { loadVerifiedContent } from "@/lib/content";
import { formatDate, formatDateTime, formatNumber, relativeTime, shortAddress } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useNetwork } from "@/lib/wallet";
import { DraftEditor } from "./draft-editor";
import { PublishDialog } from "./publish-dialog";
import type { DocDetail, DraftRow, VersionRow } from "./types";

type Tab = "versions" | "drafts" | "compare" | "share";

function VersionText({ version, onClose }: { version: VersionRow | null; onClose: () => void }) {
  const [content, setContent] = useState<Content | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setContent(null);
    setError(null);
    if (version)
      loadVerifiedContent(version.contentHash)
        .then(setContent)
        .catch((e: unknown) => setError(errorMessage(e)));
  }, [version]);
  return (
    <Dialog
      open={version !== null}
      onClose={onClose}
      wide
      title={version ? `${version.title} — version ${version.versionLabel}` : ""}
      description="Hash-verified in your browser against the version's on-chain content commitment."
    >
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : content ? (
        <ContentView content={content} />
      ) : (
        <Spinner className="h-5 w-5 text-accent" />
      )}
    </Dialog>
  );
}

function Versions({ doc }: { doc: DocDetail }) {
  const network = useNetwork();
  const [viewing, setViewing] = useState<VersionRow | null>(null);
  if (doc.versions.length === 0) {
    return (
      <EmptyState
        title="No published versions"
        description="Write a draft and publish it. Users can only accept published versions."
      />
    );
  }
  return (
    <>
      <ol className="relative space-y-4 before:absolute before:bottom-4 before:left-[11px] before:top-4 before:w-px before:bg-line-strong">
        {doc.versions.map((v, i) => {
          const current = v.address === doc.document.currentVersionAddress;
          return (
            <li key={v.address} className="relative flex gap-4">
              <span
                className={`relative z-10 mt-5 h-[23px] w-[23px] shrink-0 rounded-full border-2 ${current ? "border-accent bg-accent-soft" : "border-line-strong bg-surface"}`}
                aria-hidden="true"
              />
              <Card className="min-w-0 flex-1 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[15px] font-semibold text-fg">
                    Version {v.versionLabel}{" "}
                    <span className="font-normal text-fg-subtle">#{v.number}</span>
                  </p>
                  {current ? <Badge tone="accent">Current</Badge> : <Badge>Superseded</Badge>}
                  {current && v.effectiveAt && v.effectiveAt * 1000 > Date.now() && (
                    <Badge tone="warning">Takes effect {formatDate(v.effectiveAt)}</Badge>
                  )}
                  {!v.finalized && <Badge>Not yet finalized</Badge>}
                  <span className="ml-auto text-[12.5px] text-fg-subtle">
                    {formatNumber(v.acceptanceCount)} acceptances
                  </span>
                </div>
                <p className="mt-1 text-[13.5px] text-fg-muted">{v.title}</p>
                <dl className="mt-4 grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2">
                  <div className="flex min-w-0 gap-2">
                    <dt className="shrink-0 text-fg-subtle">Fingerprint</dt>
                    <dd className="min-w-0">
                      <Fingerprint value={v.versionHash} />
                    </dd>
                  </div>
                  <div className="flex min-w-0 gap-2">
                    <dt className="shrink-0 text-fg-subtle">Content</dt>
                    <dd className="min-w-0">
                      <Fingerprint value={v.contentHash} />
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-fg-subtle">Published</dt>
                    <dd className="text-fg-muted">{formatDateTime(v.publishedAt)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-fg-subtle">Effective</dt>
                    <dd className="text-fg-muted">
                      {v.effectiveAt ? formatDateTime(v.effectiveAt) : "Upon publication"}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-fg-subtle">Publisher</dt>
                    <dd className="font-mono text-fg-muted">
                      {shortAddress(v.publisherAddress, 5, 5)}{" "}
                      <span className="font-sans text-fg-subtle">
                        ({v.publisherRole === 1 ? "owner" : "publisher"})
                      </span>
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-fg-subtle">Links to</dt>
                    <dd className="font-mono text-fg-muted">
                      {v.previousVersionHash
                        ? `#${v.number - 1} · ${v.previousVersionHash.slice(0, 10)}…`
                        : "— (first version)"}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-[12.5px]">
                  <button
                    type="button"
                    className="text-accent hover:text-accent-strong"
                    onClick={() => setViewing(v)}
                  >
                    View text
                  </button>
                  <Link
                    href={`/verify?version=${v.address}`}
                    className="text-fg-muted hover:text-fg"
                  >
                    Verify independently
                  </Link>
                  <a
                    href={addressExplorerUrl(network, v.address)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-fg-muted hover:text-fg"
                  >
                    Account
                  </a>
                  <TxLink signature={v.publishTx} label="Publication transaction" />
                  {i === 0 && doc.versions.length > 1 && (
                    <span className="text-fg-subtle">
                      Compare with earlier versions in the Compare tab.
                    </span>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
      <VersionText version={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

function Compare({ doc }: { doc: DocDetail }) {
  const sorted = [...doc.versions].sort((a, b) => a.number - b.number);
  const [from, setFrom] = useState(
    sorted.length > 1 ? sorted[sorted.length - 2]!.number : (sorted[0]?.number ?? 0),
  );
  const [to, setTo] = useState(sorted[sorted.length - 1]?.number ?? 0);
  const [contents, setContents] = useState<{ before: Content; after: Content } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const a = sorted.find((v) => v.number === from);
  const b = sorted.find((v) => v.number === to);

  useEffect(() => {
    setContents(null);
    setError(null);
    if (!a || !b) return;
    Promise.all([loadVerifiedContent(a.contentHash), loadVerifiedContent(b.contentHash)])
      .then(([before, after]) => setContents({ before, after }))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [a, b]);

  if (sorted.length < 2)
    return (
      <EmptyState
        title="Nothing to compare yet"
        description="Comparison becomes available once a document has two or more published versions."
      />
    );
  const meta =
    a && b ? (["title", "versionLabel", "effectiveAt"] as const).filter((k) => a[k] !== b[k]) : [];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[12.5px] text-fg-muted">
          From
          <Select
            className="mt-1 w-48"
            value={from}
            onChange={(e) => setFrom(Number(e.target.value))}
          >
            {sorted.map((v) => (
              <option key={v.number} value={v.number}>
                {v.versionLabel} (#{v.number})
              </option>
            ))}
          </Select>
        </label>
        <label className="text-[12.5px] text-fg-muted">
          To
          <Select className="mt-1 w-48" value={to} onChange={(e) => setTo(Number(e.target.value))}>
            {sorted.map((v) => (
              <option key={v.number} value={v.number}>
                {v.versionLabel} (#{v.number})
              </option>
            ))}
          </Select>
        </label>
      </div>
      {meta.length > 0 && a && b && (
        <Card className="px-5 py-4 text-[13px]">
          <p className="font-medium text-fg">Metadata changes</p>
          <ul className="mt-2 space-y-1 text-fg-muted">
            {meta.map((k) => (
              <li key={k}>
                {k === "versionLabel" ? "Label" : k === "effectiveAt" ? "Effective" : "Title"}:{" "}
                <span className="text-fg-subtle line-through">
                  {k === "effectiveAt"
                    ? a[k]
                      ? formatDateTime(a[k])
                      : "upon publication"
                    : String(a[k])}
                </span>{" "}
                →{" "}
                <span className="text-fg">
                  {k === "effectiveAt"
                    ? b[k]
                      ? formatDateTime(b[k])
                      : "upon publication"
                    : String(b[k])}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : contents && a && b ? (
        <DiffView
          before={contents.before}
          after={contents.after}
          beforeLabel={`Version ${a.versionLabel}`}
          afterLabel={`Version ${b.versionLabel}`}
        />
      ) : (
        <LoadingRows label="Loading and verifying both versions…" />
      )}
    </div>
  );
}

function Share({ doc }: { doc: DocDetail }) {
  const network = useNetwork();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const orgRef = doc.organization.verifiedDomain ?? doc.organization.address;
  const hosted = `${origin}/accept/${orgRef}/${doc.document.slug}`;
  const slug = doc.document.slug;
  const [lang, setLang] = useState<"html" | "react" | "server">("html");
  const snippets = {
    html: {
      language: "html",
      code: `<div
  data-stele-organization="${orgRef}"
  data-stele-document="${slug}"
></div>

<script src="${origin}/sdk/v1/stele.js" defer></script>`,
    },
    react: {
      language: "tsx",
      code: `"use client";

import { TermsAcceptance } from "@stele/sdk/react";

export function Terms() {
  return (
    <TermsAcceptance
      apiBaseUrl="${origin}/api"
      appUrl="${origin}"
      organization="${orgRef}"
      document="${slug}"
      onAccepted={(result) => console.log(result.acceptanceId)}
    />
  );
}`,
    },
    server: {
      language: "ts",
      code: `// .env: STELE_API_URL=${origin}/api and STELE_API_KEY (API keys page)
import { SteleServerClient } from "@stele/sdk/server";

const stele = new SteleServerClient({
  apiBaseUrl: process.env.STELE_API_URL!,
  apiKey: process.env.STELE_API_KEY!,
});

// Link the acceptance to your user (pass sessionToken to the widget):
const { sessionToken } = await stele.createAcceptanceSession({
  document: "${slug}",
  externalUserRef: user.id,
});

// Has this user accepted the current version?
const accepted = await stele.hasAcceptedLatest(user.id, "${slug}");`,
    },
  } as const;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel
        title="Hosted acceptance page"
        description="Send users here, or open it from your app. The page verifies the text against Solana before showing it."
      >
        <div className="flex items-center gap-2 rounded-lg border border-line bg-bg-raised px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg">{hosted}</span>
          <CopyButton value={hosted} label="Copy link" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={hosted}
            target="_blank"
            rel="noreferrer noopener"
            className={buttonClasses("secondary", "sm")}
          >
            Open page
          </a>
          {doc.document.currentVersionAddress && (
            <Link
              href={`/verify?version=${doc.document.currentVersionAddress}`}
              className={buttonClasses("ghost", "sm")}
            >
              Verify current version
            </Link>
          )}
        </div>
        {!doc.organization.verifiedDomain && (
          <Alert tone="warning" className="mt-4">
            Users will see “unverified organization” until you verify a domain.
          </Alert>
        )}
      </Panel>
      <Panel
        title="Embed on your site"
        description="Ready to paste: these samples already contain this document's values. Visitors read it on your page and sign with their own wallet."
      >
        <Tabs
          value={lang}
          onChange={setLang}
          items={[
            { value: "html", label: "HTML" },
            { value: "react", label: "React" },
            { value: "server", label: "Server" },
          ]}
          className="mb-4"
        />
        <CodeBlock code={snippets[lang].code} language={snippets[lang].language} />
        <dl className="mt-4 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12.5px]">
          <dt className="text-fg-subtle">Organization</dt>
          <dd className="truncate font-mono text-fg">{orgRef}</dd>
          <dt className="text-fg-subtle">Document slug</dt>
          <dd className="truncate font-mono text-fg">{slug}</dd>
          <dt className="text-fg-subtle">Network</dt>
          <dd className="text-fg">{network.label}</dd>
          <dt className="text-fg-subtle">Program ID</dt>
          <dd className="truncate font-mono text-fg">{network.programId}</dd>
          <dt className="text-fg-subtle">Chain ID</dt>
          <dd className="truncate font-mono text-fg">{network.chainId}</dd>
        </dl>
        <p className="mt-4 text-[13px] text-fg-muted">
          Step-by-step guide, webhooks and local testing:{" "}
          <Link href="/docs/get-started" className="text-accent hover:text-accent-strong">
            Get started
          </Link>
          .
        </p>
      </Panel>
    </div>
  );
}

export default function DocumentPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(search.get("draft") === "new" ? "drafts" : "versions");
  const [editing, setEditing] = useState<DraftRow | "new" | null>(
    search.get("draft") === "new" ? "new" : null,
  );
  const [publishing, setPublishing] = useState<DraftRow | null>(null);
  const q = useApi<DocDetail>(`/v1/documents/${params.id}`);
  const doc = q.data;

  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (!doc) return <LoadingRows label="Loading document…" />;

  const current = doc.versions.find((v) => v.address === doc.document.currentVersionAddress);
  const drafts = doc.drafts.filter((d) => d.status !== "published");

  return (
    <div className="space-y-6">
      <PageHeader
        title={current?.title ?? doc.document.slug}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono">{doc.document.slug}</span>·
            <span>
              {DOCUMENT_TYPE_LABELS[doc.document.documentType as DocumentType] ??
                doc.document.documentType}
            </span>
            ·<span>{doc.document.locale}</span>·<span>{doc.document.versionCount} versions</span>
            {current && (
              <>
                ·
                <span className="font-mono text-[12px]">
                  {groupedFingerprint(current.versionHash).slice(0, 19)}…
                </span>
              </>
            )}
          </span>
        }
        actions={
          <Button
            size="sm"
            onClick={() => {
              setTab("drafts");
              setEditing("new");
            }}
          >
            <PenIcon className="h-4 w-4" /> New version
          </Button>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => {
          setTab(t);
          if (t !== "drafts") setEditing(null);
        }}
        items={[
          { value: "versions", label: `History (${doc.versions.length})` },
          { value: "drafts", label: `Drafts (${drafts.length})` },
          { value: "compare", label: "Compare" },
          { value: "share", label: "Share & embed" },
        ]}
      />

      {tab === "versions" && <Versions doc={doc} />}
      {tab === "compare" && <Compare doc={doc} />}
      {tab === "share" && <Share doc={doc} />}
      {tab === "drafts" &&
        (editing ? (
          <DraftEditor
            doc={doc}
            draft={editing === "new" ? null : editing}
            onCancel={() => {
              setEditing(null);
              router.replace(`/dashboard/documents/${doc.document.id}`);
            }}
            onSaved={(d) => {
              setEditing(null);
              q.reload();
              setPublishing(d);
              router.replace(`/dashboard/documents/${doc.document.id}`);
            }}
          />
        ) : drafts.length === 0 ? (
          <EmptyState
            title="No drafts"
            description="Drafts are private working copies — they are not evidence until you publish them."
            action={<Button onClick={() => setEditing("new")}>Write a new version</Button>}
          />
        ) : (
          <div className="space-y-3">
            {drafts.map((d) => (
              <Card key={d.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-fg">
                    {d.title}{" "}
                    <span className="font-mono text-[12.5px] text-fg-subtle">{d.versionLabel}</span>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-fg-subtle">
                    {d.status === "prepared" ? "Prepared for publication" : "Draft"} · updated{" "}
                    {relativeTime(d.updatedAt)}
                    {d.effectiveAt ? ` · effective ${formatDateTime(d.effectiveAt)}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void api(`/v1/drafts/${d.id}/abandon`, { method: "POST" }).then(() =>
                        q.reload(),
                      );
                    }}
                  >
                    Discard
                  </Button>
                  <Button size="sm" onClick={() => setPublishing(d)}>
                    Review &amp; publish
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ))}

      {publishing && (
        <PublishDialog
          doc={doc}
          draft={publishing}
          open
          onClose={() => setPublishing(null)}
          onPublished={() => {
            q.reload();
            setTab("versions");
          }}
        />
      )}
    </div>
  );
}
