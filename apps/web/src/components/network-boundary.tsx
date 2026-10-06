/** Server component: loads the advertised network identity and provides it (and wallets) to children. */
import type { ReactNode } from "react";
import { AlertIcon } from "@stele/ui";
import { getNetworkInfo } from "@/lib/server";
import { AppProviders } from "@/lib/wallet";

export async function NetworkBoundary({ children }: { children: ReactNode }) {
  const network = await getNetworkInfo();
  if (!network) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-24 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-warning-line bg-warning-soft text-warning">
          <AlertIcon className="h-5 w-5" />
        </div>
        <h1 className="mt-5 text-[20px] font-semibold text-fg">The Stele API is unavailable</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
          This page needs the API to describe the network it serves. Evidence already on Solana is
          unaffected and can be verified with the open-source CLI against any RPC endpoint.
        </p>
      </div>
    );
  }
  return <AppProviders network={network}>{children}</AppProviders>;
}
