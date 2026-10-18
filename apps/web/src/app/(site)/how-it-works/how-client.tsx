"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, FileIcon, GateIcon, Tabs, buttonClasses, cn } from "@stele/ui";
import { Section, SectionHeading } from "@/components/marketing";
import { BeforeAfter } from "@/components/story/before-after";
import { BypassDemo } from "@/components/story/bypass-demo";
import { GateFlow } from "@/components/story/gate-flow";
import { GateSteps } from "@/components/story/gate-steps";
import { PolicyUpdate } from "@/components/story/policy-update";
import { ProofFlow } from "@/components/story/proof-flow";

const PROOF_STEPS = [
  ["Publish", "The organization publishes an exact version. Its fingerprint goes on Solana."],
  ["Accept", "The user reads that exact text and accepts with a passkey or a wallet."],
  ["Record", "The signature over that version is recorded with a time — the evidence."],
  ["Verify", "Anyone checks the receipt against Solana, without asking the company."],
] as const;

const GATE_STEPS = [
  ["Protect", "Your program calls require_current_passport() before the protected action."],
  ["Check", "The SDK reads the investor's passport and the policy from Solana."],
  ["Accept if required", "Missing or outdated? The Stele modal records the acceptance."],
  ["Continue", "The passport entry is added or advanced; the original action runs."],
  ["Enforce", "Your program rejects any call without a current passport — even from the CLI."],
] as const;

function StepRow({
  steps,
  accent,
}: {
  steps: readonly (readonly [string, string])[];
  accent?: boolean;
}) {
  return (
    <ol
      className={cn(
        "grid gap-3",
        steps.length === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-5",
      )}
    >
      {steps.map(([title, body], i) => (
        <li
          key={title}
          className={cn(
            "rounded-2xl border bg-surface p-5",
            accent ? "border-accent-line" : "border-line-strong",
          )}
        >
          <p className="font-mono text-[12px] text-accent">{String(i + 1).padStart(2, "0")}</p>
          <p className="mt-2 text-[16px] font-semibold text-fg">{title}</p>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">{body}</p>
        </li>
      ))}
    </ol>
  );
}

export function HowItWorks() {
  const [tab, setTab] = useState<"proof" | "gate">("proof");
  useEffect(() => {
    if (window.location.hash === "#gate") setTab("gate");
  }, []);
  const choose = (t: "proof" | "gate") => {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
  };

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div
          className="glow-top pointer-events-none absolute inset-x-0 top-0 h-[360px]"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-6xl px-4 pb-6 pt-14 sm:px-6 sm:pt-20">
          <p className="text-[12.5px] font-medium uppercase tracking-[0.12em] text-accent">
            How it works
          </p>
          <h1 className="mt-4 max-w-3xl text-balance text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] text-fg sm:text-[48px]">
            Prove what was agreed. Enforce what must be agreed.
          </h1>
          <p className="mt-4 max-w-2xl text-pretty text-[17px] leading-relaxed text-fg-muted">
            Two products on one record. Pick the one you need — each step is shown below, and every
            animation can be paused or stepped through.
          </p>
          <div className="mt-8">
            <Tabs
              value={tab}
              onChange={choose}
              items={[
                {
                  value: "proof",
                  label: (
                    <span className="inline-flex items-center gap-2">
                      <FileIcon className="h-4 w-4" /> Proof
                    </span>
                  ),
                },
                {
                  value: "gate",
                  label: (
                    <span className="inline-flex items-center gap-2">
                      <GateIcon className="h-4 w-4" /> Gate
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </section>

      {tab === "proof" ? (
        <>
          <Section className="pt-8 sm:pt-10">
            <StepRow steps={PROOF_STEPS} />
            <div className="mt-10">
              <ProofFlow />
            </div>
          </Section>
          <Section className="border-t border-line bg-bg-raised">
            <SectionHeading
              eyebrow="Why it matters"
              title="A database flag can't say what was accepted. Evidence can."
            />
            <div className="mt-10">
              <BeforeAfter />
            </div>
          </Section>
          <Section className="border-t border-line">
            <div className="flex flex-wrap gap-3">
              <Link href="/proof" className={buttonClasses("primary", "md")}>
                Stele Proof <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <Link href="/demo#proof" className={buttonClasses("secondary", "md")}>
                Try it live
              </Link>
              <Link href="/verify" className={buttonClasses("ghost", "md")}>
                Verify a receipt
              </Link>
            </div>
          </Section>
        </>
      ) : (
        <>
          <Section className="pt-8 sm:pt-10">
            <StepRow steps={GATE_STEPS} accent />
            <div className="mt-10">
              <GateSteps />
            </div>
          </Section>
          <Section className="border-t border-line bg-bg-raised">
            <SectionHeading
              eyebrow="In the app"
              title="One “Accept & Deposit” step for the investor."
            />
            <div className="mt-10">
              <GateFlow />
            </div>
          </Section>
          <Section className="border-t border-line">
            <SectionHeading
              eyebrow="When terms change"
              title="The evidence for v1 remains. Access now requires v2."
            />
            <div className="mt-10">
              <PolicyUpdate />
            </div>
          </Section>
          <Section className="border-t border-line bg-bg-raised">
            <SectionHeading
              eyebrow="Enforcement"
              title="The frontend is optional. The program check is not."
            />
            <div className="mt-10">
              <BypassDemo />
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/gate" className={buttonClasses("primary", "md")}>
                Stele Gate <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <Link href="/demo#gate" className={buttonClasses("secondary", "md")}>
                Try the vault demo
              </Link>
            </div>
          </Section>
        </>
      )}
    </>
  );
}
