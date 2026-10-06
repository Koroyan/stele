import type { Metadata } from "next";
import { NetworkBoundary } from "@/components/network-boundary";
import { VerifyClient } from "./verify-client";

export const metadata: Metadata = {
  title: "Verify an agreement",
  description:
    "Verify Stele evidence in your browser against Solana RPC endpoints you choose — without trusting Stele.",
};

type Search = { tx?: string; acceptance?: string; version?: string; fingerprint?: string };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const pick = (v: unknown) => (typeof v === "string" && v.length <= 128 ? v : undefined);
  return (
    <div className="relative">
      <div
        className="glow-top pointer-events-none absolute inset-x-0 top-0 h-[320px]"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-4xl px-4 pb-24 pt-14 sm:px-6 sm:pt-20">
        <p className="text-[12.5px] font-medium uppercase tracking-[0.12em] text-accent">
          Independent verification
        </p>
        <h1 className="mt-3 text-balance text-[34px] font-semibold leading-tight tracking-[-0.03em] text-fg sm:text-[44px]">
          Verify an agreement
        </h1>
        <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-fg-muted">
          Paste a transaction signature, upload a receipt, or look up a document version. The check
          runs in your browser against the Solana RPC endpoints listed below — change them to
          providers you trust. Nothing is taken from Stele&apos;s database.
        </p>
        <div className="mt-10">
          <NetworkBoundary>
            <VerifyClient
              initial={{
                tx: pick(sp.tx),
                acceptance: pick(sp.acceptance),
                version: pick(sp.version),
                fingerprint: pick(sp.fingerprint),
              }}
            />
          </NetworkBoundary>
        </div>
      </div>
    </div>
  );
}
