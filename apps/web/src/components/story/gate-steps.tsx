"use client";

import { cn } from "@stele/ui";
import { StatusBadge, StoryFrame } from "./story-ui";
import { useSequence } from "./use-sequence";

const STEPS = [
  {
    name: "Protect",
    title: "Link the action to a Stele policy",
    body: "Your program pins the policy and makes one call before it acts. The policy says which version of your terms is required.",
    code: `pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    stele_gate::require_current(
        &ctx.accounts.access_pass,
        &ctx.accounts.policy,
        &ctx.accounts.investor,
    )?;
    // …`,
  },
  {
    name: "Check",
    title: "The investor starts the action",
    body: "The Stele SDK reads the policy and the wallet's AccessPass from Solana before anything is signed.",
    code: `stele.gate({ policy, action })
→ AccessPass: missing`,
  },
  {
    name: "Accept",
    title: "Missing or outdated? The modal appears",
    body: "The investor reads the hash-verified terms and signs them with their wallet. They pay no fee.",
    code: `Investor Offering Terms · Version 1
☑ I have read and agree
[ Accept & Deposit ]`,
  },
  {
    name: "Continue",
    title: "The pass is created, the deposit continues",
    body: "The acceptance is recorded on Solana and creates or advances the AccessPass; then your original action runs.",
    code: `AccessPass → valid (v1)
deposit() → sent`,
  },
  {
    name: "Enforce",
    title: "The program rejects everything else",
    body: "No pass, an older version, someone else's pass, another policy or a forged account: require_current() fails and the deposit never happens.",
    code: `deposit() without a current pass
→ AccessPassMissing · AccessPassOutdated
→ AccessPassMismatch · InvalidPolicy`,
  },
];

const BADGES = [
  "Policy pinned",
  "Checking pass",
  "Access required",
  "Access granted",
  "Bypass rejected",
] as const;

export function GateSteps() {
  const seq = useSequence(STEPS.length, { intervalMs: 3000 });
  const current = STEPS[seq.step]!;
  return (
    <StoryFrame
      seq={seq}
      title="Stele Gate in five steps"
      captions={STEPS.map((s) => `${s.name}: ${s.title}.`)}
    >
      <ol className="grid grid-cols-5 gap-1.5" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.name}>
            <button
              type="button"
              onClick={() => seq.go(i)}
              aria-current={i === seq.step ? "step" : undefined}
              className={cn(
                "w-full rounded-lg border px-1 py-2 text-center text-[11.5px] font-semibold transition-all duration-300 sm:text-[12.5px]",
                i === seq.step
                  ? "border-accent-line bg-accent-soft text-fg"
                  : i < seq.step
                    ? "border-line bg-surface-2 text-fg-muted"
                    : "border-line text-fg-subtle hover:text-fg",
              )}
            >
              <span className="block font-mono text-[10.5px] text-accent">{i + 1}</span>
              {s.name}
            </button>
          </li>
        ))}
      </ol>
      <div key={seq.step} className="mt-5 grid animate-fade-up gap-4 @min-[640px]:grid-cols-2">
        <div>
          <h3 className="text-[18px] font-semibold tracking-[-0.015em] text-fg">{current.title}</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{current.body}</p>
          <p className="mt-4">
            <StatusBadge tone={seq.step === 4 ? "danger" : seq.step === 3 ? "success" : "accent"}>
              {BADGES[seq.step]}
            </StatusBadge>
          </p>
        </div>
        <pre className="overflow-x-auto rounded-xl border border-line bg-bg p-4 font-mono text-[12.5px] leading-relaxed text-fg">
          {current.code}
        </pre>
      </div>
    </StoryFrame>
  );
}
