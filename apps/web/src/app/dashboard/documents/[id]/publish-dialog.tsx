"use client";
/**
 * Publication. The API prepares the publication, but before the wallet is asked to sign, this
 * browser recomputes everything independently — canonical bytes from the draft text and the
 * fingerprint from live chain state — and refuses to continue on any difference. The program then
 * recomputes the fingerprint a third time and rejects the transaction unless it matches.
 */
import { useEffect, useState } from "react";
import { address } from "@solana/kit";
import {
  authoringInput,
  canonicalizeContent,
  findConfigPda,
  fromHex,
  fromUtf8,
  groupedFingerprint,
  preparePublication,
  publishVersionInstruction,
  toHex,
} from "@stele/protocol";
import { Alert, Button, CheckIcon, Dialog, KeyValue, Spinner, Steps } from "@stele/ui";
import { SigningAs, TxLink, useTransaction } from "@/components/dashboard/ui";
import { api, errorMessage } from "@/lib/api";
import { rpcFor } from "@/lib/chain";
import { useDashboard, type WalletAuthority } from "@/lib/dashboard";
import { formatDateTime } from "@/lib/format";
import { useNetwork, useWallet } from "@/lib/wallet";
import type { DocDetail, DraftRow, Publication } from "./types";

type Check = { label: string; ok: boolean; detail: string };

export function PublishDialog({
  doc,
  draft,
  open,
  onClose,
  onPublished,
}: {
  doc: DocDetail;
  draft: DraftRow;
  open: boolean;
  onClose: () => void;
  onPublished: () => void;
}) {
  const network = useNetwork();
  const wallet = useWallet();
  const { authorityOf } = useDashboard();
  const tx = useTransaction();
  const [phase, setPhase] = useState<"preparing" | "review" | "blocked" | "error">("preparing");
  const [publication, setPublication] = useState<Publication | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [authority, setAuthority] = useState<WalletAuthority | null>(null);
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    void authorityOf(wallet.address).then(setAuthority);
  }, [authorityOf, wallet.address]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase("preparing");
    setError(null);
    setChecks([]);
    tx.reset();
    (async () => {
      const { publication: pub } = await api<{ publication: Publication }>(
        `/v1/drafts/${draft.id}/prepare`,
        { method: "POST" },
      );
      // Independent recomputation in this browser.
      const content = canonicalizeContent(authoringInput(draft.source, draft.changeSummary));
      const local = await preparePublication({
        rpc: rpcFor(network),
        programAddress: address(network.programId),
        organization: address(doc.organization.address),
        document: address(doc.document.address),
        title: draft.title,
        versionLabel: draft.versionLabel,
        effectiveAt: draft.effectiveAt ?? 0,
        content,
      });
      const results: Check[] = [
        {
          label: "Canonical content",
          ok:
            fromUtf8(local.contentBytes) === pub.canonicalContent &&
            toHex(local.contentHash) === pub.contentHash,
          detail: `Your draft canonicalizes to the same ${local.contentBytes.length.toLocaleString()} bytes (SHA-256 ${toHex(local.contentHash).slice(0, 16)}…).`,
        },
        {
          label: "Version chain",
          ok:
            local.versionNumber === pub.versionNumber &&
            toHex(local.previousVersionHash) === pub.previousVersionHash,
          detail: `This will be version #${local.versionNumber}, linked to the current head read from Solana.`,
        },
        {
          label: "Fingerprint",
          ok:
            toHex(local.versionHash) === pub.versionHash &&
            local.chainId === pub.chainId &&
            pub.programId === network.programId,
          detail: `Recomputed from chain state and the draft: ${toHex(local.versionHash).slice(0, 16)}…`,
        },
        {
          label: "Storage address",
          ok: local.storageUri === pub.storageUri && local.versionAccount === pub.versionAccount,
          detail: `Content-addressed URI ${local.storageUri.slice(0, 26)}… and version account ${local.versionAccount.slice(0, 8)}…`,
        },
      ];
      if (cancelled) return;
      setPublication(pub);
      setChecks(results);
      setPhase(results.every((c) => c.ok) ? "review" : "blocked");
    })().catch((e: unknown) => {
      if (!cancelled) {
        setError(errorMessage(e));
        setPhase("error");
      }
    });
    return () => {
      cancelled = true;
    };
    // Prepare once per opening of the dialog for this draft (not on every re-render).
  }, [open, draft.id]);

  async function publish() {
    if (!publication || !authority) return;
    await tx.run(
      async (signer) => {
        const program = address(network.programId);
        const [config] = await findConfigPda(program);
        return [
          publishVersionInstruction({
            programAddress: program,
            authority: signer,
            membership: authority.membership,
            config,
            organization: address(publication.organization),
            document: address(publication.document),
            versionAccount: address(publication.versionAccount),
            payer: signer,
            version: publication.versionNumber,
            previousVersionHash: fromHex(publication.previousVersionHash, 32),
            contentHash: fromHex(publication.contentHash, 32),
            title: publication.title,
            versionLabel: publication.versionLabel,
            effectiveAt: publication.effectiveAt,
            storageUri: publication.storageUri,
            expectedVersionHash: fromHex(publication.versionHash, 32),
          }),
        ];
      },
      async (signature) => {
        await api("/v1/publications/confirm", { body: { signature } });
        onPublished();
      },
    );
  }

  const canSign = Boolean(authority?.canPublish);

  return (
    <Dialog
      open={open}
      onClose={() => !tx.pending && onClose()}
      wide
      title={`Publish version ${draft.versionLabel}`}
      description="Review the exact fingerprint before your wallet signs. Published versions can never be edited or deleted."
      footer={
        tx.status === "done" ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={tx.pending}>
              Cancel
            </Button>
            <Button
              onClick={() => void publish()}
              disabled={phase !== "review" || !canSign}
              loading={tx.pending}
            >
              Sign &amp; publish
            </Button>
          </>
        )
      }
    >
      {phase === "preparing" && (
        <p className="flex items-center gap-2 text-[13.5px] text-fg-muted">
          <Spinner className="h-4 w-4 text-accent" /> Preparing and independently recomputing the
          publication…
        </p>
      )}
      {phase === "error" && (
        <Alert tone="danger" title="Could not prepare the publication">
          {error}
        </Alert>
      )}
      {checks.length > 0 && (
        <ul className="mb-5 space-y-2">
          {checks.map((c) => (
            <li key={c.label} className="flex gap-2 text-[13px]">
              {c.ok ? (
                <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-verified" />
              ) : (
                <span className="mt-0.5 h-4 w-4 shrink-0 text-center font-bold text-danger">!</span>
              )}
              <span className="text-fg-muted">
                <span className="text-fg">{c.label}.</span>{" "}
                {c.ok
                  ? c.detail
                  : "The server's preparation does not match this browser's computation."}
              </span>
            </li>
          ))}
        </ul>
      )}
      {phase === "blocked" && (
        <Alert tone="danger" title="Publication blocked">
          The publication prepared by the server differs from what this browser computed from your
          draft and the chain. Nothing was signed. Reload and try again; if it persists, treat the
          server as compromised.
        </Alert>
      )}
      {publication && phase === "review" && (
        <div className="space-y-5">
          <div className="rounded-xl border border-accent-line bg-accent-soft px-4 py-3">
            <p className="text-[12px] font-medium text-fg-muted">
              Fingerprint you are about to sign
            </p>
            <p className="mt-1 font-mono text-[13px] leading-relaxed break-all text-fg">
              {groupedFingerprint(publication.versionHash)}
            </p>
          </div>
          <KeyValue
            items={[
              {
                label: "Document",
                value: `${doc.document.slug} · ${doc.document.documentType} · ${doc.document.locale}`,
              },
              {
                label: "Version",
                value: `${publication.versionLabel} (#${publication.versionNumber})`,
              },
              { label: "Title", value: publication.title },
              {
                label: "Effective",
                value:
                  publication.effectiveAt === 0
                    ? "Upon publication"
                    : formatDateTime(publication.effectiveAt),
              },
              {
                label: "Content SHA-256",
                value: (
                  <span className="font-mono text-[12px] break-all">{publication.contentHash}</span>
                ),
              },
              {
                label: "Storage",
                value: (
                  <span className="font-mono text-[12px] break-all">{publication.storageUri}</span>
                ),
              },
              { label: "Network", value: `${network.label} (${publication.chainId})` },
            ]}
          />
          <div>
            <button
              type="button"
              className="text-[12.5px] text-fg-muted hover:text-fg"
              aria-expanded={showJson}
              onClick={() => setShowJson((s) => !s)}
            >
              {showJson ? "▾" : "▸"} Canonical version record (hashed into the fingerprint)
            </button>
            {showJson && (
              <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-line bg-[#060a0f] p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all text-fg">
                {publication.versionJson}
              </pre>
            )}
          </div>
          {!canSign && wallet.address && (
            <Alert tone="warning">
              The connected wallet is not the owner or a publisher of this organization, so the
              program would reject it.
            </Alert>
          )}
          <SigningAs need="publish rights" />
        </div>
      )}
      {tx.status !== "idle" && (
        <div className="mt-5">
          <Steps
            steps={[
              {
                label: "Sign in your wallet",
                state:
                  tx.status === "signing" ? "active" : tx.status === "error" ? "error" : "done",
              },
              {
                label: "Confirm on Solana and mirror",
                state:
                  tx.status === "confirming" ? "active" : tx.status === "done" ? "done" : "pending",
              },
            ]}
          />
          {tx.status === "error" && (
            <Alert tone="danger" className="mt-4">
              {tx.error}
            </Alert>
          )}
          {tx.status === "done" && (
            <Alert
              tone="success"
              title={`Version ${draft.versionLabel} is published`}
              className="mt-4"
            >
              It is now the document&apos;s current version.{" "}
              <TxLink signature={tx.signature} label="View transaction" />
            </Alert>
          )}
        </div>
      )}
    </Dialog>
  );
}
