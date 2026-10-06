import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, Badge, Card, CheckIcon, CodeBlock, buttonClasses } from "@stele/ui";
import { CheckList, PageHero, Section, SectionHeading } from "@/components/marketing";

export const metadata: Metadata = {
  title: "Product",
  description:
    "Immutable document versions, wallet-signed acceptances, portable receipts and independent verification.",
};

const RECEIPT_EXCERPT = `{
  "format": "stele-receipt-v1",
  "acceptanceId": "8c1f…e04a",
  "network": { "chainId": "solana:5eykt4Us…", "label": "Solana Mainnet" },
  "transaction": { "signature": "4Nd1…Qz", "slot": 361204118 },
  "acceptance": {
    "signer": "7xKX…AsU",
    "message": "Stele Protocol v1 - Accept Agreement\\n…",
    "signature": "3yZe…9Lw"
  },
  "version": { "number": 2, "label": "2.0", "versionHash": "3f9a…c1d2" }
}`;

function Timeline() {
  const rows = [
    {
      n: 3,
      label: "3.0",
      state: "Current",
      date: "Published Oct 2 · effective Nov 1",
      tone: "accent" as const,
      fp: "a07e 55b1 9c0d 2e4f",
    },
    {
      n: 2,
      label: "2.0",
      state: "Superseded",
      date: "Published Mar 9",
      tone: "neutral" as const,
      fp: "3f9a c1d2 7b18 e630",
    },
    {
      n: 1,
      label: "1.0",
      state: "Superseded",
      date: "Published Jan 14",
      tone: "neutral" as const,
      fp: "d41c 08aa 61f3 9b72",
    },
  ];
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[13px] font-medium text-fg">Version history</p>
        <span className="text-[11.5px] text-fg-subtle">Example</span>
      </div>
      <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[9px] before:top-2 before:w-px before:bg-line-strong">
        {rows.map((r) => (
          <li key={r.n} className="relative flex items-start gap-4 pl-0">
            <span
              className={`relative z-10 mt-1 h-[19px] w-[19px] shrink-0 rounded-full border-2 ${r.tone === "accent" ? "border-accent bg-accent-soft" : "border-line-strong bg-surface"}`}
            />
            <div className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-medium text-fg">Version {r.label}</span>
                <Badge tone={r.tone}>{r.state}</Badge>
                <span className="ml-auto text-[12px] text-fg-subtle">{r.date}</span>
              </div>
              <p className="mt-1.5 font-mono text-[11.5px] text-fg-subtle">fingerprint {r.fp} …</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function AuthorityDiagram() {
  const roles = [
    {
      name: "Owner",
      detail:
        "Squads multisig (recommended). Publishes, manages members, transfers ownership in two steps.",
    },
    { name: "Admins", detail: "Add and revoke publishers; create documents and nonce shards." },
    { name: "Publishers", detail: "Publish new versions of existing documents. Nothing else." },
    {
      name: "Recovery",
      detail:
        "Separate key. Can freeze instantly; can replace the owner only after a 72-hour public timelock.",
    },
  ];
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[13px] font-medium text-fg">Organization authority</p>
        <span className="text-[11.5px] text-fg-subtle">Enforced by the program</span>
      </div>
      <ul className="space-y-2.5">
        {roles.map((r) => (
          <li key={r.name} className="rounded-xl border border-line bg-surface-2 px-4 py-3">
            <p className="text-[13.5px] font-medium text-fg">{r.name}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">{r.detail}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AcceptanceCard() {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold text-fg">Acme Inc.</span>
          <span className="font-mono text-[12px] text-fg-subtle">acme.example</span>
        </div>
        <p className="mt-1 text-[17px] font-semibold tracking-[-0.01em] text-fg">
          Acme Terms of Service
        </p>
        <p className="text-[12.5px] text-fg-subtle">
          Version 2.0 · Effective upon publication · Example
        </p>
      </div>
      <div className="space-y-2 px-5 py-4 text-[12.5px]">
        {[
          "Text hashes to the on-chain content commitment",
          "Fingerprint recomputed from on-chain fields",
          "Version is the document's current version",
          "Message rebuilt locally before your wallet signs",
        ].map((c) => (
          <p key={c} className="flex items-center gap-2 text-fg-muted">
            <CheckIcon className="h-3.5 w-3.5 text-accent" /> {c}
          </p>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
        <span className="text-[12px] text-fg-subtle">
          Your wallet shows the exact text you sign.
        </span>
        <span className={buttonClasses("primary", "sm", "pointer-events-none")}>
          Review &amp; sign
        </span>
      </div>
    </Card>
  );
}

export default function ProductPage() {
  return (
    <>
      <PageHero
        eyebrow="Product"
        title="Evidence infrastructure for the agreements your business runs on."
        lead="Publish terms as immutable, fingerprinted versions. Collect acceptances your users sign with their own keys. Hand anyone a receipt they can verify without asking you."
      >
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard" className={buttonClasses("primary", "md")}>
            Launch Dashboard
          </Link>
          <Link href="/how-it-works" className={buttonClasses("secondary", "md")}>
            How it works <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </PageHero>

      <Section>
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Publishing"
              title="Versions that cannot be quietly edited."
              lead="Write or paste your document, preview the exact canonical bytes, and see the fingerprint before you sign. The program recomputes it and refuses anything else."
            />
            <div className="mt-8">
              <CheckList
                items={[
                  "Deterministic canonicalization with published test vectors",
                  "Every version commits to its predecessor — a tamper-evident chain",
                  "Scheduled effective dates, enforced against Solana cluster time",
                  "Side-by-side change comparison between any two versions",
                  "Content-addressed storage with a CID derived from the hash",
                ]}
              />
            </div>
          </div>
          <Timeline />
        </div>
      </Section>

      <Section className="border-t border-line bg-bg-raised">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <AcceptanceCard />
          <div>
            <SectionHeading
              eyebrow="Acceptance"
              title="Users sign what they read. Nothing else."
              lead="The hosted page and the SDK only display text whose hash matches the chain, rebuild the signing message from on-chain data, and block signing on any mismatch."
            />
            <div className="mt-8">
              <CheckList
                items={[
                  "Works with any Wallet Standard wallet — no extension-specific code",
                  "Users need no SOL: a relayer pays fees but cannot alter the signature",
                  "Single-use nonces, ten-minute windows, network-bound messages",
                  "Optional server-issued acceptance sessions link signatures to your user IDs off-chain",
                ]}
              />
            </div>
          </div>
        </div>
      </Section>

      <Section className="border-t border-line">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Receipts & verification"
              title="Proof that outlives the vendor."
              lead="Every acceptance produces a stele-receipt-v1 bundle. The open-source verifier re-derives every claim from Solana — in the browser, on the command line, or in your own code."
            />
            <div className="mt-8">
              <CheckList
                items={[
                  "Verifies the signature, the exact message, the fingerprint and the content hash",
                  "Cross-checks the publication transaction against the stored version",
                  "Requires agreement between multiple RPC providers when you configure them",
                  "Keeps working if Stele's servers disappear",
                ]}
              />
            </div>
            <Link href="/verify" className={buttonClasses("secondary", "md", "mt-8")}>
              Open the verifier <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
          <CodeBlock code={RECEIPT_EXCERPT} language="receipt.json (excerpt)" />
        </div>
      </Section>

      <Section className="border-t border-line bg-bg-raised">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <AuthorityDiagram />
          <div>
            <SectionHeading
              eyebrow="Identity & authority"
              title="Know who published it. Control who can."
              lead="Organizations prove their domain with a DNS record that Stele attests on-chain. Authority is split into roles the program enforces, with recovery paths designed for real incidents."
            />
            <div className="mt-8">
              <CheckList
                items={[
                  "DNS TXT verification, attested on-chain with an expiry",
                  "Multisig owners, scoped admin and publisher roles",
                  "Key-compromise reports that mark signatures after a point in time",
                  "Emergency freeze and a time-locked recovery authority",
                ]}
              />
            </div>
          </div>
        </div>
      </Section>

      <Section className="border-t border-line">
        <SectionHeading
          align="center"
          eyebrow="Dashboard"
          title="Operate it like infrastructure."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [
              "Analytics",
              "Acceptances per day, completion rates and per-version counts — real numbers from indexed chain events.",
            ],
            [
              "Search",
              "Find acceptances by wallet, document, version, date or your own user reference.",
            ],
            [
              "Audit log",
              "Every sensitive action, hash-chained so tampering with history is detectable.",
            ],
            [
              "Integrations",
              "Scoped API keys, signed webhooks with retries, and an embeddable component.",
            ],
          ].map(([t, d]) => (
            <Card key={t} className="p-6">
              <p className="text-[15px] font-semibold text-fg">{t}</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">{d}</p>
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}
