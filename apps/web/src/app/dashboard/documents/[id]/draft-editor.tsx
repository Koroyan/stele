"use client";
/**
 * Draft editor with a live canonical preview. Drafts are working copies stored by the API and are
 * NOT evidence; what gets hashed is exactly the canonical form shown in the preview.
 */
import { useDeferredValue, useMemo, useState } from "react";
import {
  authoringInput,
  blocksToAuthoringText,
  canonicalizeContent,
  contentHash,
  contentWordCount,
  normalizeDisplayString,
  serializeContent,
  toHex,
  utf8Length,
  validateTitle,
  validateVersionLabel,
  validationError,
} from "@stelehq/protocol";
import { Alert, Button, Card, Field, Fingerprint, Input, Textarea } from "@stele/ui";
import { ContentView } from "@/components/content-view";
import { api, errorMessage } from "@/lib/api";
import { loadVerifiedContent } from "@/lib/content";
import { formatBytes, formatNumber } from "@/lib/format";
import type { DocDetail, DraftRow } from "./types";

export function toUtcInput(seconds: number | null): string {
  if (!seconds) return "";
  return new Date(seconds * 1000).toISOString().slice(0, 16);
}

export function fromUtcInput(value: string): number | null {
  if (!value) return null;
  const ms = Date.parse(`${value}:00Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

function suggestLabel(previous: string | undefined): string {
  if (!previous) return "1.0";
  const m = /^(\d+)(?:\.(\d+))?$/.exec(previous);
  return m ? `${Number(m[1]) + 1}.0` : "";
}

export function DraftEditor({
  doc,
  draft,
  onSaved,
  onCancel,
}: {
  doc: DocDetail;
  draft: DraftRow | null;
  onSaved: (d: DraftRow) => void;
  onCancel: () => void;
}) {
  const current = doc.versions[0];
  const [title, setTitle] = useState(draft?.title ?? current?.title ?? "");
  const [label, setLabel] = useState(draft?.versionLabel ?? suggestLabel(current?.versionLabel));
  const [effective, setEffective] = useState(toUtcInput(draft?.effectiveAt ?? null));
  const [summary, setSummary] = useState(draft?.changeSummary ?? "");
  const [source, setSource] = useState(draft?.source ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefilling, setPrefilling] = useState(false);

  const deferredSource = useDeferredValue(source);
  const deferredSummary = useDeferredValue(summary);
  const preview = useMemo(() => {
    if (!deferredSource.trim()) return null;
    try {
      const content = canonicalizeContent(authoringInput(deferredSource, deferredSummary));
      const bytes = serializeContent(content);
      return {
        content,
        size: bytes.length,
        hash: toHex(contentHash(bytes)),
        words: contentWordCount(content),
        error: null as string | null,
      };
    } catch (e) {
      return { content: null, size: 0, hash: null, words: 0, error: errorMessage(e) };
    }
  }, [deferredSource, deferredSummary]);

  const normalizedTitle = normalizeDisplayString(title);
  const titleError = title ? validationError(validateTitle, normalizedTitle) : "Required";
  const labelError = label ? validationError(validateVersionLabel, label) : "Required";
  const effectiveAt = fromUtcInput(effective);
  const effectiveError =
    effective && (effectiveAt === null || effectiveAt < Date.now() / 1000 + 15 * 60)
      ? "Must be at least 15 minutes in the future (UTC), or empty."
      : null;
  const valid = !titleError && !labelError && !effectiveError && preview !== null && !preview.error;

  async function prefill() {
    if (!current) return;
    setPrefilling(true);
    try {
      const content = await loadVerifiedContent(current.contentHash);
      setSource(blocksToAuthoringText(content.blocks));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPrefilling(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    const body = {
      title: normalizedTitle,
      versionLabel: label,
      effectiveAt,
      source,
      changeSummary: summary.trim() ? summary : null,
    };
    try {
      const res = draft
        ? await api<{ draft: DraftRow }>(`/v1/drafts/${draft.id}`, { method: "PATCH", body })
        : await api<{ draft: DraftRow }>(`/v1/documents/${doc.document.id}/drafts`, { body });
      onSaved(res.draft);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[15px] font-semibold text-fg">
            {draft ? "Edit draft" : "New version draft"}
          </p>
          {current && !draft && (
            <Button size="sm" variant="ghost" onClick={() => void prefill()} loading={prefilling}>
              Start from version {current.versionLabel}
            </Button>
          )}
        </div>
        <form
          className="mt-5 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) void save();
          }}
        >
          <Field
            label="Title"
            htmlFor="title"
            error={title ? titleError : null}
            hint={`Shown in every signature request. ${utf8Length(normalizedTitle)}/60 bytes.`}
          >
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Acme Terms of Service"
            />
          </Field>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field
              label="Version label"
              htmlFor="label"
              error={label ? labelError : null}
              hint="For example 2.0 or 2026-10."
            >
              <Input
                id="label"
                value={label}
                onChange={(e) => setLabel(e.target.value.trim())}
                className="font-mono text-[13px]"
              />
            </Field>
            <Field
              label="Effective date (UTC, optional)"
              htmlFor="effective"
              error={effectiveError}
              hint="Empty = effective upon publication. Enforced against Solana cluster time."
            >
              <Input
                id="effective"
                type="datetime-local"
                value={effective}
                onChange={(e) => setEffective(e.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Summary of changes (optional, part of the signed content)"
            htmlFor="summary"
          >
            <Textarea
              id="summary"
              rows={2}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What changed and why, in plain language."
            />
          </Field>
          <Field
            label="Document text"
            htmlFor="source"
            hint={
              <>
                Plain text. <span className="font-mono">#</span>,{" "}
                <span className="font-mono">##</span>, <span className="font-mono">###</span> start
                headings; <span className="font-mono">-</span> or{" "}
                <span className="font-mono">1.</span> start list items; blank lines separate
                paragraphs. No HTML.
              </>
            }
          >
            <Textarea
              id="source"
              rows={18}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="font-mono text-[12.5px] leading-relaxed"
              spellCheck
            />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={!valid} loading={saving}>
              {draft ? "Save draft" : "Create draft"}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>

      <Card className="flex max-h-[calc(100dvh-8rem)] flex-col xl:sticky xl:top-24">
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <p className="text-[15px] font-semibold text-fg">Canonical preview</p>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">
            Exactly what will be hashed and shown to users — computed in your browser.
          </p>
          {preview?.hash && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-fg-subtle">
              <span className="inline-flex items-center gap-1">
                SHA-256 <Fingerprint value={preview.hash} />
              </span>
              <span>{formatBytes(preview.size)}</span>
              <span>{formatNumber(preview.words)} words</span>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {!preview ? (
            <p className="text-[13px] text-fg-subtle">Start typing to see the canonical form.</p>
          ) : preview.error ? (
            <Alert tone="danger" title="This text cannot be published as-is">
              {preview.error}
            </Alert>
          ) : (
            <ContentView content={preview.content!} />
          )}
        </div>
      </Card>
    </div>
  );
}
