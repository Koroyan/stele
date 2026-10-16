import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FocusShell } from "@/components/focus-shell";
import { NetworkBoundary } from "@/components/network-boundary";
import { VerifiedClient } from "./verified-client";

export const metadata: Metadata = {
  title: "Stele Verified",
  description:
    "Evidence that a Solana program refuses its protected action until the wallet has accepted the current terms.",
};

export default async function VerifiedPage({ params }: { params: Promise<{ program: string }> }) {
  const { program } = await params;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(program)) notFound();
  return (
    <FocusShell
      note="Checked on Solana — re-check it in your browser"
      footer={
        <>
          Stele Verified describes the behaviour of a deployed program, checked by simulation and
          re-checked after every upgrade. It is not an audit of the program.{" "}
          <Link
            href="/docs/gate#stele-verified"
            className="text-fg-muted underline-offset-2 hover:underline"
          >
            How verification works
          </Link>
        </>
      }
    >
      <NetworkBoundary>
        <VerifiedClient program={program} />
      </NetworkBoundary>
    </FocusShell>
  );
}
