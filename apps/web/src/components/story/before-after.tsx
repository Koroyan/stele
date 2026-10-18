"use client";

import { cn } from "@stele/ui";
import { Reveal, StatusBadge, StoryFrame } from "./story-ui";
import { useSequence } from "./use-sequence";

const CAPTIONS = [
  "Without Stele, the record of an agreement is a row in the company's own database.",
  "A dispute asks: what exactly did user 284 accept? The row cannot say — and the same company controls it.",
  "With Stele, the record is the exact version, its fingerprint, the user's signature, a time and a receipt.",
  "Anyone — the user, an auditor, a court — can check it independently.",
];

const EVIDENCE = [
  ["Document", "Terms of Service — version 3"],
  ["Fingerprint", "SHA-256 9f2c 41aa 07de 5b13…"],
  ["Signature", "the user's passkey or wallet"],
  ["Timestamp", "Solana slot 312,448,901"],
  ["Receipt", "stele-receipt-….json"],
] as const;

export function BeforeAfter() {
  const seq = useSequence(CAPTIONS.length, { intervalMs: [2200, 2800, 2600, 3600] });
  const s = seq.step;
  return (
    <StoryFrame seq={seq} title="The same acceptance, before and after" captions={CAPTIONS}>
      <div className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
        <div
          className={cn(
            "rounded-xl border p-4 transition-colors duration-500",
            s === 1 ? "border-warning-line bg-warning-soft/40" : "border-line bg-bg-raised",
          )}
        >
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">
            Without Stele
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-bg p-3 font-mono text-[12.5px] leading-relaxed text-fg">
            {`acceptances\n─────────────\nuser_id:  284\naccepted: true`}
          </pre>
          <Reveal show={s >= 1} className="mt-3">
            <p className="text-[14px] font-medium text-fg">“What exactly did they accept?”</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge tone="warning">Unknown</StatusBadge>
              <StatusBadge tone="warning">Controlled by the same company</StatusBadge>
            </div>
          </Reveal>
        </div>

        <div
          className={cn(
            "rounded-xl border p-4 transition-colors duration-500",
            s >= 3 ? "border-verified-line bg-verified-soft/30" : "border-line bg-bg-raised",
          )}
        >
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-accent">
            With Stele
          </p>
          <ul className="mt-3 space-y-2">
            {EVIDENCE.map(([k, v], i) => (
              <li
                key={k}
                className={cn(
                  "flex items-baseline justify-between gap-3 rounded-lg border border-line bg-bg px-3 py-2 text-[12.5px] transition-all duration-500",
                  s >= 2 ? "translate-x-0 opacity-100" : "translate-x-2 opacity-0",
                )}
                style={{ transitionDelay: s >= 2 ? `${i * 90}ms` : "0ms" }}
              >
                <span className="text-fg-subtle">{k}</span>
                <span className="text-right text-fg">{v}</span>
              </li>
            ))}
          </ul>
          <Reveal show={s >= 3} className="mt-3">
            <StatusBadge tone="success">Anyone can independently verify</StatusBadge>
          </Reveal>
        </div>
      </div>
    </StoryFrame>
  );
}
