"use client";
/**
 * Stele Gate in the dashboard: shared types, the section navigation and the policy transaction.
 * Policies live on-chain and are created or changed by the organization's own wallet; the API only
 * mirrors them. Nothing here grants access — the protected program checks the wallet's passport itself.
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
} from "@stelehq/protocol";
import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  CheckIcon,
  CodeIcon,
  FileIcon,
  GateIcon,
  PlayIcon,
  TicketIcon,
  buttonClasses,
  cn,
} from "@stele/ui";
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
    probeTemplate: ProbeTemplate | null;
    verification: ProgramVerification | null;
    ownership: { authority: string; signature: string; provenAt: string } | null;
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

/** How the protected instruction is called (Stele Verified). */
export interface ProbeTemplate {
  data: string;
  accounts: {
    role: "user" | "passport" | "accessPass" | "policy" | "address";
    address?: string;
    signer: boolean;
    writable: boolean;
  }[];
}

export interface ProgramVerification {
  status: "verified" | "failed" | "incomplete";
  checks: {
    id: string;
    outcome: "passed" | "failed" | "skipped";
    error: string | null;
    detail: string;
  }[];
  checkedAt: string;
  verifiedSince: string | null;
  program: {
    codeHash: string | null;
    deployedSlot: number | null;
    upgradeAuthority: string | null;
    authorityKind: "immutable" | "program" | "key";
  };
  requiredVersion: number;
  holder?: string | null;
  reason: string | null;
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
  { href: "/dashboard/gate/passes", label: "Accepted wallets" },
  { href: "/dashboard/gate/programs", label: "Program integration" },
  { href: "/dashboard/gate/testing", label: "Testing" },
  { href: "/dashboard/gate/verification", label: "Verification" },
];

/** The Gate section's own tabs (also linked from the sidebar). */
export function GateTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Stele Gate"
      className="mt-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line"
    >
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

const GATE_STEPS = [
  {
    icon: <FileIcon className="h-4 w-4" />,
    title: "You set a policy",
    body: "Pick one of your documents and the version a protected action requires — for example “deposits need Offering Terms v2”.",
  },
  {
    icon: <TicketIcon className="h-4 w-4" />,
    title: "Users accept once",
    body: "A Stele window shows the exact text and the user signs with their wallet — free, Stele pays the fee. Their passport on Solana records the version.",
  },
  {
    icon: <CodeIcon className="h-4 w-4" />,
    title: "Your program checks",
    body: "One call, require_current(), before the action. No pass, an old version or someone else’s pass, and Solana refuses the transaction — whoever sent it.",
  },
];

/** Shown on Gate pages until the organization enables Stele Gate: what it is, then the switch. */
export function EnableGate() {
  const { detail, reloadDetail, withStepUp } = useDashboard();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!detail) return null;
  const canEdit = detail.role === "owner" || detail.role === "admin";
  return (
    <Card className="mt-6 p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent-line bg-accent-soft text-accent"
          aria-hidden="true"
        >
          <GateIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[17px] font-semibold text-fg">
            Make your Solana program require your current terms
          </p>
          <p className="mt-0.5 text-[13.5px] text-fg-muted">
            For vaults, token offerings and permissioned pools. A website only needs Stele Proof.
          </p>
        </div>
      </div>

      <ol className="mt-6 grid gap-3 md:grid-cols-3">
        {GATE_STEPS.map((step, i) => (
          <li key={step.title} className="rounded-xl border border-line bg-surface-2 p-4">
            <p className="flex items-center gap-2 text-[14px] font-semibold text-fg">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-bg/60 text-accent"
                aria-hidden="true"
              >
                {step.icon}
              </span>
              <span>
                <span className="text-fg-subtle">{i + 1}.</span> {step.title}
              </span>
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">{step.body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-col gap-4 border-t border-line pt-6 lg:flex-row lg:items-center lg:justify-between">
        <ul className="space-y-1 text-[13px] text-fg-muted">
          {[
            "Enabling only adds the Gate pages here — nothing is written to Solana.",
            "Everything in Stele Proof keeps working.",
            "You can hide Gate again on the Organization page.",
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-verified" aria-hidden="true" />
              {t}
            </li>
          ))}
        </ul>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href="/demo" className={buttonClasses("secondary", "md")}>
            <PlayIcon className="h-4 w-4" /> See the demo
          </Link>
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
        </div>
      </div>
      {!canEdit && (
        <p className="mt-3 text-[12.5px] text-fg-subtle">
          Only the owner or an admin can enable it.
        </p>
      )}
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
    </Card>
  );
}
