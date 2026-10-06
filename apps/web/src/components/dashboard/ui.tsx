"use client";
/** Shared dashboard building blocks. */
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Instruction } from "@solana/kit";
import { Alert, Button, Card, CheckIcon, ExternalIcon, Spinner, cn } from "@stele/ui";
import { WalletDialog } from "@/components/wallet";
import { errorMessage } from "@/lib/api";
import { rpcFor, sendWithWallet, txExplorerUrl, TransactionError } from "@/lib/chain";
import { shortAddress } from "@/lib/format";
import { useNetwork, useWallet } from "@/lib/wallet";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg sm:text-[24px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-fg-muted">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={className}>
      <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">{title}</h2>
          {description && (
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      <div className={cn("px-5 py-5 sm:px-6", bodyClassName)}>{children}</div>
    </Card>
  );
}

export function Table({
  head,
  children,
  empty,
  className,
}: {
  head: ReactNode[];
  children: ReactNode;
  empty?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11.5px] uppercase tracking-[0.06em] text-fg-subtle">
            {head.map((h, i) => (
              <th
                key={i}
                scope="col"
                className="whitespace-nowrap px-4 py-2.5 font-medium first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function Td({
  children,
  className,
  mono,
}: {
  children?: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-4 py-3 align-top text-fg-muted first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6",
        mono && "font-mono text-[12px]",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function LoadingRows({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-6 py-8 text-[13px] text-fg-muted">
      <Spinner className="h-4 w-4" /> {label}
    </div>
  );
}

export function TxLink({
  signature,
  label,
}: {
  signature: string | null | undefined;
  label?: string;
}) {
  const network = useNetwork();
  if (!signature) return <span className="text-fg-subtle">—</span>;
  return (
    <a
      href={txExplorerUrl(network, signature)}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 font-mono text-[12px] text-fg-muted hover:text-accent"
    >
      {label ?? shortAddress(signature, 6, 6)} <ExternalIcon className="h-3 w-3" />
    </a>
  );
}

export function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-accent hover:text-accent-strong">
      {children}
    </Link>
  );
}

/**
 * Runs a wallet-signed transaction: connects the wallet if needed, simulates, asks the wallet to
 * sign, sends, confirms, then calls `onConfirmed` (typically an API sync that re-reads the chain).
 */
export function useTransaction() {
  const network = useNetwork();
  const wallet = useWallet();
  const [state, setState] = useState<{
    status: "idle" | "signing" | "confirming" | "done" | "error";
    signature?: string;
    error?: string;
  }>({ status: "idle" });

  async function run(
    build: (signer: NonNullable<typeof wallet.signer>) => Promise<Instruction[]> | Instruction[],
    onConfirmed?: (signature: string) => Promise<void>,
  ): Promise<string | null> {
    if (!wallet.signer) {
      setState({ status: "error", error: "Connect a wallet to sign this transaction." });
      return null;
    }
    setState({ status: "signing" });
    try {
      const instructions = await build(wallet.signer);
      const signature = await sendWithWallet(rpcFor(network), wallet.signer, instructions);
      setState({ status: "confirming", signature });
      await onConfirmed?.(signature);
      setState({ status: "done", signature });
      return signature;
    } catch (e) {
      setState({
        status: "error",
        error: e instanceof TransactionError ? e.message : errorMessage(e),
      });
      return null;
    }
  }

  return {
    ...state,
    run,
    reset: () => setState({ status: "idle" }),
    pending: state.status === "signing" || state.status === "confirming",
  };
}

export function TxStatus({ tx }: { tx: ReturnType<typeof useTransaction> }) {
  if (tx.status === "idle") return null;
  if (tx.status === "error") return <Alert tone="danger">{tx.error}</Alert>;
  if (tx.status === "done")
    return (
      <Alert tone="success" title="Confirmed on Solana">
        <TxLink signature={tx.signature} label="View transaction" />
      </Alert>
    );
  return (
    <div className="flex items-center gap-2 text-[13px] text-fg-muted">
      <Spinner className="h-4 w-4 text-accent" />
      {tx.status === "signing"
        ? "Waiting for your wallet…"
        : "Confirming on Solana and updating the index…"}
    </div>
  );
}

/** Shows which wallet will sign and lets the user connect one. */
export function SigningAs({ need }: { need?: string }) {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  if (!wallet.address) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning-line bg-warning-soft px-4 py-3 text-[13px]">
        <span className="text-fg">Connect a wallet{need ? ` with ${need}` : ""} to sign.</span>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Connect wallet
        </Button>
        <WalletDialog open={open} onClose={() => setOpen(false)} />
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 text-[12.5px] text-fg-subtle">
      <CheckIcon className="h-3.5 w-3.5 text-accent" /> Signing as{" "}
      <span className="font-mono text-fg-muted">{shortAddress(wallet.address, 6, 6)}</span>
    </p>
  );
}

export function RoleNotice({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  if (allowed) return null;
  return (
    <Alert tone="warning" className="mb-4">
      {children}
    </Alert>
  );
}

export function SectionNote({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] leading-relaxed text-fg-subtle">{children}</p>;
}
