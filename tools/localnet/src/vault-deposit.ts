/**
 * A direct call to the Atlas vault's deposit() — no frontend, no SDK, no Stele API: the transaction
 * goes straight to the RPC, signed and paid by a local keypair, and is submitted even if it will
 * fail, so the result is a real transaction on-chain. It succeeds only if that wallet holds a
 * current Stele AccessPass. LOCALNET and DEVNET only.
 *
 *   STELE_RPC_URL=<rpc> pnpm --filter @stele/localnet vault-deposit -- \
 *     --policy <policy address> [--keypair <wallet.json>] [--amount 5000]
 *
 * Without --keypair a fresh wallet is generated (localnet: funded by airdrop) — it has no pass.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import {
  GATE_DEMO_PROGRAM_ADDRESS,
  TransactionFailedError,
  chainIdFromGenesisHash,
  confirmSignature,
  createRpc,
  decodeGatePolicy,
  depositInstruction,
  explainGateFailure,
  fetchAccountData,
  findAccessPassPda,
  findVaultPda,
} from "@stele/protocol";
import { RPC_URL, airdrop } from "./chain.js";

const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    policy: { type: "string" },
    keypair: { type: "string" },
    amount: { type: "string", default: "5000" },
  },
  strict: true,
});
if (!values.policy) {
  console.error(
    "usage: vault-deposit --policy <address> [--keypair <wallet.json>] [--amount 5000]",
  );
  process.exit(64);
}
const rpc = createRpc(RPC_URL);
const chainId = chainIdFromGenesisHash(await rpc.getGenesisHash().send());
if (chainId === MAINNET) {
  console.error("Refusing: the demo vault never runs on mainnet.");
  process.exit(1);
}
const wallet = values.keypair
  ? await createKeyPairSignerFromBytes(
      Uint8Array.from(JSON.parse(readFileSync(values.keypair, "utf8")) as number[]),
    )
  : await generateKeyPairSigner();
if (!values.keypair) await airdrop(rpc, wallet.address, 1);

const policy = address(values.policy);
const policyAccount = decodeGatePolicy((await fetchAccountData(rpc, policy))!);
const [vault] = await findVaultPda(policy);
const [accessPass] = await findAccessPassPda(policyAccount.document, wallet.address);
const amount = BigInt(Math.round(Number(values.amount) * 1_000_000));

console.log(`$ deposit(${values.amount} USDC) from ${wallet.address}`);
console.log(`  vault ${vault} · the policy requires version ${policyAccount.requiredVersion}`);
const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
const message = pipe(
  createTransactionMessage({ version: 0 }),
  (m) => setTransactionMessageFeePayerSigner(wallet, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
  (m) =>
    appendTransactionMessageInstructions(
      [depositInstruction({ investor: wallet.address, vault, policy, accessPass, amount })],
      m,
    ),
);
const signed = await signTransactionMessageWithSigners(message);
const signature = getSignatureFromTransaction(signed);
// Submitted without preflight: a rejection becomes a real failed transaction on-chain.
await rpc
  .sendTransaction(getBase64EncodedWireTransaction(signed), {
    encoding: "base64",
    skipPreflight: true,
  })
  .send();
// A failed transaction is still confirmed on-chain; the outcome is read from it below.
await confirmSignature(rpc, signature, blockhash.lastValidBlockHeight, "confirmed").catch(
  (e: unknown) => {
    if (!(e instanceof TransactionFailedError)) throw e;
  },
);
const tx = await rpc
  .getTransaction(signature, {
    encoding: "json",
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  })
  .send();
if (!tx?.meta?.err) {
  console.log(`✔ deposit executed — tx ${signature}`);
} else {
  const logs = (tx.meta.logMessages ?? []).join("\n");
  const code = logs.match(/custom program error: 0x([0-9a-f]+)/i)?.[1];
  const reason = code
    ? explainGateFailure(GATE_DEMO_PROGRAM_ADDRESS, Number.parseInt(code, 16))
    : null;
  console.log(
    `✘ rejected on-chain by the vault program — ${reason ? `${reason.name}: ${reason.message}` : JSON.stringify(tx.meta.err)}`,
  );
  console.log(`  tx ${signature}`);
  process.exitCode = 2;
}
