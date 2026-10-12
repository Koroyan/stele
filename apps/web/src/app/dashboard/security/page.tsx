"use client";
/**
 * Organization authority controls. State is read from the organization account on Solana; every
 * action is a wallet-signed instruction whose rules (owner / recovery / timelocks) the program
 * enforces. Buttons are offered only to wallets the program would accept.
 */
import { useCallback, useEffect, useState } from "react";
import { address, isAddress, type Instruction, type TransactionSigner } from "@solana/kit";
import {
  decodeOrganization,
  fetchAccountData,
  FROZEN_BY_RECOVERY,
  initiateOwnerRecoveryInstruction,
  organizationAuthorityInstruction,
  proposeOwnerInstruction,
  proposeRecoveryInstruction,
  type OrganizationAccount,
} from "@stelehq/protocol";
import { Alert, Badge, Button, Field, Fingerprint, Input, KeyValue } from "@stele/ui";
import {
  PageHeader,
  Panel,
  SectionNote,
  SigningAs,
  TxStatus,
  useTransaction,
} from "@/components/dashboard/ui";
import { api } from "@/lib/api";
import { rpcFor } from "@/lib/chain";
import { useDashboard } from "@/lib/dashboard";
import { formatDateTime, relativeTime } from "@/lib/format";
import { useNetwork, useWallet } from "@/lib/wallet";

type AuthorityName = Parameters<typeof organizationAuthorityInstruction>[0]["name"];

function eta(seconds: bigint): { label: string; ready: boolean } {
  const s = Number(seconds);
  const ready = s * 1000 <= Date.now();
  return { label: `${formatDateTime(s)} (${ready ? "ready" : relativeTime(s)})`, ready };
}

export default function SecurityPage() {
  const network = useNetwork();
  const wallet = useWallet();
  const { detail, reloadDetail, reloadOrgs, user, reauthenticate, recentlyAuthenticated } =
    useDashboard();
  const [org, setOrg] = useState<OrganizationAccount | null>(null);
  const [newOwner, setNewOwner] = useState("");
  const [newRecovery, setNewRecovery] = useState("");
  const [recoveryTarget, setRecoveryTarget] = useState("");
  const [stepUp, setStepUp] = useState<string | null>(null);
  const tx = useTransaction();

  const load = useCallback(async () => {
    if (!detail) return;
    const data = await fetchAccountData(rpcFor(network), address(detail.organization.address));
    setOrg(data ? decodeOrganization(data) : null);
  }, [detail, network]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!detail) return null;
  const organization = address(detail.organization.address);
  const program = address(network.programId);
  const me = wallet.address;
  const isOwner = Boolean(org && me && org.owner === me);
  const isRecovery = Boolean(org && me && org.recovery === me);
  const isPendingOwner = Boolean(org && me && org.pendingOwner === me);
  const recoveryLocked = Boolean(org?.frozen && org.frozenBy === FROZEN_BY_RECOVERY);

  async function send(build: (signer: TransactionSigner) => Instruction[]) {
    await tx.run(build, async () => {
      await api(`/v1/organizations/${detail!.organization.id}/refresh`, { method: "POST" });
      await Promise.all([load(), reloadDetail(), reloadOrgs()]);
    });
  }
  const simple = (name: AuthorityName) =>
    send((signer) => [
      organizationAuthorityInstruction({
        programAddress: program,
        name,
        authority: signer,
        organization,
      }),
    ]);

  const addrError = (v: string, other?: string | null) =>
    v && !isAddress(v.trim())
      ? "Not a valid Solana address."
      : v && other && v.trim() === other
        ? "Must differ from the current owner."
        : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security"
        description="Who controls this organization on-chain, and the controls for incidents. Every change here is a public, timestamped transaction."
      />

      {!org ? (
        <Alert tone="info">Reading the organization account from Solana…</Alert>
      ) : (
        <>
          <Panel title="Authorities" description="Read live from the organization account.">
            <KeyValue
              items={[
                {
                  label: "Owner",
                  value: (
                    <span className="flex flex-wrap items-center gap-2">
                      <Fingerprint value={org.owner} mode="full" />
                      {isOwner && <Badge tone="accent">You</Badge>}
                    </span>
                  ),
                },
                {
                  label: "Pending owner",
                  value: org.pendingOwner ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Fingerprint value={org.pendingOwner} mode="full" />
                      {isPendingOwner && <Badge tone="accent">You</Badge>}
                    </span>
                  ) : (
                    "None"
                  ),
                },
                {
                  label: "Recovery authority",
                  value: org.recovery ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Fingerprint value={org.recovery} mode="full" />
                      {isRecovery && <Badge tone="accent">You</Badge>}
                    </span>
                  ) : (
                    <span className="text-warning">
                      Not configured — a lost owner key would be unrecoverable
                    </span>
                  ),
                },
                {
                  label: "Pending recovery change",
                  value:
                    org.pendingRecoveryEta > 0n
                      ? `${org.pendingRecovery ?? "Remove recovery"} — effective ${eta(org.pendingRecoveryEta).label}`
                      : "None",
                },
                {
                  label: "Owner replacement",
                  value:
                    org.recoveryEta > 0n
                      ? `${org.recoveryTargetOwner} — executable ${eta(org.recoveryEta).label}`
                      : "None in progress",
                },
                {
                  label: "Status",
                  value: org.frozen ? (
                    <Badge tone="danger">
                      {org.frozenBy === FROZEN_BY_RECOVERY
                        ? "Frozen by recovery authority"
                        : "Frozen by owner"}
                    </Badge>
                  ) : (
                    <Badge>Active</Badge>
                  ),
                },
              ]}
            />
            <div className="mt-5 space-y-3">
              <SigningAs />
              <TxStatus tx={tx} />
            </div>
          </Panel>

          <Panel
            title="Emergency freeze"
            description="Stops publishing and new acceptances immediately; member and authority management stay available for the response. Existing evidence stays valid and verifiable. A freeze by the recovery authority can only be lifted by it."
          >
            <div className="flex flex-wrap gap-3">
              {!org.frozen && (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!(isRecovery || (isOwner && !recoveryLocked))}
                  loading={tx.pending}
                  onClick={() => void simple("freeze_organization")}
                >
                  Freeze organization
                </Button>
              )}
              {org.frozen && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!(isRecovery || (isOwner && !recoveryLocked))}
                  loading={tx.pending}
                  onClick={() => void simple("unfreeze_organization")}
                >
                  Unfreeze
                </Button>
              )}
            </div>
            {!isOwner && !isRecovery && (
              <SectionNote>Connect the owner or recovery wallet to use these controls.</SectionNote>
            )}
          </Panel>

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel
              title="Transfer ownership"
              description="Two steps: the owner proposes, then the new owner accepts by signing with the new key. Use this to move ownership to a multisig (for example a Squads vault)."
            >
              {isPendingOwner && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-line bg-accent-soft px-4 py-3">
                  <span className="text-[13px] text-fg">
                    You have been proposed as the new owner.
                  </span>
                  <Button
                    size="sm"
                    loading={tx.pending}
                    onClick={() => void simple("accept_ownership")}
                  >
                    Accept ownership
                  </Button>
                </div>
              )}
              {isOwner ? (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!addrError(newOwner, org.owner) && newOwner)
                      void send((signer) => [
                        proposeOwnerInstruction({
                          programAddress: program,
                          authority: signer,
                          organization,
                          newOwner: address(newOwner.trim()),
                        }),
                      ]);
                  }}
                >
                  <Field
                    label="New owner address"
                    htmlFor="new-owner"
                    error={addrError(newOwner, org.owner)}
                  >
                    <Input
                      id="new-owner"
                      value={newOwner}
                      onChange={(e) => setNewOwner(e.target.value)}
                      className="font-mono text-[13px]"
                      spellCheck={false}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="submit"
                      size="sm"
                      variant="secondary"
                      disabled={!newOwner || Boolean(addrError(newOwner, org.owner))}
                      loading={tx.pending}
                    >
                      Propose new owner
                    </Button>
                    {org.pendingOwner && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void simple("cancel_owner_transfer")}
                      >
                        Cancel pending transfer
                      </Button>
                    )}
                  </div>
                </form>
              ) : (
                !isPendingOwner && (
                  <SectionNote>Only the current owner can propose a transfer.</SectionNote>
                )
              )}
            </Panel>

            <Panel
              title="Recovery authority"
              description="Changes take effect after a 72-hour public timelock, so a stolen owner key cannot silently replace the recovery key."
            >
              {isOwner ? (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!addrError(newRecovery, org.owner))
                      void send((signer) => [
                        proposeRecoveryInstruction({
                          programAddress: program,
                          authority: signer,
                          organization,
                          newRecovery: newRecovery.trim() ? address(newRecovery.trim()) : null,
                        }),
                      ]);
                  }}
                >
                  <Field
                    label="New recovery address (empty to remove)"
                    htmlFor="new-recovery"
                    error={addrError(newRecovery, org.owner)}
                  >
                    <Input
                      id="new-recovery"
                      value={newRecovery}
                      onChange={(e) => setNewRecovery(e.target.value)}
                      className="font-mono text-[13px]"
                      spellCheck={false}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="submit"
                      size="sm"
                      variant="secondary"
                      disabled={Boolean(addrError(newRecovery, org.owner))}
                      loading={tx.pending}
                    >
                      Propose change
                    </Button>
                    {org.pendingRecoveryEta > 0n && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={!eta(org.pendingRecoveryEta).ready}
                        onClick={() => void simple("apply_recovery_change")}
                      >
                        Apply change
                      </Button>
                    )}
                  </div>
                </form>
              ) : (
                <SectionNote>Only the owner can propose a recovery change.</SectionNote>
              )}
              {org.pendingRecoveryEta > 0n && (isOwner || isRecovery) && (
                <Button
                  className="mt-3"
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void simple("cancel_recovery_change")}
                >
                  Cancel pending change
                </Button>
              )}
            </Panel>
          </div>

          <Panel
            title="Replace a lost or compromised owner"
            description="The recovery authority can appoint a new owner after a 72-hour public timelock, during which the current owner can cancel — unless the recovery authority has frozen the organization."
          >
            {isRecovery ? (
              <form
                className="max-w-2xl space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (recoveryTarget && !addrError(recoveryTarget))
                    void send((signer) => [
                      initiateOwnerRecoveryInstruction({
                        programAddress: program,
                        authority: signer,
                        organization,
                        newOwner: address(recoveryTarget.trim()),
                      }),
                    ]);
                }}
              >
                <Field
                  label="New owner address"
                  htmlFor="recovery-target"
                  error={addrError(recoveryTarget)}
                >
                  <Input
                    id="recovery-target"
                    value={recoveryTarget}
                    onChange={(e) => setRecoveryTarget(e.target.value)}
                    className="font-mono text-[13px]"
                    spellCheck={false}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    variant="danger"
                    disabled={!recoveryTarget || Boolean(addrError(recoveryTarget))}
                    loading={tx.pending}
                  >
                    Start owner replacement
                  </Button>
                  {org.recoveryEta > 0n && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={!eta(org.recoveryEta).ready}
                      onClick={() => void simple("execute_owner_recovery")}
                    >
                      Execute replacement
                    </Button>
                  )}
                </div>
              </form>
            ) : (
              <SectionNote>
                Connect the recovery authority&apos;s wallet to use this control.
              </SectionNote>
            )}
            {org.recoveryEta > 0n && (isRecovery || (isOwner && !recoveryLocked)) && (
              <Button
                className="mt-3"
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void simple("cancel_owner_recovery")}
              >
                Cancel owner replacement
              </Button>
            )}
          </Panel>
        </>
      )}

      <Panel
        title="Dashboard session"
        description="Sessions authorize dashboard actions only; on-chain actions always require a wallet signature."
      >
        <KeyValue
          items={[
            {
              label: "Signed in as",
              value: <Fingerprint value={user.walletAddress} mode="full" />,
            },
            {
              label: "Recent signature",
              value: recentlyAuthenticated
                ? "Yes — sensitive actions are unlocked for a few minutes"
                : "No — you will be asked to sign before sensitive actions",
            },
          ]}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setStepUp(null);
              reauthenticate()
                .then(() => setStepUp("Confirmed with your wallet."))
                .catch((e: unknown) => setStepUp(e instanceof Error ? e.message : String(e)));
            }}
          >
            Confirm with wallet now
          </Button>
          {stepUp && <span className="text-[12.5px] text-fg-muted">{stepUp}</span>}
        </div>
      </Panel>
    </div>
  );
}
