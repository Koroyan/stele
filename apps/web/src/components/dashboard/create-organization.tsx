"use client";
/**
 * Organization onboarding: one wallet-signed transaction creates the organization account and its
 * first acceptance shard (relayed by Stele). The API then mirrors both by reading the chain.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { address, isAddress } from "@solana/kit";
import {
  createNonceShardInstruction,
  createOrganizationInstruction,
  findConfigPda,
  findNonceShardPda,
  findOrganizationPda,
  normalizeDisplayString,
  utf8Length,
  validateOrgName,
  validationError,
} from "@stele/protocol";
import { Alert, Button, Card, Field, Input } from "@stele/ui";
import { api } from "@/lib/api";
import { rpcFor } from "@/lib/chain";
import { useDashboard } from "@/lib/dashboard";
import { useNetwork, useWallet } from "@/lib/wallet";
import { SigningAs, TxStatus, useTransaction } from "./ui";

export function CreateOrganization({
  firstTime,
  onCancel,
}: {
  firstTime: boolean;
  onCancel?: () => void;
}) {
  const network = useNetwork();
  const wallet = useWallet();
  const router = useRouter();
  const { reloadOrgs, selectOrg } = useDashboard();
  const tx = useTransaction();
  const [name, setName] = useState("");
  const [recovery, setRecovery] = useState("");
  const [airdrop, setAirdrop] = useState<string | null>(null);

  const normalized = normalizeDisplayString(name);
  const nameError = name ? validationError(validateOrgName, normalized) : null;
  const recoveryError =
    recovery && !isAddress(recovery.trim())
      ? "Not a valid Solana address."
      : recovery.trim() && recovery.trim() === wallet.address
        ? "The recovery authority must be a different key from the owner."
        : null;
  const canSubmit =
    Boolean(wallet.signer) && normalized.length > 0 && !nameError && !recoveryError && !tx.pending;

  async function requestAirdrop() {
    if (!wallet.address) return;
    setAirdrop("Requesting test SOL…");
    try {
      await rpcFor(network)
        .requestAirdrop(address(wallet.address), 2_000_000_000n as never)
        .send();
      setAirdrop("2 test SOL requested. It may take a few seconds to arrive.");
    } catch (e) {
      setAirdrop(`Airdrop failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function create() {
    const program = address(network.programId);
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const [config] = await findConfigPda(program);
    await tx.run(
      async (signer) => {
        const [organization] = await findOrganizationPda(signer.address, seed, program);
        const [shard] = await findNonceShardPda(organization, 0, program);
        return [
          createOrganizationInstruction({
            programAddress: program,
            creator: signer,
            payer: signer,
            config,
            organization,
            seed,
            name: normalized,
            owner: signer.address,
            recovery: recovery.trim() ? address(recovery.trim()) : null,
          }),
          createNonceShardInstruction({
            programAddress: program,
            authority: signer,
            membership: null,
            config,
            organization,
            nonceShard: shard,
            payer: signer,
            shardId: 0,
            relayer: address(network.relayer),
          }),
        ];
      },
      async () => {
        // The API mirrors the new accounts by reading them from the chain; it trusts nothing we send.
        const [organization] = await findOrganizationPda(address(wallet.address!), seed, program);
        const [shard] = await findNonceShardPda(organization, 0, program);
        const synced = await api<{ organization: { id: string } }>("/v1/organizations/sync", {
          body: { address: organization },
        });
        await api(`/v1/organizations/${synced.organization.id}/shards/sync`, {
          body: { address: shard },
        });
        selectOrg(synced.organization.id);
        await reloadOrgs();
        router.replace("/dashboard");
      },
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-[12.5px] font-medium uppercase tracking-[0.12em] text-accent">
        {firstTime ? "Welcome" : "New organization"}
      </p>
      <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.025em] text-fg">
        Create your organization on Solana
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
        Your organization is an on-chain account that only its authorities can control. Documents
        you publish and acceptances users sign are bound to it. Your connected wallet becomes the
        owner — you can transfer ownership to a multisig later.
      </p>

      <Card className="mt-8">
        <form
          className="space-y-5 px-6 py-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) void create();
          }}
        >
          <Field
            label="Organization name"
            htmlFor="org-name"
            error={nameError}
            hint={`Shown to users in every signature request, next to your verification status. ${utf8Length(normalized)}/40 bytes.`}
          >
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              maxLength={80}
              autoComplete="organization"
            />
          </Field>
          <Field
            label="Recovery authority (recommended)"
            htmlFor="recovery"
            error={recoveryError}
            hint="A separate key — ideally kept offline or held by another person — that can freeze the organization instantly and replace a lost or compromised owner after a 72-hour public delay."
          >
            <Input
              id="recovery"
              value={recovery}
              onChange={(e) => setRecovery(e.target.value)}
              placeholder="Solana address"
              className="font-mono text-[13px]"
              spellCheck={false}
            />
          </Field>

          <div className="rounded-xl border border-line bg-bg-raised px-4 py-3 text-[12.5px] leading-relaxed text-fg-muted">
            One transaction creates the organization account and an acceptance shard with capacity
            for 65,536 acceptances. Your wallet pays about
            <span className="text-fg"> 0.063 SOL</span> in rent (locked permanently — evidence
            accounts are never closed) plus the network fee. Display names are self-declared; verify
            your domain next so users see a verified identity.
          </div>

          <SigningAs need="SOL for rent" />
          {network.cluster !== "mainnet" && wallet.address && (
            <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-fg-muted">
              <Button type="button" size="sm" variant="ghost" onClick={() => void requestAirdrop()}>
                Request test SOL ({network.label})
              </Button>
              {airdrop && <span>{airdrop}</span>}
            </div>
          )}
          <TxStatus tx={tx} />
          <div className="flex flex-wrap gap-3 pt-1">
            <Button type="submit" disabled={!canSubmit} loading={tx.pending}>
              Create organization
            </Button>
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
          {tx.status === "error" && /insufficient|no SOL|enough SOL/i.test(tx.error ?? "") && (
            <Alert tone="info">
              Fund the connected wallet with SOL on {network.label}, then try again.
            </Alert>
          )}
        </form>
      </Card>
    </div>
  );
}
