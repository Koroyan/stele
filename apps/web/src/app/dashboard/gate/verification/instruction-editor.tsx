"use client";
/**
 * Step 2 of Stele Verified: how Stele calls the protected instruction. Recommended: upload the
 * program's Anchor IDL — the instruction, its accounts (user, passport, policy recognised by name;
 * fixed accounts and PDAs filled in) and typed arguments come from it. Manual mode (raw data and an
 * account list) is for programs without an IDL.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { address as toAddress, isAddress } from "@solana/kit";
import { toHex } from "@stelehq/protocol";
import {
  Alert,
  Badge,
  Button,
  FileIcon,
  Fingerprint,
  Input,
  Select,
  Tabs,
  Textarea,
  XIcon,
} from "@stele/ui";
import type { ProbeTemplate } from "@/components/dashboard/gate";
import {
  defaultArgValue,
  derivePda,
  encodeInstructionData,
  guessRole,
  parseIdl,
  type IdlInstruction,
  type ParsedIdl,
  type Role,
} from "@/lib/anchor-idl";

export const ROLE_LABELS: Record<Role, string> = {
  user: "The user's wallet",
  passport: "The user's Stele passport",
  accessPass: "The user's Stele access pass",
  policy: "Your Stele policy",
  address: "A fixed account",
};

const ROLE_HINTS: Record<Role, string> = {
  user: "A test wallet in each check",
  passport: "Derived from the test wallet",
  accessPass: "Derived from the test wallet",
  policy: "Filled in by Stele",
  address: "",
};

interface Row {
  role: Role;
  address: string;
  signer: boolean;
  writable: boolean;
}

/** The layout of the guide's and Solana Playground's example: user, policy, passport. */
const DEFAULT_ROWS: Row[] = [
  { role: "user", address: "", signer: true, writable: false },
  { role: "policy", address: "", signer: false, writable: false },
  { role: "passport", address: "", signer: false, writable: false },
];

/** What is still missing from a template, in plain words (null when it is complete). */
function templateProblem(accounts: { role: Role; address: string }[]): string | null {
  if (!accounts.some((a) => a.role === "user"))
    return "Mark which account is the user's wallet (the signer of the protected action).";
  if (!accounts.some((a) => a.role === "passport" || a.role === "accessPass"))
    return "Mark which account is the user's Stele passport (or access pass).";
  const missing = accounts.find((a) => a.role === "address" && !isAddress(a.address.trim()));
  if (missing) return "Every fixed account needs a valid address.";
  return null;
}

export function InstructionEditor({
  programAddress,
  programLabel,
  policyAddress,
  action,
  saved,
  example,
  busy,
  disabled,
  onSubmit,
  onCancel,
}: {
  programAddress: string;
  programLabel: string;
  policyAddress: string | null;
  /** The protected instruction named at registration (preselected). */
  action: string;
  saved: ProbeTemplate | null;
  /** A ready IDL to try (the demo vault's). */
  example: string | null;
  busy: boolean;
  disabled: boolean;
  onSubmit: (template: ProbeTemplate) => void;
  onCancel: (() => void) | null;
}) {
  const [source, setSource] = useState<"idl" | "manual">("idl");

  // ---- From an IDL
  const [idl, setIdl] = useState<ParsedIdl | null>(null);
  const [idlFile, setIdlFile] = useState<string | null>(null);
  const [idlError, setIdlError] = useState<string | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [ixName, setIxName] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [argValues, setArgValues] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const ix: IdlInstruction | null = idl?.instructions.find((i) => i.name === ixName) ?? null;

  function load(text: string, name: string) {
    try {
      const parsed = parseIdl(text);
      if (parsed.instructions.length === 0) throw new Error("This IDL has no instructions.");
      setIdl(parsed);
      setIdlFile(name);
      setIdlError(null);
      setPaste(null);
      const preferred =
        parsed.instructions.find((i) => i.name === action) ??
        parsed.instructions.find((i) => i.accounts.some((a) => /passport/i.test(a.name))) ??
        parsed.instructions[0]!;
      setIxName(preferred.name);
    } catch (e) {
      setIdl(null);
      setIdlError(e instanceof Error ? e.message : String(e));
    }
  }

  // A new instruction: guess the roles, fill fixed addresses, default the arguments.
  useEffect(() => {
    if (!ix) return;
    let signerTaken = false;
    const nextRoles = ix.accounts.map((a) => {
      const role = guessRole(a, signerTaken);
      if (role === "user") signerTaken = true;
      return role;
    });
    setRoles(nextRoles);
    setAddresses(ix.accounts.map((a) => a.address ?? ""));
    setArgValues(ix.args.map(defaultArgValue));
  }, [ix]);

  // PDAs of the program that depend only on known accounts (e.g. a vault derived from the policy).
  useEffect(() => {
    if (!ix || roles.length !== ix.accounts.length || !isAddress(programAddress)) return;
    let cancelled = false;
    void (async () => {
      const known: Record<string, string | undefined> = {};
      ix.accounts.forEach((a, i) => {
        if (roles[i] === "policy") known[a.name] = policyAddress ?? undefined;
        else if (roles[i] === "address" && addresses[i]) known[a.name] = addresses[i];
      });
      const next = [...addresses];
      let changed = false;
      for (const [i, a] of ix.accounts.entries()) {
        if (roles[i] !== "address" || next[i] || !a.pda) continue;
        const pda = await derivePda(toAddress(programAddress), a.pda, known).catch(() => null);
        if (pda) {
          next[i] = pda;
          known[a.name] = pda;
          changed = true;
        }
      }
      if (changed && !cancelled) setAddresses(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [ix, roles, addresses, programAddress, policyAddress]);

  const fromIdl = useMemo((): { template: ProbeTemplate | null; problem: string | null } => {
    if (!ix) return { template: null, problem: null };
    const unsupported = ix.args.find((a) => !a.type);
    if (unsupported)
      return {
        template: null,
        problem: `The argument ${unsupported.name} (${unsupported.typeLabel}) can't be filled in here — use “Without an IDL” and give the instruction data as hex.`,
      };
    const rows = ix.accounts.map((a, i) => ({
      role: roles[i] ?? "address",
      address: addresses[i] ?? "",
    }));
    const problem = templateProblem(rows);
    if (problem) return { template: null, problem };
    try {
      const data = toHex(encodeInstructionData(ix, argValues));
      return {
        template: {
          data,
          accounts: ix.accounts.map((a, i) => ({
            role: rows[i]!.role,
            ...(rows[i]!.role === "address" ? { address: rows[i]!.address.trim() } : {}),
            signer: a.signer || rows[i]!.role === "user",
            writable: a.writable,
          })),
        },
        problem: null,
      };
    } catch (e) {
      return { template: null, problem: e instanceof Error ? e.message : String(e) };
    }
  }, [ix, roles, addresses, argValues]);

  // ---- Without an IDL (manual)
  const [raw, setRaw] = useState(saved?.data ?? "");
  const [rows, setRows] = useState<Row[]>(
    saved ? saved.accounts.map((a) => ({ ...a, address: a.address ?? "" })) : DEFAULT_ROWS,
  );
  const manual = useMemo((): { template: ProbeTemplate | null; problem: string | null } => {
    const data = raw.replace(/\s+/g, "").replace(/^0x/, "").toLowerCase();
    if (!data) return { template: null, problem: "Enter the instruction data." };
    if (!/^([0-9a-f]{2})+$/.test(data))
      return {
        template: null,
        problem: "Instruction data must be hex bytes (two characters per byte).",
      };
    const problem = templateProblem(rows);
    if (problem) return { template: null, problem };
    return {
      template: {
        data,
        accounts: rows.map((r) => ({
          role: r.role,
          ...(r.role === "address" ? { address: r.address.trim() } : {}),
          signer: r.signer,
          writable: r.writable,
        })),
      },
      problem: null,
    };
  }, [raw, rows]);
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

  const current = source === "idl" ? fromIdl : manual;
  const idlMismatch = idl?.address && idl.address !== programAddress;

  return (
    <div className="grid gap-5">
      <Tabs
        value={source}
        onChange={setSource}
        items={[
          { value: "idl", label: "From your IDL (recommended)" },
          { value: "manual", label: "Without an IDL" },
        ]}
      />

      {source === "idl" ? (
        <div className="grid gap-5">
          {!idl ? (
            <div className="grid gap-3">
              <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line-strong bg-surface-2 p-5 sm:flex-row sm:items-center">
                <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-accent-soft text-accent">
                  <FileIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-fg">
                    Upload the IDL of {programLabel} <Fingerprint value={programAddress} />
                  </p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">
                    Anchor writes it to{" "}
                    <code className="font-mono">target/idl/&lt;program&gt;.json</code> on{" "}
                    <code className="font-mono">anchor build</code>. In Solana Playground: Build,
                    then <em>Export IDL</em>. It never leaves your browser.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => fileInput.current?.click()}>Choose IDL file</Button>
                  <Button variant="secondary" onClick={() => setPaste(paste === null ? "" : null)}>
                    Paste
                  </Button>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".json,application/json"
                  aria-label="IDL file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void f.text().then((t) => load(t, f.name));
                    e.target.value = "";
                  }}
                />
              </div>
              {paste !== null && (
                <div className="grid gap-2">
                  <Textarea
                    aria-label="IDL JSON"
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    rows={6}
                    placeholder='{ "address": "…", "instructions": [ … ] }'
                    className="font-mono text-[12.5px]"
                  />
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!paste.trim()}
                      onClick={() => load(paste, "pasted IDL")}
                    >
                      Use this IDL
                    </Button>
                  </div>
                </div>
              )}
              {example && (
                <p className="text-[12.5px] text-fg-subtle">
                  This is the demo vault.{" "}
                  <button
                    type="button"
                    className="font-medium text-accent hover:underline"
                    onClick={() =>
                      void fetch(example)
                        .then((r) => r.text())
                        .then((t) => load(t, "stele_gate_demo.json"))
                    }
                  >
                    Use its IDL
                  </button>
                </p>
              )}
              {idlError && <Alert tone="danger">{idlError}</Alert>}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-muted">
                <FileIcon className="h-4 w-4 text-fg-subtle" />
                <span className="font-medium text-fg">{idl.name ?? idlFile}</span>
                <span className="text-fg-subtle">· {idl.instructions.length} instructions</span>
                <button
                  type="button"
                  className="ml-1 font-medium text-accent hover:underline"
                  onClick={() => {
                    setIdl(null);
                    setIxName("");
                  }}
                >
                  Change file
                </button>
              </div>
              {idlMismatch && (
                <Alert tone="warning">
                  This IDL belongs to another program ({idl.address}). Upload the IDL of{" "}
                  {programAddress}.
                </Alert>
              )}

              <label className="grid max-w-md gap-1.5 text-[13px] font-medium text-fg">
                Which instruction does the protected action?
                <Select value={ixName} onChange={(e) => setIxName(e.target.value)}>
                  {idl.instructions.map((i) => (
                    <option key={i.name} value={i.name}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              </label>

              {ix && (
                <div className="grid gap-2">
                  <p className="text-[13px] font-medium text-fg">Its accounts</p>
                  <ul className="grid gap-2">
                    {ix.accounts.map((a, i) => {
                      const role = roles[i] ?? "address";
                      return (
                        <li
                          key={`${ix.name}-${a.name}`}
                          className="grid items-center gap-2 rounded-xl border border-line p-3 sm:grid-cols-[minmax(0,160px)_minmax(0,230px)_minmax(0,1fr)]"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[13px] text-fg">{a.name}</p>
                            <p className="text-[11.5px] text-fg-subtle">
                              {[a.signer && "signer", a.writable && "writable"]
                                .filter(Boolean)
                                .join(" · ") || "read-only"}
                            </p>
                          </div>
                          <Select
                            aria-label={`${a.name}: what is it?`}
                            value={role}
                            onChange={(e) =>
                              setRoles((rs) =>
                                rs.map((r, j) => (j === i ? (e.target.value as Role) : r)),
                              )
                            }
                          >
                            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </Select>
                          {role === "address" ? (
                            <Input
                              aria-label={`${a.name} address`}
                              value={addresses[i] ?? ""}
                              onChange={(e) =>
                                setAddresses((xs) =>
                                  xs.map((x, j) => (j === i ? e.target.value : x)),
                                )
                              }
                              placeholder="Account address"
                              className="font-mono text-[12.5px]"
                            />
                          ) : (
                            <span className="text-[12.5px] text-fg-subtle">{ROLE_HINTS[role]}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {ix && ix.args.length > 0 && (
                <div className="grid gap-2">
                  <p className="text-[13px] font-medium text-fg">
                    Its arguments{" "}
                    <span className="font-normal text-fg-subtle">
                      — any valid value, e.g. an amount of 1
                    </span>
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {ix.args.map((arg, i) => (
                      <label key={arg.name} className="grid gap-1.5 text-[13px] text-fg-muted">
                        <span>
                          <span className="font-mono text-fg">{arg.name}</span>{" "}
                          <span className="text-fg-subtle">{arg.typeLabel}</span>
                        </span>
                        {arg.type === "bool" ? (
                          <Select
                            value={argValues[i] ?? "false"}
                            onChange={(e) =>
                              setArgValues((vs) => vs.map((v, j) => (j === i ? e.target.value : v)))
                            }
                          >
                            <option value="false">false</option>
                            <option value="true">true</option>
                          </Select>
                        ) : (
                          <Input
                            value={argValues[i] ?? ""}
                            disabled={!arg.type}
                            onChange={(e) =>
                              setArgValues((vs) => vs.map((v, j) => (j === i ? e.target.value : v)))
                            }
                            className="font-mono"
                          />
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          <p className="text-[13px] leading-relaxed text-fg-muted">
            Give the instruction&apos;s data and list its accounts in order. For an Anchor
            instruction the data is its 8-byte discriminator followed by the Borsh-encoded
            arguments.
          </p>
          <label className="grid gap-1.5 text-[13px] font-medium text-fg">
            Instruction data (hex)
            <Input
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="e.g. f223c68952e1f2b6 0100000000000000"
              className="font-mono"
            />
          </label>
          <div className="grid gap-2">
            {rows.map((r, i) => (
              <div
                key={i}
                className="grid items-center gap-2 rounded-xl border border-line p-2.5 sm:grid-cols-[28px_minmax(0,220px)_minmax(0,1fr)_auto]"
              >
                <span className="text-center font-mono text-[12px] text-fg-subtle">{i}</span>
                <Select
                  aria-label={`Account ${i}`}
                  value={r.role}
                  onChange={(e) => update(i, { role: e.target.value as Role })}
                >
                  {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
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
                  <span className="text-[12.5px] text-fg-subtle">{ROLE_HINTS[r.role]}</span>
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
        </div>
      )}

      {(source === "manual" || ix) && current.problem && (
        <p className="text-[13px] text-warning">{current.problem}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {(source === "manual" || ix) && (
          <Button
            onClick={() => current.template && onSubmit(current.template)}
            loading={busy}
            disabled={busy || disabled || !current.template}
          >
            Save and run the check
          </Button>
        )}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {current.template && (
          <Badge tone="neutral">
            {current.template.accounts.length} accounts · {current.template.data.length / 2} bytes
          </Badge>
        )}
      </div>
    </div>
  );
}
