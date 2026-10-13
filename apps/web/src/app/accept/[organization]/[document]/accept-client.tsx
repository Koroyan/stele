"use client";
/**
 * Hosted acceptance. Before anything is shown or signed, the browser verifies the document against
 * Solana (via the SDK): content hash, recomputed fingerprint, current-version status and network.
 * The signing message is then rebuilt locally from chain data and must match the server's challenge
 * byte for byte; the wallet displays the same text.
 *
 * Visitors sign with a wallet or — when the organization allows it — with a passkey (no wallet, no
 * SOL). New passkey signers are native (stele/2: the passkey's own key signs, verified on-chain by
 * the secp256r1 program); existing PRF-protected Stele keys keep working. The visitor never pays the
 * network fee.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { groupedFingerprint } from "@stelehq/protocol";
import {
  IntegrityError,
  NativePasskeySigner,
  PasskeySigner,
  PasskeyUnsupportedError,
  SteleApiError,
  SteleClient,
  acceptDocument,
  downloadJson,
  identifyPasskeySigner,
  isPasskeyCancel,
  loadVerifiedDocument,
  nativePasskeySupport,
  type AcceptanceResult,
  type AcceptanceStatus,
  type MessageSigner,
  type VerifiedDocument,
} from "@stelehq/sdk";
import {
  Alert,
  AlertIcon,
  Button,
  Card,
  CheckIcon,
  Fingerprint,
  KeyValue,
  ShieldIcon,
  Skeleton,
  Spinner,
  Steps,
  VerifiedBadge,
  buttonClasses,
  type StepState,
} from "@stele/ui";
import { ContentView } from "@/components/content-view";
import { DiffView } from "@/components/diff-view";
import { WalletDialog } from "@/components/wallet";
import { errorMessage } from "@/lib/api";
import { isUserRejection, rpcUrls } from "@/lib/chain";
import { PINNED_CHAIN_ID, PINNED_PROGRAM_ID, PINNED_RPC_URLS } from "@/lib/env";
import { formatDate, formatDateTime, shortAddress } from "@/lib/format";
import { rpcHosts } from "@/lib/verify";
import { useNetwork, useWallet } from "@/lib/wallet";
import { downloadReceiptPdf } from "@/lib/receipt-pdf";

type Load =
  | { kind: "loading" }
  | { kind: "error"; integrity: boolean; message: string }
  | { kind: "ready"; doc: VerifiedDocument };

export function AcceptClient({
  organization,
  document,
}: {
  organization: string;
  document: string;
}) {
  const network = useNetwork();
  const wallet = useWallet();
  const client = useMemo(() => new SteleClient({ apiBaseUrl: "/api" }), []);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [status, setStatus] = useState<AcceptanceStatus | null>(null);
  const [signingText, setSigningText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AcceptanceResult | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [readProgress, setReadProgress] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [method, setMethod] = useState<"wallet" | "passkey">("wallet");
  const [passkey, setPasskey] = useState<NativePasskeySigner | PasskeySigner | null>(null);
  const [passkeySupport, setPasskeySupport] = useState<{
    supported: boolean | null;
    reason?: string;
  }>({
    supported: null,
  });
  const [passkeyBusy, setPasskeyBusy] = useState<string | null>(null);
  const [recoveryKit, setRecoveryKit] = useState<string | null>(null);

  useEffect(() => {
    setPasskeySupport(nativePasskeySupport());
  }, []);
  useEffect(() => {
    if (load.kind !== "ready") return;
    const policy = load.doc.api.organization.signingPolicy ?? "WALLET_ONLY";
    const remembered =
      NativePasskeySigner.remembered(client, load.doc.organizationAddress) ??
      PasskeySigner.remembered(client, load.doc.organizationAddress);
    if (policy !== "WALLET_ONLY" && remembered) setPasskey(remembered);
    if (policy === "PASSKEY_ONLY" || policy === "ACCOUNT_AND_PASSKEY") setMethod("passkey");
  }, [client, load]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    loadVerifiedDocument({
      client,
      organization,
      document,
      rpcUrls: PINNED_RPC_URLS.length > 0 ? PINNED_RPC_URLS : undefined,
      expected: { programId: PINNED_PROGRAM_ID, chainId: PINNED_CHAIN_ID },
      loadPrevious: true,
    })
      .then((doc) => !cancelled && setLoad({ kind: "ready", doc }))
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof SteleApiError && e.status === 404)
          setLoad({
            kind: "error",
            integrity: false,
            message: "This agreement does not exist, or has no published version yet.",
          });
        else
          setLoad({
            kind: "error",
            integrity: e instanceof IntegrityError,
            message: errorMessage(e),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [client, organization, document]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () =>
      setReadProgress(Math.min(1, (el.scrollTop + el.clientHeight) / Math.max(el.scrollHeight, 1)));
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [load.kind]);

  if (load.kind === "loading") {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <div className="flex items-center gap-3 text-[14px] text-fg">
          <Spinner className="h-4 w-4 text-accent" /> Verifying this agreement against Solana…
        </div>
        <p className="mt-2 text-[13px] text-fg-muted">
          Checking the on-chain version, recomputing its fingerprint and hashing the text before
          showing it.
        </p>
        <div className="mt-8 space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-6 h-64 w-full" />
        </div>
      </div>
    );
  }

  if (load.kind === "error") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        {load.integrity ? (
          <Alert tone="danger" title="Do not accept this agreement">
            {load.message} The document could not be verified against Solana, so signing has been
            disabled for your protection.
          </Alert>
        ) : (
          <Alert tone="warning" title="This agreement is unavailable">
            {load.message}
          </Alert>
        )}
      </div>
    );
  }

  const { doc } = load;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const domain =
    doc.organization.verifiedDomain && Number(doc.organization.domainExpiresAt) > nowSeconds
      ? doc.organization.verifiedDomain
      : null;
  const effectiveAt = Number(doc.version.effectiveAt);
  const requestDomain = typeof window === "undefined" ? "" : window.location.hostname;
  const busy = status !== null && status !== "recorded" && !error && !result;
  const frozen = doc.organization.frozen;
  const policy = doc.api.organization.signingPolicy ?? "WALLET_ONLY";
  const walletAllowed = policy === "WALLET_ONLY" || policy === "WALLET_OR_PASSKEY";
  const passkeyAllowed = policy !== "WALLET_ONLY";
  const signerAddress = method === "passkey" ? (passkey?.address ?? null) : wallet.address;

  async function withPasskey(label: string, work: () => Promise<void>) {
    setError(null);
    setPasskeyBusy(label);
    try {
      await work();
    } catch (e) {
      setError(
        isPasskeyCancel(e)
          ? "The passkey prompt was dismissed. Nothing was changed."
          : e instanceof PasskeyUnsupportedError
            ? e.message
            : errorMessage(e),
      );
    } finally {
      setPasskeyBusy(null);
    }
  }

  async function accept() {
    if (!signerAddress) return;
    setError(null);
    setSigningText(null);
    setResult(null);
    const showText = (bytes: Uint8Array) => setSigningText(new TextDecoder().decode(bytes));
    const signer: MessageSigner =
      method === "passkey" && passkey instanceof NativePasskeySigner
        ? {
            address: passkey.address,
            signerType: "passkey_p256",
            publicKey: passkey.publicKey,
            signMessage: () => passkey.signMessage(),
            approve: (challenge, rpId) => passkey.approve(challenge, rpId),
          }
        : method === "passkey" && passkey instanceof PasskeySigner
          ? {
              address: passkey.address,
              signerType: "passkey",
              signMessage: (bytes) => passkey.signMessage(bytes),
              signWithAssertion: async (bytes) => {
                showText(bytes);
                return passkey.signWithAssertion(bytes);
              },
            }
          : {
              address: wallet.address!,
              signMessage: async (bytes) => {
                showText(bytes);
                return wallet.signMessage(bytes);
              },
            };
    try {
      const r = await acceptDocument({
        client,
        verified: doc,
        requestDomain: window.location.hostname,
        onStatus: setStatus,
        signer,
      });
      setResult(r);
    } catch (e) {
      setStatus(null);
      if (isUserRejection(e) || isPasskeyCancel(e))
        setError("You declined the signature request. Nothing was recorded.");
      else if (e instanceof IntegrityError) setError(`${e.message}`);
      else setError(errorMessage(e));
    }
  }

  const stepState = (step: AcceptanceStatus): StepState => {
    const order: AcceptanceStatus[] = ["requesting", "awaiting-signature", "recording", "recorded"];
    if (result) return "done";
    if (status === null) return "pending";
    const cur = order.indexOf(status);
    const me = order.indexOf(step);
    if (me < cur) return "done";
    if (me === cur) return error ? "error" : "active";
    return "pending";
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      {!domain && (
        <Alert tone="warning" title="Unverified organization" className="mb-6">
          “{doc.organization.name}” has not proven control of a domain. The name is self-declared —
          only continue if you trust where this link came from.
        </Alert>
      )}
      {frozen && (
        <Alert tone="danger" title="Acceptances are paused" className="mb-6">
          This organization&apos;s on-chain account is frozen by its owner or recovery authority.
          New acceptances cannot be recorded.
        </Alert>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Document */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-medium text-fg">{doc.organization.name}</span>
            <VerifiedBadge domain={domain} />
          </div>
          <h1 className="mt-3 text-balance text-[28px] font-semibold leading-tight tracking-[-0.025em] text-fg sm:text-[34px]">
            {doc.version.title}
          </h1>
          <p className="mt-2 text-[13.5px] text-fg-muted">
            Version {doc.version.versionLabel} (#{doc.version.version}) · Published{" "}
            {formatDate(Number(doc.version.publishedAt))} ·{" "}
            {effectiveAt === 0
              ? "Effective upon publication"
              : effectiveAt > nowSeconds
                ? `Takes effect ${formatDate(effectiveAt)}`
                : `Effective ${formatDate(effectiveAt)}`}
          </p>

          {doc.previous && (
            <div className="mt-5">
              <button
                type="button"
                className="text-[13px] font-medium text-accent hover:text-accent-strong"
                aria-expanded={showDiff}
                onClick={() => setShowDiff((s) => !s)}
              >
                {showDiff
                  ? "Hide changes"
                  : `What changed since version ${doc.previous.version.versionLabel}?`}
              </button>
              {showDiff && (
                <div className="mt-3">
                  <DiffView
                    before={doc.previous.content}
                    after={doc.content}
                    beforeLabel={`Version ${doc.previous.version.versionLabel}`}
                    afterLabel={`Version ${doc.version.versionLabel}`}
                  />
                </div>
              )}
            </div>
          )}

          <Card className="relative mt-6 overflow-hidden">
            <div className="h-0.5 bg-surface-3" aria-hidden="true">
              <div
                className="h-full bg-accent transition-[width] duration-150"
                style={{ width: `${Math.round(readProgress * 100)}%` }}
              />
            </div>
            <div
              ref={scrollRef}
              tabIndex={0}
              aria-label="Agreement text"
              className="max-h-[62vh] overflow-y-auto px-5 py-6 outline-none sm:px-8 sm:py-8"
            >
              <ContentView content={doc.content} />
            </div>
          </Card>
          <p className="mt-3 flex items-center gap-2 text-[12.5px] text-fg-subtle">
            <ShieldIcon className="h-3.5 w-3.5" /> This text was hashed in your browser and matches
            the commitment published on {doc.config.networkLabel}.
          </p>
        </div>

        {/* Review & sign */}
        <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <div className="border-b border-line px-5 py-4">
              <p className="text-[15px] font-semibold text-fg">Review what you will sign</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
                {method === "passkey"
                  ? "You will approve this exact information with your passkey."
                  : "Your wallet will show this exact information before you approve."}
              </p>
            </div>
            <div className="px-5 py-4">
              <KeyValue
                className="sm:grid-cols-[96px_1fr]"
                items={[
                  {
                    label: "Organization",
                    value: `${doc.organization.name} (${domain ? `verified: ${domain}` : "unverified"})`,
                  },
                  { label: "Document", value: doc.version.title },
                  {
                    label: "Version",
                    value: `${doc.version.versionLabel} (#${doc.version.version})`,
                  },
                  {
                    label: "Fingerprint",
                    value: (
                      <span className="font-mono text-[11.5px] leading-relaxed break-all text-fg">
                        {groupedFingerprint(doc.fingerprint)}
                      </span>
                    ),
                  },
                  { label: "Network", value: doc.config.networkLabel },
                  {
                    label: "Account",
                    value: signerAddress ? (
                      <Fingerprint value={signerAddress} />
                    ) : (
                      <span className="text-fg-subtle">
                        {method === "passkey" ? "Create or choose a passkey" : "Connect a wallet"}
                      </span>
                    ),
                  },
                  {
                    label: "Requested by",
                    value: <span className="font-mono text-[12.5px]">{requestDomain}</span>,
                  },
                ]}
              />
            </div>
            <div className="border-t border-line px-5 py-4">
              {recoveryKit ? (
                <div className="space-y-3 rounded-xl border border-dashed border-warning-line p-4">
                  <p className="text-[14px] font-semibold text-fg">Save your recovery kit</p>
                  <p className="text-[12.5px] leading-relaxed text-fg-muted">
                    If you lose every device with this passkey, this kit is the only way to keep
                    using the same signing key. It is shown once; Stele does not have it.
                  </p>
                  <p className="font-mono text-[12px] break-all text-fg">{recoveryKit}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        downloadJson("stele-recovery-kit.json", {
                          format: "stele-recovery-kit-v1",
                          organization: doc.organizationAddress,
                          signer: passkey?.address,
                          recoveryKit,
                        })
                      }
                    >
                      Download
                    </Button>
                    <Button size="sm" onClick={() => setRecoveryKit(null)}>
                      I saved it
                    </Button>
                  </div>
                </div>
              ) : result ? (
                <div className="space-y-3">
                  <p className="flex items-center gap-2 text-[14px] font-medium text-verified">
                    <CheckIcon className="h-4 w-4" /> Acceptance recorded on Solana
                  </p>
                  <p className="text-[12.5px] leading-relaxed text-fg-muted">
                    Signed with{" "}
                    {result.signerType === "passkey_p256"
                      ? "your passkey"
                      : result.signerType === "passkey"
                        ? "your passkey-protected key"
                        : "your wallet"}
                    . You paid nothing: the network fee was sponsored by{" "}
                    {result.fee?.sponsor === "organization" ? "the organization" : "Stele"}.
                  </p>
                  <Link
                    href={result.receiptPath}
                    className={buttonClasses("primary", "md", "w-full")}
                  >
                    View verifiable receipt
                  </Link>
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() =>
                      void client
                        .getReceipt(result.acceptanceId)
                        .then(({ receipt }) =>
                          downloadReceiptPdf(
                            `stele-receipt-${result.acceptanceId.slice(0, 16)}.pdf`,
                            receipt,
                            `${window.location.origin}/verify`,
                          ),
                        )
                        .catch((e: unknown) => setError(errorMessage(e)))
                    }
                  >
                    Download receipt (PDF)
                  </Button>
                  <p className="text-[12px] leading-relaxed text-fg-subtle">
                    Acceptance ID{" "}
                    <span className="font-mono">{shortAddress(result.acceptanceId, 8, 6)}</span>.
                    Keep the receipt: anyone can verify it without Stele.
                  </p>
                </div>
              ) : method === "passkey" && !passkey ? (
                <div className="space-y-2">
                  {passkeySupport.supported === false ? (
                    <Alert tone="warning" title="Passkeys are unavailable here">
                      {passkeySupport.reason}
                    </Alert>
                  ) : (
                    <>
                      <Button
                        className="w-full"
                        size="lg"
                        loading={passkeyBusy !== null}
                        disabled={frozen}
                        onClick={() =>
                          void withPasskey("Follow your device's passkey prompts…", async () => {
                            setPasskey(
                              await NativePasskeySigner.register({
                                client,
                                organization: doc.organizationAddress,
                              }),
                            );
                          })
                        }
                      >
                        {passkeyBusy ?? "Create a passkey to accept"}
                      </Button>
                      <button
                        type="button"
                        className="w-full text-center text-[12.5px] font-medium text-accent hover:text-accent-strong"
                        disabled={passkeyBusy !== null}
                        onClick={() =>
                          void withPasskey("Choose your passkey…", async () =>
                            setPasskey(
                              await identifyPasskeySigner({
                                client,
                                organization: doc.organizationAddress,
                              }),
                            ),
                          )
                        }
                      >
                        I already have a passkey for this organization
                      </button>
                    </>
                  )}
                </div>
              ) : method === "wallet" && !wallet.address ? (
                <>
                  <Button
                    className="w-full"
                    size="lg"
                    onClick={() => setWalletOpen(true)}
                    disabled={frozen || !wallet.ready}
                  >
                    Connect wallet to accept
                  </Button>
                  <WalletDialog open={walletOpen} onClose={() => setWalletOpen(false)} />
                </>
              ) : (
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => void accept()}
                  loading={busy}
                  disabled={frozen}
                >
                  {status === "awaiting-signature"
                    ? method === "passkey"
                      ? "Approve with your passkey…"
                      : "Approve in your wallet…"
                    : status === "recording"
                      ? "Recording on Solana…"
                      : status === "requesting"
                        ? "Preparing…"
                        : "Accept & sign"}
                </Button>
              )}
              {!result && !recoveryKit && walletAllowed && passkeyAllowed && (
                <button
                  type="button"
                  className="mt-3 w-full text-center text-[12.5px] font-medium text-accent hover:text-accent-strong"
                  onClick={() => setMethod((m) => (m === "wallet" ? "passkey" : "wallet"))}
                  disabled={busy}
                >
                  {method === "wallet"
                    ? "No wallet? Sign with a passkey instead"
                    : "Use a Solana wallet instead"}
                </button>
              )}
              {!result && (
                <p className="mt-3 text-[12px] leading-relaxed text-fg-subtle">
                  Signing is free — you never pay a network fee — and records a public acceptance on{" "}
                  {doc.config.networkLabel}. It contains no personal data.{" "}
                  {method === "passkey"
                    ? passkey instanceof PasskeySigner
                      ? "Stele never sees your private key (it is encrypted under your passkey in this browser)."
                      : "Your passkey's key never leaves your device; Solana verifies its signature on-chain."
                    : "Stele never sees your private key."}
                </p>
              )}
            </div>
          </Card>

          {(status !== null || result) && (
            <Card className="px-5 py-4">
              <Steps
                steps={[
                  { label: "Rebuild the message from chain data", state: stepState("requesting") },
                  {
                    label:
                      method === "passkey" ? "Approve with your passkey" : "Approve in your wallet",
                    state: stepState("awaiting-signature"),
                  },
                  {
                    label: "Record on Solana",
                    state: stepState("recording"),
                    detail:
                      status === "recording"
                        ? "The program verifies your signature and consumes a single-use nonce."
                        : undefined,
                  },
                ]}
              />
              {signingText && !result && (
                <div className="mt-4">
                  <p className="text-[12px] font-medium text-fg-muted">
                    {method === "passkey" ? "Message you approved" : "Message sent to your wallet"}
                  </p>
                  <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-line bg-[#060a0f] p-3 font-mono text-[11px] leading-relaxed whitespace-pre text-fg">
                    {signingText}
                  </pre>
                </div>
              )}
            </Card>
          )}

          {error && (
            <Alert tone="danger" title="Not recorded">
              {error}
            </Alert>
          )}

          <Card className="px-5 py-4">
            <p className="flex items-center gap-2 text-[13px] font-medium text-fg">
              <ShieldIcon className="h-4 w-4 text-accent" /> Checked before display
            </p>
            <ul className="mt-3 space-y-2">
              {doc.checks.map((c) => (
                <li
                  key={c.label}
                  className="flex gap-2 text-[12.5px] leading-relaxed text-fg-muted [overflow-wrap:anywhere]"
                >
                  <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-verified" />
                  <span>
                    <span className="text-fg">{c.label}.</span> {c.detail}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11.5px] text-fg-subtle">
              Source: {rpcHosts(PINNED_RPC_URLS.length > 0 ? PINNED_RPC_URLS : rpcUrls(network))}
            </p>
          </Card>

          {effectiveAt > nowSeconds && (
            <p className="flex items-start gap-2 text-[12px] leading-relaxed text-fg-subtle">
              <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" /> This version takes effect on{" "}
              {formatDateTime(effectiveAt)}. Accepting now records your acceptance of it in advance.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
