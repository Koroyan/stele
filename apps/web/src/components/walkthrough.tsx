"use client";

/**
 * "How Stele works": an animated, step-by-step story from writing the Terms to verifying an
 * acceptance years later. Plays automatically when visible (not with reduced motion), can be paused,
 * stepped with the buttons, the progress segments or the arrow keys, and every scene has a text
 * explanation for screen readers and for anyone who prefers to read.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  CheckIcon,
  FileIcon,
  GlobeIcon,
  LayersIcon,
  LockIcon,
  SearchIcon,
  ShieldIcon,
  WalletIcon,
  cn,
} from "@stele/ui";

const STEP_MS = 7000;
const at = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

// ---- Building blocks -------------------------------------------------------------------------------

function Paper({
  title,
  lines = 5,
  delay = 0,
  typing = false,
  className,
  children,
}: {
  title: string;
  lines?: number;
  delay?: number;
  typing?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const widths = ["92%", "78%", "86%", "64%", "88%", "70%"];
  return (
    <div
      className={cn(
        "wt-in w-56 rounded-xl bg-[#eef2f6] p-4 text-[#0f1720] shadow-2xl shadow-black/40",
        className,
      )}
      style={at(delay)}
    >
      <div className="flex items-center gap-2 text-[12.5px] font-semibold">
        <FileIcon className="h-3.5 w-3.5 text-[#1f6f8b]" />
        {title}
      </div>
      <div className="mt-3 space-y-2">
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className={cn("h-1.5 rounded-full bg-[#c5cfda]", typing && "wt-type")}
            style={{
              width: widths[i % widths.length],
              ...(typing ? at(delay + 300 + i * 450) : {}),
            }}
          />
        ))}
      </div>
      {children}
    </div>
  );
}

function Block({
  label,
  active = false,
  delay = 0,
  drop = false,
  children,
}: {
  label: string;
  active?: boolean;
  delay?: number;
  drop?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border text-[10.5px]",
        active
          ? "border-accent bg-accent/15 text-fg wt-glow"
          : "border-line-strong bg-surface-2 text-fg-subtle",
        drop ? "wt-drop" : "wt-in",
      )}
      style={at(delay)}
    >
      {children}
      <span className="mt-1 font-mono">{label}</span>
    </div>
  );
}

function Chain({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {Array.isArray(children)
        ? children.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              {i > 0 && <div className="h-px w-4 bg-line-strong" aria-hidden="true" />}
              {c}
            </div>
          ))
        : children}
    </div>
  );
}

function Chip({
  children,
  tone = "neutral",
  delay = 0,
  pop = false,
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "valid" | "warning" | "danger";
  delay?: number;
  pop?: boolean;
  className?: string;
}) {
  const tones = {
    neutral: "border-line-strong bg-surface-2 text-fg-muted",
    accent: "border-accent-line bg-accent/10 text-accent",
    valid: "border-verified-line bg-verified-soft text-verified",
    warning: "border-warning-line bg-warning-soft text-warning",
    danger: "border-danger/40 bg-danger/10 text-danger",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium",
        tones[tone],
        pop ? "wt-pop" : "wt-in",
        className,
      )}
      style={at(delay)}
    >
      {children}
    </span>
  );
}

function Window({
  url,
  children,
  className,
  delay = 0,
}: {
  url: string;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={cn(
        "wt-in w-72 overflow-hidden rounded-xl border border-line-strong bg-[#0b1017] shadow-2xl shadow-black/40",
        className,
      )}
      style={at(delay)}
    >
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-[#f87171]/70" />
        <span className="h-2 w-2 rounded-full bg-[#f5b544]/70" />
        <span className="h-2 w-2 rounded-full bg-[#34d399]/70" />
        <span className="ml-2 truncate rounded bg-surface-2 px-2 py-0.5 font-mono text-[10.5px] text-fg-subtle">
          {url}
        </span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Traveler({ distance, delay = 0 }: { distance: number; delay?: number }) {
  return (
    <span
      aria-hidden="true"
      className="wt-travel absolute left-0 top-1/2 -mt-1.5 h-3 w-3 rounded-full bg-accent shadow-[0_0_12px_rgb(76_201_240/0.8)]"
      style={{ ...at(delay), ["--wt-distance" as string]: `${distance}px` }}
    />
  );
}

function Tick({ children, delay }: { children: ReactNode; delay: number }) {
  return (
    <li className="wt-in flex items-center gap-2 text-[12.5px] text-fg" style={at(delay)}>
      <span
        className="wt-pop flex h-4 w-4 items-center justify-center rounded-full bg-verified-soft text-verified"
        style={at(delay + 150)}
      >
        <CheckIcon className="h-3 w-3" />
      </span>
      {children}
    </li>
  );
}

// ---- Scenes ----------------------------------------------------------------------------------------

function SceneWrite() {
  return (
    <div className="flex flex-col items-center gap-4">
      <Window url="app.stele.example/dashboard/documents/new" className="w-80">
        <p className="text-[11px] uppercase tracking-[0.1em] text-fg-subtle">New document</p>
        <div className="mt-2 flex justify-center">
          <Paper title="Terms of Service" lines={6} typing delay={200} className="w-full" />
        </div>
      </Window>
      <Chip delay={3200}>Acme Inc. · Terms of Service · version 1.0</Chip>
    </div>
  );
}

function SceneFingerprint() {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative flex items-center gap-6">
        <Paper title="Terms of Service" lines={4} className="w-40" />
        <div className="relative h-6 w-24" aria-hidden="true">
          <div className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
          <Traveler distance={90} delay={500} />
        </div>
        <div
          className="wt-pop flex h-20 w-20 flex-col items-center justify-center rounded-2xl border border-accent-line bg-accent/10 text-accent"
          style={at(900)}
        >
          <LayersIcon className="h-6 w-6" />
          <span className="mt-1 font-mono text-[10px]">SHA-256</span>
        </div>
      </div>
      <div className="flex flex-col items-center gap-2">
        <span className="wt-type font-mono text-[15px] tracking-wider text-fg" style={at(1700)}>
          f60c 926a 19bd e071 … 30ae be
        </span>
        <Chip tone="accent" delay={2700} pop>
          Fingerprint of this exact text
        </Chip>
      </div>
      <div className="wt-in flex items-center gap-3 text-[12px] text-fg-muted" style={at(4000)}>
        Change one comma →<span className="font-mono text-warning">b27e 4608 e90f d062 … 4997</span>
      </div>
    </div>
  );
}

function SceneSeal() {
  return (
    <div className="flex flex-col items-center gap-5">
      <Chip delay={100}>
        <WalletIcon className="h-3.5 w-3.5" /> Acme signs with its wallet
      </Chip>
      <div className="relative">
        <Chain>
          <Block label="#…" delay={300}>
            <LayersIcon className="h-4 w-4" />
          </Block>
          <Block label="#…" delay={450}>
            <LayersIcon className="h-4 w-4" />
          </Block>
          <Block label="v1.0" active drop delay={1300}>
            <LockIcon className="h-4 w-4 text-accent" />
          </Block>
        </Chain>
        <span
          className="wt-stamp absolute -right-16 -top-6 rounded-md border-2 border-accent px-2 py-0.5 font-mono text-[11px] font-bold tracking-widest text-accent"
          style={at(2300)}
        >
          SEALED
        </span>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Chip delay={3000}>Solana · public</Chip>
        <Chip delay={3300}>Cannot be edited</Chip>
        <Chip delay={3600}>Cannot be deleted</Chip>
      </div>
    </div>
  );
}

function SceneOpen() {
  return (
    <div className="flex items-center gap-6">
      <Window url="shop.acme.com/checkout">
        <div className="flex items-center gap-2 text-[11.5px] font-semibold text-fg">
          Acme Inc.
          <span className="rounded-full bg-verified-soft px-2 py-0.5 text-[10px] text-verified">
            ✓ acme.com
          </span>
        </div>
        <p className="mt-1 text-[13px] font-semibold text-fg">Terms of Service</p>
        <div className="mt-2 space-y-1.5">
          {["90%", "76%", "84%"].map((w, i) => (
            <div
              key={i}
              className="wt-type h-1.5 rounded-full bg-line-strong"
              style={{ width: w, ...at(500 + i * 300) }}
            />
          ))}
        </div>
        <div
          className="wt-pop mt-3 flex items-center gap-1.5 text-[11.5px] font-medium text-verified"
          style={at(2600)}
        >
          <ShieldIcon className="h-3.5 w-3.5" /> Text matches Solana
        </div>
      </Window>
      <div className="relative h-6 w-16" aria-hidden="true">
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-line-strong" />
        <Traveler distance={56} delay={1300} />
      </div>
      <Block label="v1.0" active delay={900}>
        <LockIcon className="h-4 w-4 text-accent" />
      </Block>
    </div>
  );
}

function SceneSign() {
  const lines = [
    "Accept Agreement",
    "Acme Inc. (verified: acme.com)",
    "Terms of Service · 1.0",
    "Fingerprint f60c…aebe",
    "Requested by shop.acme.com",
  ];
  return (
    <div className="flex items-center gap-4">
      <Window url="shop.acme.com/checkout" className="w-52 opacity-60">
        <div className="flex items-center gap-2 text-[11px] text-fg">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded border border-accent bg-accent/20">
            <CheckIcon className="h-2.5 w-2.5 text-accent" />
          </span>
          I have read and agree
        </div>
        <div className="mt-3 rounded-md bg-accent py-1.5 text-center text-[11px] font-semibold text-accent-ink">
          Accept &amp; sign
        </div>
      </Window>
      <div
        className="wt-slide w-64 rounded-2xl border border-line-strong bg-surface p-4 shadow-2xl shadow-black/50"
        style={at(600)}
      >
        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-fg">
          <WalletIcon className="h-4 w-4 text-accent" /> Your wallet · Sign message
        </div>
        <ul className="mt-3 space-y-1.5 rounded-lg bg-bg-raised p-3 font-mono text-[10.5px] text-fg-muted">
          {lines.map((l, i) => (
            <li key={l} className="wt-in" style={at(1000 + i * 250)}>
              {l}
            </li>
          ))}
        </ul>
        <div className="relative mt-3">
          <div
            className="wt-press rounded-lg bg-accent py-2 text-center text-[12px] font-semibold text-accent-ink"
            style={at(2900)}
          >
            Approve
          </div>
          <span
            className="wt-stamp absolute -right-3 -top-4 rounded-md border-2 border-verified bg-surface px-2 py-0.5 text-[11px] font-bold text-verified"
            style={at(3400)}
          >
            ✓ SIGNED
          </span>
        </div>
        <p className="wt-in mt-2 text-center text-[10.5px] text-fg-subtle" style={at(3900)}>
          Free · moves no money · no seed phrase
        </p>
      </div>
    </div>
  );
}

function SceneRecord() {
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="flex items-center gap-3">
        <Chip delay={100}>
          <WalletIcon className="h-3.5 w-3.5" /> Signature
        </Chip>
        <div className="relative h-6 w-20" aria-hidden="true">
          <div className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
          <Traveler distance={72} delay={400} />
        </div>
        <Chip delay={600} tone="accent">
          Stele submits it
        </Chip>
        <div className="relative h-6 w-20" aria-hidden="true">
          <div className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
          <Traveler distance={72} delay={1400} />
        </div>
        <Chip delay={1600}>
          <LayersIcon className="h-3.5 w-3.5" /> Solana checks it
        </Chip>
      </div>
      <Chain>
        <Block label="v1.0" delay={300}>
          <LockIcon className="h-4 w-4" />
        </Block>
        <Block label="#…" delay={450}>
          <LayersIcon className="h-4 w-4" />
        </Block>
        <Block label="accepted" active drop delay={2400}>
          <CheckIcon className="h-4 w-4 text-accent" />
        </Block>
      </Chain>
      <div className="flex flex-wrap justify-center gap-2">
        <Chip tone="valid" delay={3200} pop>
          ✓ Recorded once
        </Chip>
        <Chip tone="danger" delay={3900} pop>
          ✗ Same signature again: refused
        </Chip>
      </div>
    </div>
  );
}

function SceneNotify() {
  return (
    <div className="flex items-start gap-6">
      <div
        className="wt-pop w-48 rounded-xl bg-[#eef2f6] p-4 text-[#0f1720] shadow-2xl shadow-black/40"
        style={at(200)}
      >
        <p className="text-[12.5px] font-semibold">Receipt</p>
        <dl className="mt-2 space-y-1 text-[10.5px]">
          {[
            ["Document", "Terms 1.0"],
            ["Signed by", "7xKX…sgAsU"],
            ["Site", "shop.acme.com"],
            ["Proof", "Solana tx 4Gv4…o5mi9"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-[#5b6672]">{k}</dt>
              <dd className="font-mono">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <Window url="api.shop.acme.com" className="w-72" delay={900}>
        <p className="text-[11px] uppercase tracking-[0.1em] text-fg-subtle">Acme&apos;s server</p>
        <ul className="mt-2 space-y-2 font-mono text-[10.5px]">
          <li
            className="wt-slide rounded-md border border-line bg-surface-2 p-2 text-fg-muted"
            style={at(1500)}
          >
            webhook <span className="text-fg">agreement.accepted</span> · user_123
            <span className="ml-1 text-verified">✓ signature</span>
          </li>
          <li
            className="wt-slide rounded-md border border-line bg-surface-2 p-2 text-fg-muted"
            style={at(2400)}
          >
            hasAcceptedLatest(<span className="text-fg">user_123</span>){" "}
            <span className="text-verified">→ ✓</span>
          </li>
        </ul>
        <div
          className="wt-pop mt-3 rounded-md bg-accent py-1.5 text-center text-[11.5px] font-semibold text-accent-ink"
          style={at(3300)}
        >
          Place order ✓
        </div>
      </Window>
    </div>
  );
}

function SceneVerify() {
  return (
    <div className="flex items-center gap-8">
      <div className="relative">
        <div className="wt-in w-44 rounded-xl bg-[#eef2f6] p-4 text-[#0f1720] shadow-2xl shadow-black/40">
          <p className="text-[12.5px] font-semibold">Receipt</p>
          <div className="mt-2 space-y-1.5">
            {["88%", "70%", "80%", "60%"].map((w, i) => (
              <div key={i} className="h-1.5 rounded-full bg-[#c5cfda]" style={{ width: w }} />
            ))}
          </div>
        </div>
        <span
          className="wt-pop absolute -bottom-4 -right-4 flex h-12 w-12 items-center justify-center rounded-full border border-accent-line bg-surface text-accent shadow-xl"
          style={at(500)}
        >
          <SearchIcon className="h-5 w-5" />
        </span>
      </div>
      <div>
        <p className="wt-in text-[11px] uppercase tracking-[0.1em] text-fg-subtle" style={at(700)}>
          Checked on Solana, not with Stele
        </p>
        <ul className="mt-3 space-y-2">
          <Tick delay={1000}>The signature is genuine</Tick>
          <Tick delay={1500}>The text is exactly the published one</Tick>
          <Tick delay={2000}>It was the current version</Tick>
          <Tick delay={2500}>Recorded once, on Solana</Tick>
          <Tick delay={3000}>Domain verified: acme.com</Tick>
        </ul>
        <span
          className="wt-stamp mt-4 inline-block rounded-md border-2 border-verified px-3 py-1 font-mono text-[14px] font-bold tracking-widest text-verified"
          style={at(3800)}
        >
          VALID
        </span>
      </div>
    </div>
  );
}

function SceneNewVersion() {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex items-center gap-4">
        <Paper title="Terms 1.0" lines={4} className="w-36 opacity-60">
          <div className="mt-2 flex items-center gap-1 text-[10px] text-[#5b6672]">
            <LockIcon className="h-3 w-3" /> kept forever
          </div>
        </Paper>
        <div
          className="wt-in flex flex-col items-center text-[10px] text-fg-subtle"
          style={at(900)}
        >
          <span className="font-mono">links to</span>
          <span aria-hidden="true">←</span>
        </div>
        <Paper title="Terms 2.0" lines={4} delay={600} className="w-36 wt-drop" />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[12px] text-fg-muted">Customer user_123:</span>
        <Chip tone="valid" delay={1200}>
          ✓ accepted 1.0
        </Chip>
        <span className="wt-in text-fg-subtle" style={at(2400)} aria-hidden="true">
          →
        </span>
        <Chip tone="warning" delay={2900} pop>
          Please accept 2.0
        </Chip>
      </div>
    </div>
  );
}

// ---- Story -----------------------------------------------------------------------------------------

interface Scene {
  title: string;
  text: string;
  takeaway: string;
  icon: ReactNode;
  Visual: () => ReactNode;
}

const SCENES: Scene[] = [
  {
    title: "A company writes its Terms",
    text: "Acme writes its Terms of Service in the Stele dashboard, like any other document.",
    takeaway: "Nothing new to learn: paste your text.",
    icon: <FileIcon className="h-4 w-4" />,
    Visual: SceneWrite,
  },
  {
    title: "Stele takes its fingerprint",
    text: "The exact text becomes a short, unique code: its fingerprint. Change a single comma and the fingerprint is completely different.",
    takeaway: "The fingerprint identifies this exact text.",
    icon: <LayersIcon className="h-4 w-4" />,
    Visual: SceneFingerprint,
  },
  {
    title: "The fingerprint is sealed on Solana",
    text: "Acme approves it with its wallet, and the fingerprint is written to Solana, a public blockchain. From now on nobody can change or delete it: not Acme, not Stele.",
    takeaway: "This version is permanent. A change means a new version.",
    icon: <LockIcon className="h-4 w-4" />,
    Visual: SceneSeal,
  },
  {
    title: "A customer opens the website",
    text: "On Acme's own website, the Stele widget shows the Terms. Before showing them, it checks that the text matches the fingerprint on Solana.",
    takeaway: "Customers only ever see the real, published text.",
    icon: <GlobeIcon className="h-4 w-4" />,
    Visual: SceneOpen,
  },
  {
    title: "The customer signs with their wallet",
    text: "They tick “I agree”. Their wallet shows a short message: who, which document, which version, which website. One click approves it. It is free and moves no money.",
    takeaway: "A signature only their wallet could have made.",
    icon: <WalletIcon className="h-4 w-4" />,
    Visual: SceneSign,
  },
  {
    title: "The acceptance is recorded",
    text: "Stele sends the signature to Solana. The Stele program checks it and records it, exactly once.",
    takeaway: "It cannot be faked, copied, or reused for something else.",
    icon: <CheckIcon className="h-4 w-4" />,
    Visual: SceneRecord,
  },
  {
    title: "Everyone gets confirmation",
    text: "The customer gets a receipt. Acme's server gets a signed notification, and can ask at any time whether this customer accepted the current version, before continuing the checkout.",
    takeaway: "The business acts only on a real acceptance.",
    icon: <ShieldIcon className="h-4 w-4" />,
    Visual: SceneNotify,
  },
  {
    title: "Anyone can verify, even years later",
    text: "With the receipt, anyone (the customer, an auditor, a court) can check everything directly on Solana, without asking Stele or Acme.",
    takeaway: "Don't trust the website. Verify the evidence.",
    icon: <SearchIcon className="h-4 w-4" />,
    Visual: SceneVerify,
  },
  {
    title: "When the Terms change",
    text: "Acme publishes version 2.0. Version 1.0 stays on record forever, linked in the history, and customers are asked to accept the new version.",
    takeaway: "Every change is visible. Every acceptance points to an exact version.",
    icon: <LayersIcon className="h-4 w-4" />,
    Visual: SceneNewVersion,
  },
];

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const on = () => setReduced(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function Walkthrough() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLElement>(null);
  const last = SCENES.length - 1;

  // Start playing the first time the story scrolls into view (never with reduced motion).
  useEffect(() => {
    const el = rootRef.current;
    if (!el || started || reduced) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setStarted(true);
          setPlaying(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [started, reduced]);

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (step < last) setStep((s) => s + 1);
      else setPlaying(false);
    }, STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, step, last]);

  const go = (next: number) => setStep(Math.max(0, Math.min(last, next)));
  const scene = SCENES[step]!;
  const Visual = scene.Visual;

  return (
    <section
      ref={rootRef}
      aria-label="How Stele works, step by step"
      className="rounded-[28px] border border-line bg-surface/60 p-4 sm:p-6"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(step + 1);
        if (e.key === "ArrowLeft") go(step - 1);
      }}
    >
      {/* Progress: one segment per step. */}
      <div className="flex gap-1.5" role="group" aria-label="Steps">
        {SCENES.map((s, i) => (
          <button
            key={s.title}
            type="button"
            aria-label={`Step ${i + 1}: ${s.title}`}
            aria-current={i === step ? "step" : undefined}
            onClick={() => go(i)}
            className="group relative h-6 flex-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="absolute inset-x-0 top-1/2 block h-1 -translate-y-1/2 overflow-hidden rounded-full bg-line-strong group-hover:bg-fg-subtle">
              <span
                key={`${i}-${step}`}
                className={cn(
                  "block h-full origin-left rounded-full bg-accent",
                  i < step && "w-full",
                  i > step && "w-0",
                  i === step && "w-full wt-progress",
                )}
                style={
                  i === step
                    ? {
                        animationDuration: `${STEP_MS}ms`,
                        animationPlayState: playing ? "running" : "paused",
                      }
                    : undefined
                }
              />
            </span>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-center">
        {/* Stage */}
        <div className="relative flex min-h-[340px] items-center justify-center overflow-hidden rounded-2xl border border-line bg-bg-raised p-6 sm:min-h-[400px]">
          <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
          <div
            className="glow-top pointer-events-none absolute inset-x-0 top-0 h-48"
            aria-hidden="true"
          />
          <div
            key={step}
            className="relative origin-center scale-[0.58] min-[440px]:scale-[0.72] sm:scale-90 xl:scale-100"
            aria-hidden="true"
          >
            <Visual />
          </div>
        </div>

        {/* Story text */}
        <div aria-live="polite">
          <p className="flex items-center gap-2 font-mono text-[12px] text-accent">
            {scene.icon}
            Step {step + 1} of {SCENES.length}
          </p>
          <h2
            key={`t${step}`}
            className="wt-in mt-3 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-fg"
          >
            {scene.title}
          </h2>
          <p
            key={`p${step}`}
            className="wt-in mt-3 text-[15.5px] leading-relaxed text-fg-muted"
            style={at(120)}
          >
            {scene.text}
          </p>
          <p
            key={`k${step}`}
            className="wt-in mt-4 rounded-xl border border-accent-line bg-accent/5 px-4 py-3 text-[14px] font-medium text-fg"
            style={at(240)}
          >
            {scene.takeaway}
          </p>

          <div className="mt-6 flex items-center gap-2">
            <button
              type="button"
              onClick={() => go(step - 1)}
              disabled={step === 0}
              className="h-10 rounded-lg border border-line-strong px-4 text-[13.5px] text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => {
                if (step === last && !playing) {
                  setStep(0);
                  setPlaying(true);
                } else setPlaying((p) => !p);
                setStarted(true);
              }}
              className="h-10 min-w-[104px] rounded-lg bg-accent px-4 text-[13.5px] font-semibold text-accent-ink transition-opacity hover:opacity-90"
            >
              {playing ? "❚❚ Pause" : step === last ? "↻ Replay" : "▶ Play"}
            </button>
            <button
              type="button"
              onClick={() => go(step + 1)}
              disabled={step === last}
              className="h-10 rounded-lg border border-line-strong px-4 text-[13.5px] text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
            >
              Next →
            </button>
          </div>
          <p className="mt-3 text-[12px] text-fg-subtle">
            Tip: use the ← → keys, or click a step above.
          </p>
        </div>
      </div>
    </section>
  );
}
