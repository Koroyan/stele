"use client";
/** AccessPasses of this organization's Gate policies (an index of the on-chain accounts). */
import Link from "next/link";
import { useState } from "react";
import { Alert, Badge, Select } from "@stele/ui";
import {
  EnableGate,
  GateTabs,
  documentTitle,
  type GateOverview,
} from "@/components/dashboard/gate";
import { LoadingRows, PageHeader, Panel, Table, Td, TxLink } from "@/components/dashboard/ui";
import { useDashboard } from "@/lib/dashboard";
import { formatDateTime, shortAddress } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface PassRow {
  address: string;
  holder: string;
  document: { id: string; address: string; slug: string };
  versionNumber: number;
  versionHash: string | null;
  requiredVersion: number;
  status: "current" | "outdated";
  acceptanceId: string;
  acceptanceCount: number;
  acceptedAt: string;
  firstAcceptedAt: string;
  txSignature: string;
}

export default function GatePassesPage() {
  const { detail } = useDashboard();
  const orgId = detail?.organization.id;
  const enabled = detail?.organization.settings.products?.gate === true;
  const [documentId, setDocumentId] = useState("");
  const [status, setStatus] = useState<"" | "current" | "outdated">("");
  const overview = useApi<GateOverview>(
    orgId && enabled ? `/v1/organizations/${orgId}/gate` : null,
  );
  const query = new URLSearchParams({ limit: "200" });
  if (documentId) query.set("documentId", documentId);
  if (status) query.set("status", status);
  const passes = useApi<{ passes: PassRow[] }>(
    orgId && enabled ? `/v1/organizations/${orgId}/gate/passes?${query}` : null,
  );
  if (!detail) return null;
  const policies = overview.data?.documents.filter((d) => d.policy) ?? [];

  return (
    <>
      <PageHeader
        title="AccessPasses"
        description="One pass per wallet and document, created by a verified acceptance and advanced by each newer one. A pass satisfies a policy while it names the required version or a later one."
      />
      {!enabled ? (
        <EnableGate />
      ) : (
        <>
          <GateTabs />
          <Panel
            className="mt-6"
            title="Passes"
            description="Read from the index of on-chain AccessPassUpdated events; your program reads the accounts on Solana."
            actions={
              <div className="flex flex-wrap gap-2">
                <Select
                  aria-label="Document"
                  value={documentId}
                  onChange={(e) => setDocumentId(e.target.value)}
                  className="w-48"
                >
                  <option value="">All policies</option>
                  {policies.map((d) => (
                    <option key={d.id} value={d.id}>
                      {documentTitle(d)}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                  className="w-40"
                >
                  <option value="">Any status</option>
                  <option value="current">Satisfies policy</option>
                  <option value="outdated">Outdated</option>
                </Select>
              </div>
            }
            bodyClassName="px-0 py-0"
          >
            {passes.error && (
              <Alert tone="danger" className="m-5">
                {passes.error.message}
              </Alert>
            )}
            {passes.loading && !passes.data ? (
              <LoadingRows />
            ) : (passes.data?.passes.length ?? 0) === 0 ? (
              <p className="px-6 py-6 text-[13px] text-fg-muted">
                No AccessPass yet. A pass is created the first time a wallet accepts a document that
                has a policy —{" "}
                <Link href="/dashboard/gate/policies" className="text-accent">
                  Policies
                </Link>
                .
              </p>
            ) : (
              <Table
                head={[
                  "Wallet",
                  "Document",
                  "Accepted",
                  "Required",
                  "Status",
                  "Acceptances",
                  "Last accepted",
                  "Receipt",
                  "Transaction",
                ]}
              >
                {passes.data!.passes.map((p) => (
                  <tr key={p.address}>
                    <Td mono>{shortAddress(p.holder, 5, 5)}</Td>
                    <Td>{p.document.slug}</Td>
                    <Td>v{p.versionNumber}</Td>
                    <Td>v{p.requiredVersion}</Td>
                    <Td>
                      <Badge tone={p.status === "current" ? "verified" : "warning"}>
                        {p.status === "current" ? "Satisfies policy" : "Outdated"}
                      </Badge>
                    </Td>
                    <Td>{p.acceptanceCount}</Td>
                    <Td>{formatDateTime(p.acceptedAt)}</Td>
                    <Td>
                      <Link href={`/receipt/${p.acceptanceId}`} className="text-accent">
                        Receipt
                      </Link>
                    </Td>
                    <Td>
                      <TxLink signature={p.txSignature} />
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
