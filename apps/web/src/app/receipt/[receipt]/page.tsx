import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FocusShell } from "@/components/focus-shell";
import { NetworkBoundary } from "@/components/network-boundary";
import { ReceiptClient } from "./receipt-client";

export const metadata: Metadata = {
  title: "Acceptance receipt",
  description: "A verifiable record of an agreement acceptance on Solana.",
  robots: { index: false, follow: false },
};

export default async function ReceiptPage({ params }: { params: Promise<{ receipt: string }> }) {
  const { receipt } = await params;
  const id = receipt.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) notFound();
  return (
    <FocusShell>
      <NetworkBoundary>
        <ReceiptClient acceptanceId={id} />
      </NetworkBoundary>
    </FocusShell>
  );
}
