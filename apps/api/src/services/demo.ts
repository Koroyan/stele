/**
 * The public live demo (devnet and localnet only; refused on mainnet by config). Every interaction is
 * a real transaction on the configured cluster — nothing is mocked:
 *
 * * a session creates its own policy document under the operator's demo organization (so publishing
 *   v2 in one browser never changes another visitor's), publishes v1 and — for Gate — opens the demo
 *   market that requires it;
 * * the visitor accepts through the ordinary acceptance API with an in-browser demo wallet, which
 *   creates the on-chain access pass;
 * * bets are signed by that demo wallet and relayed with the relayer as fee payer, after a strict
 *   shape check; failing bets are submitted too (skipPreflight) so the rejection is recorded
 *   on-chain and can be opened in an explorer.
 *
 * Budgets cap sessions per day and per IP address; the demo organization's key never signs
 * anything a visitor supplies.
 */
import {
  address,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
  type Address,
  type KeyPairSigner,
  type Transaction,
} from "@solana/kit";
import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from "@solana-program/compute-budget";
import {
  GATE_DEMO_PROGRAM_ADDRESS,
  authoringInput,
  canonicalizeContent,
  confirmSignature,
  createDocumentInstruction,
  createMarketInstruction,
  decodeBetPlacedFromLogs,
  findConfigPda,
  findDocumentPda,
  findMarketPda,
  fromBase64,
  identifyInstruction,
  preparePublication,
  publishVersionInstruction,
  fromBase58,
  toHex,
  verifyEd25519,
  anchorDiscriminator,
  bytesEqual,
} from "@stele/protocol";
import { decodeWireTransaction } from "@stele/verifier";
import {
  and,
  contentObjects,
  demoSessions,
  documents,
  documentVersions,
  eq,
  gt,
  organizations,
  sql,
} from "@stele/db";
import type { Deps } from "../deps.js";
import { ApiError, badRequest, notFound } from "../errors.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";
import { loadSigner } from "../lib/keys.js";
import { syncDocument } from "../lib/sync.js";
import { explainFailure, type GateFailure } from "./gate.js";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_VERSIONS_PER_SESSION = 5;
const MAX_ACTIONS_PER_SESSION = 40;

type Kind = "gate" | "proof";

/** Demo texts: short, readable, and honest that this is a demo on a test network. */
const TEXTS: Record<
  Kind,
  { title: string; documentType: string; versions: { source: string; summary: string | null }[] }
> = {
  gate: {
    title: "Risk Disclosure",
    documentType: "disclaimer",
    versions: [
      {
        source: `# Risk Disclosure

Prediction markets are risky. You can lose the full amount you stake.

## Before you bet
- Markets can be illiquid: you may not be able to exit a position.
- Outcomes are resolved by each market's rules, which can be disputed.
- Nothing on this site is investment advice.

This is a Stele Gate demo on a Solana test network. No real funds are used.`,
        summary: null,
      },
      {
        source: `# Risk Disclosure

Prediction markets are risky. You can lose the full amount you stake.

## Before you bet
- Markets can be illiquid: you may not be able to exit a position.
- Outcomes are resolved by each market's rules, which can be disputed.
- Nothing on this site is investment advice.
- New: markets may be unavailable in your jurisdiction. You confirm that you are allowed to take part where you live.

This is a Stele Gate demo on a Solana test network. No real funds are used.`,
        summary: "Adds a jurisdiction confirmation.",
      },
    ],
  },
  proof: {
    title: "Terms of Service",
    documentType: "terms-of-service",
    versions: [
      {
        source: `# Terms of Service

## Returns
You can return any item within **30 days** of delivery for a full refund.

## Payment
Prices include VAT. We charge your card when your order ships.

This is a Stele Proof demo on a Solana test network.`,
        summary: null,
      },
      {
        source: `# Terms of Service

## Returns
You can return any item within **7 days** of delivery for a full refund.

## Payment
Prices include VAT. We charge your card when your order ships.

This is a Stele Proof demo on a Solana test network.`,
        summary: "Return window shortened from 30 to 7 days.",
      },
    ],
  },
};

function versionText(kind: Kind, n: number) {
  const list = TEXTS[kind].versions;
  if (n <= list.length) return list[n - 1]!;
  const last = list[list.length - 1]!;
  return {
    source: `${last.source}\n\nRevision ${n}: minor wording update.`,
    summary: `Revision ${n}.`,
  };
}

let ownerSigner: Promise<KeyPairSigner> | null = null;

function demoConfigured(deps: Deps): { ok: true } | { ok: false; reason: string } {
  if (deps.config.SOLANA_CLUSTER === "mainnet")
    return { ok: false, reason: "The live demo runs on test networks only." };
  if (!deps.config.STELE_DEMO_OWNER_KEYPAIR || !deps.config.STELE_DEMO_ORGANIZATION)
    return { ok: false, reason: "The live demo is not configured on this deployment." };
  return { ok: true };
}

async function owner(deps: Deps): Promise<KeyPairSigner> {
  ownerSigner ??= loadSigner(deps.config.STELE_DEMO_OWNER_KEYPAIR!);
  return ownerSigner;
}

async function demoOrganization(deps: Deps) {
  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.address, deps.config.STELE_DEMO_ORGANIZATION!));
  if (!org) throw new ApiError(503, "demo_unavailable", "The demo organization is not indexed yet");
  return org;
}

async function sessionsToday(deps: Deps, ipHash?: string) {
  const since = new Date(Date.now() - SESSION_TTL_MS);
  const conds = [gt(demoSessions.createdAt, since)];
  if (ipHash) conds.push(eq(demoSessions.ipHash, ipHash));
  const [{ n } = { n: 0 }] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(demoSessions)
    .where(and(...conds));
  return n;
}

export async function demoStatus(deps: Deps) {
  const configured = demoConfigured(deps);
  const used = configured.ok ? await sessionsToday(deps) : 0;
  const available = configured.ok && used < deps.config.STELE_DEMO_DAILY_SESSIONS;
  return {
    available,
    reason: !configured.ok
      ? configured.reason
      : available
        ? null
        : "Today's live-demo budget is used up. It resets within 24 hours.",
    network: { label: deps.config.network.label, cluster: deps.config.SOLANA_CLUSTER },
    organization: deps.config.STELE_DEMO_ORGANIZATION ?? null,
    relayer: deps.chain.relayer.address as string,
    steleProgram: deps.chain.programAddress as string,
    gateProgram: GATE_DEMO_PROGRAM_ADDRESS as string,
    explorerCluster: deps.config.network.explorerCluster,
  };
}

async function publishNext(
  deps: Deps,
  kind: Kind,
  organization: Address,
  document: Address,
  n: number,
) {
  const signer = await owner(deps);
  const text = versionText(kind, n);
  const content = canonicalizeContent(authoringInput(text.source, text.summary));
  const prepared = await preparePublication({
    rpc: deps.chain.rpc,
    programAddress: deps.chain.programAddress,
    organization,
    document,
    title: TEXTS[kind].title,
    versionLabel: `${n}.0`,
    effectiveAt: 0,
    content,
  });
  const stored = await deps.storage.put(prepared.contentBytes);
  await deps.db
    .insert(contentObjects)
    .values({
      contentHash: stored.contentHash,
      byteSize: prepared.contentBytes.length,
      cid: stored.cid,
      locations: [{ ...stored.location, storedAt: new Date().toISOString() }],
    })
    .onConflictDoNothing();
  const [config] = await findConfigPda(deps.chain.programAddress);
  const signature = await deps.chain.send(signer, [
    publishVersionInstruction({
      programAddress: deps.chain.programAddress,
      authority: signer,
      membership: null,
      config,
      organization,
      document,
      versionAccount: prepared.versionAccount,
      payer: signer,
      version: prepared.versionNumber,
      previousVersionHash: prepared.previousVersionHash,
      contentHash: prepared.contentHash,
      title: TEXTS[kind].title,
      versionLabel: `${n}.0`,
      effectiveAt: 0,
      storageUri: prepared.storageUri,
      expectedVersionHash: prepared.versionHash,
    }),
  ]);
  await syncDocument(deps.db, deps.chain, document);
  return {
    address: prepared.versionAccount as string,
    number: prepared.versionNumber,
    fingerprint: toHex(prepared.versionHash),
    signature,
  };
}

export async function createDemoSession(deps: Deps, i: { kind: Kind; ipHash: string }) {
  const configured = demoConfigured(deps);
  if (!configured.ok) throw new ApiError(503, "demo_unavailable", configured.reason);
  if ((await sessionsToday(deps)) >= deps.config.STELE_DEMO_DAILY_SESSIONS)
    throw new ApiError(429, "demo_budget_exhausted", "Today's live-demo budget is used up");
  if ((await sessionsToday(deps, i.ipHash)) >= deps.config.STELE_DEMO_SESSIONS_PER_IP)
    throw new ApiError(429, "demo_rate_limited", "Too many demo sessions from this network today");

  const org = await demoOrganization(deps);
  const signer = await owner(deps);
  const organization = address(org.address);
  const slug = `${i.kind === "gate" ? "risk" : "terms"}-${toHex(crypto.getRandomValues(new Uint8Array(6)))}`;
  const [document] = await findDocumentPda(organization, slug, deps.chain.programAddress);
  const [config] = await findConfigPda(deps.chain.programAddress);
  const created = await deps.chain.send(signer, [
    createDocumentInstruction({
      programAddress: deps.chain.programAddress,
      authority: signer,
      membership: null,
      config,
      organization,
      document,
      payer: signer,
      slug,
      documentType: TEXTS[i.kind].documentType,
      locale: "en-US",
    }),
  ]);
  const v1 = await publishNext(deps, i.kind, organization, document, 1);
  const synced = await syncDocument(deps.db, deps.chain, document);
  if (!synced) throw new ApiError(502, "demo_failed", "The demo document could not be indexed");
  let market: Address | null = null;
  if (i.kind === "gate") {
    await deps.db.update(documents).set({ gated: true }).where(eq(documents.id, synced.id));
    [market] = await findMarketPda(document);
    await deps.chain.send(signer, [
      createMarketInstruction({
        creator: signer.address,
        policyDocument: document,
        market,
        question: "Will Stele Gate block a direct bypass?",
      }),
    ]);
  }
  const token = randomToken(32);
  await deps.db.insert(demoSessions).values({
    tokenHash: sha256Hex(token),
    kind: i.kind,
    documentId: synced.id,
    marketAddress: market,
    ipHash: i.ipHash,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return {
    token,
    kind: i.kind,
    organization: org.address,
    document,
    documentSlug: slug,
    market,
    version: v1,
    transactions: { createDocument: created, publish: v1.signature },
  };
}

async function session(deps: Deps, token: string) {
  const [row] = await deps.db
    .select({ s: demoSessions, d: documents })
    .from(demoSessions)
    .innerJoin(documents, eq(documents.id, demoSessions.documentId))
    .where(
      and(eq(demoSessions.tokenHash, sha256Hex(token)), gt(demoSessions.expiresAt, new Date())),
    );
  if (!row) throw notFound("Demo session");
  return row;
}

export async function demoSessionState(deps: Deps, token: string) {
  const { s, d } = await session(deps, token);
  const versions = await deps.db
    .select({
      address: documentVersions.address,
      number: documentVersions.number,
      label: documentVersions.versionLabel,
      title: documentVersions.title,
      fingerprint: documentVersions.versionHash,
      publishedAt: documentVersions.publishedAt,
    })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, d.id))
    .orderBy(documentVersions.number);
  return {
    kind: s.kind as Kind,
    organization: deps.config.STELE_DEMO_ORGANIZATION!,
    document: d.address,
    documentSlug: d.slug,
    market: s.marketAddress,
    currentVersion: d.currentVersionAddress,
    versions,
    publishesLeft: MAX_VERSIONS_PER_SESSION - s.publishCount,
    actionsLeft: MAX_ACTIONS_PER_SESSION - s.actionCount,
  };
}

export async function publishDemoVersion(deps: Deps, token: string) {
  const { s, d } = await session(deps, token);
  if (s.publishCount >= MAX_VERSIONS_PER_SESSION)
    throw new ApiError(429, "demo_limit", "This demo session cannot publish more versions");
  const [claimed] = await deps.db
    .update(demoSessions)
    .set({ publishCount: sql`${demoSessions.publishCount} + 1` })
    .where(and(eq(demoSessions.id, s.id), eq(demoSessions.publishCount, s.publishCount)))
    .returning({ n: demoSessions.publishCount });
  if (!claimed) throw new ApiError(409, "demo_busy", "Another publication is in progress");
  return publishNext(
    deps,
    s.kind as Kind,
    address(deps.config.STELE_DEMO_ORGANIZATION!),
    address(d.address),
    d.versionCount + 1,
  );
}

const BET_NAMES = new Set(["place_bet", "place_bet_strict"]);
const MAX_DEMO_COMPUTE_UNITS = 60_000;

/**
 * Relays a bet the visitor's demo wallet signed. The relayer pays the fee and signs nothing else:
 * the transaction must be exactly [compute budget?] [one Gate demo bet] for this session's market.
 */
export async function relayDemoBet(deps: Deps, token: string, wireBase64: string) {
  const { s, d } = await session(deps, token);
  if (s.kind !== "gate" || !s.marketAddress)
    throw badRequest("not_a_gate_session", "Not a Gate demo session");
  if (s.actionCount >= MAX_ACTIONS_PER_SESSION)
    throw new ApiError(429, "demo_limit", "This demo session has used its transactions");

  let tx: Transaction;
  let decoded: ReturnType<typeof decodeWireTransaction>;
  try {
    const bytes = fromBase64(wireBase64);
    tx = getTransactionDecoder().decode(bytes);
    decoded = decodeWireTransaction(new Uint8Array(bytes));
  } catch {
    throw badRequest("invalid_transaction", "Not a Solana transaction");
  }
  const relayer = deps.chain.relayer.address;
  const fail = (why: string): never => {
    throw badRequest("transaction_refused", `refusing to relay: ${why}`);
  };
  if (decoded.accountKeys[0] !== relayer) fail("the fee payer must be the Stele relayer");
  if (decoded.numRequiredSignatures !== 2)
    fail("expected exactly the relayer and the bettor as signers");
  const bettor = decoded.accountKeys[1]!;
  if (bettor === relayer) fail("the relayer cannot be the bettor");
  const ixs = decoded.instructions;
  const bet = ixs[ixs.length - 1];
  if (!bet || bet.programId !== GATE_DEMO_PROGRAM_ADDRESS)
    fail("the last instruction must be a Gate demo bet");
  const name = bytesEqual(bet!.data.subarray(0, 8), anchorDiscriminator("global", "place_bet"))
    ? "place_bet"
    : bytesEqual(bet!.data.subarray(0, 8), anchorDiscriminator("global", "place_bet_strict"))
      ? "place_bet_strict"
      : null;
  if (!name || !BET_NAMES.has(name)) fail("only place_bet and place_bet_strict are relayed");
  if (
    bet!.accounts[0] !== bettor ||
    bet!.accounts[1] !== s.marketAddress ||
    bet!.accounts[2] !== d.address
  )
    fail("the bet must be the signer's, on this session's market and policy");
  if (bet!.accounts.includes(relayer)) fail("the relayer cannot appear in the bet");
  for (const ix of ixs.slice(0, -1)) {
    if (ix.programId !== COMPUTE_BUDGET_PROGRAM_ADDRESS)
      fail("only a compute budget may precede the bet");
    // SetComputeUnitLimit (2) only, bounded; no priority fee on the relayer's account.
    if (ix.data[0] !== 2 || ix.data.length !== 5)
      fail("only SetComputeUnitLimit may precede the bet");
    const units = new DataView(ix.data.buffer, ix.data.byteOffset).getUint32(1, true);
    if (units > MAX_DEMO_COMPUTE_UNITS) fail("compute limit too high");
  }
  if (ixs.length > 2) fail("unexpected instructions");
  // Never let identifyInstruction treat demo data as a Stele instruction (defence in depth).
  if (identifyInstruction(bet!.data) !== null) fail("not a demo instruction");

  const bettorSignature = tx.signatures[address(bettor)];
  if (
    !bettorSignature ||
    !verifyEd25519(
      new Uint8Array(bettorSignature),
      new Uint8Array(tx.messageBytes),
      fromBase58(bettor),
    )
  )
    fail("the bettor's signature is missing or invalid");

  await deps.db
    .update(demoSessions)
    .set({ actionCount: sql`${demoSessions.actionCount} + 1` })
    .where(eq(demoSessions.id, s.id));

  const signed = await partiallySignTransaction([deps.chain.relayer.keyPair], tx);
  const wire = getBase64EncodedWireTransaction(signed);
  const { value: latest } = await deps.chain.rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();
  // Failing bets are submitted too: the rejection is then a real, explorable transaction.
  const signature = await deps.chain.rpc
    .sendTransaction(wire, {
      encoding: "base64",
      skipPreflight: true,
      preflightCommitment: "confirmed",
    })
    .send();
  await confirmSignature(deps.chain.rpc, signature, latest.lastValidBlockHeight, "confirmed").catch(
    () => undefined,
  );
  const result = await deps.chain.rpc
    .getTransaction(signature, {
      encoding: "json",
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    })
    .send();
  if (!result)
    throw new ApiError(504, "not_confirmed", "The transaction was not confirmed in time");
  const logs = [...(result.meta?.logMessages ?? [])];
  const ok = !result.meta?.err;
  const failure: GateFailure | null = ok
    ? null
    : explainFailure(deps.chain.programAddress, result.meta?.err, logs);
  const event = ok ? (decodeBetPlacedFromLogs(logs)[0] ?? null) : null;
  return {
    signature,
    slot: Number(result.slot),
    ok,
    instruction: name,
    failure,
    bet: event
      ? {
          bettor: event.bettor,
          policyVersionNumber: event.policyVersionNumber,
          stake: Number(event.stake),
          betCount: Number(event.betCount),
          strict: event.strict,
        }
      : null,
  };
}
