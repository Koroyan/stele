import type { Metadata } from "next";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Partnerships, integrations, enterprise plans and press: write to the Stele team.",
};

const REASONS = [
  {
    title: "Partnerships",
    body: "Wallets, legal-tech platforms, protocols and auditors that want to build with Stele.",
  },
  {
    title: "Integration help",
    body: "Stele Proof or Gate in your app or Solana program, Stele Verified, the API and webhooks.",
  },
  {
    title: "Enterprise",
    body: "Volume pricing, dedicated relayers, Mainnet launch support and custom terms.",
  },
];

export default function ContactPage() {
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.15fr]">
      <div>
        <p className="text-[12.5px] font-medium uppercase tracking-[0.12em] text-accent">Contact</p>
        <h1 className="mt-3 text-balance text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] text-fg sm:text-[44px]">
          Let&apos;s build provable agreements together
        </h1>
        <p className="mt-4 text-[15.5px] leading-relaxed text-fg-muted">
          Tell us about your organization and what you want to do. The team reads every message and
          replies by e-mail, usually within two business days.
        </p>
        <ul className="mt-10 space-y-6">
          {REASONS.map((r) => (
            <li key={r.title} className="border-l-2 border-accent-line pl-4">
              <p className="text-[15px] font-semibold text-fg">{r.title}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-fg-muted">{r.body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-[13.5px] leading-relaxed text-fg-subtle">
          Found a vulnerability? Please follow the{" "}
          <a href="/docs/security-policy" className="text-accent hover:underline">
            security policy
          </a>{" "}
          instead.
        </p>
      </div>
      <ContactForm />
    </div>
  );
}
