/**
 * End-to-end check of Stele Gate through the live-demo API — every step a real transaction on the
 * API's cluster (localnet or devnet), against the Atlas vault demo program:
 *
 *   deposit before accepting → rejected · accept v1 (recorded in the investor's passport) → deposit
 *   allowed · admin publishes and requires v2 → deposit rejected (outdated) · accept v2 → deposit
 *   allowed · someone else's passport → rejected · no passport → rejected · Proof receipt of the
 *   acceptance is available
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
  depositWithPassportInstruction,
  findPassportPda,
  toBase58,
  utf8,
} from "@stelehq/protocol";

const API = (process.env.STELE_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const ORIGIN = process.env.STELE_ORIGIN ?? "http://localhost:3000";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok)
    throw new Error(
      `${method} ${path} → ${res.status}: ${json.error?.message ?? JSON.stringify(json)}`,
    );
  return json;
}

const status = await call<{
  available: boolean;
  reason: string | null;
  relayer: string;
  network: { label: string };
}>("GET", "/v1/demo");
if (!status.available) throw new Error(`demo unavailable: ${status.reason}`);
const network = await call<{ publicRpcUrls?: string[] }>("GET", "/v1/network");
const rpc = createRpc(
  process.env.STELE_RPC_URL ?? network.publicRpcUrls?.[0] ?? "http://127.0.0.1:8899",
);
console.log(`live demo on ${status.network.label}`);

const session = await call<{
  token: string;
  organization: string;
  document: string;
  documentSlug: string;
  policy: string;
  vault: string;
}>("POST", "/v1/demo/sessions", { kind: "gate" });
console.log(`policy ${session.policy}, vault ${session.vault}`);
const policy = address(session.policy);
const vault = address(session.vault);

async function accept(wallet: KeyPairSigner) {
  const ch = await call<{ challengeId: string; clientBinding: string; message: string }>(
    "POST",
    "/v1/acceptance/challenges",
    { organization: session.organization, document: session.document, signer: wallet.address },
  );
  const [signatures] = await wallet.signMessages([{ content: utf8(ch.message), signatures: {} }]);
  const signature = toBase58(new Uint8Array(signatures![wallet.address]!));
  return call<{ transactionSignature: string; acceptanceId: string }>(
    "POST",
    `/v1/acceptance/challenges/${ch.challengeId}/submit`,
    { clientBinding: ch.clientBinding, signature },
  );
}

async function access(holder: Address) {
  return call<{
    status: string;
    requiredVersion: number;
    storage: "passport" | "pass" | null;
    passportEntry: { versionNumber: number } | null;
    pass: { versionNumber: number } | null;
  }>("GET", `/v1/public/gate/access?policy=${policy}&holder=${holder}`);
}

async function deposit(investor: KeyPairSigner, passOwner: Address) {
  const [passport] = await findPassportPda(passOwner);
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(status.relayer), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          depositWithPassportInstruction({
            investor: investor.address,
            vault,
            policy,
            passport,
            amount: 5_000_000_000n,
          }),
        ],
        m,
      ),
  );
  const tx = await partiallySignTransaction([investor.keyPair], compileTransaction(message));
  return call<{ ok: boolean; signature: string; failure: { name: string } | null }>(
    "POST",
    "/v1/demo/sessions/deposit",
    { token: session.token, transaction: getBase64EncodedWireTransaction(tx) },
  );
}

let failures = 0;
function expect(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "✔" : "✘"} ${label} — ${detail}`);
  if (!ok) failures++;
}

const investor = await generateKeyPairSigner();
const mallory = await generateKeyPairSigner();

let r = await deposit(investor, investor.address);
expect("deposit before accepting (direct call)", !r.ok, r.failure?.name ?? "ALLOWED");

const first = await accept(investor);
let a = await access(investor.address);
expect(
  "passport entry after accepting v1",
  a.status === "VALID" && a.storage === "passport" && a.passportEntry?.versionNumber === 1,
  `${a.status} in ${a.storage} v${a.passportEntry?.versionNumber}`,
);
r = await deposit(investor, investor.address);
expect(
  "deposit with the v1 entry",
  r.ok,
  r.ok ? `allowed (tx ${r.signature.slice(0, 12)}…)` : r.failure!.name,
);

await call("POST", "/v1/demo/sessions/publish", { token: session.token });
a = await access(investor.address);
expect(
  "admin publishes and requires v2",
  a.status === "OUTDATED" && a.requiredVersion === 2,
  `${a.status}, requires v${a.requiredVersion}`,
);
r = await deposit(investor, investor.address);
expect("deposit with the outdated v1 entry", !r.ok, r.failure?.name ?? "ALLOWED");

await accept(investor);
r = await deposit(investor, investor.address);
expect("deposit after accepting v2", r.ok, r.ok ? "allowed" : r.failure!.name);

r = await deposit(mallory, investor.address);
expect("direct call with someone else's passport", !r.ok, r.failure?.name ?? "ALLOWED");
r = await deposit(mallory, mallory.address);
expect("direct call without a passport", !r.ok, r.failure?.name ?? "ALLOWED");

const receipt = await call<{ receipt: { acceptance?: { acceptanceId?: string } } }>(
  "GET",
  `/v1/public/acceptances/${first.acceptanceId}/receipt`,
);
expect(
  "Proof receipt of the v1 acceptance",
  !!receipt.receipt,
  `acceptance ${first.acceptanceId.slice(0, 12)}…`,
);

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all Gate checks passed");
