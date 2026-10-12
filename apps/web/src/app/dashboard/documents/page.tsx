"use client";

import Link from "next/link";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@stelehq/protocol";
import { Badge, EmptyState, FileIcon, buttonClasses } from "@stele/ui";
import { LoadingRows, PageHeader, Panel, Table, Td } from "@/components/dashboard/ui";
import { useDashboard } from "@/lib/dashboard";
import { formatDate, formatNumber } from "@/lib/format";
import type { DocumentRow } from "@/lib/types";
import { useApi } from "@/lib/use-api";

export default function DocumentsPage() {
  const { org } = useDashboard();
  const docs = useApi<{ documents: DocumentRow[] }>(
    org ? `/v1/organizations/${org.id}/documents` : null,
  );
  const rows = docs.data?.documents ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Documents"
        description="Each document has an immutable on-chain version history. Publishing a new version never alters earlier ones or the acceptances they received."
        actions={
          <Link href="/dashboard/documents/new" className={buttonClasses("primary", "sm")}>
            New document
          </Link>
        }
      />
      <Panel title="All documents" bodyClassName="p-0 sm:p-0">
        {docs.loading && !docs.data ? (
          <LoadingRows />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<FileIcon className="h-5 w-5" />}
            title="No documents yet"
            description="Create a document (for example your Terms of Service), then publish its first version."
            action={
              <Link href="/dashboard/documents/new" className={buttonClasses("primary", "md")}>
                Create a document
              </Link>
            }
          />
        ) : (
          <Table
            head={["Document", "Current version", "Versions", "Acceptances", "Last published", ""]}
          >
            {rows.map((d) => (
              <tr key={d.id} className="hover:bg-surface-2/40">
                <Td>
                  <Link
                    href={`/dashboard/documents/${d.id}`}
                    className="font-medium text-fg hover:text-accent"
                  >
                    {d.currentVersion?.title ?? d.slug}
                  </Link>
                  <p className="mt-0.5 font-mono text-[11.5px] text-fg-subtle">
                    {d.slug} ·{" "}
                    {DOCUMENT_TYPE_LABELS[d.documentType as DocumentType] ?? d.documentType} ·{" "}
                    {d.locale}
                  </p>
                </Td>
                <Td>
                  {d.currentVersion ? (
                    <Badge tone="accent">{`${d.currentVersion.versionLabel} (#${d.currentVersion.number})`}</Badge>
                  ) : (
                    <Badge>Unpublished</Badge>
                  )}
                </Td>
                <Td>{formatNumber(d.versionCount)}</Td>
                <Td>{formatNumber(d.acceptanceCount)}</Td>
                <Td>{d.currentVersion ? formatDate(d.currentVersion.publishedAt) : "—"}</Td>
                <Td className="text-right">
                  <Link
                    href={`/dashboard/documents/${d.id}`}
                    className="text-[12.5px] text-accent hover:text-accent-strong"
                  >
                    Open
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
