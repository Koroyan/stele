"use client";
/** Interactive primitives (hooks, browser APIs). Kept separate so server components can use the rest. */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";
import { CheckIcon, CopyIcon } from "./icons";

export function CopyButton({
  value,
  label = "Copy",
  showLabel = false,
  className,
}: {
  value: string;
  label?: string;
  /** Show the label next to the icon (code blocks), not only to assistive technology. */
  showLabel?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent outline-none",
        className,
      )}
      // Short values are read out with the label; long ones (code) would only be noise.
      aria-label={copied ? "Copied" : value.length <= 64 ? `${label}: ${value}` : label}
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-verified" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
      {showLabel && <span aria-hidden="true">{copied ? "Copied" : label}</span>}
    </button>
  );
}

// ---- Tabs ------------------------------------------------------------------------------------------------------------

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode }[];
  className?: string;
}) {
  const id = useId();
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={cn("flex gap-1 border-b border-line", className)}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            id={`${id}-${it.value}`}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-colors outline-none focus-visible:text-fg",
              active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- Dialog (native <dialog>: focus trap and Esc handling are built in) ------------------------------------------------

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-2xl border border-line-strong bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm",
        wide ? "max-w-3xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="border-b border-line px-6 py-4">
            <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
            {description && <p className="mt-1 text-[13px] text-fg-muted">{description}</p>}
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && (
            <div className="flex justify-end gap-3 border-t border-line px-6 py-4">{footer}</div>
          )}
        </div>
      )}
    </dialog>
  );
}
