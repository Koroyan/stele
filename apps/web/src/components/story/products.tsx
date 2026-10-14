/**
 * The two Stele products and how they relate: product cards, the "which one do I need" chooser,
 * the layer diagram (Gate builds on Proof) and the feature comparison.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  FileIcon,
  GateIcon,
  ShieldIcon,
  TicketIcon,
  buttonClasses,
  cn,
} from "@stele/ui";

const PROOF_FOR = ["SaaS", "Marketplaces", "Fintech", "E-commerce", "HR platforms", "Any website"];
const GATE_FOR = [
  "RWA",
  "Tokenized assets",
  "Permissioned credit",
  "Investment vaults",
  "Token offerings",
  "Other Solana apps",
];

export function ProductCards() {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <ProductCard
        href="/gate"
        name="Stele Gate"
        tag="For Solana applications"
        statement="Require current acceptance before protected actions."
        flow={["Action", "Check", "Accept if needed", "Execute"]}
        steps={[
          "Your program calls require_current_passport() before a deposit or any protected action.",
          "Investors accept in an embedded modal; their on-chain passport records it.",
          "Publish v2 and old access no longer satisfies the requirement.",
        ]}
        audience={GATE_FOR}
        cta="Explore Gate"
        icon={<GateIcon className="h-5 w-5" />}
        visual={<GateVisual />}
        accent
      />
      <ProductCard
        href="/proof"
        name="Stele Proof"
        tag="For organizations and websites"
        statement="Know exactly what your user agreed to."
        flow={["Publish", "Accept", "Receipt", "Verify"]}
        steps={[
          "Publish an exact version of your agreement.",
          "Let the user accept it — passkey or wallet.",
          "Stele creates tamper-resistant evidence anyone can verify later.",
        ]}
        audience={PROOF_FOR}
        cta="Explore Proof"
        icon={<FileIcon className="h-5 w-5" />}
        visual={<ProofVisual />}
      />
    </div>
  );
}

function ProductCard(p: {
  href: string;
  name: string;
  tag: string;
  statement: string;
  flow: string[];
  steps: string[];
  audience: string[];
  cta: string;
  icon: ReactNode;
  visual: ReactNode;
  accent?: boolean;
}) {
  return (
    <Link
      href={p.href}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border bg-surface p-6 shadow-[var(--shadow-card)] transition-all duration-300 hover:-translate-y-0.5 sm:p-7",
        p.accent
          ? "border-accent-line hover:shadow-[var(--shadow-glow)]"
          : "border-line-strong hover:border-accent-line",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <span
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center rounded-xl border",
              p.accent
                ? "border-accent-line bg-accent-soft text-accent"
                : "border-line-strong bg-surface-2 text-fg",
            )}
          >
            {p.icon}
          </span>
          <h3 className="mt-4 text-[24px] font-semibold tracking-[-0.025em] text-fg">{p.name}</h3>
          <p className="mt-1 text-[13px] text-fg-subtle">{p.tag}</p>
        </div>
        <div className="hidden w-[150px] shrink-0 sm:block" aria-hidden="true">
          {p.visual}
        </div>
      </div>
      <p className="mt-5 text-[19px] font-semibold leading-snug tracking-[-0.015em] text-fg">
        {p.statement}
      </p>
      <ol className="mt-4 flex flex-wrap items-center gap-1.5" aria-label={`${p.name} flow`}>
        {p.flow.map((step, i) => (
          <li key={step} className="flex items-center gap-1.5">
            <span
              className={cn(
                "rounded-md border px-2 py-1 font-mono text-[11.5px] transition-colors duration-300",
                p.accent
                  ? "border-accent-line bg-accent-soft/40 text-fg"
                  : "border-line-strong bg-surface-2 text-fg",
              )}
            >
              {step}
            </span>
            {i < p.flow.length - 1 && <ArrowRightIcon className="h-3.5 w-3.5 text-fg-subtle" />}
          </li>
        ))}
      </ol>
      <ul className="mt-4 space-y-2">
        {p.steps.map((s) => (
          <li key={s} className="flex gap-2.5 text-[14px] leading-relaxed text-fg-muted">
            <CheckIcon className="mt-1 h-4 w-4 shrink-0 text-accent" />
            {s}
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap gap-1.5">
        {p.audience.map((a) => (
          <span
            key={a}
            className="rounded-full border border-line px-2.5 py-1 text-[12px] text-fg-muted"
          >
            {a}
          </span>
        ))}
      </div>
      <span
        className={cn(
          buttonClasses(p.accent ? "primary" : "secondary", "md"),
          "mt-6 self-start group-hover:gap-3",
        )}
      >
        {p.cta}{" "}
        <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

/** Document → fingerprint → receipt, animated on hover. */
function ProofVisual() {
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-line bg-bg p-2.5 transition-transform duration-500 group-hover:-translate-y-0.5">
        <div className="h-1.5 w-3/4 rounded bg-line-strong" />
        <div className="mt-1.5 h-1.5 w-1/2 rounded bg-line-strong" />
        <p className="mt-2 font-mono text-[9.5px] text-accent">sha256 9f2c41aa…</p>
      </div>
      <div className="rounded-lg border border-verified-line bg-verified-soft/40 px-2.5 py-1.5 text-[10.5px] font-semibold text-verified transition-all duration-500 group-hover:translate-x-1">
        ✓ Receipt verified
      </div>
    </div>
  );
}

/** A request meets the gate: rejected without a pass, through with one. */
function GateVisual() {
  return (
    <div className="space-y-2 font-mono text-[10.5px]">
      <div className="flex items-center justify-between rounded-lg border border-danger-line bg-danger-soft/50 px-2.5 py-1.5 text-danger">
        <span>no pass</span>
        <span>✕ rejected</span>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-verified-line bg-verified-soft/40 px-2.5 py-1.5 text-verified transition-transform duration-500 group-hover:translate-x-1">
        <span>pass v1</span>
        <span>✓ deposits</span>
      </div>
    </div>
  );
}

export function Chooser() {
  return (
    <div>
      <div className="grid gap-5 md:grid-cols-2">
        <ChoiceCard
          title="I run a normal application or website."
          product="Stele Proof"
          wants={[
            "Verifiable terms acceptance",
            "Evidence of the exact document version",
            "Receipts anyone can verify",
            "Passkey or wallet signatures",
            "An audit trail you don't have to vouch for",
          ]}
          href="/proof"
          cta="Use Proof"
        />
        <ChoiceCard
          title="I run a Solana application."
          product="Stele Gate"
          wants={[
            "Everything in Proof",
            "One passport per wallet",
            "Policy version enforcement",
            "Protected Solana actions",
            "SDK and program integration",
            "Bypass resistance on-chain",
          ]}
          href="/gate"
          cta="Use Gate"
          accent
        />
      </div>
      <div className="mt-6 flex justify-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-accent-line bg-accent-soft px-4 py-2 text-[14px] font-semibold text-fg">
          <ShieldIcon className="h-4 w-4 text-accent" />
          Gate includes Proof.
        </p>
      </div>
    </div>
  );
}

function ChoiceCard(p: {
  title: string;
  product: string;
  wants: string[];
  href: string;
  cta: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border bg-surface p-6 shadow-[var(--shadow-card)]",
        p.accent ? "border-accent-line" : "border-line-strong",
      )}
    >
      <p className="text-[17px] font-semibold leading-snug text-fg">{p.title}</p>
      <p className="mt-4 text-[12.5px] uppercase tracking-[0.08em] text-fg-subtle">Use</p>
      <p
        className={cn(
          "text-[20px] font-semibold tracking-[-0.02em]",
          p.accent ? "text-accent" : "text-fg",
        )}
      >
        {p.product}
      </p>
      <p className="mt-4 text-[12.5px] uppercase tracking-[0.08em] text-fg-subtle">I want</p>
      <ul className="mt-2 space-y-1.5">
        {p.wants.map((w) => (
          <li key={w} className="flex gap-2.5 text-[14px] text-fg-muted">
            <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            {w}
          </li>
        ))}
      </ul>
      <Link
        href={p.href}
        className={cn(buttonClasses(p.accent ? "primary" : "secondary", "md"), "mt-6 self-start")}
      >
        {p.cta} <ArrowRightIcon className="h-4 w-4" />
      </Link>
    </div>
  );
}

/** Gate is a layer on top of Proof, not a separate product. */
export function Layers() {
  const proof = ["Documents", "Versions", "Acceptances", "Receipts", "Verification"];
  const gate = ["Passport", "Policy enforcement", "Solana integration", "Protected actions"];
  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-2xl border border-accent-line bg-accent-soft/30 p-5">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-accent">
          <TicketIcon className="h-4 w-4" /> Gate layer — Stele Gate
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {gate.map((g) => (
            <span
              key={g}
              className="rounded-lg border border-accent-line bg-bg px-3 py-1.5 text-[13px] text-fg"
            >
              {g}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col items-center py-2" aria-hidden="true">
        <div className="relative h-8 w-px overflow-hidden bg-accent/50">
          <span className="story-pulse-y absolute inset-0" />
        </div>
        <span className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle">builds on</span>
        <div className="h-3 w-px bg-accent/50" />
      </div>
      <div className="rounded-2xl border border-line-strong bg-surface p-5">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-fg">
          <FileIcon className="h-4 w-4 text-fg-muted" /> Proof layer — Stele Proof (foundation)
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {proof.map((p) => (
            <span
              key={p}
              className="rounded-lg border border-line bg-bg px-3 py-1.5 text-[13px] text-fg-muted"
            >
              {p}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const ROWS: [string, boolean | string, boolean | string][] = [
  ["Exact document versions", true, true],
  ["User acceptance", true, true],
  ["Receipts", true, true],
  ["Independent verification", true, true],
  ["Passkeys", true, "for evidence; access needs the wallet"],
  ["Wallet signatures", true, true],
  ["Passport (on-chain acceptance per wallet)", false, true],
  ["Program enforcement", false, true],
  ["Protected actions", false, true],
  ["Solana developer SDK", "optional", true],
  ["Direct bypass resistance", false, true],
];

function Cell({ v }: { v: boolean | string }) {
  if (v === true)
    return (
      <span className="inline-flex items-center gap-1.5 text-verified">
        <CheckIcon className="h-4 w-4" />
        <span className="sr-only">Included</span>
      </span>
    );
  if (v === false)
    return (
      <span className="text-fg-subtle">
        —<span className="sr-only">Not included</span>
      </span>
    );
  return <span className="text-[12.5px] text-fg-muted">{v}</span>;
}

export function Comparison() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <table className="w-full border-collapse text-left text-[14px]">
        <caption className="sr-only">Stele Proof compared with Stele Gate</caption>
        <thead>
          <tr className="bg-surface-2 text-[12.5px] uppercase tracking-[0.06em] text-fg-subtle">
            <th scope="col" className="px-4 py-3 font-medium sm:px-5">
              Feature
            </th>
            <th scope="col" className="px-4 py-3 font-medium sm:px-5">
              Proof
            </th>
            <th scope="col" className="px-4 py-3 font-medium text-accent sm:px-5">
              Gate
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([feature, proof, gate]) => (
            <tr key={feature} className="border-t border-line">
              <th scope="row" className="px-4 py-3 font-medium text-fg sm:px-5">
                {feature}
              </th>
              <td className="px-4 py-3 sm:px-5">
                <Cell v={proof} />
              </td>
              <td className="px-4 py-3 sm:px-5">
                <Cell v={gate} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The CTA row shared by product pages. */
export function ProductLinks({ primary }: { primary: "proof" | "gate" }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Link href="/dashboard" className={buttonClasses("primary", "lg")}>
        {primary === "gate" ? "Set up Gate" : "Start with Proof"}
      </Link>
      <Link href="/demo" className={buttonClasses("secondary", "lg")}>
        Try the live demo
      </Link>
    </div>
  );
}
