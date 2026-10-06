"use client";
/** Minimal data-fetching hooks for authenticated dashboard pages. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

export interface Query<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/** Fetches `path` (skipped while null) and refetches on `reload()` or when the path changes. */
export function useApi<T>(path: string | null): Query<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    api<T>(path, { signal: controller.signal })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export interface Action<A extends unknown[], R> {
  run: (...args: A) => Promise<R | undefined>;
  pending: boolean;
  error: string | null;
  setError: (e: string | null) => void;
}

/** Wraps an async action with pending/error state; errors are captured, not thrown. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>): Action<A, R> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  useLayoutEffect(() => {
    fnRef.current = fn;
  });
  const run = useCallback(async (...args: A) => {
    setPending(true);
    setError(null);
    try {
      return await fnRef.current(...args);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);
  return { run, pending, error, setError };
}
