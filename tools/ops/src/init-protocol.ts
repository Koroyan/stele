/**
 * Initializes the Stele protocol configuration on a cluster (devnet, mainnet, or a local validator).
 *
 *   pnpm --filter @stele/ops init-protocol -- \
 *     --rpc https://api.devnet.solana.com --label "Solana Devnet" \
 *     --admin <protocol admin (multisig vault)> --attestor <domain attestor key> \
 *     --authority <upgrade authority keypair file> [--program <id>] [--yes]
 *
 *   # Upgrade authority held by a multisig: print the instruction to propose instead of signing.
 *   pnpm --filter @stele/ops init-protocol -- --rpc … --label … --admin … --attestor … \
 *     --authority-address <multisig vault> --print-instruction
 *
 * The chain ID is derived from the RPC's genesis hash and the network label is fixed forever: both
 * are committed into every fingerprint and acceptance message. Without --yes nothing is sent.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  isAddress,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";
import {
  DEFAULT_PROGRAM_ADDRESS,
  chainIdFromGenesisHash,
  createRpc,
  fetchAccountData,
  findConfigPda,
  findProgramDataAddress,
  initializeProtocolInstruction,
  signSendAndConfirm,
  toBase58,
  toHex,
  validateNetworkLabel,
} from "@stele/protocol";

const { values } = parseArgs({
  options: {
    rpc: { type: "string" },
    label: { type: "string" },
    admin: { type: "string" },
    attestor: { type: "string" },
    authority: { type: "string" },
    "authority-address": { type: "string" },
    program: { type: "string" },
    "print-instruction": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
  },
  strict: true,
});

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

const rpcUrl = values.rpc ?? fail("--rpc is required");
const label = values.label ?? fail('--label is required (for example "Solana Devnet")');
try {
  validateNetworkLabel(label);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
const admin = values.admin ?? fail("--admin is required");
const attestor = values.attestor ?? fail("--attestor is required");
for (const [name, value] of [
  ["--admin", admin],
  ["--attestor", attestor],
] as const) {
  if (!isAddress(value)) fail(`${name} is not a valid address`);
}
if (admin === attestor) fail("the protocol admin and the domain attestor must be different keys");
const program = address(values.program ?? DEFAULT_PROGRAM_ADDRESS);

const rpc = createRpc(rpcUrl);
const genesis = await rpc.getGenesisHash().send();
const chainId = chainIdFromGenesisHash(genesis);
const [config] = await findConfigPda(program);
const [programData] = await findProgramDataAddress(program);

if (await fetchAccountData(rpc, config))
  fail(`the protocol is already initialized (config ${config})`);

// ProgramData: u32 tag (3) | u64 slot | Option<Pubkey> upgrade authority.
const pd = await fetchAccountData(rpc, programData);
if (!pd || pd.length < 45)
  fail(`program ${program} is not deployed as an upgradeable program on this cluster`);
const upgradeAuthority = pd[12] === 1 ? (toBase58(pd.subarray(13, 45)) as Address) : null;
if (!upgradeAuthority)
  fail("the program has no upgrade authority; initialize_protocol requires it");

console.log(`cluster genesis   ${genesis}`);
console.log(`chain id          ${chainId}   (committed into every fingerprint)`);
console.log(`network label     ${label}   (shown in every acceptance message; immutable)`);
console.log(`program           ${program}`);
console.log(`upgrade authority ${upgradeAuthority}`);
console.log(`protocol admin    ${admin}`);
console.log(`domain attestor   ${attestor}`);

if (values["print-instruction"]) {
  const authority = values["authority-address"] ?? upgradeAuthority;
  if (authority !== upgradeAuthority)
    fail(`--authority-address must be the upgrade authority ${upgradeAuthority}`);
  const ix = initializeProtocolInstruction({
    programAddress: program,
    authority: address(authority),
    config,
    programData,
    admin: address(admin),
    domainAttestor: address(attestor),
    chainId,
    networkLabel: label,
  });
  console.log(
    "\nPropose this instruction from the upgrade authority (e.g. as a multisig custom transaction):",
  );
  console.log(`program id  ${ix.programAddress}`);
  ix.accounts?.forEach((a, i) => console.log(`account ${i}   ${a.address}  role=${a.role}`));
  console.log(`data (hex)  ${toHex(new Uint8Array(ix.data ?? []))}`);
  process.exit(0);
}

const keypairPath =
  values.authority ?? fail("--authority <keypair file> is required (or use --print-instruction)");
const signer = await createKeyPairSignerFromBytes(
  Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")) as number[]),
);
if (signer.address !== upgradeAuthority)
  fail(`${keypairPath} is ${signer.address}, not the upgrade authority ${upgradeAuthority}`);

if (!values.yes) {
  console.log("\nDry run. Re-run with --yes to send initialize_protocol.");
  process.exit(0);
}

const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
const message = pipe(
  createTransactionMessage({ version: 0 }),
  (m) => setTransactionMessageFeePayerSigner(signer, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
  (m) =>
    appendTransactionMessageInstructions(
      [
        initializeProtocolInstruction({
          programAddress: program,
          authority: signer,
          config,
          programData,
          admin: address(admin),
          domainAttestor: address(attestor),
          chainId,
          networkLabel: label,
        }),
      ],
      m,
    ),
);
const signature = await signSendAndConfirm(rpc, message, { commitment: "finalized" });
console.log(`\ninitialized: config ${config}, transaction ${signature}`);
