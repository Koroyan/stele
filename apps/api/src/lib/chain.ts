/**
 * Solana access for the API: reads, the relayer (fee payer for recordings) and the domain attestor.
 * Neither key can create evidence on its own: the relayer only pays fees and satisfies the shard's
 * relayer check; the attestor can only attest domains. The relayer signs recordings only, and only
 * in the allowlisted shape (lib/tx-policy.ts).
 */
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import {
  buildAcceptanceTransactionMessage,
  createRpc,
  getClusterUnixTimestamp,
  signSendAndConfirm,
  type NetworkPreset,
  type SteleRpc,
} from "@stelehq/protocol";
import { chainFromUrls, type ChainSource } from "@stelehq/verifier";
import type { Config } from "../config.js";
import { loadSigner } from "./keys.js";
import { assertSponsoredRecordingShape } from "./tx-policy.js";

/** Measured below 10k CU (programs/stele/tests/batches.rs); headroom for sponsorship. */
const BATCH_COMPUTE_UNIT_LIMIT = 30_000;

export interface ChainService {
  readonly rpc: SteleRpc;
  readonly programAddress: Address;
  readonly relayer: KeyPairSigner;
  readonly attestor: KeyPairSigner;
  readonly network: NetworkPreset;
  clusterTime(): Promise<number>;
  send(feePayer: KeyPairSigner, instructions: Instruction[]): Promise<string>;
  /**
   * Relays a signature-gated Stele instruction paid by the relayer: `record_acceptance` /
   * `record_proof` after an Ed25519 verification, or a native-passkey instruction after a secp256r1
   * verification (the allowlist is lib/tx-policy.ts).
   */
  sendRecord(precompileInstruction: Instruction, recordInstruction: Instruction): Promise<string>;
  /** @deprecated alias of `sendRecord`. */
  sendAcceptance(
    precompileInstruction: Instruction,
    recordInstruction: Instruction,
  ): Promise<string>;
  /** Relays an `anchor_acceptance_batch` (MERKLE_BATCHED) paid by the relayer. */
  sendBatchAnchor(anchorInstruction: Instruction): Promise<string>;
  /** Read-only source for the independent verifier (all configured RPCs must agree). */
  verifierSource(): ChainSource;
}

export async function createChainService(config: Config): Promise<ChainService> {
  const rpc = createRpc(config.SOLANA_RPC_URLS[0]!);
  const relayer = await loadSigner(config.RELAYER_KEYPAIR);
  const attestor = await loadSigner(config.ATTESTOR_KEYPAIR);
  const programAddress = address(config.PROGRAM_ID);
  let verifier: ChainSource | null = null;

  async function sendRecord(precompileInstruction: Instruction, recordInstruction: Instruction) {
    const { value: latestBlockhash } = await rpc
      .getLatestBlockhash({ commitment: "confirmed" })
      .send();
    const message = buildAcceptanceTransactionMessage({
      feePayer: relayer,
      latestBlockhash,
      precompileInstruction,
      recordInstruction,
      priorityFeeMicroLamports: config.PRIORITY_FEE_MICROLAMPORTS,
    });
    assertSponsoredRecordingShape(message.instructions, {
      programAddress,
      relayer: relayer.address,
      maxPriorityFeeMicroLamports: config.PRIORITY_FEE_MICROLAMPORTS,
    });
    return signSendAndConfirm(rpc, message, { commitment: "confirmed" });
  }

  async function sendBatchAnchor(anchorInstruction: Instruction) {
    const { value: latestBlockhash } = await rpc
      .getLatestBlockhash({ commitment: "confirmed" })
      .send();
    const budget: Instruction[] = [
      getSetComputeUnitLimitInstruction({ units: BATCH_COMPUTE_UNIT_LIMIT }),
    ];
    if (config.PRIORITY_FEE_MICROLAMPORTS > 0n)
      budget.push(
        getSetComputeUnitPriceInstruction({ microLamports: config.PRIORITY_FEE_MICROLAMPORTS }),
      );
    const message = pipe(
      createTransactionMessage({ version: "legacy" }),
      (m) => setTransactionMessageFeePayerSigner(relayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([...budget, anchorInstruction], m),
    );
    assertSponsoredRecordingShape(message.instructions, {
      programAddress,
      relayer: relayer.address,
      maxPriorityFeeMicroLamports: config.PRIORITY_FEE_MICROLAMPORTS,
    });
    return signSendAndConfirm(rpc, message, { commitment: "confirmed" });
  }

  return {
    rpc,
    programAddress,
    relayer,
    attestor,
    network: config.network,
    clusterTime: () => getClusterUnixTimestamp(rpc),
    async send(feePayer, instructions) {
      // The relayer signs recordings only (sendRecord); never an arbitrary transaction.
      if (feePayer.address === relayer.address)
        throw new Error("refusing to sign: the relayer only signs Stele recordings");
      const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(feePayer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) => appendTransactionMessageInstructions(instructions, m),
      );
      return signSendAndConfirm(rpc, message, { commitment: "confirmed" });
    },
    sendRecord,
    sendAcceptance: sendRecord,
    sendBatchAnchor,
    verifierSource() {
      verifier ??= chainFromUrls(config.SOLANA_RPC_URLS);
      return verifier;
    },
  };
}
