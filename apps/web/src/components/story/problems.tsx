/**
 * The home page's case: how online agreements are kept today, why that fails when it matters, and
 * what Stele changes — six concrete problems, then the three steps that solve them, then who needs it.
 */
import type { ReactNode } from "react";
import {
  ActivityIcon,
  BuildingIcon,
  CheckIcon,
  CodeIcon,
  FileIcon,
  GateIcon,
  HashIcon,
  KeyIcon,
  LockIcon,
  ShieldIcon,
  UsersIcon,
  WalletIcon,
} from "@stele/ui";
import { InView } from "./in-view";

const PROBLEMS: { icon: ReactNode; title: string; today: string; stele: string }[] = [
  {
    icon: <HashIcon className="h-5 w-5" />,
    title: "“I agree” becomes a database flag",
    today:
      "accepted = true says nothing about what was accepted — and the record is kept, and can be edited, by the company that may be on the other side of a dispute.",
    stele: "The exact version, signed by the user, recorded on Solana.",
  },
  {
    icon: <FileIcon className="h-5 w-5" />,
    title: "Terms change silently",
    today:
      "Version 3 becomes version 4 overnight. Months later, nobody can show which text a given person actually saw and accepted.",
    stele: "Every version is fingerprinted on-chain. History cannot be rewritten.",
  },
  {
    icon: <BuildingIcon className="h-5 w-5" />,
    title: "Disputes ask: what did the user see?",
    today:
      "Courts have refused to enforce online terms when the company could not show the user was presented with them — Specht v. Netscape (2002), Nguyen v. Barnes & Noble (2014).",
    stele: "The user signs the very text on their screen. The receipt contains it.",
  },
  {
    icon: <ActivityIcon className="h-5 w-5" />,
    title: "Screenshots and logs prove nothing",
    today:
      "A screenshot can be faked and a log can be edited. Evidence that only works if you trust one party is not evidence.",
    stele: "Anyone verifies it against Solana — without Stele, without the company.",
  },
  {
    icon: <CodeIcon className="h-5 w-5" />,
    title: "Website checks can be bypassed",
    today:
      "On-chain apps ask for terms in their website. Anyone can call the smart contract from a script and skip the checkbox entirely.",
    stele: "Stele Gate: the program itself refuses wallets that have not accepted.",
  },
  {
    icon: <ShieldIcon className="h-5 w-5" />,
    title: "Regulated assets need proof per investor",
    today:
      "Tokenized funds and real-world assets are expected to show that each investor accepted the current offering terms — for every deposit, at audit time.",
    stele: "Each wallet's passport names the version it accepted, checked on every deposit.",
  },
];

export function ProblemGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {PROBLEMS.map((p, i) => (
        <InView key={p.title} delayMs={(i % 3) * 120} className="h-full">
          <div className="group flex h-full flex-col rounded-2xl border border-line bg-surface p-6 transition-colors duration-300 hover:border-accent-line">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-danger-soft text-danger transition-colors duration-300 group-hover:bg-accent-soft group-hover:text-accent">
                {p.icon}
              </span>
              <span className="font-mono text-[12px] text-fg-subtle">0{i + 1}</span>
            </div>
            <h3 className="mt-4 text-[17px] font-semibold leading-snug tracking-[-0.01em] text-fg">
              {p.title}
            </h3>
            <p className="mt-2 flex-1 text-[14px] leading-relaxed text-fg-muted">{p.today}</p>
            <p className="mt-5 flex gap-2 border-t border-line pt-4 text-[13.5px] font-medium leading-relaxed text-fg">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-verified" />
              {p.stele}
            </p>
          </div>
        </InView>
      ))}
    </div>
  );
}

const STEPS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <FileIcon className="h-5 w-5" />,
    title: "Publish",
    body: "The organization publishes its terms. Stele fingerprints each version on Solana — the text can never be swapped afterwards.",
  },
  {
    icon: <KeyIcon className="h-5 w-5" />,
    title: "Accept",
    body: "The user signs the exact text with Face ID, a passkey or a wallet. Free for them, a few seconds, no crypto needed.",
  },
  {
    icon: <LockIcon className="h-5 w-5" />,
    title: "Prove & enforce",
    body: "Anyone verifies the receipt against Solana, forever. Solana programs refuse wallets that have not accepted the current version.",
  },
];

export function SolveSteps() {
  return (
    <ol className="relative grid gap-4 md:grid-cols-3">
      {/* The thread that runs through the three steps. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[16%] right-[16%] top-[52px] hidden h-px overflow-hidden bg-line md:block"
      >
        <div className="story-pulse h-px w-1/3" />
      </div>
      {STEPS.map((step, i) => (
        <InView key={step.title} delayMs={i * 160}>
          <li className="relative flex h-full flex-col items-center rounded-2xl border border-line bg-surface p-6 text-center">
            <span className="relative grid h-14 w-14 place-items-center rounded-2xl border border-accent-line bg-accent-soft text-accent shadow-[0_0_30px_rgb(76_201_240/0.15)]">
              {step.icon}
              <span className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-accent text-[12px] font-semibold text-accent-ink">
                {i + 1}
              </span>
            </span>
            <h3 className="mt-5 text-[18px] font-semibold text-fg">{step.title}</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{step.body}</p>
          </li>
        </InView>
      ))}
    </ol>
  );
}

const WHO: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <ShieldIcon className="h-[18px] w-[18px]" />,
    title: "Tokenized funds & RWA",
    body: "Offering terms accepted before every deposit, provable per investor.",
  },
  {
    icon: <GateIcon className="h-[18px] w-[18px]" />,
    title: "DeFi with compliance",
    body: "Permissioned pools and vaults that enforce terms in the program.",
  },
  {
    icon: <BuildingIcon className="h-[18px] w-[18px]" />,
    title: "SaaS & marketplaces",
    body: "Terms of service and privacy policies with evidence that holds up.",
  },
  {
    icon: <WalletIcon className="h-[18px] w-[18px]" />,
    title: "Fintech & payments",
    body: "Consents and purchase confirmations signed by the customer.",
  },
  {
    icon: <UsersIcon className="h-[18px] w-[18px]" />,
    title: "DAOs & communities",
    body: "Membership agreements and codes of conduct, per wallet.",
  },
  {
    icon: <CodeIcon className="h-[18px] w-[18px]" />,
    title: "Games & apps",
    body: "EULAs and rules accepted once, enforced on-chain where it matters.",
  },
];

export function WhoNeedsIt() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {WHO.map((w, i) => (
        <InView key={w.title} delayMs={(i % 3) * 90}>
          <div className="flex h-full gap-4 rounded-xl border border-line bg-surface/60 p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-accent">
              {w.icon}
            </span>
            <div>
              <p className="text-[14.5px] font-semibold text-fg">{w.title}</p>
              <p className="mt-0.5 text-[13.5px] leading-relaxed text-fg-muted">{w.body}</p>
            </div>
          </div>
        </InView>
      ))}
    </div>
  );
}

const FACTS: { value: string; label: string }[] = [
  { value: "0 SOL", label: "for your users — Stele pays the network fee" },
  { value: "Seconds", label: "to accept with Face ID, a passkey or a wallet" },
  { value: "1 call", label: "in your Solana program to enforce terms" },
  { value: "Forever", label: "verifiable — even with Stele's servers switched off" },
];

export function FactsBand() {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-4">
      {FACTS.map((f, i) => (
        <InView key={f.value} delayMs={i * 100} className="h-full">
          <div className="h-full bg-surface px-5 py-6">
            <p className="text-[28px] font-semibold tracking-[-0.03em] text-fg sm:text-[34px]">
              {f.value}
            </p>
            <p className="mt-1 text-[13px] leading-snug text-fg-muted">{f.label}</p>
          </div>
        </InView>
      ))}
    </div>
  );
}
