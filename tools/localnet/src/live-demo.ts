/**
 * Sets up the website's live demo organization ("Stele Live Demo") on LOCALNET or DEVNET — never
 * mainnet. The API then creates one policy document per visitor session under it (services/demo.ts).
 *
 *   localnet:  pnpm --filter @stele/localnet live-demo
 *              (key: .data/localnet/live-demo-owner.json; writes STELE_DEMO_* into the root .env)
 *   devnet:    STELE_RPC_URL=<devnet rpc> pnpm --filter @stele/localnet live-demo -- \
 *                --owner <dedicated devnet keypair.json> --relayer <API relayer address>
 *              (prints the STELE_DEMO_* lines for the server's .env; fund the owner first)
 *
 * The owner key is the demo organization's own key, used by the API only to create demo documents,
 * publish their versions and open the Gate demo market. It is never a customer's key.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { address, createKeyPairSignerFromBytes, type Address } from "@solana/kit";
import {
  GATE_DEMO_PROGRAM_ADDRESS,
  chainIdFromGenesisHash,
  createNonceShardInstruction,
  createOrganizationInstruction,
  createRpc,
  fetchAccountData,
  findConfigPda,
  findNonceShardPda,
  findOrganizationPda,
} from "@stelehq/protocol";
import { PROGRAM, RPC_URL, airdrop, send } from "./chain.js";
import { DATA_DIR, REPO_ROOT, keypairPath, signer } from "./keys.js";

const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const NAME = "Stele Live Demo";
const APP = (process.env.STELE_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const args = process.argv.slice(2).filter((a) => a !== "--");
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const rpc = createRpc(RPC_URL);
const chainId = chainIdFromGenesisHash(await rpc.getGenesisHash().send());
if (chainId === MAINNET) {
  console.error("Refusing: the live demo never runs on mainnet.");
  process.exit(1);
}
const localnet = ![
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
].includes(chainId);

const ownerFile = arg("--owner") ?? (localnet ? keypairPath("live-demo-owner") : undefined);
if (!ownerFile) {
  console.error("On devnet pass --owner <dedicated keypair.json> (funded with a little SOL).");
  process.exit(64);
}
const owner = localnet
  ? await signer("live-demo-owner")
  : await createKeyPairSignerFromBytes(
      Uint8Array.from(JSON.parse(readFileSync(ownerFile, "utf8")) as number[]),
    );
const relayer = address(
  arg("--relayer") ??
    ((await (await fetch(`${APP}/api/v1/network`)).json()) as { relayer: string }).relayer,
);
if (localnet) await airdrop(rpc, owner.address, 10);

const gate = await rpc.getAccountInfo(GATE_DEMO_PROGRAM_ADDRESS, { encoding: "base64" }).send();
if (!gate.value?.executable) {
  console.error(
    `The Stele Gate demo program (${GATE_DEMO_PROGRAM_ADDRESS}) is not deployed on this cluster.`,
  );
  process.exit(1);
}

const STATE = resolve(
  DATA_DIR,
  localnet ? "live-demo.json" : `live-demo-${chainId.split(":")[1]}.json`,
);
const saved = existsSync(STATE)
  ? (JSON.parse(readFileSync(STATE, "utf8")) as { organization: string })
  : null;
let organization: Address;
if (saved && (await fetchAccountData(rpc, address(saved.organization)))) {
  organization = address(saved.organization);
  console.log(`${NAME} already exists: ${organization}`);
} else {
  const [config] = await findConfigPda(PROGRAM);
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
      relayer,
    }),
  ]);
  writeFileSync(STATE, JSON.stringify({ organization, owner: owner.address }, null, 2));
  console.log(`created ${NAME}: ${organization} (shard 0 relayer ${relayer})`);
}

const lines = [
  `STELE_DEMO_OWNER_KEYPAIR=${localnet ? "../../.data/localnet/live-demo-owner.json" : ownerFile}`,
  `STELE_DEMO_ORGANIZATION=${organization}`,
];
if (localnet) {
  const envPath = resolve(REPO_ROOT, ".env");
  let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  for (const line of lines) {
    const key = line.split("=")[0]!;
    const re = new RegExp(`^${key}=.*$`, "m");
    env = re.test(env) ? env.replace(re, line) : `${env.replace(/\n?$/, "\n")}${line}\n`;
  }
  writeFileSync(envPath, env);
  console.log(`wrote ${lines.map((l) => l.split("=")[0]).join(", ")} to .env — restart the API`);
} else {
  console.log("Add to the server's .env:");
  for (const line of lines) console.log(`  ${line}`);
}
