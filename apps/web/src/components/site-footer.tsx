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
      { href: "/docs/get-started", label: "Get started" },
      { href: "/docs/gate", label: "Stele Gate guide" },
      { href: "/developers", label: "SDK & API" },
      { href: "/docs/api", label: "SDK & API reference" },
      { href: "/docs/spec", label: "Protocol specification" },
      { href: "/docs/canonicalization", label: "Canonicalization" },
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
              Source code
            </a>
          )}
        </div>
      </div>
    </footer>
  );
}
