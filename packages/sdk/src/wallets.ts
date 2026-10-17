/**
 * Built-in wallet support (Wallet Standard), so integrators do not have to wire a wallet library:
 * discovers the Solana wallets installed in the browser that support the document's network, connects
 * the one the user picks, and exposes it as a {@link MessageSigner}.
 *
 * Acceptances use two features: `standard:connect` (to learn the account's public address) and
 * `solana:signMessage` (to sign the acceptance text the wallet displays). When the wallet supports
 * `solana:signTransaction`, the connected signer also offers `signTransaction` — for the integrator's
 * own protected action (Stele Gate); Stele itself never asks for it.
 */
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type { MessageSigner } from "./accept";

const CONNECT = "standard:connect";
const SIGN_MESSAGE = "solana:signMessage";
const SIGN_TRANSACTION = "solana:signTransaction";

interface ConnectFeature {
  connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }>;
}
interface SignMessageFeature {
  signMessage(
    ...inputs: { account: WalletAccount; message: Uint8Array }[]
  ): Promise<readonly { signedMessage: Uint8Array; signature: Uint8Array }[]>;
}

/** A wallet that can sign acceptance messages on a given network. */
export interface AvailableWallet {
  name: string;
  /** Data URI supplied by the wallet extension. */
  icon: string;
  wallet: Wallet;
}

function supports(wallet: Wallet, chain: string): boolean {
  return (
    wallet.chains.includes(chain as `${string}:${string}`) &&
    CONNECT in wallet.features &&
    SIGN_MESSAGE in wallet.features
  );
}

/**
 * Lists wallets supporting `chain` (CAIP-2 style wallet chain such as `solana:mainnet`, from the
 * network info's `walletChain`). `onChange` fires when wallets register later (extensions often
 * load after the page); call the returned function to stop listening.
 */
export function watchWallets(
  chain: string,
  onChange: (wallets: AvailableWallet[]) => void,
): () => void {
  const registry = getWallets();
  const emit = () =>
    onChange(
      registry
        .get()
        .filter((w) => supports(w, chain))
        .map((w) => ({ name: w.name, icon: w.icon, wallet: w })),
    );
  const offRegister = registry.on("register", emit);
  const offUnregister = registry.on("unregister", emit);
  emit();
  return () => {
    offRegister();
    offUnregister();
  };
}

/** Wallet errors that mean "the user said no" (EIP-1193 / Wallet Standard conventions). */
export function isUserRejection(error: unknown): boolean {
  const e = error as { code?: unknown; name?: unknown; message?: unknown } | null;
  if (!e) return false;
  if (e.code === 4001) return true;
  const text = `${String(e.name ?? "")} ${String(e.message ?? "")}`.toLowerCase();
  return /reject|denied|declined|cancel/.test(text);
}

interface SignTransactionFeature {
  signTransaction(
    ...inputs: { account: WalletAccount; transaction: Uint8Array; chain?: string }[]
  ): Promise<readonly { signedTransaction: Uint8Array }[]>;
}

/** A connected wallet: signs acceptance messages, and transactions when the wallet can. */
export interface ConnectedWallet extends MessageSigner {
  /** Signs a serialized transaction (wire format) and returns it signed; absent if unsupported. */
  signTransaction?: (transaction: Uint8Array) => Promise<Uint8Array>;
}

/** Connects `wallet` and returns a signer for its first account on `chain`. */
export async function connectWallet(
  wallet: AvailableWallet,
  chain: string,
): Promise<ConnectedWallet> {
  const connect = wallet.wallet.features[CONNECT] as ConnectFeature;
  const { accounts } = await connect.connect();
  const account =
    accounts.find((a) => a.chains.includes(chain as `${string}:${string}`)) ?? accounts[0];
  if (!account) throw new Error(`${wallet.name} did not share an account.`);
  const feature = wallet.wallet.features[SIGN_MESSAGE] as SignMessageFeature;
  const signTx = wallet.wallet.features[SIGN_TRANSACTION] as SignTransactionFeature | undefined;
  return {
    address: account.address,
    walletName: wallet.name,
    async signMessage(message: Uint8Array): Promise<Uint8Array> {
      const [output] = await feature.signMessage({ account, message });
      if (!output) throw new Error(`${wallet.name} returned no signature.`);
      return output.signature;
    },
    ...(signTx
      ? {
          async signTransaction(transaction: Uint8Array): Promise<Uint8Array> {
            const [output] = await signTx.signTransaction({ account, transaction, chain });
            if (!output) throw new Error(`${wallet.name} returned no signed transaction.`);
            return output.signedTransaction;
          },
        }
      : {}),
  };
}
