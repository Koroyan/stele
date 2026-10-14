"use client";

import { cn, ActivityIcon, CheckIcon, CodeIcon, ShieldIcon, UsersIcon } from "@stele/ui";
import { Connector, Flow, FlowNode, StatusBadge, StoryFrame, type NodeState } from "./story-ui";
import { useSequence } from "./use-sequence";

const CAPTIONS = [
  "Without program enforcement, the terms checkbox lives in the frontend. A normal investor passes through it.",
  "But anyone can call deposit() directly from a script or the CLI. The checkbox never appears: frontend bypassed.",
  "With Stele Gate, the vault program calls require_current_passport(). The same direct call finds no acceptance in the passport and is rejected.",
  "An investor who accepted the current terms has a current entry in their passport, and the deposit executes.",
];

function Lane({
  title,
  active,
  outcome,
  children,
}: {
  title: string;
  active: boolean;
  outcome: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3.5 transition-all duration-500",
        active
          ? "border-line-strong bg-bg-raised opacity-100"
          : "border-line bg-bg-raised/40 opacity-45",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-fg-muted">{title}</span>
        <span className="min-h-[26px]">{outcome}</span>
      </div>
      {children}
    </div>
  );
}

export function BypassDemo() {
  const seq = useSequence(CAPTIONS.length, { intervalMs: [2400, 2800, 2800, 3800] });
  const s = seq.step;
  const st = (lane: number, ok: NodeState = "done"): NodeState =>
    s === lane ? ok : s > lane ? "done" : "idle";
  return (
    <StoryFrame seq={seq} title="Can the requirement be skipped?" captions={CAPTIONS}>
      <div className="grid gap-5 @min-[880px]:grid-cols-2">
        <div className="space-y-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">
            Without a program-level gate
          </p>
          <Lane
            title="Normal frontend"
            active={s === 0}
            outcome={s >= 0 && <StatusBadge tone="neutral">Allowed</StatusBadge>}
          >
            <Flow nodes={3}>
              <FlowNode
                icon={<UsersIcon className="h-4 w-4" />}
                label="User"
                state={st(0, "active")}
              />
              <Connector state={s === 0 ? "active" : "idle"} />
              <FlowNode
                icon={<CheckIcon className="h-4 w-4" />}
                label="Checkbox"
                sub="frontend"
                state={st(0, "active")}
              />
              <Connector state={s === 0 ? "active" : "idle"} />
              <FlowNode
                icon={<ActivityIcon className="h-4 w-4" />}
                label="Program"
                state={st(0, "active")}
              />
            </Flow>
          </Lane>
          <Lane
            title="Script / custom client"
            active={s === 1}
            outcome={s >= 1 && <StatusBadge tone="danger">Frontend bypassed</StatusBadge>}
          >
            <Flow nodes={3}>
              <FlowNode
                icon={<CodeIcon className="h-4 w-4" />}
                label="Script / CLI"
                state={s === 1 ? "warning" : st(1)}
              />
              <Connector state={s === 1 ? "active" : "idle"} />
              <FlowNode
                icon={<CheckIcon className="h-4 w-4" />}
                label={
                  <span className={cn(s >= 1 && "story-strike text-fg-subtle")}>Checkbox</span>
                }
                sub="skipped"
                state="idle"
              />
              <Connector state={s === 1 ? "active" : "idle"} />
              <FlowNode
                icon={<ActivityIcon className="h-4 w-4" />}
                label="Program"
                sub="executes anyway"
                state={s === 1 ? "warning" : st(1)}
              />
            </Flow>
          </Lane>
        </div>

        <div className="space-y-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-accent">
            With Stele Gate
          </p>
          <Lane
            title="Script / custom client"
            active={s === 2}
            outcome={s >= 2 && <StatusBadge tone="success">Rejected on-chain</StatusBadge>}
          >
            <Flow nodes={3}>
              <FlowNode
                icon={<CodeIcon className="h-4 w-4" />}
                label="Script / CLI"
                state={s === 2 ? "active" : st(2)}
              />
              <Connector state={s === 2 ? "active" : "idle"} />
              <FlowNode
                icon={<ActivityIcon className="h-4 w-4" />}
                label="Vault program"
                state={s === 2 ? "active" : st(2)}
              />
              <Connector state={s === 2 ? "blocked" : "idle"} />
              <FlowNode
                icon={<ShieldIcon className="h-4 w-4" />}
                label="Passport check"
                sub={s >= 2 ? "not accepted → rejected" : "accepted?"}
                state={s === 2 ? "blocked" : s > 2 ? "done" : "idle"}
              />
            </Flow>
          </Lane>
          <Lane
            title="Investor who accepted the current terms"
            active={s === 3}
            outcome={s >= 3 && <StatusBadge tone="success">Success</StatusBadge>}
          >
            <Flow nodes={3}>
              <FlowNode
                icon={<UsersIcon className="h-4 w-4" />}
                label="User"
                state={s === 3 ? "active" : "idle"}
              />
              <Connector state={s === 3 ? "active" : "idle"} />
              <FlowNode
                icon={<ShieldIcon className="h-4 w-4" />}
                label="Passport check"
                sub="current version ✓"
                state={s === 3 ? "success" : "idle"}
              />
              <Connector state={s === 3 ? "active" : "idle"} />
              <FlowNode
                icon={<ActivityIcon className="h-4 w-4" />}
                label="Vault program"
                sub="deposit executes"
                state={s === 3 ? "success" : "idle"}
              />
            </Flow>
          </Lane>
        </div>
      </div>
      <p className="mt-5 text-center text-[16px] font-semibold tracking-[-0.01em] text-fg">
        The frontend is optional. <span className="text-accent">The program check is not.</span>
      </p>
    </StoryFrame>
  );
}
