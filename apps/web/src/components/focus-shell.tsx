/** Minimal chrome for trust-critical pages (acceptance, receipts): no distractions, clear provenance. */
import Link from "next/link";
import type { ReactNode } from "react";
import { LockIcon, SteleLogo } from "@stele/ui";

export function FocusShell({
  children,
  aside,
  note = "Checked in your browser against Solana",
  footer,
}: {
  children: ReactNode;
  aside?: ReactNode;
  /** The provenance line in the header. */
  note?: ReactNode;
  /** Replaces the default footer (what a signature proves). */
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="Stele home">
            <SteleLogo />
          </Link>
          <span className="hidden items-center gap-1.5 text-[12.5px] text-fg-subtle sm:inline-flex">
            <LockIcon className="h-3.5 w-3.5" /> {note}
          </span>
          <div className="ml-auto">{aside}</div>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto max-w-5xl px-4 py-6 text-[12px] leading-relaxed text-fg-subtle sm:px-6">
          {footer ?? (
            <>
              A signature proves that a key (a wallet, or a passkey-protected Stele key) authorized
              an exact document version or statement. It does not by itself identify the person
              controlling the key, and enforceability depends on applicable law.{" "}
              <Link
                href="/docs/acceptance-signing"
                className="text-fg-muted underline-offset-2 hover:underline"
              >
                What a signature proves
              </Link>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
