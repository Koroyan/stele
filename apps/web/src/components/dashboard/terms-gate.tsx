"use client";
/**
 * Before the dashboard: the signed-in wallet accepts the current version of Stele's own Terms of
 * Service — with Stele, like any organization's users accept theirs: the text is verified against
 * Solana in the browser, the wallet signs it (free), and the acceptance is recorded on-chain.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { SteleClient, acceptDocument, type AcceptanceStatus } from "@stelehq/sdk";
import { Alert, Button, Card, Skeleton, SteleLogo } from "@stele/ui";
import { ContentView } from "@/components/content-view";
import { LegalEvidence, useStelePlatformDocument } from "@/components/legal-document";
import { WalletButton } from "@/components/wallet";
import { errorMessage } from "@/lib/api";
import { isUserRejection } from "@/lib/chain";
import { signOut } from "@/lib/auth";
import { useDashboard } from "@/lib/dashboard";
import { shortAddress } from "@/lib/format";
import { useWallet } from "@/lib/wallet";

const STATUS: Record<AcceptanceStatus, string> = {
  requesting: "Preparing the message…",
  "awaiting-signature": "Sign the Terms in your wallet…",
  recording: "Recording your acceptance on Solana…",
  recorded: "Accepted",
};

export function TermsGate() {
  const { user, terms, reloadOrgs } = useDashboard();
  const wallet = useWallet();
  const client = useMemo(() => new SteleClient({ apiBaseUrl: "/api" }), []);
  const state = useStelePlatformDocument(terms!.document);
  const [agreed, setAgreed] = useState(false);
  const [status, setStatus] = useState<AcceptanceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rightWallet = wallet.address === user.walletAddress;

  async function accept() {
    if (state.kind !== "ready" || !rightWallet) return;
    setError(null);
    try {
      await acceptDocument({
        client,
        verified: state.doc,
        requestDomain: window.location.hostname,
        onStatus: setStatus,
        signer: { address: wallet.address!, signMessage: wallet.signMessage },
      });
      await reloadOrgs();
    } catch (e) {
      setStatus(null);
      setError(
        isUserRejection(e) ? "You declined the signature. Nothing was recorded." : errorMessage(e),
      );
    }
  }

  const changed = terms!.acceptedVersion !== null;
  return (
    <div className="min-h-dvh bg-bg px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="Stele home">
            <SteleLogo />
          </Link>
          <button
            type="button"
            onClick={() => void signOut().then(() => window.location.assign("/login"))}
            className="text-[13px] text-fg-muted hover:text-fg"
          >
            Sign out
          </button>
        </div>
        <Card className="mt-8 p-6 sm:p-8">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-fg">
            {changed ? "We updated Stele's Terms of Service" : "Stele's Terms of Service"}
          </h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-fg-muted">
            {changed
              ? `You accepted version ${terms!.acceptedVersion}. Before you continue, read and accept version ${terms!.version.label}.`
              : "Before you use the dashboard, read and accept them."}{" "}
            You accept them with Stele itself: your wallet signs the exact text below — free — and
            the acceptance is recorded on Solana, like your own users&apos; acceptances.
          </p>

          <div className="mt-6">
            {state.kind === "loading" ? (
              <div className="space-y-3">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : state.kind === "ready" ? (
              <div className="space-y-4">
                <LegalEvidence doc={state.doc} />
                {state.doc.content.changeSummary && changed && (
                  <Alert tone="info">What changed: {state.doc.content.changeSummary}</Alert>
                )}
                <div
                  tabIndex={0}
                  aria-label="Terms of Service"
                  className="max-h-[52vh] overflow-y-auto rounded-xl border border-line bg-surface-2 px-5 py-4"
                >
                  <ContentView content={state.doc.content} />
                </div>
              </div>
            ) : (
              <Alert tone="danger">
                {state.kind === "error"
                  ? `The Terms could not be verified: ${state.message}`
                  : "The Terms are not available right now."}{" "}
                Reload the page to try again.
              </Alert>
            )}
          </div>

          <label className="mt-6 flex items-start gap-3 text-[14px] leading-relaxed text-fg">
            <input
              type="checkbox"
              className="mt-1"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              I have read and accept the Stele Terms of Service (version {terms!.version.label}) on
              behalf of myself and the organizations I manage, and I have read the{" "}
              <Link href="/privacy" target="_blank" className="text-accent hover:underline">
                Privacy Policy
              </Link>
              .
            </span>
          </label>

          {error && (
            <Alert tone="danger" className="mt-5">
              {error}
            </Alert>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {rightWallet ? (
              <Button
                onClick={() => void accept()}
                loading={status !== null}
                disabled={!agreed || state.kind !== "ready" || status !== null}
              >
                Accept with my wallet
              </Button>
            ) : (
              <>
                <WalletButton />
                <span className="text-[13px] text-fg-subtle">
                  Connect the wallet you signed in with ({shortAddress(user.walletAddress)}).
                </span>
              </>
            )}
            {status && <span className="text-[13px] text-fg-muted">{STATUS[status]}</span>}
          </div>
        </Card>
      </div>
    </div>
  );
}
