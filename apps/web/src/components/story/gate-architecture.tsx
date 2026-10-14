"use client";

import {
  ActivityIcon,
  CodeIcon,
  LayersIcon,
  ShieldIcon,
  TicketIcon,
  UsersIcon,
  cn,
} from "@stele/ui";
import { Connector, Flow, FlowNode, StoryFrame, type NodeState } from "./story-ui";
import { useSequence } from "./use-sequence";

const NODES = [
  { label: "User", sub: "Deposit 5,000 USDC", icon: <UsersIcon className="h-[18px] w-[18px]" /> },
  { label: "Your app", sub: "frontend", icon: <LayersIcon className="h-[18px] w-[18px]" /> },
  { label: "Stele SDK", sub: "stele.gate()", icon: <CodeIcon className="h-[18px] w-[18px]" /> },
  {
    label: "Passport",
    sub: "on Solana",
    icon: <TicketIcon className="h-[18px] w-[18px]" />,
  },
  {
    label: "Your program",
    sub: "require_current_passport()",
    icon: <ShieldIcon className="h-[18px] w-[18px]" />,
  },
  {
    label: "Action",
    sub: "deposit executes",
    icon: <ActivityIcon className="h-[18px] w-[18px]" />,
  },
];

const CAPTIONS = [
  "The investor starts a deposit in your app.",
  "Your frontend calls stele.gate() around the deposit instead of sending it directly.",
  "The SDK reads the policy and the wallet's passport from Solana.",
  "Missing or outdated? The modal records the acceptance, which adds or advances the entry in the passport.",
  "Your program calls require_current_passport() with the passport and the policy it pins.",
  "Only with a current pass does the deposit execute. Everything before it is UX; this is enforcement.",
];

export function GateArchitecture() {
  const seq = useSequence(CAPTIONS.length, { intervalMs: 1700 });
  const s = seq.step;
  const state = (i: number): NodeState => (i === s ? "active" : i < s ? "done" : "idle");
  return (
    <StoryFrame seq={seq} title="Where Stele Gate sits" captions={CAPTIONS}>
      <Flow nodes={NODES.length}>
        {NODES.map((n, i) => (
          <div key={n.label} className="contents">
            {i > 0 && <Connector state={i === s ? "active" : i < s ? "done" : "idle"} />}
            <FlowNode
              icon={n.icon}
              label={n.label}
              sub={n.sub}
              state={i === NODES.length - 1 && s === NODES.length - 1 ? "success" : state(i)}
            />
          </div>
        ))}
      </Flow>
      <div className="mt-5 grid gap-3 @min-[520px]:grid-cols-2">
        <div
          className={cn(
            "rounded-xl border p-4 transition-colors duration-500",
            s >= 1 && s <= 3 ? "border-accent-line bg-accent-soft/30" : "border-line bg-bg-raised",
          )}
        >
          <p className="text-[15px] font-semibold text-fg">Frontend SDK = UX</p>
          <p className="mt-1 text-[13px] text-fg-muted">
            Decides when to show the modal, records the acceptance, continues the action. It can be
            skipped — and that is fine.
          </p>
        </div>
        <div
          className={cn(
            "rounded-xl border p-4 transition-colors duration-500",
            s >= 4 ? "border-verified-line bg-verified-soft/30" : "border-line bg-bg-raised",
          )}
        >
          <p className="text-[15px] font-semibold text-fg">On-chain check = enforcement</p>
          <p className="mt-1 text-[13px] text-fg-muted">
            Your program checks the passport before it acts. A client that skips the SDK is rejected
            here.
          </p>
        </div>
      </div>
    </StoryFrame>
  );
}
