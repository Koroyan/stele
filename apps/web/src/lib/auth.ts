/**
 * Wallet sign-in (Sign-In With Solana message, signed with `signMessage`). The message is built by
 * the API, names this site and network, and is single-use. Signing it authorizes a dashboard session
 * only — never a transaction or a payment.
 */
import { fromBase58, toBase58, toBase64, utf8, verifyEd25519 } from "@stelehq/protocol";
import { api } from "./api";

export interface SessionUser {
  id: string;
  walletAddress: string;
  displayName: string | null;
}

export async function signInWithWallet(
  address: string,
  signMessage: (m: Uint8Array) => Promise<Uint8Array>,
): Promise<SessionUser> {
  const { message } = await api<{ message: string }>("/v1/auth/challenge", { body: { address } });
  // Refuse to sign anything that is not a sign-in message for this site.
  const host = window.location.host;
  if (!message.startsWith(`${host} wants you to sign in with your Solana account:\n${address}\n`)) {
    throw new Error(
      "The sign-in message does not name this site and account. Signing was blocked.",
    );
  }
  const bytes = utf8(message);
  const signature = await signMessage(bytes);
  if (!verifyEd25519(signature, bytes, fromBase58(address)))
    throw new Error("The wallet returned an invalid signature.");
  const { user } = await api<{ user: SessionUser }>("/v1/auth/verify", {
    body: { address, signedMessage: toBase64(bytes), signature: toBase58(signature) },
  });
  return user;
}

export async function signOut(): Promise<void> {
  await api("/v1/auth/logout", { method: "POST" });
}

/** Only same-site relative paths are accepted as post-login destinations (no open redirects). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\"))
    return "/dashboard";
  return next;
}
