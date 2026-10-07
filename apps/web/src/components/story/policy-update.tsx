"use client";

import { cn, FileIcon, TicketIcon } from "@stele/ui";
import { Reveal, StatusBadge, StoryFrame } from "./story-ui";
import { useSequence } from "./use-sequence";

const CAPTIONS = [
  "The investor accepted Offering Terms v1. Their AccessPass names v1 — and the policy requires v1.",
  "The fund's admin publishes Offering Terms v2 and makes the policy require it.",
  "Nothing is rewritten: the v1 pass simply no longer satisfies the policy.",
  "The investor tries another deposit. The vault program rejects it: v2 is required.",
  "The investor accepts v2 in the Stele modal.",
  "The same AccessPass now names v2. The deposit succeeds — and the v1 acceptance stays on record.",
];

function VersionCard({ v, state }: { v: 1 | 2; state: "current" | "previous" | "hidden" }) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3.5 transition-all duration-500",
        state === "hidden" && "pointer-events-none translate-y-2 opacity-0",
        state === "current" && "border-accent-line bg-accent-soft/40",
        state === "previous" && "border-line bg-bg-raised opacity-80",
      )}
      aria-hidden={state === "hidden"}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-medium text-fg">
          <FileIcon className="h-4 w-4 text-fg-subtle" /> Offering Terms v{v}
        </span>
        <StatusBadge tone={state === "current" ? "accent" : "neutral"}>
          {state === "current" ? "Required" : "Previous"}
        </StatusBadge>
      </div>
      <p className="mt-2 font-mono text-[11px] text-fg-subtle">
        fingerprint {v === 1 ? "72d7 1ed9 83fa…" : "5ba6 d2ac b57b…"}
      </p>
    </div>
  );
}

export function PolicyUpdate() {
  const seq = useSequence(CAPTIONS.length, { intervalMs: [2400, 1900, 2300, 2300, 2000, 4000] });
  const s = seq.step;
  const passVersion = s >= 5 ? 2 : 1;
  const passState = s >= 5 ? "valid" : s >= 2 ? "outdated" : "valid";
  return (
    <StoryFrame seq={seq} title="When the policy changes" captions={CAPTIONS}>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">
            Published versions
          </p>
          <VersionCard v={1} state={s >= 1 ? "previous" : "current"} />
          <VersionCard v={2} state={s >= 1 ? "current" : "hidden"} />
        </div>

        <div className="space-y-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">
            The wallet&apos;s AccessPass
          </p>
          <div
            className={cn(
              "rounded-xl border p-4 transition-all duration-500",
              passState === "valid"
                ? "border-verified-line bg-verified-soft/30"
                : "border-warning-line bg-warning-soft/30",
            )}
          >
            <div className="flex items-center gap-2 text-[13px] font-medium text-fg">
              <TicketIcon className="h-4 w-4 text-fg-subtle" /> AccessPass
            </div>
            <p className="mt-2 text-[13px] text-fg-muted">
              accepted: <span className="font-semibold text-fg">Offering Terms v{passVersion}</span>
            </p>
            <p className="mt-3">
              {passState === "valid" ? (
                <StatusBadge tone="success" className={s === 5 ? "story-pop" : undefined}>
                  Valid
                </StatusBadge>
              ) : (
                <StatusBadge tone="warning">Outdated — v2 required</StatusBadge>
              )}
            </p>
          </div>
          <Reveal show={s >= 4}>
            <div className="rounded-xl border border-line bg-bg-raised p-3 text-[12.5px] text-fg-muted">
              {s >= 5 ? "✓ Accepted v2 in the Stele modal" : "Accept v2 → signing…"}
            </div>
          </Reveal>
        </div>

        <div className="space-y-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">
            Protected deposit
          </p>
          <div className="rounded-xl border border-line bg-bg-raised p-4">
            <p className="text-[13px] font-medium text-fg">deposit(5,000 USDC)</p>
            <p className="mt-3 min-h-[28px]">
              {s < 3 ? (
                <StatusBadge tone="neutral">Waiting</StatusBadge>
              ) : s < 5 ? (
                <StatusBadge tone="danger" className={s === 3 ? "story-shake" : undefined}>
                  Rejected
                </StatusBadge>
              ) : (
                <StatusBadge tone="success" className="story-pop">
                  Success
                </StatusBadge>
              )}
            </p>
            <p className="mt-2 font-mono text-[11px] text-fg-subtle">
              {s >= 3 && s < 5 ? "AccessPassOutdated" : s >= 5 ? "requirement satisfied" : "—"}
            </p>
          </div>
        </div>
      </div>
      <p className="mt-5 text-center text-[16px] font-semibold tracking-[-0.01em] text-fg">
        The evidence for v1 remains. <span className="text-accent">Access now requires v2.</span>
      </p>
    </StoryFrame>
  );
}
