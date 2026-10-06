"use client";
/**
 * Receipt page. The API supplies a receipt bundle, but the verdict shown here comes from the
 * verifier running in this browser against Solana — the server's opinion is never displayed as proof.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { Receipt } from "@stele/protocol";
import { verifyAcceptance, type VerificationReport } from "@stele/verifier";
import {
  Alert,
  Card,
  CodeBlock,
  CopyButton,
  DownloadIcon,
  ExternalIcon,
  Fingerprint,
  Skeleton,
  Spinner,
  buttonClasses,
} from "@stele/ui";
import { downloadJson, ReportView } from "@/components/report-view";
import { api, ApiError, errorMessage } from "@/lib/api";
import { txExplorerUrl } from "@/lib/chain";
import { cliCommand, defaultSettings, rpcHosts, verifierOptions } from "@/lib/verify";
import { useNetwork } from "@/lib/wallet";

export function ReceiptClient({ acceptanceId }: { acceptanceId: string }) {
  const network = useNetwork();
  const settings = useMemo(() => defaultSettings(network), [network]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverWarning, setServerWarning] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let r: Receipt | null = null;
      let sig: string;
      try {
        const body = await api<{ receipt: Receipt }>(
          `/v1/public/acceptances/${acceptanceId}/receipt`,
        );
        r = body.receipt;
        sig = r.transaction.signature;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404)
          throw new Error("No acceptance with this ID was found.", {
            cause: e,
          });
        // The server could not produce a receipt; verify the transaction directly instead.
        if (e instanceof ApiError && e.status === 422)
          setServerWarning(`The server's own verification reported a problem: ${e.message}.`);
        const { acceptance } = await api<{ acceptance: { transactionSignature: string } }>(
          `/v1/public/acceptances/${acceptanceId}`,
        );
        sig = acceptance.transactionSignature;
      }
      if (cancelled) return;
      setReceipt(r);
      setTxSignature(sig);
      const result = await verifyAcceptance(
        r ? { receipt: r } : { transactionSignature: sig, acceptanceId },
        verifierOptions(network, settings),
      );
      if (!cancelled) setReport(result);
    })().catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [acceptanceId, network, settings]);

  useEffect(() => {
    QRCode.toString(window.location.href, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#e7edf5", light: "#00000000" },
    })
      .then((svg) => setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch(() => setQr(null));
  }, []);

  const where = `Verified in your browser via ${rpcHosts(settings.rpcUrls)}`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="text-[12.5px] font-medium uppercase tracking-[0.12em] text-accent">
        Acceptance receipt
      </p>
      <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.025em] text-fg sm:text-[34px]">
        {receipt ? receipt.version.title : "Agreement acceptance"}
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
        {receipt && (
          <span>
            {receipt.organization.name} · Version {receipt.version.label} (#{receipt.version.number}
            )
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          ID <Fingerprint value={acceptanceId} />
        </span>
      </div>

      {error && (
        <Alert tone="danger" title="This receipt could not be verified" className="mt-8">
          {error}{" "}
          <Link href="/verify" className="text-accent underline-offset-2 hover:underline">
            Try the verifier
          </Link>
        </Alert>
      )}
      {serverWarning && (
        <Alert tone="warning" className="mt-8">
          {serverWarning} The result below is from your browser&apos;s own verification.
        </Alert>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {report ? (
            <ReportView report={report} where={where} />
          ) : !error ? (
            <Card className="space-y-4 p-6">
              <p className="flex items-center gap-3 text-[14px] text-fg">
                <Spinner className="h-4 w-4 text-accent" /> Verifying against Solana in your
                browser…
              </p>
              <p className="text-[13px] text-fg-muted">
                Reading the transaction, the signed message, the document version and its content
                from {rpcHosts(settings.rpcUrls)}.
              </p>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </Card>
          ) : null}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <Card className="p-5">
            <p className="text-[14px] font-semibold text-fg">Keep this receipt</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
              The JSON bundle contains everything needed to re-verify this acceptance, including the
              document text.
            </p>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                disabled={!receipt}
                onClick={() =>
                  receipt &&
                  downloadJson(`stele-receipt-${acceptanceId.slice(0, 12)}.json`, receipt)
                }
                className={buttonClasses("primary", "md", "w-full")}
              >
                <DownloadIcon className="h-4 w-4" /> Download receipt
              </button>
              {txSignature && (
                <a
                  href={txExplorerUrl(network, txSignature)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={buttonClasses("secondary", "md", "w-full")}
                >
                  View transaction <ExternalIcon className="h-4 w-4" />
                </a>
              )}
              {txSignature && (
                <Link
                  href={`/verify?tx=${txSignature}`}
                  className={buttonClasses("ghost", "md", "w-full")}
                >
                  Verify with other RPC providers
                </Link>
              )}
            </div>
          </Card>
          {qr && (
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium text-fg">Link to this receipt</p>
                <CopyButton
                  value={typeof window === "undefined" ? "" : window.location.href}
                  label="Copy receipt link"
                />
              </div>
              {/* QR code generated locally from this page's URL. */}
              <img
                src={qr}
                alt="QR code linking to this receipt"
                width={200}
                height={200}
                className="mx-auto mt-4 h-[200px] w-[200px]"
              />
            </Card>
          )}
          {txSignature && (
            <div>
              <p className="mb-2 text-[12.5px] font-medium text-fg-muted">Command-line check</p>
              <CodeBlock code={cliCommand(settings, { tx: txSignature })} language="shell" />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
