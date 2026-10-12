/**
 * LOCALNET ONLY: sets up "Northwind Shop", a complete demo organization, and configures the demo
 * shop app (examples/demo-shop) to use it:
 *
 *   on-chain   organization + acceptance shard, verified domain northwind.test, Terms of Service and
 *              Privacy Policy (version 1.0 each), and your wallet as an admin + publisher member
 *   off-chain  an API key (all scopes) and a webhook endpoint pointing at the demo shop
 *   writes     examples/demo-shop/.env
 *
 *   pnpm localnet:demo -- --member <your wallet address>
 *
 * With --member you can sign in to the dashboard with your own wallet, see Northwind Shop, publish
 * new versions and manage keys and webhooks. Re-running reuses the organization and refreshes the
 * demo shop's API key and webhook.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { address, type Address } from "@solana/kit";
import {
  ROLE_ADMIN,
  ROLE_PUBLISHER,
  addMemberInstruction,
  attestDomainInstruction,
  chainIdFromGenesisHash,
  createDocumentInstruction,
  createNonceShardInstruction,
  createOrganizationInstruction,
  createRpc,
  decodeOrganization,
  domainHash,
  fetchAccountData,
  findConfigPda,
  findDocumentPda,
  findDomainRecordPda,
  findMemberPda,
  findNonceShardPda,
  findOrganizationPda,
  getClusterUnixTimestamp,
  toBase58,
  toBase64,
  utf8,
  NONCE_SHARD_ACCOUNT_SIZE,
  enableShardSponsorshipInstruction,
  systemTransferInstruction,
} from "@stelehq/protocol";
import { PROGRAM, PUBLIC_NETWORKS, RPC_URL, airdrop, publishVersion, send } from "./chain.js";
import { DATA_DIR, REPO_ROOT, ensureKeypair, signer } from "./keys.js";
import { NORTHWIND_PRIVACY_V1, NORTHWIND_TERMS_V1 } from "./sample-content.js";

const APP = (process.env.STELE_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API = `${APP}/api`;
const SHOP_PORT = Number(process.env.DEMO_SHOP_PORT ?? 4300);
const NAME = "Northwind Shop";
const DOMAIN = "northwind.test";
const STATE = resolve(DATA_DIR, "demo.json");
const SHOP_ENV = resolve(REPO_ROOT, "examples/demo-shop/.env");

const args = process.argv.slice(2).filter((a) => a !== "--");
const memberIndex = args.indexOf("--member");
const memberArg = memberIndex >= 0 ? args[memberIndex + 1] : undefined;
const member = memberArg ? address(memberArg) : null;

const rpc = createRpc(RPC_URL);
const chainId = chainIdFromGenesisHash(await rpc.getGenesisHash().send());
if (PUBLIC_NETWORKS.has(chainId)) {
  console.error(`Refusing: ${chainId} is a public network. The demo is for localnet only.`);
  process.exit(1);
}

const network = (await (await fetch(`${API}/v1/network`)).json()) as { relayer: string };
const owner = await signer("demo-owner");
const attestor = await signer("attestor");
await airdrop(rpc, owner.address, 5);
const [config] = await findConfigPda(PROGRAM);

// ---- On-chain ------------------------------------------------------------------------------------

const saved = existsSync(STATE)
  ? (JSON.parse(readFileSync(STATE, "utf8")) as { organization: string })
  : null;
let organization: Address;
if (saved && (await fetchAccountData(rpc, address(saved.organization)))) {
  organization = address(saved.organization);
  console.log(`${NAME} already exists: ${organization}`);
} else {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  [organization] = await findOrganizationPda(owner.address, seed, PROGRAM);
  const [shard] = await findNonceShardPda(organization, 0, PROGRAM);
  await send(rpc, owner, [
    createOrganizationInstruction({
      programAddress: PROGRAM,
      creator: owner,
      payer: owner,
      config,
      organization,
      seed,
      name: NAME,
      owner: owner.address,
      recovery: null,
    }),
    createNonceShardInstruction({
      programAddress: PROGRAM,
      authority: owner,
      membership: null,
      config,
      organization,
      nonceShard: shard,
      payer: owner,
      shardId: 0,
      relayer: address(network.relayer),
    }),
  ]);
  writeFileSync(STATE, JSON.stringify({ organization }, null, 2));
  console.log(`created ${NAME}: ${organization}`);
}

const org = decodeOrganization((await fetchAccountData(rpc, organization))!);
if (!org.verifiedDomain) {
  const [domainRecord] = await findDomainRecordPda(DOMAIN, PROGRAM);
  await send(rpc, attestor, [
    attestDomainInstruction({
      programAddress: PROGRAM,
      attestor,
      payer: attestor,
      config,
      organization,
      domainRecord,
      domain: DOMAIN,
      domainHash: domainHash(DOMAIN),
      expiresAt: (await getClusterUnixTimestamp(rpc)) + 365 * 86_400,
    }),
  ]);
  console.log(`  verified domain ${DOMAIN} (localnet attestation)`);
}

if (member) {
  const [memberAccount] = await findMemberPda(organization, member, PROGRAM);
  if (!(await fetchAccountData(rpc, memberAccount))) {
    await send(rpc, owner, [
      addMemberInstruction({
        programAddress: PROGRAM,
        authority: owner,
        authorityMembership: null,
        organization,
        memberAccount,
        member,
        roles: ROLE_ADMIN | ROLE_PUBLISHER,
        payer: owner,
      }),
    ]);
    console.log(`  added ${member} as admin + publisher`);
  }
}

for (const [slug, documentType, title, source] of [
  ["terms-of-service", "terms-of-service", "Terms of Service", NORTHWIND_TERMS_V1],
  ["privacy-policy", "privacy-policy", "Privacy Policy", NORTHWIND_PRIVACY_V1],
] as const) {
  const [document] = await findDocumentPda(organization, slug, PROGRAM);
  if (await fetchAccountData(rpc, document)) continue;
  await send(rpc, owner, [
    createDocumentInstruction({
      programAddress: PROGRAM,
      authority: owner,
      membership: null,
      config,
      organization,
      document,
      payer: owner,
      slug,
      documentType,
      locale: "en-US",
    }),
  ]);
  await publishVersion({
    rpc,
    publisher: owner,
    membership: null,
    organization,
    document,
    title,
    versionLabel: "1.0",
    source,
  });
}

// Fee sponsorship: the organization funds its nonce shard; the program reimburses the relayer.
{
  const [shard] = await findNonceShardPda(organization, 0, PROGRAM);
  const data = await fetchAccountData(rpc, shard);
  if (data && data.length === NONCE_SHARD_ACCOUNT_SIZE) {
    await send(rpc, owner, [
      enableShardSponsorshipInstruction({
        programAddress: PROGRAM,
        authority: owner,
        membership: null,
        organization,
        nonceShard: shard,
        payer: owner,
        maxFeePerRecord: 100_000n,
        dailyLimit: 50_000_000n,
      }),
      systemTransferInstruction({ source: owner, destination: shard, lamports: 500_000_000n }),
    ]);
    console.log(`  fee sponsorship enabled on shard 0 (${shard}), 0.5 SOL deposited`);
  }
}

// ---- Off-chain: the API mirrors the chain; then an API key and a webhook for the shop -----------

for (let i = 0; i < 40; i++) {
  const res = await fetch(`${API}/v1/public/organizations/${DOMAIN}`);
  const body = res.ok ? ((await res.json()) as { documents: unknown[] }) : null;
  if (body && body.documents.length >= 2) break;
  await new Promise((r) => setTimeout(r, 1000));
}

const ownerKey = ensureKeypair("demo-owner");
const { message } = (await (
  await fetch(`${API}/v1/auth/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP },
    body: JSON.stringify({ address: owner.address }),
  })
).json()) as { message: string };
const signIn = await fetch(`${API}/v1/auth/verify`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: APP },
  body: JSON.stringify({
    address: owner.address,
    signedMessage: toBase64(utf8(message)),
    signature: toBase58(ed25519.sign(utf8(message), ownerKey.slice(0, 32))),
  }),
});
if (!signIn.ok) throw new Error(`dashboard sign-in failed: ${await signIn.text()}`);
const cookies = signIn.headers.getSetCookie().map((c) => c.split(";")[0]!);
const csrf = cookies.find((c) => c.startsWith("stele_csrf="))?.split("=")[1] ?? "";
const session = {
  cookie: cookies.join("; "),
  origin: APP,
  "x-csrf-token": csrf,
  "content-type": "application/json",
};
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: session,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

let { organizations } = await call<{ organizations: { id: string; address: string }[] }>(
  "GET",
  "/v1/organizations",
);
if (!organizations.some((o) => o.address === organization)) {
  await call("POST", "/v1/organizations/sync", { address: organization });
  ({ organizations } = await call<{ organizations: { id: string; address: string }[] }>(
    "GET",
    "/v1/organizations",
  ));
}
const orgId = organizations.find((o) => o.address === organization)!.id;

const { key } = await call<{ key: string }>("POST", `/v1/organizations/${orgId}/api-keys`, {
  name: "Northwind demo shop",
  scopes: [
    "acceptances:read",
    "acceptances:write",
    "documents:read",
    "proofs:read",
    "proofs:write",
    "signers:read",
    "signers:write",
  ],
});
// Visitors may sign with a wallet or a passkey; the organization sponsors fees (Stele as fallback).
await call("PATCH", `/v1/organizations/${orgId}/settings`, {
  signingPolicy: "WALLET_OR_PASSKEY",
  feeSponsor: "organization",
  sponsorFallbackToStele: true,
  sponsorLowBalanceLamports: 50_000_000,
});
const hooks = await call<{ events: string[] }>("GET", `/v1/organizations/${orgId}/webhooks`);
const { secret } = await call<{ secret: string }>("POST", `/v1/organizations/${orgId}/webhooks`, {
  url: `http://localhost:${SHOP_PORT}/webhooks/stele`,
  description: "Northwind demo shop",
  events: hooks.events,
});

writeFileSync(
  SHOP_ENV,
  [
    "# Generated by `pnpm localnet:demo` (localnet only; never commit real keys).",
    `PORT=${SHOP_PORT}`,
    `STELE_APP_URL=${APP}`,
    `STELE_API_URL=${API}`,
    `STELE_API_KEY=${key}`,
    `STELE_WEBHOOK_SECRET=${secret}`,
    `STELE_ORGANIZATION=${DOMAIN}`,
    `STELE_ORGANIZATION_ADDRESS=${organization}`,
    `STELE_RPC_URLS=${RPC_URL}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);

console.log(`
${NAME} is ready (${DOMAIN}, organization ${organization}).
  API key and webhook secret written to examples/demo-shop/.env
  Start the shop:   pnpm demo:shop      → http://localhost:${SHOP_PORT}
${member ? `  Your wallet ${member} can manage it in the dashboard: ${APP}/dashboard` : "  Tip: re-run with --member <your wallet address> to manage it in the dashboard."}`);
