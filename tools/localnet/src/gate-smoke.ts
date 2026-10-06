/**
 * End-to-end check of Stele Gate through the live-demo API — every step a real transaction on the
 * API's cluster (localnet or devnet):
 *
 *   accept v1 → bet allowed → publish v2 → bet rejected (outdated) → accept v2 → bet allowed →
 *   someone else's pass rejected → no pass rejected — in check mode and in strict (CPI) mode.
 *
 *   STELE_API_URL=http://localhost:4000 pnpm --filter @stele/localnet gate-smoke
 */
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import {
  createRpc,
  findAccessPassPda,
  findMarketPda,
  placeBetInstruction,
  toBase58,
  utf8,
} from "@stele/protocol";

const API = (process.env.STELE_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const ORIGIN = process.env.STELE_ORIGIN ?? "http://localhost:3000";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as T & { message?: string };
  if (!res.ok)
    throw new Error(`${method} ${path} → ${res.status}: ${json.message ?? JSON.stringify(json)}`);
  return json;
}

const status = await call<{
  available: boolean;
  reason: string | null;
  relayer: string;
  network: { label: string };
}>("GET", "/v1/demo");
if (!status.available) throw new Error(`demo unavailable: ${status.reason}`);
const rpcUrl = (await call<{ rpcUrls?: string[]; publicRpcUrls?: string[] }>(
  "GET",
  "/v1/network",
)) as {
  publicRpcUrls?: string[];
  rpcUrls?: string[];
};
const rpc = createRpc(
  process.env.STELE_RPC_URL ??
    rpcUrl.publicRpcUrls?.[0] ??
    rpcUrl.rpcUrls?.[0] ??
    "http://127.0.0.1:8899",
);
console.log(`live demo on ${status.network.label}`);

const session = await call<{
  token: string;
  organization: string;
  document: string;
  market: string;
  version: { number: number; signature: string };
}>("POST", "/v1/demo/sessions", { kind: "gate" });
console.log(`session: policy document ${session.document}, market ${session.market}`);
const document = address(session.document);
const [market] = await findMarketPda(document);
if (market !== session.market) throw new Error("market address mismatch");

async function accept(wallet: KeyPairSigner): Promise<string> {
  const ch = await call<{ challengeId: string; clientBinding: string; message: string }>(
    "POST",
    "/v1/acceptance/challenges",
    { organization: session.organization, document: session.document, signer: wallet.address },
  );
  const [signatures] = await wallet.signMessages([{ content: utf8(ch.message), signatures: {} }]);
  const signature = toBase58(new Uint8Array(signatures![wallet.address]!));
  const res = await call<{ transactionSignature: string; acceptanceId: string }>(
    "POST",
    `/v1/acceptance/challenges/${ch.challengeId}/submit`,
    { clientBinding: ch.clientBinding, signature },
  );
  return res.transactionSignature;
}

async function access(holder: Address) {
  return call<{
    status: string;
    pass: { versionNumber: number } | null;
    currentVersion: { number: number };
  }>("GET", `/v1/public/gate/access?document=${session.document}&holder=${holder}`);
}

async function bet(bettor: KeyPairSigner, pass: Address, strict: boolean) {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(status.relayer), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          placeBetInstruction({
            bettor: bettor.address,
            market,
            policyDocument: document,
            accessPass: pass,
            side: 1,
            stake: 10,
            strict,
          }),
        ],
        m,
      ),
  );
  const tx = await partiallySignTransaction([bettor.keyPair], compileTransaction(message));
  return call<{ ok: boolean; signature: string; failure: { name: string } | null }>(
    "POST",
    "/v1/demo/sessions/bet",
    { token: session.token, transaction: getBase64EncodedWireTransaction(tx) },
  );
}

let failures = 0;
function expect(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "✔" : "✘"} ${label} — ${detail}`);
  if (!ok) failures++;
}

const alice = await generateKeyPairSigner();
const mallory = await generateKeyPairSigner();
const [alicePass] = await findAccessPassPda(document, alice.address);
const [malloryPass] = await findAccessPassPda(document, mallory.address);

for (const strict of [false, true]) {
  const mode = strict ? "strict (CPI)" : "check";
  if (strict) {
    // Fresh state for the second round: publish another version, both passes become outdated.
    await call("POST", "/v1/demo/sessions/publish", { token: session.token });
  }
  let r = await bet(alice, alicePass, strict);
  expect(`[${mode}] bet before accepting`, !r.ok, r.failure?.name ?? "ALLOWED");

  const acceptTx = await accept(alice);
  const a1 = await access(alice.address);
  expect(
    `[${mode}] access after accepting`,
    a1.status === "VALID",
    `${a1.status} (tx ${acceptTx.slice(0, 12)}…)`,
  );
  r = await bet(alice, alicePass, strict);
  expect(
    `[${mode}] bet with a current pass`,
    r.ok,
    r.ok ? `allowed (tx ${r.signature.slice(0, 12)}…)` : r.failure!.name,
  );

  await call("POST", "/v1/demo/sessions/publish", { token: session.token });
  const a2 = await access(alice.address);
  expect(`[${mode}] access after a new version`, a2.status === "OUTDATED", a2.status);
  r = await bet(alice, alicePass, strict);
  expect(`[${mode}] bet with an outdated pass`, !r.ok, r.failure?.name ?? "ALLOWED");

  await accept(alice);
  r = await bet(alice, alicePass, strict);
  expect(`[${mode}] bet after accepting the new version`, r.ok, r.ok ? "allowed" : r.failure!.name);

  r = await bet(mallory, alicePass, strict);
  expect(`[${mode}] direct bypass with someone else's pass`, !r.ok, r.failure?.name ?? "ALLOWED");
  r = await bet(mallory, malloryPass, strict);
  expect(`[${mode}] direct bypass without a pass`, !r.ok, r.failure?.name ?? "ALLOWED");
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all Gate checks passed");
