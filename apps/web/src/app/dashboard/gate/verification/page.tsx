"use client";
/**
 * Stele Verified for a registered program: describe how the protected instruction is called, let
 * Stele probe the deployed program, prove ownership with the upgrade authority, and add the badge.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AccountRole, address, isAddress } from "@solana/kit";
import { anchorDiscriminator, toHex, utf8 } from "@stelehq/protocol";
import {
  Alert,
  Badge,
  Button,
  CheckIcon,
  CodeTabs,
  ExternalIcon,
  Fingerprint,
  Input,
  Select,
  Spinner,
  XIcon,
} from "@stele/ui";
import {
  EnableGate,
  GateTabs,
  type GateOverview,
  type ProbeTemplate,
  type ProgramVerification,
} from "@/components/dashboard/gate";
import { PageHeader, Panel, TxLink, useTransaction } from "@/components/dashboard/ui";
import { api, errorMessage } from "@/lib/api";
import { useDashboard } from "@/lib/dashboard";
import { formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useNetwork, useWallet } from "@/lib/wallet";

type Role = ProbeTemplate["accounts"][number]["role"];
interface Row {
  role: Role;
  address: string;
  signer: boolean;
  writable: boolean;
}

const ROLES: { value: Role; label: string }[] = [
  { value: "user", label: "The user's wallet (signer)" },
  { value: "passport", label: "The user's Stele passport" },
  { value: "accessPass", label: "The user's Stele access pass" },
  { value: "policy", label: "Your Stele policy" },
  { value: "address", label: "A fixed account" },
];

/** The layout of the guide's and Solana Playground's example: user, policy, passport. */
const DEFAULT_ROWS: Row[] = [
  { role: "user", address: "", signer: true, writable: false },
  { role: "policy", address: "", signer: false, writable: false },
  { role: "passport", address: "", signer: false, writable: false },
];

const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

const SCENARIOS: Record<string, string> = {
  refuses_without_acceptance: "A wallet that never accepted is refused",
  allows_with_acceptance: "A wallet that accepted the required version is let through",
  refuses_borrowed_passport: "Someone else's acceptance is refused",
};

function StatusBadge({ v }: { v: ProgramVerification | null }) {
  if (!v) return <Badge tone="neutral">Not checked</Badge>;
  if (v.status === "verified") return <Badge tone="verified">Verified</Badge>;
  if (v.status === "failed") return <Badge tone="danger">Not verified</Badge>;
  return <Badge tone="warning">Incomplete</Badge>;
}

export default function GateVerificationPage() {
  const { detail } = useDashboard();
  const network = useNetwork();
  const wallet = useWallet();
  const tx = useTransaction();
  const orgId = detail?.organization.id;
  const enabled = detail?.organization.settings.products?.gate === true;
  const overview = useApi<GateOverview>(
    orgId && enabled ? `/v1/organizations/${orgId}/gate` : null,
  );
  const [programId, setProgramId] = useState("");
  const program = overview.data?.programs.find((p) => p.id === programId) ?? null;
  useEffect(() => {
    const first = overview.data?.programs[0];
    if (!programId && first) setProgramId(first.id);
  }, [overview.data, programId]);

  // The instruction editor, loaded from the saved template when there is one.
  const [mode, setMode] = useState<"anchor" | "raw">("anchor");
  const [name, setName] = useState("");
  const [args, setArgs] = useState("");
  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<Row[]>(DEFAULT_ROWS);
  useEffect(() => {
    if (!program) return;
    const t = program.probeTemplate;
    setName(program.action);
    setArgs("");
    if (t) {
      setMode("raw");
      setRaw(t.data);
      setRows(t.accounts.map((a) => ({ ...a, address: a.address ?? "" })));
    } else {
      setMode("anchor");
      setRaw("");
      setRows(DEFAULT_ROWS);
    }
  }, [program]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memo, setMemo] = useState<string | null>(null);
  const [signature, setSignature] = useState("");
  useEffect(() => {
    setMemo(null);
    if (!orgId || !programId) return;
    api<{ memo: string }>(`/v1/organizations/${orgId}/gate/programs/${programId}/ownership`)
      .then((r) => setMemo(r.memo))
      .catch(() => setMemo(null));
  }, [orgId, programId]);

  const data = useMemo(() => {
    if (mode === "raw") return raw.replace(/\s+/g, "").toLowerCase();
    const cleanArgs = args.replace(/\s+/g, "").toLowerCase();
    return name.trim() ? toHex(anchorDiscriminator("global", name.trim())) + cleanArgs : "";
  }, [mode, raw, name, args]);
  const rowError = rows.find((r) => r.role === "address" && !isAddress(r.address.trim()))
    ? "Every fixed account needs a valid address."
    : !/^([0-9a-f]{2})*$/.test(data)
      ? "Instruction data must be hex bytes (two characters per byte)."
      : null;

  if (!detail) return null;
  const canAdmin = detail.role === "owner" || detail.role === "admin";
  const v = program?.verification ?? null;
  const authority = v?.program.upgradeAuthority ?? null;
  const ownershipCurrent = !!program?.ownership && program.ownership.authority === authority;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const pageUrl = program ? `${origin}/verified/${program.programAddress}` : "";
  const badgeUrl = program
    ? `${origin}/api/v1/public/verified/${program.programAddress}/badge.svg`
    : "";

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const next = [...rs];
      const j = i + d;
      if (j < 0 || j >= next.length) return rs;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  async function saveAndVerify() {
    if (!program) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/organizations/${orgId}/gate/programs/${program.id}/probe`, {
        method: "PUT",
        body: {
          data,
          accounts: rows.map((r) => ({
            role: r.role,
            ...(r.role === "address" ? { address: r.address.trim() } : {}),
            signer: r.signer,
            writable: r.writable,
          })),
        },
      });
      await api(`/v1/organizations/${orgId}/gate/programs/${program.id}/verify`, {
        method: "POST",
      });
      overview.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitOwnership(sig: string) {
    if (!program) return;
    setError(null);
    try {
      await api(`/v1/organizations/${orgId}/gate/programs/${program.id}/ownership`, {
        body: { signature: sig.trim() },
      });
      setSignature("");
      overview.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function signMemo() {
    if (!memo) return;
    await tx.run(
      (signer) => [
        {
          programAddress: address(MEMO_PROGRAM),
          accounts: [{ address: signer.address, role: AccountRole.READONLY_SIGNER, signer }],
          data: utf8(memo),
        } as never,
      ],
      submitOwnership,
    );
  }

  return (
    <>
      <PageHeader
        title="Verification"
        description="Stele Verified: Stele proves — on your deployed program, re-checked after every upgrade — that the protected action waits for your current terms. Your users see it as a badge."
      />
      {!enabled ? (
        <EnableGate />
      ) : (
        <>
          <GateTabs />
          {(overview.data?.programs.length ?? 0) === 0 && !overview.loading ? (
            <Alert tone="info" className="mt-6">
              Register your program first —{" "}
              <Link href="/dashboard/gate/programs" className="text-accent">
                Program integration
              </Link>
              .
            </Alert>
          ) : program ? (
            <div className="mt-6 space-y-6">
              {(overview.data?.programs.length ?? 0) > 1 && (
                <Select
                  aria-label="Program"
                  value={programId}
                  onChange={(e) => setProgramId(e.target.value)}
                  className="w-72"
                >
                  {overview.data!.programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} · {p.programAddress.slice(0, 6)}…
                    </option>
                  ))}
                </Select>
              )}
              {error && <Alert tone="danger">{error}</Alert>}

              <Panel
                title="1. How is the protected instruction called?"
                description="Stele simulates this instruction against your deployed program — nothing is signed or sent. List the accounts in the order of your instruction's accounts."
              >
                <div className="grid gap-4">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={mode === "anchor" ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => setMode("anchor")}
                    >
                      Anchor instruction
                    </Button>
                    <Button
                      variant={mode === "raw" ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => setMode("raw")}
                    >
                      Raw data (hex)
                    </Button>
                  </div>
                  {mode === "anchor" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1.5 text-[13px] text-fg-muted">
                        Instruction name
                        <Input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="protected_action"
                          className="font-mono"
                        />
                      </label>
                      <label className="grid gap-1.5 text-[13px] text-fg-muted">
                        Arguments (Borsh, hex — empty if none)
                        <Input
                          value={args}
                          onChange={(e) => setArgs(e.target.value)}
                          placeholder="e.g. 0100000000000000 for amount: u64 = 1"
                          className="font-mono"
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="grid gap-1.5 text-[13px] text-fg-muted">
                      Instruction data (hex)
                      <Input
                        value={raw}
                        onChange={(e) => setRaw(e.target.value)}
                        className="font-mono"
                      />
                    </label>
                  )}
                  {mode === "anchor" && (
                    <p className="text-[12.5px] text-fg-subtle">
                      Data: <code className="break-all font-mono text-fg-muted">{data || "—"}</code>
                    </p>
                  )}

                  <div className="grid gap-2">
                    {rows.map((r, i) => (
                      <div
                        key={i}
                        className="grid items-center gap-2 rounded-xl border border-line p-2.5 sm:grid-cols-[28px_minmax(0,220px)_minmax(0,1fr)_auto]"
                      >
                        <span className="text-center font-mono text-[12px] text-fg-subtle">
                          {i}
                        </span>
                        <Select
                          aria-label={`Account ${i}`}
                          value={r.role}
                          onChange={(e) => update(i, { role: e.target.value as Role })}
                        >
                          {ROLES.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                        {r.role === "address" ? (
                          <Input
                            aria-label={`Account ${i} address`}
                            value={r.address}
                            onChange={(e) => update(i, { address: e.target.value })}
                            placeholder="Account address"
                            className="font-mono"
                          />
                        ) : (
                          <span className="text-[12.5px] text-fg-subtle">
                            Filled in per scenario
                          </span>
                        )}
                        <div className="flex items-center gap-3 text-[12.5px] text-fg-muted">
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={r.signer}
                              onChange={(e) => update(i, { signer: e.target.checked })}
                            />
                            signer
                          </label>
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={r.writable}
                              onChange={(e) => update(i, { writable: e.target.checked })}
                            />
                            writable
                          </label>
                          <button
                            type="button"
                            aria-label="Move up"
                            className="px-1 text-fg-subtle hover:text-fg"
                            onClick={() => move(i, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label="Move down"
                            className="px-1 text-fg-subtle hover:text-fg"
                            onClick={() => move(i, 1)}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            aria-label="Remove"
                            className="px-1 text-fg-subtle hover:text-danger"
                            onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                          >
                            <XIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                    <div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setRows((rs) => [
                            ...rs,
                            { role: "address", address: "", signer: false, writable: false },
                          ])
                        }
                      >
                        Add account
                      </Button>
                    </div>
                  </div>
                  {rowError && <p className="text-[13px] text-danger">{rowError}</p>}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => void saveAndVerify()}
                      disabled={busy || !canAdmin || !!rowError || !data}
                    >
                      {busy && <Spinner className="h-4 w-4" />}
                      Save and verify
                    </Button>
                    {!canAdmin && (
                      <span className="text-[12.5px] text-fg-subtle">
                        An owner or admin can change this.
                      </span>
                    )}
                  </div>
                </div>
              </Panel>

              <Panel
                title="2. Result"
                description="Re-checked automatically after every upgrade of the program, and at least every six hours."
                actions={<StatusBadge v={v} />}
              >
                {v ? (
                  <div className="grid gap-5">
                    <ol className="grid gap-3">
                      {v.checks.map((c) => (
                        <li key={c.id} className="flex gap-3">
                          <span
                            className={`grid h-6 w-6 flex-none place-items-center rounded-full ${
                              c.outcome === "passed"
                                ? "bg-verified-soft text-verified"
                                : c.outcome === "failed"
                                  ? "bg-danger-soft text-danger"
                                  : "bg-surface-3 text-fg-subtle"
                            }`}
                          >
                            {c.outcome === "passed" ? (
                              <CheckIcon className="h-3.5 w-3.5" />
                            ) : c.outcome === "failed" ? (
                              <XIcon className="h-3.5 w-3.5" />
                            ) : (
                              "–"
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[14px] font-medium text-fg">
                              {SCENARIOS[c.id] ?? c.id}
                            </p>
                            <p className="text-[13px] text-fg-muted">
                              {c.detail}
                              {c.error && (
                                <code className="ml-2 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11.5px]">
                                  {c.error}
                                </code>
                              )}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                    <p className="text-[12.5px] text-fg-subtle">
                      Checked {formatDateTime(v.checkedAt)} · code{" "}
                      {v.program.codeHash ? <Fingerprint value={v.program.codeHash} /> : "—"} ·
                      upgradeable by{" "}
                      {v.program.authorityKind === "immutable"
                        ? "nobody (immutable)"
                        : v.program.authorityKind === "program"
                          ? "a program (e.g. a multisig)"
                          : "a single key"}
                    </p>
                  </div>
                ) : (
                  <p className="text-[13px] text-fg-muted">Not checked yet.</p>
                )}
              </Panel>

              <Panel
                title="3. Prove that the program is yours"
                description="Your program's upgrade authority signs a memo naming the program and your organization. Shown on the public page."
                actions={
                  ownershipCurrent ? (
                    <Badge tone="verified">Proven</Badge>
                  ) : (
                    <Badge tone="neutral">Not proven</Badge>
                  )
                }
              >
                {!v ? (
                  <p className="text-[13px] text-fg-muted">Verify the program first.</p>
                ) : !authority ? (
                  <p className="text-[13px] text-fg-muted">
                    This program is immutable: there is no upgrade authority, and nobody can change
                    it — the strongest case.
                  </p>
                ) : (
                  <div className="grid gap-4">
                    <p className="text-[13px] text-fg-muted">
                      Upgrade authority <Fingerprint value={authority} />
                      {v.program.authorityKind === "program" &&
                        " — a program-controlled account (for example a Squads multisig): create a transaction in it with the Memo program and this text, then paste its signature."}
                    </p>
                    {memo && (
                      <code className="break-all rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-[12.5px] text-fg">
                        {memo}
                      </code>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        onClick={() => void signMemo()}
                        disabled={!memo || tx.pending || wallet.address !== authority || !canAdmin}
                      >
                        {tx.pending && <Spinner className="h-4 w-4" />}
                        Sign with the connected wallet
                      </Button>
                      {wallet.address !== authority && (
                        <span className="text-[12.5px] text-fg-subtle">
                          Connect the upgrade authority&apos;s wallet to sign here.
                        </span>
                      )}
                      {tx.signature && <TxLink signature={tx.signature} />}
                    </div>
                    {tx.error && <Alert tone="danger">{tx.error}</Alert>}
                    <div className="flex flex-wrap gap-2">
                      <Input
                        aria-label="Memo transaction signature"
                        value={signature}
                        onChange={(e) => setSignature(e.target.value)}
                        placeholder="…or paste the memo transaction's signature"
                        className="min-w-0 flex-1 font-mono"
                      />
                      <Button
                        variant="secondary"
                        onClick={() => void submitOwnership(signature)}
                        disabled={!signature.trim() || !canAdmin}
                      >
                        Check
                      </Button>
                    </div>
                    {program.ownership && (
                      <p className="text-[12.5px] text-fg-subtle">
                        {ownershipCurrent ? "Proven" : "Proven by a previous authority"}{" "}
                        {formatDateTime(program.ownership.provenAt)} ·{" "}
                        <TxLink signature={program.ownership.signature} />
                      </p>
                    )}
                  </div>
                )}
              </Panel>

              <Panel
                title="4. Add the badge to your site"
                description="It shows the live status and opens the evidence. Outside your verified domains it reads “Not valid on this site”."
                actions={
                  <a
                    href={pageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"
                  >
                    Public page <ExternalIcon className="h-3.5 w-3.5" />
                  </a>
                }
              >
                <div className="grid gap-5">
                  <div className="flex flex-wrap gap-4 rounded-xl border border-line bg-surface-2 p-4">
                    {/* The image badge: the same states as the live one, without the domain check. */}
                    <img
                      src={`${badgeUrl}?theme=dark`}
                      alt="Badge (dark)"
                      width={200}
                      height={40}
                    />
                    <img
                      src={`${badgeUrl}?theme=light`}
                      alt="Badge (light)"
                      width={200}
                      height={40}
                    />
                  </div>
                  <CodeTabs
                    tabs={[
                      {
                        label: "HTML",
                        language: "html",
                        code: `<script src="${origin}/sdk/v1/stele.js" defer></script>\n<span data-stele-verified="${program.programAddress}"></span>`,
                      },
                      {
                        label: "React",
                        language: "tsx",
                        code: `import { SteleVerifiedBadge } from "@stelehq/sdk/react";\n\n<SteleVerifiedBadge program="${program.programAddress}" apiBaseUrl="${origin}/api" />`,
                      },
                      {
                        label: "Markdown",
                        language: "md",
                        code: `[![Stele Verified](${badgeUrl})](${pageUrl})`,
                      },
                    ]}
                  />
                  {v?.status !== "verified" && (
                    <p className="text-[12.5px] text-fg-subtle">
                      Until the program is verified the badge reads “Verification pending” (or “Not
                      verified”).
                    </p>
                  )}
                  <p className="text-[12.5px] text-fg-subtle">
                    Network: {network.label}. Verified domains decide where the live badge is valid
                    —{" "}
                    <Link href="/dashboard/organization" className="text-accent">
                      Organization
                    </Link>
                    .
                  </p>
                </div>
              </Panel>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
