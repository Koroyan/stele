"use client";
/**
 * Gate policies: which version of each document a protected action requires. Creating a policy or
 * changing its requirement is an on-chain transaction signed by the organization's wallet.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Select } from "@stele/ui";
import {
  EnableGate,
  GateTabs,
  documentTitle,
  savePolicy,
  type GateOverview,
} from "@/components/dashboard/gate";
import {
  LoadingRows,
  PageHeader,
  Panel,
  RoleNotice,
  SigningAs,
  TxStatus,
  useTransaction,
} from "@/components/dashboard/ui";
import { useDashboard, type WalletAuthority } from "@/lib/dashboard";
import { formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useNetwork, useWallet } from "@/lib/wallet";

function PolicyRow({
  doc,
  authority,
  onSaved,
}: {
  doc: GateOverview["documents"][number];
  authority: WalletAuthority | null;
  onSaved: () => void;
}) {
  const network = useNetwork();
  const { detail } = useDashboard();
  const tx = useTransaction();
  const latest = doc.versionCount;
  const [version, setVersion] = useState(latest);
  useEffect(
    () => setVersion(doc.policy ? Math.max(doc.policy.requiredVersion, latest) : latest),
    [doc.policy, latest],
  );
  const canSign = Boolean(authority?.canCreateDocument);
  const unchanged = doc.policy?.requiredVersion === version;

  async function save() {
    if (!authority || !detail) return;
    const ok = await savePolicy(tx, {
      programId: network.programId,
      organizationId: detail.organization.id,
      organization: detail.organization.address,
      document: doc.address,
      versionNumber: version,
      exists: Boolean(doc.policy),
      authority,
    });
    if (ok) onSaved();
  }

  return (
    <div className="border-b border-line px-5 py-5 last:border-b-0 sm:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-fg">{documentTitle(doc)}</p>
          <p className="mt-0.5 font-mono text-[11.5px] text-fg-subtle">{doc.slug}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {doc.policy ? (
              <>
                <Badge tone="verified">Policy · requires v{doc.policy.requiredVersion}</Badge>
                {latest > doc.policy.requiredVersion && (
                  <Badge tone="warning">v{latest} published, not required yet</Badge>
                )}
              </>
            ) : (
              <Badge>No policy</Badge>
            )}
            <Badge>
              {doc.passes.current} current · {doc.passes.outdated} outdated passes
            </Badge>
          </div>
          {doc.policy && (
            <p className="mt-2 text-[12px] text-fg-subtle">
              Policy {doc.policy.address} · updated {formatDateTime(doc.policy.updatedAt)}
            </p>
          )}
        </div>
        {latest > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <label htmlFor={`v-${doc.id}`} className="text-[12.5px] text-fg-muted">
              Require
            </label>
            <Select
              id={`v-${doc.id}`}
              value={String(version)}
              onChange={(e) => setVersion(Number(e.target.value))}
              className="w-28"
            >
              {Array.from({ length: latest }, (_, i) => latest - i).map((n) => (
                <option key={n} value={n}>
                  v{n}
                  {n === latest ? " (latest)" : ""}
                </option>
              ))}
            </Select>
            <Button
              onClick={() => void save()}
              disabled={!canSign || unchanged || tx.pending}
              loading={tx.pending}
            >
              {doc.policy ? "Require this version" : "Create policy"}
            </Button>
          </div>
        )}
      </div>
      {doc.policy && !unchanged && version > doc.policy.requiredVersion && (
        <Alert tone="warning" className="mt-3">
          Requiring v{version} makes every pass for an older version insufficient: those wallets
          must accept v{version} before their next protected action. Their earlier acceptances stay
          on record.
        </Alert>
      )}
      <div className="mt-3">
        <TxStatus tx={tx} />
      </div>
    </div>
  );
}

export default function GatePoliciesPage() {
  const { detail, authorityOf } = useDashboard();
  const wallet = useWallet();
  const [authority, setAuthority] = useState<WalletAuthority | null>(null);
  useEffect(() => {
    void authorityOf(wallet.address).then(setAuthority);
  }, [authorityOf, wallet.address]);
  const orgId = detail?.organization.id;
  const enabled = detail?.organization.settings.products?.gate === true;
  const overview = useApi<GateOverview>(
    orgId && enabled ? `/v1/organizations/${orgId}/gate` : null,
  );
  if (!detail) return null;
  const published = overview.data?.documents.filter((d) => d.versionCount > 0) ?? [];

  return (
    <>
      <PageHeader
        title="Policies"
        description="A policy says which version of a document a protected action requires. Publishing a new version doesn't change it until you require that version here."
      />
      {!enabled ? (
        <EnableGate />
      ) : (
        <>
          <GateTabs />
          <div className="mt-6 space-y-4">
            <RoleNotice allowed={Boolean(authority?.canCreateDocument) || !wallet.address}>
              The connected wallet is not the owner, an admin or a publisher of this organization.
            </RoleNotice>
            <SigningAs need="SOL for the policy account's rent (≈0.002 SOL)" />
            <Panel
              title="Documents"
              description="Create a policy for the document your program requires, then pin the policy address in your program."
              bodyClassName="px-0 py-0"
            >
              {overview.loading && !overview.data ? (
                <LoadingRows />
              ) : published.length === 0 ? (
                <p className="px-6 py-6 text-[13px] text-fg-muted">
                  Publish a document first (for example your offering terms) —{" "}
                  <Link href="/dashboard/documents" className="text-accent">
                    Documents
                  </Link>
                  .
                </p>
              ) : (
                published.map((d) => (
                  <PolicyRow key={d.id} doc={d} authority={authority} onSaved={overview.reload} />
                ))
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
