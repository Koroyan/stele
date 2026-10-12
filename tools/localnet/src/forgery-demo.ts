/**
 * Demo step 13 — "an acceptance made by the server, without the user's passkey, is rejected".
 *
 * Given a user's `stele-receipt/2` (native passkey), builds what a malicious operator could try —
 * Stele, the organization, or anyone holding the relayer key — and SIMULATES each attempt on the
 * cluster with the real relayer as fee payer (nothing is signed with any key, nothing is recorded,
 * no fee is paid):
 *
 *   1. a new acceptance claiming the user's key, with a forged signature;
 *   2. the server's own P-256 key signing a perfect WebAuthn assertion, presented under the user's
 *      on-chain enrollment (account-bound users);
 *   3. the user's genuine assertion replayed for another nonce;
 *   4. handing the user's enrollment to a server key without the user's passkey.
 *
 * Every attempt must fail; the program's (or the precompile's) error is printed.
 *
 *   STELE_RPC_URL=https://api.devnet.solana.com pnpm --filter @stele/localnet forgery-demo -- --receipt receipt.json
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { p256 } from "@noble/curves/nist.js";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from "@solana/kit";
import {
  PASSKEY_ACCEPTANCE_TAG,
  PASSKEY_ROTATE_TAG,
  buildPasskeyAcceptanceMessageFromChain,
  buildRotationStatement,
  concatBytes,
  createRpc,
  decodeDocument,
  decodeProtocolConfig,
  describeProgramError,
  fetchAccountData,
  findConfigPda,
  fromBase64Url,
  fromHex,
  getClusterUnixTimestamp,
  parseReceiptV2,
  recordPasskeyAcceptanceInstruction,
  rotatePasskeySignerInstruction,
  secp256r1Instruction,
  sha256,
  toBase64Url,
  utf8,
  webauthnChallenge,
} from "@stelehq/protocol";
import { PROGRAM, RPC_URL } from "./chain.js";

const { values } = parseArgs({
  // `pnpm run x -- --flag` forwards the separator itself.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { receipt: { type: "string" } },
  strict: true,
});
if (!values.receipt) {
  console.error("usage: forgery-demo --receipt <stele-receipt/2 file>");
  process.exit(64);
}
const receipt = parseReceiptV2(JSON.parse(readFileSync(values.receipt, "utf8")));
if (receipt.protocol !== "stele/2" || receipt.signer.type !== "NATIVE_PASSKEY" || !receipt.webauthn)
  throw new Error("needs a native-passkey (stele/2) receipt");
if (receipt.network.programId !== PROGRAM)
  throw new Error(`receipt is for program ${receipt.network.programId}, not ${PROGRAM}`);
const relayer = receipt.fees?.payer;
if (!relayer) throw new Error("the receipt does not name the relayer (fees.payer)");

const rpc = createRpc(RPC_URL);
const [config] = await findConfigPda(PROGRAM);
const cfg = decodeProtocolConfig((await fetchAccountData(rpc, config))!);
const organization = address(receipt.organization.address);
const document = address(receipt.document.address);
const docAccount = decodeDocument((await fetchAccountData(rpc, document))!);
const version = docAccount.currentVersion as Address;
const now = await getClusterUnixTimestamp(rpc);
const userKey = fromHex(receipt.signer.publicKey, 33);
const enrollment = receipt.signer.enrollment ? address(receipt.signer.enrollment.address) : null;
// The nonce shard: the one the user's acceptance used (read from the transaction).
const tx = await rpc
  .getTransaction(receipt.transaction.signature as never, {
    encoding: "json",
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  })
  .send();
const keys = tx!.transaction.message.accountKeys as readonly string[];
const recordIx = tx!.transaction.message.instructions.find(
  (ix) => keys[ix.programIdIndex] === PROGRAM,
)!;
const shard = address(keys[recordIx.accounts[5]!]!);
const rpId = receipt.webauthn.rpId;
const requestDomain = receipt.acceptance.requestDomain;
const origin = requestDomain === "localhost" ? "http://localhost:3000" : `https://${requestDomain}`;

/** A WebAuthn assertion made by a server-held P-256 key over `challenge` (a "perfect" forgery). */
function serverAssertion(secret: Uint8Array, challenge: Uint8Array) {
  const authData = concatBytes(sha256(utf8(rpId)), Uint8Array.of(0x05), new Uint8Array(4));
  const clientData = utf8(
    `{"type":"webauthn.get","challenge":"${toBase64Url(challenge)}","origin":"${origin}","crossOrigin":false}`,
  );
  const signed = concatBytes(authData, sha256(clientData));
  return {
    signed,
    clientData,
    signature: p256.sign(signed, secret, { prehash: true, lowS: true }),
  };
}

const record = (
  nonceIndex: number,
  clientData: Uint8Array,
  withEnrollment: Address | null,
  nonceTag: Uint8Array = crypto.getRandomValues(new Uint8Array(8)),
) =>
  recordPasskeyAcceptanceInstruction({
    programAddress: PROGRAM,
    relayer: address(relayer),
    config,
    organization,
    document,
    version,
    nonceShard: shard,
    enrollment: withEnrollment,
    nonceIndex,
    nonceTag,
    issuedAt: now,
    expiresAt: now + 600,
    assertion: { requestDomain, rpId, clientDataJson: clientData },
  });

/** The program error name, or the runtime error (e.g. a failed precompile verification). */
function describeSimulationError(err: unknown, logs: readonly string[]): string {
  const ix = (err as { InstructionError?: [number, unknown] }).InstructionError;
  const raw = (ix?.[1] as { Custom?: number | bigint } | undefined)?.Custom;
  const custom = raw === undefined ? undefined : Number(raw);
  if (custom !== undefined) {
    const known = describeProgramError(custom);
    if (known) return `instruction ${ix![0]}: ${known.name} — ${known.message}`;
    if (Number(ix![0]) === 0)
      return `instruction 0 (secp256r1 precompile): the signature does not verify (code ${custom})`;
  }
  if (ix)
    return `instruction ${ix[0]}: ${JSON.stringify(ix[1], (_k, v: unknown) => (typeof v === "bigint" ? Number(v) : v))}`;
  const last = logs.filter((l) => /failed|error/i.test(l)).pop();
  return `${JSON.stringify(err, (_k, v: unknown) => (typeof v === "bigint" ? Number(v) : v))}${last ? ` (${last})` : ""}`;
}

async function simulate(label: string, instructions: Instruction[]): Promise<boolean> {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(relayer!), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const wire = getBase64EncodedWireTransaction(compileTransaction(message));
  const { value } = await rpc
    .simulateTransaction(wire, {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
    })
    .send();
  const rejected = value.err !== null;
  const reason = rejected ? describeSimulationError(value.err, value.logs ?? []) : "ACCEPTED";
  console.log(`${rejected ? "✔ rejected" : "✘ ACCEPTED"}  ${label}\n    ${reason.slice(0, 220)}\n`);
  return rejected;
}

console.log(
  `Network ${cfg.networkLabel} (${RPC_URL}), program ${PROGRAM}\nUser's passkey key ${receipt.signer.publicKey}${enrollment ? `, enrollment ${enrollment}` : " (key-only)"}\nSimulated with the real relayer ${relayer} as fee payer — nothing is signed or recorded.\n`,
);
const serverSecret = p256.utils.randomSecretKey();
const serverKey = p256.getPublicKey(serverSecret, true);
const freshNonce = 60_000 + Math.floor(Math.random() * 5_000);
const results: boolean[] = [];

// 1. A forged signature under the user's key.
{
  const forged = serverAssertion(serverSecret, crypto.getRandomValues(new Uint8Array(32)));
  results.push(
    await simulate("1. new acceptance claiming the user's key, forged signature", [
      secp256r1Instruction(userKey, forged.signature, forged.signed),
      record(freshNonce, forged.clientData, enrollment),
    ]),
  );
}
// 2. The server's own key signing the exact message the program will rebuild — a perfect WebAuthn
//    assertion — presented under the user's enrollment (account-bound users).
if (enrollment) {
  const nonceTag = crypto.getRandomValues(new Uint8Array(8));
  const { message } = await buildPasskeyAcceptanceMessageFromChain({
    rpc,
    programAddress: PROGRAM,
    organization,
    document,
    version,
    nonceShard: shard,
    signer: serverKey,
    issuedAt: now,
    expiresAt: now + 600,
    nonceIndex: freshNonce + 1,
    nonceTag,
    requestDomain,
    clusterTime: now,
  });
  const fake = serverAssertion(serverSecret, webauthnChallenge(PASSKEY_ACCEPTANCE_TAG, message));
  results.push(
    await simulate(
      "2. server-held P-256 key, valid signature, presented as the user's enrolled signer",
      [
        secp256r1Instruction(serverKey, fake.signature, fake.signed),
        record(freshNonce + 1, fake.clientData, enrollment, nonceTag),
      ],
    ),
  );
}
// 3. The user's genuine assertion, replayed for another nonce.
{
  const authData = fromBase64Url(receipt.webauthn.authenticatorData);
  const clientData = fromBase64Url(receipt.webauthn.clientDataJSON);
  results.push(
    await simulate("3. the user's real assertion replayed for a new acceptance", [
      secp256r1Instruction(
        userKey,
        fromHex(receipt.webauthn.signature, 64),
        concatBytes(authData, sha256(clientData)),
      ),
      record(freshNonce + 2, clientData, enrollment),
    ]),
  );
}
// 4. Rotating the user's enrollment to a server key without the user's passkey.
if (enrollment) {
  const thirdKey = p256.getPublicKey(p256.utils.randomSecretKey(), true);
  const statement = buildRotationStatement({
    organization,
    accountCommitment: fromHex(receipt.signer.enrollment!.accountCommitment, 32),
    // Signed by the server key: the program names the signing key as the previous signer.
    previous: serverKey,
    next: thirdKey,
    networkLabel: cfg.networkLabel,
    issuedAt: now,
    expiresAt: now + 600,
  });
  const fake = serverAssertion(serverSecret, webauthnChallenge(PASSKEY_ROTATE_TAG, statement));
  results.push(
    await simulate("4. enrollment handed to a server key, signed by the server", [
      secp256r1Instruction(serverKey, fake.signature, fake.signed),
      rotatePasskeySignerInstruction({
        programAddress: PROGRAM,
        relayer: address(relayer),
        config,
        organization,
        enrollment,
        newSigner: thirdKey,
        newCredentialIdHash: new Uint8Array(32),
        issuedAt: now,
        expiresAt: now + 600,
        assertion: { requestDomain, rpId, clientDataJson: fake.clientData },
      }),
    ]),
  );
}
const ok = results.every(Boolean);
console.log(
  ok
    ? "All forgeries were rejected by Solana. (An organization CAN replace a lost passkey through organization recovery — on-chain, signed by its admin wallet, and shown to every verifier as ORGANIZATION_RECOVERY, never as the user's own key.)"
    : "A FORGERY WAS ACCEPTED — investigate before relying on this deployment.",
);
process.exit(ok ? 0 : 1);
