"use client";
/**
 * Stele Gate in the dashboard: shared types, the section navigation and the policy transaction.
 * Policies live on-chain and are created or changed by the organization's own wallet; the API only
 * mirrors them. Nothing here grants access — the protected program checks the AccessPass itself.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { address } from "@solana/kit";
import {
  createPolicyInstruction,
  findConfigPda,
  findPolicyPda,
  findVersionPda,
  setPolicyRequirementInstruction,
} from "@stele/protocol";
import { useState } from "react";
import { Alert, Button, Card, EmptyState, GateIcon, cn } from "@stele/ui";
import { api, errorMessage } from "@/lib/api";
import { useDashboard, type WalletAuthority } from "@/lib/dashboard";
import type { useTransaction } from "./ui";

export interface GateOverview {
  enabled: boolean;
  network: string;
  steleProgram: string;
  demoProgram: string;
  documents: {
    id: string;
    address: string;
    slug: string;
    documentType: string;
    versionCount: number;
    currentVersion: {
      address: string;
      number: number;
      label: string | null;
      title: string | null;
    } | null;
    policy: {
      address: string;
      requiredVersion: number;
      requiredVersionHash: string;
      updatedAt: string;
    } | null;
    passes: { total: number; current: number; outdated: number };
  }[];
  programs: {
    id: string;
    programAddress: string;
    label: string;
    action: string;
    mode: string;
    policyDocumentId: string;
    isDemo: boolean;
    createdAt: string;
  }[];
  recentPasses: {
    holder: string;
    document: string | null;
    versionNumber: number;
    current: boolean;
    acceptedAt: string;
    txSignature: string;
  }[];
}

export interface GateFailure {
  program: string | null;
  code: number | null;
  source: string;
  name: string;
  message: string;
}

export interface ProgramActivity {
  program: string;
  activity: {
    signature: string;
    slot: number;
    blockTime: number | null;
    outcome: "allowed" | "rejected";
    failure: GateFailure | null;
  }[];
  summary: {
    allowed: number;
    rejectedMissing: number;
    rejectedOutdated: number;
    rejectedOther: number;
  };
}

export interface ProbeReport {
  program: string;
  scope: "protected_action" | "policy_requirement";
  network: string;
  results: {
    id: string;
    label: string;
    expect: "reject" | "allow";
    outcome: "passed" | "failed" | "skipped";
    detail: string;
    failure: GateFailure | null;
  }[];
  simulatedAt: string;
}

const TABS = [
  { href: "/dashboard/gate", label: "Overview", exact: true },
  { href: "/dashboard/gate/policies", label: "Policies" },
  { href: "/dashboard/gate/passes", label: "AccessPasses" },
  { href: "/dashboard/gate/programs", label: "Program integration" },
  { href: "/dashboard/gate/testing", label: "Testing" },
];

/** The Gate section's own tabs (also linked from the sidebar). */
export function GateTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Stele Gate" className="mt-5 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-colors",
              active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Creates the document's policy (requiring `versionNumber`) or changes its requirement, signed by
 * the connected wallet, then asks the API to mirror the policy from Solana.
 */
export async function savePolicy(
  tx: ReturnType<typeof useTransaction>,
  i: {
    programId: string;
    organizationId: string;
    organization: string;
    document: string;
    versionNumber: number;
    exists: boolean;
    authority: WalletAuthority;
  },
): Promise<boolean> {
  const program = address(i.programId);
  const document = address(i.document);
  const [policy] = await findPolicyPda(document, program);
  const signature = await tx.run(
    async (signer) => {
      const [config] = await findConfigPda(program);
      const [version] = await findVersionPda(document, i.versionNumber, program);
      const common = {
        programAddress: program,
        authority: signer,
        membership: i.authority.membership,
        config,
        organization: address(i.organization),
        document,
        version,
        policy,
      };
      return [
        i.exists
          ? setPolicyRequirementInstruction(common)
          : createPolicyInstruction({ ...common, payer: signer }),
      ];
    },
    async () => {
      await api(`/v1/organizations/${i.organizationId}/gate/policies/${policy}/refresh`, {
        method: "POST",
      });
    },
  );
  return signature !== null;
}

export function documentTitle(d: GateOverview["documents"][number]): string {
  return d.currentVersion?.title ?? d.slug;
}

/** Shown on Gate pages until the organization enables Stele Gate. */
export function EnableGate() {
  const { detail, reloadDetail, withStepUp } = useDashboard();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!detail) return null;
  const canEdit = detail.role === "owner" || detail.role === "admin";
  return (
    <Card className="mt-6">
      <EmptyState
        icon={<GateIcon className="h-5 w-5" />}
        title="Stele Gate is not enabled for this organization"
        description="Gate is for Solana applications: require the current version of a document before a protected action in your program. Everything in Proof keeps working."
        action={
          <div className="flex flex-col items-center gap-3">
            <Button
              disabled={!canEdit || saving}
              loading={saving}
              onClick={() => {
                setSaving(true);
                setError(null);
                void withStepUp(() =>
                  api(`/v1/organizations/${detail.organization.id}/settings`, {
                    method: "PATCH",
                    body: { products: { gate: true } },
                  }),
                )
                  .then(reloadDetail)
                  .catch((e: unknown) => setError(errorMessage(e)))
                  .finally(() => setSaving(false));
              }}
            >
              Enable Stele Gate
            </Button>
            {!canEdit && (
              <p className="text-[12.5px] text-fg-subtle">
                Only the owner or an admin can enable it.
              </p>
            )}
            {error && <Alert tone="danger">{error}</Alert>}
          </div>
        }
      />
    </Card>
  );
}
