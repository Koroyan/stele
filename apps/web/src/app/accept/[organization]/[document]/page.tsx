import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FocusShell } from "@/components/focus-shell";
import { NetworkBoundary } from "@/components/network-boundary";
import { WalletButton } from "@/components/wallet";
import { getPublic } from "@/lib/server";
import { AcceptClient } from "./accept-client";

type Params = { organization: string; document: string };

const ORG_REF = /^([a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { organization, document } = await params;
  const data = await getPublic<{ organization: { name: string }; versions: { title: string }[] }>(
    `/v1/public/organizations/${encodeURIComponent(organization)}/documents/${encodeURIComponent(document)}`,
  );
  const title = data?.versions.at(-1)?.title;
  return {
    title: title ? `Review ${title}` : "Review agreement",
    robots: { index: false, follow: false },
  };
}

export default async function AcceptPage({ params }: { params: Promise<Params> }) {
  const { organization, document } = await params;
  // Domains are case-insensitive; base58 organization addresses are not.
  const raw = decodeURIComponent(organization);
  const org = raw.includes(".") ? raw.toLowerCase() : raw;
  if (!ORG_REF.test(org) || !SLUG.test(document) || document.length > 32) notFound();
  return (
    <NetworkBoundary>
      <FocusShell aside={<WalletButton />}>
        <AcceptClient organization={org} document={document} />
      </FocusShell>
    </NetworkBoundary>
  );
}
