"use client";
/**
 * Code samples in several languages, one tab each. The reader's choice applies to every tab group on
 * the page and is remembered in this browser, so choosing "Python" once shows Python everywhere a
 * group offers it. Every panel is rendered (and readable without JavaScript); only the selected one
 * is shown.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { cn } from "./cn";
import { CopyButton } from "./interactive";
import { markPlaceholders } from "./placeholders";

export interface CodeTab {
  /** Tab label, also the remembered choice ("cURL", "Python", "Node.js"…). */
  label: string;
  code: string;
  language?: string;
}

// ---- Remembered choice: most recently chosen labels first (a group picks the first it offers) ----

const STORAGE_KEY = "stele.code-tabs";
const NONE: readonly string[] = [];
const listeners = new Set<() => void>();
let choices: readonly string[] | null = null;

function readChoices(): readonly string[] {
  if (choices) return choices;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    choices = Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string").slice(0, 12)
      : NONE;
  } catch {
    choices = NONE;
  }
  return choices;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    choices = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function remember(label: string) {
  choices = [label, ...readChoices().filter((l) => l !== label)].slice(0, 12);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choices));
  } catch {
    // Private mode or storage disabled: the choice still applies to this page.
  }
  listeners.forEach((l) => l());
}

/** The tab list that was clicked and where it was, to keep it in place while groups above resize. */
let anchor: { element: HTMLElement; top: number } | null = null;

export function CodeTabs({
  tabs,
  placeholders = [],
  className,
}: {
  tabs: CodeTab[];
  /** Values to highlight as "replace me" (the copied text is unchanged). */
  placeholders?: readonly string[];
  className?: string;
}) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const remembered = useSyncExternalStore(subscribe, readChoices, () => NONE);
  const preferred = remembered.find((label) => tabs.some((t) => t.label === label));
  const selected = Math.max(
    0,
    tabs.findIndex((t) => t.label === preferred),
  );

  useLayoutEffect(() => {
    if (!anchor || anchor.element !== listRef.current) return;
    const shift = anchor.element.getBoundingClientRect().top - anchor.top;
    anchor = null;
    if (shift !== 0) window.scrollBy(0, shift);
  }, [remembered]);

  // Keep the selected tab visible in a horizontally scrolled tab list (narrow screens).
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.children[selected];
    if (!list || !tab) return;
    const bounds = list.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();
    if (rect.left < bounds.left) list.scrollLeft -= bounds.left - rect.left;
    else if (rect.right > bounds.right - 28) list.scrollLeft += rect.right - (bounds.right - 28);
  }, [selected]);

  const choose = (index: number, focus: boolean) => {
    const tab = tabs[index];
    if (!tab || !listRef.current) return;
    anchor = { element: listRef.current, top: listRef.current.getBoundingClientRect().top };
    remember(tab.label);
    if (focus) document.getElementById(`${id}-tab-${index}`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowRight"
        ? selected === last
          ? 0
          : selected + 1
        : e.key === "ArrowLeft"
          ? selected === 0
            ? last
            : selected - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    choose(next, true);
  };

  const current = tabs[selected];
  if (!current) return null;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-line bg-[#060a0f]",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-line pr-2">
        <div
          ref={listRef}
          role="tablist"
          aria-label="Language"
          onKeyDown={onKeyDown}
          // The fade hints at tabs scrolled out of view on narrow screens.
          className="flex min-w-0 flex-1 overflow-x-auto pr-7 [mask-image:linear-gradient(to_right,#000_calc(100%_-_28px),transparent)] [scrollbar-width:none]"
        >
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
              id={`${id}-tab-${i}`}
              type="button"
              role="tab"
              aria-selected={i === selected}
              aria-controls={`${id}-panel-${i}`}
              tabIndex={i === selected ? 0 : -1}
              onClick={() => choose(i, false)}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 py-2 font-mono text-[11.5px] tracking-wide whitespace-nowrap transition-colors outline-none focus-visible:bg-surface-3",
                i === selected
                  ? "border-accent text-fg"
                  : "border-transparent text-fg-subtle hover:text-fg",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <CopyButton value={current.code} label="Copy" showLabel className="shrink-0" />
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.label}
          id={`${id}-panel-${i}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${i}`}
          hidden={i !== selected}
        >
          <pre
            tabIndex={0}
            className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
          >
            <code>{markPlaceholders(tab.code, placeholders)}</code>
          </pre>
        </div>
      ))}
    </div>
  );
}
