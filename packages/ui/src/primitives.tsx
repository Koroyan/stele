/** Core primitives (server-safe). Every interactive element has a visible focus state and an accessible name. */
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn";
import { AlertIcon, CheckCircleIcon, CheckIcon, InfoIcon } from "./icons";
import { CopyButton } from "./interactive";
import { markPlaceholders } from "./placeholders";

// ---- Button -------------------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "verified";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "relative inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-[background-color,color,border-color,box-shadow,opacity] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink hover:bg-accent-strong shadow-[0_0_0_1px_rgb(76_201_240/0.35),0_8px_24px_-12px_rgb(76_201_240/0.6)]",
  secondary:
    "bg-surface-2 text-fg border border-line-strong hover:bg-surface-3 hover:border-[rgb(148_163_184/0.28)]",
  ghost: "text-fg-muted hover:text-fg hover:bg-surface-2",
  danger: "bg-danger-soft text-danger border border-danger-line hover:bg-[rgb(248_113_113/0.16)]",
  verified: "bg-verified-soft text-verified border border-verified-line",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    className,
    children,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});

/** Anchor styled as a button (keeps link semantics). */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
}

// ---- Spinner / Skeleton ---------------------------------------------------------------------------

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-5 w-5 animate-spin", className)} aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-surface-3/70", className)} />
  );
}

// ---- Card ---------------------------------------------------------------------------------------------

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1 border-b border-line px-5 py-4 sm:px-6", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-[15px] font-semibold tracking-[-0.01em] text-fg", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-[13px] leading-relaxed text-fg-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-5 sm:px-6", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-3 border-t border-line px-5 py-4 sm:px-6",
        className,
      )}
      {...props}
    />
  );
}

// ---- Badge ----------------------------------------------------------------------------------------------

type BadgeTone = "neutral" | "accent" | "verified" | "warning" | "danger";
const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-3 text-fg-muted border-line-strong",
  accent: "bg-accent-soft text-accent border-accent-line",
  verified: "bg-verified-soft text-verified border-verified-line",
  warning: "bg-warning-soft text-warning border-warning-line",
  danger: "bg-danger-soft text-danger border-danger-line",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] font-medium leading-5",
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** Verification badge — the ONLY place the verified color appears next to an organization. */
export function VerifiedBadge({
  domain,
  className,
}: {
  domain: string | null;
  className?: string;
}) {
  return domain ? (
    <Badge tone="verified" className={className}>
      <CheckIcon className="h-3.5 w-3.5" />
      Verified domain <span className="font-mono text-[11.5px]">{domain}</span>
    </Badge>
  ) : (
    <Badge tone="warning" className={className}>
      <AlertIcon className="h-3.5 w-3.5" />
      Unverified organization
    </Badge>
  );
}

// ---- Form controls -------------------------------------------------------------------------------------------

const FIELD =
  "w-full rounded-lg border border-line-strong bg-bg-raised px-3 text-sm text-fg placeholder:text-fg-subtle outline-none transition-colors focus:border-accent-line focus:ring-2 focus:ring-accent/25 disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(FIELD, "h-10", className)} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea ref={ref} className={cn(FIELD, "py-2.5 leading-relaxed", className)} {...props} />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          FIELD,
          "h-10 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

// ---- Alert -----------------------------------------------------------------------------------------------------

type AlertTone = "info" | "success" | "warning" | "danger";
const ALERT_TONES: Record<AlertTone, string> = {
  info: "border-accent-line bg-accent-soft text-fg",
  success: "border-verified-line bg-verified-soft text-fg",
  warning: "border-warning-line bg-warning-soft text-fg",
  danger: "border-danger-line bg-danger-soft text-fg",
};
const ALERT_ICON_TONES: Record<AlertTone, string> = {
  info: "text-accent",
  success: "text-verified",
  warning: "text-warning",
  danger: "text-danger",
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const Icon = tone === "success" ? CheckCircleIcon : tone === "info" ? InfoIcon : AlertIcon;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-xl border px-4 py-3 text-[13.5px] leading-relaxed",
        ALERT_TONES[tone],
        className,
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", ALERT_ICON_TONES[tone])} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-fg">{title}</p>}
        {children && <div className={cn("text-fg-muted", title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  );
}

// ---- Copy & fingerprints ----------------------------------------------------------------------------------------

/** A hash/address with copy. `mode="short"` shows head…tail; `mode="grouped"` shows 4-char groups. */
export function Fingerprint({
  value,
  mode = "short",
  className,
  copy = true,
}: {
  value: string;
  mode?: "short" | "full" | "grouped";
  className?: string;
  copy?: boolean;
}) {
  const display =
    mode === "short" && value.length > 16
      ? `${value.slice(0, 8)}…${value.slice(-6)}`
      : mode === "grouped"
        ? (value.match(/.{1,4}/g)?.join(" ") ?? value)
        : value;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 font-mono text-[12.5px] text-fg",
        className,
      )}
    >
      <span className={cn(mode === "short" ? "truncate" : "break-all")} title={value}>
        {display}
      </span>
      {copy && <CopyButton value={value} />}
    </span>
  );
}

export function CodeBlock({
  code,
  language,
  className,
  placeholders = [],
}: {
  code: string;
  language?: string;
  className?: string;
  /** Values to highlight as "replace me" (the copied text is unchanged). */
  placeholders?: readonly string[];
}) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-line bg-[#060a0f]",
        className,
      )}
    >
      {language && (
        <div className="border-b border-line px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-fg-subtle">
          {language}
        </div>
      )}
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-fg">
        <code>{markPlaceholders(code, placeholders)}</code>
      </pre>
      <CopyButton
        value={code}
        label="Copy"
        showLabel
        className={cn(
          "absolute right-2 opacity-80 group-hover:opacity-100",
          language ? "top-1" : "top-2 bg-[#060a0f]",
        )}
      />
    </div>
  );
}

// ---- Data display -------------------------------------------------------------------------------------------------

export function KeyValue({
  items,
  className,
}: {
  items: { label: string; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[minmax(140px,max-content)_1fr]",
        className,
      )}
    >
      {items.map((it) => (
        <div key={it.label} className="contents">
          <dt className="text-[13px] text-fg-subtle">{it.label}</dt>
          <dd className="min-w-0 text-[13.5px] text-fg">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Stat tile: label · value · optional delta and caption (dataviz figure contract). */
export function Stat({
  label,
  value,
  caption,
  className,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("px-5 py-4", className)}>
      <p className="text-[13px] text-fg-muted">{label}</p>
      <p className="mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.02em] text-fg">
        {value}
      </p>
      {caption && <p className="mt-2 text-[12.5px] text-fg-subtle">{caption}</p>}
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-line-strong bg-surface-2 text-fg-muted">
        {icon ?? <InfoIcon className="h-5 w-5" />}
      </div>
      <p className="text-[15px] font-medium text-fg">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-md text-[13.5px] leading-relaxed text-fg-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Separator({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-line", className)} />;
}

// ---- Progress steps ------------------------------------------------------------------------------------------------------

export type StepState = "done" | "active" | "pending" | "error";

export function Steps({
  steps,
  className,
}: {
  steps: { label: string; state: StepState; detail?: ReactNode }[];
  className?: string;
}) {
  return (
    <ol className={cn("flex flex-col gap-3", className)}>
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
              s.state === "done" && "border-verified-line bg-verified-soft text-verified",
              s.state === "active" && "border-accent-line bg-accent-soft text-accent",
              s.state === "pending" && "border-line-strong text-fg-subtle",
              s.state === "error" && "border-danger-line bg-danger-soft text-danger",
            )}
            aria-hidden="true"
          >
            {s.state === "done" ? (
              <CheckIcon className="h-3 w-3" />
            ) : s.state === "active" ? (
              <Spinner className="h-3 w-3" />
            ) : s.state === "error" ? (
              "!"
            ) : (
              i + 1
            )}
          </span>
          <div className="min-w-0">
            <p
              className={cn("text-[13.5px]", s.state === "pending" ? "text-fg-subtle" : "text-fg")}
            >
              {s.label}
            </p>
            {s.detail && <div className="mt-0.5 text-[12.5px] text-fg-muted">{s.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
