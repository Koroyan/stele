import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, buttonClasses } from "@stele/ui";
import { Section } from "@/components/marketing";
import { Walkthrough } from "@/components/walkthrough";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "From writing the Terms to verifying an acceptance years later: how Stele works, step by step.",
};

export default function HowItWorksPage() {
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
            From “I agree” to proof anyone can check.
          </h1>
          <p className="mt-4 max-w-2xl text-pretty text-[17px] leading-relaxed text-fg-muted">
            Nine short steps, from a company writing its Terms to anyone verifying an acceptance
            years later. Press play, or go at your own pace.
          </p>
        </div>
      </section>
      <div className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
        <Walkthrough />
      </div>
      <Section className="border-t border-line">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              title: "For businesses",
              text: "Publish your Terms, add two lines to your site, and know for certain who accepted which version.",
              href: "/docs/get-started",
              cta: "Get started",
            },
            {
              title: "For customers",
              text: "Your wallet shows exactly what you accept, and your receipt proves it, even without the company.",
              href: "/docs/acceptance-signing",
              cta: "What a signature proves",
            },
            {
              title: "For anyone checking",
              text: "Paste a transaction or receipt and check it against Solana yourself.",
              href: "/verify",
              cta: "Verify an agreement",
            },
          ].map((c) => (
            <div key={c.title} className="rounded-2xl border border-line bg-surface p-6">
              <p className="text-[16px] font-semibold text-fg">{c.title}</p>
              <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{c.text}</p>
              <Link href={c.href} className={buttonClasses("secondary", "sm", "mt-5")}>
                {c.cta} <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-8 text-[13.5px] text-fg-subtle">
          Want the technical version?{" "}
          <Link href="/docs/how-it-works" className="text-accent hover:text-accent-strong">
            How Stele works, in detail
          </Link>
          .
        </p>
      </Section>
    </>
  );
}
