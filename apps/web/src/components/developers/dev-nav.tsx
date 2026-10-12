"use client";
/** The developers section's tabs: one place per topic, the same on every developers page. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@stele/ui";

const TABS = [
  { href: "/developers", label: "Overview" },
  { href: "/developers/sdk", label: "SDK" },
  { href: "/developers/api", label: "API" },
  { href: "/developers/onchain", label: "On-chain" },
];

export function DevNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Developers"
      className="sticky top-16 z-20 border-b border-line bg-bg/85 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 sm:px-6">
        <span className="mr-3 hidden shrink-0 text-[12px] font-semibold uppercase tracking-[0.1em] text-fg-subtle sm:inline">
          Developers
        </span>
        {TABS.map((t) => {
          const active =
            t.href === "/developers" ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 py-3.5 text-[13.5px] font-medium transition-colors",
                active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {t.label}
            </Link>
          );
        })}
        <span className="ml-auto hidden shrink-0 gap-4 pl-4 text-[12.5px] md:flex">
          <Link href="/docs/get-started" className="text-fg-subtle hover:text-fg">
            Proof guide
          </Link>
          <Link href="/docs/gate-guide" className="text-fg-subtle hover:text-fg">
            Gate guide
          </Link>
        </span>
      </div>
    </nav>
  );
}
