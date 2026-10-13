/**
 * Configuration from environment variables, validated at startup. Missing or malformed security
 * settings stop the process instead of falling back to unsafe defaults.
 */
import { isAddress } from "@solana/kit";
import { z } from "zod";
import { NETWORKS, type ClusterName } from "@stelehq/protocol";

const csv = z.string().transform((s) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Number of reverse proxies in front of the API (for X-Forwarded-For). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  DATABASE_URL: z.string().min(1),

  /** Public origin of the web app (cookies, CSRF Origin checks, SIWS domain). */
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  /** Additional browser origins allowed to call credentialed endpoints. */
  EXTRA_APP_ORIGINS: csv.default([]),
  /** Host shown in acceptance messages for Stele's hosted acceptance pages. */
  HOSTED_ACCEPT_DOMAIN: z.string().default("localhost"),

  SOLANA_CLUSTER: z.enum(["mainnet", "devnet", "localnet"]).default("localnet"),
  SOLANA_RPC_URLS: csv.default(["http://127.0.0.1:8899"]),
  /** RPC URLs advertised to browsers for client-side verification (never secret-bearing URLs). */
  PUBLIC_RPC_URLS: csv.optional(),
  PROGRAM_ID: z.string().default("6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV"),
  /** Relayer (fee payer) and domain-attestor keys: file path, JSON byte array, or base58. */
  RELAYER_KEYPAIR: z.string().min(1),
  ATTESTOR_KEYPAIR: z.string().min(1),
  PRIORITY_FEE_MICROLAMPORTS: z.coerce.bigint().default(0n),
  /** Recordings (acceptances and proofs) each organization may make per calendar month for free. */
  STELE_FREE_RECORDS_PER_MONTH: z.coerce.number().int().min(0).default(1_000),
  /**
   * On-chain passkey enrollments the Stele relayer funds per organization per month. Each one
   * creates a rent-exempt PasskeySigner account (~0.0025 SOL, paid by the relayer).
   */
  STELE_MAX_ENROLLMENTS_PER_MONTH: z.coerce.number().int().min(0).default(500),
  /**
   * Where credit purchases are paid (a plain address: the API never holds its key). Unset = no
   * purchases; organizations then have the free monthly allowance only.
   */
  STELE_TREASURY_ADDRESS: z.string().optional(),
  /**
   * Public live demo (devnet/localnet only; refused on mainnet). The demo organization's owner key
   * publishes a fresh policy document per visitor session; unset = demo off. Never a customer key.
   */
  STELE_DEMO_OWNER_KEYPAIR: z.string().optional(),
  STELE_DEMO_ORGANIZATION: z.string().optional(),
  /** Demo sessions per day (all visitors) and per IP address. */
  STELE_DEMO_DAILY_SESSIONS: z.coerce.number().int().min(0).default(60),
  STELE_DEMO_SESSIONS_PER_IP: z.coerce.number().int().min(0).default(6),
  /** Credit packs on sale, as `credits:SOL` pairs. */
  STELE_CREDIT_PACKS: z.string().default("10000:0.5,100000:4,1000000:30"),

  /** 32-byte key (base64) for AES-256-GCM encryption of webhook secrets. */
  ENCRYPTION_KEY: z.string().min(1),
  /** Internal PDF renderer (apps/pdf-renderer). Unset: PDF receipts are unavailable (503). */
  PDF_RENDERER_URL: z.string().url().optional(),
  /** Secret used to hash IP addresses before storage (privacy). */
  IP_HASH_SECRET: z.string().min(16),

  STORAGE_PROVIDER: z.enum(["filesystem", "s3"]).default("filesystem"),
  STORAGE_DIR: z.string().default("../../.data/storage"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_PREFIX: z.string().default("content/"),

  /** Public content mirrors advertised to verifiers (`${mirror}/${sha256}`). */
  PUBLIC_CONTENT_BASE_URL: z.string().url().default("http://localhost:4000/v1/public/content"),

  REDIS_URL: z.string().url().optional(),
  DOH_RESOLVERS: csv.default([
    "https://cloudflare-dns.com/dns-query",
    "https://dns.google/resolve",
  ]),

  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(24 * 7),
  SESSION_IDLE_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 7)
    .default(12),
  STEP_UP_MINUTES: z.coerce.number().int().min(1).max(60).default(10),

  /** Run webhook/finality/expiry workers inside the API process (single-node deployments). */
  RUN_WORKERS: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** Run the chain indexer inside the API process (required with the embedded PGlite database). */
  RUN_INDEXER: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export interface CreditPack {
  /** Stable identifier: the number of credits. */
  id: string;
  credits: number;
  lamports: number;
}

/** "10000:0.5,100000:4" → packs; exact decimal SOL → lamports. */
export function parseCreditPacks(raw: string): CreditPack[] {
  const packs: CreditPack[] = [];
  for (const entry of raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)) {
    const m = /^(\d{1,9}):(\d{1,6})(?:\.(\d{1,9}))?$/.exec(entry);
    if (!m) throw new Error(`invalid configuration: STELE_CREDIT_PACKS entry "${entry}"`);
    const credits = Number(m[1]);
    const lamports = Number(m[2]) * 1_000_000_000 + Number((m[3] ?? "").padEnd(9, "0"));
    if (credits < 1 || lamports < 1)
      throw new Error(`invalid configuration: STELE_CREDIT_PACKS entry "${entry}"`);
    if (packs.some((p) => p.credits === credits))
      throw new Error("invalid configuration: STELE_CREDIT_PACKS has duplicate packs");
    packs.push({ id: String(credits), credits, lamports });
  }
  return packs.sort((a, b) => a.credits - b.credits);
}

export type Config = z.infer<typeof schema> & {
  network: (typeof NETWORKS)[ClusterName];
  billing: { treasury: string | null; packs: CreditPack[] };
  appOrigins: string[];
  appHost: string;
  isProduction: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Compose passes unset variables as "": treat them as absent.
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid configuration: ${issues}`);
  }
  const c = parsed.data;
  const key = Buffer.from(c.ENCRYPTION_KEY, "base64");
  if (key.length !== 32)
    throw new Error("invalid configuration: ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  const isProduction = c.NODE_ENV === "production";
  if (isProduction) {
    if (!c.APP_ORIGIN.startsWith("https://"))
      throw new Error("invalid configuration: APP_ORIGIN must be https in production");
    if (c.SOLANA_CLUSTER === "localnet")
      throw new Error("invalid configuration: localnet is not allowed in production");
    if (c.DATABASE_URL.startsWith("pglite:"))
      throw new Error(
        "invalid configuration: the embedded PGlite database is for development only",
      );
    if (c.STORAGE_PROVIDER === "s3" && !c.S3_BUCKET)
      throw new Error("invalid configuration: S3_BUCKET is required");
  }
  if (c.SOLANA_CLUSTER === "mainnet" && (c.STELE_DEMO_OWNER_KEYPAIR || c.STELE_DEMO_ORGANIZATION))
    throw new Error("invalid configuration: the live demo is not available on mainnet");
  const treasury = c.STELE_TREASURY_ADDRESS?.trim() || null;
  if (treasury !== null && !isAddress(treasury))
    throw new Error("invalid configuration: STELE_TREASURY_ADDRESS is not a Solana address");
  return {
    ...c,
    network: NETWORKS[c.SOLANA_CLUSTER],
    billing: { treasury, packs: parseCreditPacks(c.STELE_CREDIT_PACKS) },
    appOrigins: [c.APP_ORIGIN, ...c.EXTRA_APP_ORIGINS].map((o) => new URL(o).origin),
    appHost: new URL(c.APP_ORIGIN).host,
    isProduction,
  };
}
