import type { Metadata } from "next";
import Link from "next/link";
import { SteleLogo } from "@stele/ui";
import { NetworkBoundary } from "@/components/network-boundary";
import { LoginClient } from "./login-client";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div
        className="glow-top pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        aria-hidden="true"
      />
      <header className="relative mx-auto flex h-16 w-full max-w-6xl items-center px-4 sm:px-6">
        <Link href="/" aria-label="Stele home">
          <SteleLogo />
        </Link>
      </header>
      <main
        id="main"
        className="relative flex flex-1 items-start justify-center px-4 pb-16 pt-10 sm:pt-20"
      >
        <NetworkBoundary>
          <LoginClient next={typeof next === "string" ? next : undefined} />
        </NetworkBoundary>
      </main>
    </div>
  );
}
