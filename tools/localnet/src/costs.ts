/**
 * Measures what recordings actually cost, from confirmed transactions (read-only; any cluster):
 * fee charged to the fee payer, compute units, serialized size, and whether a sponsored shard
 * reimbursed the fee. stele/1 wallet and PRF-passkey acceptances are indistinguishable on-chain by
 * design (same signed bytes, same transaction); stele/2 native-passkey acceptances, passkey
 * enrollments and Merkle batch anchors are their own instructions. A batch anchor's fee is also
 * shown per acceptance it carries.
 *
 *   pnpm --filter @stele/localnet costs            # localnet
 *   STELE_RPC_URL=https://api.devnet.solana.com pnpm --filter @stele/localnet costs
 */
import {
  decodeEventsFromLogs,
  fromBase58,
  fromBase64,
  identifyInstruction,
  proofTypeByCode,
  NONCE_SHARD_ACCOUNT_SIZE,
  PASSKEY_SIGNER_ACCOUNT_SIZE,
  SPONSORED_NONCE_SHARD_ACCOUNT_SIZE,
} from "@stele/protocol";
import { PROGRAM, RPC_URL } from "./chain.js";

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

interface JsonTx {
  transaction: {
    message: { accountKeys: string[]; instructions: { programIdIndex: number; data: string }[] };
  };
  meta: { fee: number; err: unknown; logMessages: string[]; computeUnitsConsumed?: number } | null;
}

const signatures = await rpc<{ signature: string; err: unknown }[]>("getSignaturesForAddress", [
  PROGRAM,
  { limit: 1000, commitment: "confirmed" },
]);

interface Row {
  kind: string;
  fee: number;
  cu: number;
  size: number;
  reimbursed: number | null;
}
const rows: Row[] = [];
for (const s of signatures) {
  if (s.err) continue;
  const [tx, raw] = await Promise.all([
    rpc<JsonTx | null>("getTransaction", [
      s.signature,
      { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
    ]),
    rpc<{ transaction: [string, string] } | null>("getTransaction", [
      s.signature,
      { encoding: "base64", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
    ]),
  ]);
  if (!tx?.meta || !raw) continue;
  const { accountKeys, instructions } = tx.transaction.message;
  for (const ix of instructions) {
    if (accountKeys[ix.programIdIndex] !== PROGRAM) continue;
    const data = fromBase58(ix.data);
    const name = identifyInstruction(data);
    const events = decodeEventsFromLogs(tx.meta.logMessages, PROGRAM);
    let kind: string;
    if (name === "record_acceptance") kind = "stele/1 acceptance (wallet or PRF passkey)";
    else if (name === "record_passkey_acceptance") kind = "stele/2 acceptance (native passkey)";
    else if (name === "record_proof") kind = `proof: ${proofTypeByCode(data[8]!)?.name ?? "?"}`;
    else if (name === "enroll_passkey_signer") kind = "passkey enrollment (+ rent, see below)";
    else if (name === "rotate_passkey_signer") kind = "passkey rotation";
    else if (name === "anchor_acceptance_batch") {
      const anchored = events.find((e) => e.name === "AcceptanceBatchAnchored");
      const leaves = anchored?.name === "AcceptanceBatchAnchored" ? anchored.data.leafCount : 1;
      kind = `batch anchor (${leaves} acceptances; ${Math.ceil(tx.meta.fee / leaves).toLocaleString("en-US")} lamports each)`;
    } else continue;
    const reimbursed = events.find((e) => e.name === "SponsorReimbursed");
    rows.push({
      kind: `${kind}${reimbursed ? ", org-sponsored" : ", Stele-sponsored"}`,
      fee: tx.meta.fee,
      cu: tx.meta.computeUnitsConsumed ?? 0,
      size: fromBase64(raw.transaction[0]).length,
      reimbursed:
        reimbursed && reimbursed.name === "SponsorReimbursed"
          ? Number(reimbursed.data.amount)
          : null,
    });
  }
}

const groups = new Map<string, Row[]>();
for (const r of rows) groups.set(r.kind, [...(groups.get(r.kind) ?? []), r]);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

console.log(
  `RPC ${RPC_URL}, program ${PROGRAM}: ${rows.length} recordings in the last ${signatures.length} program transactions\n`,
);
console.log(
  "| Recording | n | fee (lamports) | SOL | per 1 SOL | compute units (median) | tx bytes (max) | reimbursed by shard |",
);
console.log("|---|---|---|---|---|---|---|---|");
for (const [kind, rs] of [...groups].sort()) {
  const fee = median(rs.map((r) => r.fee));
  console.log(
    `| ${kind} | ${rs.length} | ${fee.toLocaleString("en-US")} | ${(fee / 1e9).toFixed(6)} | ${Math.floor(1e9 / fee).toLocaleString("en-US")} | ${median(rs.map((r) => r.cu)).toLocaleString("en-US")} | ${Math.max(...rs.map((r) => r.size))} | ${rs[0]!.reimbursed !== null ? `${median(rs.map((r) => r.reimbursed ?? 0))}` : "—"} |`,
  );
}

const [plain, sponsored, enrollment] = await Promise.all([
  rpc<number>("getMinimumBalanceForRentExemption", [NONCE_SHARD_ACCOUNT_SIZE]),
  rpc<number>("getMinimumBalanceForRentExemption", [SPONSORED_NONCE_SHARD_ACCOUNT_SIZE]),
  rpc<number>("getMinimumBalanceForRentExemption", [PASSKEY_SIGNER_ACCOUNT_SIZE]),
]);
console.log(`
One-time rent, paid by the organization's admin wallet (locked: the program has no close instruction):
  nonce shard (65,536 recordings)        ${plain.toLocaleString("en-US")} lamports (${(plain / 1e9).toFixed(6)} SOL)
  enabling sponsorship on a shard       +${(sponsored - plain).toLocaleString("en-US")} lamports (${((sponsored - plain) / 1e9).toFixed(6)} SOL)
One-time per account-bound native passkey signer (rent paid by the relayer, never the user):
  PasskeySigner enrollment (${PASSKEY_SIGNER_ACCOUNT_SIZE} bytes)       ${enrollment.toLocaleString("en-US")} lamports (${(enrollment / 1e9).toFixed(6)} SOL)
Key-only native passkeys, PRF passkey registration, recovery kits and added passkeys: off-chain, 0 lamports.`);
