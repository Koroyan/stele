"use client";
/**
 * Signing & fees: how visitors may sign (wallet, passkey, account + passkey) and who pays the network
 * fee (Stele, or the organization through a sponsored nonce shard). Sponsorship limits and balances
 * live on-chain; every change to them is a wallet-signed instruction the program checks.
 */
import { useEffect, useState } from "react";
import { address, type Instruction, type TransactionSigner } from "@solana/kit";
import {
  enableShardSponsorshipInstruction,
  formatSol,
  fromHex,
  recoverPasskeySignerInstruction,
  revokePasskeySignerInstruction,
  systemTransferInstruction,
  updateShardSponsorshipInstruction,
  withdrawShardSponsorshipInstruction,
} from "@stelehq/protocol";
import { Alert, Badge, Button, CopyButton, Field, Fingerprint, Input } from "@stele/ui";
import {
  LoadingRows,
  PageHeader,
  Panel,
  RoleNotice,
  SectionNote,
  SigningAs,
  Table,
  Td,
  TxLink,
  TxStatus,
  useTransaction,
} from "@/components/dashboard/ui";
import { api, errorMessage } from "@/lib/api";
import { useDashboard, type SigningPolicy, type WalletAuthority } from "@/lib/dashboard";
import { formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useNetwork, useWallet } from "@/lib/wallet";

const POLICIES: { value: SigningPolicy; title: string; body: string }[] = [
  {
    value: "WALLET_ONLY",
    title: "Wallet only",
    body: "Visitors sign with a Solana wallet (Phantom, Solflare, Backpack…). The behavior before walletless signing existed.",
  },
  {
    value: "PASSKEY_ONLY",
    title: "Passkey only",
    body: "Visitors sign with a passkey (Face ID, fingerprint, device PIN, security key). The passkey's own key signs and never leaves the device; Solana verifies it on-chain. No wallet, no SOL, no seed phrase.",
  },
  {
    value: "WALLET_OR_PASSKEY",
    title: "Wallet or passkey",
    body: "Visitors choose. Recommended for public sites.",
  },
  {
    value: "ACCOUNT_AND_PASSKEY",
    title: "Your account + passkey",
    body: "The passkey signer is bound to the visitor's account in your system and enrolled on-chain under a salted commitment (no personal data). Every signing request needs an acceptance session your server created for that account. Rotations need the current passkey; recoveries need your admin wallet and are recorded as such.",
  },
];

interface ShardView {
  address: string;
  shardId: number;
  relayer: string;
  relayedByStele: boolean;
  enabled: boolean;
  sponsorship: {
    paused: boolean;
    maxFeePerRecord: number;
    dailyLimit: number;
    spentToday: number;
    currentDay: number;
    totalReimbursed: number;
    reimbursedCount: number;
    totalWithdrawn: number;
    balanceLamports: number;
    rentExemptLamports: number;
  } | null;
  spendableLamports: number;
  estimatedRecords: number;
  canPayNow: boolean;
  lowBalance: boolean;
}

interface Overview {
  mode: "stele" | "organization";
  fallbackToStele: boolean;
  lowBalanceLamports: number | null;
  estimatedFeePerRecordLamports: number;
  plan: { freeRecordsPerMonth: number; usedThisMonth: number; credits: number };
  relayer: string;
  shards: ShardView[];
  history: {
    transactionSignature: string;
    recordKind: string;
    recordId: string;
    feePayer: string;
    feeLamports: number;
    sponsor: string;
    reimbursedLamports: number;
    nonceShard: string;
    createdAt: string;
  }[];
}

interface SignerRow {
  publicKey: string;
  /** "p256-native" (stele/2) or "ed25519-prf" (stele/1). */
  algorithm: string;
  rpId: string;
  externalUserRef: string | null;
  /** On-chain enrollment (account-bound native passkeys). */
  enrollment: string | null;
  status: "active" | "rotated" | "revoked" | "pending";
  createdAt: string;
  rotation: { kind: string; previous: string | null } | null;
  passkeys: {
    credentialId: string;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
    backedUp: boolean;
  }[];
  recoveryKits: { kitId: string; createdAt: string; revokedAt: string | null }[];
}

/** "0.05" → 50_000_000n (exact decimal parsing; at most 9 decimals). */
function solToLamports(text: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(text.trim());
  if (!m) return null;
  return BigInt(m[1]!) * 1_000_000_000n + BigInt((m[2] ?? "").padEnd(9, "0"));
}

const sol = (lamports: number) => `${formatSol(BigInt(Math.max(0, Math.trunc(lamports))))} SOL`;

function PolicyPanel({ canEdit }: { canEdit: boolean }) {
  const { detail, reloadDetail, withStepUp } = useDashboard();
  const [policy, setPolicy] = useState<SigningPolicy>(
    detail?.organization.settings.signingPolicy ?? "WALLET_ONLY",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (!detail) return null;
  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await withStepUp(() =>
        api(`/v1/organizations/${detail!.organization.id}/settings`, {
          method: "PATCH",
          body: { signingPolicy: policy },
        }),
      );
      await reloadDetail();
      setMessage({ tone: "success", text: "Signing policy saved." });
    } catch (e) {
      setMessage({ tone: "danger", text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }
  return (
    <Panel
      title="Signing methods"
      description="Which signers the Stele API accepts for your documents and proofs. Every method produces the same on-chain evidence; passkey signers additionally carry passkey evidence in receipts."
    >
      <RoleNotice allowed={canEdit}>
        Only the owner or an admin can change the signing policy.
      </RoleNotice>
      <fieldset className="grid gap-3 lg:grid-cols-2" disabled={!canEdit}>
        <legend className="sr-only">Signing policy</legend>
        {POLICIES.map((p) => (
          <label
            key={p.value}
            className={`flex cursor-pointer gap-3 rounded-xl border px-4 py-3 text-[13.5px] ${
              policy === p.value ? "border-accent bg-accent-soft" : "border-line bg-surface"
            }`}
          >
            <input
              type="radio"
              name="policy"
              value={p.value}
              checked={policy === p.value}
              onChange={() => setPolicy(p.value)}
              className="mt-1 accent-[var(--color-accent)]"
            />
            <span>
              <span className="font-medium text-fg">{p.title}</span>
              <span className="mt-0.5 block text-[12.5px] leading-relaxed text-fg-muted">
                {p.body}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <SectionNote>
        Passkey signers: the passkey&apos;s own key (secp256r1) signs, it never leaves the
        visitor&apos;s device, and Solana verifies the signature on-chain. Stele holds no key and
        cannot sign for anyone. Devices without passkey support are offered a wallet instead.
      </SectionNote>
      {message && (
        <Alert tone={message.tone} className="mt-4">
          {message.text}
        </Alert>
      )}
      <Button
        size="sm"
        className="mt-4"
        disabled={!canEdit}
        loading={saving}
        onClick={() => void save()}
      >
        Save signing policy
      </Button>
    </Panel>
  );
}

function SponsorshipSettings({
  overview,
  canEdit,
  reload,
}: {
  overview: Overview;
  canEdit: boolean;
  reload: () => void;
}) {
  const { detail, reloadDetail, withStepUp } = useDashboard();
  const [mode, setMode] = useState(overview.mode);
  const [fallback, setFallback] = useState(overview.fallbackToStele);
  const [threshold, setThreshold] = useState(
    overview.lowBalanceLamports !== null ? formatSol(BigInt(overview.lowBalanceLamports)) : "",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (!detail) return null;
  const thresholdLamports = threshold.trim() === "" ? null : solToLamports(threshold);
  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await withStepUp(() =>
        api(`/v1/organizations/${detail!.organization.id}/settings`, {
          method: "PATCH",
          body: {
            feeSponsor: mode,
            sponsorFallbackToStele: fallback,
            ...(thresholdLamports !== null
              ? { sponsorLowBalanceLamports: Number(thresholdLamports) }
              : {}),
          },
        }),
      );
      await Promise.all([reloadDetail(), reload()]);
      setMessage({ tone: "success", text: "Fee settings saved." });
    } catch (e) {
      setMessage({ tone: "danger", text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }
  return (
    <Panel
      title="Who pays network fees"
      description="Your users never pay: every recording is relayed and paid by Stele's relayer. Choose whether Stele absorbs the fee or your organization reimburses it on-chain."
    >
      <RoleNotice allowed={canEdit}>Only the owner or an admin can change fee settings.</RoleNotice>
      <div className="grid gap-3 lg:grid-cols-2">
        {(
          [
            [
              "stele",
              "Stele sponsors",
              "Stele's relayer pays and absorbs every network fee. Your free monthly recordings and credits are on the Billing page.",
            ],
            [
              "organization",
              "My organization sponsors",
              "Fees are reimbursed on-chain from your sponsored nonce shard, within the limits you set below. No private key exists for the deposit.",
            ],
          ] as const
        ).map(([value, title, body]) => (
          <label
            key={value}
            className={`flex cursor-pointer gap-3 rounded-xl border px-4 py-3 text-[13.5px] ${
              mode === value ? "border-accent bg-accent-soft" : "border-line bg-surface"
            }`}
          >
            <input
              type="radio"
              name="sponsor"
              checked={mode === value}
              disabled={!canEdit}
              onChange={() => setMode(value)}
              className="mt-1 accent-[var(--color-accent)]"
            />
            <span>
              <span className="font-medium text-fg">{title}</span>
              <span className="mt-0.5 block text-[12.5px] leading-relaxed text-fg-muted">
                {body}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-5 grid max-w-2xl gap-4">
        <label className="flex items-start gap-3 text-[13.5px]">
          <input
            type="checkbox"
            checked={fallback}
            disabled={!canEdit || mode === "stele"}
            onChange={(e) => setFallback(e.target.checked)}
            className="mt-1 accent-[var(--color-accent)]"
          />
          <span>
            <span className="font-medium text-fg">
              Fall back to Stele when my sponsorship cannot pay
            </span>
            <span className="mt-0.5 block text-[12.5px] leading-relaxed text-fg-muted">
              Otherwise signing requests are refused — before anyone signs — while your shard is
              paused, empty or at its daily limit.
            </span>
          </span>
        </label>
        <Field
          label="Low-balance alert"
          htmlFor="threshold"
          hint="A sponsorship.low_balance webhook is sent when a sponsored shard's spendable balance drops below this (SOL)."
          error={
            threshold.trim() !== "" && thresholdLamports === null
              ? "Enter an amount in SOL, e.g. 0.05"
              : null
          }
        >
          <Input
            id="threshold"
            value={threshold}
            disabled={!canEdit}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="0.05"
            className="max-w-40 font-mono text-[13px]"
          />
        </Field>
      </div>
      {message && (
        <Alert tone={message.tone} className="mt-4">
          {message.text}
        </Alert>
      )}
      <Button
        size="sm"
        className="mt-4"
        disabled={!canEdit}
        loading={saving}
        onClick={() => void save()}
      >
        Save fee settings
      </Button>
    </Panel>
  );
}

function ShardSponsorship({
  shard,
  authority,
  onChanged,
}: {
  shard: ShardView;
  authority: WalletAuthority | null;
  onChanged: () => Promise<void>;
}) {
  const network = useNetwork();
  const wallet = useWallet();
  const { detail } = useDashboard();
  const tx = useTransaction();
  const s = shard.sponsorship;
  const [maxFee, setMaxFee] = useState(s ? formatSol(BigInt(s.maxFeePerRecord)) : "0.0001");
  const [daily, setDaily] = useState(s ? formatSol(BigInt(s.dailyLimit)) : "0.05");
  const [deposit, setDeposit] = useState("0.1");
  const [withdraw, setWithdraw] = useState("");
  if (!detail) return null;
  const program = address(network.programId);
  const organization = address(detail.organization.address);
  const nonceShard = address(shard.address);
  const canManage = Boolean(authority?.canManageShards);
  const isOwner = Boolean(authority?.isOwner);
  const maxFeeL = solToLamports(maxFee);
  const dailyL = solToLamports(daily);
  const limitsError =
    maxFeeL === null || dailyL === null
      ? "Enter amounts in SOL."
      : maxFeeL <= 0n || maxFeeL > 5_000_000n
        ? "The per-record cap must be between 0.000000001 and 0.005 SOL."
        : dailyL < maxFeeL
          ? "The daily limit must be at least the per-record cap."
          : null;

  const send = (build: (signer: TransactionSigner) => Instruction[]) =>
    void tx.run(build, onChanged);

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-medium text-fg">Shard {shard.shardId}</span>
        {!shard.relayedByStele ? (
          <Badge tone="warning">Not relayed by Stele</Badge>
        ) : !s ? (
          <Badge>Sponsorship off</Badge>
        ) : s.paused ? (
          <Badge tone="warning">Paused</Badge>
        ) : shard.canPayNow ? (
          <Badge tone="verified">Paying fees</Badge>
        ) : (
          <Badge tone="danger">Cannot pay now</Badge>
        )}
        {shard.lowBalance && <Badge tone="danger">Low balance</Badge>}
      </div>
      <div className="grid gap-2 text-[13px] sm:grid-cols-[150px_1fr]">
        <span className="text-fg-subtle">Deposit address</span>
        <span className="flex flex-wrap items-center gap-2">
          <Fingerprint value={shard.address} mode="full" />
          <CopyButton value={shard.address} />
        </span>
        {s && (
          <>
            <span className="text-fg-subtle">Spendable balance</span>
            <span className="text-fg">
              {sol(shard.spendableLamports)}{" "}
              <span className="text-fg-subtle">
                (+{sol(s.rentExemptLamports)} rent reserve, never spent)
              </span>
            </span>
            <span className="text-fg-subtle">Estimated recordings</span>
            <span className="text-fg">≈ {shard.estimatedRecords.toLocaleString()}</span>
            <span className="text-fg-subtle">Limits</span>
            <span className="text-fg">
              {sol(s.maxFeePerRecord)} per record · {sol(s.dailyLimit)} per UTC day (
              {sol(s.spentToday)} spent today)
            </span>
            <span className="text-fg-subtle">Totals</span>
            <span className="text-fg">
              {s.reimbursedCount.toLocaleString()} fees reimbursed ({sol(s.totalReimbursed)}) ·{" "}
              {sol(s.totalWithdrawn)} withdrawn
            </span>
          </>
        )}
      </div>
      {shard.relayedByStele && (
        <>
          <div className="grid max-w-xl gap-3 sm:grid-cols-2">
            <Field label="Cap per record (SOL)" htmlFor={`max-${shard.shardId}`}>
              <Input
                id={`max-${shard.shardId}`}
                value={maxFee}
                disabled={!canManage}
                onChange={(e) => setMaxFee(e.target.value)}
                className="font-mono text-[13px]"
              />
            </Field>
            <Field label="Daily limit (SOL)" htmlFor={`daily-${shard.shardId}`}>
              <Input
                id={`daily-${shard.shardId}`}
                value={daily}
                disabled={!canManage}
                onChange={(e) => setDaily(e.target.value)}
                className="font-mono text-[13px]"
              />
            </Field>
          </div>
          {limitsError && <p className="text-[12.5px] text-danger">{limitsError}</p>}
          <div className="flex flex-wrap gap-2">
            {!s ? (
              <Button
                size="sm"
                disabled={!canManage || Boolean(limitsError) || tx.pending}
                onClick={() =>
                  send((signer) => [
                    enableShardSponsorshipInstruction({
                      programAddress: program,
                      authority: signer,
                      membership: authority?.membership ?? null,
                      organization,
                      nonceShard,
                      payer: signer,
                      maxFeePerRecord: maxFeeL!,
                      dailyLimit: dailyL!,
                    }),
                  ])
                }
              >
                Enable sponsorship
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!canManage || Boolean(limitsError) || tx.pending}
                  onClick={() =>
                    send((signer) => [
                      updateShardSponsorshipInstruction({
                        programAddress: program,
                        authority: signer,
                        membership: authority?.membership ?? null,
                        organization,
                        nonceShard,
                        maxFeePerRecord: maxFeeL!,
                        dailyLimit: dailyL!,
                        paused: s.paused,
                      }),
                    ])
                  }
                >
                  Update limits
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!canManage || tx.pending || (!s.paused ? false : !isOwner)}
                  onClick={() =>
                    send((signer) => [
                      updateShardSponsorshipInstruction({
                        programAddress: program,
                        authority: signer,
                        membership: authority?.membership ?? null,
                        organization,
                        nonceShard,
                        maxFeePerRecord: BigInt(s.maxFeePerRecord),
                        dailyLimit: BigInt(s.dailyLimit),
                        paused: !s.paused,
                      }),
                    ])
                  }
                >
                  {s.paused ? "Resume" : "Pause"}
                </Button>
              </>
            )}
          </div>
          {s && (
            <div className="grid max-w-xl gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Field
                  label="Deposit (SOL)"
                  htmlFor={`dep-${shard.shardId}`}
                  hint="Anyone can deposit; only the owner can withdraw."
                >
                  <Input
                    id={`dep-${shard.shardId}`}
                    value={deposit}
                    onChange={(e) => setDeposit(e.target.value)}
                    className="font-mono text-[13px]"
                  />
                </Field>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!wallet.address || solToLamports(deposit) === null || tx.pending}
                  onClick={() =>
                    send((signer) => [
                      systemTransferInstruction({
                        source: signer,
                        destination: nonceShard,
                        lamports: solToLamports(deposit)!,
                      }),
                    ])
                  }
                >
                  Deposit from wallet
                </Button>
              </div>
              <div className="space-y-2">
                <Field
                  label="Withdraw (SOL)"
                  htmlFor={`wd-${shard.shardId}`}
                  hint="Owner only, to the connected wallet. The rent reserve stays."
                >
                  <Input
                    id={`wd-${shard.shardId}`}
                    value={withdraw}
                    disabled={!isOwner}
                    onChange={(e) => setWithdraw(e.target.value)}
                    placeholder={formatSol(BigInt(shard.spendableLamports))}
                    className="font-mono text-[13px]"
                  />
                </Field>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!isOwner || solToLamports(withdraw) === null || tx.pending}
                  onClick={() =>
                    send((signer) => [
                      withdrawShardSponsorshipInstruction({
                        programAddress: program,
                        owner: signer,
                        organization,
                        nonceShard,
                        destination: signer.address,
                        amount: solToLamports(withdraw)!,
                      }),
                    ])
                  }
                >
                  Withdraw to my wallet
                </Button>
              </div>
            </div>
          )}
          {canManage || isOwner ? (
            <SigningAs />
          ) : (
            <SectionNote>
              Only the owner or an admin can change sponsorship; only the owner can withdraw.
            </SectionNote>
          )}
          <TxStatus tx={tx} />
        </>
      )}
    </div>
  );
}

interface RecoveryRow {
  identity: string;
  externalUserRef: string | null;
  requestedAt: string;
  enrollment: string;
  newSigner: string;
  newCredentialIdHash: string | null;
  rpIdHash: string;
}

/**
 * Account-bound native passkeys whose user lost every passkey: the new passkey proved possession;
 * an owner or admin wallet authorizes it on-chain (recorded as ORGANIZATION_RECOVERY — visibly not
 * endorsed by the previous key). Verify the person out of band first.
 */
function Recoveries({
  authority,
  onChanged,
}: {
  authority: WalletAuthority | null;
  onChanged: () => void;
}) {
  const network = useNetwork();
  const { detail } = useDashboard();
  const tx = useTransaction();
  const recoveries = useApi<{ recoveries: RecoveryRow[] }>(
    detail ? `/v1/organizations/${detail.organization.id}/passkey-recoveries` : null,
  );
  if (!detail || !recoveries.data || recoveries.data.recoveries.length === 0) return null;
  const canSign = Boolean(authority?.isOwner || authority?.isAdmin);
  const refresh = async (enrollment: string) => {
    await api(
      `/v1/organizations/${detail.organization.id}/passkey-enrollments/${enrollment}/refresh`,
      { method: "POST" },
    );
    recoveries.reload();
    onChanged();
  };
  return (
    <Panel
      title="Passkey recoveries awaiting your wallet"
      description="Each request comes from a new passkey that proved possession for the account. Authorizing it replaces the account's signer on-chain; the record says the organization did it, not the previous key. Confirm the person's identity through your own account process first."
      bodyClassName="px-0 py-0"
    >
      <Table head={["Account", "New signer", "Requested", ""]}>
        {recoveries.data.recoveries.map((r) => (
          <tr key={r.identity}>
            <Td mono>{r.externalUserRef ?? "—"}</Td>
            <Td>
              <Fingerprint value={r.identity} />
            </Td>
            <Td>{formatDateTime(Date.parse(r.requestedAt) / 1000)}</Td>
            <Td>
              <Button
                size="sm"
                disabled={!canSign || tx.pending || !r.newCredentialIdHash}
                onClick={() =>
                  void tx.run(
                    (signer) => [
                      recoverPasskeySignerInstruction({
                        programAddress: address(network.programId),
                        authority: signer,
                        membership: authority?.membership ?? null,
                        organization: address(detail.organization.address),
                        enrollment: address(r.enrollment),
                        newSigner: fromHex(r.newSigner, 33),
                        newCredentialIdHash: fromHex(r.newCredentialIdHash!, 32),
                        rpIdHash: fromHex(r.rpIdHash, 32),
                      }),
                    ],
                    () => refresh(r.enrollment),
                  )
                }
              >
                Authorize recovery
              </Button>
            </Td>
          </tr>
        ))}
      </Table>
      <div className="px-5 py-3">
        <TxStatus tx={tx} />
      </div>
    </Panel>
  );
}

function Signers({ canEdit, authority }: { canEdit: boolean; authority: WalletAuthority | null }) {
  const network = useNetwork();
  const { detail, withStepUp } = useDashboard();
  const tx = useTransaction();
  const signers = useApi<{ signers: SignerRow[] }>(
    detail ? `/v1/organizations/${detail.organization.id}/signer-identities` : null,
  );
  const [error, setError] = useState<string | null>(null);
  if (!detail) return null;
  const canSign = Boolean(authority?.isOwner || authority?.isAdmin);
  /** Native account-bound signers: revoke the on-chain enrollment with an owner/admin wallet. */
  function revokeOnChain(enrollment: string) {
    if (
      !window.confirm(
        "Revoke this enrollment on-chain? The passkey can no longer record acceptances for this account. Past acceptances stay valid.",
      )
    )
      return;
    void tx.run(
      (signer) => [
        revokePasskeySignerInstruction({
          programAddress: address(network.programId),
          authority: signer,
          membership: authority?.membership ?? null,
          organization: address(detail!.organization.address),
          enrollment: address(enrollment),
        }),
      ],
      async () => {
        await api(
          `/v1/organizations/${detail!.organization.id}/passkey-enrollments/${enrollment}/refresh`,
          { method: "POST" },
        );
        signers.reload();
      },
    );
  }
  async function revoke(publicKey: string) {
    const reason = window.prompt(
      "Reason for retiring this signer (recorded in the audit log). The key can never sign again; the user's next registration creates a NEW key marked as authorized by your account system.",
    );
    if (!reason || reason.trim().length < 3) return;
    setError(null);
    try {
      await withStepUp(() =>
        api(`/v1/organizations/${detail!.organization.id}/signer-identities/${publicKey}/revoke`, {
          method: "POST",
          body: { reason: reason.trim() },
        }),
      );
      signers.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <>
      <Recoveries authority={authority} onChanged={signers.reload} />
      <Panel
        title="Passkey signers"
        description="Walletless signers of this organization. Native passkeys sign with their own key, which never leaves the visitor's device; legacy signers (registered before native passkeys) keep a PRF-encrypted key. Stele never holds a usable private key."
        bodyClassName="px-0 py-0"
      >
        {error && (
          <Alert tone="danger" className="m-5">
            {error}
          </Alert>
        )}
        {signers.loading && !signers.data ? (
          <LoadingRows />
        ) : (
          <Table
            head={[
              "Signer key",
              "Kind",
              "Account",
              "Status",
              "Passkeys",
              "Recovery kits",
              "Created",
              "",
            ]}
            empty={
              signers.data?.signers.length === 0 ? (
                <p className="px-6 py-8 text-[13px] text-fg-muted">No passkey signers yet.</p>
              ) : null
            }
          >
            {signers.data?.signers.map((s) => (
              <tr key={s.publicKey}>
                <Td>
                  <Fingerprint value={s.publicKey} />
                  {s.rotation && (
                    <span className="mt-1 block text-[11.5px] text-fg-subtle">
                      {s.rotation.kind === "account_authorized"
                        ? "Replaced a lost key (authorized by your account system, not by the old key)"
                        : "Rotated with the previous key's endorsement"}
                    </span>
                  )}
                </Td>
                <Td>
                  {s.algorithm === "p256-native" ? "Native passkey" : "PRF-protected key"}
                  {s.enrollment && (
                    <span className="mt-1 block text-[11.5px] text-fg-subtle">
                      Enrolled on-chain
                    </span>
                  )}
                </Td>
                <Td mono>{s.externalUserRef ?? "—"}</Td>
                <Td>
                  <Badge
                    tone={
                      s.status === "active"
                        ? "verified"
                        : s.status === "revoked"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {s.status}
                  </Badge>
                </Td>
                <Td>{s.passkeys.filter((p) => !p.revokedAt).length} active</Td>
                <Td>{s.recoveryKits.filter((k) => !k.revokedAt).length}</Td>
                <Td>{formatDateTime(Date.parse(s.createdAt) / 1000)}</Td>
                <Td>
                  {s.status === "active" && canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => void revoke(s.publicKey)}>
                      Retire
                    </Button>
                  )}
                  {s.enrollment && s.status !== "revoked" && canSign && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={tx.pending}
                      onClick={() => revokeOnChain(s.enrollment!)}
                    >
                      Revoke on-chain
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <div className="px-5 py-3">
          <TxStatus tx={tx} />
        </div>
      </Panel>
    </>
  );
}

export default function SigningPage() {
  const wallet = useWallet();
  const { detail, authorityOf } = useDashboard();
  const [authority, setAuthority] = useState<WalletAuthority | null>(null);
  const overview = useApi<Overview>(
    detail ? `/v1/organizations/${detail.organization.id}/sponsorship` : null,
  );
  useEffect(() => {
    void authorityOf(wallet.address).then(setAuthority);
  }, [authorityOf, wallet.address]);
  if (!detail) return null;
  const isAdmin = detail.role === "owner" || detail.role === "admin";
  const refresh = async () => {
    overview.reload();
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Signing & fees"
        description="How visitors sign, and who pays the network fee. Your users never pay and never need SOL."
      />
      <PolicyPanel canEdit={isAdmin} />
      {overview.error && <Alert tone="danger">{overview.error.message}</Alert>}
      {overview.data ? (
        <>
          <SponsorshipSettings
            overview={overview.data}
            canEdit={isAdmin}
            reload={overview.reload}
          />
          <Panel
            title="Sponsored nonce shards"
            description={`The program reimburses Stele's relayer (${overview.data.relayer.slice(0, 6)}…) the exact fee of each valid recording — about ${sol(overview.data.estimatedFeePerRecordLamports)} — from the shard you fund, capped by your limits. It never pays for anything else.`}
          >
            <div className="space-y-4">
              {overview.data.shards.length === 0 ? (
                <SectionNote>No nonce shards yet. Create one on the Organization page.</SectionNote>
              ) : (
                overview.data.shards.map((s) => (
                  <ShardSponsorship
                    key={s.address}
                    shard={s}
                    authority={authority}
                    onChanged={refresh}
                  />
                ))
              )}
            </div>
          </Panel>
          <Panel
            title="Fee history"
            description="Recent recordings and who paid for them (read back from each confirmed transaction)."
            bodyClassName="px-0 py-0"
          >
            <Table
              head={["When", "Record", "Fee", "Paid by", "Reimbursed", "Transaction"]}
              empty={
                overview.data.history.length === 0 ? (
                  <p className="px-6 py-8 text-[13px] text-fg-muted">No recordings yet.</p>
                ) : null
              }
            >
              {overview.data.history.map((h) => (
                <tr key={h.transactionSignature}>
                  <Td>{formatDateTime(Date.parse(h.createdAt) / 1000)}</Td>
                  <Td>{h.recordKind}</Td>
                  <Td>{h.feeLamports.toLocaleString()} lamports</Td>
                  <Td>{h.sponsor === "organization" ? "Your organization" : "Stele"}</Td>
                  <Td>
                    {h.reimbursedLamports
                      ? `${h.reimbursedLamports.toLocaleString()} lamports`
                      : "—"}
                  </Td>
                  <Td>
                    <TxLink signature={h.transactionSignature} />
                  </Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </>
      ) : (
        !overview.error && <LoadingRows label="Reading sponsorship state from Solana…" />
      )}
      <Signers canEdit={isAdmin} authority={authority} />
    </div>
  );
}
