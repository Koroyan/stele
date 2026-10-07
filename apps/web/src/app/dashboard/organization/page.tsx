"use client";
/** Organization profile (read from the chain), domain verification, acceptance capacity and policy. */
import { useEffect, useState } from "react";
import { address } from "@solana/kit";
import {
  createNonceShardInstruction,
  decodeOrganization,
  fetchAccountData,
  findConfigPda,
  findNonceShardPda,
  normalizeDisplayString,
  SHARD_CAPACITY,
  setShardRelayerInstruction,
  updateOrganizationInstruction,
  validateOrgName,
  validateRequestDomain,
  validationError,
  type OrganizationAccount,
} from "@stele/protocol";
import {
  Alert,
  Badge,
  Button,
  CodeBlock,
  CopyButton,
  Field,
  Fingerprint,
  Input,
  KeyValue,
  VerifiedBadge,
} from "@stele/ui";
import {
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
import { rpcFor } from "@/lib/chain";
import { useDashboard, type DomainRow, type ShardRow, type WalletAuthority } from "@/lib/dashboard";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  relativeTime,
} from "@/lib/format";
import { useNetwork, useWallet } from "@/lib/wallet";

function useChainOrg(orgAddress: string | undefined) {
  const network = useNetwork();
  const [org, setOrg] = useState<OrganizationAccount | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!orgAddress) return;
    fetchAccountData(rpcFor(network), address(orgAddress))
      .then((d) => setOrg(d ? decodeOrganization(d) : null))
      .catch(() => setOrg(null));
  }, [orgAddress, network, tick]);
  return { org, reload: () => setTick((t) => t + 1) };
}

function Profile({ authority }: { authority: WalletAuthority | null }) {
  const network = useNetwork();
  const { detail, reloadDetail, reloadOrgs } = useDashboard();
  const chain = useChainOrg(detail?.organization.address);
  const tx = useTransaction();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  if (!detail) return null;
  const o = chain.org;
  const normalized = normalizeDisplayString(name);
  const nameError = name ? validationError(validateOrgName, normalized) : null;

  async function rename() {
    await tx.run(
      (signer) => [
        updateOrganizationInstruction({
          programAddress: address(network.programId),
          authority: signer,
          organization: address(detail!.organization.address),
          name: normalized,
        }),
      ],
      async () => {
        await api(`/v1/organizations/${detail!.organization.id}/refresh`, { method: "POST" });
        await Promise.all([reloadDetail(), reloadOrgs()]);
        chain.reload();
        setRenaming(false);
      },
    );
  }

  return (
    <Panel
      title="On-chain profile"
      description="Read directly from the organization account on Solana."
      actions={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            chain.reload();
            void api(`/v1/organizations/${detail.organization.id}/refresh`, {
              method: "POST",
            }).then(reloadDetail);
          }}
        >
          Refresh
        </Button>
      }
    >
      <KeyValue
        items={[
          {
            label: "Name",
            value: (
              <span className="flex flex-wrap items-center gap-2">
                {o?.name ?? detail.organization.name}
                <VerifiedBadge domain={detail.organization.verifiedDomain} />
                {authority?.isOwner && !renaming && (
                  <button
                    type="button"
                    className="text-[12.5px] text-accent hover:text-accent-strong"
                    onClick={() => (
                      setName(o?.name ?? detail.organization.name),
                      setRenaming(true)
                    )}
                  >
                    Rename
                  </button>
                )}
              </span>
            ),
          },
          {
            label: "Account",
            value: <Fingerprint value={detail.organization.address} mode="full" />,
          },
          {
            label: "Owner",
            value: <Fingerprint value={o?.owner ?? detail.organization.ownerAddress} mode="full" />,
          },
          {
            label: "Recovery authority",
            value: o?.recovery ? (
              <Fingerprint value={o.recovery} mode="full" />
            ) : (
              <span className="text-warning">Not configured</span>
            ),
          },
          { label: "Created", value: o ? formatDateTime(Number(o.createdAt)) : "—" },
          {
            label: "Documents · members",
            value: o ? `${o.documentCount} · ${o.memberCount}` : "—",
          },
          {
            label: "Status",
            value: o?.frozen ? <Badge tone="danger">Frozen</Badge> : <Badge>Active</Badge>,
          },
        ]}
      />
      {renaming && (
        <form
          className="mt-6 max-w-lg space-y-3 rounded-xl border border-line bg-bg-raised p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!nameError && normalized) void rename();
          }}
        >
          <Field
            label="New name"
            htmlFor="rename"
            error={nameError}
            hint="Renaming does not change what earlier signatures say: each signed message contains the name at the time."
          >
            <Input id="rename" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <TxStatus tx={tx} />
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={!normalized || Boolean(nameError)}
              loading={tx.pending}
            >
              Sign &amp; rename
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

function DomainSection({ canManage }: { canManage: boolean }) {
  const { detail, reloadDetail, reloadOrgs, withStepUp } = useDashboard();
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dnsResult, setDnsResult] = useState<{ id: string; text: string } | null>(null);
  if (!detail) return null;
  const pending = detail.domainVerifications.filter(
    (d) => d.status === "pending" || d.status === "failed",
  );
  // The chain-mirrored organization is the source of truth; a domain may also have been attested
  // outside this dashboard, in which case there is no verification request to show or revoke here.
  const org = detail.organization;
  const expiresMs = org.domainExpiresAt ? new Date(org.domainExpiresAt).getTime() : 0;
  const activeDomain = org.verifiedDomain && expiresMs > Date.now() ? org.verifiedDomain : null;
  const expiredDomain = org.verifiedDomain && !activeDomain ? org.verifiedDomain : null;
  const verified = activeDomain
    ? (detail.domainVerifications.find(
        (d) => d.status === "verified" && d.domain === activeDomain,
      ) ?? null)
    : null;

  async function request() {
    setBusy("request");
    setError(null);
    try {
      await api(`/v1/organizations/${detail!.organization.id}/domains`, {
        body: { domain: domain.trim().toLowerCase() },
      });
      setDomain("");
      await reloadDetail();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function check(v: DomainRow) {
    setBusy(v.id);
    setError(null);
    try {
      const res = await api<{
        verification: DomainRow;
        dns?: {
          verified: boolean;
          /** `resolver` is the resolver's host name (e.g. `cloudflare-dns.com`), not a URL. */
          perResolver: { resolver: string; found: boolean; error?: string }[];
        };
      }>(`/v1/organizations/${detail!.organization.id}/domains/${v.id}/check`, { method: "POST" });
      const perResolver = res.dns?.perResolver ?? [];
      setDnsResult({
        id: v.id,
        text:
          res.verification.status === "verified"
            ? "Verified and attested on-chain."
            : perResolver.length === 0
              ? "The record was not found yet."
              : `The record must be visible to every resolver: ${perResolver
                  .map(
                    (r) => `${r.resolver} ${r.found ? "found it" : (r.error ?? "did not find it")}`,
                  )
                  .join(
                    " · ",
                  )}. New DNS records can take a few minutes to appear; check again shortly.`,
      });
      await Promise.all([reloadDetail(), reloadOrgs()]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(v: DomainRow) {
    setBusy(`revoke-${v.id}`);
    setError(null);
    try {
      await withStepUp(() =>
        api(`/v1/organizations/${detail!.organization.id}/domains/${v.id}/revoke`, {
          method: "POST",
        }),
      );
      await Promise.all([reloadDetail(), reloadOrgs()]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const domainError = domain
    ? validationError((d: string) => validateRequestDomain(d), domain.trim().toLowerCase())
    : null;

  return (
    <div id="domain">
      <Panel
        title="Verified domain"
        description="Prove your organization controls a domain. Stele checks a DNS TXT record through several independent resolvers, then attests the domain on-chain with an expiry. Signature requests then say “verified: your-domain”."
      >
        {activeDomain ? (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-verified-line bg-verified-soft px-4 py-3">
            <div>
              <VerifiedBadge domain={activeDomain} />
              <p className="mt-1.5 text-[12.5px] text-fg-muted">
                Attested on-chain {org.domainVerifiedAt ? formatDate(org.domainVerifiedAt) : ""} ·
                expires {formatDate(org.domainExpiresAt)} · renewed automatically while the DNS
                record remains ·{" "}
                {verified?.attestationTx ? (
                  <TxLink signature={verified.attestationTx} label="attestation" />
                ) : (
                  "attested outside this dashboard"
                )}
              </p>
            </div>
            {verified && detail.role === "owner" && (
              <Button
                size="sm"
                variant="danger"
                loading={busy === `revoke-${verified.id}`}
                onClick={() => void revoke(verified)}
              >
                Revoke
              </Button>
            )}
          </div>
        ) : expiredDomain ? (
          <Alert tone="warning" title={`Verification of ${expiredDomain} expired`}>
            It expired on {formatDate(org.domainExpiresAt)}. Signature requests now say
            “unverified”. Verify the domain again to restore it.
          </Alert>
        ) : (
          <Alert tone="warning" title="No verified domain">
            Signature requests show your organization as “unverified”. Anyone can choose any display
            name; a verified domain is what proves who you are.
          </Alert>
        )}

        {pending.map((v) => (
          <div key={v.id} className="mt-5 space-y-3 rounded-xl border border-line bg-bg-raised p-4">
            <p className="text-[13.5px] font-medium text-fg">
              Add this DNS record for <span className="font-mono">{v.domain}</span>
            </p>
            <div className="grid gap-3 sm:grid-cols-[110px_1fr]">
              <span className="text-[12.5px] text-fg-subtle">Type</span>
              <span className="font-mono text-[12.5px] text-fg">TXT</span>
              <span className="text-[12.5px] text-fg-subtle">Name</span>
              <span className="flex items-center gap-1 font-mono text-[12.5px] break-all text-fg">
                {v.txtName} <CopyButton value={v.txtName} />
              </span>
              <span className="text-[12.5px] text-fg-subtle">Value</span>
              <span className="flex items-center gap-1 font-mono text-[12.5px] break-all text-fg">
                {v.txtValue} <CopyButton value={v.txtValue} />
              </span>
            </div>
            {v.lastError && (
              <p className="text-[12px] text-fg-subtle">
                Last check {relativeTime(v.lastCheckedAt)}: {v.lastError}
              </p>
            )}
            {dnsResult?.id === v.id && (
              <p className="text-[12.5px] text-fg-muted">{dnsResult.text}</p>
            )}
            {canManage && (
              <Button
                size="sm"
                variant="secondary"
                loading={busy === v.id}
                onClick={() => void check(v)}
              >
                Check DNS &amp; attest
              </Button>
            )}
          </div>
        ))}

        {canManage && !activeDomain && (
          <form
            className="mt-5 flex max-w-xl flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (domain && !domainError) void request();
            }}
          >
            <div className="min-w-[240px] flex-1">
              <Field label="Domain" htmlFor="domain" error={domainError}>
                <Input
                  id="domain"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="acme.com"
                  className="font-mono text-[13px]"
                  spellCheck={false}
                />
              </Field>
            </div>
            <Button
              type="submit"
              size="md"
              variant="secondary"
              loading={busy === "request"}
              disabled={!domain || Boolean(domainError)}
            >
              Start verification
            </Button>
          </form>
        )}
        {error && (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        )}
      </Panel>
    </div>
  );
}

function Shards({ authority }: { authority: WalletAuthority | null }) {
  const network = useNetwork();
  const { detail, reloadDetail } = useDashboard();
  const tx = useTransaction();
  if (!detail) return null;
  const nextId = detail.shards.reduce((m, s) => Math.max(m, s.shardId + 1), 0);
  const steleShards = detail.shards.filter((s) => s.relayerIsStele);
  const used = steleShards.reduce((a, s) => a + s.nextIndex, 0);
  const capacity = steleShards.length * SHARD_CAPACITY;

  // After Stele rotates its relayer key, shards must be pointed at the new relayer.
  async function reassign(s: ShardRow) {
    await tx.run(
      (signer) => [
        setShardRelayerInstruction({
          programAddress: address(network.programId),
          authority: signer,
          membership: authority?.membership ?? null,
          organization: address(detail!.organization.address),
          nonceShard: address(s.address),
          relayer: address(network.relayer),
        }),
      ],
      async () => {
        await api(`/v1/organizations/${detail!.organization.id}/shards/sync`, {
          body: { address: s.address },
        });
        await reloadDetail();
      },
    );
  }

  async function create() {
    await tx.run(
      async (signer) => {
        const program = address(network.programId);
        const organization = address(detail!.organization.address);
        const [config] = await findConfigPda(program);
        const [shard] = await findNonceShardPda(organization, nextId, program);
        return [
          createNonceShardInstruction({
            programAddress: program,
            authority: signer,
            membership: authority?.membership ?? null,
            config,
            organization,
            nonceShard: shard,
            payer: signer,
            shardId: nextId,
            relayer: address(network.relayer),
          }),
        ];
      },
      async () => {
        const [shard] = await findNonceShardPda(
          address(detail!.organization.address),
          nextId,
          address(network.programId),
        );
        await api(`/v1/organizations/${detail!.organization.id}/shards/sync`, {
          body: { address: shard },
        });
        await reloadDetail();
      },
    );
  }

  return (
    <div id="shards">
      <Panel
        title="Acceptance capacity"
        description="Each shard holds 65,536 single-use nonces — one per acceptance — and is relayed by Stele so users pay no fees. Add a shard before capacity runs out."
        actions={
          authority?.canManageShards ? (
            <Button
              size="sm"
              variant="secondary"
              loading={tx.pending}
              onClick={() => void create()}
            >
              Add shard
            </Button>
          ) : undefined
        }
        bodyClassName="p-0 sm:p-0"
      >
        <div className="px-5 pb-1 pt-4 text-[12.5px] text-fg-muted sm:px-6">
          {formatNumber(used)} of {formatNumber(capacity)} nonces issued (
          {capacity ? formatPercent(used / capacity) : "—"}). Shard rent ≈ 0.059 SOL each, paid by
          your wallet.
        </div>
        <Table head={["Shard", "Account", "Relayer", "Issued", "Status"]}>
          {detail.shards.map((s) => (
            <tr key={s.id}>
              <Td mono>#{s.shardId}</Td>
              <Td>
                <Fingerprint value={s.address} />
              </Td>
              <Td>
                {s.relayerIsStele ? (
                  "Stele relayer"
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12px]">{s.relayerAddress.slice(0, 8)}…</span>
                    {authority?.canManageShards && (
                      <button
                        type="button"
                        className="text-[12px] text-accent hover:text-accent-strong"
                        disabled={tx.pending}
                        onClick={() => void reassign(s)}
                      >
                        Use current Stele relayer
                      </button>
                    )}
                  </span>
                )}
              </Td>
              <Td>
                {formatNumber(s.nextIndex)} / {formatNumber(SHARD_CAPACITY)}
              </Td>
              <Td>
                {s.status === "active" ? (
                  <Badge tone="accent">Active</Badge>
                ) : (
                  <Badge>{s.status}</Badge>
                )}
              </Td>
            </tr>
          ))}
        </Table>
        {detail.shards.length === 0 && (
          <p className="px-6 py-6 text-[13px] text-fg-muted">
            No shards yet — acceptances are disabled until you add one.
          </p>
        )}
        <div className="space-y-3 px-5 py-4 sm:px-6">
          {authority?.canManageShards ? (
            <SigningAs />
          ) : (
            <SectionNote>Only the owner or an admin can add shards.</SectionNote>
          )}
          <TxStatus tx={tx} />
        </div>
      </Panel>
    </div>
  );
}

function Policy({ canEdit }: { canEdit: boolean }) {
  const network = useNetwork();
  const { detail, reloadDetail, withStepUp } = useDashboard();
  const [requireSessions, setRequireSessions] = useState(
    Boolean(detail?.organization.settings.requireAcceptanceSessions),
  );
  const [domains, setDomains] = useState(
    (detail?.organization.settings.allowedRequestDomains ?? []).join(", "),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (!detail) return null;
  const list = domains
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const invalid = list.find((d) => validationError(validateRequestDomain, d));

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await withStepUp(() =>
        api(`/v1/organizations/${detail!.organization.id}/settings`, {
          method: "PATCH",
          body: { requireAcceptanceSessions: requireSessions, allowedRequestDomains: list },
        }),
      );
      await reloadDetail();
      setMessage({ tone: "success", text: "Policy saved." });
    } catch (e) {
      setMessage({ tone: "danger", text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Acceptance policy"
      description="Off-chain rules the Stele API applies before issuing a signing request. Changing them requires a fresh wallet signature."
    >
      <RoleNotice allowed={canEdit}>
        Only the owner or an admin can change the acceptance policy.
      </RoleNotice>
      <div className="max-w-2xl space-y-5">
        <label className="flex items-start gap-3 text-[13.5px]">
          <input
            type="checkbox"
            checked={requireSessions}
            disabled={!canEdit}
            onChange={(e) => setRequireSessions(e.target.checked)}
            className="mt-1 accent-[var(--color-accent)]"
          />
          <span>
            <span className="font-medium text-fg">Require acceptance sessions</span>
            <span className="mt-0.5 block text-[12.5px] leading-relaxed text-fg-muted">
              Signing requests must carry a short-lived token your server created with an API key.
              Blocks bots and links each acceptance to your user ID (kept off-chain).
            </span>
          </span>
        </label>
        <Field
          label="Allowed requesting sites"
          htmlFor="sites"
          error={invalid ? `Invalid domain: ${invalid}` : null}
          hint={
            <>
              Hosts allowed to request signatures, comma-separated. Empty allows any site. Include{" "}
              <span className="font-mono">{network.hostedAcceptDomain}</span> to keep the hosted
              acceptance page working.
            </>
          }
        >
          <Input
            id="sites"
            value={domains}
            disabled={!canEdit}
            onChange={(e) => setDomains(e.target.value)}
            placeholder="app.acme.com, acme.com"
            className="font-mono text-[13px]"
          />
        </Field>
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <Button
          size="sm"
          disabled={!canEdit || Boolean(invalid)}
          loading={saving}
          onClick={() => void save()}
        >
          Save policy
        </Button>
      </div>
    </Panel>
  );
}

function Products({ canEdit }: { canEdit: boolean }) {
  const { detail, reloadDetail, withStepUp } = useDashboard();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!detail) return null;
  const gate = detail.organization.settings.products?.gate === true;

  async function toggle() {
    setSaving(true);
    setError(null);
    try {
      await withStepUp(() =>
        api(`/v1/organizations/${detail!.organization.id}/settings`, {
          method: "PATCH",
          body: { products: { gate: !gate } },
        }),
      );
      await reloadDetail();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Products"
      description="Stele Proof is always on. Stele Gate adds policies, AccessPasses and program integration to this dashboard."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-fg-muted">
          Stele Gate is{" "}
          <span className="font-medium text-fg">{gate ? "enabled" : "not enabled"}</span>. Turning
          it off hides the Gate pages only: policies and passes on Solana stay as they are, and
          programs keep enforcing them.
        </p>
        <Button
          size="sm"
          variant={gate ? "secondary" : "primary"}
          disabled={!canEdit}
          loading={saving}
          onClick={() => void toggle()}
        >
          {gate ? "Hide Stele Gate" : "Enable Stele Gate"}
        </Button>
      </div>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
    </Panel>
  );
}

export default function OrganizationPage() {
  const wallet = useWallet();
  const { detail, authorityOf } = useDashboard();
  const [authority, setAuthority] = useState<WalletAuthority | null>(null);
  useEffect(() => {
    void authorityOf(wallet.address).then(setAuthority);
  }, [authorityOf, wallet.address]);
  if (!detail) return null;
  const isAdmin = detail.role === "owner" || detail.role === "admin";
  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization"
        description="Identity, capacity and policy. On-chain facts are read from Solana; the dashboard never overrides them."
      />
      <Profile authority={authority} />
      <DomainSection canManage={isAdmin} />
      <Shards authority={authority} />
      <Policy canEdit={isAdmin} />
      <Products canEdit={isAdmin} />
      <Panel title="Integration identifiers">
        <CodeBlock
          code={`organization: ${detail.organization.address}\nverified domain: ${detail.organization.verifiedDomain ?? "(none)"}\nrelayer: ${detail.relayer}`}
          language="text"
        />
      </Panel>
    </div>
  );
}
