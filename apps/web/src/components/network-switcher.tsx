"use client";

/**
 * Network switcher and test-network banner. Each network is a separate Stele deployment, so
 * switching navigates to that deployment's address (configured server-side in STELE_NETWORKS),
 * keeping the current page where it exists on every network.
 */
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertIcon, CheckIcon, cn } from "@stele/ui";
import type { NetworkChoice, NetworkMenu } from "@/lib/networks";

const NetworkMenuContext = createContext<NetworkMenu | null>(null);

export function NetworkMenuProvider({
  menu,
  children,
}: {
  menu: NetworkMenu | null;
  children: ReactNode;
}) {
  return <NetworkMenuContext.Provider value={menu}>{children}</NetworkMenuContext.Provider>;
}

/** The same page on another network's deployment. Network-specific pages map to safe entry points. */
function targetHref(base: string, pathname: string): string {
  if (pathname.startsWith("/dashboard") || pathname === "/login") return `${base}/dashboard`;
  if (pathname.startsWith("/receipt/")) return `${base}/verify`;
  if (pathname === "/verify") return `${base}/verify`;
  return `${base}${pathname}`;
}

function Dot({ choice }: { choice: NetworkChoice }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        choice.cluster === "mainnet"
          ? "bg-accent"
          : choice.cluster === "localnet"
            ? "bg-fg-subtle"
            : "bg-warning",
      )}
    />
  );
}

export function NetworkSwitcher({
  variant = "header",
  className,
}: {
  variant?: "header" | "sidebar";
  className?: string;
}) {
  const menu = useContext(NetworkMenuContext);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const menuId = useId();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!menu) return null;
  const { current, choices } = menu;
  const others = choices.filter((c) => !c.current);

  const label = (
    <>
      <Dot choice={current} />
      <span className="truncate">{current.label}</span>
    </>
  );
  const triggerClass =
    variant === "header"
      ? "inline-flex h-8 items-center gap-2 rounded-full border border-line-strong bg-surface/60 px-3 text-[12.5px] text-fg-muted"
      : "flex w-full items-center gap-2 rounded-md px-1 py-1 text-[12px] text-fg-subtle";

  if (others.length === 0) {
    return <div className={cn(triggerClass, className)}>{label}</div>;
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Network: ${current.label}. Switch network`}
        onClick={() => setOpen((o) => !o)}
        className={cn(triggerClass, "transition-colors hover:text-fg")}
      >
        {label}
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={cn("ml-auto h-3 w-3 shrink-0 transition-transform", open && "rotate-180")}
        >
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Choose a network"
          className={cn(
            "absolute z-[60] w-64 rounded-xl border border-line-strong bg-surface p-1.5 shadow-2xl",
            variant === "header" ? "right-0 top-10" : "bottom-9 left-0",
          )}
        >
          <p className="px-2.5 pb-1.5 pt-1 text-[11px] uppercase tracking-[0.08em] text-fg-subtle">
            Network
          </p>
          {choices.map((choice, i) => {
            const body = (
              <>
                <Dot choice={choice} />
                <span className="flex-1">{choice.label}</span>
                {choice.current ? (
                  <>
                    <CheckIcon className="h-3.5 w-3.5 text-accent" />
                    <span className="sr-only">(current)</span>
                  </>
                ) : !choice.url ? (
                  <span className="text-[11px] text-fg-subtle">Not available</span>
                ) : choice.test ? (
                  <span className="text-[11px] text-fg-subtle">Test network</span>
                ) : null}
              </>
            );
            const itemClass =
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none";
            if (choice.current || !choice.url) {
              return (
                <div
                  key={choice.cluster}
                  role="menuitem"
                  aria-disabled="true"
                  aria-current={choice.current ? "true" : undefined}
                  className={cn(itemClass, choice.current ? "text-fg" : "text-fg-subtle")}
                >
                  {body}
                </div>
              );
            }
            return (
              <a
                key={choice.cluster}
                ref={i === choices.findIndex((c) => !c.current && c.url) ? firstItemRef : undefined}
                role="menuitem"
                href={targetHref(choice.url, pathname)}
                className={cn(
                  itemClass,
                  "text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:bg-surface-2 focus-visible:text-fg",
                )}
              >
                {body}
              </a>
            );
          })}
          <p className="px-2.5 pb-1 pt-2 text-[11.5px] leading-snug text-fg-subtle">
            Each network has its own organizations, documents and acceptances.
          </p>
        </div>
      )}
    </div>
  );
}

/** Shown on every page of a test network's deployment, so nobody mistakes it for production. */
export function TestNetworkBanner() {
  const menu = useContext(NetworkMenuContext);
  const pathname = usePathname();
  if (!menu || !menu.current.test) return null;
  const mainnet = menu.choices.find((c) => c.cluster === "mainnet" && c.url);
  const local = menu.current.cluster === "localnet";
  return (
    <div
      role="note"
      className="border-b border-warning-line bg-warning-soft px-4 py-2 text-center text-[12.5px] text-fg-muted"
    >
      <span className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <AlertIcon className="h-3.5 w-3.5 text-warning" />
        <span>
          <strong className="font-medium text-fg">{menu.current.label}</strong>
          {local
            ? ": local development network. Nothing here is real evidence."
            : ": test network. Documents and acceptances here are for testing, not production evidence."}
        </span>
        {mainnet?.url && (
          <a
            href={targetHref(mainnet.url, pathname)}
            className="font-medium text-accent hover:text-accent-strong"
          >
            Go to {mainnet.label}
          </a>
        )}
      </span>
    </div>
  );
}
