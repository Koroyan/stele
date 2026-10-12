"use client";

/**
 * Building blocks of the explanatory animations. Every state is also written out as text (the
 * caption, announced politely to screen readers) — color and motion never carry information alone.
 */
import { createContext, useContext, type ReactNode } from "react";
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

/**
 * A flow is a row only when its own box fits every node (about 100px each plus connectors);
 * otherwise it is a vertical list. The width comes from the container, not the screen, so a flow
 * in a narrow column never squeezes its labels. Class names are spelled out for Tailwind.
 */
const ROW_LAYOUT = {
  2: {
    flow: "@min-[220px]:flex-row @min-[220px]:items-center",
    node: "@min-[220px]:flex-col @min-[220px]:gap-2 @min-[220px]:px-2.5 @min-[220px]:py-4 @min-[220px]:text-center",
    connector:
      "@min-[220px]:mx-0 @min-[220px]:h-px @min-[220px]:w-auto @min-[220px]:min-w-4 @min-[220px]:flex-1 @min-[220px]:self-center",
  },
  3: {
    flow: "@min-[340px]:flex-row @min-[340px]:items-center",
    node: "@min-[340px]:flex-col @min-[340px]:gap-2 @min-[340px]:px-2.5 @min-[340px]:py-4 @min-[340px]:text-center",
    connector:
      "@min-[340px]:mx-0 @min-[340px]:h-px @min-[340px]:w-auto @min-[340px]:min-w-4 @min-[340px]:flex-1 @min-[340px]:self-center",
  },
  4: {
    flow: "@min-[460px]:flex-row @min-[460px]:items-center",
    node: "@min-[460px]:flex-col @min-[460px]:gap-2 @min-[460px]:px-2.5 @min-[460px]:py-4 @min-[460px]:text-center",
    connector:
      "@min-[460px]:mx-0 @min-[460px]:h-px @min-[460px]:w-auto @min-[460px]:min-w-4 @min-[460px]:flex-1 @min-[460px]:self-center",
  },
  5: {
    flow: "@min-[570px]:flex-row @min-[570px]:items-center",
    node: "@min-[570px]:flex-col @min-[570px]:gap-2 @min-[570px]:px-2.5 @min-[570px]:py-4 @min-[570px]:text-center",
    connector:
      "@min-[570px]:mx-0 @min-[570px]:h-px @min-[570px]:w-auto @min-[570px]:min-w-4 @min-[570px]:flex-1 @min-[570px]:self-center",
  },
  6: {
    flow: "@min-[690px]:flex-row @min-[690px]:items-center",
    node: "@min-[690px]:flex-col @min-[690px]:gap-2 @min-[690px]:px-2.5 @min-[690px]:py-4 @min-[690px]:text-center",
    connector:
      "@min-[690px]:mx-0 @min-[690px]:h-px @min-[690px]:w-auto @min-[690px]:min-w-4 @min-[690px]:flex-1 @min-[690px]:self-center",
  },
} as const;
type FlowSize = keyof typeof ROW_LAYOUT;

const FlowSizeContext = createContext<FlowSize>(4);
const useRowLayout = () => ROW_LAYOUT[useContext(FlowSizeContext)];

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
  const row = useRowLayout();
  return (
    <div
      data-state={state}
      className={cn(
        "relative flex min-w-0 items-center gap-3 rounded-xl border px-3.5 py-3 transition-all duration-500",
        row.node,
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
      <span className="min-w-0 [overflow-wrap:anywhere]">
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

/** A connector between nodes: vertical in a list, horizontal in a row. Animated while `active`. */
export function Connector({
  state,
  className,
}: {
  state: "idle" | "active" | "done" | "blocked";
  className?: string;
}) {
  const row = useRowLayout();
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative mx-auto h-6 w-px shrink-0 overflow-hidden",
        row.connector,
        state === "blocked" ? "bg-danger/60" : state === "idle" ? "bg-line-strong" : "bg-accent/50",
        className,
      )}
    >
      {state === "active" && <span className="story-pulse absolute inset-0" />}
    </div>
  );
}

/** A chain of `nodes` nodes and their connectors: a row when it fits its box, else a list. */
export function Flow({
  children,
  className,
  nodes,
}: {
  children: ReactNode;
  className?: string;
  /** How many FlowNodes the chain holds (2–6); it decides when the row fits. */
  nodes: number;
}) {
  const size = Math.min(6, Math.max(2, nodes)) as FlowSize;
  return (
    <FlowSizeContext.Provider value={size}>
      <div className={cn("@container", className)}>
        <div className={cn("flex flex-col items-stretch gap-0", ROW_LAYOUT[size].flow)}>
          {children}
        </div>
      </div>
    </FlowSizeContext.Provider>
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
        // A size container: the content inside lays out by the frame's width, not the screen's.
        "@container rounded-2xl border border-line bg-surface/70 p-4 shadow-[var(--shadow-card)] backdrop-blur-sm sm:p-6",
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
