"use client";

import { cn, ActivityIcon, LayersIcon, ShieldIcon, TicketIcon, UsersIcon } from "@stele/ui";
import { Connector, Flow, FlowNode, StatusBadge, StoryFrame } from "./story-ui";
import { useSequence } from "./use-sequence";

const CAPTIONS = [
  "An investor taps “Deposit 5,000 USDC” in the Atlas Real Estate Vault app.",
  "The vault program checks the investor's Stele AccessPass with require_current().",
  "There is none: the deposit would be blocked. The app opens the Stele modal instead of failing.",
  "The modal shows the Investor Offering Terms, version 1. The investor agrees.",
  "The investor signs the exact terms with their wallet. The acceptance is recorded on Solana.",
  "Recording the acceptance creates the investor's AccessPass — valid for v1.",
  "The deposit continues: require_current() passes and the vault executes it.",
];

const PASS = ["Missing", "Missing", "Missing", "Missing", "Creating", "Valid", "Valid"] as const;

export function GateFlow() {
  const seq = useSequence(CAPTIONS.length, {
    intervalMs: [1700, 2000, 2200, 2000, 2000, 1800, 3800],
  });
  const s = seq.step;
  const blocked = s === 2;
  const pass = PASS[s]!;
  return (
    <StoryFrame seq={seq} title="Stele Gate — a protected deposit" captions={CAPTIONS}>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,300px)_1fr]">
        {/* The app */}
        <div className="relative mx-auto w-full max-w-[300px] overflow-hidden rounded-[22px] border border-line-strong bg-bg p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between text-[11px] text-fg-subtle">
            <span>atlas.fund</span>
            <span className="font-mono">7xKX…9f3A</span>
          </div>
          <p className="mt-4 text-[13px] font-medium text-fg">Atlas Real Estate Vault</p>
          <p className="text-[11.5px] text-fg-subtle">Commercial property income · 7.2% target</p>
          <div className="mt-4 rounded-xl border border-line bg-surface p-3">
            <p className="text-[11px] text-fg-subtle">Deposit</p>
            <p className="text-[22px] font-semibold tracking-tight text-fg">5,000 USDC</p>
          </div>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className={cn(
              "mt-4 w-full rounded-xl py-3 text-[14px] font-bold transition-all duration-300",
              s === 0
                ? "scale-[0.97] bg-accent-strong text-accent-ink"
                : "bg-accent text-accent-ink",
            )}
          >
            Deposit
          </button>
          <div className="mt-3 min-h-[28px] text-center">
            {s === 6 && (
              <StatusBadge tone="success" className="story-pop">
                Deposit succeeded
              </StatusBadge>
            )}
            {blocked && <StatusBadge tone="danger">Blocked · no AccessPass</StatusBadge>}
          </div>

          {/* The Stele modal */}
          <div
            aria-hidden={!(s >= 3 && s <= 5)}
            className={cn(
              "absolute inset-x-2 bottom-2 rounded-2xl border border-line-strong bg-surface-2 p-3.5 shadow-2xl transition-all duration-500",
              s >= 3 && s <= 5
                ? "translate-y-0 opacity-100"
                : "pointer-events-none translate-y-6 opacity-0",
            )}
          >
            <p className="text-[10px] font-bold tracking-[0.16em] text-fg-subtle">STELE</p>
            <p className="mt-1 text-[15px] font-semibold text-fg">Investor Offering Terms</p>
            <p className="text-[11.5px] text-fg-subtle">Version 1</p>
            <p className="mt-2 text-[11.5px] leading-snug text-fg-muted">
              Please review these terms before continuing. You can lose some or all of your
              investment…
            </p>
            <p className="mt-2 text-[11.5px] text-fg">{s >= 4 ? "☑" : "☐"} I have read and agree</p>
            <p
              className={cn(
                "mt-2 rounded-lg py-2 text-center text-[12px] font-bold transition-colors",
                s >= 5 ? "bg-verified text-bg" : "bg-accent text-accent-ink",
              )}
            >
              {s >= 5 ? "✓ Access granted" : s >= 4 ? "Signing in wallet…" : "Accept & Deposit"}
            </p>
          </div>
        </div>

        {/* The path of the action */}
        <div className="min-w-0">
          <Flow>
            <FlowNode
              icon={<UsersIcon className="h-[18px] w-[18px]" />}
              label="Investor"
              sub="Deposit 5,000 USDC"
              state={s === 0 ? "active" : "done"}
            />
            <Connector state={s >= 1 ? "done" : "idle"} />
            <FlowNode
              icon={<LayersIcon className="h-[18px] w-[18px]" />}
              label="Vault program"
              sub="deposit()"
              state={s === 1 ? "active" : s === 6 ? "success" : s > 1 ? "done" : "idle"}
            />
            <Connector
              state={s === 1 ? "active" : blocked ? "blocked" : s === 6 ? "done" : "idle"}
            />
            <FlowNode
              icon={<ShieldIcon className="h-[18px] w-[18px]" />}
              label="require_current()"
              sub={s === 6 ? "AccessPass v1 ✓" : blocked ? "AccessPass missing" : "AccessPass?"}
              state={blocked ? "blocked" : s === 6 ? "success" : s === 1 ? "active" : "idle"}
            />
            <Connector state={s === 6 ? "active" : "idle"} />
            <FlowNode
              icon={<ActivityIcon className="h-[18px] w-[18px]" />}
              label="Deposit"
              sub={s === 6 ? "executed" : blocked ? "blocked" : "waiting"}
              state={s === 6 ? "success" : blocked ? "blocked" : "idle"}
            />
          </Flow>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-bg-raised p-3.5">
              <p className="flex items-center gap-1.5 text-[11.5px] uppercase tracking-[0.08em] text-fg-subtle">
                <TicketIcon className="h-3.5 w-3.5" /> AccessPass
              </p>
              <p className="mt-2">
                <StatusBadge
                  tone={pass === "Valid" ? "success" : pass === "Creating" ? "accent" : "neutral"}
                  className={pass === "Valid" && s === 5 ? "story-pop" : undefined}
                >
                  {pass === "Valid" ? "Valid · Offering Terms v1" : pass}
                </StatusBadge>
              </p>
            </div>
            <div className="rounded-xl border border-line bg-bg-raised p-3.5">
              <p className="text-[11.5px] uppercase tracking-[0.08em] text-fg-subtle">
                Program check
              </p>
              <p className="mt-2">
                {s < 1 ? (
                  <StatusBadge tone="neutral">Not run</StatusBadge>
                ) : s < 6 ? (
                  <StatusBadge tone="danger">Would reject · missing</StatusBadge>
                ) : (
                  <StatusBadge tone="success">Passed</StatusBadge>
                )}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[12.5px] text-fg-muted">
            Acceptance and deposit are two transactions: the investor sees one “Accept &amp;
            Deposit” step.
          </p>
        </div>
      </div>
    </StoryFrame>
  );
}
