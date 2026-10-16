import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, CodeBlock, buttonClasses } from "@stele/ui";
import { CheckList, Eyebrow, PageHero, Section, SectionHeading } from "@/components/marketing";
import { Architecture } from "@/components/story/architecture";
import { BypassDemo } from "@/components/story/bypass-demo";
import { DevTabs } from "@/components/story/dev-tabs";
import { GateArchitecture } from "@/components/story/gate-architecture";
import { GateSteps } from "@/components/story/gate-steps";
import { PolicyUpdate } from "@/components/story/policy-update";
import { Comparison, ProductLinks } from "@/components/story/products";
import { RwaExample } from "@/components/story/rwa-example";
import { VerifiedBadgePreview } from "@/components/story/verified-badge-preview";

export const metadata: Metadata = {
  title: "Stele Gate",
  description:
    "Investors can't deposit until they've accepted your current terms: Stele Gate turns versioned document acceptance into a condition your Solana program enforces.",
};

const REQUIRE_CURRENT = `stele_gate::require_current_passport(
    &ctx.accounts.passport, // the investor's Stele passport
    &ctx.accounts.policy,   // the Stele policy your program pins
    &ctx.accounts.investor, // a Signer
)?;`;

const CHECKS = [
  "The policy is a Stele policy at its canonical address",
  "The investor signed the transaction",
  "The passport is a Stele account at its canonical address — not a look-alike",
  "It belongs to this wallet and has an entry for the policy's document",
  "The entry names the required version or a later one",
];

export default function GatePage() {
  return (
    <>
      <PageHero
        eyebrow="Stele Gate · for Solana applications"
        title={
          <>
            Investors can&apos;t deposit until they&apos;ve accepted{" "}
            <span className="text-accent">your current terms.</span>
          </>
        }
        lead="Stele Gate turns versioned document acceptance into a condition your Solana program can enforce. Your frontend checkbox can be skipped. Your program requirement can't."
      >
        <ProductLinks primary="gate" />
      </PageHero>

      <Section>
        <SectionHeading
          eyebrow="Architecture"
          title={
            <>
              Frontend SDK = UX. <span className="text-accent">On-chain check = enforcement.</span>
            </>
          }
          lead="The SDK makes acceptance smooth. The requirement itself lives in your program, where a custom client cannot route around it. Stele is never in your execution path."
        />
        <div className="mt-10">
          <GateArchitecture />
        </div>
      </Section>

      <Section className="border-t border-line bg-bg-raised">
        <div className="grid items-start gap-10 lg:grid-cols-2">
          <div>
            <Eyebrow>One call</Eyebrow>
            <h2 className="mt-3 text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] text-fg">
              require_current_passport() checks everything.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-fg-muted">
              Add the passport and the policy to your protected instruction and make one call. You
              don&apos;t re-implement a list of checks:
            </p>
            <div className="mt-5">
              <CheckList items={CHECKS} />
            </div>
          </div>
          <div>
            <CodeBlock code={REQUIRE_CURRENT} language="rust" />
            <p className="mt-3 text-[13px] leading-relaxed text-fg-muted">
              Pin the policy (store it, or use a constant) — otherwise a caller could present a
              policy of their own. The demo vault does it with{" "}
              <code className="font-mono text-[12.5px] text-fg">
                #[account(address = vault.policy)]
              </code>
              .
            </p>
          </div>
        </div>
      </Section>

      <Section className="border-t border-line">
        <SectionHeading eyebrow="How it works" title="Protect. Check. Accept. Continue. Enforce." />
        <div className="mt-10">
          <GateSteps />
        </div>
      </Section>

      <Section className="border-t border-line bg-bg-raised">
        <SectionHeading
          eyebrow="The demo"
          title="Atlas Real Estate Vault"
          lead="A small permissioned investment vault — enough to show Gate, nothing more. No real tokens move."
        />
        <div className="mt-10">
          <RwaExample />
        </div>
      </Section>

      <Section className="border-t border-line">
        <SectionHeading
          eyebrow="Versioning"
          title="Publish v2 and old access no longer satisfies the requirement."
          lead="The policy names the required version. The organization raises it when the change matters — a typo fix doesn't have to lock every investor out."
        />
        <div className="mt-10">
          <PolicyUpdate />
        </div>
      </Section>

      <Section className="border-t border-line bg-bg-raised">
        <SectionHeading
          eyebrow="Bypass resistance"
          title="A direct call without a current pass is rejected on-chain."
        />
        <div className="mt-10">
          <BypassDemo />
        </div>
        <p className="mt-5 text-[13.5px] leading-relaxed text-fg-muted">
          Tested against the real program binaries: no pass, an older version, someone else&apos;s
          pass, a pass for another document or organization, another policy, an unsigned investor,
          look-alike and forged accounts, and a forged policy all fail.
        </p>
      </Section>

      <Section id="integrate" className="border-t border-line">
        <SectionHeading
          eyebrow="Developer experience"
          title="Wrap the action you already have."
          lead="These samples are the real API used by the vault demo. Acceptance and action are two transactions; the investor sees one “Accept & Deposit” step."
        />
        <div className="mt-10">
          <DevTabs />
        </div>
      </Section>

      <Section className="border-t border-line bg-bg-raised">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <Eyebrow>Why Solana</Eyebrow>
            <h2 className="mt-3 text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] text-fg">
              The check has to run where the action executes.
            </h2>
            <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-fg-muted">
              <p>
                A frontend can be bypassed: anyone can sign and send a transaction to your program
                from their own client.
              </p>
              <p>
                A Solana program evaluates its own accounts, whatever the interface. The passport is
                an account only the Stele program can write — and only after verifying the
                investor&apos;s signature over the exact terms — so your program can trust it in the
                same transaction as the deposit. No oracle, no off-chain lookup.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-6">
            <p className="text-[15px] font-semibold text-fg">What it costs (measured)</p>
            <dl className="mt-4 divide-y divide-line text-[14px]">
              {[
                [
                  "First acceptance (creates the passport)",
                  "10,000 lamports fee (Stele, or the organization if it sponsors fees) + ≈0.002 SOL refundable deposit",
                ],
                ["Each further document", "10,000 lamports + ≈0.0005 SOL refundable deposit"],
                [
                  "Later acceptances (new versions)",
                  "10,000 lamports; the entry is updated in place",
                ],
                [
                  "The demo deposit, including the passport check",
                  "≈9,200 compute units, no extra fee",
                ],
                ["For the investor", "Nothing: no fee for accepting"],
              ].map(([k, v]) => (
                <div key={k} className="grid gap-1 py-3 sm:grid-cols-[1fr_1.2fr] sm:gap-4">
                  <dt className="text-fg">{k}</dt>
                  <dd className="text-fg-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Section>

      <Section className="border-t border-line">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <Eyebrow>Stele Verified</Eyebrow>
            <h2 className="mt-3 text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] text-fg">
              Show your users that the check is real.
            </h2>
            <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-fg-muted">
              <p>
                Stele runs your deployed program in simulation: a wallet that never accepted must be
                refused, one that accepted must be let through. It re-checks after every upgrade.
              </p>
              <p>
                The badge on your site opens the evidence — and a button that repeats the checks in
                the visitor&apos;s own browser, against Solana.
              </p>
            </div>
            <Link
              href="/docs/gate#stele-verified"
              className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:underline"
            >
              How verification works <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-line bg-surface p-8">
            <VerifiedBadgePreview />
            <p className="text-center text-[13px] text-fg-subtle">
              Live status · opens the evidence · “Not valid on this site” anywhere else
            </p>
          </div>
        </div>
      </Section>

      <Section className="border-t border-line">
        <SectionHeading eyebrow="Architecture" title="Stele Core, Stele Gate, your program." />
        <div className="mt-10">
          <Architecture />
        </div>
      </Section>

      <Section className="border-t border-line bg-bg-raised">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="Proof vs Gate" title="Gate includes Proof." />
            <div className="mt-8">
              <Comparison />
            </div>
          </div>
          <div>
            <SectionHeading eyebrow="Honest limits" title="What Gate does and doesn't do." />
            <div className="mt-8 rounded-2xl border border-line bg-surface p-6">
              <CheckList
                tone="muted"
                items={[
                  "Gate enforces acceptance of a document version — not KYC, jurisdiction, age or accreditation (future integrations).",
                  "A passport binds the wallet that signed; passkey acceptances create Proof evidence, not passport entries.",
                  "The SDK is user experience; protection exists only where your program calls require_current_passport().",
                  "Accepting and acting are two transactions (not atomic).",
                  "Passes are public accounts: anyone can see that a wallet accepted a version.",
                  "Stele's program is upgradeable today (moving to a multisig); it runs on Devnet, not Mainnet yet.",
                ]}
              />
            </div>
          </div>
        </div>
      </Section>

      <Section className="border-t border-line">
        <div className="flex flex-col items-start justify-between gap-6 rounded-2xl border border-accent-line bg-surface p-8 md:flex-row md:items-center">
          <div>
            <p className="text-[22px] font-semibold tracking-[-0.02em] text-fg">
              Watch a direct deposit fail on Devnet.
            </p>
            <p className="mt-1 text-[15px] text-fg-muted">
              The live demo runs the real programs: every rejection is a transaction you can open.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/demo#gate" className={buttonClasses("primary", "md")}>
              Try the vault demo <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <Link href="/docs/gate" className={buttonClasses("secondary", "md")}>
              Read the guide
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
