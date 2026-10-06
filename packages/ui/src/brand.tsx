/**
 * The Stele mark: an engraved tablet (chamfered top corners — a stele, not a tombstone) bearing
 * three inscribed lines and a seal. It reads at 16px as an app icon and as a favicon.
 */
import type { SVGProps } from "react";
import { cn } from "./cn";

export function SteleMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("h-6 w-6", className)}
      {...props}
    >
      <path
        d="M9.5 4.5h13l4 4v19h-21v-19z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 12.5h11M10.5 16.5h11M10.5 20.5h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.7"
      />
      <circle cx="21.5" cy="21" r="2.25" fill="var(--color-accent, #4cc9f0)" />
    </svg>
  );
}

export function SteleLogo({
  className,
  wordmarkClassName,
}: {
  className?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-fg", className)}>
      <SteleMark className="h-6 w-6" />
      <span className={cn("text-[17px] font-semibold tracking-[-0.02em]", wordmarkClassName)}>
        Stele
      </span>
    </span>
  );
}

/** App icon: the mark on a rounded dark tile (used for favicons and touch icons). */
export function SteleAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("h-16 w-16", className)}>
      <rect width="64" height="64" rx="14" fill="#0e141d" />
      <rect
        x="0.5"
        y="0.5"
        width="63"
        height="63"
        rx="13.5"
        fill="none"
        stroke="rgb(148 163 184 / 0.25)"
      />
      <g transform="translate(16 16)" color="#e7edf5">
        <path
          d="M9.5 4.5h13l4 4v19h-21v-19z"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          strokeLinejoin="round"
        />
        <path
          d="M10.5 12.5h11M10.5 16.5h11M10.5 20.5h6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.7"
        />
        <circle cx="21.5" cy="21" r="2.25" fill="#4cc9f0" />
      </g>
    </svg>
  );
}
