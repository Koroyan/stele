"use client";
/**
 * Program integration, in the order a developer works: choose the policy, add the check to the
 * program, add "Accept & Continue" to the app, deploy and register the program, test it.
 */
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

const STEPS = ["Policy", "Program code", "Frontend", "Register", "Test", "Ready"];

function frontendCode(policy: string, action: string) {
  return `import { createSteleGate } from "@stelehq/sdk";

const stele = createSteleGate({ apiBaseUrl: "${typeof window === "undefined" ? "" : window.location.origin}/api", wallet });

await stele.gate({
  policy: "${policy}",
  action: () => send${action.charAt(0).toUpperCase()}${action.slice(1)}Transaction(),
  acceptLabel: "Accept & Continue",
});`;
}

const CARGO = `[dependencies]
anchor-lang = "1.2"
stele-gate = "1"   # crates.io/crates/stele-gate`;

function onchainCode(policy: string, action: string) {
  return `use anchor_lang::prelude::*;

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
  const addressError = !programAddress
    ? null
    : !isAddress(programAddress.trim())
      ? "Not a valid Solana address."
      : programAddress.trim() === network.programId
        ? "This is the Stele program itself. Enter the address of your own program — the one that runs the protected action — or use the demo vault below."
        : null;

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
      setStep(4);
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
            <Panel
              className="mt-5"
              title="1. Choose the policy your program will require"
              description="A policy names one document and the version a protected action needs. Your program is pinned to its address."
            >
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
                  <div className="grid gap-4 md:grid-cols-2">
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
                    <Field
                      label="Protected instruction"
                      htmlFor="action"
                      hint="The function in your program that needs the terms, e.g. deposit."
                    >
                      <Input
                        id="action"
                        value={action}
                        onChange={(e) => setAction(e.target.value)}
                        className="font-mono text-[13px]"
                      />
                    </Field>
                  </div>
                  {doc?.policy && (
                    <p className="mt-4 text-[14px] text-fg-muted">
                      <span className="font-semibold text-fg">{documentTitle(doc)}</span>: the
                      policy requires <Badge tone="verified">v{doc.policy.requiredVersion}</Badge> ·
                      latest published v{doc.versionCount} · policy{" "}
                      <span className="font-mono text-[12.5px] text-fg">
                        {shortAddress(doc.policy.address, 6, 6)}
                      </span>
                    </p>
                  )}
                  {doc?.policy && doc.versionCount > doc.policy.requiredVersion && (
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
                  <Button
                    className="mt-4"
                    disabled={!doc?.policy || !action.trim()}
                    onClick={() => setStep(1)}
                  >
                    Continue
                  </Button>
                </>
              )}
            </Panel>
          )}

          {step === 1 && doc?.policy && (
            <Panel
              className="mt-5"
              title="2. Add the check to your program"
              description="This is what enforces the terms: a direct call without a current AccessPass fails on-chain, whatever client sent it."
            >
              <p className="text-[13.5px] font-medium text-fg">Cargo.toml</p>
              <div className="mt-2">
                <CodeBlock code={CARGO} language="toml" />
              </div>
              <p className="mt-5 text-[13.5px] font-medium text-fg">
                Your program — already filled in with your policy
              </p>
              <div className="mt-2">
                <CodeBlock code={onchainCode(doc.policy.address, action)} language="rust" />
              </div>
              <ul className="mt-4 space-y-1.5 text-[13px] leading-relaxed text-fg-muted">
                <li>
                  · The policy is pinned with{" "}
                  <code className="font-mono text-fg">address = POLICY</code>: a caller cannot pass
                  a policy of their own.
                </li>
                <li>
                  · Several documents? Use{" "}
                  <code className="font-mono text-fg">stele_gate::require_policies</code> —{" "}
                  <Link href="/docs/gate-guide" className="text-accent">
                    the guide
                  </Link>{" "}
                  shows it, and a Solana Playground version.
                </li>
                <li>
                  · Then build and deploy your program to {network.label} as usual (anchor deploy,
                  or Deploy in Solana Playground) and copy its program ID for step 4.
                </li>
              </ul>
              <Button className="mt-4" onClick={() => setStep(2)}>
                Continue
              </Button>
            </Panel>
          )}

          {step === 2 && doc?.policy && (
            <Panel
              className="mt-5"
              title="3. Add Accept & Continue to your app"
              description="Wrap the transaction you already send. The Stele window appears only when the wallet's pass is missing or outdated; otherwise your action runs right away."
            >
              <CodeBlock code={"npm install @stelehq/sdk"} language="bash" />
              <div className="mt-3">
                <CodeBlock code={frontendCode(doc.policy.address, action)} language="ts" />
              </div>
              <Button className="mt-4" onClick={() => setStep(3)}>
                Continue
              </Button>
            </Panel>
          )}

          {step === 3 && (
            <Panel
              className="mt-5"
              title="4. Register your deployed program"
              description="So this dashboard can test it and show its allowed and refused transactions."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Program ID" htmlFor="program" error={addressError}>
                  <Input
                    id="program"
                    value={programAddress}
                    onChange={(e) => setProgramAddress(e.target.value)}
                    placeholder="Your deployed program's address"
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
              </div>
              {overview.data && (
                <p className="mt-3 text-[12.5px] text-fg-subtle">
                  No program yet? Try it with the Stele demo vault:{" "}
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
              {!canAdmin && (
                <Alert tone="warning" className="mt-3">
                  Only the owner or an admin can register a program.
                </Alert>
              )}
              <Button
                className="mt-4"
                onClick={() => void register()}
                loading={busy}
                disabled={!canAdmin || !documentId || !programAddress.trim() || !!addressError}
              >
                Register program
              </Button>
            </Panel>
          )}

          {step === 4 && (
            <Panel
              className="mt-5"
              title="5. Test"
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
              <Button className="mt-5" variant="secondary" onClick={() => setStep(5)}>
                Continue
              </Button>
            </Panel>
          )}

          {step === 5 && (
            <Panel className="mt-5" title="6. Integration ready">
              <p className="text-[14px] leading-relaxed text-fg-muted">
                Your program is registered against the policy. Keep the four checks in your own test
                suite, and watch allowed and rejected calls on the{" "}
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
