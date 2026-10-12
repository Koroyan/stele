/**
 * A Wallet Standard test wallet injected into the page. It behaves like a browser-extension wallet
 * (connect, signMessage, signTransaction) but signs in the test process with a throwaway localnet
 * key via `page.exposeFunction` — real Ed25519 signatures, no extension required.
 *
 * Every signature request is recorded so tests can assert exactly what the user was asked to sign.
 */
import type { Page } from "@playwright/test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { toBase58 } from "@stelehq/protocol";

export interface TestWallet {
  address: string;
  /** UTF-8 messages passed to signMessage, in order. */
  signedMessages: string[];
  /** Number of transactions signed. */
  signedTransactions: number;
  /** When true, the next request is rejected as if the user clicked "Reject". */
  rejectNext: boolean;
}

function readShortVec(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let size = 0;
  for (;;) {
    const byte = bytes[offset + size]!;
    value |= (byte & 0x7f) << (7 * size);
    size++;
    if ((byte & 0x80) === 0) return [value, size];
  }
}

/** Signs a wire transaction in place for `publicKey` (legacy or v0). */
function signWireTransaction(
  wire: Uint8Array,
  secret: Uint8Array,
  publicKey: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(wire);
  const [numSigs, sigLen] = readShortVec(out, 0);
  const messageStart = sigLen + numSigs * 64;
  const message = out.subarray(messageStart);
  let p = 0;
  if (message[0]! & 0x80) p = 1; // versioned message prefix
  const numRequired = message[p]!;
  p += 3; // header
  const [numKeys, keysLen] = readShortVec(message, p);
  p += keysLen;
  for (let i = 0; i < Math.min(numKeys, numRequired); i++) {
    const key = message.subarray(p + i * 32, p + (i + 1) * 32);
    if (key.every((b, j) => b === publicKey[j])) {
      out.set(ed25519.sign(message, secret), sigLen + i * 64);
      return out;
    }
  }
  throw new Error("test wallet: this transaction does not require our signature");
}

export async function installTestWallet(
  page: Page,
  keypair: Uint8Array,
  name = "Stele Test Wallet",
): Promise<TestWallet> {
  const secret = keypair.slice(0, 32);
  const publicKey = keypair.slice(32);
  const state: TestWallet = {
    address: toBase58(publicKey),
    signedMessages: [],
    signedTransactions: 0,
    rejectNext: false,
  };

  await page.exposeFunction("__steleTestSignMessage", (bytes: number[]) => {
    if (state.rejectNext) {
      state.rejectNext = false;
      throw new Error("User rejected the request");
    }
    const message = Uint8Array.from(bytes);
    state.signedMessages.push(new TextDecoder().decode(message));
    return Array.from(ed25519.sign(message, secret));
  });
  await page.exposeFunction("__steleTestSignTransaction", (bytes: number[]) => {
    if (state.rejectNext) {
      state.rejectNext = false;
      throw new Error("User rejected the request");
    }
    state.signedTransactions++;
    return Array.from(signWireTransaction(Uint8Array.from(bytes), secret, publicKey));
  });

  // When this file runs under esbuild-based loaders (tsx), serialized functions reference esbuild's
  // `__name` helper, which does not exist in the page; provide a no-op.
  await page.addInitScript({ content: "globalThis.__name = globalThis.__name || ((fn) => fn);" });
  await page.addInitScript(
    ({ address, publicKey: pk, walletName }) => {
      type Listener = (properties: { accounts?: unknown[] }) => void;
      const chains = ["solana:mainnet", "solana:devnet", "solana:localnet"];
      const account = Object.freeze({
        address,
        publicKey: new Uint8Array(pk),
        chains,
        features: ["solana:signMessage", "solana:signTransaction"],
        label: "Test account",
      });
      const listeners = new Set<Listener>();
      let accounts: (typeof account)[] = [];
      const emit = () => listeners.forEach((l) => l({ accounts }));
      const w = window as unknown as {
        __steleTestSignMessage: (b: number[]) => Promise<number[]>;
        __steleTestSignTransaction: (b: number[]) => Promise<number[]>;
      };
      const wallet = {
        version: "1.0.0",
        name: walletName,
        icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzRjYzlmMCIvPjwvc3ZnPg==",
        chains,
        get accounts() {
          return accounts;
        },
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => {
              accounts = [account];
              emit();
              return { accounts };
            },
          },
          "standard:disconnect": {
            version: "1.0.0",
            disconnect: async () => {
              accounts = [];
              emit();
            },
          },
          "standard:events": {
            version: "1.0.0",
            on: (_event: string, listener: Listener) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          },
          "solana:signMessage": {
            version: "1.1.0",
            signMessage: async (...inputs: { account: unknown; message: Uint8Array }[]) =>
              Promise.all(
                inputs.map(async ({ message }) => ({
                  signedMessage: message,
                  signature: new Uint8Array(await w.__steleTestSignMessage(Array.from(message))),
                  signatureType: "ed25519",
                })),
              ),
          },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
              Promise.all(
                inputs.map(async ({ transaction }) => ({
                  signedTransaction: new Uint8Array(
                    await w.__steleTestSignTransaction(Array.from(transaction)),
                  ),
                })),
              ),
          },
        },
      };
      const register = ({ register: r }: { register: (w: unknown) => void }) => r(wallet);
      try {
        window.dispatchEvent(
          new CustomEvent("wallet-standard:register-wallet", { detail: register }),
        );
      } catch {
        // ignore
      }
      try {
        window.addEventListener("wallet-standard:app-ready", (e) =>
          register((e as CustomEvent).detail),
        );
      } catch {
        // ignore
      }
    },
    { address: state.address, publicKey: Array.from(publicKey), walletName: name },
  );
  return state;
}

/** Connects the injected wallet through the site's own wallet dialog. */
export async function connectThroughDialog(
  page: Page,
  walletName = "Stele Test Wallet",
): Promise<void> {
  await page.getByRole("dialog").getByRole("button", { name: walletName }).click();
}
