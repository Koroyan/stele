import Link from "next/link";
import {
  ArrowRightIcon,
  CodeBlock,
  FileIcon,
  GateIcon,
  HashIcon,
  KeyIcon,
  LockIcon,
  ShieldIcon,
  buttonClasses,
} from "@stele/ui";
import { Eyebrow, FeatureCard, Section, SectionHeading } from "@/components/marketing";
import { BeforeAfter } from "@/components/story/before-after";
import { BypassDemo } from "@/components/story/bypass-demo";
import { DevTabs } from "@/components/story/dev-tabs";
import { GateFlow } from "@/components/story/gate-flow";
import { PolicyUpdate } from "@/components/story/policy-update";
import { Chooser, Layers, ProductCards } from "@/components/story/products";
import { ProofFlow } from "@/components/story/proof-flow";
import { RwaExample } from "@/components/story/rwa-example";

const PROOF_SNIPPET = `<!-- Stele Proof: where your terms should appear -->
<div data-stele-organization="acme.com" data-stele-document="terms-of-service"></div>
<script src="https://stele.site/sdk/v1/stele.js" defer></script>`;

export default function HomePage() {
  return (
    <>
      {/* 1. Hero */}
      <section className="relative overflow-hidden">
        <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div
          className="glow-top pointer-events-none absolute inset-x-0 top-0 h-[520px]"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-6xl px-4 pb-14 pt-16 sm:px-6 sm:pb-16 sm:pt-24">
          <div className="animate-fade-up mx-auto max-w-3xl text-center">
            <p className="text-[13px] font-semibold uppercase tracking-[0.24em] text-accent">
              Stele
            </p>
            <h1 className="mt-4 text-balance text-[42px] font-semibold leading-[1.04] tracking-[-0.04em] text-fg sm:text-[66px]">
              Prove what was agreed.
              <br />
              <span className="text-fg-muted">Enforce what must be agreed.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-[17px] leading-relaxed text-fg-muted sm:text-[18px]">
              Verifiable acceptance infrastructure for organizations and Solana applications.
            </p>
            <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <Link href="/proof" className={buttonClasses("secondary", "lg")}>
                <FileIcon className="h-4 w-4" /> Explore Proof
              </Link>
              <Link href="/gate" className={buttonClasses("primary", "lg")}>
                <GateIcon className="h-4 w-4" /> Explore Gate
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 2. The two products */}
      <Section className="pt-2 sm:pt-4">
        <ProductCards />
        <p className="mt-6 text-center text-[14px] text-fg-muted">
          <span className="font-semibold text-fg">Gate includes Proof.</span> Every Gate acceptance
          is also a Proof record with a verifiable receipt.
        </p>
      </Section>

      {/* 3. The problem */}
      <Section className="border-t border-line bg-bg-raised">
        <SectionHeading
          eyebrow="The problem"
          title={<>&ldquo;I agree&rdquo; usually becomes a database flag.</>}
          lead="When a dispute comes, the only record of what a user accepted is controlled by one of the parties. Stele replaces that row with evidence anyone can check."
        />
        <div className="mt-10">
          <BeforeAfter />
        </div>
      </Section>

      {/* 4. Gate */}
      <Section id="gate" className="border-t border-line">
        <div className="grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="lg:sticky lg:top-24">
            <Eyebrow>Stele Gate</Eyebrow>
            <h2 className="mt-3 text-balance text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] text-fg sm:text-[38px]">
              Require current acceptance before a protected Solana action.
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-fg-muted">
              An RWA app requires its current offering terms before a deposit. The investor&apos;s
              AccessPass proves current acceptance, and the Solana program checks it directly.
            </p>
            <Link href="/gate" className={buttonClasses("primary", "md", "mt-6")}>
              Explore Gate <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
          <GateFlow />
        </div>
      </Section>

      {/* 5. Proof */}
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

      {/* 6. RWA example */}
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

      {/* 7. Versioning */}
      <Section className="border-t border-line bg-bg-raised">
        <SectionHeading
          eyebrow="Versioning"
          title="Publish v2 and old access no longer satisfies the requirement."
          lead="An AccessPass names the version its holder accepted. When the organization requires a newer version, older passes simply stop satisfying the policy — nothing is rewritten."
        />
        <div className="mt-10">
          <PolicyUpdate />
        </div>
      </Section>

      {/* 8. Bypass */}
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

      {/* 9. Developers */}
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

      {/* 10. Which Stele */}
      <Section className="border-t border-line">
        <SectionHeading eyebrow="Choose" title="Which Stele do you need?" align="center" />
        <div className="mt-10">
          <Chooser />
        </div>
        <div className="mt-14">
          <Layers />
        </div>
      </Section>

      {/* 11. Security and verification */}
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
            AccessPasses are written only by verified acceptances and checked by the program that
            acts. Stele never holds funds.
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

      {/* 12. CTA */}
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
          </div>
        </div>
      </section>
    </>
  );
}
