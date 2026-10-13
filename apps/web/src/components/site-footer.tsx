import Link from "next/link";
import { SteleLogo } from "@stele/ui";
import { REPO_URL } from "@/lib/env";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/proof", label: "Stele Proof" },
      { href: "/gate", label: "Stele Gate" },
      { href: "/demo", label: "Live demo" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/verify", label: "Verify an agreement" },
      { href: "/dashboard", label: "Dashboard" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/developers", label: "Overview" },
      { href: "/docs/get-started", label: "Proof guide" },
      { href: "/docs/gate-guide", label: "Gate guide" },
      { href: "/developers/sdk", label: "SDK reference" },
      { href: "/developers/api", label: "API explorer" },
      { href: "/developers/onchain", label: "On-chain reference" },
      { href: "/docs/spec", label: "Protocol specification" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/security", label: "Security" },
      { href: "/docs/trust-model", label: "Trust model" },
      { href: "/docs/threat-model", label: "Threat model" },
      { href: "/docs/security", label: "Security architecture" },
      { href: "/docs/acceptance-signing", label: "What a signature proves" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-bg-raised">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-xs">
            <SteleLogo />
            <p className="mt-4 text-[13.5px] leading-relaxed text-fg-muted">
              Cryptographic evidence of what was published and what was accepted — verifiable by
              anyone against Solana, without Stele&apos;s servers.
            </p>
            <a
              href="https://x.com/stelehq"
              aria-label="Stele on X"
              className="mt-5 inline-flex items-center gap-2 text-[13.5px] text-fg-muted transition-colors hover:text-fg"
              rel="noreferrer noopener"
              target="_blank"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L2.9 2h6.4l4.4 5.9L18.9 2Zm-1.1 18h1.7L8.3 3.9H6.5L17.8 20Z" />
              </svg>
              @stelehq
            </a>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
                {col.title}
              </p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-[13.5px] text-fg-muted transition-colors hover:text-fg"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-4 border-t border-line pt-6 text-[12.5px] leading-relaxed text-fg-subtle md:flex-row md:items-start md:justify-between">
          <p className="max-w-3xl">
            Stele provides technical evidence: it proves that a specific wallet key signed
            acceptance of a specific, unaltered document version at a recorded time. It does not by
            itself establish a person&apos;s legal identity, and whether an agreement is enforceable
            depends on applicable law and the circumstances of acceptance. Stele is not a law firm
            and does not provide legal advice.
          </p>
          {REPO_URL && (
            <a
              href={REPO_URL}
              className="shrink-0 text-fg-muted hover:text-fg"
              rel="noreferrer noopener"
            >
              Open source · Apache 2.0
            </a>
          )}
        </div>
      </div>
    </footer>
  );
}
