"use client";

import { BuildingIcon, FileIcon, HashIcon, KeyIcon, SearchIcon, ShieldIcon } from "@stele/ui";
import {
  Connector,
  Flow,
  FlowNode,
  Reveal,
  StatusBadge,
  StoryFrame,
  type NodeState,
} from "./story-ui";
import { useSequence } from "./use-sequence";

const CAPTIONS = [
  "The organization publishes Terms of Service, version 3.",
  "Stele computes the SHA-256 fingerprint of the exact text and commits it on Solana.",
  "The user opens the document — the page shows only text that matches the fingerprint.",
  "The user accepts with a passkey (Face ID, Touch ID, Windows Hello) or a wallet.",
  "Stele records the evidence: the signature over that exact version, with a time.",
  "Anyone can verify the receipt later — without trusting the company's database.",
];

const FINGERPRINT = "9f2c 41aa 07de 5b13 …";

function nodeState(step: number, at: number, doneAfter = true): NodeState {
  if (step === at) return "active";
  if (step > at) return doneAfter ? "done" : "idle";
  return "idle";
}

export function ProofFlow() {
  const seq = useSequence(CAPTIONS.length, { intervalMs: [1800, 2000, 1800, 2000, 1900, 3600] });
  const s = seq.step;
  return (
    <StoryFrame seq={seq} title="Stele Proof — how evidence is made" captions={CAPTIONS}>
      <Flow nodes={5}>
        <FlowNode
          icon={<BuildingIcon className="h-[18px] w-[18px]" />}
          label="Company"
          sub="publishes v3"
          state={nodeState(s, 0)}
        />
        <Connector state={s >= 1 ? (s === 1 ? "active" : "done") : "idle"} />
        <FlowNode
          icon={<HashIcon className="h-[18px] w-[18px]" />}
          label="Fingerprint"
          sub="SHA-256 on Solana"
          state={nodeState(s, 1)}
        />
        <Connector state={s >= 2 ? (s <= 3 ? "active" : "done") : "idle"} />
        <FlowNode
          icon={<KeyIcon className="h-[18px] w-[18px]" />}
          label="User accepts"
          sub="passkey · wallet"
          state={s === 2 || s === 3 ? "active" : s > 3 ? "done" : "idle"}
        />
        <Connector state={s >= 4 ? (s === 4 ? "active" : "done") : "idle"} />
        <FlowNode
          icon={<ShieldIcon className="h-[18px] w-[18px]" />}
          label="Stele evidence"
          sub="signature + time"
          state={nodeState(s, 4)}
        />
        <Connector state={s >= 5 ? "done" : "idle"} />
        <FlowNode
          icon={<SearchIcon className="h-[18px] w-[18px]" />}
          label="Verification"
          sub="by anyone, later"
          state={s >= 5 ? "success" : "idle"}
        />
      </Flow>

      <div className="mt-6 grid gap-4 @min-[560px]:grid-cols-2">
        {/* The document as published */}
        <div className="rounded-xl border border-line bg-bg-raised p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[13px] font-medium text-fg">
              <FileIcon className="h-4 w-4 text-fg-subtle" /> Terms of Service
            </span>
            <StatusBadge tone={s >= 0 ? "accent" : "neutral"}>Version 3</StatusBadge>
          </div>
          <div className="mt-3 space-y-1.5" aria-hidden="true">
            <div className="h-2 w-11/12 rounded bg-line-strong" />
            <div className="h-2 w-9/12 rounded bg-line-strong" />
            <div className="h-2 w-10/12 rounded bg-line-strong" />
          </div>
          <Reveal show={s >= 1} className="mt-3">
            <p className="font-mono text-[11.5px] text-fg-subtle">
              fingerprint <span className="text-accent">{FINGERPRINT}</span>
            </p>
          </Reveal>
          <Reveal show={s >= 2 && s < 4} className="mt-3">
            <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
              <p className="text-[12.5px] text-fg-muted">
                <span aria-hidden="true">☐ </span>
                <span className={s >= 3 ? "text-fg" : undefined}>
                  {s >= 3 ? "☑ " : ""}I have read and agree
                </span>
              </p>
              <p className="mt-2 rounded-md bg-accent px-3 py-1.5 text-center text-[12.5px] font-semibold text-accent-ink">
                {s >= 3 ? "Confirm with Face ID…" : "Accept with passkey"}
              </p>
            </div>
          </Reveal>
        </div>

        {/* The receipt */}
        <Reveal show={s >= 4}>
          <div
            className={
              s >= 5
                ? "rounded-xl border border-verified-line bg-verified-soft/40 p-4"
                : "rounded-xl border border-line bg-bg-raised p-4"
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-fg">Verified receipt</span>
              <StatusBadge tone={s >= 5 ? "success" : "accent"}>
                {s >= 5 ? "Verified" : "Recording"}
              </StatusBadge>
            </div>
            <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
              <dt className="text-fg-subtle">Document</dt>
              <dd className="text-fg">Terms v3</dd>
              <dt className="text-fg-subtle">Accepted by</dt>
              <dd className="font-mono text-fg">passkey 02a1…7f3c</dd>
              <dt className="text-fg-subtle">Timestamp</dt>
              <dd className="text-fg">Solana slot 312,448,901</dd>
              <dt className="text-fg-subtle">Fingerprint</dt>
              <dd className="font-mono text-fg">{FINGERPRINT}</dd>
              <dt className="text-fg-subtle">Status</dt>
              <dd className={s >= 5 ? "font-semibold text-verified" : "text-fg-muted"}>
                {s >= 5 ? "Valid — checked against Solana" : "Being recorded…"}
              </dd>
            </dl>
          </div>
        </Reveal>
      </div>
    </StoryFrame>
  );
}
