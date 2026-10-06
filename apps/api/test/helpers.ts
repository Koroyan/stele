import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createKeyPairSignerFromBytes, address } from "@solana/kit";
import { pino } from "pino";
import { toBase58, toBase64, utf8 } from "@stele/protocol";
import { createTestDb } from "@stele/db/testing";
import { buildApp, type App } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import type { Deps } from "../src/deps.js";
import { createChainService, type ChainService } from "../src/lib/chain.js";
import { FilesystemContentStore, type ContentStore } from "../src/lib/storage.js";

export const APP_ORIGIN = "http://localhost:3000";
export const REPO_ROOT = resolve(import.meta.dirname, "../../..");

export function keypairBytes(): Uint8Array {
  const secret = ed25519.utils.randomSecretKey();
  const out = new Uint8Array(64);
  out.set(secret);
  out.set(ed25519.getPublicKey(secret), 32);
  return out;
}

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://unused",
    APP_ORIGIN,
    SOLANA_CLUSTER: "localnet",
    RELAYER_KEYPAIR: JSON.stringify(Array.from(keypairBytes())),
    ATTESTOR_KEYPAIR: JSON.stringify(Array.from(keypairBytes())),
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    IP_HASH_SECRET: "test-ip-hash-secret-0123456789",
    RUN_WORKERS: "false",
    LOG_LEVEL: "fatal",
    ...env,
  } as NodeJS.ProcessEnv);
}

/** A chain service for tests that must not touch Solana. */
export async function stubChain(): Promise<ChainService> {
  const relayer = await createKeyPairSignerFromBytes(keypairBytes());
  const attestor = await createKeyPairSignerFromBytes(keypairBytes());
  const unavailable = () => {
    throw new Error("chain access is not available in this test");
  };
  return {
    rpc: new Proxy({}, { get: unavailable }) as never,
    programAddress: address("6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV"),
    relayer,
    attestor,
    network: testConfig().network,
    clusterTime: async () => Math.floor(Date.now() / 1000),
    send: unavailable,
    sendAcceptance: unavailable,
    sendRecord: unavailable,
    sendBatchAnchor: unavailable,
    verifierSource: unavailable,
  };
}

export interface TestApp {
  app: App;
  deps: Deps;
  close(): Promise<void>;
}

export async function makeApp(
  opts: { chain?: ChainService; config?: Config; storage?: ContentStore } = {},
): Promise<TestApp> {
  const { db, close } = await createTestDb();
  const config = opts.config ?? testConfig();
  const deps: Deps = {
    config,
    db,
    chain: opts.chain ?? (await stubChain()),
    storage:
      opts.storage ?? new FilesystemContentStore(mkdtempSync(join(tmpdir(), "stele-storage-"))),
    logger: pino({ level: "silent" }),
    encryptionKey: Buffer.from(config.ENCRYPTION_KEY, "base64"),
  };
  const app = await buildApp(deps);
  await app.ready();
  return {
    app,
    deps,
    close: async () => {
      await app.close();
      await close();
    },
  };
}

export async function realChain(config: Config): Promise<ChainService> {
  return createChainService(config);
}

export interface Session {
  address: string;
  cookie: string;
  csrf: string;
  headers: Record<string, string>;
}

/** Signs in with an Ed25519 keypair (64 bytes) exactly as a wallet would. */
export async function login(app: App, keypair: Uint8Array): Promise<Session> {
  const addr = toBase58(keypair.slice(32));
  const ch = await app.inject({
    method: "POST",
    url: "/v1/auth/challenge",
    payload: { address: addr },
    headers: { origin: APP_ORIGIN },
  });
  if (ch.statusCode !== 200) throw new Error(`challenge failed: ${ch.body}`);
  const { message } = ch.json() as { message: string };
  const signature = toBase58(ed25519.sign(utf8(message), keypair.slice(0, 32)));
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/verify",
    payload: { address: addr, signedMessage: toBase64(utf8(message)), signature },
    headers: { origin: APP_ORIGIN },
  });
  if (res.statusCode !== 200) throw new Error(`verify failed: ${res.body}`);
  const cookie = res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const csrf = (res.json() as { csrfToken: string }).csrfToken;
  return {
    address: addr,
    cookie,
    csrf,
    headers: { cookie, "x-csrf-token": csrf, origin: APP_ORIGIN },
  };
}
