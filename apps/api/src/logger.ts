/**
 * Structured logging (pino). Secrets, tokens, signatures and personal data are redacted at the
 * logger level so a careless log statement cannot leak them. Request bodies are never logged.
 */
import { pino, stdSerializers, type LoggerOptions } from "pino";

export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-csrf-token']",
  "req.headers['x-client-binding']",
  "res.headers['set-cookie']",
  "*.password",
  "*.secret",
  "*.token",
  "*.sessionToken",
  "*.clientBinding",
  "*.signature",
  "*.privateKey",
  "*.secretKey",
  "*.apiKey",
  "*.email",
  "*.externalUserRef",
];

export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    base: { service: "stele-api" },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      req: (req: { method?: string; url?: string; id?: string }) => ({
        method: req.method,
        url: stripQuery(req.url),
        id: req.id,
      }),
      err: serializeError,
    },
  };
}

/**
 * Logging must never throw: a throw inside a log call would crash the process. pino's error
 * serializer tags every error it walks (the error, its cause and any error-valued field), which
 * throws on frozen errors such as @solana/kit's RPC errors — so it gets plain copies, and anything
 * still unexpected falls back to name, message and stack.
 */
export function serializeError(e: unknown): unknown {
  try {
    return stdSerializers.err(thawed(e) as Error);
  } catch {
    const err = e as { name?: unknown; message?: unknown; stack?: unknown } | null;
    return {
      type: String(err?.name ?? "Error"),
      message: String(err?.message ?? e),
      stack: typeof err?.stack === "string" ? err.stack : undefined,
    };
  }
}

/** A plain, extensible copy of an error and of every error inside it (cause and fields). */
export function thawed(e: unknown, depth = 0): unknown {
  if (!(e instanceof Error) || depth > 5) return e;
  const copy = Object.create(Object.getPrototypeOf(e) as object) as Error & Record<string, unknown>;
  for (const k of Object.keys(e)) {
    const v = (e as unknown as Record<string, unknown>)[k];
    copy[k] = v instanceof Error ? thawed(v, depth + 1) : v;
  }
  for (const k of ["name", "message", "stack"] as const)
    Object.defineProperty(copy, k, { value: e[k], enumerable: false, writable: true });
  if (e.cause !== undefined) copy.cause = thawed(e.cause, depth + 1);
  return copy;
}

/** Query strings can carry tokens; log paths only. */
function stripQuery(url?: string): string | undefined {
  return url?.split("?")[0];
}

export function createLogger(level = "info") {
  return pino(loggerOptions(level));
}
