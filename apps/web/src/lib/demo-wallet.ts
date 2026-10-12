/**
 * The live demo's throwaway wallet: an Ed25519 key generated in this browser tab, kept in memory
 * only (never stored), used on test networks only. It has no funds — the Stele relayer pays fees.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import type { MessageSigner } from "@stelehq/sdk";
import { toBase58 } from "@stelehq/protocol";

export interface DemoWallet extends MessageSigner {
  /** Signs a transaction message (the bytes a Solana signature covers). */
  signTransactionMessage(messageBytes: Uint8Array): Uint8Array;
}

export function createDemoWallet(): DemoWallet {
  const secret = ed25519.utils.randomSecretKey();
  const address = toBase58(ed25519.getPublicKey(secret));
  return {
    address,
    walletName: "Demo wallet",
    signerType: "wallet",
    signMessage: async (message: Uint8Array) => ed25519.sign(message, secret),
    signTransactionMessage: (messageBytes: Uint8Array) => ed25519.sign(messageBytes, secret),
  };
}
