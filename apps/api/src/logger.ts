/**
 * Structured logging (pino). Secrets, tokens, signatures and personal data are redacted at the
 * logger level so a careless log statement cannot leak them. Request bodies are never logged.
 */
import { pino, type LoggerOptions } from "pino";

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
    },
  };
}

/** Query strings can carry tokens; log paths only. */
function stripQuery(url?: string): string | undefined {
  return url?.split("?")[0];
}

export function createLogger(level = "info") {
  return pino(loggerOptions(level));
}
