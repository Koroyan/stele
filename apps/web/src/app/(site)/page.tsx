import Link from "next/link";
import {
  ArrowRightIcon,
  CodeBlock,
  HashIcon,
  KeyIcon,
  LockIcon,
  ShieldIcon,
  buttonClasses,
} from "@stele/ui";
import { Eyebrow, FeatureCard, Section, SectionHeading } from "@/components/marketing";
import { BypassDemo } from "@/components/story/bypass-demo";
import { DevTabs } from "@/components/story/dev-tabs";
import { GateFlow } from "@/components/story/gate-flow";
import { HeroLedger } from "@/components/story/hero-ledger";
import { FactsBand, ProblemGrid, SolveSteps, WhoNeedsIt } from "@/components/story/problems";
import { Chooser, Layers, ProductCards } from "@/components/story/products";
import { ProofFlow } from "@/components/story/proof-flow";
import { RwaExample } from "@/components/story/rwa-example";

const PROOF_SNIPPET = `<!-- Stele Proof: where your terms should appear -->
<div data-stele-organization="acme.com" data-stele-document="terms-of-service"></div>
<script src="https://stele.site/sdk/v1/stele.js" defer></script>`;

export default function HomePage() {
  return (
    <>
      {/* 1. Hero: the problem in one line, and the scene that shows it */}
      <section className="relative overflow-hidden">
        <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div
          className="glow-top pointer-events-none absolute inset-x-0 top-0 h-[620px]"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-20">
          <div className="animate-fade-up mx-auto max-w-3xl text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-accent-line bg-accent-soft/60 px-3 py-1 text-[12.5px] font-medium text-accent">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              Verifiable agreements on Solana
            </p>
            <h1 className="mt-6 text-balance text-[40px] font-semibold leading-[1.04] tracking-[-0.04em] text-fg sm:text-[64px]">
              Every &ldquo;I agree&rdquo; on the internet is a row in someone&apos;s database.
            </h1>
            <p className="mt-5 text-balance text-[22px] font-semibold tracking-[-0.02em] text-accent sm:text-[28px]">
              Stele turns it into proof.
            </p>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-[16.5px] leading-relaxed text-fg-muted sm:text-[18px]">
              Stele records exactly which version of your terms each person accepted — signed by
              them, anchored on Solana, checkable by anyone, forever. And it lets Solana programs
              refuse anyone who hasn&apos;t accepted.
            </p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <Link href="/demo" className={buttonClasses("primary", "lg")}>
                Try the live demo <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <Link href="/dashboard" className={buttonClasses("secondary", "lg")}>
                Start free
              </Link>
            </div>
            <p className="mt-5 text-[13px] text-fg-subtle">
              Free for your users · No crypto needed to sign · Open-source verifier
            </p>
          </div>
          <div className="mt-14 sm:mt-16">
            <HeroLedger />
          </div>
        </div>
      </section>

      {/* 2. In numbers */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <FactsBand />
      </section>

      {/* 3. The problem today */}
      <Section className="pt-20 sm:pt-28">
        <SectionHeading
          eyebrow="The problem today"
          title="Online agreements run on trust. That breaks the moment it matters."
          lead="Every day, people accept terms to open accounts, invest, trade and play. When something goes wrong, the only record of what they agreed to is whatever one party kept."
        />
        <div className="mt-12">
          <ProblemGrid />
        </div>
      </Section>

      {/* 4. How Stele solves it */}
      <Section className="border-t border-line bg-bg-raised">
        <SectionHeading
          eyebrow="How Stele solves it"
          title="Three steps. Evidence nobody can rewrite."
          lead="No new habits for your users, and no new infrastructure for you: a widget on your page, and one call in your Solana program if you want enforcement."
          align="center"
        />
        <div className="mt-12">
          <SolveSteps />
        </div>
      </Section>

      {/* 5. Who it is for */}
      <Section className="border-t border-line">
        <SectionHeading eyebrow="Who it is for" title="Anywhere an agreement must hold up later." />
        <div className="mt-10">
          <WhoNeedsIt />
        </div>
      </Section>

      {/* 6. The two products */}
      <Section className="border-t border-line bg-bg-raised">
        <SectionHeading eyebrow="Two products" title="Prove it. Or enforce it." align="center" />
        <div className="mt-10">
          <ProductCards />
        </div>
        <p className="mt-6 text-center text-[14px] text-fg-muted">
          <span className="font-semibold text-fg">Gate includes Proof.</span> Every Gate acceptance
          is also a Proof record with a verifiable receipt.
        </p>
      </Section>

      {/* 7. Gate */}
      <Section id="gate" className="border-t border-line">
        <div className="grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="lg:sticky lg:top-24">
            <Eyebrow>Stele Gate</Eyebrow>
            <h2 className="mt-3 text-balance text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] text-fg sm:text-[38px]">
              Require current acceptance before a protected Solana action.
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-fg-muted">
              An RWA app requires its current offering terms before a deposit. The investor&apos;s
              passport proves current acceptance, and the Solana program checks it directly.
            </p>
            <Link href="/gate" className={buttonClasses("primary", "md", "mt-6")}>
              Explore Gate <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
          <GateFlow />
        </div>
      </Section>

      {/* 8. Proof */}
      <Section id="proof" className="border-t border-line bg-bg-raised">
        <div className="grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="lg:sticky lg:top-24">
            <Eyebrow>Stele Proof</Eyebrow>
            <h2 className="mt-3 text-balance text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] text-fg sm:text-[38px]">
              Prove which exact version a user accepted.
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-fg-muted">
              A company publishes exact terms. A user accepts them. Stele preserves evidence of
              exactly what was accepted — and anyone can verify it later.
            </p>
            <Link href="/proof" className={buttonClasses("secondary", "md", "mt-6")}>
              Explore Proof <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
          <ProofFlow />
        </div>
      </Section>

      {/* 9. RWA example */}
      <Section className="border-t border-line">
        <SectionHeading
          eyebrow="Example · Atlas Real Estate Vault"
          title="Investors can't deposit until they've accepted your current terms."
          lead="A permissioned investment vault on Solana, end to end. It is also the live demo — every step is a real transaction."
        />
        <div className="mt-10">
          <RwaExample />
        </div>
      </Section>

      {/* 10. Bypass */}
      <Section className="border-t border-line">
        <SectionHeading
          eyebrow="Why program-level"
          title="Your frontend can be bypassed. The program check cannot."
          lead="A terms checkbox only exists in the interface you built. Anyone can call a Solana program from a script, the CLI or another frontend — so that is where the requirement has to live."
        />
        <div className="mt-10">
          <BypassDemo />
        </div>
      </Section>

      {/* 11. Developers */}
      <Section className="border-t border-line bg-bg-raised">
        <SectionHeading
          eyebrow="For developers"
          title="Integrate without rebuilding your app."
          lead="Gate is one call in your program and one wrapper around the action you already send. Proof is two lines on any page."
        />
        <div className="mt-10">
          <DevTabs />
        </div>
        <div className="mt-8 grid items-start gap-5 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="mb-2 text-[13px] font-medium text-fg-muted">Stele Proof · any website</p>
            <CodeBlock code={PROOF_SNIPPET} language="html" />
          </div>
          <div className="flex flex-wrap gap-3 lg:flex-col lg:pt-7">
            <Link href="/developers" className={buttonClasses("secondary", "md")}>
              Developer guide <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <Link href="/docs/gate" className={buttonClasses("ghost", "md")}>
              Gate reference
            </Link>
          </div>
        </div>
      </Section>

      {/* 12. Which Stele */}
      <Section className="border-t border-line">
        <SectionHeading eyebrow="Choose" title="Which Stele do you need?" align="center" />
        <div className="mt-10">
          <Chooser />
        </div>
        <div className="mt-14">
          <Layers />
        </div>
      </Section>

      {/* 13. Security and verification */}
      <Section className="border-t border-line bg-bg-raised">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <SectionHeading
            eyebrow="Security & verification"
            title="Built for the day someone wants the record to say something else."
          />
          <Link href="/docs/trust-model" className={buttonClasses("secondary", "md", "shrink-0")}>
            Who controls what <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard icon={<HashIcon className="h-[18px] w-[18px]" />} title="Exact versions">
            Each version is canonicalized and fingerprinted on Solana. There is no instruction to
            edit it.
          </FeatureCard>
          <FeatureCard icon={<KeyIcon className="h-[18px] w-[18px]" />} title="Signed by the user">
            A passkey or wallet signs the exact text. Nobody — not Stele, not the organization — can
            sign for a key they don&apos;t hold.
          </FeatureCard>
          <FeatureCard
            icon={<ShieldIcon className="h-[18px] w-[18px]" />}
            title="Enforced by your program"
          >
            Passports are written only by verified acceptances and checked by the program that acts.
            Stele never holds funds.
          </FeatureCard>
          <FeatureCard icon={<LockIcon className="h-[18px] w-[18px]" />} title="Verified by anyone">
            Receipts are checked against any archival Solana RPC with open-source tools — with
            Stele&apos;s servers switched off.
          </FeatureCard>
        </div>
        <p className="mt-6 text-[13px] leading-relaxed text-fg-subtle">
          Stele answers &ldquo;which exact document version did you accept?&rdquo; — not &ldquo;who
          are you?&rdquo;. A passkey or wallet proves control of a key, not identity; Face ID is not
          KYC. What stays trusted: what the signing page displays, and who enrolls a passkey.{" "}
          <Link href="/docs/trust-model" className="text-accent hover:underline">
            Read the trust model
          </Link>
          .
        </p>
      </Section>

      {/* 14. CTA */}
      <section className="relative overflow-hidden border-t border-line">
        <div className="glow-top pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
          <Eyebrow>Get started</Eyebrow>
          <h2 className="mt-4 text-balance text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] text-fg sm:text-[44px]">
            See it work on Solana Devnet.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-fg-muted">
            Accept offering terms, deposit, publish v2, watch the old pass stop working and a direct
            call fail — every step a real transaction.
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Link href="/demo" className={buttonClasses("primary", "lg")}>
              Try the live demo
            </Link>
            <Link href="/dashboard" className={buttonClasses("secondary", "lg")}>
              Launch dashboard
            </Link>
            <Link href="/contact" className={buttonClasses("ghost", "lg")}>
              Talk to us
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
