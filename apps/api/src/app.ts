/**
 * Fastify application assembly. Security-relevant defaults:
 * strict security headers, a per-route CORS policy (credentials only for the app origin; public
 * endpoints are callable cross-origin WITHOUT cookies), rate limiting, CSRF checks, schema
 * validation on every route, and an error handler that never leaks internals.
 */
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import type { Deps } from "./deps.js";
import { ApiError } from "./errors.js";
import { authHook, csrfHook } from "./plugins/auth.js";
import { registerIdempotency } from "./plugins/idempotency.js";
import { acceptanceRoutes } from "./routes/acceptance.js";
import { authRoutes } from "./routes/auth.js";
import { documentRoutes } from "./routes/documents.js";
import { integrationRoutes } from "./routes/integrations.js";
import { billingRoutes } from "./routes/billing.js";
import { networkRoutes } from "./routes/network.js";
import { organizationRoutes } from "./routes/organizations.js";
import { proofRoutes } from "./routes/proofs.js";
import { publicRoutes } from "./routes/public.js";
import { signerRoutes } from "./routes/signers.js";

/** Routes callable from any origin without credentials (SDKs on customer sites, verifiers). */
const PUBLIC_PREFIXES = [
  "/v1/public/",
  "/v1/acceptance/",
  "/v1/passkeys/",
  "/v1/proof-requests/",
  "/v1/network",
  "/health",
  "/ready",
];

export interface BuildOptions {
  /** Optional Redis client for distributed rate limiting (multi-instance deployments). */
  redis?: unknown;
}

export async function buildApp(deps: Deps, opts: BuildOptions = {}) {
  const app = Fastify({
    loggerInstance: deps.logger,
    // Trust exactly the configured number of reverse-proxy hops for X-Forwarded-For.
    trustProxy: (_address: string, hop: number) => hop < deps.config.TRUST_PROXY_HOPS,
    bodyLimit: 3 * 1024 * 1024,
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorateRequest("user", null);
  app.decorateRequest("apiKey", null);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    strictTransportSecurity: deps.config.isProduction
      ? { maxAge: 63_072_000, includeSubDomains: true, preload: true }
      : false,
    referrerPolicy: { policy: "no-referrer" },
  });

  await app.register(cors, {
    delegator: (req, cb) => {
      const path = req.url?.split("?")[0] ?? "";
      if (PUBLIC_PREFIXES.some((p) => path.startsWith(p))) {
        cb(null, {
          origin: true,
          credentials: false,
          methods: ["GET", "POST"],
          allowedHeaders: ["content-type", "x-client-binding", "x-proof-token"],
          maxAge: 600,
        });
        return;
      }
      cb(null, {
        origin: (origin, done) => done(null, !origin || deps.config.appOrigins.includes(origin)),
        credentials: true,
        methods: ["GET", "POST", "PATCH", "DELETE"],
        allowedHeaders: ["content-type", "x-csrf-token", "authorization", "idempotency-key"],
        maxAge: 600,
      });
    },
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    ...(opts.redis ? { redis: opts.redis as never } : {}),
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: {
        code: "rate_limited",
        message: `Too many requests; retry in ${Math.ceil(ctx.ttl / 1000)}s`,
      },
    }),
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Stele API",
        version: "1.0.0",
        description:
          "Verifiable agreement infrastructure. Evidence lives on Solana; this API is a convenience layer.",
      },
      // The web app serves the API under /api: generated clients get the address developers use.
      servers: [{ url: `${deps.config.appOrigins[0]}/api`, description: "This Stele app" }],
    },
    transform: jsonSchemaTransform,
  });

  app.addHook("onRequest", authHook(deps));
  app.addHook("preHandler", csrfHook(deps));
  registerIdempotency(app, deps);
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("cache-control", reply.getHeader("cache-control") ?? "no-store");
    return payload;
  });

  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { statusCode?: number; code?: string };
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: {
          code: "invalid_request",
          message: err.validation.map((v) => `${v.instancePath || "body"} ${v.message}`).join("; "),
        },
      });
    }
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      });
    }
    const status = err.statusCode;
    if (status && status >= 400 && status < 500) {
      return reply
        .code(status)
        .send({ error: { code: err.code?.toLowerCase() ?? "bad_request", message: err.message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply
      .code(500)
      .send({ error: { code: "internal_error", message: "An unexpected error occurred" } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: "not_found", message: "Route not found" } }),
  );

  await app.register(networkRoutes(deps));
  await app.register(authRoutes(deps));
  await app.register(publicRoutes(deps));
  await app.register(acceptanceRoutes(deps));
  await app.register(signerRoutes(deps));
  await app.register(proofRoutes(deps));
  await app.register(organizationRoutes(deps));
  await app.register(documentRoutes(deps));
  await app.register(integrationRoutes(deps));
  await app.register(billingRoutes(deps));

  app.get("/v1/openapi.json", { config: { rateLimit: false } }, async () => app.swagger());

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
