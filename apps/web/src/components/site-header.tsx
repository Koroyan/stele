"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SteleLogo, buttonClasses, cn } from "@stele/ui";
import { NetworkSwitcher } from "@/components/network-switcher";

const NAV = [
  { href: "/proof", label: "Proof" },
  { href: "/gate", label: "Gate" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/developers", label: "Developers" },
  { href: "/demo", label: "Live demo" },
  { href: "/docs", label: "Docs" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-colors duration-200",
        scrolled || open
          ? "border-line bg-bg/85 backdrop-blur-xl"
          : "border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4 sm:px-6">
        <Link href="/" aria-label="Stele home" className="shrink-0">
          <SteleLogo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[13.5px] transition-colors",
                  active ? "text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <NetworkSwitcher variant="header" className="mr-1" />
          <Link href="/verify" className={buttonClasses("ghost", "sm")}>
            Verify agreement
          </Link>
          <Link href="/dashboard" className={buttonClasses("primary", "sm")}>
            Launch dashboard
          </Link>
        </div>
        <button
          type="button"
          className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            {open ? (
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>
      {open && (
        <nav
          id="mobile-nav"
          aria-label="Main"
          className="border-t border-line px-4 pb-4 pt-2 md:hidden"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-2 py-2.5 text-[15px] text-fg-muted hover:text-fg"
            >
              {item.label}
            </Link>
          ))}
          <NetworkSwitcher variant="header" className="mt-3 px-2" />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link href="/verify" className={buttonClasses("secondary", "md")}>
              Verify
            </Link>
            <Link href="/dashboard" className={buttonClasses("primary", "md")}>
              Dashboard
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
