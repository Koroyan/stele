/**
 * The Atlas Real Estate Vault story, step by step — the same flow the live demo runs on-chain.
 */
import Link from "next/link";
import { ArrowRightIcon, CodeBlock, buttonClasses, cn } from "@stele/ui";

const STEPS: { title: string; body: string; tone: "neutral" | "danger" | "success" }[] = [
  {
    title: "Deposit 5,000 USDC",
    body: "The investor connects a wallet and taps Deposit in the Atlas Real Estate Vault.",
    tone: "neutral",
  },
  {
    title: "Not accepted → the modal opens",
    body: "Investor Offering Terms v1, hash-verified against Solana. “Accept & Deposit”.",
    tone: "neutral",
  },
  {
    title: "Acceptance recorded, deposit succeeds",
    body: "The acceptance is added to the investor's passport; the vault's check passes.",
    tone: "success",
  },
  {
    title: "The fund publishes v2 and requires it",
    body: "The investor's next deposit is rejected on-chain: their pass names v1.",
    tone: "danger",
  },
  {
    title: "Accept v2, deposit succeeds",
    body: "The same pass now names v2. The v1 acceptance stays verifiable forever.",
    tone: "success",
  },
  {
    title: "A direct CLI call fails",
    body: "No frontend, no SDK — deposit() without a current pass is rejected by the program.",
    tone: "danger",
  },
];

const CODE = `pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    stele_gate::require_current_passport(
        &ctx.accounts.passport,
        &ctx.accounts.policy,
        &ctx.accounts.investor,
    )?;
    // … record the deposit
    Ok(())
}`;

export function RwaExample() {
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[1.05fr_0.95fr]">
      <ol className="space-y-2.5">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className={cn(
              "flex gap-4 rounded-xl border bg-surface p-4",
              s.tone === "success"
                ? "border-verified-line"
                : s.tone === "danger"
                  ? "border-danger-line"
                  : "border-line",
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[12px]",
                s.tone === "success"
                  ? "border-verified-line text-verified"
                  : s.tone === "danger"
                    ? "border-danger-line text-danger"
                    : "border-line-strong text-fg-muted",
              )}
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span>
              <span className="block text-[14.5px] font-semibold text-fg">{s.title}</span>
              <span className="mt-0.5 block text-[13.5px] leading-relaxed text-fg-muted">
                {s.body}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <div className="lg:sticky lg:top-24">
        <p className="mb-2 text-[13px] font-medium text-fg-muted">
          The whole integration in the vault program
        </p>
        <CodeBlock code={CODE} language="rust" />
        <p className="mt-3 text-[13px] leading-relaxed text-fg-muted">
          Stele never holds the investor&apos;s funds and is not in the deposit&apos;s execution
          path: the vault program reads the passport and the policy itself.
        </p>
        <Link href="/demo" className={buttonClasses("primary", "md", "mt-5")}>
          Run it on Devnet <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
