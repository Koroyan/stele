/**
 * Stele as a customer of itself: creates the "Stele" organization and publishes Stele's own Terms of
 * Service and Privacy Policy (legal/manifest.json) with Stele — the same drafts → prepare → publish
 * → confirm path the dashboard uses. Run it again after editing a document: a document whose text
 * changed gets a new version (bump its versionLabel in the manifest); unchanged ones are skipped.
 *
 *   localnet:  pnpm --filter @stele/localnet platform
 *              (key: .data/localnet/platform-owner.json; writes STELE_PLATFORM_ORGANIZATION to .env)
 *   devnet:    STELE_RPC_URL=<devnet rpc> STELE_APP_URL=https://stele.site \
 *                pnpm --filter @stele/localnet platform -- --owner <keypair.json>
 *              (prints STELE_PLATFORM_ORGANIZATION for the server's .env)
 *
 * The owner key controls Stele's own legal documents: keep it as safe as any organization key.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { address, createKeyPairSignerFromBytes, type Address } from "@solana/kit";
import {
  chainIdFromGenesisHash,
  createDocumentInstruction,
  createNonceShardInstruction,
  createOrganizationInstruction,
  createRpc,
  fetchAccountData,
  findConfigPda,
  findDocumentPda,
  findNonceShardPda,
  findOrganizationPda,
  fromHex,
  publishVersionInstruction,
  toBase58,
  toBase64,
  utf8,
} from "@stelehq/protocol";
import { PROGRAM, RPC_URL, airdrop, send } from "./chain.js";
import { DATA_DIR, REPO_ROOT, keypairPath } from "./keys.js";

const APP = (process.env.STELE_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API = `${APP}/api`;

interface ManifestDocument {
  slug: string;
  documentType: string;
  file: string;
  title: string;
  versionLabel: string;
  changeSummary?: string;
}
const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, "legal/manifest.json"), "utf8")) as {
  organization: string;
  documents: ManifestDocument[];
};

const args = process.argv.slice(2).filter((a) => a !== "--");
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const rpc = createRpc(RPC_URL);
const chainId = chainIdFromGenesisHash(await rpc.getGenesisHash().send());
const localnet = ![
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
].includes(chainId);

const ownerFile = arg("--owner") ?? (localnet ? keypairPath("platform-owner") : undefined);
if (!ownerFile) {
  console.error("Pass --owner <keypair.json>: the key of Stele's own organization (funded).");
  process.exit(64);
}
if (localnet && !existsSync(ownerFile)) {
  const secret = ed25519.utils.randomSecretKey();
  const key = new Uint8Array(64);
  key.set(secret);
  key.set(ed25519.getPublicKey(secret), 32);
  writeFileSync(ownerFile, JSON.stringify(Array.from(key)), { mode: 0o600 });
}
const ownerKey = Uint8Array.from(JSON.parse(readFileSync(ownerFile, "utf8")) as number[]);
const owner = await createKeyPairSignerFromBytes(ownerKey);
if (localnet) await airdrop(rpc, owner.address, 10);
const [config] = await findConfigPda(PROGRAM);

// ---- the organization and its acceptance shard (relayed by this deployment's relayer) -------------

const STATE = resolve(
  DATA_DIR,
  localnet ? "platform.json" : `platform-${chainId.split(":")[1]}.json`,
);
const saved = existsSync(STATE)
  ? (JSON.parse(readFileSync(STATE, "utf8")) as { organization: string })
  : null;
let organization: Address;
if (saved && (await fetchAccountData(rpc, address(saved.organization)))) {
  organization = address(saved.organization);
  console.log(`${manifest.organization} already exists: ${organization}`);
} else {
  const relayer = address(
    ((await (await fetch(`${API}/v1/network`)).json()) as { relayer: string }).relayer,
  );
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
      name: manifest.organization,
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
      relayer,
    }),
  ]);
  writeFileSync(STATE, JSON.stringify({ organization, owner: owner.address }, null, 2));
  console.log(`created ${manifest.organization}: ${organization} (shard 0 relayer ${relayer})`);
}

// ---- the API, signed in as the owner (as the dashboard is) ------------------------------------------

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
if (!signIn.ok) throw new Error(`sign-in failed: ${await signIn.text()}`);
const cookies = signIn.headers.getSetCookie().map((c) => c.split(";")[0]!);
const csrf = (await signIn.json()) as { csrfToken: string };
const session = {
  cookie: cookies.join("; "),
  origin: APP,
  "x-csrf-token": csrf.csrfToken,
  "content-type": "application/json",
};
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: session,
    body: body ? JSON.stringify(body) : method === "GET" ? undefined : "{}",
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
{
  const [shard] = await findNonceShardPda(organization, 0, PROGRAM);
  await call("POST", `/v1/organizations/${orgId}/shards/sync`, { address: shard });
}

// ---- the documents ----------------------------------------------------------------------------------

interface PublicDocument {
  versions: { number: number; label: string; contentHash: string }[];
}

for (const d of manifest.documents) {
  const source = readFileSync(resolve(REPO_ROOT, d.file), "utf8");
  const [document] = await findDocumentPda(organization, d.slug, PROGRAM);
  if (!(await fetchAccountData(rpc, document))) {
    await send(rpc, owner, [
      createDocumentInstruction({
        programAddress: PROGRAM,
        authority: owner,
        membership: null,
        config,
        organization,
        document,
        payer: owner,
        slug: d.slug,
        documentType: d.documentType,
        locale: "en-US",
      }),
    ]);
    console.log(`  created document ${d.slug}`);
  }
  const { document: row } = await call<{ document: { id: string } }>(
    "POST",
    `/v1/organizations/${orgId}/documents/sync`,
    { address: document },
  );
  const current = await fetch(`${API}/v1/public/organizations/${organization}/documents/${d.slug}`)
    .then((r) => (r.ok ? (r.json() as Promise<PublicDocument>) : null))
    .then((p) => p?.versions.at(-1) ?? null);

  // The API canonicalizes and stores the text, and says what would be published.
  const { draft } = await call<{ draft: { id: string } }>(
    "POST",
    `/v1/documents/${row.id}/drafts`,
    {
      title: d.title,
      versionLabel: d.versionLabel,
      source,
      changeSummary: d.changeSummary ?? null,
    },
  );
  const { publication: p } = await call<{
    publication: {
      versionNumber: number;
      versionAccount: string;
      previousVersionHash: string;
      contentHash: string;
      storageUri: string;
      versionHash: string;
      effectiveAt: number;
    };
  }>("POST", `/v1/drafts/${draft.id}/prepare`);
  if (current && current.contentHash === p.contentHash) {
    await call("POST", `/v1/drafts/${draft.id}/abandon`);
    console.log(`  ${d.slug}: unchanged (version ${current.number}, ${current.label})`);
    continue;
  }
  if (current && current.label === d.versionLabel) {
    await call("POST", `/v1/drafts/${draft.id}/abandon`);
    throw new Error(
      `${d.slug} changed: give it a new versionLabel in legal/manifest.json (current: ${current.label})`,
    );
  }
  const signature = await send(rpc, owner, [
    publishVersionInstruction({
      programAddress: PROGRAM,
      authority: owner,
      membership: null,
      config,
      organization,
      document,
      versionAccount: address(p.versionAccount),
      payer: owner,
      version: p.versionNumber,
      previousVersionHash: fromHex(p.previousVersionHash),
      contentHash: fromHex(p.contentHash),
      title: d.title,
      versionLabel: d.versionLabel,
      effectiveAt: p.effectiveAt,
      storageUri: p.storageUri,
      expectedVersionHash: fromHex(p.versionHash),
    }),
  ]);
  await call("POST", "/v1/publications/confirm", { signature });
  console.log(
    `  published ${d.title} ${d.versionLabel} (#${p.versionNumber}) tx ${signature.slice(0, 16)}…`,
  );
}

const line = `STELE_PLATFORM_ORGANIZATION=${organization}`;
if (localnet) {
  const envPath = resolve(REPO_ROOT, ".env");
  let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const re = /^#?\s*STELE_PLATFORM_ORGANIZATION=.*$/m;
  env = re.test(env) ? env.replace(re, line) : `${env.replace(/\n?$/, "\n")}${line}\n`;
  writeFileSync(envPath, env);
  console.log("wrote STELE_PLATFORM_ORGANIZATION to .env — restart the API");
} else {
  console.log(`Add to the server's .env:\n  ${line}`);
}
