/**
 * LOCALNET ONLY: marks a domain as verified for an organization without a DNS check, using the
 * throwaway local attestor key. Use it to see the "verified" experience while developing, with a
 * domain you cannot (or need not) put a DNS record on, such as `mycompany.test`.
 *
 *   pnpm localnet:attest-domain <organization address> <domain>
 *
 * On real networks domains are verified only through the dashboard's DNS check; this script refuses
 * to run against Mainnet, Devnet or Testnet, and their attestor keys are not available here anyway.
 */
import { address } from "@solana/kit";
import {
  DEFAULT_PROGRAM_ADDRESS,
  attestDomainInstruction,
  chainIdFromGenesisHash,
  createRpc,
  decodeOrganization,
  domainHash,
  fetchAccountData,
  findConfigPda,
  findDomainRecordPda,
  getClusterUnixTimestamp,
  signSendAndConfirm,
  validateVerifiedDomain,
} from "@stele/protocol";
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { signer } from "./keys.js";

const PUBLIC_NETWORKS = new Set([
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", // mainnet
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", // devnet
  "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z", // testnet
]);

const [orgArg, domainArg] = process.argv.slice(2);
if (!orgArg || !domainArg) {
  console.error("usage: pnpm localnet:attest-domain <organization address> <domain>");
  console.error("example: pnpm localnet:attest-domain EPcUwNS7…XxN mycompany.test");
  process.exit(64);
}
const domain = domainArg.trim().toLowerCase();
try {
  validateVerifiedDomain(domain);
} catch (e) {
  console.error(`Invalid domain "${domain}": ${e instanceof Error ? e.message : String(e)}`);
  process.exit(64);
}

const rpc = createRpc(process.env.STELE_RPC_URL ?? "http://127.0.0.1:8899");
const program = address(process.env.STELE_PROGRAM_ID ?? DEFAULT_PROGRAM_ADDRESS);
const chainId = chainIdFromGenesisHash(await rpc.getGenesisHash().send());
if (PUBLIC_NETWORKS.has(chainId)) {
  console.error(`Refusing: ${chainId} is a public network. Verify domains with the DNS check.`);
  process.exit(1);
}

const organization = address(orgArg);
const data = await fetchAccountData(rpc, organization);
if (!data) {
  console.error(`No organization account at ${organization} on this network.`);
  process.exit(1);
}
const org = decodeOrganization(data);
if (org.verifiedDomain) {
  console.error(`${org.name} already has a verified domain (${org.verifiedDomain}).`);
  process.exit(1);
}

const attestor = await signer("attestor");
const [config] = await findConfigPda(program);
const [domainRecord] = await findDomainRecordPda(domain, program);
const now = await getClusterUnixTimestamp(rpc);
const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
const message = pipe(
  createTransactionMessage({ version: 0 }),
  (m) => setTransactionMessageFeePayerSigner(attestor, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
  (m) =>
    appendTransactionMessageInstructions(
      [
        attestDomainInstruction({
          programAddress: program,
          attestor,
          payer: attestor,
          config,
          organization,
          domainRecord,
          domain,
          domainHash: domainHash(domain),
          expiresAt: now + 365 * 86_400,
        }),
      ],
      m,
    ),
);
const signature = await signSendAndConfirm(rpc, message, { commitment: "confirmed" });
console.log(`${org.name} is now verified as ${domain} on this local network (expires in 1 year).`);
console.log(`transaction ${signature}`);
console.log("The dashboard picks it up within a few seconds (reload the Organization page).");
