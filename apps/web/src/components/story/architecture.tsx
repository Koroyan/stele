/**
 * How the pieces fit, with the direction of data and execution. Illustrative: it names the real
 * components (programs/stele, crates/stele-gate, @stelehq/sdk) and claims nothing beyond them.
 */
import type { ReactNode } from "react";
import { cn } from "@stele/ui";

function Group({
  title,
  where,
  items,
  tone,
}: {
  title: string;
  where: string;
  items: { name: string; detail: string }[];
  tone: "client" | "core" | "gate" | "third";
}) {
  const tones = {
    client: "border-line-strong",
    core: "border-line-strong",
    gate: "border-accent-line bg-accent-soft/20",
    third: "border-dashed border-line-strong",
  } as const;
  return (
    <div className={cn("rounded-2xl border bg-surface p-4", tones[tone])}>
      <p className={cn("text-[13px] font-semibold", tone === "gate" ? "text-accent" : "text-fg")}>
        {title}
      </p>
      <p className="font-mono text-[10.5px] text-fg-subtle">{where}</p>
      <ul className="mt-3 space-y-2">
        {items.map((i) => (
          <li key={i.name} className="rounded-lg border border-line bg-bg px-3 py-2">
            <span className="block text-[12.5px] font-medium text-fg">{i.name}</span>
            <span className="block text-[11.5px] leading-snug text-fg-subtle">{i.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Arrow({ label }: { label: ReactNode }) {
  return (
    <div
      className="flex items-center justify-center gap-2 py-1 lg:flex-col lg:py-0"
      aria-hidden="true"
    >
      <div className="relative h-6 w-px overflow-hidden bg-accent/40 lg:h-px lg:w-10">
        <span className="story-pulse absolute inset-0" />
      </div>
      <span className="text-center font-mono text-[10px] leading-tight text-fg-subtle lg:max-w-[72px]">
        {label}
      </span>
    </div>
  );
}

export function Architecture() {
  return (
    <figure aria-label="Stele architecture">
      <div className="grid items-center gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
        <Group
          title="Client"
          where="@stelehq/sdk"
          tone="client"
          items={[
            { name: "Stele SDK", detail: "gate(): read pass, modal, accept, continue" },
            { name: "Embedded modal", detail: "hash-verified text, wallet signature" },
          ]}
        />
        <Arrow label="signed acceptance" />
        <Group
          title="Stele Core"
          where="programs/stele"
          tone="core"
          items={[
            { name: "Document registry", detail: "organizations, documents" },
            { name: "Version registry", detail: "fingerprints, hash chain" },
            { name: "Acceptance", detail: "signature verified on-chain" },
            { name: "Receipt & verification", detail: "open-source verifier" },
          ]}
        />
        <Arrow label="creates / advances" />
        <Group
          title="Stele Gate"
          where="programs/stele · crates/stele-gate"
          tone="gate"
          items={[
            { name: "Policy", detail: "required version of a document, set by the organization" },
            { name: "AccessPass", detail: "per policy and wallet" },
            {
              name: "Gate instructions",
              detail: "create_policy, set_policy_requirement, record_gated_acceptance",
            },
            { name: "require_current()", detail: "one call in your program (stele-gate crate)" },
          ]}
        />
        <Arrow label="read by your program" />
        <Group
          title="Third party"
          where="your program"
          tone="third"
          items={[
            {
              name: "Solana program",
              detail: "pins the policy; require_current() before every protected action",
            },
          ]}
        />
      </div>
      <figcaption className="mt-4 text-center text-[13px] text-fg-muted">
        Acceptances flow from the client into Stele Core; the Gate layer turns them into
        AccessPasses that your program checks before executing.
      </figcaption>
    </figure>
  );
}
