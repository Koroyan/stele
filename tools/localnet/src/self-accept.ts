/**
 * Accept a Stele Gate document WITHOUT Stele — no Stele API, no Stele relayer. The wallet rebuilds
 * the exact acceptance message from Solana, signs it, and submits `record_gated_acceptance` itself,
 * paying the network fee and the pass rent. This is how acceptances keep working if Stele's servers
 * ever disappear: everything needed is on Solana and in the open-source @stelehq/protocol package.
 *
 * It needs a nonce shard of the organization that this wallet may use: one whose relayer is the
 * wallet itself, or the zero key (anyone). The organization opens one, once, with its owner key:
 *
 *   STELE_RPC_URL=<rpc> pnpm --filter @stele/localnet self-accept -- \
 *     --policy <policy> --keypair <owner.json> --open-shard [--shard 0]
 *
 * Then any wallet accepts the policy's current document version:
 *
 *   STELE_RPC_URL=<rpc> pnpm --filter @stele/localnet self-accept -- \
 *     --policy <policy> --keypair <wallet.json>
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ed25519 } from "@noble/curves/ed25519.js";
import { address, createKeyPairSignerFromBytes, type Address } from "@solana/kit";
import {
  SHARD_CAPACITY,
  TransactionFailedError,
  buildAcceptanceMessageFromChain,
  buildAcceptanceTransactionMessage,
  buildEd25519Instruction,
  createNonceShardInstruction,
  createRpc,
  decodeAccessPass,
  decodeDocument,
  decodeGatePolicy,
  decodeNonceShard,
  describeProgramError,
  fetchAccountData,
  findAccessPassPda,
  findConfigPda,
  findNonceShardPda,
  freeNonces,
  getClusterUnixTimestamp,
  recordGatedAcceptanceInstruction,
  setShardRelayerInstruction,
  signSendAndConfirm,
  utf8,
} from "@stelehq/protocol";
import { RPC_URL, send } from "./chain.js";

const ANYONE = address("11111111111111111111111111111111");
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    policy: { type: "string" },
    keypair: { type: "string" },
    shard: { type: "string" },
    "open-shard": { type: "boolean", default: false },
    domain: { type: "string", default: "self-accept.local" },
  },
  strict: true,
});
if (!values.policy || !values.keypair) {
  console.error(
    "usage: self-accept --policy <address> --keypair <wallet.json> [--open-shard] [--shard <id>]",
  );
  process.exit(64);
}

const rpc = createRpc(RPC_URL);
const secretKey = Uint8Array.from(JSON.parse(readFileSync(values.keypair, "utf8")) as number[]);
const wallet = await createKeyPairSignerFromBytes(secretKey);
const policyAddress = address(values.policy);
const policyData = await fetchAccountData(rpc, policyAddress);
if (!policyData) throw new Error(`No Stele policy at ${policyAddress} on ${RPC_URL}`);
const policy = decodeGatePolicy(policyData);

// The organization (owner key) opens a shard to everyone: then no relayer is needed at all.
if (values["open-shard"]) {
  const id = Number(values.shard ?? 0);
  const [nonceShard] = await findNonceShardPda(policy.organization, id);
  const exists = (await fetchAccountData(rpc, nonceShard)) !== null;
  const [config] = await findConfigPda();
  const sig = await send(rpc, wallet, [
    exists
      ? setShardRelayerInstruction({
          authority: wallet,
          membership: null,
          organization: policy.organization,
          nonceShard,
          relayer: ANYONE,
        })
      : createNonceShardInstruction({
          authority: wallet,
          membership: null,
          config,
          organization: policy.organization,
          nonceShard,
          payer: wallet,
          shardId: id,
          relayer: ANYONE,
        }),
  ]);
  console.log(`✓ Shard ${id} (${nonceShard}) now accepts acceptances from any wallet · tx ${sig}`);
  process.exit(0);
}

// 1. What is being accepted: the document's current version, read from Solana.
const document = decodeDocument((await fetchAccountData(rpc, policy.document))!);
if (!document.currentVersion) throw new Error("The policy's document has no published version");
const version = document.currentVersion;

// 2. A shard this wallet may use: its relayer is this wallet, or anyone.
let shard: { address: Address; bitmap: Uint8Array; id: number } | null = null;
for (const id of values.shard ? [Number(values.shard)] : Array.from({ length: 32 }, (_, i) => i)) {
  const [pda] = await findNonceShardPda(policy.organization, id);
  const data = await fetchAccountData(rpc, pda);
  if (!data) continue;
  const s = decodeNonceShard(data);
  // The zero key ("anyone") decodes as null.
  if (s.relayer === null || s.relayer === wallet.address) {
    shard = { address: pda, bitmap: s.bitmap, id };
    break;
  }
}
if (!shard) {
  console.error(
    "No shard of this organization is open to this wallet. The organization opens one with:\n" +
      `  self-accept --policy ${policyAddress} --keypair <owner.json> --open-shard`,
  );
  process.exit(1);
}

// 3. The exact message the program will rebuild, with a fresh one-time nonce.
const candidates = freeNonces(shard.bitmap, 0, SHARD_CAPACITY, 256);
const nonceIndex = candidates[Math.floor(Math.random() * candidates.length)]!;
const nonceTag = new Uint8Array(randomBytes(8));
const now = await getClusterUnixTimestamp(rpc);
const issuedAt = now;
const expiresAt = now + 300;
const built = await buildAcceptanceMessageFromChain({
  rpc,
  organization: policy.organization,
  document: policy.document,
  version,
  nonceShard: shard.address,
  signer: wallet.address,
  issuedAt,
  expiresAt,
  nonceIndex,
  nonceTag,
  requestDomain: values.domain,
  clusterTime: now,
});
console.log("You are signing:\n");
console.log(built.message.replace(/^/gm, "  "));
console.log("");

// 4. Sign it, and submit it yourself — this wallet is the fee payer ("relayer").
const signature = ed25519.sign(utf8(built.message), secretKey.slice(0, 32));
const [accessPass] = await findAccessPassPda(policy.document, wallet.address);
const [config] = await findConfigPda();
const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
const message = buildAcceptanceTransactionMessage({
  feePayer: wallet,
  latestBlockhash,
  precompileInstruction: buildEd25519Instruction(
    secretKey.slice(32),
    signature,
    utf8(built.message),
  ),
  recordInstruction: recordGatedAcceptanceInstruction({
    relayer: wallet,
    config,
    organization: policy.organization,
    document: policy.document,
    version,
    nonceShard: shard.address,
    holder: wallet.address,
    accessPass,
    nonceIndex,
    nonceTag,
    issuedAt,
    expiresAt,
  }),
});
try {
  const tx = await signSendAndConfirm(rpc, message, { commitment: "confirmed" });
  const pass = decodeAccessPass((await fetchAccountData(rpc, accessPass))!);
  console.log(`✓ Accepted without Stele · tx ${tx}`);
  console.log(`  AccessPass ${accessPass} now names version ${pass.versionNumber}`);
} catch (e) {
  // Name the program's reason (e.g. AccessPassAlreadyCurrent) from the transaction's logs.
  const logs = e instanceof TransactionFailedError ? e.logs : [];
  const anchor = logs.map((l) => /Error Code: (\w+)/.exec(l)?.[1]).find(Boolean);
  const custom = logs.map((l) => /custom program error: (0x[0-9a-f]+)/i.exec(l)?.[1]).find(Boolean);
  const named = anchor ?? (custom ? describeProgramError(Number(custom))?.name : undefined);
  console.error(`✘ Not recorded: ${named ?? (e instanceof Error ? e.message : String(e))}`);
  process.exit(1);
}
