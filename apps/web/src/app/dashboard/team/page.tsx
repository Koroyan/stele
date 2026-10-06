"use client";
/**
 * Team members are on-chain Member accounts. Adding, changing roles, revoking and reporting a key
 * compromise are wallet-signed transactions; only labels are stored off-chain.
 */
import { useEffect, useState } from "react";
import { address, isAddress } from "@solana/kit";
import {
  addMemberInstruction,
  findMemberPda,
  manageMemberInstruction,
  ROLE_ADMIN,
  ROLE_PUBLISHER,
} from "@stele/protocol";
import { Alert, Badge, Button, Dialog, Field, Fingerprint, Input } from "@stele/ui";
import { rolesLabel } from "@/components/dashboard/labels";
import {
  PageHeader,
  Panel,
  RoleNotice,
  SigningAs,
  Table,
  Td,
  TxStatus,
  useTransaction,
} from "@/components/dashboard/ui";
import { api, errorMessage } from "@/lib/api";
import { useDashboard, type MemberRow, type WalletAuthority } from "@/lib/dashboard";
import { formatDateTime } from "@/lib/format";
import { useNetwork, useWallet } from "@/lib/wallet";

function RolePicker({
  roles,
  onChange,
  allowAdmin,
}: {
  roles: number;
  onChange: (r: number) => void;
  allowAdmin: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-4 text-[13.5px]">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={Boolean(roles & ROLE_PUBLISHER)}
          onChange={(e) =>
            onChange(e.target.checked ? roles | ROLE_PUBLISHER : roles & ~ROLE_PUBLISHER)
          }
          className="mt-1 accent-[var(--color-accent)]"
        />
        <span>
          <span className="text-fg">Publisher</span>
          <span className="block text-[12px] text-fg-subtle">
            Creates documents and publishes new versions.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          disabled={!allowAdmin}
          checked={Boolean(roles & ROLE_ADMIN)}
          onChange={(e) => onChange(e.target.checked ? roles | ROLE_ADMIN : roles & ~ROLE_ADMIN)}
          className="mt-1 accent-[var(--color-accent)]"
        />
        <span>
          <span className="text-fg">Admin</span>
          <span className="block text-[12px] text-fg-subtle">
            Manages publishers, documents and acceptance shards.
            {!allowAdmin && " Only the owner can grant it."}
          </span>
        </span>
      </label>
    </div>
  );
}

export default function TeamPage() {
  const network = useNetwork();
  const wallet = useWallet();
  const { detail, reloadDetail, authorityOf } = useDashboard();
  const [authority, setAuthority] = useState<WalletAuthority | null>(null);
  const tx = useTransaction();
  const [newAddress, setNewAddress] = useState("");
  const [newRoles, setNewRoles] = useState(ROLE_PUBLISHER);
  const [editing, setEditing] = useState<{
    member: MemberRow;
    mode: "roles" | "revoke" | "compromise" | "label";
  } | null>(null);
  const [editRoles, setEditRoles] = useState(0);
  const [since, setSince] = useState("");
  const [label, setLabel] = useState("");
  const [labelError, setLabelError] = useState<string | null>(null);

  useEffect(() => {
    void authorityOf(wallet.address).then(setAuthority);
  }, [authorityOf, wallet.address]);

  if (!detail) return null;
  const program = address(network.programId);
  const organization = address(detail.organization.address);
  const canManage = Boolean(authority?.canManageMembers);
  const ownerMode = Boolean(authority?.isOwner);
  const addressError =
    newAddress && !isAddress(newAddress.trim())
      ? "Not a valid Solana address."
      : newAddress.trim() === detail.organization.ownerAddress
        ? "That is the owner."
        : null;

  async function add() {
    const member = address(newAddress.trim());
    await tx.run(
      async (signer) => {
        const [memberAccount] = await findMemberPda(organization, member, program);
        return [
          addMemberInstruction({
            programAddress: program,
            authority: signer,
            authorityMembership: authority?.membership ?? null,
            organization,
            memberAccount,
            member,
            roles: newRoles,
            payer: signer,
          }),
        ];
      },
      async () => {
        await api(`/v1/organizations/${detail!.organization.id}/refresh`, { method: "POST" });
        await reloadDetail();
        setNewAddress("");
      },
    );
  }

  async function manage(
    m: MemberRow,
    action: Parameters<typeof manageMemberInstruction>[0]["action"],
  ) {
    await tx.run(
      async (signer) => {
        const [memberAccount] = await findMemberPda(
          organization,
          address(m.memberAddress),
          program,
        );
        const selfReport =
          action.kind === "report_key_compromise" && signer.address === m.memberAddress;
        return [
          manageMemberInstruction({
            programAddress: program,
            authority: signer,
            authorityMembership: selfReport ? null : (authority?.membership ?? null),
            organization,
            memberAccount,
            action,
          }),
        ];
      },
      async () => {
        await api(`/v1/organizations/${detail!.organization.id}/refresh`, { method: "POST" });
        await reloadDetail();
        setEditing(null);
      },
    );
  }

  async function saveLabel(m: MemberRow) {
    setLabelError(null);
    try {
      await api(`/v1/organizations/${detail!.organization.id}/members/${m.memberAddress}`, {
        method: "PATCH",
        body: { label: label.trim() || null },
      });
      await reloadDetail();
      setEditing(null);
    } catch (e) {
      setLabelError(errorMessage(e));
    }
  }

  const members = [...detail.members].sort((a, b) => Number(b.active) - Number(a.active));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description="Members and roles are enforced by the Solana program. Revocations and compromise reports are permanent, timestamped records."
      />

      <Panel
        title="Owner"
        description="Full authority. Transfer ownership (two-step) on the Security page; a multisig is recommended."
      >
        <Fingerprint value={detail.organization.ownerAddress} mode="full" />
      </Panel>

      <Panel title="Members" bodyClassName="p-0 sm:p-0">
        <Table head={["Member", "Roles", "Status", "Updated", ""]}>
          {members.map((m) => (
            <tr key={m.memberAddress}>
              <Td>
                <Fingerprint value={m.memberAddress} />
                {m.label && <p className="mt-0.5 text-[12px] text-fg-subtle">{m.label}</p>}
              </Td>
              <Td>{rolesLabel(m.roles)}</Td>
              <Td>
                {m.compromisedSince ? (
                  <Badge tone="danger">
                    Compromised since {formatDateTime(m.compromisedSince)}
                  </Badge>
                ) : m.active ? (
                  <Badge tone="accent">Active</Badge>
                ) : (
                  <Badge>Revoked</Badge>
                )}
              </Td>
              <Td className="whitespace-nowrap">
                {m.updatedAt ? formatDateTime(m.updatedAt) : "—"}
              </Td>
              <Td className="whitespace-nowrap text-right">
                <div className="flex justify-end gap-3 text-[12.5px]">
                  <button
                    type="button"
                    className="text-fg-muted hover:text-fg"
                    onClick={() => (
                      setLabel(m.label ?? ""),
                      setEditing({ member: m, mode: "label" })
                    )}
                  >
                    Label
                  </button>
                  {canManage && m.active && !m.compromisedSince && (
                    <>
                      <button
                        type="button"
                        className="text-fg-muted hover:text-fg"
                        onClick={() => (
                          setEditRoles(m.roles),
                          setEditing({ member: m, mode: "roles" })
                        )}
                      >
                        Roles
                      </button>
                      <button
                        type="button"
                        className="text-fg-muted hover:text-danger"
                        onClick={() => setEditing({ member: m, mode: "revoke" })}
                      >
                        Revoke
                      </button>
                    </>
                  )}
                  {!m.compromisedSince &&
                    (canManage || authority?.isRecovery || wallet.address === m.memberAddress) && (
                      <button
                        type="button"
                        className="text-danger hover:text-danger/80"
                        onClick={() => (
                          setSince(new Date().toISOString().slice(0, 16)),
                          setEditing({ member: m, mode: "compromise" })
                        )}
                      >
                        Report compromise
                      </button>
                    )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
        {members.length === 0 && (
          <p className="px-6 py-6 text-[13px] text-fg-muted">
            No members yet. Add a publisher so routine publishing does not require the owner key.
          </p>
        )}
      </Panel>

      <Panel
        title="Add a member"
        description="The member's wallet address and roles are written on-chain. Rent ≈ 0.0019 SOL, paid by your wallet."
      >
        <RoleNotice allowed={canManage || !wallet.address}>
          Only the owner or an admin can add members.
        </RoleNotice>
        <form
          className="max-w-2xl space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!addressError && newAddress && newRoles) void add();
          }}
        >
          <Field label="Wallet address" htmlFor="member" error={addressError}>
            <Input
              id="member"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              className="font-mono text-[13px]"
              spellCheck={false}
              placeholder="Base58 address"
            />
          </Field>
          <RolePicker roles={newRoles} onChange={setNewRoles} allowAdmin={ownerMode} />
          <SigningAs />
          {editing === null && <TxStatus tx={tx} />}
          <Button
            type="submit"
            size="sm"
            disabled={!canManage || !newAddress || Boolean(addressError) || newRoles === 0}
            loading={tx.pending && editing === null}
          >
            Add member
          </Button>
        </form>
      </Panel>

      <Dialog
        open={editing !== null}
        onClose={() => !tx.pending && setEditing(null)}
        title={
          editing?.mode === "roles"
            ? "Change roles"
            : editing?.mode === "revoke"
              ? "Revoke member"
              : editing?.mode === "compromise"
                ? "Report key compromise"
                : "Member label"
        }
        description={editing ? editing.member.memberAddress : undefined}
        footer={
          editing && (
            <>
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={tx.pending}>
                Cancel
              </Button>
              {editing.mode === "label" ? (
                <Button onClick={() => void saveLabel(editing.member)}>Save label</Button>
              ) : editing.mode === "roles" ? (
                <Button
                  loading={tx.pending}
                  disabled={editRoles === 0}
                  onClick={() =>
                    void manage(editing.member, { kind: "update_member", roles: editRoles })
                  }
                >
                  Sign &amp; update
                </Button>
              ) : editing.mode === "revoke" ? (
                <Button
                  variant="danger"
                  loading={tx.pending}
                  onClick={() => void manage(editing.member, { kind: "revoke_member" })}
                >
                  Sign &amp; revoke
                </Button>
              ) : (
                <Button
                  variant="danger"
                  loading={tx.pending}
                  disabled={!since}
                  onClick={() =>
                    void manage(editing.member, {
                      kind: "report_key_compromise",
                      compromisedSince: Math.floor(Date.parse(`${since}:00Z`) / 1000),
                    })
                  }
                >
                  Sign &amp; report
                </Button>
              )}
            </>
          )
        }
      >
        {editing?.mode === "label" && (
          <div className="space-y-3">
            <Field
              label="Label (private, off-chain)"
              htmlFor="label"
              hint="For your team only — for example a person's name. Never written on-chain."
            >
              <Input
                id="label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={80}
              />
            </Field>
            {labelError && <Alert tone="danger">{labelError}</Alert>}
          </div>
        )}
        {editing?.mode === "roles" && (
          <RolePicker roles={editRoles} onChange={setEditRoles} allowAdmin={ownerMode} />
        )}
        {editing?.mode === "revoke" && (
          <p className="text-[13.5px] leading-relaxed text-fg-muted">
            The member loses all roles immediately. Versions they published before revocation remain
            valid. The record stays on-chain and can be re-activated later by changing roles.
          </p>
        )}
        {editing?.mode === "compromise" && (
          <div className="space-y-4">
            <Alert tone="warning">
              This permanently revokes the key and marks everything it signed after the given time
              as signed by a compromised key. It cannot be undone or re-activated.
            </Alert>
            <Field
              label="Compromised since (UTC)"
              htmlFor="since"
              hint="The earliest time the key may have been in someone else's hands. Must not be in the future."
            >
              <Input
                id="since"
                type="datetime-local"
                value={since}
                onChange={(e) => setSince(e.target.value)}
              />
            </Field>
          </div>
        )}
        {editing && editing.mode !== "label" && (
          <div className="mt-5 space-y-3">
            <SigningAs />
            <TxStatus tx={tx} />
          </div>
        )}
      </Dialog>
    </div>
  );
}
