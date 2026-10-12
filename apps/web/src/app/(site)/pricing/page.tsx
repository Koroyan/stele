import type { Metadata } from "next";
import Link from "next/link";
import { formatSol } from "@stelehq/protocol";
import { Card, buttonClasses, cn } from "@stele/ui";
import { CheckList, PageHero, Section, SectionHeading } from "@/components/marketing";
import { getPublic } from "@/lib/server";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "A free allowance of recordings every month, then prepaid credits in SOL. Network fees included; your users never pay.",
};

/** What this Stele app sells (`GET /v1/billing`): the page shows exactly what the API charges. */
interface Billing {
  enabled: boolean;
  treasury: string | null;
  network: { cluster: string; label: string };
  freeRecordsPerMonth: number;
  packs: { id: string; credits: number; lamports: number }[];
}

const sol = (lamports: number, digits = 6) => `${formatSol(BigInt(lamports), digits)} SOL`;

const COSTS = [
  ["Create organization", "0.00353", "$0.53", "Your wallet, once"],
  ["Add team member", "0.00191", "$0.29", "Your wallet, once"],
  ["Create document", "0.00262", "$0.39", "Your wallet, once"],
  ["Publish a version", "0.00400", "$0.60", "Your wallet, per version"],
  ["Nonce shard (65,536 recordings)", "0.05880", "$8.82", "Your wallet, per shard"],
  ["Fee sponsorship on a shard (optional)", "0.00084", "$0.13", "Your wallet, once"],
  ["One acceptance or proof", "0.00001", "$0.0015", "Included in the recording"],
];

const FAQ = [
  [
    "Do my users pay anything or need crypto?",
    "No. Visitors sign with a passkey (Face ID, fingerprint, Windows Hello, a phone) or with a Solana wallet if they have one. They never need SOL: Stele's relayer pays every network fee.",
  ],
  [
    "What counts as a recording?",
    "Each acceptance or proof recorded on Solana. Publishing documents and versions uses no credits: your wallet pays their rent directly, at cost.",
  ],
  [
    "How do I pay?",
    "In the dashboard (Billing), an owner or admin picks a pack and pays in SOL from their wallet. The payment is a public Solana transfer to Stele's treasury address; Stele adds the credits once it finds that payment on-chain. No card, no account details.",
  ],
  [
    "What happens when the free allowance and credits run out?",
    "New signing requests are refused before anyone signs, with the error credits_exhausted. Everything recorded stays valid. Buy credits and recording continues immediately. Credits never expire.",
  ],
  [
    "What happens to the evidence if Stele shuts down?",
    "Nothing. Versions and acceptances live on Solana, receipts embed the document text, and the verifier is open source and talks only to RPC endpoints you choose. You can also self-host the API and relayer.",
  ],
  [
    "Why is publishing rent permanent?",
    "Evidence accounts are deliberately never closed, so the rent deposit that keeps them on-chain stays locked. Closing them would let history disappear.",
  ],
  [
    "Is an acceptance legally binding?",
    "Stele produces strong technical evidence of what was accepted, by which key, and when. Whether that forms an enforceable agreement depends on the applicable law, how acceptance was presented, and who controls the key. Ask your counsel.",
  ],
];

export default async function PricingPage() {
  const billing = await getPublic<Billing>("/v1/billing");
  const free = billing?.freeRecordsPerMonth ?? 1_000;
  const packs = billing?.packs ?? [];
  const cheapest = packs.reduce<number | null>(
    (min, p) => Math.min(min ?? Infinity, Math.round(p.lamports / p.credits)),
    null,
  );
  const test = billing !== null && billing.network.cluster !== "mainnet";

  const plans = [
    {
      name: "Free",
      price: "0 SOL",
      unit: `${free.toLocaleString()} recordings every month`,
      description: "Everything Stele does, for every organization. No card, no trial period.",
      cta: { href: "/dashboard", label: "Start free" },
      features: [
        "Widget, passkey and wallet signing, proofs",
        "REST API, SDKs, webhooks and the verifier",
        "Network fees included — your users never pay",
        "Unlimited documents, versions and team members",
      ],
      featured: false,
    },
    {
      name: "Pay as you go",
      price: cheapest !== null ? sol(cheapest, 9) : "Credits",
      unit: "per recording, beyond the free allowance",
      description: "Prepaid credits in SOL, one per recording. They never expire.",
      cta: { href: "/dashboard/billing", label: "Buy credits" },
      features: [
        "Volume discounts (below)",
        "Network fees included in every credit",
        "Paid on-chain to a public treasury address",
        "Email support with a 1 business day response",
      ],
      featured: true,
    },
    {
      name: "Enterprise",
      price: "Custom",
      unit: "annual agreement",
      description: "For regulated teams and high-volume platforms.",
      cta: { href: "/docs/how-it-works", label: "See how Stele works" },
      features: [
        "Dedicated relayer and RPC providers",
        "Self-hosted deployment support",
        "Custom retention for off-chain data",
        "Security review and incident support",
      ],
      featured: false,
    },
  ];

  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Pay for evidence, not for seats."
        lead={`${free.toLocaleString()} recordings free every month. After that, prepaid credits in SOL — network fees included, paid on-chain to an address anyone can check.`}
      />

      <Section>
        {test && (
          <p className="mb-6 rounded-xl border border-warning-line bg-warning-soft px-4 py-3 text-[13.5px] text-fg">
            You are on <strong>{billing!.network.label}</strong>: payments here use test SOL, which
            has no value, so you can try billing end to end for free.
          </p>
        )}
        <div className="grid gap-5 lg:grid-cols-3">
          {plans.map((p) => (
            <Card
              key={p.name}
              className={cn(
                "flex flex-col p-7",
                p.featured && "border-accent-line shadow-[var(--shadow-glow)]",
              )}
            >
              <div className="flex items-center justify-between">
                <p className="text-[15px] font-semibold text-fg">{p.name}</p>
                {p.featured && (
                  <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11.5px] font-medium text-accent">
                    Most teams
                  </span>
                )}
              </div>
              <p className="mt-5 text-[32px] font-semibold leading-none tracking-[-0.03em] text-fg">
                {p.price}
              </p>
              <p className="mt-2 text-[13px] text-fg-subtle">{p.unit}</p>
              <p className="mt-5 text-[14px] leading-relaxed text-fg-muted">{p.description}</p>
              <div className="mt-6 flex-1">
                <CheckList items={p.features} />
              </div>
              <Link
                href={p.cta.href}
                className={buttonClasses(p.featured ? "primary" : "secondary", "md", "mt-8 w-full")}
              >
                {p.cta.label}
              </Link>
            </Card>
          ))}
        </div>

        {packs.length > 0 && (
          <div className="mt-10">
            <h2 className="text-[15px] font-semibold text-fg">Credit packs</h2>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[480px] border-collapse text-left text-[14px]">
                <thead>
                  <tr className="bg-surface-2 text-[12px] uppercase tracking-[0.06em] text-fg-subtle">
                    <th scope="col" className="px-5 py-3 font-medium">
                      Recordings
                    </th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">
                      Price
                    </th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">
                      Per recording
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {packs.map((p) => (
                    <tr key={p.id} className="border-t border-line">
                      <td className="px-5 py-3.5 text-fg">{p.credits.toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-right font-mono text-[13px] text-fg">
                        {sol(p.lamports)}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-[13px] text-fg-muted">
                        {sol(Math.round(p.lamports / p.credits), 9)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-fg-subtle">
              {billing?.enabled && billing.treasury ? (
                <>
                  Payments go to Stele&apos;s treasury{" "}
                  <span className="break-all font-mono">{billing.treasury}</span> on{" "}
                  {billing.network.label}.{" "}
                </>
              ) : (
                <>Credit purchases are not enabled on this Stele app yet. </>
              )}
              Prices exclude taxes. Operators of self-hosted deployments set their own pricing.
            </p>
          </div>
        )}
      </Section>

      <Section className="border-t border-line bg-bg-raised">
        <SectionHeading
          eyebrow="Network costs"
          title="What Solana charges, in the open."
          lead="Rent keeps evidence accounts on-chain and is paid by whoever creates them. Fees are per transaction. USD figures assume SOL = $150 for illustration; priority fees during congestion are extra."
        />
        <div className="mt-10 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
            <thead>
              <tr className="bg-surface-2 text-[12px] uppercase tracking-[0.06em] text-fg-subtle">
                <th scope="col" className="px-5 py-3 font-medium">
                  Operation
                </th>
                <th scope="col" className="px-5 py-3 text-right font-medium">
                  SOL
                </th>
                <th scope="col" className="px-5 py-3 text-right font-medium">
                  ≈ USD
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Paid by
                </th>
              </tr>
            </thead>
            <tbody>
              {COSTS.map(([op, solCost, usd, payer]) => (
                <tr key={op} className="border-t border-line">
                  <td className="px-5 py-3.5 text-fg">{op}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-[13px] text-fg-muted">
                    {solCost}
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono text-[13px] text-fg-muted">
                    {usd}
                  </td>
                  <td className="px-5 py-3.5 text-[13px] text-fg-muted">{payer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-fg-subtle">
          Storing one acceptance as its own account would cost about 0.0019 SOL in rent. Stele
          records acceptances as signed events plus one bit in a nonce bitmap — more than 150×
          cheaper at scale, with the same verifiability. See{" "}
          <Link href="/docs/how-it-works" className="text-accent hover:text-accent-strong">
            how Stele works
          </Link>
          .
        </p>
      </Section>

      <Section className="border-t border-line">
        <SectionHeading eyebrow="Questions" title="Straight answers." />
        <dl className="mt-10 divide-y divide-line rounded-2xl border border-line">
          {FAQ.map(([q, a]) => (
            <div key={q} className="grid gap-2 px-6 py-5 md:grid-cols-[0.9fr_1.1fr] md:gap-8">
              <dt className="text-[15px] font-medium text-fg">{q}</dt>
              <dd className="text-[14px] leading-relaxed text-fg-muted">{a}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}
