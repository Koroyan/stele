"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Fingerprint, LockIcon, Spinner } from "@stele/ui";
import { WalletDialog } from "@/components/wallet";
import { errorMessage } from "@/lib/api";
import { safeNext, signInWithWallet } from "@/lib/auth";
import { isUserRejection } from "@/lib/chain";
import { useNetwork, useWallet } from "@/lib/wallet";

export function LoginClient({ next }: { next?: string }) {
  const router = useRouter();
  const network = useNetwork();
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    if (!wallet.address) return;
    setPending(true);
    setError(null);
    try {
      await signInWithWallet(wallet.address, wallet.signMessage);
      router.replace(safeNext(next));
    } catch (e) {
      setError(isUserRejection(e) ? "The signature request was declined." : errorMessage(e));
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <div className="px-6 pb-2 pt-7 sm:px-8">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">Sign in to Stele</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
          Use the wallet that owns or administers your organization. You will sign a short message
          that proves control of the account.
        </p>
      </div>
      <div className="space-y-4 px-6 py-6 sm:px-8">
        {!wallet.ready ? (
          <div className="flex items-center gap-2 text-[13.5px] text-fg-muted">
            <Spinner className="h-4 w-4" /> Looking for wallets…
          </div>
        ) : !wallet.address ? (
          <Button size="lg" className="w-full" onClick={() => setOpen(true)}>
            Connect wallet
          </Button>
        ) : (
          <>
            <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
              <p className="text-[12px] text-fg-subtle">Connected account</p>
              <Fingerprint value={wallet.address} mode="full" className="mt-1" />
            </div>
            <Button size="lg" className="w-full" loading={pending} onClick={() => void signIn()}>
              {pending ? "Waiting for your signature…" : "Sign in with this wallet"}
            </Button>
            <button
              type="button"
              className="w-full text-center text-[13px] text-fg-muted hover:text-fg"
              onClick={() => void wallet.disconnect()}
            >
              Use a different wallet
            </button>
          </>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
      <div className="flex gap-3 border-t border-line px-6 py-5 text-[12.5px] leading-relaxed text-fg-subtle sm:px-8">
        <LockIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          The sign-in message names this site and {network.label}. It cannot accept an agreement,
          move funds or authorize a transaction. Stele never asks for your seed phrase.
        </p>
      </div>
      <WalletDialog open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}
