import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, Card, buttonClasses } from "@stele/ui";
import { CheckList, PageHero, Section, SectionHeading } from "@/components/marketing";

export const metadata: Metadata = {
  title: "Security",
  description: "Stele's trust model, cryptography, threat coverage and operational security.",
};

const PRIMITIVES = [
  [
    "Content commitment",
    "SHA-256 over stele-canonical-v1 bytes (RFC 8785 JSON, NFC text, forbidden invisible and bidirectional characters)",
  ],
  [
    "Version fingerprint",
    "SHA-256 over a canonical record of chain ID, program, organization, document, version number, predecessor, title, label, effective date and content hash — recomputed by the program",
  ],
  [
    "User signatures",
    "Ed25519 over a human-readable, domain-separated message; verified on-chain through Solana's Ed25519 program with strict instruction introspection",
  ],
  [
    "Replay protection",
    "Per-organization nonce bitmaps (65,536 single-use nonces per shard) and short validity windows (ten minutes by default) checked against cluster time",
  ],
  [
    "Network separation",
    "CAIP-2 chain ID derived from the genesis hash is part of every fingerprint; the network name is part of every signed message",
  ],
  [
    "Acceptance identifiers",
    "SHA-256 with a protocol tag over version, signer, message hash and signature; folded into an on-chain accumulator per shard",
  ],
];

const THREATS = [
  {
    title: "Rewriting what was accepted",
    body: "Versions are immutable accounts with no update or close instruction. Each commits to its predecessor; the text is bound by hash. A company cannot swap the document after the fact, backdate it, or publish one text while displaying another.",
    refs: "T01–T10, T56–T58",
  },
  {
    title: "Forging or replaying acceptances",
    body: "The program verifies the user's signature itself and rebuilds the signed message from chain state. Messages bind organization, document, version, fingerprint, signer, network, expiry and a single-use nonce. The relayer and the database cannot create, alter or replay one.",
    refs: "T15–T28, T53, A02–A04",
  },
  {
    title: "Phishing and impersonation",
    body: "Display names are never treated as identity. Domains are verified through DNS and attested on-chain with an expiry, the signed message states “verified” or “unverified”, and names the requesting site. Invisible and bidirectional control characters are rejected by the protocol, and domains must be plain ASCII (punycode).",
    refs: "T13, T14, T20, A05, A06, A23",
  },
  {
    title: "Compromised keys and insiders",
    body: "Scoped roles, multisig owners, two-step ownership transfer, a time-locked recovery authority, an emergency freeze, and key-compromise reports that flag later signatures by a revoked key.",
    refs: "T11, T12, T35–T41, A09",
  },
  {
    title: "Compromised Stele infrastructure",
    body: "Our database, API and indexer are conveniences, not trust anchors. The verifier, the SDK and the acceptance page check everything against Solana and content hashes; multiple RPC providers can be required to agree.",
    refs: "T29–T34, T42, T49–T51, T59",
  },
  {
    title: "Abuse and denial of service",
    body: "Relayer-gated nonce shards, per-organization caps on open challenges, rate limits, server-issued acceptance sessions, and transaction sizes that always fit Solana's packet limit.",
    refs: "T54, T55, A07, A08",
  },
];

export default function SecurityPage() {
  return (
    <>
      <PageHero
        eyebrow="Security"
        title="Evidence you can check, so you don't have to trust us."
        lead="Stele is built so that the people with the most power over the record — the company, its employees, and Stele itself — cannot quietly change it. This page summarizes how."
      >
        <div className="flex flex-wrap gap-3">
          <Link href="/docs/threat-model" className={buttonClasses("primary", "md")}>
            Read the threat model
          </Link>
          <Link href="/docs/security" className={buttonClasses("secondary", "md")}>
            Security architecture <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </PageHero>

      <Section>
        <SectionHeading eyebrow="Trust model" title="What you trust — and what you don't." />
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2">
          <Card className="p-6">
            <p className="text-[15px] font-semibold text-fg">You rely on</p>
            <div className="mt-4">
              <CheckList
                items={[
                  "Solana consensus and the integrity of finalized blocks",
                  "SHA-256 and Ed25519",
                  "The Stele program at a build you can reproduce from source — upgradeable today by a single key, moving to a multisig before Mainnet",
                  "The DNS attestor, only for the meaning of “verified domain”",
                ]}
              />
            </div>
          </Card>
          <Card className="p-6">
            <p className="text-[15px] font-semibold text-fg">You do not need to trust</p>
            <div className="mt-4">
              <CheckList
                tone="muted"
                items={[
                  "Stele's servers, database or indexer",
                  "The relayer that pays transaction fees",
                  "The website showing you a receipt — including this one",
                  "Any single RPC provider, when you configure several",
                ]}
              />
            </div>
          </Card>
        </div>
      </Section>

      <Section className="border-t border-line bg-bg-raised">
        <SectionHeading
          eyebrow="Threat coverage"
          title="Sixty-plus attack scenarios, each with a defense."
          lead="Every scenario in the threat model lists the attack, impact, defense, detection, recovery and residual risk. The main families:"
        />
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {THREATS.map((t) => (
            <Card key={t.title} className="flex flex-col p-6">
              <p className="text-[15px] font-semibold text-fg">{t.title}</p>
              <p className="mt-2 flex-1 text-[13.5px] leading-relaxed text-fg-muted">{t.body}</p>
              <p className="mt-4 font-mono text-[11.5px] text-fg-subtle">{t.refs}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section className="border-t border-line">
        <SectionHeading
          eyebrow="Cryptography"
          title="Boring, well-understood primitives — composed carefully."
        />
        <div className="mt-10 overflow-hidden rounded-2xl border border-line">
          <table className="w-full border-collapse text-left text-[14px]">
            <caption className="sr-only">Cryptographic constructions used by the protocol</caption>
            <tbody>
              {PRIMITIVES.map(([k, v]) => (
                <tr key={k} className="border-t border-line first:border-t-0 align-top">
                  <th scope="row" className="w-[28%] bg-surface-2 px-5 py-4 font-medium text-fg">
                    {k}
                  </th>
                  <td className="px-5 py-4 leading-relaxed text-fg-muted">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section className="border-t border-line bg-bg-raised">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="Application security" title="The web layer is hardened too." />
            <div className="mt-8">
              <CheckList
                items={[
                  "Strict Content Security Policy: scripts run only with a per-request nonce; framing denied",
                  "Wallet sign-in with single-use nonces; HttpOnly session cookies; CSRF tokens plus Origin checks",
                  "Recent wallet re-authentication required for API keys, webhooks and settings",
                  "API keys and session tokens stored only as hashes; webhook secrets encrypted at rest",
                  "Outbound requests resolved and pinned to public IPs (SSRF protection)",
                  "Append-only, hash-chained audit log enforced by a database trigger",
                ]}
              />
            </div>
          </div>
          <div>
            <SectionHeading eyebrow="Operations" title="Keys with the least possible power." />
            <div className="mt-8">
              <CheckList
                items={[
                  "The relayer key only pays fees; it cannot create or alter evidence",
                  "The attestor key can only vouch for domains, with expiry, and can be rotated",
                  "Program upgrades: a single key on Devnet today, a multisig before Mainnet; verifiable builds let anyone match the deployed bytecode",
                  "The verifier detects post-upgrade tampering by cross-checking publication transactions",
                  "No private keys or seed phrases are ever stored or requested",
                ]}
              />
            </div>
          </div>
        </div>
      </Section>

      <Section className="border-t border-line">
        <div className="grid grid-cols-1 items-center gap-8 rounded-2xl border border-line bg-surface p-8 md:grid-cols-[1fr_auto]">
          <div>
            <p className="text-[18px] font-semibold tracking-[-0.01em] text-fg">
              Found a vulnerability?
            </p>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-fg-muted">
              Please report it privately following our security policy. We acknowledge reports
              promptly, coordinate disclosure, and credit researchers who want to be credited.
            </p>
          </div>
          <Link href="/docs/security-policy" className={buttonClasses("secondary", "md")}>
            Security policy <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </Section>
    </>
  );
}
