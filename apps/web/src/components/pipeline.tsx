/**
 * The evidence pipeline, from document to independent verification. Purely illustrative: it
 * describes the protocol's stages and shows no verification result.
 */
import type { ReactNode } from "react";
import {
  FileIcon,
  HashIcon,
  LayersIcon,
  PenIcon,
  SearchIcon,
  ShieldIcon,
  DownloadIcon,
} from "@stele/ui";

const STAGES: { icon: ReactNode; title: string; detail: string }[] = [
  {
    icon: <FileIcon className="h-[18px] w-[18px]" />,
    title: "Document",
    detail: "Your terms, as written",
  },
  {
    icon: <LayersIcon className="h-[18px] w-[18px]" />,
    title: "Canonical bytes",
    detail: "stele-canonical-v1",
  },
  {
    icon: <HashIcon className="h-[18px] w-[18px]" />,
    title: "Fingerprint",
    detail: "SHA-256, recomputed on-chain",
  },
  {
    icon: <ShieldIcon className="h-[18px] w-[18px]" />,
    title: "Published",
    detail: "Immutable Solana account",
  },
  {
    icon: <PenIcon className="h-[18px] w-[18px]" />,
    title: "Signed",
    detail: "User's wallet, exact text",
  },
  {
    icon: <DownloadIcon className="h-[18px] w-[18px]" />,
    title: "Receipt",
    detail: "Portable JSON proof",
  },
  {
    icon: <SearchIcon className="h-[18px] w-[18px]" />,
    title: "Verified",
    detail: "By anyone, independently",
  },
];

export function Pipeline() {
  return (
    <div className="relative mx-auto mt-16 max-w-5xl">
      <div className="rounded-2xl border border-line bg-surface/70 p-2 shadow-[var(--shadow-card)] backdrop-blur-sm">
        <ol
          className="relative grid grid-cols-1 gap-1 sm:grid-cols-7 sm:gap-0"
          aria-label="How evidence is produced"
        >
          {/* connector (desktop) */}
          <div
            className="pointer-events-none absolute left-[7%] right-[7%] top-[38px] hidden h-px overflow-hidden bg-line-strong sm:block"
            aria-hidden="true"
          >
            <div className="animate-travel h-px w-[14%] bg-gradient-to-r from-transparent via-accent to-transparent" />
          </div>
          {STAGES.map((s, i) => (
            <li
              key={s.title}
              className="relative flex items-center gap-4 rounded-xl px-4 py-3 sm:flex-col sm:gap-3 sm:px-2 sm:py-5 sm:text-center"
            >
              <span
                className={
                  i === STAGES.length - 1
                    ? "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent-line bg-[#0b1a22] text-accent shadow-[var(--shadow-glow)]"
                    : "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-surface-2 text-fg-muted"
                }
              >
                {s.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium text-fg">{s.title}</span>
                <span className="mt-0.5 block font-mono text-[11px] leading-snug text-fg-subtle">
                  {s.detail}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
