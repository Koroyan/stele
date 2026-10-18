"use client";
/** Presents a verifier report exactly as computed — every check, its status and its detail. */
import { useMemo, useState } from "react";
import type { Check, VerificationReport } from "@stelehq/verifier";
import { describeStatement, formatSol, parseCanonicalContent, utf8 } from "@stelehq/protocol";
import {
  AlertIcon,
  Badge,
  Card,
  CheckCircleIcon,
  CheckIcon,
  Fingerprint,
  InfoIcon,
  KeyValue,
  XIcon,
  cn,
} from "@stele/ui";
import { formatDateTime, formatIso } from "@/lib/format";
import { ContentView } from "./content-view";

const VERDICT = {
  VALID: {
    tone: "border-verified-line bg-verified-soft",
    icon: <CheckCircleIcon className="h-6 w-6 text-verified" />,
    title: "Valid evidence",
  },
  VALID_WITH_WARNINGS: {
    tone: "border-verified-line bg-verified-soft",
    icon: <CheckCircleIcon className="h-6 w-6 text-verified" />,
    title: "Valid evidence, with warnings",
  },
  INVALID: {
    tone: "border-danger-line bg-danger-soft",
    icon: <XIcon className="h-6 w-6 text-danger" />,
    title: "Invalid — do not rely on this evidence",
  },
  INCONCLUSIVE: {
    tone: "border-warning-line bg-warning-soft",
    icon: <AlertIcon className="h-6 w-6 text-warning" />,
    title: "Inconclusive — verification could not be completed",
  },
} as const;

export function VerdictBanner({ report, where }: { report: VerificationReport; where: string }) {
  const v = VERDICT[report.verdict];
  const warnings = report.checks.filter((c) => c.status === "warn").length;
  return (
    <div
      className={cn("rounded-2xl border px-5 py-4 sm:px-6", v.tone)}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-4">
        <div className="mt-0.5 shrink-0">{v.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[16px] font-semibold tracking-[-0.01em] text-fg">{v.title}</p>
            {warnings > 0 && (
              <Badge tone="warning">{warnings === 1 ? "1 warning" : `${warnings} warnings`}</Badge>
            )}
          </div>
          <p className="mt-1 text-[13.5px] leading-relaxed text-fg-muted">{report.summary}</p>
          <p className="mt-2 text-[12px] text-fg-subtle">
            {where} · {report.checks.length} checks · finished {formatIso(report.finishedAt)} ·
            verifier {report.verifierVersion}
          </p>
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: Check["status"] }) {
  const base = "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border";
  if (status === "pass")
    return (
      <span
        className={cn(base, "border-verified-line bg-verified-soft text-verified")}
        aria-label="passed"
      >
        <CheckIcon className="h-3 w-3" />
      </span>
    );
  if (status === "fail")
    return (
      <span
        className={cn(base, "border-danger-line bg-danger-soft text-danger")}
        aria-label="failed"
      >
        <XIcon className="h-3 w-3" />
      </span>
    );
  if (status === "warn" || status === "error")
    return (
      <span
        className={cn(base, "border-warning-line bg-warning-soft text-warning")}
        aria-label={status === "warn" ? "warning" : "error"}
      >
        <AlertIcon className="h-3 w-3" />
      </span>
    );
  return (
    <span className={cn(base, "border-line-strong text-fg-subtle")} aria-label="skipped">
      <InfoIcon className="h-3 w-3" />
    </span>
  );
}

export function ChecksList({ checks }: { checks: Check[] }) {
  return (
    <ul className="divide-y divide-line">
      {checks.map((c, i) => (
        <li key={`${c.id}-${i}`} className="flex gap-3 px-5 py-3 sm:px-6">
          <StatusIcon status={c.status} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <p className="text-[13.5px] font-medium text-fg">{c.label}</p>
              <span className="font-mono text-[11px] text-fg-subtle">{c.id}</span>
              {!c.critical && <span className="text-[11px] text-fg-subtle">informational</span>}
            </div>
            <p className="mt-0.5 text-[13px] leading-relaxed break-words text-fg-muted">
              {c.detail}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function downloadJson(name: string, value: unknown) {
  download(name, `${JSON.stringify(value, null, 2)}\n`);
}

/** How the key was controlled and who paid the fee — both verified, never assumed. */
function SignerFeesCard({ report }: { report: VerificationReport }) {
  const { signer, fees, origin } = report.facts;
  if (!signer && !fees) return null;
  const passkey = signer?.type === "PASSKEY_PROTECTED_STELE_KEY" ? signer.passkey : undefined;
  const native = signer?.type === "NATIVE_PASSKEY" ? signer.native : undefined;
  const enrollment = native?.enrollment ?? null;
  return (
    <Card>
      <div className="border-b border-line px-5 py-3.5 sm:px-6">
        <p className="text-[14px] font-semibold text-fg">Signer and fees</p>
        <p className="mt-0.5 text-[12.5px] text-fg-muted">
          Who authorized the record, and who paid the network fee. Paying the fee never changes what
          was signed.
        </p>
      </div>
      <div className="px-5 py-5 sm:px-6">
        <KeyValue
          items={[
            {
              label: "Signer type",
              value:
                signer?.type === "NATIVE_PASSKEY" ? (
                  <Badge tone="verified">
                    <CheckIcon className="h-3 w-3" /> Native passkey (ES256 · P-256)
                  </Badge>
                ) : signer?.type === "PASSKEY_PROTECTED_STELE_KEY" ? (
                  <Badge tone="verified">
                    <CheckIcon className="h-3 w-3" /> Passkey-protected Stele key
                  </Badge>
                ) : signer?.type === "WALLET" ? (
                  "Wallet (self-custodied key)"
                ) : (
                  "Not specified — the signature proves control of the key"
                ),
            },
            ...(origin
              ? [
                  {
                    label: "Requesting site",
                    value:
                      origin.attestation === "BROWSER_ATTESTED" ? (
                        <span>
                          <span className="font-mono text-[12.5px]">{origin.origin}</span> —
                          attested by the browser
                        </span>
                      ) : (
                        <span>
                          <span className="font-mono text-[12.5px]">{origin.requestDomain}</span> —
                          stated by the requesting server, not attested by a browser
                        </span>
                      ),
                  },
                ]
              : []),
            ...(native
              ? [
                  {
                    label: "Passkey key",
                    value: <Fingerprint value={native.publicKey} mode="full" />,
                  },
                  { label: "Relying party", value: native.rpId },
                  {
                    label: "User verification",
                    value: "Asserted by the authenticator (biometric or device PIN)",
                  },
                  {
                    label: "Synced passkey",
                    value: native.backedUp ? "Yes (backed up by the passkey provider)" : "No",
                  },
                  {
                    label: "Enrollment",
                    value: enrollment ? (
                      <span>
                        <Fingerprint value={enrollment.address} /> · generation{" "}
                        {enrollment.generation} ·{" "}
                        {enrollment.kind === "ORGANIZATION_RECOVERY"
                          ? "last changed by organization recovery"
                          : enrollment.kind === "ROTATED"
                            ? "last changed by an endorsed rotation"
                            : "enrolled"}
                        {enrollment.status === "REVOKED" ? " · revoked since" : ""}
                      </span>
                    ) : (
                      "Key-only signer (not bound to an account)"
                    ),
                  },
                ]
              : []),
            ...(passkey
              ? [
                  {
                    label: "Passkey",
                    value: <span className="font-mono text-[12.5px]">{passkey.credentialId}</span>,
                  },
                  { label: "Relying party", value: passkey.rpId },
                  { label: "Approved on", value: passkey.origin },
                  { label: "Key registered", value: formatDateTime(passkey.keyRegisteredAt) },
                ]
              : []),
            ...(fees
              ? [
                  { label: "Fee payer", value: <Fingerprint value={fees.payer} /> },
                  {
                    label: "Network fee",
                    value:
                      fees.feeLamports !== null
                        ? `${formatSol(BigInt(fees.feeLamports))} SOL (${fees.feeLamports} lamports)`
                        : "Not reported by the RPC endpoint",
                  },
                  {
                    label: "Sponsored by",
                    value:
                      fees.sponsor === "ORGANIZATION"
                        ? `The organization (reimbursed ${fees.reimbursedLamports} lamports on-chain)`
                        : "Stele's relayer",
                  },
                  { label: "Signer paid", value: fees.signerPaid ? "Yes" : "Nothing" },
                ]
              : []),
          ]}
        />
        {native && (
          <p className="mt-4 text-[12.5px] leading-relaxed text-fg-muted">
            The passkey&apos;s own key signed a challenge derived from this exact message, with user
            verification checked on the device (no biometric data is part of the evidence), and
            Solana&apos;s secp256r1 program verified it on-chain. The passkey prompt shows the site,
            not the agreement text — the text is what the requesting page displayed. This shows
            control of the passkey at that moment; it does not by itself identify a person.
          </p>
        )}
        {passkey && (
          <p className="mt-4 text-[12.5px] leading-relaxed text-fg-muted">
            The passkey approved this exact message with user verification (a biometric or device
            PIN checked on the device — no biometric data is part of the evidence). This shows
            control of the passkey and its key at that moment; it does not by itself identify a
            person.
          </p>
        )}
      </div>
    </Card>
  );
}

function ProofCards({ report }: { report: VerificationReport }) {
  const { proof, statement } = report.facts;
  if (!proof) return null;
  const lines = statement ? describeStatement(statement) : null;
  return (
    <>
      <Card className="lg:col-span-2">
        <div className="border-b border-line px-5 py-3.5 sm:px-6">
          <p className="text-[14px] font-semibold text-fg">
            Proof — {proof.type.replace(/_/g, " ").toLowerCase()}
          </p>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">
            The signer confirmed the statement identified by its SHA-256 below.
          </p>
        </div>
        <div className="px-5 py-5 sm:px-6">
          <KeyValue
            items={[
              { label: "Signer", value: <Fingerprint value={proof.signer} mode="full" /> },
              {
                label: "Recorded",
                value: proof.blockTime ? formatDateTime(proof.blockTime) : `slot ${proof.slot}`,
              },
              {
                label: "Requested by",
                value: <span className="font-mono text-[12.5px]">{proof.requestDomain}</span>,
              },
              { label: "Statement SHA-256", value: <Fingerprint value={proof.statementHash} /> },
              { label: "Transaction", value: <Fingerprint value={proof.transaction} /> },
              { label: "Proof ID", value: <Fingerprint value={proof.proofId} /> },
            ]}
          />
          <p className="mt-6 text-[12.5px] font-medium text-fg-muted">Exact message signed</p>
          <pre className="mt-2 overflow-x-auto rounded-xl border border-line bg-[#060a0f] p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre text-fg">
            {proof.message}
          </pre>
        </div>
      </Card>
      {lines && (
        <Card className="lg:col-span-2">
          <div className="border-b border-line px-5 py-3.5 sm:px-6">
            <p className="text-[14px] font-semibold text-fg">Statement</p>
            <p className="mt-0.5 text-[12.5px] text-fg-muted">
              Supplied with the receipt; its hash equals the hash the signer confirmed.
            </p>
          </div>
          <ul className="space-y-1.5 px-5 py-5 text-[13.5px] text-fg sm:px-6">
            {lines.map((l, i) => (
              <li key={i} className={i === 0 ? "font-semibold" : undefined}>
                {l}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

export function ReportView({ report, where }: { report: VerificationReport; where: string }) {
  const [showContent, setShowContent] = useState(false);
  const f = report.facts;
  const content = useMemo(() => {
    if (!f.content) return null;
    try {
      return parseCanonicalContent(utf8(f.content.canonical));
    } catch {
      return null;
    }
  }, [f.content]);

  return (
    <div className="space-y-6">
      <VerdictBanner report={report} where={where} />

      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5 sm:px-6">
          <p className="text-[14px] font-semibold text-fg">Checks</p>
          <button
            type="button"
            className="text-[12.5px] text-fg-muted hover:text-fg"
            onClick={() =>
              downloadJson(`stele-report-${report.subject.reference.slice(0, 16)}.json`, report)
            }
          >
            Download report (JSON)
          </button>
        </div>
        <ChecksList checks={report.checks} />
      </Card>

      {(f.organization || f.version || f.acceptance || f.proof) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ProofCards report={report} />
          {f.acceptance && (
            <Card className="lg:col-span-2">
              <div className="border-b border-line px-5 py-3.5 sm:px-6">
                <p className="text-[14px] font-semibold text-fg">Acceptance</p>
                <p className="mt-0.5 text-[12.5px] text-fg-muted">
                  Proves that this key signed the message below. It does not by itself identify the
                  person who controls the key.
                </p>
              </div>
              <div className="px-5 py-5 sm:px-6">
                <KeyValue
                  items={[
                    {
                      label: "Signer",
                      value: <Fingerprint value={f.acceptance.signer} mode="full" />,
                    },
                    {
                      label: "Protocol",
                      value:
                        f.acceptance.protocol === "stele/2"
                          ? "stele/2 — native passkey (secp256r1 verified on-chain)"
                          : "stele/1 — Ed25519 signature over the message",
                    },
                    {
                      label: "Recorded",
                      value: f.acceptance.blockTime
                        ? formatDateTime(f.acceptance.blockTime)
                        : `slot ${f.acceptance.slot}`,
                    },
                    {
                      label: "Commitment",
                      value:
                        f.acceptance.commitment === "finalized"
                          ? "Finalized"
                          : "Confirmed (not yet finalized)",
                    },
                    {
                      label: "Requested by",
                      value: (
                        <span className="font-mono text-[12.5px]">
                          {f.acceptance.requestDomain}
                        </span>
                      ),
                    },
                    {
                      label: "Transaction",
                      value: <Fingerprint value={f.acceptance.transaction} />,
                    },
                    {
                      label: "Acceptance ID",
                      value: <Fingerprint value={f.acceptance.acceptanceId} />,
                    },
                    {
                      label: "Nonce",
                      value: (
                        <span className="font-mono text-[12.5px]">{`${f.acceptance.nonce.shardId}-${f.acceptance.nonce.index}-${f.acceptance.nonce.tag}`}</span>
                      ),
                    },
                  ]}
                />
                <p className="mt-6 text-[12.5px] font-medium text-fg-muted">Exact message signed</p>
                {f.acceptance.message !== null ? (
                  <pre className="mt-2 overflow-x-auto rounded-xl border border-line bg-[#060a0f] p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre text-fg">
                    {f.acceptance.message}
                  </pre>
                ) : (
                  <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
                    Only the SHA-256 of the signed text ({f.acceptance.messageHash.slice(0, 16)}…)
                    is on-chain, and it could not be rebuilt from current chain data. Verify with
                    the receipt to see the exact text.
                  </p>
                )}
              </div>
            </Card>
          )}
          <SignerFeesCard report={report} />
          {f.organization && (
            <Card>
              <div className="border-b border-line px-5 py-3.5 sm:px-6">
                <p className="text-[14px] font-semibold text-fg">Organization</p>
              </div>
              <div className="px-5 py-5 sm:px-6">
                <KeyValue
                  items={[
                    { label: "Name (self-declared)", value: f.organization.name },
                    {
                      label: "Domain",
                      value: f.organization.verifiedDomain ? (
                        <Badge tone="verified">
                          <CheckIcon className="h-3 w-3" /> {f.organization.verifiedDomain}
                        </Badge>
                      ) : (
                        <Badge tone="warning">Unverified</Badge>
                      ),
                    },
                    ...(f.organization.domainAttestation
                      ? [
                          {
                            label: "Domain evidence",
                            value: (
                              <span className="text-[12.5px]">
                                Attestor{" "}
                                <Fingerprint value={f.organization.domainAttestation.attestor} />{" "}
                                found{" "}
                                <span className="font-mono">
                                  {f.organization.domainAttestation.dnsName} TXT &quot;
                                  {f.organization.domainAttestation.dnsValue}&quot;
                                </span>{" "}
                                on {formatDateTime(f.organization.domainAttestation.verifiedAt)}
                                {f.organization.domainAttestation.liveDnsChecked
                                  ? " · re-checked live"
                                  : " · re-check it in DNS yourself"}
                              </span>
                            ),
                          },
                        ]
                      : []),
                    { label: "Account", value: <Fingerprint value={f.organization.address} /> },
                    {
                      label: "Owner authority",
                      value: <Fingerprint value={f.organization.owner} />,
                    },
                  ]}
                />
              </div>
            </Card>
          )}
          {f.version && (
            <Card>
              <div className="border-b border-line px-5 py-3.5 sm:px-6">
                <p className="text-[14px] font-semibold text-fg">Document version</p>
              </div>
              <div className="px-5 py-5 sm:px-6">
                <KeyValue
                  items={[
                    { label: "Title", value: f.version.title },
                    {
                      label: "Version",
                      value: `${f.version.label} (#${f.version.number})${f.version.superseded ? " — superseded" : ""}`,
                    },
                    { label: "Fingerprint", value: <Fingerprint value={f.version.fingerprint} /> },
                    {
                      label: "Content SHA-256",
                      value: <Fingerprint value={f.version.contentHash} />,
                    },
                    { label: "Published", value: formatDateTime(f.version.publishedAt) },
                    {
                      label: "Effective",
                      value: f.version.effectiveAt
                        ? formatDateTime(f.version.effectiveAt)
                        : "Upon publication",
                    },
                    { label: "Publisher", value: <Fingerprint value={f.version.publisher} /> },
                  ]}
                />
              </div>
            </Card>
          )}
        </div>
      )}

      {content && (
        <Card>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5 sm:px-6">
            <div>
              <p className="text-[14px] font-semibold text-fg">Document text</p>
              <p className="mt-0.5 text-[12.5px] text-fg-muted">
                Source: {f.content?.source}. Its SHA-256 matches the on-chain commitment.
              </p>
            </div>
            <button
              type="button"
              className="text-[12.5px] text-accent hover:text-accent-strong"
              onClick={() => setShowContent((s) => !s)}
              aria-expanded={showContent}
            >
              {showContent ? "Hide" : "Show"}
            </button>
          </div>
          {showContent && <ContentView content={content} className="px-5 py-5 sm:px-6" />}
        </Card>
      )}

      <Card className="px-5 py-4 sm:px-6">
        <p className="text-[13px] font-medium text-fg">Sources consulted</p>
        <ul className="mt-2 space-y-1 text-[12.5px] text-fg-muted">
          <li>
            Chain: <span className="font-mono">{report.sources.chain}</span>
          </li>
          {report.sources.content.map((c, i) => (
            <li key={i}>
              Content: <span className="font-mono break-all">{c.source}</span> — {c.outcome}
              {c.detail ? ` (${c.detail})` : ""}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
