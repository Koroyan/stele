import type { Metadata } from "next";
import Link from "next/link";
import { buildAcceptanceMessage, sha256, toBase58, utf8 } from "@stelehq/protocol";
import {
  ArrowRightIcon,
  CodeIcon,
  GlobeIcon,
  LayersIcon,
  PlugIcon,
  buttonClasses,
} from "@stele/ui";
import { CheckList, FeatureCard, PageHero, Section, SectionHeading } from "@/components/marketing";
import { BeforeAfter } from "@/components/story/before-after";
import { ProductLinks } from "@/components/story/products";
import { ProofFlow } from "@/components/story/proof-flow";

export const metadata: Metadata = {
  title: "Stele Proof",
  description:
    "Prove which exact version of an agreement each user accepted — with evidence anyone can verify later.",
};

// An example message, produced by the same builder the protocol uses (values are illustrative).
const EXAMPLE_MESSAGE = buildAcceptanceMessage(
  {
    orgName: "Acme Inc.",
    orgVerifiedDomain: "acme.example",
    title: "Acme Terms of Service",
    versionLabel: "3.0",
    version: 3,
    versionHash: sha256(utf8("illustrative fingerprint")),
    signer: toBase58(sha256(utf8("illustrative signer"))),
    networkLabel: "Solana Devnet",
    issuedAt: 1_790_000_000,
    expiresAt: 1_790_000_600,
    shardId: 0,
    nonceIndex: 1842,
    nonceTag: sha256(utf8("illustrative nonce")).slice(0, 8),
  },
  "acme.example",
);

const STEPS = [
  [
    "Publish the exact version",
    "Your document is canonicalized into exact bytes; its fingerprint is committed on Solana. Versions are hash-chained and cannot be edited.",
  ],
  [
    "The user accepts",
    "With a passkey (Face ID, Touch ID, Windows Hello) or a wallet. No crypto knowledge and no fees for the user.",
  ],
  [
    "Cryptographic evidence",
    "The user's signature over that exact version is recorded with a time; nobody can sign for a key they don't hold.",
  ],
  [
    "A receipt",
    "A portable file with the exact text, the signature and the transaction — for the user, for you, for an auditor.",
  ],
  [
    "Anyone can verify later",
    "The open-source verifier checks it against Solana, with Stele's servers switched off.",
  ],
] as const;

const USE_CASES = [
  ["SaaS terms", "Which Terms of Service version every customer accepted."],
  ["Employee policies", "Handbooks, security and conduct policies, acknowledged per version."],
  ["Marketplace agreements", "Seller and buyer terms that hold up in a dispute."],
  ["Financial disclosures", "Fee schedules and risk notices — the exact text shown."],
  ["Consent forms", "Consent to a specific text, signed with a passkey."],
  ["Partner agreements", "Program terms accepted by each partner account."],
  ["E-commerce terms", "Return and payment terms at the moment of purchase."],
] as const;

const INTEGRATIONS = [
  {
    icon: <GlobeIcon className="h-[18px] w-[18px]" />,
    title: "Hosted acceptance page",
    body: "Share a link. Stele's page shows the hash-verified text and records the acceptance.",
    href: "/docs/get-started",
  },
  {
    icon: <LayersIcon className="h-[18px] w-[18px]" />,
    title: "Embedded widget",
    body: "Two lines on your own page: the widget verifies the text against Solana before showing it.",
    href: "/developers",
  },
  {
    icon: <PlugIcon className="h-[18px] w-[18px]" />,
    title: "REST API",
    body: "Acceptance sessions linked to your users, signed webhooks, receipts and status checks.",
    href: "/docs/api",
  },
  {
    icon: <CodeIcon className="h-[18px] w-[18px]" />,
    title: "SDK",
    body: "TypeScript SDK and React component for your own acceptance flow; open-source verifier.",
    href: "/developers",
  },
];

export default function ProofPage() {
  return (
    <>
      <PageHero
        eyebrow="Stele Proof"
        title="Know exactly what your user agreed to."
        lead="Publish the exact version of an agreement, let people accept it with a passkey or a wallet, and keep evidence anyone can verify later — without asking anyone to trust your database."
      >
        <ProductLinks primary="proof" />
      </PageHero>

      <Section>
        <SectionHeading
          eyebrow="The problem"
          title={<>&ldquo;I agree&rdquo; is usually just a database flag.</>}
          lead="It records that someone clicked — not which text they saw, and not in a way anyone outside the company can check."
        />
        <div className="mt-10">
          <BeforeAfter />
        </div>
      </Section>

      <Section className="border-t border-line bg-bg-raised">
        <SectionHeading eyebrow="How it works" title="Five steps from document to proof." />
        <ol className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-5">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="rounded-2xl border border-line bg-surface p-5">
              <p className="font-mono text-[12px] text-accent">{String(i + 1).padStart(2, "0")}</p>
              <p className="mt-2 text-[15px] font-semibold text-fg">{title}</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">{body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10">
          <ProofFlow />
        </div>
        <Link href="/demo#proof" className={buttonClasses("ghost", "md", "mt-6")}>
          Try it live on Devnet <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </Section>

      <Section className="border-t border-line">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionHeading
            eyebrow="What users sign"
            title="Human-readable. Bound to one version, one site, one network."
            lead="Every acceptance names exactly what is being accepted, where, and for how long. A wallet displays this text; a passkey signs a challenge computed from it while the page shows the hash-verified text."
          />
          <div className="overflow-hidden rounded-2xl border border-line bg-[#060a0f]">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="text-[12px] text-fg-subtle">Signed message · example</span>
              <span className="font-mono text-[11px] text-fg-subtle">stele-acceptance-v1</span>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-[12px] leading-[1.75] text-fg">
              {EXAMPLE_MESSAGE}
            </pre>
          </div>
        </div>
      </Section>

      <Section className="border-t border-line bg-bg-raised">
        <SectionHeading eyebrow="Use cases" title="For any agreement that has to hold up later." />
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {USE_CASES.map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-line bg-surface p-5">
              <p className="text-[15px] font-semibold text-fg">{title}</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section className="border-t border-line">
        <SectionHeading
          eyebrow="Integrations"
          title="Use the page, the widget, the API or the SDK."
          lead="No blockchain knowledge is needed to integrate Proof: Stele pays the network fee and your users never see a wallet unless they want one."
        />
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {INTEGRATIONS.map((i) => (
            <Link key={i.title} href={i.href} className="group">
              <FeatureCard
                icon={i.icon}
                title={i.title}
                className="h-full transition-colors group-hover:border-accent-line"
              >
                {i.body}
              </FeatureCard>
            </Link>
          ))}
        </div>
      </Section>

      <Section className="border-t border-line bg-bg-raised">
        <SectionHeading
          eyebrow="Honest boundaries"
          title="What the evidence proves — and what it doesn't."
        />
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface p-6">
            <p className="text-[15px] font-semibold text-fg">Stele evidence proves</p>
            <div className="mt-4">
              <CheckList
                items={[
                  "This exact text existed, unaltered, under this fingerprint",
                  "It was published by the organization's authorized key at a recorded time",
                  "A specific passkey or wallet accepted that exact version on that site",
                  "The acceptance was recorded on Solana at a specific slot and time",
                ]}
              />
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-6">
            <p className="text-[15px] font-semibold text-fg">It does not, by itself, prove</p>
            <div className="mt-4">
              <CheckList
                tone="muted"
                items={[
                  "The legal identity of the person controlling the key",
                  "That a key belongs to a person — whoever runs enrollment links keys to accounts",
                  "What a passkey prompt displayed — it shows the site; the page shows the text",
                  "That the person read or understood the document",
                  "That an agreement is enforceable — that depends on law and circumstances",
                ]}
              />
            </div>
          </div>
        </div>
        <Link href="/docs/trust-model" className={buttonClasses("secondary", "md", "mt-6")}>
          Read the trust model <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </Section>

      <Section className="border-t border-line">
        <div className="flex flex-col items-start justify-between gap-6 rounded-2xl border border-line-strong bg-surface p-8 md:flex-row md:items-center">
          <div>
            <p className="text-[22px] font-semibold tracking-[-0.02em] text-fg">
              Running a Solana app?
            </p>
            <p className="mt-1 text-[15px] text-fg-muted">
              Stele Gate adds enforcement on top of everything here.
            </p>
          </div>
          <Link href="/gate" className={buttonClasses("primary", "md")}>
            Explore Gate <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </Section>
    </>
  );
}
