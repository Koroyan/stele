"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  verifyAcceptance,
  verifyDocumentVersion,
  verifyProof,
  type VerificationReport,
} from "@stelehq/verifier";
import { Alert, Button, Card, CodeBlock, Field, Input, Spinner, Tabs, Textarea } from "@stele/ui";
import { ReportView } from "@/components/report-view";
import { api, errorMessage } from "@/lib/api";
import {
  cliCommand,
  defaultSettings,
  rpcHosts,
  verifierOptions,
  type VerifySettings,
} from "@/lib/verify";
import { receiptFromPdf } from "@/lib/receipt-from-pdf";
import { useNetwork } from "@/lib/wallet";

type Mode = "acceptance" | "receipt" | "version";

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const HEX32 = /^[0-9a-f]{64}$/;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function VerifyClient({
  initial,
}: {
  initial: { tx?: string; acceptance?: string; version?: string; fingerprint?: string };
}) {
  const network = useNetwork();
  const [mode, setMode] = useState<Mode>(
    initial.version || initial.fingerprint ? "version" : "acceptance",
  );
  const [txInput, setTxInput] = useState(initial.tx ?? initial.acceptance ?? "");
  const [versionInput, setVersionInput] = useState(initial.version ?? initial.fingerprint ?? "");
  const [receiptText, setReceiptText] = useState("");
  const [settings, setSettings] = useState<VerifySettings>(() => defaultSettings(network));
  const [rpcText, setRpcText] = useState(() => defaultSettings(network).rpcUrls.join("\n"));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<{
    report: VerificationReport;
    where: string;
    cli: string;
  } | null>(null);
  const autoRan = useRef(false);

  const effectiveSettings = useCallback((): VerifySettings => {
    const urls = rpcText
      .split(/\s+/)
      .map((u) => u.trim())
      .filter(Boolean);
    for (const u of urls) {
      const parsed = new URL(u);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
        throw new Error(`Unsupported RPC URL: ${u}`);
    }
    if (urls.length === 0) throw new Error("Add at least one RPC endpoint.");
    return { ...settings, rpcUrls: urls };
  }, [rpcText, settings]);

  const run = useCallback(async () => {
    setError(null);
    setNote(null);
    setResult(null);
    let s: VerifySettings;
    try {
      s = effectiveSettings();
    } catch (e) {
      setError(errorMessage(e));
      return;
    }
    const opts = verifierOptions(network, s);
    const where = `Verified in your browser via ${rpcHosts(s.rpcUrls)}`;
    setRunning(true);
    try {
      if (mode === "acceptance") {
        const value = txInput.trim();
        if (SIGNATURE.test(value)) {
          const report = await verifyAcceptance({ transactionSignature: value }, opts);
          setResult({ report, where, cli: cliCommand(s, { tx: value }) });
        } else if (HEX32.test(value.toLowerCase())) {
          // Acceptance IDs are resolved to their transaction through the index; the transaction itself is then verified on-chain.
          const { acceptance } = await api<{ acceptance: { transactionSignature: string } }>(
            `/v1/public/acceptances/${value.toLowerCase()}`,
          );
          setNote(
            "The acceptance ID was looked up in Stele's index to find its transaction. Everything below was then verified on-chain.",
          );
          const report = await verifyAcceptance(
            {
              transactionSignature: acceptance.transactionSignature,
              acceptanceId: value.toLowerCase(),
            },
            opts,
          );
          setResult({ report, where, cli: cliCommand(s, { tx: acceptance.transactionSignature }) });
        } else {
          throw new Error(
            "Enter a transaction signature (base58) or an acceptance ID (64 hex characters).",
          );
        }
      } else if (mode === "receipt") {
        let receipt: unknown;
        try {
          receipt = JSON.parse(receiptText);
        } catch {
          throw new Error("The receipt is not valid JSON.");
        }
        // Acceptance receipts (stele-receipt-v1, stele-receipt/2) and proof receipts (stele-proof-v1).
        const isProof =
          typeof receipt === "object" &&
          receipt !== null &&
          (receipt as { format?: unknown }).format === "stele-proof-v1";
        const report = isProof
          ? await verifyProof({ receipt }, opts)
          : await verifyAcceptance({ receipt }, opts);
        setResult({ report, where, cli: cliCommand(s, { receipt: true }) });
      } else {
        const value = versionInput.trim();
        if (HEX32.test(value.toLowerCase())) {
          const report = await verifyDocumentVersion({ fingerprint: value.toLowerCase() }, opts);
          setResult({ report, where, cli: cliCommand(s, { fingerprint: value.toLowerCase() }) });
        } else if (ADDRESS.test(value)) {
          const report = await verifyDocumentVersion({ versionAddress: value }, opts);
          setResult({ report, where, cli: cliCommand(s, { version: value }) });
        } else {
          throw new Error("Enter a version account address or a 64-character fingerprint.");
        }
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }, [effectiveSettings, mode, network, receiptText, txInput, versionInput]);

  useEffect(() => {
    if (autoRan.current) return;
    if (initial.tx || initial.acceptance || initial.version || initial.fingerprint) {
      autoRan.current = true;
      void run();
    }
  }, [initial, run]);

  async function onFile(file: File) {
    if (file.size > 4 * 1024 * 1024) {
      setError("Receipt files larger than 4 MB are not supported.");
      return;
    }
    const text = await file.text();
    if (text.startsWith("%PDF")) {
      // A Stele PDF receipt carries the JSON receipt inside it; only that is verified.
      const embedded = receiptFromPdf(text);
      if (!embedded) {
        setError(
          "This PDF does not contain a Stele receipt. Download the PDF from a receipt page.",
        );
        return;
      }
      setReceiptText(embedded);
      return;
    }
    setReceiptText(text);
  }

  return (
    <div className="space-y-8">
      <Card>
        <Tabs<Mode>
          value={mode}
          onChange={(m) => {
            setMode(m);
            setResult(null);
            setError(null);
          }}
          className="px-3 pt-1 sm:px-4"
          items={[
            { value: "acceptance", label: "Acceptance" },
            { value: "receipt", label: "Receipt file" },
            { value: "version", label: "Document version" },
          ]}
        />
        <form
          className="space-y-5 px-5 py-6 sm:px-6"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          {mode === "acceptance" && (
            <Field
              label="Transaction signature or acceptance ID"
              htmlFor="tx"
              hint="From a receipt, a webhook, or a block explorer."
            >
              <Input
                id="tx"
                value={txInput}
                onChange={(e) => setTxInput(e.target.value)}
                placeholder="5h3K… or 8c1f…e04a"
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-[13px]"
              />
            </Field>
          )}
          {mode === "receipt" && (
            <div className="space-y-3">
              <Field
                label="Receipt (stele-receipt-v1, stele-receipt/2 or stele-proof-v1 JSON)"
                htmlFor="receipt"
                hint="Every claim in the receipt — including passkey evidence, fee payer and, for proofs, the statement — is re-checked against the chain; nothing in it is trusted."
              >
                <Textarea
                  id="receipt"
                  rows={8}
                  value={receiptText}
                  onChange={(e) => setReceiptText(e.target.value)}
                  placeholder='{ "format": "stele-receipt-v1", … }'
                  className="font-mono text-[12px]"
                  spellCheck={false}
                />
              </Field>
              <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-accent hover:text-accent-strong">
                <input
                  type="file"
                  accept="application/json,.json,application/pdf,.pdf"
                  className="sr-only"
                  onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
                />
                Upload a receipt (.json or .pdf)
              </label>
            </div>
          )}
          {mode === "version" && (
            <Field
              label="Version account address or fingerprint"
              htmlFor="version"
              hint="Checks the version's integrity, its publisher's authority and its content."
            >
              <Input
                id="version"
                value={versionInput}
                onChange={(e) => setVersionInput(e.target.value)}
                placeholder="Version address or 64-hex fingerprint"
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-[13px]"
              />
            </Field>
          )}

          <div>
            <button
              type="button"
              className="text-[13px] text-fg-muted hover:text-fg"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((s) => !s)}
            >
              {showAdvanced ? "▾" : "▸"} Verification sources (
              {rpcHosts(rpcText.split(/\s+/).filter(Boolean))})
            </button>
            {showAdvanced && (
              <div className="mt-4 space-y-4 rounded-xl border border-line bg-bg-raised p-4">
                <Field
                  label="Solana RPC endpoints (one per line)"
                  htmlFor="rpcs"
                  hint="With several endpoints, all must return identical data — a single lying provider makes the result inconclusive instead of valid."
                >
                  <Textarea
                    id="rpcs"
                    rows={3}
                    value={rpcText}
                    onChange={(e) => setRpcText(e.target.value)}
                    className="font-mono text-[12px]"
                    spellCheck={false}
                  />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Program ID" htmlFor="program">
                    <Input
                      id="program"
                      value={settings.programId}
                      onChange={(e) =>
                        setSettings({ ...settings, programId: e.target.value.trim() })
                      }
                      className="font-mono text-[12px]"
                      spellCheck={false}
                    />
                  </Field>
                  <Field
                    label="Required network (CAIP-2)"
                    htmlFor="chain"
                    hint="Leave empty to accept the network the RPC serves."
                  >
                    <Input
                      id="chain"
                      value={settings.expectedChainId}
                      onChange={(e) =>
                        setSettings({ ...settings, expectedChainId: e.target.value.trim() })
                      }
                      className="font-mono text-[12px]"
                      spellCheck={false}
                    />
                  </Field>
                </div>
                <div className="flex flex-col gap-2 text-[13px] text-fg-muted">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.ipfsGateways}
                      onChange={(e) => setSettings({ ...settings, ipfsGateways: e.target.checked })}
                      className="accent-[var(--color-accent)]"
                    />
                    Also fetch content from public IPFS and Arweave gateways
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.liveDns}
                      onChange={(e) => setSettings({ ...settings, liveDns: e.target.checked })}
                      className="accent-[var(--color-accent)]"
                    />
                    Check the organization&apos;s DNS record live (DNS-over-HTTPS)
                  </label>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" loading={running}>
              {running ? "Verifying against Solana…" : "Verify"}
            </Button>
            {running && (
              <span className="text-[12.5px] text-fg-subtle">
                Reading accounts and transactions from{" "}
                {rpcHosts(rpcText.split(/\s+/).filter(Boolean))}
              </span>
            )}
          </div>
        </form>
      </Card>

      {error && (
        <Alert tone="danger" title="Verification could not run">
          {error}
        </Alert>
      )}
      {note && <Alert tone="info">{note}</Alert>}
      {running && !result && (
        <div className="flex items-center gap-3 text-[13.5px] text-fg-muted">
          <Spinner className="h-4 w-4 text-accent" /> Checking network identity, program,
          transaction, signature, message, version and content…
        </div>
      )}
      {result && (
        <>
          <ReportView report={result.report} where={result.where} />
          <div>
            <p className="mb-2 text-[13px] font-medium text-fg">Reproduce from the command line</p>
            <CodeBlock code={result.cli} language="shell" />
          </div>
        </>
      )}
    </div>
  );
}
