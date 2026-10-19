"use client";
/**
 * Stele's own legal documents, as published with Stele: the text is loaded and verified against
 * Solana in the browser (content hash, fingerprint, current version), exactly as any organization's
 * document is before someone accepts it. Before Stele publishes them on a deployment, the page shows
 * the repository text (`fallback`) marked as not yet published.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Content } from "@stelehq/protocol";
import { SteleClient, loadVerifiedDocument, type VerifiedDocument } from "@stelehq/sdk";
import { Alert, CheckIcon, ExternalIcon, Fingerprint, Skeleton, Spinner } from "@stele/ui";
import { ContentView } from "@/components/content-view";
import { errorMessage } from "@/lib/api";
import { txExplorerUrl } from "@/lib/chain";
import { PINNED_CHAIN_ID, PINNED_PROGRAM_ID, PINNED_RPC_URLS } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { loadPlatform } from "@/lib/platform";

export type LegalState =
  | { kind: "loading" }
  | { kind: "unpublished" }
  | { kind: "ready"; doc: VerifiedDocument }
  | { kind: "error"; message: string };

/** Loads one of Stele's documents ("terms-of-service" or "privacy-policy"), verified. */
export function useStelePlatformDocument(slug: string): LegalState {
  const client = useMemo(() => new SteleClient({ apiBaseUrl: "/api" }), []);
  const [state, setState] = useState<LegalState>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    void (async () => {
      const platform = await loadPlatform();
      const entry = slug === "privacy-policy" ? platform.privacy : platform.terms;
      if (!platform.organization || !entry?.version) {
        if (live) setState({ kind: "unpublished" });
        return;
      }
      try {
        const doc = await loadVerifiedDocument({
          client,
          organization: platform.organization,
          document: slug,
          rpcUrls: PINNED_RPC_URLS.length > 0 ? PINNED_RPC_URLS : undefined,
          expected: { programId: PINNED_PROGRAM_ID, chainId: PINNED_CHAIN_ID },
          loadPrevious: true,
        });
        if (live) setState({ kind: "ready", doc });
      } catch (e) {
        if (live) setState({ kind: "error", message: errorMessage(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [client, slug]);
  return state;
}

/** What the reader can check: version, publication time and transaction, fingerprint. */
export function LegalEvidence({ doc }: { doc: VerifiedDocument }) {
  const published = doc.api.versions.find((v) => v.address === doc.versionAddress);
  return (
    <div className="rounded-xl border border-verified-line bg-verified-soft/40 px-4 py-3 text-[13px] text-fg-muted">
      <p className="flex items-center gap-2 font-medium text-fg">
        <CheckIcon className="h-4 w-4 text-verified" />
        Published with Stele and verified against Solana in your browser
      </p>
      <p className="mt-1.5 leading-relaxed">
        Version {published?.label ?? doc.version.versionLabel} (#{doc.version.version})
        {published?.publishedAt && <> · published {formatDateTime(published.publishedAt)}</>} ·
        fingerprint <Fingerprint value={doc.fingerprint} />
        {published?.publishTransaction && (
          <>
            {" "}
            ·{" "}
            <a
              href={txExplorerUrl(doc.network, published.publishTransaction)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              publication transaction <ExternalIcon className="h-3 w-3" />
            </a>
          </>
        )}
        {doc.api.versions.length > 1 && <> · {doc.api.versions.length} versions published</>}
      </p>
    </div>
  );
}

/** The whole document: evidence, then the verified text (or the unpublished draft). */
/** The published version as the server read it, rendered before the browser has verified it. */
export interface PublishedLegal {
  content: Content;
  label: string;
  number: number;
}

export function LegalDocument({
  slug,
  published,
  fallback,
}: {
  slug: string;
  published: PublishedLegal | null;
  fallback: ReactNode;
}) {
  const state = useStelePlatformDocument(slug);
  if (state.kind === "loading")
    return published ? (
      // The text is in the page from the first byte (search engines, no-JS readers); the
      // verification against Solana replaces this note when it completes.
      <div className="space-y-8">
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-[13px] text-fg-muted">
          <Spinner className="h-4 w-4" />
          Version {published.label} (#{published.number}) — verifying against Solana in your
          browser…
        </div>
        <ContentView content={published.content} />
      </div>
    ) : (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (state.kind === "ready")
    return (
      <div className="space-y-8">
        <LegalEvidence doc={state.doc} />
        <ContentView content={state.doc.content} />
      </div>
    );
  return (
    <div className="space-y-8">
      {state.kind === "error" ? (
        <Alert tone="danger">The published version could not be verified: {state.message}</Alert>
      ) : (
        <Alert tone="info">
          Not yet published with Stele on this network. This is the current text.
        </Alert>
      )}
      {state.kind === "error" && published ? <ContentView content={published.content} /> : fallback}
    </div>
  );
}
