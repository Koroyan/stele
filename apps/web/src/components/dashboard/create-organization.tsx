"use client";
/**
 * Organization onboarding: one wallet-signed transaction creates the organization account and its
 * first acceptance shard (relayed by Stele). The API then mirrors both by reading the chain.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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
} from "@stelehq/protocol";
import { Alert, Button, Card, Field, FileIcon, GateIcon, Input, cn } from "@stele/ui";
import { api } from "@/lib/api";
import { rpcFor } from "@/lib/chain";
import { useDashboard } from "@/lib/dashboard";
import { useNetwork, useWallet } from "@/lib/wallet";
import { SigningAs, TxStatus, useTransaction } from "./ui";

const PRODUCTS = [
  {
    id: "proof" as const,
    icon: FileIcon,
    title: "Stele Proof",
    body: "Prove what users accepted: wallet- or passkey-signed acceptances with public receipts.",
    examples: "Websites, SaaS, apps, onboarding, consent",
  },
  {
    id: "gate" as const,
    icon: GateIcon,
    title: "Stele Gate",
    body: "Require the current terms before a protected action, checked by your Solana program.",
    examples: "RWA vaults, permissioned pools, token sales",
  },
];

/** Rent for the organization and its first shard, plus fees, with a small margin. */
const NEEDED_LAMPORTS = 65_000_000n;
const formatSol = (l: bigint) => (Number(l) / 1e9).toFixed(Number(l) === 0 ? 0 : 4);

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
  const { reloadOrgs, selectOrg, withStepUp } = useDashboard();
  const tx = useTransaction();
  const [name, setName] = useState("");
  const [recovery, setRecovery] = useState("");
  const [airdrop, setAirdrop] = useState<string | null>(null);
  const [product, setProduct] = useState<"proof" | "gate">("proof");
  // The wallet's balance, checked before the user tries: creating needs rent for two accounts.
  const [lamports, setLamports] = useState<bigint | null>(null);
  const refreshBalance = useCallback(async () => {
    if (!wallet.address) return setLamports(null);
    try {
      const { value } = await rpcFor(network).getBalance(address(wallet.address)).send();
      setLamports(BigInt(value));
    } catch {
      setLamports(null); // unknown: never block on an RPC hiccup
    }
  }, [network, wallet.address]);
  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);
  const short = lamports !== null && lamports < NEEDED_LAMPORTS;

  const normalized = normalizeDisplayString(name);
  const nameError = name ? validationError(validateOrgName, normalized) : null;
  const recoveryError =
    recovery && !isAddress(recovery.trim())
      ? "Not a valid Solana address."
      : recovery.trim() && recovery.trim() === wallet.address
        ? "The recovery authority must be a different key from the owner."
        : null;
  const canSubmit =
    Boolean(wallet.signer) &&
    normalized.length > 0 &&
    !nameError &&
    !recoveryError &&
    !short &&
    !tx.pending;

  async function requestAirdrop() {
    if (!wallet.address) return;
    setAirdrop("Requesting test SOL…");
    try {
      await rpcFor(network)
        .requestAirdrop(address(wallet.address), 2_000_000_000n as never)
        .send();
      setAirdrop("2 test SOL requested. It may take a few seconds to arrive.");
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const { value } = await rpcFor(network).getBalance(address(wallet.address)).send();
        setLamports(BigInt(value));
        if (BigInt(value) >= NEEDED_LAMPORTS) {
          setAirdrop(null);
          break;
        }
      }
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
        if (product === "gate") {
          // A settings change needs a fresh wallet signature; if it is declined, the Gate pages
          // offer the same switch later.
          await withStepUp(() =>
            api(`/v1/organizations/${synced.organization.id}/settings`, {
              method: "PATCH",
              body: { products: { gate: true } },
            }),
          ).catch(() => undefined);
        }
        selectOrg(synced.organization.id);
        await reloadOrgs();
        router.replace(product === "gate" ? "/dashboard/gate" : "/dashboard");
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
          <fieldset>
            <legend className="text-[13px] font-medium text-fg">How will you use Stele?</legend>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PRODUCTS.map((p) => {
                const Icon = p.icon;
                const checked = product === p.id;
                return (
                  <label
                    key={p.id}
                    className={cn(
                      "relative flex cursor-pointer flex-col gap-1.5 rounded-xl border px-4 py-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                      checked
                        ? "border-accent-line bg-accent-soft"
                        : "border-line hover:border-line-strong",
                    )}
                  >
                    <input
                      type="radio"
                      name="product"
                      value={p.id}
                      checked={checked}
                      onChange={() => setProduct(p.id)}
                      className="sr-only"
                    />
                    <span className="flex items-center gap-2 text-[14px] font-semibold text-fg">
                      <Icon className={cn("h-4 w-4", checked ? "text-accent" : "text-fg-subtle")} />
                      {p.title}
                    </span>
                    <span className="text-[12.5px] leading-relaxed text-fg-muted">{p.body}</span>
                    <span className="text-[11.5px] text-fg-subtle">{p.examples}</span>
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-[12px] text-fg-subtle">
              Gate includes everything in Proof. You can switch Gate on later.
            </p>
          </fieldset>

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
          {short && (
            <Alert tone="warning">
              Your wallet has {formatSol(lamports!)} SOL; creating the organization needs about
              0.065 SOL.{" "}
              {network.cluster === "mainnet"
                ? "Send some SOL to this wallet, then continue."
                : `On ${network.label}, test SOL is free:`}
              {network.cluster !== "mainnet" && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void requestAirdrop()}
                  >
                    Get 2 test SOL
                  </Button>
                  {airdrop && <span className="text-[12.5px]">{airdrop}</span>}
                </div>
              )}
            </Alert>
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
