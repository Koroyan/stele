"use client";

/**
 * The live demo. Every action calls the Stele API's demo endpoints or the ordinary acceptance API
 * and produces real transactions on the deployment's cluster (a test network). Nothing is
 * simulated in this page: when the demo is unavailable it says so instead of pretending.
 *
 * The Gate demo is a guided story — one action per step, each result explained in plain words —
 * with every control still available for free play.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  depositWithPassportInstruction,
  findPassportPda,
  shortFingerprint,
  toHex,
} from "@stelehq/protocol";
import {
  GateCancelledError,
  SteleClient,
  acceptDocument,
  createSteleGate,
  loadVerifiedDocument,
  type AccessCheck,
} from "@stelehq/sdk";
import {
  ArrowRightIcon,
  BuildingIcon,
  CheckIcon,
  CodeBlock,
  CopyButton,
  ExternalIcon,
  FileIcon,
  GateIcon,
  RefreshIcon,
  ShieldIcon,
  Spinner,
  Tabs,
  TicketIcon,
  WalletIcon,
  XIcon,
  buttonClasses,
  cn,
} from "@stele/ui";
import { Eyebrow } from "@/components/marketing";
import {
  Connector,
  Flow,
  FlowNode,
  StatusBadge,
  type NodeState,
} from "@/components/story/story-ui";
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

type Tone = "success" | "danger" | "accent" | "neutral" | "warning";

interface LogEntry {
  id: number;
  label: string;
  tone: Tone;
  outcome: string;
  signature?: string;
}

const client = new SteleClient({ apiBaseUrl: "/api" });
const DEPOSIT = 5_000_000_000n; // 5,000 demo USDC (6 decimals)

const REQUIRE_CURRENT = `// programs/gate-demo — the vault's whole Stele integration
pub fn deposit_with_passport(ctx: Context<DepositWithPassport>, amount: u64) -> Result<()> {
    require_current_passport(
        &ctx.accounts.passport, // the investor's Stele passport
        &ctx.accounts.policy,   // pinned: #[account(address = vault.policy)]
        &ctx.accounts.investor, // must sign
    )?;
    // … record the deposit
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
  if (!href) return <span className="font-mono text-[12px] text-fg-subtle">tx {short}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-[12px] text-accent hover:underline"
    >
      tx {short} <ExternalIcon className="h-3 w-3" />
    </a>
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

const usdc = (baseUnits: number) =>
  `${(baseUnits / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;

// ---- Gate demo: what each result means, in plain words ---------------------------------------------------

interface Outcome {
  tone: "success" | "danger" | "neutral" | "warning";
  headline: string;
  body: string;
  /** The exact on-chain fact behind the headline (error name, version), for the curious. */
  technical?: string;
  signature?: string;
  flow: { label: string; sub?: string; icon: ReactNode; state: NodeState }[];
}

const FAILURES: Record<string, { headline: string; body: string }> = {
  AccessPassMissing: {
    headline: "Blocked on-chain — this wallet never accepted the terms",
    body: "The vault program looked in this wallet's Stele passport on Solana and found no acceptance of these terms, so it refused the deposit. No website was involved: the check lives inside the program.",
  },
  AccessPassOutdated: {
    headline: "Blocked on-chain — the acceptance is out of date",
    body: "This wallet accepted an older version, but the vault now requires the newest one. The old acceptance is still on record; it just isn't enough any more.",
  },
  AccessPassMismatch: {
    headline: "Blocked on-chain — that passport belongs to someone else",
    body: "A passport only works for the wallet that signed the terms. Presenting another wallet's passport is refused.",
  },
};

function depositOutcome(r: DepositResult, who: "you" | "other", direct: boolean): Outcome {
  const wallet = {
    label: who === "you" ? "Your wallet" : "Another wallet",
    sub: direct ? "sends deposit()" : undefined,
    icon: <WalletIcon className="h-4 w-4" />,
  };
  const program = {
    label: "Vault program",
    sub: "checks the passport",
    icon: <BuildingIcon className="h-4 w-4" />,
  };
  if (r.ok) {
    return {
      tone: "success",
      headline: "Deposit executed",
      body: `The vault program found a current acceptance in the passport (Offering Terms v${r.deposit?.termsVersionNumber}) and accepted 5,000 USDC.`,
      technical: `Deposited event · terms v${r.deposit?.termsVersionNumber}`,
      signature: r.signature,
      flow: [
        { ...wallet, state: "done" },
        { ...program, state: "done" },
        { label: "5,000 USDC in", icon: <CheckIcon className="h-4 w-4" />, state: "success" },
      ],
    };
  }
  const name = r.failure?.name ?? "Failed";
  const known = FAILURES[name];
  return {
    tone: "danger",
    headline: known?.headline ?? "Blocked on-chain",
    body: known?.body ?? r.failure?.message ?? "The transaction failed on-chain.",
    technical: `${name} — a real failed transaction on Solana`,
    signature: r.signature,
    flow: [
      { ...wallet, state: "done" },
      { ...program, state: "blocked" },
      { label: "Refused", icon: <XIcon className="h-4 w-4" />, state: "blocked" },
    ],
  };
}

// ---- Gate demo: the guided story ----------------------------------------------------------------------------

type Action = "direct" | "gate" | "publish" | "borrow";

interface Chapter {
  nav: string;
  title: string;
  intro: string;
  action: Action;
  button: string;
  expect: string;
}

const CHAPTERS: Chapter[] = [
  {
    nav: "Skip the terms",
    title: "Try to invest without accepting the terms",
    intro:
      "A script sends the deposit straight to the vault program — no website, no checkbox, no Stele modal. Will the money go in?",
    action: "direct",
    button: "Send the deposit directly",
    expect: "Expected: refused on-chain",
  },
  {
    nav: "Accept & invest",
    title: "Invest the normal way",
    intro:
      "Now the app wraps the deposit with Stele. You'll see the Offering Terms, accept them — free, Stele pays the fee — and the deposit continues by itself.",
    action: "gate",
    button: "Deposit 5,000 USDC",
    expect: "Expected: a short terms window, then success",
  },
  {
    nav: "Terms change",
    title: "Atlas updates its Offering Terms",
    intro:
      "Playing the issuer, publish version 2 and make it the required version. Nobody's history is edited: your v1 acceptance stays on record.",
    action: "publish",
    button: "Publish & require v2 (as Atlas)",
    expect: "Expected: your acceptance becomes outdated",
  },
  {
    nav: "Old acceptance",
    title: "Try to invest with the old acceptance",
    intro: "Send another deposit straight to the program. Your passport still says v1.",
    action: "direct",
    button: "Send the deposit directly",
    expect: "Expected: refused — v2 is required now",
  },
  {
    nav: "Accept v2",
    title: "Accept the new version",
    intro:
      "Deposit through the app again. Stele shows that the terms changed and what changed; accept v2 and the deposit goes through.",
    action: "gate",
    button: "Deposit 5,000 USDC",
    expect: "Expected: the window explains the update, then success",
  },
  {
    nav: "Borrow access",
    title: "Try to use someone else's acceptance",
    intro:
      "A different wallet sends a deposit and presents your passport, hoping to ride on your acceptance.",
    action: "borrow",
    button: "Deposit from another wallet",
    expect: "Expected: refused — a passport works only for its owner",
  },
];

function OutcomeCard({
  outcome,
  explorer,
}: {
  outcome: Outcome;
  explorer: (s: string) => string | null;
}) {
  const tones = {
    success: "border-verified-line bg-verified-soft/40",
    danger: "border-danger-line bg-danger-soft/40",
    warning: "border-warning-line bg-warning-soft/40",
    neutral: "border-line bg-surface-2",
  } as const;
  const icon = {
    success: <CheckIcon className="h-5 w-5 text-verified" />,
    danger: <XIcon className="h-5 w-5 text-danger" />,
    warning: <RefreshIcon className="h-5 w-5 text-warning" />,
    neutral: <span className="text-fg-subtle">•</span>,
  }[outcome.tone];
  return (
    <div className={cn("story-pop mt-5 rounded-2xl border p-4 sm:p-5", tones[outcome.tone])}>
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-bg/60"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-fg">{outcome.headline}</p>
          <p className="mt-1 text-[14px] leading-relaxed text-fg-muted">{outcome.body}</p>
        </div>
      </div>
      {outcome.flow.length > 0 && (
        <div className="mt-4" aria-hidden="true">
          <Flow nodes={outcome.flow.length}>
            {outcome.flow.map((n, i) => (
              <div key={n.label} className="contents">
                {i > 0 && <Connector state={n.state === "blocked" ? "blocked" : "done"} />}
                <FlowNode icon={n.icon} label={n.label} sub={n.sub} state={n.state} />
              </div>
            ))}
          </Flow>
        </div>
      )}
      {(outcome.technical || outcome.signature) && (
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-subtle">
          {outcome.technical && <span className="font-mono">{outcome.technical}</span>}
          {outcome.signature && (
            <TxLink href={explorer(outcome.signature)} signature={outcome.signature} />
          )}
        </p>
      )}
    </div>
  );
}

function StateRow({
  item,
  icon,
  label,
  children,
}: {
  item: string;
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div data-state-item={item} className="flex items-start gap-3 py-3">
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-bg/60 text-fg-subtle"
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11.5px] uppercase tracking-[0.08em] text-fg-subtle">{label}</p>
        <div className="mt-1 text-[14px] text-fg">{children}</div>
      </div>
    </div>
  );
}

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
  const [startNote, setStartNote] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [chapter, setChapter] = useState(0);
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});
  const [freeOutcome, setFreeOutcome] = useState<Outcome | null>(null);
  const [vault, setVault] = useState({ total: 0, count: 0, refused: 0 });
  const nextId = useRef(1);
  const heading = useRef<HTMLHeadingElement>(null);
  const stranger = useMemo(() => createDemoWallet(), []);
  const rpc = useMemo(() => (rpcUrl ? createRpc(rpcUrl) : null), [rpcUrl]);
  const gate = useMemo(
    () => createSteleGate({ client, wallet, ui: "modal", requestDomain: window.location.hostname }),
    [wallet],
  );

  const push = (e: Omit<LogEntry, "id">) =>
    setLog((l) => [{ id: nextId.current++, ...e }, ...l].slice(0, 30));

  const refresh = useCallback(async () => {
    if (!session?.policy) return;
    setAccess(await gate.check(session.policy, wallet.address));
  }, [gate, session, wallet]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  /** Runs an action and records its outcome for the current step (or for free play). */
  const run = async (
    label: string,
    fn: () => Promise<Outcome | null>,
    where: "step" | "free" = "step",
  ) => {
    setBusy(label);
    setError(null);
    const record = (outcome: Outcome) =>
      where === "free"
        ? setFreeOutcome(outcome)
        : setOutcomes((o) => ({ ...o, [chapter]: outcome }));
    try {
      const outcome = await fn();
      if (outcome) record(outcome);
    } catch (e) {
      if (e instanceof GateCancelledError) {
        record({
          tone: "neutral",
          headline: "You closed the terms — nothing happened",
          body: "Nothing was signed and the deposit did not run. Try again whenever you like.",
          flow: [],
        });
      } else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      void refresh().catch(() => undefined);
      // Public RPC nodes can lag a few seconds behind a just-confirmed transaction: read again.
      setTimeout(() => void refresh().catch(() => undefined), 3000);
    }
  };

  async function sendDeposit(investor: DemoWallet, passOwner: string): Promise<DepositResult> {
    // Gate v3: the vault reads the pass owner's Stele passport (one account for every document).
    const [passport] = await findPassportPda(address(passOwner));
    const ix = depositWithPassportInstruction({
      investor: address(investor.address),
      vault: address(session!.vault!),
      policy: address(session!.policy!),
      passport,
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
    const r = await api<DepositResult>("/v1/demo/sessions/deposit", {
      token: session!.token,
      transaction: getBase64EncodedWireTransaction(signed),
    });
    if (r.ok && r.deposit)
      setVault((v) => ({ ...v, total: r.deposit!.totalDeposited, count: r.deposit!.depositCount }));
    else if (!r.ok) setVault((v) => ({ ...v, refused: v.refused + 1 }));
    return r;
  }

  const logDeposit = (label: string, r: DepositResult) =>
    push({
      label,
      tone: r.ok ? "success" : "danger",
      outcome: r.ok ? "Deposit executed" : `Rejected · ${r.failure?.name ?? "failed"}`,
      signature: r.signature,
    });

  const START_NOTES = [
    "Publishing Investor Offering Terms v1 on Solana…",
    "Creating the Stele policy that requires them…",
    "Opening the Atlas vault…",
  ];
  const start = () =>
    run("start", async () => {
      let i = 0;
      setStartNote(START_NOTES[0]!);
      const timer = setInterval(() => {
        i = Math.min(i + 1, START_NOTES.length - 1);
        setStartNote(START_NOTES[i]!);
      }, 3000);
      try {
        const s = await api<Session>("/v1/demo/sessions", { kind: "gate" });
        setSession(s);
        setLog([]);
        setOutcomes({});
        setVault({ total: 0, count: 0, refused: 0 });
        setChapter(0);
        push({
          label: "Offering Terms v1 published · policy and vault created",
          tone: "accent",
          outcome: "Ready",
          signature: s.version.signature,
        });
      } finally {
        clearInterval(timer);
        setStartNote(null);
      }
      return null;
    });

  const depositThroughGate = async (): Promise<Outcome> => {
    const before = await gate.check(session!.policy!, wallet.address);
    const r = await gate.gate({
      policy: session!.policy!,
      action: () => sendDeposit(wallet, wallet.address),
      acceptLabel: "Accept & Deposit",
    });
    const accepted = before.status !== "VALID" ? before.document.version.version : null;
    if (accepted) {
      push({
        label: `Accepted Investor Offering Terms v${accepted}`,
        tone: "success",
        outcome: "Passport entry valid",
      });
    }
    logDeposit("Deposit through the app (Stele SDK)", r);
    const out = depositOutcome(r, "you", false);
    if (r.ok && accepted) {
      return {
        ...out,
        headline: `Accepted v${accepted} and invested`,
        body: `Two things happened with one click: (1) your signature on Offering Terms v${accepted} was recorded on Solana — Stele paid the fee — and your passport now says v${accepted}; (2) the deposit went through, because the vault program found that acceptance in your passport.`,
        flow: [
          {
            label: "You accept",
            sub: `v${accepted}`,
            icon: <FileIcon className="h-4 w-4" />,
            state: "done",
          },
          {
            label: "Passport",
            sub: `valid · v${accepted}`,
            icon: <TicketIcon className="h-4 w-4" />,
            state: "success",
          },
          {
            label: "Vault program",
            sub: "checks the passport",
            icon: <BuildingIcon className="h-4 w-4" />,
            state: "done",
          },
          { label: "5,000 USDC in", icon: <CheckIcon className="h-4 w-4" />, state: "success" },
        ],
      };
    }
    return out;
  };

  const depositDirect = async (): Promise<Outcome> => {
    const r = await sendDeposit(wallet, wallet.address);
    logDeposit("Direct call to deposit(), no app, no SDK", r);
    return depositOutcome(r, "you", true);
  };

  const publishNext = async (): Promise<Outcome> => {
    const v = await api<{ number: number; signature: string }>("/v1/demo/sessions/publish", {
      token: session!.token,
    });
    push({
      label: `Atlas published and requires Offering Terms v${v.number}`,
      tone: "warning",
      outcome: "Older acceptances are outdated",
      signature: v.signature,
    });
    return {
      tone: "warning",
      headline: `Version ${v.number} is now required`,
      body: `Atlas signed one transaction: publish v${v.number} and require it. Every acceptance of an older version — including yours — no longer satisfies the policy. Nothing was rewritten: earlier acceptances stay verifiable.`,
      technical: `PolicyChanged · requires v${v.number}`,
      signature: v.signature,
      flow: [
        {
          label: "Atlas",
          sub: "issuer wallet",
          icon: <ShieldIcon className="h-4 w-4" />,
          state: "done",
        },
        {
          label: "Policy",
          sub: `requires v${v.number}`,
          icon: <GateIcon className="h-4 w-4" />,
          state: "warning",
        },
        {
          label: "Your passport",
          sub: "outdated",
          icon: <TicketIcon className="h-4 w-4" />,
          state: "warning",
        },
      ],
    };
  };

  const borrow = async (): Promise<Outcome> => {
    const r = await sendDeposit(stranger, wallet.address);
    logDeposit("Another wallet presents your passport", r);
    return depositOutcome(r, "other", true);
  };

  const noPass = async (): Promise<Outcome> => {
    const r = await sendDeposit(stranger, stranger.address);
    logDeposit("A wallet that never accepted calls deposit()", r);
    return depositOutcome(r, "other", true);
  };

  const actions: Record<Action, () => Promise<Outcome>> = {
    direct: depositDirect,
    gate: depositThroughGate,
    publish: publishNext,
    borrow,
  };

  const go = (n: number) => {
    setChapter(n);
    setError(null);
    requestAnimationFrame(() => heading.current?.focus());
  };

  if (!session) {
    return (
      <div className="grid gap-6 rounded-2xl border border-line bg-surface p-6 sm:p-8 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-accent">
            The story · about 2 minutes
          </p>
          <h2 className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-fg">
            Atlas Real Estate Vault
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">
            You are an investor. Atlas accepts deposits only from wallets that accepted its{" "}
            <span className="text-fg">current</span> Offering Terms — and that rule is checked by
            the vault&apos;s own Solana program, not by a website.
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">
            You&apos;ll try to get around it, invest properly, watch the terms change, and see
            Solana refuse every shortcut.
          </p>
          <button
            type="button"
            className={buttonClasses("primary", "lg", "mt-6")}
            onClick={start}
            disabled={!!busy}
          >
            {busy === "start" ? <Spinner /> : <ArrowRightIcon className="h-4 w-4" />} Start the demo
          </button>
          {startNote && (
            <p className="mt-3 text-[13px] text-fg-muted" role="status">
              {startNote}
            </p>
          )}
          <div className="mt-4">
            <ErrorNote error={error} />
          </div>
        </div>
        <ul className="space-y-3 self-center text-[14px]">
          {[
            ["No wallet needed", "A temporary demo wallet lives in this tab only."],
            ["Nothing to pay", "Stele pays every network fee."],
            ["Nothing faked", `Each step is a real transaction on ${status.network.label}.`],
            ["No real money", "The vault records demo USDC; no tokens move."],
          ].map(([t, d]) => (
            <li key={t} className="flex gap-3 rounded-xl border border-line bg-bg/40 px-4 py-3">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-verified" aria-hidden="true" />
              <span>
                <span className="font-medium text-fg">{t}.</span>{" "}
                <span className="text-fg-muted">{d}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const receiptId =
    gate.lastAcceptance?.acceptanceId ?? (access?.pass ? toHex(access.pass.acceptanceId) : null);
  const acceptedVersion = access?.passportEntry?.versionNumber ?? access?.pass?.versionNumber;
  const finale = chapter >= CHAPTERS.length;
  const current = CHAPTERS[chapter];
  const outcome = outcomes[chapter];
  const nextVersion = (access?.requiredVersion ?? 1) + 1;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-5">
        <nav aria-label="Demo steps">
          <ol className="flex flex-wrap gap-1.5">
            {[...CHAPTERS.map((c) => c.nav), "Summary"].map((label, i) => {
              const done = i < CHAPTERS.length && outcomes[i] !== undefined;
              const active = i === chapter;
              const reachable = i <= chapter || done || (i > 0 && outcomes[i - 1] !== undefined);
              return (
                <li key={label}>
                  <button
                    type="button"
                    onClick={() => reachable && go(i)}
                    disabled={!reachable || !!busy}
                    aria-current={active ? "step" : undefined}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                      active
                        ? "border-accent-line bg-accent-soft text-fg"
                        : done
                          ? "border-verified-line text-verified hover:bg-verified-soft/40"
                          : "border-line text-fg-subtle",
                    )}
                  >
                    <span className="font-mono text-[11px]" aria-hidden="true">
                      {done ? "✓" : i + 1}
                    </span>
                    {label}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {!finale && current ? (
          <section className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
            <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-accent">
              Step {chapter + 1} of {CHAPTERS.length}
            </p>
            <h2
              ref={heading}
              tabIndex={-1}
              className="mt-2 text-[22px] font-semibold tracking-[-0.02em] text-fg outline-none sm:text-[26px]"
            >
              {current.title}
            </h2>
            <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-fg-muted">
              {current.intro}
            </p>
            {/* A step is done once it has a real result; a closed modal can be tried again. */}
            {(!outcome || outcome.tone === "neutral") && (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className={buttonClasses(
                    current.action === "publish" ? "secondary" : "primary",
                    "lg",
                  )}
                  onClick={() => void run(current.action, actions[current.action])}
                  disabled={!!busy}
                >
                  {busy ? <Spinner /> : null}
                  {current.action === "publish"
                    ? `Publish & require v${nextVersion} (as Atlas)`
                    : current.button}
                </button>
                <span className="text-[13px] text-fg-subtle">{current.expect}</span>
              </div>
            )}
            <div className="mt-4">
              <ErrorNote error={error} />
            </div>
            {outcome && <OutcomeCard outcome={outcome} explorer={explorer} />}
            <div className="mt-6 flex flex-wrap justify-between gap-3 border-t border-line pt-5">
              <button
                type="button"
                className={buttonClasses("ghost", "md")}
                onClick={() => go(chapter - 1)}
                disabled={chapter === 0 || !!busy}
              >
                Back
              </button>
              <button
                type="button"
                className={buttonClasses(outcome ? "primary" : "secondary", "md")}
                onClick={() => go(chapter + 1)}
                disabled={!outcome || !!busy}
              >
                {chapter === CHAPTERS.length - 1 ? "See the summary" : "Next step"}{" "}
                <ArrowRightIcon className="h-4 w-4" />
              </button>
            </div>
          </section>
        ) : (
          <section className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
            <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-verified">
              Summary
            </p>
            <h2
              ref={heading}
              tabIndex={-1}
              className="mt-2 text-[22px] font-semibold tracking-[-0.02em] text-fg outline-none sm:text-[26px]"
            >
              The frontend is optional. The program check is not.
            </h2>
            <ul className="mt-5 space-y-2">
              {CHAPTERS.map((c, i) => {
                const o = outcomes[i];
                return (
                  <li
                    key={c.nav}
                    className="flex items-start gap-3 rounded-xl border border-line bg-bg/40 px-4 py-3"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
                        !o
                          ? "border-line text-fg-subtle"
                          : o.tone === "success"
                            ? "border-verified-line bg-verified-soft text-verified"
                            : o.tone === "danger"
                              ? "border-danger-line bg-danger-soft text-danger"
                              : "border-warning-line bg-warning-soft text-warning",
                      )}
                      aria-hidden="true"
                    >
                      {!o ? "–" : o.tone === "success" ? "✓" : o.tone === "danger" ? "✕" : "!"}
                    </span>
                    <span className="min-w-0 text-[14px]">
                      <span className="font-medium text-fg">{c.title}</span>
                      <span className="block text-fg-muted">
                        {o ? o.headline : "Not tried in this run"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-6 text-[15px] font-semibold text-fg">The whole integration</p>
            <p className="mt-1 text-[14px] text-fg-muted">
              One call in the vault&apos;s own program. Stele is not in the transaction — no proxy,
              no router — the program reads two Solana accounts and decides.
            </p>
            <div className="mt-3">
              <CodeBlock code={REQUIRE_CURRENT} language="rust" />
            </div>
            <p className="mt-6 text-[15px] font-semibold text-fg">Every acceptance is a Proof</p>
            <p className="mt-1 text-[14px] text-fg-muted">
              The acceptance behind your passport entry is an ordinary Stele receipt: the exact
              text, version, signature and time — anyone can verify it without Stele.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={receiptId ? `/receipt/${receiptId}` : "#"}
                aria-disabled={!receiptId}
                className={cn(
                  buttonClasses("primary", "md"),
                  !receiptId && "pointer-events-none opacity-50",
                )}
              >
                Open the receipt of your latest acceptance
              </Link>
              <Link href="/docs/gate" className={buttonClasses("secondary", "md")}>
                Add Gate to your program
              </Link>
              <button
                type="button"
                className={buttonClasses("ghost", "md")}
                onClick={() => void start()}
                disabled={!!busy}
              >
                <RefreshIcon className="h-4 w-4" /> Start over
              </button>
            </div>
          </section>
        )}

        <details className="group rounded-2xl border border-line bg-surface">
          <summary className="cursor-pointer list-none px-5 py-4 text-[14px] font-medium text-fg">
            <span className="inline-flex items-center gap-2">
              <ArrowRightIcon className="h-4 w-4 text-fg-subtle transition-transform group-open:rotate-90" />
              Free play — every control, in any order
            </span>
          </summary>
          <div className="grid gap-2 border-t border-line px-5 py-4 sm:grid-cols-2">
            <button
              type="button"
              className={buttonClasses("primary", "md")}
              onClick={() => void run("gate", depositThroughGate, "free")}
              disabled={!!busy}
            >
              Deposit (through Stele)
            </button>
            <button
              type="button"
              className={buttonClasses("secondary", "md")}
              onClick={() => void run("publish", publishNext, "free")}
              disabled={!!busy}
            >
              Publish &amp; require the next version
            </button>
            <button
              type="button"
              className={buttonClasses("secondary", "md")}
              onClick={() => void run("direct", depositDirect, "free")}
              disabled={!!busy}
            >
              Direct call (no SDK)
            </button>
            <button
              type="button"
              className={buttonClasses("secondary", "md")}
              onClick={() => void run("nopass", noPass, "free")}
              disabled={!!busy}
            >
              Script: wallet that never accepted
            </button>
            <button
              type="button"
              className={buttonClasses("secondary", "md")}
              onClick={() => void run("borrow", borrow, "free")}
              disabled={!!busy}
            >
              Script: reuse your passport from another wallet
            </button>
            {freeOutcome && (
              <div className="sm:col-span-2">
                <OutcomeCard outcome={freeOutcome} explorer={explorer} />
              </div>
            )}
            <p className="self-center text-[12.5px] text-fg-subtle sm:col-span-2">
              From a terminal, the same direct call:{" "}
              <code className="break-all font-mono text-fg-muted">
                pnpm --filter @stele/localnet vault-deposit -- --policy {session.policy}
              </code>
            </p>
          </div>
        </details>
      </div>

      <aside className="h-fit space-y-4 lg:sticky lg:top-24">
        <div className="rounded-2xl border border-line bg-surface px-5 py-2">
          <p className="pt-3 text-[13px] font-semibold text-fg">Live on Solana</p>
          <div className="divide-y divide-line">
            <StateRow item="policy" icon={<GateIcon className="h-4 w-4" />} label="Atlas requires">
              Offering Terms v{access?.requiredVersion ?? session.version.number}
            </StateRow>
            <StateRow item="pass" icon={<TicketIcon className="h-4 w-4" />} label="Your passport">
              {!access ? (
                <StatusBadge tone="neutral">Checking</StatusBadge>
              ) : access.status === "VALID" ? (
                <StatusBadge tone="success">Valid · v{acceptedVersion}</StatusBadge>
              ) : access.status === "OUTDATED" ? (
                <StatusBadge tone="warning">Outdated · v{acceptedVersion}</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">Missing</StatusBadge>
              )}
            </StateRow>
            <StateRow item="vault" icon={<BuildingIcon className="h-4 w-4" />} label="Vault">
              {usdc(vault.total)} in · {vault.count} deposit{vault.count === 1 ? "" : "s"}
              <span className="block text-[12.5px] text-fg-subtle">
                {vault.refused} refused on-chain
              </span>
            </StateRow>
          </div>
          <p className="pb-3 text-[11.5px] text-fg-subtle">
            Read from Solana, not from Stele&apos;s database.
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-surface">
          <p className="border-b border-line px-5 py-3 text-[13px] font-semibold text-fg">
            Transactions
          </p>
          <ul className="max-h-80 divide-y divide-line overflow-y-auto" aria-live="polite">
            {log.map((e) => (
              <li key={e.id} className="px-5 py-3">
                <p className="text-[13px] text-fg">{e.label}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <StatusBadge tone={e.tone}>{e.outcome}</StatusBadge>
                  {e.signature && <TxLink href={explorer(e.signature)} signature={e.signature} />}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

// ---- Proof demo ---------------------------------------------------------------------------------------

function ProofStep({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  children: ReactNode;
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
          <div className="mt-2 text-[14px] leading-relaxed text-fg-muted">{children}</div>
        </div>
      </div>
    </li>
  );
}

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

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <ol className="space-y-3">
        <ProofStep n={1} title="A company publishes its Terms" done={!!session}>
          <p>
            The exact text gets a fingerprint (SHA-256) that is written to Solana. From now on,
            nobody — not even the company — can change what version 1 said.
          </p>
          {session ? (
            <p className="mt-3 text-fg">
              Published v{session.version.number} · fingerprint{" "}
              <span className="font-mono">{shortFingerprint(session.version.fingerprint)}</span> ·{" "}
              <TxLink
                href={explorer(session.version.signature)}
                signature={session.version.signature}
              />
            </p>
          ) : (
            <button
              type="button"
              className={buttonClasses("primary", "md", "mt-3")}
              onClick={publish}
              disabled={!!busy}
            >
              {busy === "publish" ? <Spinner /> : null} Publish Terms v1
            </button>
          )}
        </ProofStep>
        <ProofStep n={2} title="You accept them" done={!!acceptance}>
          <p>
            Your (demo) wallet signs a short message naming that exact version. Stele submits it and
            pays the fee; Solana checks the signature.
          </p>
          {acceptance ? (
            <p className="mt-3 text-fg">
              Accepted ·{" "}
              {acceptance.signature ? (
                <TxLink href={explorer(acceptance.signature)} signature={acceptance.signature} />
              ) : (
                "queued for the next batch"
              )}
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
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
                  Or accept with Face ID / a passkey <ExternalIcon className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          )}
        </ProofStep>
        <ProofStep n={3} title="Anyone can check it — without asking Stele" done={false}>
          <p>
            The receipt holds the exact text and the signature. The verifier runs in your browser
            and compares everything with Solana.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={acceptance?.signature ? `/verify?tx=${acceptance.signature}` : "#"}
              aria-disabled={!acceptance?.signature}
              className={cn(
                buttonClasses("primary", "md"),
                !acceptance?.signature && "pointer-events-none opacity-50",
              )}
            >
              Verify it <ArrowRightIcon className="h-4 w-4" />
            </Link>
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
          </div>
        </ProofStep>
        <ErrorNote error={error} />
      </ol>
      <aside className="h-fit rounded-2xl border border-line bg-surface p-5 text-[14px] leading-relaxed text-fg-muted lg:sticky lg:top-24">
        <p className="text-[13px] font-semibold text-fg">What this proves</p>
        <ul className="mt-3 space-y-2">
          {[
            "Which exact text was accepted — not just “version 1”.",
            "That this key signed it, at a recorded Solana time.",
            "That nobody edited it afterwards.",
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <CheckIcon className="mt-1 h-3.5 w-3.5 shrink-0 text-verified" aria-hidden="true" />
              {t}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12.5px] text-fg-subtle">
          It does not prove who held the key — a signature is not KYC. Runs on{" "}
          {status.network.label}.
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
            Two minutes, step by step. No wallet and no sign-up: a temporary demo wallet is created
            in this tab, and Stele pays every fee. Everything runs on{" "}
            {status ? status.network.label : "a Solana test network"} — nothing is a mock-up.
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
                { value: "gate", label: "Stele Gate · an investment vault" },
                { value: "proof", label: "Stele Proof · accepting terms" },
              ]}
            />
            <p className="mt-4 text-[14px] text-fg-muted">
              {tab === "gate"
                ? "For Solana apps: an action is allowed only after the current terms were accepted — enforced by the program itself."
                : "For any website or app: prove later exactly which terms someone accepted."}
            </p>
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
