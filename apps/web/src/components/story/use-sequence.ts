"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** True when the visitor asked for reduced motion (re-evaluated if the setting changes). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!q) return;
    setReduced(q.matches);
    const on = () => setReduced(q.matches);
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

export interface Sequence {
  step: number;
  count: number;
  playing: boolean;
  reduced: boolean;
  /** Attach to the scene's root: playback starts when it scrolls into view. */
  ref: (el: HTMLElement | null) => void;
  play: () => void;
  pause: () => void;
  go: (step: number) => void;
  next: () => void;
  prev: () => void;
  restart: () => void;
}

/**
 * Drives a scene through `count` states. It autoplays (and loops after a pause on the last state)
 * only while visible, and never under `prefers-reduced-motion` — then it starts on `reducedStep`
 * (default: the last state, which shows the outcome) and moves only when the visitor steps.
 */
export function useSequence(
  count: number,
  opts: { intervalMs?: number | number[]; loop?: boolean; reducedStep?: number } = {},
): Sequence {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const userPaused = useRef(false);
  const observer = useRef<IntersectionObserver | null>(null);

  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new IntersectionObserver(
      ([entry]) => setVisible(!!entry?.isIntersecting && entry.intersectionRatio > 0.35),
      { threshold: [0, 0.35, 0.6] },
    );
    observer.current.observe(el);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  const reducedStep = opts.reducedStep ?? count - 1;
  useEffect(() => {
    if (reduced) {
      setPlaying(false);
      setStep(reducedStep);
    }
  }, [reduced, reducedStep]);

  useEffect(() => {
    if (reduced || userPaused.current) return;
    setPlaying(visible);
  }, [visible, reduced]);

  useEffect(() => {
    if (!playing) return;
    const interval = opts.intervalMs ?? 1800;
    const ms = Array.isArray(interval)
      ? (interval[step] ?? interval[interval.length - 1]!)
      : interval;
    const last = step >= count - 1;
    if (last && opts.loop === false) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(
      () => setStep((s) => (s >= count - 1 ? 0 : s + 1)),
      last ? Math.max(ms, 3200) : ms,
    );
    return () => window.clearTimeout(t);
  }, [playing, step, count, opts.intervalMs, opts.loop]);

  const go = useCallback(
    (s: number) => {
      userPaused.current = true;
      setPlaying(false);
      setStep(Math.max(0, Math.min(count - 1, s)));
    },
    [count],
  );

  return {
    step,
    count,
    playing,
    reduced,
    ref,
    play: () => {
      userPaused.current = false;
      if (step >= count - 1) setStep(0);
      setPlaying(true);
    },
    pause: () => {
      userPaused.current = true;
      setPlaying(false);
    },
    go,
    next: () => go(step + 1),
    prev: () => go(step - 1),
    restart: () => {
      userPaused.current = false;
      setStep(0);
      setPlaying(true);
    },
  };
}
