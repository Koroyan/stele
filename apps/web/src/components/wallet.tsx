"use client";

import { useState } from "react";
import { Alert, Button, Dialog, Spinner, WalletIcon, cn } from "@stele/ui";
import { errorMessage } from "@/lib/api";
import { isUserRejection } from "@/lib/chain";
import { shortAddress } from "@/lib/format";
import { useNetwork, useWallet } from "@/lib/wallet";

/**
 * Wallets report their own internal failures (a suspended extension worker, a locked vault) with
 * generic messages such as "Unexpected error"; say what usually fixes them.
 */
function walletFailureMessage(walletName: string, e: unknown): string {
  const message = errorMessage(e);
  const code = (e as { code?: unknown } | null)?.code;
  if (code === -32603 || /^(unexpected|internal) error\.?$/i.test(message.trim())) {
    return `${walletName} reported an internal error ("${message}"). Open the ${walletName} extension and unlock it, then reload this page and try again.`;
  }
  return message;
}

/** Lists Wallet Standard wallets that support this network and connects the chosen one. */
export function WalletDialog({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected?: (address: string) => void;
}) {
  const { state, connect } = useWallet();
  const network = useNetwork();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(wallet: (typeof state.wallets)[number]) {
    setError(null);
    setConnecting(wallet.name);
    try {
      await connect(wallet);
      const address = wallet.accounts[0]?.address;
      onClose();
      if (address) onConnected?.(address);
    } catch (e) {
      setError(
        isUserRejection(e)
          ? "The connection request was declined in your wallet."
          : walletFailureMessage(wallet.name, e),
      );
    } finally {
      setConnecting(null);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Connect a wallet"
      description={`Wallets that support ${network.label} are listed below.`}
    >
      {state.wallets.length === 0 ? (
        <div className="space-y-3 text-[13.5px] leading-relaxed text-fg-muted">
          <p className="text-fg">No compatible Solana wallet was detected in this browser.</p>
          <p>
            Install a wallet that implements the Wallet Standard (for example Phantom, Solflare or
            Backpack), make sure it supports <span className="text-fg">{network.label}</span>, then
            reload this page.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {state.wallets.map((w) => (
            <li key={w.name}>
              <button
                type="button"
                disabled={connecting !== null}
                onClick={() => void choose(w)}
                className="flex w-full items-center gap-3 rounded-xl border border-line-strong bg-surface-2 px-4 py-3 text-left transition-colors hover:border-accent-line hover:bg-surface-3 disabled:opacity-60"
              >
                {/* Wallet Standard icons are data: URIs supplied by the extension. */}
                <img src={w.icon} alt="" width={28} height={28} className="h-7 w-7 rounded-md" />
                <span className="flex-1 text-[14px] font-medium text-fg">{w.name}</span>
                {connecting === w.name ? <Spinner className="h-4 w-4 text-accent" /> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}
      <p className="mt-5 text-[12.5px] leading-relaxed text-fg-subtle">
        Connecting shares only your public address. Stele never asks for a seed phrase or private
        key, and every signature request shows its exact contents in your wallet first.
      </p>
    </Dialog>
  );
}

export function WalletButton({ className }: { className?: string }) {
  const { address, ready, disconnect, state } = useWallet();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);

  if (!ready) {
    return (
      <Button variant="secondary" size="sm" disabled className={className}>
        <Spinner className="h-3.5 w-3.5" /> Wallet
      </Button>
    );
  }
  if (!address) {
    return (
      <>
        <Button variant="secondary" size="sm" className={className} onClick={() => setOpen(true)}>
          <WalletIcon className="h-4 w-4" /> Connect wallet
        </Button>
        <WalletDialog open={open} onClose={() => setOpen(false)} />
      </>
    );
  }
  return (
    <div className={cn("relative", className)}>
      <Button
        variant="secondary"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((m) => !m)}
      >
        {state.connected?.wallet.icon && (
          <img
            src={state.connected.wallet.icon}
            alt=""
            width={16}
            height={16}
            className="h-4 w-4 rounded"
          />
        )}
        <span className="font-mono text-[12.5px]">{shortAddress(address)}</span>
      </Button>
      {menu && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-line-strong bg-surface p-1.5 shadow-2xl"
        >
          <p className="px-2.5 py-2 font-mono text-[11.5px] break-all text-fg-subtle">{address}</p>
          <button
            role="menuitem"
            type="button"
            className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"
            onClick={() => {
              setMenu(false);
              void navigator.clipboard?.writeText(address);
            }}
          >
            Copy address
          </button>
          <button
            role="menuitem"
            type="button"
            className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"
            onClick={() => {
              setMenu(false);
              void disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
