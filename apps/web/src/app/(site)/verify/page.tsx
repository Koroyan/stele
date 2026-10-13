import type { Metadata } from "next";
import { NetworkBoundary } from "@/components/network-boundary";
import { REPO_URL } from "@/lib/env";
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

        <section
          aria-labelledby="without-stele"
          className="mt-12 rounded-xl border border-line bg-bg-raised p-6"
        >
          <h2 id="without-stele" className="text-[17px] font-semibold text-fg">
            Open source — and it keeps working without Stele
          </h2>
          <ul className="mt-4 space-y-2.5 text-[14px] leading-relaxed text-fg-muted">
            <li>
              <span className="font-medium text-fg">Every acceptance lives on Solana,</span> not in
              Stele&apos;s database: the signature, the exact message and the document fingerprint.
              If this website disappeared tomorrow, they would still be there.
            </li>
            <li>
              <span className="font-medium text-fg">Keep the receipt (PDF or JSON).</span> It holds
              the document text too, so it can be verified against any Solana RPC with no Stele
              server at all.
            </li>
            <li>
              <span className="font-medium text-fg">The verifier is open source</span> (Apache 2.0):
              this page runs it in your browser, and anyone can run the same checks with{" "}
              <code className="font-mono text-[12.5px] text-fg">npx @stelehq/verifier</code>.
            </li>
          </ul>
          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13.5px]">
            {REPO_URL && (
              <a
                href={`${REPO_URL}/tree/main/packages/verifier`}
                className="text-accent hover:underline"
                rel="noreferrer noopener"
              >
                Verifier source code
              </a>
            )}
            <a
              href="https://www.npmjs.com/package/@stelehq/verifier"
              className="text-accent hover:underline"
              rel="noreferrer noopener"
            >
              @stelehq/verifier on npm
            </a>
            <a href="/docs/trust-model" className="text-accent hover:underline">
              Trust model
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
