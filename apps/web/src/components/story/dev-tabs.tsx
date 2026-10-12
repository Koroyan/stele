"use client";

/**
 * Integration code for Stele Gate. Every sample is the real API: @stelehq/sdk (createSteleGate),
 * @stelehq/protocol (findAccessPassPda, findPolicyPda) and the stele-gate crate (require_current), as
 * used by the Atlas vault demo in programs/gate-demo and its tests in programs/stele/tests/gate.rs.
 */
import { useState } from "react";
import { CodeBlock, Tabs, cn } from "@stele/ui";
import { StatusBadge } from "./story-ui";
import { useSequence } from "./use-sequence";

type Tab = "frontend" | "onchain" | "flow" | "testing";

const FRONTEND = `import { createSteleGate } from "@stelehq/sdk";

const stele = createSteleGate({
  apiBaseUrl: "https://stele.site/api",
  // Any Wallet Standard wallet: the key that signs the deposit.
  wallet: {
    address: wallet.publicKey.toBase58(),
    signMessage: (message) => wallet.signMessage(message),
  },
});

// Shows the Stele modal only if the investor's AccessPass is missing or
// outdated, records the acceptance, then sends the deposit.
const signature = await stele.gate({
  policy: OFFERING_TERMS_POLICY, // the policy address your program pins
  action: () => sendDepositTransaction(5_000_000_000n),
  acceptLabel: "Accept & Deposit",
});`;

const ONCHAIN = `// Cargo.toml: stele-gate = "1"   (crates.io/crates/stele-gate)
use stele_gate::require_current;

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub investor: Signer<'info>,
    #[account(mut, seeds = [b"vault", vault.policy.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: pinned to the vault's policy; verified by require_current
    #[account(address = vault.policy)]
    pub policy: UncheckedAccount<'info>,
    /// CHECK: verified by require_current
    pub access_pass: UncheckedAccount<'info>,
}

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require_current(
        &ctx.accounts.access_pass,
        &ctx.accounts.policy,
        &ctx.accounts.investor,
    )?;
    // … the protected deposit
    Ok(())
}`;

const FLOW = `import { depositInstruction, findAccessPassPda, findPolicyPda } from "@stelehq/protocol";

// The policy of your offering terms, and the investor's AccessPass.
const [policy] = await findPolicyPda(offeringTermsDocument);
const [accessPass] = await findAccessPassPda(offeringTermsDocument, investor);

await stele.gate({
  policy,
  acceptLabel: "Accept & Deposit",
  action: async () => {
    // Transaction 2 (after the acceptance transaction, when one was needed):
    const ix = depositInstruction({ investor, vault, policy, accessPass, amount: 5_000_000_000n });
    return sendAndConfirm([ix]);
  },
});

// Without the SDK — a script or the CLI — the program still decides:
//   no pass → AccessPassMissing · older version → AccessPassOutdated
//   someone else's pass → AccessPassMismatch · another policy → WrongPolicy`;

const TESTING = `// programs/stele/tests/gate.rs — LiteSVM with the real program binaries
// 1. No pass: a direct call to deposit() fails on-chain.
assert_custom(
    &deposit(&mut env, &investor, &v, &policy, &my_pass),
    gate_err(GateError::AccessPassMissing),
);
// 2. Accept v1 (records the Proof acceptance and creates the pass).
assert_ok(&accept_gated(&mut env, &investor, &t, &a));
assert_ok(&deposit(&mut env, &investor, &v, &policy, &my_pass));
// 3. The organization requires v2: the v1 pass is outdated.
assert_ok(&require_version(&mut env, &owner, &t, &v2));
assert_custom(
    &deposit(&mut env, &investor, &v, &policy, &my_pass),
    gate_err(GateError::AccessPassOutdated),
);

// End to end against a running API and cluster (localnet or devnet):
//   pnpm --filter @stele/localnet gate-smoke`;

const SAMPLES: Record<Tab, { code: string; language: string }> = {
  frontend: { code: FRONTEND, language: "ts" },
  onchain: { code: ONCHAIN, language: "rust" },
  flow: { code: FLOW, language: "ts" },
  testing: { code: TESTING, language: "rust" },
};

const FLOW_STEPS = ["deposit()", "check AccessPass", "modal if required", "accept", "continue"];

export function DevTabs() {
  const [tab, setTab] = useState<Tab>("frontend");
  const seq = useSequence(FLOW_STEPS.length, { intervalMs: 1300 });
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_260px]">
      <div className="min-w-0">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "frontend", label: "Frontend SDK" },
            { value: "onchain", label: "On-chain" },
            { value: "flow", label: "Full flow" },
            { value: "testing", label: "Testing" },
          ]}
        />
        <div className="mt-4">
          <CodeBlock code={SAMPLES[tab].code} language={SAMPLES[tab].language} />
        </div>
      </div>
      <div
        ref={seq.ref}
        className="rounded-2xl border border-line bg-surface/70 p-4"
        aria-hidden="true"
      >
        <p className="text-[11.5px] uppercase tracking-[0.1em] text-fg-subtle">What gate() does</p>
        <ol className="mt-3 space-y-2">
          {FLOW_STEPS.map((s, i) => (
            <li key={s} className="flex flex-col items-start">
              <span
                className={cn(
                  "w-full rounded-lg border px-3 py-2 font-mono text-[12.5px] transition-all duration-300",
                  i === seq.step
                    ? "border-accent-line bg-accent-soft text-fg"
                    : i < seq.step
                      ? "border-line text-fg-muted"
                      : "border-line text-fg-subtle",
                )}
              >
                {s}
              </span>
              {i < FLOW_STEPS.length - 1 && <span className="ml-5 h-2.5 w-px bg-line-strong" />}
            </li>
          ))}
        </ol>
        <p className="mt-4">
          <StatusBadge tone={seq.step === FLOW_STEPS.length - 1 ? "success" : "accent"}>
            {seq.step === FLOW_STEPS.length - 1 ? "deposit runs" : "in progress"}
          </StatusBadge>
        </p>
      </div>
    </div>
  );
}
