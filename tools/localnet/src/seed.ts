/**
 * Bootstraps a local network end-to-end through the real program and the TypeScript client:
 * protocol initialization, an organization with a recovery key and a verified domain, a publisher
 * member, chained document versions with canonical content, a relayer-gated nonce shard and real
 * user acceptances (Ed25519-signed messages relayed on-chain).
 *
 * Output: `.data/localnet/state.json` (addresses and transaction signatures) and canonical content
 * blobs in `.data/storage/sha256/<hash>` (served by the API's filesystem storage provider).
 *
 *   pnpm --filter @stele/localnet seed            (RPC: STELE_RPC_URL, default http://127.0.0.1:8899)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { type Address, type KeyPairSigner } from "@solana/kit";
import {
  ROLE_PUBLISHER,
  addMemberInstruction,
  attestDomainInstruction,
  buildAcceptanceMessageFromChain,
  buildAcceptanceTransactionMessage,
  buildEd25519Instruction,
  chainIdFromGenesisHash,
  createDocumentInstruction,
  createNonceShardInstruction,
  createOrganizationInstruction,
  createRpc,
  decodeDomainRecord,
  domainHash,
  fetchAccountData,
  findConfigPda,
  findDocumentPda,
  findDomainRecordPda,
  findMemberPda,
  findNonceShardPda,
  findOrganizationPda,
  findProgramDataAddress,
  getClusterUnixTimestamp,
  initializeProtocolInstruction,
  recordAcceptanceInstruction,
  revokeDomainInstruction,
  signSendAndConfirm,
  utf8,
  type SteleRpc,
} from "@stelehq/protocol";
import { PROGRAM, RPC_URL, airdrop, publishVersion, send } from "./chain.js";
import { DATA_DIR, ensureKeypair, signer, type Role } from "./keys.js";
import { ACME_PRIVACY_V1, ACME_TERMS_V1, ACME_TERMS_V2 } from "./sample-content.js";

function publish(
  rpc: SteleRpc,
  publisher: KeyPairSigner,
  membership: Address | null,
  organization: Address,
  document: Address,
  title: string,
  versionLabel: string,
  source: string,
  changeSummary: string | null,
  effectiveAt: number,
) {
  return publishVersion({
    rpc,
    publisher,
    membership,
    organization,
    document,
    title,
    versionLabel,
    source,
    changeSummary,
    effectiveAt,
  });
}

async function accept(
  rpc: SteleRpc,
  relayer: KeyPairSigner,
  user: Role,
  t: { organization: Address; document: Address; version: Address; shard: Address },
  nonceIndex: number,
) {
  const keypair = ensureKeypair(user);
  const userSigner = await signer(user);
  const now = await getClusterUnixTimestamp(rpc);
  const nonceTag = crypto.getRandomValues(new Uint8Array(8));
  const { message } = await buildAcceptanceMessageFromChain({
    rpc,
    programAddress: PROGRAM,
    organization: t.organization,
    document: t.document,
    version: t.version,
    nonceShard: t.shard,
    signer: userSigner.address,
    issuedAt: now,
    expiresAt: now + 600,
    nonceIndex,
    nonceTag,
    requestDomain: "app.acme.example",
    clusterTime: now,
  });
  const signatureBytes = ed25519.sign(utf8(message), keypair.slice(0, 32));
  const [config] = await findConfigPda(PROGRAM);
  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();
  const tx = buildAcceptanceTransactionMessage({
    feePayer: relayer,
    latestBlockhash,
    ed25519Instruction: buildEd25519Instruction(keypair.slice(32), signatureBytes, utf8(message)),
    recordInstruction: recordAcceptanceInstruction({
      programAddress: PROGRAM,
      relayer,
      config,
      organization: t.organization,
      document: t.document,
      version: t.version,
      nonceShard: t.shard,
      nonceIndex,
      nonceTag,
      issuedAt: now,
      expiresAt: now + 600,
    }),
  });
  const signature = await signSendAndConfirm(rpc, tx, { commitment: "confirmed" });
  console.log(`  ${user} accepted (nonce ${nonceIndex}) tx ${signature.slice(0, 16)}…`);
  return { user, signer: userSigner.address, signature, nonceIndex };
}

async function main(): Promise<void> {
  const rpc = createRpc(RPC_URL);
  const admin = await signer("admin");
  const attestor = await signer("attestor");
  const relayer = await signer("relayer");
  const owner = await signer("owner");
  const recovery = await signer("recovery");
  const publisher = await signer("publisher");
  console.log(`RPC ${RPC_URL}, program ${PROGRAM}`);
  for (const s of [admin, attestor, relayer, owner, publisher]) await airdrop(rpc, s.address, 20);

  const genesis = await rpc.getGenesisHash().send();
  const chainId = chainIdFromGenesisHash(genesis);
  const [config] = await findConfigPda(PROGRAM);
  if (!(await fetchAccountData(rpc, config))) {
    const [programData] = await findProgramDataAddress(PROGRAM);
    const sig = await send(rpc, admin, [
      initializeProtocolInstruction({
        programAddress: PROGRAM,
        authority: admin,
        config,
        programData,
        admin: admin.address,
        domainAttestor: attestor.address,
        chainId,
        networkLabel: "Solana Localnet",
      }),
    ]);
    console.log(`initialized protocol (${chainId}) tx ${sig.slice(0, 16)}…`);
  }

  // Organization with a recovery authority.
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const [organization] = await findOrganizationPda(owner.address, seed, PROGRAM);
  await send(rpc, owner, [
    createOrganizationInstruction({
      programAddress: PROGRAM,
      creator: owner,
      payer: owner,
      config,
      organization,
      seed,
      name: "Acme Inc.",
      owner: owner.address,
      recovery: recovery.address,
    }),
  ]);
  console.log(`organization Acme Inc. ${organization}`);

  // Domain attestation (the attestor is normally the API's DNS verification service).
  const now = await getClusterUnixTimestamp(rpc);
  const [domainRecord] = await findDomainRecordPda("acme.example", PROGRAM);
  // Re-seeding the same ledger: move the domain from the previous seed organization (localnet only).
  const previousRecord = await fetchAccountData(rpc, domainRecord);
  if (previousRecord) {
    const previous = decodeDomainRecord(previousRecord);
    await send(rpc, attestor, [
      revokeDomainInstruction({
        programAddress: PROGRAM,
        authority: attestor,
        config,
        organization: previous.organization,
        domainRecord,
        rentPayer: previous.rentPayer,
      }),
    ]);
    console.log(
      `  moved acme.example from the previous seed organization ${previous.organization}`,
    );
  }
  await send(rpc, attestor, [
    attestDomainInstruction({
      programAddress: PROGRAM,
      attestor,
      payer: attestor,
      config,
      organization,
      domainRecord,
      domain: "acme.example",
      domainHash: domainHash("acme.example"),
      expiresAt: now + 365 * 86_400,
    }),
  ]);
  console.log("  verified domain acme.example");

  // Publisher member.
  const [publisherMembership] = await findMemberPda(organization, publisher.address, PROGRAM);
  await send(rpc, owner, [
    addMemberInstruction({
      programAddress: PROGRAM,
      authority: owner,
      authorityMembership: null,
      organization,
      memberAccount: publisherMembership,
      member: publisher.address,
      roles: ROLE_PUBLISHER,
      payer: owner,
    }),
  ]);
  console.log(`  publisher member ${publisher.address}`);

  // Documents.
  const [terms] = await findDocumentPda(organization, "terms-of-service", PROGRAM);
  const [privacy] = await findDocumentPda(organization, "privacy-policy", PROGRAM);
  await send(rpc, owner, [
    createDocumentInstruction({
      programAddress: PROGRAM,
      authority: owner,
      membership: null,
      config,
      organization,
      document: terms,
      payer: owner,
      slug: "terms-of-service",
      documentType: "terms-of-service",
      locale: "en-US",
    }),
    createDocumentInstruction({
      programAddress: PROGRAM,
      authority: owner,
      membership: null,
      config,
      organization,
      document: privacy,
      payer: owner,
      slug: "privacy-policy",
      documentType: "privacy-policy",
      locale: "en-US",
    }),
  ]);

  const termsV1 = await publish(
    rpc,
    owner,
    null,
    organization,
    terms,
    "Terms of Service",
    "1.0",
    ACME_TERMS_V1,
    null,
    0,
  );
  const termsV2 = await publish(
    rpc,
    publisher,
    publisherMembership,
    organization,
    terms,
    "Terms of Service",
    "2.0",
    ACME_TERMS_V2,
    "Added dispute resolution, price-change notice and business-account eligibility.",
    (await getClusterUnixTimestamp(rpc)) + 30 * 86_400,
  );
  const privacyV1 = await publish(
    rpc,
    owner,
    null,
    organization,
    privacy,
    "Privacy Policy",
    "1.0",
    ACME_PRIVACY_V1,
    null,
    0,
  );

  // Relayer-gated nonce shard and acceptances.
  const [shard] = await findNonceShardPda(organization, 0, PROGRAM);
  await send(rpc, owner, [
    createNonceShardInstruction({
      programAddress: PROGRAM,
      authority: owner,
      membership: null,
      config,
      organization,
      nonceShard: shard,
      payer: owner,
      shardId: 0,
      relayer: relayer.address,
    }),
  ]);
  console.log(`  nonce shard 0 ${shard} (relayer ${relayer.address})`);

  const acceptances = [];
  acceptances.push(
    await accept(
      rpc,
      relayer,
      "user-1",
      { organization, document: terms, version: termsV2.address, shard },
      0,
    ),
  );
  acceptances.push(
    await accept(
      rpc,
      relayer,
      "user-2",
      { organization, document: terms, version: termsV2.address, shard },
      1,
    ),
  );
  acceptances.push(
    await accept(
      rpc,
      relayer,
      "user-3",
      { organization, document: privacy, version: privacyV1.address, shard },
      2,
    ),
  );

  const state = {
    rpcUrl: RPC_URL,
    programId: PROGRAM,
    chainId,
    config,
    organization,
    domain: "acme.example",
    publisher: publisher.address,
    owner: owner.address,
    relayer: relayer.address,
    attestor: attestor.address,
    shard,
    documents: {
      terms: { address: terms, versions: [termsV1, termsV2] },
      privacy: { address: privacy, versions: [privacyV1] },
    },
    acceptances,
  };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(resolve(DATA_DIR, "state.json"), JSON.stringify(state, null, 2));
  console.log(`\nwrote ${resolve(DATA_DIR, "state.json")}`);
}

main().catch((e) => {
  console.error(e);
  if (e && typeof e === "object" && "logs" in e)
    console.error((e as { logs: string[] }).logs.join("\n"));
  process.exit(1);
});
