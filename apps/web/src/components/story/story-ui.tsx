"use client";

/**
 * Building blocks of the explanatory animations. Every state is also written out as text (the
 * caption, announced politely to screen readers) — color and motion never carry information alone.
 */
import type { ReactNode } from "react";
import { cn } from "@stele/ui";
import type { Sequence } from "./use-sequence";

export type NodeState = "idle" | "active" | "done" | "blocked" | "success" | "warning";

const NODE_STYLES: Record<NodeState, string> = {
  idle: "border-line-strong bg-surface-2 text-fg-subtle",
  active: "border-accent-line bg-accent-soft text-fg shadow-[var(--shadow-glow)]",
  done: "border-accent-line bg-surface-2 text-fg",
  blocked: "border-danger-line bg-danger-soft text-fg story-shake",
  success: "border-verified-line bg-verified-soft text-fg",
  warning: "border-warning-line bg-warning-soft text-fg",
};

const ICON_STYLES: Record<NodeState, string> = {
  idle: "text-fg-subtle",
  active: "text-accent",
  done: "text-accent",
  blocked: "text-danger",
  success: "text-verified",
  warning: "text-warning",
};

export function FlowNode({
  icon,
  label,
  sub,
  state,
  className,
}: {
  icon: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  state: NodeState;
  className?: string;
}) {
  return (
    <div
      data-state={state}
      className={cn(
        "relative flex min-w-0 items-center gap-3 rounded-xl border px-3.5 py-3 transition-all duration-500 sm:flex-col sm:gap-2 sm:px-3 sm:py-4 sm:text-center",
        NODE_STYLES[state],
        className,
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-bg/60 transition-colors duration-500",
          ICON_STYLES[state],
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium leading-snug">{label}</span>
        {sub && (
          <span className="mt-0.5 block font-mono text-[11px] leading-snug text-fg-subtle">
            {sub}
          </span>
        )}
      </span>
    </div>
  );
}

/** A connector between nodes: vertical on phones, horizontal from `sm` up. Animated while `active`. */
export function Connector({
  state,
  className,
}: {
  state: "idle" | "active" | "done" | "blocked";
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative mx-auto h-6 w-px shrink-0 overflow-hidden sm:mx-0 sm:h-px sm:w-auto sm:min-w-6 sm:flex-1 sm:self-center",
        state === "blocked" ? "bg-danger/60" : state === "idle" ? "bg-line-strong" : "bg-accent/50",
        className,
      )}
    >
      {state === "active" && <span className="story-pulse absolute inset-0" />}
    </div>
  );
}

/** A horizontal (desktop) / vertical (phone) chain of nodes and connectors. */
export function Flow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-stretch gap-0 sm:flex-row sm:items-center", className)}>
      {children}
    </div>
  );
}

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: "neutral" | "accent" | "success" | "danger" | "warning";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "border-line-strong bg-surface-2 text-fg-muted",
    accent: "border-accent-line bg-accent-soft text-accent",
    success: "border-verified-line bg-verified-soft text-verified",
    danger: "border-danger-line bg-danger-soft text-danger",
    warning: "border-warning-line bg-warning-soft text-warning",
  } as const;
  const glyph = { neutral: "•", accent: "→", success: "✓", danger: "✕", warning: "!" }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11.5px] font-semibold uppercase tracking-[0.06em] transition-all duration-500",
        tones[tone],
        className,
      )}
    >
      <span aria-hidden="true">{glyph}</span>
      {children}
    </span>
  );
}

/** Frame with the scene, its caption for the current state, and playback controls. */
export function StoryFrame({
  seq,
  title,
  captions,
  children,
  className,
  label = "Illustration",
}: {
  seq: Sequence;
  title: string;
  captions: string[];
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <figure
      ref={seq.ref}
      className={cn(
        "rounded-2xl border border-line bg-surface/70 p-4 shadow-[var(--shadow-card)] backdrop-blur-sm sm:p-6",
        className,
      )}
      aria-label={title}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
          {title}
        </span>
        <span className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-fg-subtle">
          {label}
        </span>
      </div>
      {children}
      <figcaption className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-h-[2.6em] text-[13.5px] leading-snug text-fg-muted" aria-live="polite">
          <span className="mr-2 font-mono text-[11.5px] text-accent">
            {seq.step + 1}/{seq.count}
          </span>
          {captions[seq.step]}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <ControlButton label="Previous step" onClick={seq.prev} disabled={seq.step === 0}>
            <path d="M15 6l-6 6 6 6" />
          </ControlButton>
          {seq.playing ? (
            <ControlButton label="Pause" onClick={seq.pause}>
              <path d="M9 6v12M15 6v12" />
            </ControlButton>
          ) : (
            <ControlButton label={seq.step >= seq.count - 1 ? "Replay" : "Play"} onClick={seq.play}>
              <path d="M8 5l11 7-11 7z" />
            </ControlButton>
          )}
          <ControlButton label="Next step" onClick={seq.next} disabled={seq.step >= seq.count - 1}>
            <path d="M9 6l6 6-6 6" />
          </ControlButton>
        </div>
      </figcaption>
    </figure>
  );
}

function ControlButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-fg-muted transition-colors hover:border-line-strong hover:text-fg disabled:opacity-40"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}

/** Shows `children` only from `at` on, fading/sliding in (static under reduced motion via CSS). */
export function Reveal({
  show,
  children,
  className,
}: {
  show: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden={!show}
      className={cn(
        "transition-all duration-500 motion-reduce:transition-none",
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
