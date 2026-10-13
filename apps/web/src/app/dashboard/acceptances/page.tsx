"use client";
/** Acceptance search. Rows come from the index; each links to a receipt that is re-verified on-chain. */
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Badge, Button, EmptyState, Field, Input, Select } from "@stele/ui";
import { LoadingRows, PageHeader, Panel, Table, Td, TxLink } from "@/components/dashboard/ui";
import { api, errorMessage } from "@/lib/api";
import { useDashboard } from "@/lib/dashboard";
import { formatAtOffset, formatExactUtc, shortAddress } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { DocumentRow } from "@/lib/types";

interface AcceptanceRow {
  acceptanceId: string;
  transactionSignature: string;
  slot: number;
  blockTime: string | null;
  signer: string;
  versionAddress: string;
  versionNumber: number;
  requestDomain: string;
  externalUserRef: string | null;
  commitment: "confirmed" | "finalized";
  documentSlug: string;
  /** Off-chain audit trail recorded with the signature (absent for older acceptances). */
  audit?: { ip: string | null; timeZone: string | null; utcOffsetMinutes: number | null };
}

const PAGE = 50;

function toCsv(rows: AcceptanceRow[]): string {
  const head = [
    "acceptance_id",
    "transaction",
    "slot",
    "block_time",
    "signer",
    "document",
    "version_number",
    "version_account",
    "request_domain",
    "external_user_ref",
    "commitment",
    "signer_ip",
    "signer_time_zone",
    "signer_utc_offset_minutes",
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Neutralize spreadsheet formula injection and quote everything.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [
    head.join(","),
    ...rows.map((r) =>
      [
        r.acceptanceId,
        r.transactionSignature,
        r.slot,
        r.blockTime,
        r.signer,
        r.documentSlug,
        r.versionNumber,
        r.versionAddress,
        r.requestDomain,
        r.externalUserRef,
        r.commitment,
        r.audit?.ip,
        r.audit?.timeZone,
        r.audit?.utcOffsetMinutes,
      ]
        .map(esc)
        .join(","),
    ),
  ].join("\n");
}

export default function AcceptancesPage() {
  const { org } = useDashboard();
  const docs = useApi<{ documents: DocumentRow[] }>(
    org ? `/v1/organizations/${org.id}/documents` : null,
  );
  const [document, setDocument] = useState("");
  const [signer, setSigner] = useState("");
  const [userRef, setUserRef] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<AcceptanceRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function query(before?: string) {
    const qs = new URLSearchParams({ limit: String(PAGE) });
    if (document) qs.set("document", document);
    if (signer.trim()) qs.set("signer", signer.trim());
    if (userRef.trim()) qs.set("externalUserRef", userRef.trim());
    if (from) qs.set("from", new Date(`${from}T00:00:00Z`).toISOString());
    if (to) qs.set("to", new Date(`${to}T23:59:59Z`).toISOString());
    if (before) qs.set("before", before);
    return `/v1/organizations/${org!.id}/acceptances?${qs}`;
  }

  async function search(append = false) {
    if (!org) return;
    setLoading(true);
    setError(null);
    try {
      const last = append ? (rows?.[rows.length - 1]?.blockTime ?? undefined) : undefined;
      const { acceptances } = await api<{ acceptances: AcceptanceRow[] }>(query(last));
      setRows((prev) => (append && prev ? [...prev, ...acceptances] : acceptances));
      setMore(acceptances.length === PAGE);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  // Initial load for the selected organization only; later searches are explicit (the form).
  const orgId = org?.id;
  const searchRef = useRef(search);
  useLayoutEffect(() => {
    searchRef.current = search;
  });
  useEffect(() => {
    if (orgId) void searchRef.current();
  }, [orgId]);

  function exportCsv() {
    if (!rows) return;
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv" }));
    const a = window.document.createElement("a");
    a.href = url;
    a.download = `stele-acceptances-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Acceptances"
        description="Every acceptance recorded for your documents. The receipt link re-verifies each one against Solana in the browser."
        actions={
          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!rows?.length}>
            Export CSV
          </Button>
        }
      />
      <Panel title="Search">
        <form
          className="grid gap-4 md:grid-cols-3 xl:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <Field label="Document" htmlFor="f-doc">
            <Select id="f-doc" value={document} onChange={(e) => setDocument(e.target.value)}>
              <option value="">All documents</option>
              {docs.data?.documents.map((d) => (
                <option key={d.address} value={d.address}>
                  {d.slug}
                </option>
              ))}
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Signer wallet" htmlFor="f-signer">
              <Input
                id="f-signer"
                value={signer}
                onChange={(e) => setSigner(e.target.value)}
                placeholder="Base58 address"
                className="font-mono text-[12.5px]"
                spellCheck={false}
              />
            </Field>
          </div>
          <Field label="Your user reference" htmlFor="f-ref">
            <Input
              id="f-ref"
              value={userRef}
              onChange={(e) => setUserRef(e.target.value)}
              placeholder="From acceptance sessions"
            />
          </Field>
          <Field label="From (UTC)" htmlFor="f-from">
            <Input id="f-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To (UTC)" htmlFor="f-to">
            <Input id="f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="md:col-span-3 xl:col-span-6">
            <Button type="submit" size="sm" loading={loading}>
              Search
            </Button>
          </div>
        </form>
      </Panel>
      {error && <Alert tone="danger">{error}</Alert>}
      <Panel
        title={rows ? `${rows.length}${more ? "+" : ""} results` : "Results"}
        bodyClassName="p-0 sm:p-0"
      >
        {!rows ? (
          <LoadingRows />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No acceptances match"
            description="Acceptances appear here seconds after users sign."
          />
        ) : (
          <>
            <Table
              head={[
                "Recorded",
                "Signer",
                "IP address",
                "Document",
                "Requested by",
                "User ref",
                "Status",
                "Transaction",
                "",
              ]}
            >
              {rows.map((r) => (
                <tr key={r.acceptanceId}>
                  <Td className="whitespace-nowrap">
                    <span className="block">{formatExactUtc(r.blockTime)}</span>
                    {typeof r.audit?.utcOffsetMinutes === "number" && (
                      <span
                        className="block text-[11.5px] text-fg-subtle"
                        title={r.audit.timeZone ?? undefined}
                      >
                        Signer&apos;s time {formatAtOffset(r.blockTime, r.audit.utcOffsetMinutes)}
                      </span>
                    )}
                  </Td>
                  <Td mono>{shortAddress(r.signer, 5, 5)}</Td>
                  <Td mono>
                    {r.audit?.ip ?? "—"}
                    {r.audit?.timeZone && (
                      <span className="block font-sans text-[11.5px] text-fg-subtle">
                        {r.audit.timeZone}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="text-fg">{r.documentSlug}</span>{" "}
                    <span className="text-fg-subtle">#{r.versionNumber}</span>
                  </Td>
                  <Td mono>{r.requestDomain}</Td>
                  <Td mono>{r.externalUserRef ?? "—"}</Td>
                  <Td>
                    {r.commitment === "finalized" ? (
                      <Badge>Finalized</Badge>
                    ) : (
                      <Badge>Confirmed</Badge>
                    )}
                  </Td>
                  <Td>
                    <TxLink signature={r.transactionSignature} />
                  </Td>
                  <Td className="text-right">
                    <Link
                      href={`/receipt/${r.acceptanceId}`}
                      className="text-[12.5px] text-accent hover:text-accent-strong"
                    >
                      Receipt
                    </Link>
                  </Td>
                </tr>
              ))}
            </Table>
            {more && (
              <div className="border-t border-line px-6 py-3">
                <Button
                  size="sm"
                  variant="ghost"
                  loading={loading}
                  onClick={() => void search(true)}
                >
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
