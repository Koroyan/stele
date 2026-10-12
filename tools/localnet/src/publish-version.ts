/**
 * Publishes a new version of an existing document from a Markdown-like file (headings, paragraphs,
 * lists), signed by the organization's owner or a publisher key. LOCALNET and DEVNET only — it
 * refuses Mainnet. The canonical content is stored in .data/storage (the API's filesystem store).
 *
 *   STELE_RPC_URL=https://api.devnet.solana.com pnpm --filter @stele/localnet publish-version -- \
 *     --keypair <owner.json> --document <address> --title "Terms of Service" --label 1.0 \
 *     --file examples/demo-terms/terms-v1.md [--summary "Refund window shortened to 7 days"]
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { address, createKeyPairSignerFromBytes } from "@solana/kit";
import {
  chainIdFromGenesisHash,
  createRpc,
  decodeDocument,
  fetchAccountData,
  findMemberPda,
} from "@stelehq/protocol";
import { PROGRAM, RPC_URL, publishVersion } from "./chain.js";

const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    keypair: { type: "string" },
    document: { type: "string" },
    title: { type: "string" },
    label: { type: "string" },
    file: { type: "string" },
    summary: { type: "string" },
  },
  strict: true,
});
if (!values.keypair || !values.document || !values.title || !values.label || !values.file) {
  console.error(
    "usage: publish-version --keypair <file> --document <address> --title <title> --label <label> --file <source> [--summary <text>]",
  );
  process.exit(64);
}
const rpc = createRpc(RPC_URL);
const genesis = await rpc.getGenesisHash().send();
if (chainIdFromGenesisHash(genesis) === MAINNET) {
  console.error("refusing to publish on Mainnet with a file-based key");
  process.exit(1);
}
const publisher = await createKeyPairSignerFromBytes(
  Uint8Array.from(JSON.parse(readFileSync(values.keypair, "utf8")) as number[]),
);
const document = address(values.document);
const doc = decodeDocument((await fetchAccountData(rpc, document))!);
const organization = address(doc.organization);
const [memberPda] = await findMemberPda(organization, publisher.address, PROGRAM);
const membership = (await fetchAccountData(rpc, memberPda)) ? memberPda : null;
const published = await publishVersion({
  rpc,
  publisher,
  membership,
  organization,
  document,
  title: values.title,
  versionLabel: values.label,
  source: readFileSync(values.file, "utf8"),
  changeSummary: values.summary ?? null,
});
console.log(JSON.stringify({ organization, document, ...published }, null, 2));
