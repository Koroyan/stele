"use client";

/**
 * The live demo. Every action calls the Stele API's demo endpoints or the ordinary acceptance API
 * and produces real transactions on the deployment's cluster (a test network). Nothing is
 * simulated in this page: when the demo is unavailable it says so instead of pretending.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";
import {
  createRpc,
  depositInstruction,
  findAccessPassPda,
  shortFingerprint,
  toHex,
} from "@stele/protocol";
import {
  GateCancelledError,
  SteleClient,
  acceptDocument,
  createSteleGate,
  loadVerifiedDocument,
  type AccessCheck,
} from "@stele/sdk";
import {
  ArrowRightIcon,
  CheckIcon,
  CodeBlock,
  CopyButton,
  ExternalIcon,
  RefreshIcon,
  Spinner,
  Tabs,
  buttonClasses,
  cn,
} from "@stele/ui";
import { Eyebrow } from "@/components/marketing";
import { StatusBadge } from "@/components/story/story-ui";
import { createDemoWallet, type DemoWallet } from "@/lib/demo-wallet";

interface DemoStatus {
  available: boolean;
  reason: string | null;
  network: { label: string; cluster: string };
  organization: string | null;
  relayer: string;
  steleProgram: string;
  gateProgram: string;
  explorerCluster: string | null;
}

interface Session {
  token: string;
  organization: string;
  document: string;
  documentSlug: string;
  policy: string | null;
  vault: string | null;
  version: { address: string; number: number; fingerprint: string; signature: string };
}

interface DepositResult {
  signature: string;
  ok: boolean;
  failure: { name: string; message: string; source: string } | null;
  deposit: { termsVersionNumber: number; depositCount: number; totalDeposited: number } | null;
}

interface LogEntry {
  id: number;
  label: string;
  tone: "success" | "danger" | "accent" | "neutral" | "warning";
  outcome: string;
  detail: string;
  signature?: string;
}

const client = new SteleClient({ apiBaseUrl: "/api" });
const DEPOSIT = 5_000_000_000n; // 5,000 demo USDC (6 decimals)

const REQUIRE_CURRENT = `// programs/gate-demo — the vault's whole Stele integration
pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let granted = require_current(
        &ctx.accounts.access_pass,
        &ctx.accounts.policy,   // #[account(address = vault.policy)]
        &ctx.accounts.investor, // Signer
    )?;
    // … record the deposit (granted.version_number is in the Deposited event)
    Ok(())
}`;

async function api<T>(path: string, body?: unknown): Promise<T> {
  return client.request<T>(
    path,
    body === undefined ? {} : { method: "POST", body: JSON.stringify(body) },
  );
}

function useDemoEnvironment() {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [rpcUrl, setRpcUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const [s, n] = await Promise.all([api<DemoStatus>("/v1/demo"), client.getNetwork()]);
        setStatus(s);
        setRpcUrl(n.publicRpcUrls[0] ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);
  const explorer = useCallback(
    (signature: string) => {
      if (!status?.explorerCluster) return null;
      const base = `https://explorer.solana.com/tx/${signature}`;
      if (status.explorerCluster === "custom")
        return rpcUrl ? `${base}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}` : null;
      return `${base}?cluster=${status.explorerCluster}`;
    },
    [status, rpcUrl],
  );
  return { status, rpcUrl, error, explorer };
}

function TxLink({ href, signature }: { href: string | null; signature: string }) {
  const short = `${signature.slice(0, 8)}…`;
  if (!href) return <span className="font-mono text-[12px] text-fg-subtle">{short}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-[12px] text-accent hover:underline"
    >
      {short} <ExternalIcon className="h-3 w-3" />
    </a>
  );
}

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="relative rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[12px]",
            done
              ? "border-verified-line bg-verified-soft text-verified"
              : "border-line-strong text-fg-muted",
          )}
          aria-hidden="true"
        >
          {done ? <CheckIcon className="h-3.5 w-3.5" /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-fg">
            {title}
            {done && <span className="sr-only"> (done)</span>}
          </p>
          <div className="mt-3 text-[14px] text-fg-muted">{children}</div>
        </div>
      </div>
    </li>
  );
}

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-[13.5px] text-danger"
    >
      {error}
    </p>
  );
}

// ---- Proof demo ---------------------------------------------------------------------------------------

function ProofDemo({
  status,
  wallet,
  explorer,
}: {
  status: DemoStatus;
  wallet: DemoWallet;
  explorer: (s: string) => string | null;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [acceptance, setAcceptance] = useState<{ id: string; signature: string | null } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const publish = () =>
    run("publish", async () => {
      setSession(await api<Session>("/v1/demo/sessions", { kind: "proof" }));
      setAcceptance(null);
    });

  const accept = () =>
    run("accept", async () => {
      const verified = await loadVerifiedDocument({
        client,
        organization: session!.organization,
        document: session!.documentSlug,
      });
      const r = await acceptDocument({
        client,
        verified,
        signer: wallet,
        requestDomain: window.location.hostname,
      });
      setAcceptance({ id: r.acceptanceId, signature: r.transactionSignature });
    });

  const download = () =>
    run("download", async () => {
      const r = await client.request<{ receipt: unknown }>(
        `/v1/public/acceptances/${acceptance!.id}/receipt`,
      );
      const blob = new Blob([JSON.stringify(r.receipt, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stele-receipt-${acceptance!.id.slice(0, 12)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

  return (
    <div className="space-y-4">
      <p className="text-[14px] text-fg-muted">
        A normal application&apos;s flow: publish an exact version, accept it, get a receipt, verify
        it without asking anyone. Each step is a real transaction on {status.network.label}.
      </p>
      <ol className="space-y-3">
        <Step n={1} title="Publish Terms of Service v1" done={!!session}>
          {session ? (
            <p>
              Published version {session.version.number} · fingerprint{" "}
              <span className="font-mono text-fg">
                {shortFingerprint(session.version.fingerprint)}
              </span>{" "}
              ·{" "}
              <TxLink
                href={explorer(session.version.signature)}
                signature={session.version.signature}
              />
            </p>
          ) : (
            <button
              type="button"
              className={buttonClasses("primary", "md")}
              onClick={publish}
              disabled={!!busy}
            >
              {busy === "publish" ? <Spinner /> : null} Publish Terms v1
            </button>
          )}
        </Step>
        <Step n={2} title="Accept it" done={!!acceptance}>
          {acceptance ? (
            <p>
              Accepted by the demo wallet ·{" "}
              {acceptance.signature ? (
                <TxLink href={explorer(acceptance.signature)} signature={acceptance.signature} />
              ) : (
                "queued for the next batch"
              )}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClasses("primary", "md")}
                onClick={accept}
                disabled={!session || !!busy}
              >
                {busy === "accept" ? <Spinner /> : null} Accept with the demo wallet
              </button>
              {session && (
                <a
                  href={`/accept/${session.organization}/${session.documentSlug}`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClasses("secondary", "md")}
                >
                  Or accept with a passkey <ExternalIcon className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          )}
        </Step>
        <Step n={3} title="Generate the receipt" done={false}>
          <div className="flex flex-wrap gap-2">
            <Link
              href={acceptance ? `/receipt/${acceptance.id}` : "#"}
              aria-disabled={!acceptance}
              className={cn(
                buttonClasses("secondary", "md"),
                !acceptance && "pointer-events-none opacity-50",
              )}
            >
              Open the receipt
            </Link>
            <button
              type="button"
              className={buttonClasses("ghost", "md")}
              onClick={download}
              disabled={!acceptance || !!busy}
            >
              Download JSON
            </button>
          </div>
        </Step>
        <Step n={4} title="Verify it independently" done={false}>
          <p className="mb-3">
            The verifier runs in your browser against Solana — it does not ask Stele whether the
            receipt is valid.
          </p>
          <Link
            href={acceptance?.signature ? `/verify?tx=${acceptance.signature}` : "#"}
            aria-disabled={!acceptance?.signature}
            className={cn(
              buttonClasses("primary", "md"),
              !acceptance?.signature && "pointer-events-none opacity-50",
            )}
          >
            Verify <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </Step>
      </ol>
      <ErrorNote error={error} />
    </div>
  );
}

// ---- Gate demo: Atlas Real Estate Vault ----------------------------------------------------------------

const CHECKLIST = [
  "Connect the (demo) wallet",
  "Deposit → no AccessPass → the Stele modal opens",
  "Accept & Deposit → acceptance recorded, deposit succeeds",
  "The admin publishes and requires Offering Terms v2",
  "Another deposit → the v1 pass is outdated (fails / modal)",
  "Accept v2 → deposit succeeds",
  "A direct call without a current pass fails on-chain",
  "The integration code: require_current()",
  "The Proof receipt of the acceptance",
];

function GateDemo({
  status,
  wallet,
  rpcUrl,
  explorer,
}: {
  status: DemoStatus;
  wallet: DemoWallet;
  rpcUrl: string | null;
  explorer: (s: string) => string | null;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<AccessCheck | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [done, setDone] = useState<Set<number>>(new Set([0]));
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);
  const stranger = useMemo(() => createDemoWallet(), []);
  const rpc = useMemo(() => (rpcUrl ? createRpc(rpcUrl) : null), [rpcUrl]);
  const gate = useMemo(
    () => createSteleGate({ client, wallet, ui: "modal", requestDomain: window.location.hostname }),
    [wallet],
  );

  const mark = (...steps: number[]) =>
    setDone((d) => {
      const n = new Set(d);
      steps.forEach((s) => n.add(s));
      return n;
    });
  const push = (e: Omit<LogEntry, "id">) =>
    setLog((l) => [{ id: nextId.current++, ...e }, ...l].slice(0, 30));

  const refresh = useCallback(async () => {
    if (!session?.policy) return;
    setAccess(await gate.check(session.policy, wallet.address));
  }, [gate, session, wallet]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof GateCancelledError)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      void refresh().catch(() => undefined);
    }
  };

  async function sendDeposit(investor: DemoWallet, passOwner: string): Promise<DepositResult> {
    const document = address(session!.document);
    const [accessPass] = await findAccessPassPda(document, address(passOwner));
    const ix = depositInstruction({
      investor: address(investor.address),
      vault: address(session!.vault!),
      policy: address(session!.policy!),
      accessPass,
      amount: DEPOSIT,
    });
    const { value: blockhash } = await rpc!.getLatestBlockhash({ commitment: "confirmed" }).send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(address(status.relayer), m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions([ix], m),
    );
    const tx = compileTransaction(message);
    const signature = investor.signTransactionMessage(new Uint8Array(tx.messageBytes));
    const signed = {
      ...tx,
      signatures: { ...tx.signatures, [investor.address as Address]: signature },
    } as typeof tx;
    return api<DepositResult>("/v1/demo/sessions/deposit", {
      token: session!.token,
      transaction: getBase64EncodedWireTransaction(signed),
    });
  }

  const logDeposit = (label: string, r: DepositResult) =>
    push({
      label,
      tone: r.ok ? "success" : "danger",
      outcome: r.ok ? "Deposit executed" : `Rejected · ${r.failure?.name ?? "failed"}`,
      detail: r.ok
        ? `5,000 USDC deposited with an AccessPass for Offering Terms v${r.deposit?.termsVersionNumber}.`
        : (r.failure?.message ?? "The transaction failed on-chain."),
      signature: r.signature,
    });

  const start = () =>
    run("start", async () => {
      const s = await api<Session>("/v1/demo/sessions", { kind: "gate" });
      setSession(s);
      setLog([]);
      setDone(new Set([0]));
      push({
        label: "Investor Offering Terms v1 published · policy and vault created",
        tone: "accent",
        outcome: "Ready",
        detail: "Your own copy of the offering, under the demo organization.",
        signature: s.version.signature,
      });
    });

  const depositThroughGate = () =>
    run("gate", async () => {
      const before = await gate.check(session!.policy!, wallet.address);
      if (before.status === "MISSING") mark(1);
      if (before.status === "OUTDATED") mark(4);
      const r = await gate.gate({
        policy: session!.policy!,
        action: () => sendDeposit(wallet, wallet.address),
        acceptLabel: "Accept & Deposit",
      });
      if (before.status !== "VALID") {
        push({
          label: `Accepted Investor Offering Terms v${before.document.version.version}`,
          tone: "success",
          outcome: "AccessPass valid",
          detail: "Recorded on-chain from the Stele modal; the pass now names this version.",
        });
      }
      logDeposit("Deposit through Stele Gate", r);
      if (r.ok) mark(before.status === "OUTDATED" ? 5 : 2);
      if (before.status !== "VALID") mark(8);
    });

  const depositDirect = () =>
    run("direct", async () => {
      const r = await sendDeposit(wallet, wallet.address);
      logDeposit("Direct call to deposit(), without the SDK", r);
      if (!r.ok) {
        if (r.failure?.name === "AccessPassOutdated") mark(4);
        mark(6);
      }
    });

  const publishNext = () =>
    run("publish", async () => {
      const v = await api<{ number: number; signature: string }>("/v1/demo/sessions/publish", {
        token: session!.token,
      });
      push({
        label: `Admin published and requires Offering Terms v${v.number}`,
        tone: "warning",
        outcome: "Older passes no longer satisfy the policy",
        detail: "Nothing was rewritten: the earlier acceptances stay on record.",
        signature: v.signature,
      });
      mark(3);
    });

  const bypass = () =>
    run("bypass", async () => {
      const r = await sendDeposit(stranger, wallet.address);
      logDeposit("Script: another wallet reuses your AccessPass", r);
      if (!r.ok) mark(6);
    });

  const noPass = () =>
    run("nopass", async () => {
      const r = await sendDeposit(stranger, stranger.address);
      logDeposit("Script: a wallet with no AccessPass calls deposit()", r);
      if (!r.ok) mark(6);
    });

  if (!session) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6">
        <p className="text-[16px] font-semibold text-fg">Atlas Real Estate Vault</p>
        <p className="mt-2 text-[15px] text-fg-muted">
          You get your own Investor Offering Terms, a Stele policy that requires them, and a demo
          vault whose deposit() calls require_current(). No tokens move: deposits are recorded as
          demo USDC.
        </p>
        <button
          type="button"
          className={buttonClasses("primary", "lg", "mt-5")}
          onClick={start}
          disabled={!!busy}
        >
          {busy === "start" ? <Spinner /> : null} Start the vault demo
        </button>
        <div className="mt-4">
          <ErrorNote error={error} />
        </div>
      </div>
    );
  }

  const receiptId = access?.pass ? toHex(access.pass.acceptanceId) : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[11.5px] uppercase tracking-[0.08em] text-fg-subtle">Policy</p>
            <p className="mt-1 text-[15px] font-semibold text-fg">
              Investor Offering Terms · requires v{access?.requiredVersion ?? 1}
            </p>
            <p className="mt-1 font-mono text-[11.5px] text-fg-subtle">
              {session.policy!.slice(0, 8)}…{session.policy!.slice(-6)}
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[11.5px] uppercase tracking-[0.08em] text-fg-subtle">
              Your AccessPass
            </p>
            <p className="mt-2">
              {!access ? (
                <StatusBadge tone="neutral">Checking</StatusBadge>
              ) : access.status === "VALID" ? (
                <StatusBadge tone="success">Valid · v{access.pass?.versionNumber}</StatusBadge>
              ) : access.status === "OUTDATED" ? (
                <StatusBadge tone="warning">Outdated · v{access.pass?.versionNumber}</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">Missing</StatusBadge>
              )}
            </p>
            <p className="mt-2 text-[12px] text-fg-subtle">
              Read from Solana, not from Stele&apos;s database.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5">
          <p className="text-[15px] font-semibold text-fg">Deposit 5,000 USDC</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className={buttonClasses("primary", "md")}
              onClick={depositThroughGate}
              disabled={!!busy}
            >
              {busy === "gate" ? <Spinner /> : null} Deposit (through Stele)
            </button>
            <button
              type="button"
              className={buttonClasses("secondary", "md")}
              onClick={publishNext}
              disabled={!!busy}
            >
              {busy === "publish" ? <Spinner /> : <RefreshIcon className="h-4 w-4" />} Admin:
              publish &amp; require the next version
            </button>
            <button
              type="button"
              className={buttonClasses("secondary", "md")}
              onClick={depositDirect}
              disabled={!!busy}
            >
              {busy === "direct" ? <Spinner /> : null} Direct call (no SDK)
            </button>
            <button
              type="button"
              className={buttonClasses("danger", "md")}
              onClick={noPass}
              disabled={!!busy}
            >
              {busy === "nopass" ? <Spinner /> : null} Script: wallet without a pass
            </button>
            <button
              type="button"
              className={buttonClasses("danger", "md")}
              onClick={bypass}
              disabled={!!busy}
            >
              {busy === "bypass" ? <Spinner /> : null} Script: reuse your pass from another wallet
            </button>
          </div>
          <div className="mt-4">
            <ErrorNote error={error} />
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface">
          <p className="border-b border-line px-5 py-3 text-[13px] font-medium text-fg-muted">
            On-chain activity <span className="text-fg-subtle">(newest first)</span>
          </p>
          {log.length === 0 ? (
            <p className="px-5 py-6 text-[13.5px] text-fg-subtle">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-line" aria-live="polite">
              {log.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-col gap-1.5 px-5 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-fg">{e.label}</p>
                    <p className="mt-0.5 text-[13px] text-fg-muted">{e.detail}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                    <StatusBadge tone={e.tone}>{e.outcome}</StatusBadge>
                    {e.signature && <TxLink href={explorer(e.signature)} signature={e.signature} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          className="rounded-2xl border border-line bg-surface p-5"
          onMouseEnter={() => mark(7)}
          onFocus={() => mark(7)}
        >
          <p className="text-[15px] font-semibold text-fg">The integration: one call</p>
          <div className="mt-3">
            <CodeBlock code={REQUIRE_CURRENT} language="rust" />
          </div>
          <p className="mt-3 text-[13px] text-fg-muted">
            From a terminal, the same direct call (no frontend, no SDK, no Stele API):{" "}
            <code className="font-mono text-[12.5px] text-fg">
              pnpm --filter @stele/localnet vault-deposit -- --policy {session.policy}
            </code>
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5">
          <p className="text-[15px] font-semibold text-fg">The Proof behind the pass</p>
          <p className="mt-1 text-[13.5px] text-fg-muted">
            Every Gate acceptance is a Stele Proof record: the exact document, version, fingerprint,
            signature and time — verifiable without Stele.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={receiptId ? `/receipt/${receiptId}` : "#"}
              aria-disabled={!receiptId}
              onClick={() => receiptId && mark(8)}
              className={cn(
                buttonClasses("secondary", "md"),
                !receiptId && "pointer-events-none opacity-50",
              )}
            >
              Open the receipt of your latest acceptance
            </Link>
          </div>
        </div>
      </div>

      <aside className="h-fit rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-24">
        <p className="text-[13px] font-semibold text-fg">The 3-minute story</p>
        <ol className="mt-3 space-y-2">
          {CHECKLIST.map((c, i) => (
            <li
              key={c}
              className={cn(
                "flex gap-2.5 text-[13.5px]",
                done.has(i) ? "text-fg" : "text-fg-muted",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10.5px]",
                  done.has(i)
                    ? "border-verified-line bg-verified-soft text-verified"
                    : "border-line-strong",
                )}
                aria-hidden="true"
              >
                {done.has(i) ? "✓" : i + 1}
              </span>
              {c}
              {done.has(i) && <span className="sr-only"> (done)</span>}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[12px] leading-relaxed text-fg-subtle">
          “Deposit (through Stele)” uses the SDK: the modal appears only when needed. Every other
          button calls the vault program directly — the program still checks the pass. Rejected
          deposits are real failed transactions; acceptance and deposit are two transactions.
        </p>
      </aside>
    </div>
  );
}

// ---- page -----------------------------------------------------------------------------------------------

export function DemoClient() {
  const { status, rpcUrl, error, explorer } = useDemoEnvironment();
  const [wallet, setWallet] = useState<DemoWallet | null>(null);
  const [tab, setTab] = useState<"gate" | "proof">("gate");
  useEffect(() => {
    setWallet(createDemoWallet());
    if (window.location.hash === "#proof") setTab("proof");
  }, []);

  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-14 sm:px-6 sm:pt-20">
          <Eyebrow>Live demo</Eyebrow>
          <h1 className="mt-4 max-w-3xl text-balance text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] text-fg sm:text-[48px]">
            Try Stele with real transactions.
          </h1>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-fg-muted">
            Every step below runs on {status ? status.network.label : "a Solana test network"} — no
            mock-ups. A demo wallet is created in this browser tab; it holds nothing and disappears
            when you leave. Stele pays the fees.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-[13px]">
            {status && (
              <StatusBadge tone={status.available ? "success" : "warning"}>
                {status.available ? `Live on ${status.network.label}` : "Live demo unavailable"}
              </StatusBadge>
            )}
            {wallet && (
              <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-fg-muted">
                Demo wallet{" "}
                <span className="font-mono text-fg">
                  {wallet.address.slice(0, 4)}…{wallet.address.slice(-4)}
                </span>
                <CopyButton value={wallet.address} label="Copy address" />
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-[14px] text-danger"
          >
            The demo could not reach the Stele API: {error}
          </p>
        )}
        {status && !status.available && (
          <div className="rounded-2xl border border-warning-line bg-warning-soft/40 p-6">
            <p className="text-[15px] font-semibold text-fg">
              The live demo is not available right now.
            </p>
            <p className="mt-1 text-[14px] text-fg-muted">{status.reason}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/gate" className={buttonClasses("secondary", "md")}>
                See how Gate works
              </Link>
              <Link href="/proof" className={buttonClasses("secondary", "md")}>
                See how Proof works
              </Link>
            </div>
          </div>
        )}
        {status?.available && wallet && (
          <>
            <Tabs
              value={tab}
              onChange={(t) => {
                setTab(t);
                history.replaceState(null, "", `#${t}`);
              }}
              items={[
                { value: "gate", label: "Gate · Atlas Real Estate Vault" },
                { value: "proof", label: "Proof · any application" },
              ]}
            />
            <div className="mt-6" id={tab}>
              {tab === "gate" ? (
                <GateDemo status={status} wallet={wallet} rpcUrl={rpcUrl} explorer={explorer} />
              ) : (
                <ProofDemo status={status} wallet={wallet} explorer={explorer} />
              )}
            </div>
          </>
        )}
        {!status && !error && (
          <p className="flex items-center gap-2 text-[14px] text-fg-muted">
            <Spinner /> Connecting to the demo…
          </p>
        )}
      </section>
    </>
  );
}
