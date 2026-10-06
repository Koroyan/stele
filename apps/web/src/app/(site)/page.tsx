import Link from "next/link";
import { buildAcceptanceMessage, sha256, toBase58, utf8 } from "@stele/protocol";
import {
  ArrowRightIcon,
  CodeBlock,
  GlobeIcon,
  HashIcon,
  KeyIcon,
  LayersIcon,
  LockIcon,
  ShieldIcon,
  UsersIcon,
  buttonClasses,
} from "@stele/ui";
import { CheckList, Eyebrow, FeatureCard, Section, SectionHeading } from "@/components/marketing";
import { Pipeline } from "@/components/pipeline";

// An example message, produced by the same builder the protocol uses (values are illustrative).
const EXAMPLE_MESSAGE = buildAcceptanceMessage(
  {
    orgName: "Acme Inc.",
    orgVerifiedDomain: "acme.example",
    title: "Acme Terms of Service",
    versionLabel: "2.0",
    version: 2,
    versionHash: sha256(utf8("illustrative fingerprint")),
    signer: toBase58(sha256(utf8("illustrative signer"))),
    networkLabel: "Solana Mainnet",
    issuedAt: 1_790_000_000,
    expiresAt: 1_790_000_600,
    shardId: 0,
    nonceIndex: 1842,
    nonceTag: sha256(utf8("illustrative nonce")).slice(0, 8),
  },
  "acme.example",
);

const MESSAGE_NOTES = [
  {
    line: "Organization",
    note: "Who is asking — with its DNS-verified domain, or an explicit “unverified”.",
  },
  { line: "Fingerprint", note: "Binds the signature to one exact, immutable version of the text." },
  { line: "Network", note: "A devnet signature can never be replayed as mainnet evidence." },
  { line: "Expires · Nonce", note: "Single-use and time-boxed: the program refuses replays." },
  { line: "Requested by", note: "The site that requested the signature — a phishing tell." },
];

const COMPARISON = [
  [
    "Which text was accepted",
    "Whatever the database says today",
    "A SHA-256 fingerprint committed on Solana before anyone accepts",
  ],
  [
    "Who accepted",
    "A user ID in your own database",
    "A user-verified passkey signature (or a wallet signature) over the exact version",
  ],
  ["When", "Your server's clock", "Solana cluster time and slot, set by the network"],
  [
    "Can it be edited later",
    "Yes — silently",
    "No. Versions are immutable; acceptances are append-only",
  ],
  [
    "Who can check it",
    "Only you, by trusting your systems",
    "Anyone, with open-source tools and any Solana RPC",
  ],
];

const SDK_SNIPPET = `<!-- Where your terms should appear -->
<div data-stele-organization="acme.com" data-stele-document="terms-of-service"></div>
<script src="https://app.stele.example/sdk/v1/stele.js" defer></script>

<script>
  document.addEventListener("stele:accepted", ({ detail }) => {
    // detail.acceptanceId, detail.transactionSignature: the proof lives on Solana
  });
</script>`;

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div
          className="glow-top pointer-events-none absolute inset-x-0 top-0 h-[520px]"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-28">
          <div className="animate-fade-up mx-auto max-w-3xl text-center">
            <Link
              href="/docs/protocol"
              className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface/60 px-3 py-1 text-[12.5px] text-fg-muted backdrop-blur transition-colors hover:text-fg"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              Open protocol · stele/2 · native passkeys
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
            <p className="mt-7 text-[13px] font-medium uppercase tracking-[0.14em] text-accent">
              Verifiable consent for the web
            </p>
            <h1 className="mt-3 text-balance text-[46px] font-semibold leading-[1.02] tracking-[-0.04em] text-fg sm:text-[72px]">
              Prove what was agreed.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-[17px] leading-relaxed text-fg-muted sm:text-[18px]">
              Stele seals every version of your terms on Solana. Your users accept the exact text
              with a passkey — Face ID, Touch ID, Windows Hello — with no wallet and no fees, and
              take a receipt anyone can verify without you or us. No one can quietly rewrite it.
            </p>
            <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <Link href="/dashboard" className={buttonClasses("primary", "lg")}>
                Launch Dashboard
              </Link>
              <Link href="/verify" className={buttonClasses("secondary", "lg")}>
                Verify Agreement
              </Link>
            </div>
            <Link
              href="/how-it-works"
              className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:text-accent-strong"
            >
              ▶ See how it works, step by step
            </Link>
            <p className="mt-3 text-[13px] text-fg-subtle">
              Don&apos;t trust the website. Verify the evidence.
            </p>
          </div>
          <Pipeline />
        </div>
      </section>

      {/* The problem */}
      <Section className="border-t border-line">
        <SectionHeading
          eyebrow="The problem"
          title={<>Today, &ldquo;I agree&rdquo; is a row in someone&apos;s database.</>}
          lead="When a dispute comes, the only record of what a user accepted is controlled by one of the parties. Stele replaces trust in that record with evidence anyone can check."
        />
        <div className="mt-12 overflow-hidden rounded-2xl border border-line">
          <table className="w-full border-collapse text-left text-[14px]">
            <caption className="sr-only">Clickwrap logs compared with Stele evidence</caption>
            <thead>
              <tr className="bg-surface-2 text-[12.5px] uppercase tracking-[0.06em] text-fg-subtle">
                <th scope="col" className="w-[26%] px-5 py-3 font-medium" />
                <th scope="col" className="px-5 py-3 font-medium">
                  Typical clickwrap log
                </th>
                <th scope="col" className="px-5 py-3 font-medium text-accent">
                  Stele
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map(([q, before, after]) => (
                <tr key={q} className="border-t border-line align-top">
                  <th scope="row" className="px-5 py-4 font-medium text-fg">
                    {q}
                  </th>
                  <td className="px-5 py-4 text-fg-subtle">{before}</td>
                  <td className="px-5 py-4 text-fg">{after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* How it works */}
      <Section className="border-t border-line bg-bg-raised">
        <SectionHeading
          eyebrow="How it works"
          title="Publish. Accept. Verify."
          lead="Three steps, each one independently checkable."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {[
            {
              n: "01",
              title: "Publish an immutable version",
              body: "Your document is canonicalized into exact bytes and hashed. Your organization's authority — ideally a multisig — signs the publication. The program recomputes the fingerprint on-chain and links it to the previous version. Published versions can never be edited.",
            },
            {
              n: "02",
              title: "Users accept with a passkey",
              body: "The acceptance page shows only text whose hash matches the chain. The user approves with a passkey — no wallet, no SOL; the private key never leaves their device. Solana verifies the P-256 signature, and the program checks it covers this exact version, this site and a single-use nonce. Wallets work too.",
            },
            {
              n: "03",
              title: "Anyone verifies independently",
              body: "Each acceptance yields a portable receipt with the exact text. The open-source verifier checks it against any Solana RPC — signature, passkey data, browser-attested origin, fingerprint, content hash, authority, nonce — with Stele switched off.",
            },
          ].map((s) => (
            <div
              key={s.n}
              className="rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-card)]"
            >
              <p className="font-mono text-[12px] text-accent">{s.n}</p>
              <h3 className="mt-3 text-[17px] font-semibold tracking-[-0.015em] text-fg">
                {s.title}
              </h3>
              <p className="mt-3 text-[14px] leading-relaxed text-fg-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* What users sign */}
      <Section className="border-t border-line">
        <div className="grid items-start gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <SectionHeading
              eyebrow="What users sign"
              title="Human-readable. Domain-separated. Single-use."
              lead="Every acceptance is a fixed, versioned template that names exactly what is being accepted, where, and for how long. A wallet displays it; a passkey signs a challenge computed from it (passkey prompts show the site, so the signing page shows the text — only hash-verified text)."
            />
            <div className="mt-8 overflow-hidden rounded-2xl border border-line bg-[#060a0f] shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <span className="text-[12px] text-fg-subtle">Signed message · example</span>
                <span className="font-mono text-[11px] text-fg-subtle">stele-acceptance-v1</span>
              </div>
              <pre className="overflow-x-auto p-5 font-mono text-[12px] leading-[1.75] text-fg sm:text-[12.5px]">
                {EXAMPLE_MESSAGE}
              </pre>
            </div>
          </div>
          <div className="lg:pt-28">
            <dl className="space-y-5">
              {MESSAGE_NOTES.map((n) => (
                <div key={n.line} className="border-l-2 border-accent-line pl-4">
                  <dt className="font-mono text-[12.5px] text-accent">{n.line}</dt>
                  <dd className="mt-1 text-[14px] leading-relaxed text-fg-muted">{n.note}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Section>

      {/* Security */}
      <Section className="border-t border-line bg-bg-raised">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <SectionHeading
            eyebrow="Security model"
            title="Designed for the day someone wants the record to say something else."
          />
          <Link href="/security" className={buttonClasses("secondary", "md", "shrink-0")}>
            Read the security model <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={<HashIcon className="h-[18px] w-[18px]" />}
            title="Unambiguous hashing"
          >
            One canonical byte representation per document, with shared Rust and TypeScript test
            vectors. The fingerprint also commits to the organization, document, version chain,
            network and program.
          </FeatureCard>
          <FeatureCard
            icon={<KeyIcon className="h-[18px] w-[18px]" />}
            title="Signatures verified on-chain"
          >
            The Solana program checks the Ed25519 signature itself and rebuilds the signed message
            from chain state. A relayer cannot forge, alter or replay an acceptance.
          </FeatureCard>
          <FeatureCard
            icon={<LayersIcon className="h-[18px] w-[18px]" />}
            title="Immutable version chain"
          >
            Each version commits to its predecessor. There is no instruction to edit or delete a
            version — not for you, not for us.
          </FeatureCard>
          <FeatureCard
            icon={<UsersIcon className="h-[18px] w-[18px]" />}
            title="Real authority controls"
          >
            Multisig owners, scoped publisher roles, two-step ownership transfer, a time-locked
            recovery authority and an emergency freeze.
          </FeatureCard>
          <FeatureCard
            icon={<GlobeIcon className="h-[18px] w-[18px]" />}
            title="Verified organizations"
          >
            Display names are never trusted. Domains are verified through DNS and attested on-chain,
            and the signed message says which.
          </FeatureCard>
          <FeatureCard
            icon={<LockIcon className="h-[18px] w-[18px]" />}
            title="No personal data on-chain"
          >
            The chain holds hashes, public keys and timestamps — never names, emails or IP
            addresses. Passkey keys differ per site, account links are salted commitments, and
            linking a key to a customer stays in your systems.
          </FeatureCard>
        </div>
      </Section>

      {/* Developers */}
      <Section className="border-t border-line">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="For developers"
              title="Two lines on your page. Proof anyone can check."
              lead="The widget shows your terms on your own site, verifies them against Solana and lets visitors accept with a passkey or a wallet. Link acceptances to your users and receive signed webhooks that point to on-chain proof."
            />
            <div className="mt-8">
              <CheckList
                items={[
                  "Embeddable widget, React component and server helpers",
                  "REST API with scoped, hashed API keys and rate limits",
                  "Webhooks signed with HMAC-SHA256 and replay windows",
                  "Open-source verifier library and CLI",
                ]}
              />
            </div>
            <Link href="/developers" className={buttonClasses("secondary", "md", "mt-8")}>
              Get started <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
          <CodeBlock code={SDK_SNIPPET} language="html" />
        </div>
      </Section>

      {/* Boundaries */}
      <Section className="border-t border-line bg-bg-raised">
        <SectionHeading
          eyebrow="Honest boundaries"
          title="What a signature proves — and what it doesn't."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
            <p className="text-[15px] font-semibold text-fg">Stele evidence proves</p>
            <div className="mt-4">
              <CheckList
                items={[
                  "This exact document text existed, unaltered, under this fingerprint",
                  "It was published by the organization's authorized key at a recorded time",
                  "A specific credential — a passkey with user verification, or a wallet key — accepted that exact version on that site",
                  "The acceptance was recorded on Solana at a specific slot and time",
                ]}
              />
            </div>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
            <p className="text-[15px] font-semibold text-fg">It does not, by itself, prove</p>
            <div className="mt-4">
              <CheckList
                tone="muted"
                items={[
                  "The legal identity of the person controlling the passkey or wallet",
                  "What a passkey prompt displayed — it shows the site; the page shows the text",
                  "That the person read or understood the document",
                  "That an organization's display name is its real legal name (domain verification is the signal)",
                  "That an agreement is enforceable — that depends on law and circumstances",
                ]}
              />
            </div>
          </div>
        </div>
      </Section>

      {/* CTA */}
      <section className="relative overflow-hidden border-t border-line">
        <div className="glow-top pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
          <Eyebrow>Get started</Eyebrow>
          <h2 className="mt-4 text-balance text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] text-fg sm:text-[44px]">
            Make your terms verifiable.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-fg-muted">
            Create an organization with your wallet, publish your first version on devnet, and
            verify an acceptance in minutes.
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Link href="/dashboard" className={buttonClasses("primary", "lg")}>
              Launch Dashboard
            </Link>
            <Link href="/docs" className={buttonClasses("ghost", "lg")}>
              Read the docs
            </Link>
          </div>
          <div className="mt-10 inline-flex items-center gap-2 text-[12.5px] text-fg-subtle">
            <ShieldIcon className="h-4 w-4" /> Open specification · open-source verifier · no
            lock-in
          </div>
        </div>
      </section>
    </>
  );
}
