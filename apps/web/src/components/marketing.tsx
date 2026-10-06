/** Building blocks for marketing pages. */
import type { ReactNode } from "react";
import { cn } from "@stele/ui";

export function Section({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cn("relative py-20 sm:py-28", className)}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">{children}</div>
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[12.5px] font-medium uppercase tracking-[0.12em] text-accent">{children}</p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = "left",
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  align?: "left" | "center";
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center")}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="mt-3 text-balance text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] text-fg sm:text-[38px]">
        {title}
      </h2>
      {lead && <p className="mt-4 text-pretty text-[16px] leading-relaxed text-fg-muted">{lead}</p>}
    </div>
  );
}

export function PageHero({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  lead: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div
        className="glow-top pointer-events-none absolute inset-x-0 top-0 h-[360px]"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pb-20 sm:pt-24">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-balance text-[38px] font-semibold leading-[1.08] tracking-[-0.03em] text-fg sm:text-[52px]">
          {title}
        </h1>
        <p className="mt-5 max-w-2xl text-pretty text-[17px] leading-relaxed text-fg-muted">
          {lead}
        </p>
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  );
}

export function FeatureCard({
  icon,
  title,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent-line bg-accent-soft text-accent">
        {icon}
      </div>
      <h3 className="mt-4 text-[15.5px] font-semibold tracking-[-0.01em] text-fg">{title}</h3>
      <div className="mt-2 text-[14px] leading-relaxed text-fg-muted">{children}</div>
    </div>
  );
}

export function CheckList({
  items,
  tone = "accent",
}: {
  items: ReactNode[];
  tone?: "accent" | "muted";
}) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-[14px] leading-relaxed text-fg-muted">
          <svg
            viewBox="0 0 16 16"
            className={cn(
              "mt-1 h-4 w-4 shrink-0",
              tone === "accent" ? "text-accent" : "text-fg-subtle",
            )}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            {tone === "accent" ? (
              <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M4 8h8" strokeLinecap="round" />
            )}
          </svg>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
