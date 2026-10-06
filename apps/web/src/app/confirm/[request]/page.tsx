import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FocusShell } from "@/components/focus-shell";
import { NetworkBoundary } from "@/components/network-boundary";
import { ConfirmClient } from "./confirm-client";

export const metadata: Metadata = {
  title: "Confirm",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Hosted proof confirmation (`confirmUrl` of a proof request). The client token travels in the URL
 * fragment, which browsers never send to the server.
 */
export default async function ConfirmPage({ params }: { params: Promise<{ request: string }> }) {
  const { request } = await params;
  if (!UUID.test(request)) notFound();
  return (
    <NetworkBoundary>
      <FocusShell>
        <ConfirmClient requestId={request} />
      </FocusShell>
    </NetworkBoundary>
  );
}
