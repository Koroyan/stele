"use client";
/** Creates a document account on-chain (slug, type and locale are permanent), then mirrors it. */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { address } from "@solana/kit";
import {
  createDocumentInstruction,
  DOCUMENT_TYPE_LABELS,
  fetchAccountData,
  DOCUMENT_TYPES,
  findConfigPda,
  findDocumentPda,
  validateLocale,
  validateSlug,
  validationError,
  type DocumentType,
} from "@stelehq/protocol";
import { Button, Field, Input, Select } from "@stele/ui";
import {
  PageHeader,
  Panel,
  RoleNotice,
  SigningAs,
  TxStatus,
  useTransaction,
} from "@/components/dashboard/ui";
import { api } from "@/lib/api";
import { rpcFor } from "@/lib/chain";
import { useDashboard, type WalletAuthority } from "@/lib/dashboard";
import { useNetwork, useWallet } from "@/lib/wallet";

export default function NewDocumentPage() {
  const router = useRouter();
  const network = useNetwork();
  const wallet = useWallet();
  const { detail, authorityOf } = useDashboard();
  const tx = useTransaction();
  const [type, setType] = useState<DocumentType>("terms-of-service");
  const [slug, setSlug] = useState("terms-of-service");
  const [slugTouched, setSlugTouched] = useState(false);
  const [locale, setLocale] = useState("en");
  const [authority, setAuthority] = useState<WalletAuthority | null>(null);
  const [pda, setPda] = useState<string | null>(null);

  useEffect(() => {
    void authorityOf(wallet.address).then(setAuthority);
  }, [authorityOf, wallet.address]);

  const slugError = slug ? validationError(validateSlug, slug) : "Required";
  const localeError = validationError(validateLocale, locale);
  const [taken, setTaken] = useState(false);

  useEffect(() => {
    if (!detail || slugError) {
      setPda(null);
      setTaken(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [p] = await findDocumentPda(
        address(detail.organization.address),
        slug,
        address(network.programId),
      );
      const existing = await fetchAccountData(rpcFor(network), p).catch(() => null);
      if (cancelled) return;
      // A suggested slug that is already used moves on to the next free one (-2, -3, …)
      // instead of greeting the user with an error.
      if (existing !== null && !slugTouched) {
        const m = /^(.*)-(\d+)$/.exec(slug);
        setSlug(m ? `${m[1]}-${Number(m[2]) + 1}` : `${slug}-2`);
        return;
      }
      setPda(p);
      setTaken(existing !== null);
    })();
    return () => {
      cancelled = true;
    };
  }, [detail, slug, slugError, slugTouched, network]);

  if (!detail) return null;
  const canCreate = Boolean(authority?.canCreateDocument);

  async function create() {
    if (!detail || !authority) return;
    await tx.run(
      async (signer) => {
        const program = address(network.programId);
        const organization = address(detail.organization.address);
        const [config] = await findConfigPda(program);
        const [document] = await findDocumentPda(organization, slug, program);
        return [
          createDocumentInstruction({
            programAddress: program,
            authority: signer,
            membership: authority.membership,
            config,
            organization,
            document,
            payer: signer,
            slug,
            documentType: type,
            locale,
          }),
        ];
      },
      async () => {
        const [document] = await findDocumentPda(
          address(detail.organization.address),
          slug,
          address(network.programId),
        );
        const { document: row } = await api<{ document: { id: string } }>(
          `/v1/organizations/${detail.organization.id}/documents/sync`,
          { body: { address: document } },
        );
        router.push(`/dashboard/documents/${row.id}?draft=new`);
      },
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="New document"
        description="A document is a permanent, named slot for your agreement. You publish its versions separately — each one immutable."
      />
      <Panel
        title="Document details"
        description="These values are written on-chain and cannot be changed later."
      >
        <RoleNotice allowed={canCreate || !wallet.address}>
          The connected wallet is not the owner, an admin or a publisher of{" "}
          {detail.organization.name}. Connect an authorized wallet.
        </RoleNotice>
        <form
          className="grid max-w-2xl gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!slugError && !localeError && canCreate && !taken) void create();
          }}
        >
          <Field label="Document type" htmlFor="type">
            <Select
              id="type"
              value={type}
              onChange={(e) => {
                const t = e.target.value as DocumentType;
                setType(t);
                if (!slugTouched) setSlug(t);
              }}
            >
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOCUMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Slug"
            htmlFor="slug"
            error={
              slug && slugError
                ? slugError
                : taken
                  ? "This organization already has a document with this slug."
                  : null
            }
            hint="Lowercase letters, digits and single hyphens, up to 32 characters. Appears in acceptance links."
          >
            <Input
              id="slug"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.trim().toLowerCase());
              }}
              className="font-mono text-[13px]"
              spellCheck={false}
            />
          </Field>
          <Field
            label="Language"
            htmlFor="locale"
            error={localeError}
            hint="BCP 47 tag such as en, en-US, de or es-419. Publish other languages as separate documents."
          >
            <Input
              id="locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value.trim())}
              className="max-w-[200px] font-mono text-[13px]"
              spellCheck={false}
            />
          </Field>
          {pda && (
            <p className="text-[12.5px] text-fg-subtle">
              Account address: <span className="font-mono text-fg-muted">{pda}</span>
            </p>
          )}
          <SigningAs />
          <TxStatus tx={tx} />
          <div>
            <Button
              type="submit"
              disabled={Boolean(slugError) || Boolean(localeError) || !canCreate || taken}
              loading={tx.pending}
            >
              Create on Solana
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
