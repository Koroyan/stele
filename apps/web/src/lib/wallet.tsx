"use client";
/**
 * Wallet Standard integration (via @solana/kit-plugin-wallet). The page never sees private keys:
 * it asks the user's wallet to sign exact bytes (`signMessage`) or exact transactions.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createClient, type TransactionSigner } from "@solana/kit";
import {
  walletWithoutSigner,
  type ClientWithWallet,
  type WalletState,
} from "@solana/kit-plugin-wallet";
import type { NetworkInfo } from "@stele/sdk";

type WalletClient = ClientWithWallet;

// One client per chain for the lifetime of the page (React StrictMode re-mounts must not dispose it).
const clients = new Map<string, WalletClient>();
function walletClientFor(chain: string): WalletClient {
  let client = clients.get(chain);
  if (!client) {
    client = createClient().use(
      walletWithoutSigner({ chain: chain as `${string}:${string}`, storageKey: "stele:wallet" }),
    );
    clients.set(chain, client);
  }
  return client;
}

const NetworkContext = createContext<NetworkInfo | null>(null);
const WalletContext = createContext<WalletClient | null>(null);

export function AppProviders({ network, children }: { network: NetworkInfo; children: ReactNode }) {
  const client = useMemo(() => walletClientFor(network.walletChain), [network.walletChain]);
  return (
    <NetworkContext.Provider value={network}>
      <WalletContext.Provider value={client}>{children}</WalletContext.Provider>
    </NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkInfo {
  const n = useContext(NetworkContext);
  if (!n) throw new Error("useNetwork must be used inside <AppProviders>");
  return n;
}

function useWalletClient(): WalletClient {
  const c = useContext(WalletContext);
  if (!c) throw new Error("useWallet must be used inside <AppProviders>");
  return c;
}

export interface UseWallet {
  state: WalletState;
  /** Connected account address, if any. */
  address: string | null;
  signer: TransactionSigner | null;
  ready: boolean;
  connect: (wallet: WalletState["wallets"][number]) => Promise<void>;
  disconnect: () => Promise<void>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}

// Server render and hydration both use this snapshot, so markup matches; live state follows.
const SERVER_SNAPSHOT: WalletState = Object.freeze({
  connected: null,
  reconnectingTo: null,
  status: "pending",
  wallets: [],
});
const getServerSnapshot = () => SERVER_SNAPSHOT;

export function useWallet(): UseWallet {
  const client = useWalletClient();
  const state = useSyncExternalStore(
    client.wallet.subscribe,
    client.wallet.getState,
    getServerSnapshot,
  );
  const connect = useCallback(
    async (wallet: WalletState["wallets"][number]) => {
      try {
        await client.wallet.connect(wallet);
      } catch (e) {
        if ((e as Error).name !== "AbortError") throw e;
      }
    },
    [client],
  );
  const disconnect = useCallback(() => client.wallet.disconnect(), [client]);
  const signMessage = useCallback(
    async (message: Uint8Array) => new Uint8Array(await client.wallet.signMessage(message)),
    [client],
  );
  return {
    state,
    address: state.connected?.account.address ?? null,
    signer: state.connected?.signer ?? null,
    ready: state.status !== "pending" && state.status !== "reconnecting",
    connect,
    disconnect,
    signMessage,
  };
}
