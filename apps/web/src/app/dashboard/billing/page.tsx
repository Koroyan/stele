"use client";
/**
 * Billing: the free monthly allowance, the credit balance, and buying credits with SOL. A purchase is
 * a plain on-chain transfer from the admin's wallet to Stele's treasury, carrying the invoice's
 * unique reference; the API credits it only after finding that payment on Solana.
 */
import { useState } from "react";
import { AccountRole, address } from "@solana/kit";
import { formatSol, systemTransferInstruction } from "@stelehq/protocol";
import { Alert, Badge, Button, CopyButton, Fingerprint, cn } from "@stele/ui";
import {
  LoadingRows,
  PageHeader,
  Panel,
  RoleNotice,
  SectionNote,
  SigningAs,
  Table,
  Td,
  TxLink,
  TxStatus,
  useTransaction,
} from "@/components/dashboard/ui";
import { addressExplorerUrl } from "@/lib/chain";
import { api, errorMessage } from "@/lib/api";
import { useDashboard } from "@/lib/dashboard";
import { formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useNetwork } from "@/lib/wallet";

interface Pack {
  id: string;
  credits: number;
  lamports: number;
}

interface Invoice {
  id: string;
  pack: string;
  credits: number;
  lamports: number;
  treasury: string;
  reference: string;
  status: "open" | "paid";
  transactionSignature: string | null;
  payer: string | null;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
}

interface Overview {
  enabled: boolean;
  treasury: string | null;
  network: { cluster: string; label: string };
  freeRecordsPerMonth: number;
  usedThisMonth: number;
  freeRemaining: number;
  credits: number;
  packs: Pack[];
  invoices: Invoice[];
}

const sol = (lamports: number) => `${formatSol(BigInt(lamports))} SOL`;
const perRecord = (p: Pack) => `${formatSol(BigInt(Math.round(p.lamports / p.credits)), 9)} SOL`;

function Allowance({ o }: { o: Overview }) {
  const used = Math.min(o.usedThisMonth, o.freeRecordsPerMonth);
  const pct = o.freeRecordsPerMonth ? Math.round((used / o.freeRecordsPerMonth) * 100) : 100;
  const available = o.freeRemaining + Math.max(0, o.credits);
  return (
    <Panel
      title="This month"
      description="Every recorded acceptance or proof counts once, whoever pays the network fee. The free allowance resets on the 1st (UTC); credits never expire."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-[12.5px] text-fg-subtle">Free recordings used</p>
          <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-fg">
            {used.toLocaleString()}{" "}
            <span className="text-[14px] font-normal text-fg-muted">
              / {o.freeRecordsPerMonth.toLocaleString()}
            </span>
          </p>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-label="Free recordings used this month"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={cn("h-full rounded-full", pct >= 90 ? "bg-warning" : "bg-accent")}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div>
          <p className="text-[12.5px] text-fg-subtle">Credits</p>
          <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-fg">
            {o.credits.toLocaleString()}
          </p>
          <p className="mt-1 text-[12.5px] text-fg-muted">Used after the free allowance</p>
        </div>
        <div>
          <p className="text-[12.5px] text-fg-subtle">Recordings available now</p>
          <p
            className={cn(
              "mt-1 text-[22px] font-semibold tracking-[-0.02em]",
              available > 0 ? "text-fg" : "text-danger",
            )}
          >
            {available.toLocaleString()}
          </p>
          <p className="mt-1 text-[12.5px] text-fg-muted">
            {available > 0
              ? "Signing requests are accepted"
              : "Signing requests are refused before anyone signs"}
          </p>
        </div>
      </div>
    </Panel>
  );
}

function BuyCredits({ o, canBuy, reload }: { o: Overview; canBuy: boolean; reload: () => void }) {
  const { detail } = useDashboard();
  const network = useNetwork();
  const tx = useTransaction();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (!detail) return null;
  const orgId = detail.organization.id;
  const test = network.cluster !== "mainnet";

  async function buy(pack: Pack) {
    setBusy(pack.id);
    setMessage(null);
    try {
      const invoice = await api<Invoice>(`/v1/organizations/${orgId}/billing/invoices`, {
        method: "POST",
        body: { pack: pack.id },
      });
      const signature = await tx.run(
        (signer) => {
          const transfer = systemTransferInstruction({
            source: signer,
            destination: address(invoice.treasury),
            lamports: BigInt(invoice.lamports),
          });
          // The reference lets the API find this payment on-chain (Solana Pay convention).
          return [
            {
              ...transfer,
              accounts: [
                ...(transfer.accounts ?? []),
                { address: address(invoice.reference), role: AccountRole.READONLY },
              ],
            },
          ];
        },
        async (sig) => {
          await api(`/v1/organizations/${orgId}/billing/invoices/${invoice.id}/confirm`, {
            method: "POST",
            body: { signature: sig },
          });
        },
      );
      if (signature)
        setMessage({
          tone: "success",
          text: `${pack.credits.toLocaleString()} credits added. Thank you!`,
        });
    } catch (e) {
      setMessage({ tone: "danger", text: errorMessage(e) });
    } finally {
      setBusy(null);
      reload();
    }
  }

  if (!o.enabled)
    return (
      <Panel title="Buy credits">
        <SectionNote>
          Credit purchases are not enabled on this Stele app. Your organization has the free monthly
          allowance.
        </SectionNote>
      </Panel>
    );

  return (
    <Panel
      title="Buy credits"
      description="Pay in SOL from your wallet, straight to Stele's treasury on Solana. Credits are added as soon as the payment is confirmed."
    >
      <RoleNotice allowed={canBuy}>Only the owner or an admin can buy credits.</RoleNotice>
      {test && (
        <Alert tone="warning" className="mb-4" title={`${o.network.label} is a test network`}>
          Payments here use test SOL, which has no value: try the whole purchase flow for free.
        </Alert>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        {o.packs.map((p, i) => (
          <div
            key={p.id}
            className={cn(
              "flex flex-col rounded-xl border p-4",
              i === 1 ? "border-accent-line bg-accent/5" : "border-line bg-surface",
            )}
          >
            <p className="flex items-center gap-2 text-[13.5px] font-medium text-fg">
              {p.credits.toLocaleString()} recordings
              {i === 1 && <Badge tone="accent">Popular</Badge>}
            </p>
            <p className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-fg">
              {sol(p.lamports)}
            </p>
            <p className="mt-1 text-[12.5px] text-fg-muted">{perRecord(p)} per recording</p>
            <Button
              size="sm"
              className="mt-4"
              disabled={!canBuy || busy !== null}
              loading={busy === p.id}
              onClick={() => void buy(p)}
            >
              Pay {sol(p.lamports)}
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        <SigningAs />
        <TxStatus tx={tx} />
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
      </div>
      {o.treasury && (
        <SectionNote>
          Treasury:{" "}
          <a
            href={addressExplorerUrl(network, o.treasury)}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-fg-muted hover:text-accent"
          >
            {o.treasury}
          </a>{" "}
          <CopyButton value={o.treasury} label="Copy treasury address" />. Every payment is a public
          Solana transfer to this address, so anyone can check it.
        </SectionNote>
      )}
    </Panel>
  );
}

function Invoices({ o, canBuy, reload }: { o: Overview; canBuy: boolean; reload: () => void }) {
  const { detail } = useDashboard();
  const [checking, setChecking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!detail) return null;
  async function check(invoice: Invoice) {
    setChecking(invoice.id);
    setError(null);
    try {
      await api(
        `/v1/organizations/${detail!.organization.id}/billing/invoices/${invoice.id}/confirm`,
        {
          method: "POST",
          body: {},
        },
      );
      reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setChecking(null);
    }
  }
  return (
    <Panel
      title="Purchases"
      description="Each purchase is verified against the Solana transaction that paid it."
      bodyClassName="px-0 py-0"
    >
      {error && (
        <div className="px-5 pt-4 sm:px-6">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <Table
        head={["Created", "Credits", "Amount", "Status", "Payment", "Reference"]}
        empty={
          o.invoices.length === 0 ? (
            <p className="px-6 py-8 text-[13px] text-fg-muted">No purchases yet.</p>
          ) : null
        }
      >
        {o.invoices.map((inv) => (
          <tr key={inv.id}>
            <Td>{formatDateTime(Date.parse(inv.createdAt) / 1000)}</Td>
            <Td>{inv.credits.toLocaleString()}</Td>
            <Td>{sol(inv.lamports)}</Td>
            <Td>
              {inv.status === "paid" ? (
                <Badge tone="verified">Paid</Badge>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Badge tone="neutral">Awaiting payment</Badge>
                  {canBuy && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={checking === inv.id}
                      onClick={() => void check(inv)}
                    >
                      Check payment
                    </Button>
                  )}
                </span>
              )}
            </Td>
            <Td>
              <TxLink signature={inv.transactionSignature} />
            </Td>
            <Td>
              <Fingerprint value={inv.reference} />
            </Td>
          </tr>
        ))}
      </Table>
    </Panel>
  );
}

export default function BillingPage() {
  const { detail } = useDashboard();
  const overview = useApi<Overview>(
    detail ? `/v1/organizations/${detail.organization.id}/billing` : null,
  );
  if (!detail) return null;
  const canBuy = detail.role === "owner" || detail.role === "admin";
  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="A free allowance every month, then prepaid credits — one per recording, network fees included. Your users never pay."
      />
      {overview.error && <Alert tone="danger">{overview.error.message}</Alert>}
      {overview.data ? (
        <>
          <Allowance o={overview.data} />
          <BuyCredits o={overview.data} canBuy={canBuy} reload={overview.reload} />
          <Invoices o={overview.data} canBuy={canBuy} reload={overview.reload} />
        </>
      ) : (
        !overview.error && <LoadingRows />
      )}
    </div>
  );
}
