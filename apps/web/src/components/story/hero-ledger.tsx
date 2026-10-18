"use client";
/**
 * The home page's opening scene: the same acceptance kept two ways. A database row is quietly
 * edited and nobody can tell; the Stele record is signed by the user, cannot be edited, and anyone
 * can check it.
 */
import { CheckIcon, LockIcon, cn } from "@stele/ui";
import { StatusBadge } from "./story-ui";
import { useSequence } from "./use-sequence";

const CAPTIONS = [
  "Today: a user ticks “I agree”. The company stores a row.",
  "Later, the row changes — version, date. Who changed it? Nobody can tell.",
  "With Stele, the user signs the exact text. The record lives on Solana.",
  "Nobody can edit it — not the company, not Stele.",
  "Anyone can verify it, years later, without trusting anyone.",
];

function Row({ k, v, edited }: { k: string; v: string; edited?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 last:border-0">
      <span className="text-fg-subtle">{k}</span>
      <span className="text-right">
        {edited ? (
          <>
            <span className="mr-2 text-fg-subtle line-through">{v}</span>
            <span className="rounded bg-warning-soft px-1 text-warning">{edited}</span>
          </>
        ) : (
          <span className="text-fg">{v}</span>
        )}
      </span>
    </div>
  );
}

export function HeroLedger() {
  const seq = useSequence(CAPTIONS.length, { intervalMs: [2600, 3000, 2800, 2600, 4200] });
  const s = seq.step;
  return (
    <div ref={seq.ref} className="mx-auto w-full max-w-4xl">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Today */}
        <div
          className={cn(
            "relative rounded-2xl border bg-surface/80 p-5 text-left backdrop-blur transition-all duration-700",
            s === 1 ? "border-warning-line shadow-[0_0_0_6px_rgb(245_158_11/0.08)]" : "border-line",
            s >= 2 && "md:opacity-70",
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
              Today · a database row
            </p>
            {s >= 1 ? (
              <StatusBadge tone="warning">Edited</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">Stored</StatusBadge>
            )}
          </div>
          <div className="mt-4 rounded-xl border border-line bg-bg px-4 py-3 font-mono text-[12.5px]">
            <Row k="user_id" v="284" />
            <Row k="accepted_terms" v="true" />
            <Row k="version" v="3" edited={s >= 1 ? "4" : null} />
            <Row k="accepted_at" v="2026-03-02" edited={s >= 1 ? "2026-06-18" : null} />
          </div>
          <p
            className={cn(
              "mt-3 text-[13px] leading-relaxed transition-colors duration-500",
              s >= 1 ? "text-warning" : "text-fg-muted",
            )}
          >
            {s >= 1
              ? "Changed by whom? When? There is no way to know."
              : "Kept — and editable — by the company itself."}
          </p>
        </div>

        {/* With Stele */}
        <div
          className={cn(
            "relative rounded-2xl border p-5 text-left transition-all duration-700",
            s >= 2 ? "opacity-100" : "opacity-40",
            s === 3 && "story-shake",
            s >= 4
              ? "border-verified-line bg-verified-soft/20 shadow-[0_0_0_6px_rgb(52_211_153/0.08)]"
              : "border-accent-line bg-surface/80",
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-accent">
              With Stele · on Solana
            </p>
            {s >= 4 ? (
              <StatusBadge tone="success">Verified</StatusBadge>
            ) : s === 3 ? (
              <StatusBadge tone="danger">Edit refused</StatusBadge>
            ) : (
              <StatusBadge tone="accent">Signed</StatusBadge>
            )}
          </div>
          <div className="mt-4 rounded-xl border border-line bg-bg px-4 py-3 font-mono text-[12.5px]">
            <Row k="document" v="Terms of Service v3" />
            <Row k="fingerprint" v="9f2c 41aa 07de…" />
            <Row k="signed by" v="the user's passkey" />
            <Row k="recorded" v="Solana slot 312,448,901" />
          </div>
          <p
            className={cn(
              "mt-3 flex items-center gap-2 text-[13px] leading-relaxed transition-colors duration-500",
              s >= 4 ? "text-verified" : s === 3 ? "text-danger" : "text-fg-muted",
            )}
          >
            {s >= 4 ? (
              <>
                <CheckIcon className="h-4 w-4 shrink-0" /> Anyone can check it — no trust needed.
              </>
            ) : (
              <>
                <LockIcon className="h-4 w-4 shrink-0" /> No one can change it — there is no edit.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col items-center gap-3">
        <p
          aria-live="polite"
          className="min-h-[1.5em] text-center text-[14.5px] font-medium text-fg"
        >
          {CAPTIONS[s]}
        </p>
        <div className="flex gap-1.5" role="tablist" aria-label="Scene">
          {CAPTIONS.map((c, i) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={i === s}
              aria-label={`Step ${i + 1}`}
              onClick={() => seq.go(i)}
              className={cn(
                "h-1.5 rounded-full transition-all duration-500",
                i === s ? "w-8 bg-accent" : "w-3 bg-line-strong hover:bg-fg-subtle",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
