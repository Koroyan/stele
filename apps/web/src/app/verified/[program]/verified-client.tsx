"use client";
/**
 * The evidence behind a Stele Verified badge: which program, which organization and terms, what
 * the probes showed, who can change the program — and a button that re-runs the probes in the
 * visitor's own browser against Solana, so the verdict does not rest on Stele's word.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { PROBE_SCENARIOS } from "@stelehq/protocol";
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckIcon,
  CopyButton,
  ExternalIcon,
  Fingerprint,
  KeyValue,
  Skeleton,
  Spinner,
  XIcon,
} from "@stele/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { addressExplorerUrl, rpcUrls, txExplorerUrl } from "@/lib/chain";
import { formatDateTime } from "@/lib/format";
import {
  isOrganizationHost,
  recheckInBrowser,
  type BrowserCheck,
  type VerifiedView,
} from "@/lib/verified";
import { useNetwork } from "@/lib/wallet";

const AUTHORITY: Record<
  "immutable" | "program" | "key",
  { label: string; tone: "verified" | "neutral" | "warning"; text: string }
> = {
  immutable: {
    label: "Nobody (immutable)",
    tone: "verified",
    text: "The program can never be changed: this verification holds for as long as it exists.",
  },
  program: {
    label: "A program (e.g. a multisig)",
    tone: "neutral",
    text: "Upgrades need the approval of a program-controlled account, such as a multisig. Stele re-checks after every upgrade.",
  },
  key: {
    label: "A single key",
    tone: "warning",
    text: "One key can replace the program at any time. Stele re-checks after every upgrade, but the program could change between two checks.",
  },
};

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 129_600) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86_400)} days ago`;
}

/** The badge's tablet, large: a check when verified. */
function Seal({ status }: { status: VerifiedView["status"] }) {
  const tone =
    status === "verified"
      ? "text-verified border-verified-line bg-verified-soft"
      : status === "failed"
        ? "text-danger border-danger-line bg-danger-soft"
        : "text-fg-muted border-line-strong bg-surface-3";
  return (
    <span
      className={`grid h-14 w-14 flex-none place-items-center rounded-full border ${tone}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" className="h-8 w-8" fill="none" stroke="currentColor">
        <path d="M9.5 4.5h13l4 4v19h-21v-19z" strokeWidth="2" strokeLinejoin="round" />
        {status === "verified" ? (
          <path
            d="M11.6 16.4l3.3 3.3 6.4-6.7"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : status === "failed" ? (
          <path d="M16 11.5v5.5M16 21h.01" strokeWidth="2.4" strokeLinecap="round" />
        ) : (
          <path
            d="M10.5 12.5h11M10.5 16.5h11M10.5 20.5h6"
            strokeWidth="2"
            strokeLinecap="round"
            opacity=".7"
          />
        )}
      </svg>
    </span>
  );
}

function Outcome({ outcome }: { outcome: "passed" | "failed" | "skipped" }) {
  if (outcome === "passed")
    return (
      <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-verified-soft text-verified">
        <CheckIcon className="h-3.5 w-3.5" />
      </span>
    );
  if (outcome === "failed")
    return (
      <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-danger-soft text-danger">
        <XIcon className="h-3.5 w-3.5" />
      </span>
    );
  return (
    <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-surface-3 text-fg-subtle">
      –
    </span>
  );
}

/** Where the visitor came from, against the organization's verified domains. */
function Origin({ view }: { view: VerifiedView }) {
  const [from, setFrom] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    try {
      const host = document.referrer ? new URL(document.referrer).hostname : null;
      setFrom(host && host !== window.location.hostname ? host : null);
    } catch {
      setFrom(null);
    }
  }, []);
  const { name, domains } = view.organization;
  if (from === undefined) return null;
  if (domains.length === 0)
    return (
      <Alert
        tone="warning"
        title={`${name} has not verified a website with Stele`}
        className="mt-6"
      >
        This page proves what the program below does. It cannot tell you which website belongs to{" "}
        {name}.
      </Alert>
    );
  const list = domains.join(", ");
  if (from && isOrganizationHost(from, domains))
    return (
      <Alert tone="success" title={`You came from ${from}`} className="mt-6">
        It is one of {name}&apos;s verified websites ({list}): this badge is theirs.
      </Alert>
    );
  if (from)
    return (
      <Alert
        tone="danger"
        title={`You came from ${from} — this badge does not belong to it`}
        className="mt-6"
      >
        This verification is {name}&apos;s, valid only on {list}. A copy of the badge on another
        site proves nothing about that site.
      </Alert>
    );
  return (
    <Alert tone="info" title={`Valid only on ${list}`} className="mt-6">
      This verification belongs to {name}. If the badge you clicked was on another website, it is a
      copy and proves nothing about that site.
    </Alert>
  );
}

export function VerifiedClient({ program }: { program: string }) {
  const network = useNetwork();
  const [view, setView] = useState<VerifiedView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [browser, setBrowser] = useState<BrowserCheck[] | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [recheckError, setRecheckError] = useState<string | null>(null);

  useEffect(() => {
    api<VerifiedView>(`/v1/public/verified/${program}`)
      .then(setView)
      .catch((e: unknown) =>
        setError(
          e instanceof ApiError && e.status === 404
            ? "No organization has asked Stele to verify this program."
            : errorMessage(e),
        ),
      );
  }, [program]);

  async function recheck() {
    if (!view) return;
    setRechecking(true);
    setRecheckError(null);
    try {
      setBrowser(await recheckInBrowser(network, view));
    } catch (e) {
      setRecheckError(errorMessage(e));
    } finally {
      setRechecking(false);
    }
  }

  if (error)
    return (
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <Alert tone="warning" title="Not a verified program">
          {error} A badge that links here is not backed by a Stele verification.
        </Alert>
      </div>
    );
  if (!view)
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-14 sm:px-6">
        <Skeleton className="h-14 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-48 w-full" />
      </div>
    );

  const verified = view.status === "verified";
  const headline = verified
    ? `${view.organization.name} enforces its ${view.document.title} on-chain`
    : view.status === "failed"
      ? "Not verified: enforcement of the terms is not confirmed"
      : "Verification pending";
  const authority = view.code ? AUTHORITY[view.code.authorityKind] : null;
  const rpcHost = (() => {
    try {
      return new URL(rpcUrls(network)[0]!).host;
    } catch {
      return "your RPC";
    }
  })();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex items-start gap-4">
        <Seal status={view.status} />
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium uppercase tracking-[0.12em] text-accent">
            Stele Verified
          </p>
          <h1 className="mt-1 text-balance text-[26px] font-semibold leading-tight tracking-[-0.025em] text-fg sm:text-[32px]">
            {headline}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
            {verified
              ? `Its Solana program refuses the protected action until the wallet has accepted version ${view.document.requiredVersion} (or later) of the ${view.document.title}.`
              : (view.reason ?? "Stele has not checked this program yet.")}{" "}
            {view.checkedAt && (
              <span className="text-fg-subtle">
                Checked {ago(view.checkedAt)} on {view.network.label}
                {view.verifiedSince && verified
                  ? ` · verified since ${formatDateTime(view.verifiedSince)}`
                  : ""}
                .
              </span>
            )}
          </p>
        </div>
      </div>

      <Origin view={view} />

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Card className="p-6">
            <h2 className="text-[16px] font-semibold text-fg">What Stele checked</h2>
            <p className="mt-1 text-[13px] text-fg-muted">
              Stele sends these transactions to the deployed program in simulation — nothing is
              signed or sent — and repeats them after every program upgrade.
            </p>
            <ol className="mt-5 space-y-4">
              {PROBE_SCENARIOS.map((s) => {
                const c = view.checks.find((x) => x.id === s.id);
                const b = browser?.find((x) => x.id === s.id);
                return (
                  <li key={s.id} className="flex gap-3">
                    <Outcome outcome={c?.outcome ?? "skipped"} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium text-fg">{s.label}</p>
                      <p className="mt-0.5 text-[13px] text-fg-muted">
                        {c?.detail ?? "Not checked yet."}
                        {c?.error && (
                          <code className="ml-2 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11.5px] text-fg-muted">
                            {c.error}
                          </code>
                        )}
                      </p>
                      {b && (
                        <p
                          className={`mt-1 text-[12.5px] ${b.outcome === "passed" ? "text-verified" : b.outcome === "failed" ? "text-danger" : "text-fg-subtle"}`}
                        >
                          Your browser:{" "}
                          {b.outcome === "passed"
                            ? "same result"
                            : b.outcome === "failed"
                              ? "different result"
                              : "not run"}
                          {b.error ? ` (${b.error})` : ""}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
              <Button
                variant="secondary"
                onClick={() => void recheck()}
                disabled={rechecking || !view.recheck}
              >
                {rechecking && <Spinner className="h-4 w-4" />}
                Re-check in my browser
              </Button>
              <p className="text-[12.5px] text-fg-subtle">
                Runs the same simulations from this browser against {rpcHost}. You do not have to
                trust Stele.
              </p>
            </div>
            {recheckError && (
              <Alert tone="danger" className="mt-4">
                {recheckError}
              </Alert>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="text-[16px] font-semibold text-fg">The terms</h2>
            <p className="mt-2 text-[14px] text-fg">
              {view.document.title}{" "}
              <Badge tone="accent">version {view.document.requiredVersion} or later</Badge>
            </p>
            <p className="mt-2 text-[13px] text-fg-muted">
              Published by {view.organization.name} on Solana. The program checks Stele policy{" "}
              <Fingerprint value={view.policy} />, which only {view.organization.name} can change —
              every change is public.
            </p>
            <Link
              href={`/accept/${view.organization.address}/${view.document.slug}`}
              className="mt-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-accent hover:underline"
            >
              Read the terms <ExternalIcon className="h-3.5 w-3.5" />
            </Link>
          </Card>

          <Card className="p-6">
            <h2 className="text-[16px] font-semibold text-fg">Before you sign</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">
              This page proves what one program does. Your wallet shows which program a transaction
              calls: for this verification to apply, it must be this one.
            </p>
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2">
              <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg">
                {view.program}
              </code>
              <CopyButton value={view.program} />
            </div>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold text-fg">The program</h2>
            <KeyValue
              className="mt-4 !grid-cols-1"
              items={[
                {
                  label: "Address",
                  value: (
                    <a
                      href={addressExplorerUrl(network, view.program)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[12.5px] text-accent hover:underline"
                    >
                      {view.program.slice(0, 6)}…{view.program.slice(-6)}
                      <ExternalIcon className="h-3 w-3" />
                    </a>
                  ),
                },
                ...(view.code?.codeHash
                  ? [
                      {
                        label: "Code fingerprint",
                        value: <Fingerprint value={view.code.codeHash} />,
                      },
                    ]
                  : []),
                ...(view.code?.deployedSlot
                  ? [
                      {
                        label: "Last deployed",
                        value: (
                          <span className="font-mono text-[12.5px]">
                            slot {view.code.deployedSlot.toLocaleString("en-US")}
                          </span>
                        ),
                      },
                    ]
                  : []),
                ...(authority
                  ? [
                      {
                        label: "Who can change it",
                        value: (
                          <span className="grid justify-items-start gap-1">
                            <Badge tone={authority.tone}>{authority.label}</Badge>
                            <span className="text-[12px] leading-relaxed text-fg-subtle">
                              {authority.text}
                            </span>
                          </span>
                        ),
                      },
                    ]
                  : []),
                {
                  label: "Ownership",
                  value: view.ownership?.current ? (
                    <span className="grid justify-items-start gap-1">
                      <Badge tone="verified">Proven by its upgrade authority</Badge>
                      <a
                        href={txExplorerUrl(network, view.ownership.signature)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
                      >
                        Signed memo <ExternalIcon className="h-3 w-3" />
                      </a>
                    </span>
                  ) : view.code?.authorityKind === "immutable" ? (
                    <span className="text-[12.5px] text-fg-muted">
                      Immutable: no authority to prove it
                    </span>
                  ) : (
                    <Badge tone="neutral">Not proven</Badge>
                  ),
                },
              ]}
            />
          </Card>
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold text-fg">What this does not prove</h2>
            <ul className="mt-3 list-disc space-y-2 pl-4 text-[12.5px] leading-relaxed text-fg-muted">
              <li>
                That a website sends you to this program — compare the address in your wallet.
              </li>
              <li>Who controls a wallet (not KYC), or that the terms are fair or enforceable.</li>
              <li>
                What the program does besides this check. Stele verifies one thing: that the action
                waits for the current terms.
              </li>
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
