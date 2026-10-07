"use client";
/** Program integration: a guided setup from program ID to a tested require_current() check. */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { isAddress } from "@solana/kit";
import { Alert, Badge, Button, CodeBlock, Field, Input, Select, cn } from "@stele/ui";
import {
  EnableGate,
  GateTabs,
  documentTitle,
  savePolicy,
  type GateOverview,
  type ProbeReport,
} from "@/components/dashboard/gate";
import { PageHeader, Panel, SigningAs, TxStatus, useTransaction } from "@/components/dashboard/ui";
import { api, errorMessage } from "@/lib/api";
import { useDashboard, type WalletAuthority } from "@/lib/dashboard";
import { shortAddress } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useNetwork, useWallet } from "@/lib/wallet";
import { ProbeResults } from "../testing/probe-results";

const STEPS = [
  "Register program",
  "Choose policy",
  "Required version",
  "Frontend",
  "On-chain",
  "Test",
  "Ready",
];

function frontendCode(policy: string, action: string) {
  return `import { createSteleGate } from "@stele/sdk";

const stele = createSteleGate({ apiBaseUrl: "${typeof window === "undefined" ? "" : window.location.origin}/api", wallet });

await stele.gate({
  policy: "${policy}",
  action: () => send${action.charAt(0).toUpperCase()}${action.slice(1)}Transaction(),
  acceptLabel: "Accept & Continue",
});`;
}

function onchainCode(policy: string, action: string) {
  return `// Cargo.toml: stele-gate = { path = "crates/stele-gate" }
use anchor_lang::prelude::*;

/// The Stele policy this program requires.
pub const POLICY: Pubkey = pubkey!("${policy}");

#[derive(Accounts)]
pub struct Protected<'info> {
    pub user: Signer<'info>,
    /// CHECK: pinned; verified by require_current
    #[account(address = POLICY)]
    pub policy: UncheckedAccount<'info>,
    /// CHECK: verified by require_current
    pub access_pass: UncheckedAccount<'info>,
    // … your accounts
}

pub fn ${action}(ctx: Context<Protected>) -> Result<()> {
    stele_gate::require_current(
        &ctx.accounts.access_pass,
        &ctx.accounts.policy,
        &ctx.accounts.user,
    )?;
    // … the protected action
    Ok(())
}`;
}

export default function GateProgramsPage() {
  const { detail, authorityOf } = useDashboard();
  const network = useNetwork();
  const wallet = useWallet();
  const orgId = detail?.organization.id;
  const enabled = detail?.organization.settings.products?.gate === true;
  const overview = useApi<GateOverview>(
    orgId && enabled ? `/v1/organizations/${orgId}/gate` : null,
  );
  const [authority, setAuthority] = useState<WalletAuthority | null>(null);
  useEffect(() => {
    void authorityOf(wallet.address).then(setAuthority);
  }, [authorityOf, wallet.address]);

  const [step, setStep] = useState(0);
  const [programAddress, setProgramAddress] = useState("");
  const [label, setLabel] = useState("");
  const [action, setAction] = useState("deposit");
  const [documentId, setDocumentId] = useState("");
  const [programId, setProgramId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ProbeReport | null>(null);
  const tx = useTransaction();

  const policies = useMemo(
    () => overview.data?.documents.filter((d) => d.policy) ?? [],
    [overview.data],
  );
  const doc = overview.data?.documents.find((d) => d.id === documentId) ?? null;
  useEffect(() => {
    if (!documentId && policies[0]) setDocumentId(policies[0].id);
  }, [documentId, policies]);

  if (!detail) return null;
  const canAdmin = detail.role === "owner" || detail.role === "admin";
  const addressError =
    programAddress && !isAddress(programAddress.trim()) ? "Not a valid Solana address." : null;

  async function register() {
    setBusy(true);
    setError(null);
    try {
      const { program } = await api<{ program: { id: string } }>(
        `/v1/organizations/${orgId}/gate/programs`,
        {
          body: {
            programAddress: programAddress.trim(),
            label: label.trim() || "Protected program",
            action: action.trim(),
            policyDocumentId: documentId,
          },
        },
      );
      setProgramId(program.id);
      overview.reload();
      setStep(2);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setError(null);
    try {
      setReport(
        await api<ProbeReport>(`/v1/organizations/${orgId}/gate/programs/${programId}/test`, {
          method: "POST",
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Program integration"
        description="Connect a Solana program to a Stele policy: the SDK handles acceptance in your frontend, and one require_current() call in your program enforces it."
      />
      {!enabled ? (
        <EnableGate />
      ) : (
        <>
          <GateTabs />
          <ol className="mt-6 flex flex-wrap gap-2" aria-label="Integration steps">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => i <= step && setStep(i)}
                  aria-current={i === step ? "step" : undefined}
                  disabled={i > step}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                    i === step
                      ? "border-accent-line bg-accent-soft text-fg"
                      : i < step
                        ? "border-verified-line text-verified"
                        : "border-line text-fg-subtle",
                  )}
                >
                  {i < step ? "✓ " : `${i + 1}. `}
                  {s}
                </button>
              </li>
            ))}
          </ol>

          {error && (
            <Alert tone="danger" className="mt-5">
              {error}
            </Alert>
          )}

          {step === 0 && (
            <Panel className="mt-5" title="1. Register your Solana program">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Program ID" htmlFor="program" error={addressError}>
                  <Input
                    id="program"
                    value={programAddress}
                    onChange={(e) => setProgramAddress(e.target.value)}
                    placeholder="Your program's address"
                    className="font-mono text-[13px]"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Name" htmlFor="label">
                  <Input
                    id="label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Atlas Real Estate Vault"
                  />
                </Field>
                <Field label="Protected instruction" htmlFor="action">
                  <Input
                    id="action"
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                    className="font-mono text-[13px]"
                  />
                </Field>
              </div>
              {overview.data && (
                <p className="mt-3 text-[12.5px] text-fg-subtle">
                  Trying it out? The Stele demo vault is{" "}
                  <button
                    type="button"
                    className="font-mono text-accent"
                    onClick={() => {
                      setProgramAddress(overview.data!.demoProgram);
                      setLabel("Atlas Real Estate Vault (demo)");
                      setAction("deposit");
                    }}
                  >
                    {shortAddress(overview.data.demoProgram, 6, 6)}
                  </button>
                  .
                </p>
              )}
              <Button
                className="mt-4"
                disabled={!programAddress.trim() || !!addressError || !action.trim()}
                onClick={() => setStep(1)}
              >
                Continue
              </Button>
            </Panel>
          )}

          {step === 1 && (
            <Panel className="mt-5" title="2. Choose the Stele policy it requires">
              {policies.length === 0 ? (
                <Alert tone="warning">
                  No policy yet. Create one for the document your program requires —{" "}
                  <Link href="/dashboard/gate/policies" className="text-accent">
                    Policies
                  </Link>
                  .
                </Alert>
              ) : (
                <>
                  <Field label="Policy" htmlFor="policy">
                    <Select
                      id="policy"
                      value={documentId}
                      onChange={(e) => setDocumentId(e.target.value)}
                    >
                      {policies.map((d) => (
                        <option key={d.id} value={d.id}>
                          {documentTitle(d)} — requires v{d.policy!.requiredVersion}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {!canAdmin && (
                    <Alert tone="warning" className="mt-3">
                      Only the owner or an admin can register a program.
                    </Alert>
                  )}
                  <Button
                    className="mt-4"
                    onClick={() => void register()}
                    loading={busy}
                    disabled={!canAdmin || !documentId}
                  >
                    Register program
                  </Button>
                </>
              )}
            </Panel>
          )}

          {step === 2 && doc?.policy && (
            <Panel className="mt-5" title="3. The current required version">
              <p className="text-[14px] text-fg-muted">
                <span className="font-semibold text-fg">{documentTitle(doc)}</span>: the policy
                requires <Badge tone="verified">v{doc.policy.requiredVersion}</Badge> · latest
                published v{doc.versionCount}.
              </p>
              {doc.versionCount > doc.policy.requiredVersion && (
                <div className="mt-4 space-y-3">
                  <Alert tone="warning">
                    v{doc.versionCount} is published but not required. Requiring it makes older
                    passes insufficient.
                  </Alert>
                  <SigningAs />
                  <Button
                    variant="secondary"
                    loading={tx.pending}
                    disabled={!authority?.canCreateDocument}
                    onClick={() =>
                      void savePolicy(tx, {
                        programId: network.programId,
                        organizationId: detail.organization.id,
                        organization: detail.organization.address,
                        document: doc.address,
                        versionNumber: doc.versionCount,
                        exists: true,
                        authority: authority!,
                      }).then((ok) => ok && overview.reload())
                    }
                  >
                    Require v{doc.versionCount}
                  </Button>
                  <TxStatus tx={tx} />
                </div>
              )}
              <Button className="mt-4" onClick={() => setStep(3)}>
                Continue
              </Button>
            </Panel>
          )}

          {step === 3 && doc?.policy && (
            <Panel
              className="mt-5"
              title="4. Frontend integration (user experience)"
              description="Wrap the transaction you already send. The modal appears only when the wallet's pass is missing or outdated."
            >
              <CodeBlock code={frontendCode(doc.policy.address, action)} language="ts" />
              <Button className="mt-4" onClick={() => setStep(4)}>
                Continue
              </Button>
            </Panel>
          )}

          {step === 4 && doc?.policy && (
            <Panel
              className="mt-5"
              title="5. On-chain integration (enforcement)"
              description="Add the policy and the AccessPass to your instruction and call require_current(). This is what rejects direct calls."
            >
              <CodeBlock code={onchainCode(doc.policy.address, action)} language="rust" />
              <Button className="mt-4" onClick={() => setStep(5)}>
                Continue
              </Button>
            </Panel>
          )}

          {step === 5 && (
            <Panel
              className="mt-5"
              title="6. Test"
              description="Missing pass → reject · current pass → success · old pass → reject · direct call with someone else's pass → reject."
            >
              <Button onClick={() => void runTest()} loading={busy} disabled={!programId}>
                Run the checks
              </Button>
              {report && (
                <div className="mt-5">
                  <ProbeResults report={report} />
                </div>
              )}
              <Button className="mt-5" variant="secondary" onClick={() => setStep(6)}>
                Continue
              </Button>
            </Panel>
          )}

          {step === 6 && (
            <Panel className="mt-5" title="7. Integration ready">
              <p className="text-[14px] leading-relaxed text-fg-muted">
                Your program is registered against the policy. Deploy the on-chain check, keep the
                tests in your suite, and watch allowed and rejected calls on the{" "}
                <Link href="/dashboard/gate" className="text-accent">
                  Gate overview
                </Link>
                .
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/dashboard/gate" className="inline-flex">
                  <Button>Open the overview</Button>
                </Link>
                <Link href="/dashboard/gate/testing" className="inline-flex">
                  <Button variant="secondary">Testing</Button>
                </Link>
              </div>
            </Panel>
          )}

          <Panel className="mt-6" title="Registered programs" bodyClassName="px-0 py-0">
            {(overview.data?.programs.length ?? 0) === 0 ? (
              <p className="px-6 py-6 text-[13px] text-fg-muted">None yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {overview.data!.programs.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
                  >
                    <div>
                      <p className="text-[14px] font-medium text-fg">
                        {p.label} {p.isDemo && <Badge tone="accent">demo</Badge>}
                      </p>
                      <p className="font-mono text-[12px] text-fg-subtle">
                        {p.programAddress} · {p.action}()
                      </p>
                    </div>
                    {canAdmin && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void api(`/v1/organizations/${orgId}/gate/programs/${p.id}`, {
                            method: "DELETE",
                          })
                            .then(overview.reload)
                            .catch((e: unknown) => setError(errorMessage(e)))
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
