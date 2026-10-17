"use client";
/** Stele's own inbox: messages from the website's contact form (Stele staff only). */
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  ExternalIcon,
  InboxIcon,
  Tabs,
  Textarea,
} from "@stele/ui";
import { LoadingRows, PageHeader } from "@/components/dashboard/ui";
import { api, errorMessage } from "@/lib/api";
import { useDashboard } from "@/lib/dashboard";
import { formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";

type Status = "new" | "read" | "replied" | "archived";
interface Message {
  id: string;
  topic: string;
  name: string;
  email: string;
  company: string | null;
  website: string | null;
  message: string;
  status: Status;
  note: string | null;
  createdAt: string;
}

const TOPIC: Record<string, string> = {
  partnership: "Partnership",
  integration: "Integration help",
  enterprise: "Enterprise",
  press: "Press",
  other: "Other",
};
const TONE: Record<Status, "accent" | "neutral" | "verified" | "warning"> = {
  new: "accent",
  read: "neutral",
  replied: "verified",
  archived: "neutral",
};

function MessageCard({ m, onChange }: { m: Message; onChange: () => void }) {
  const [note, setNote] = useState(m.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const update = async (patch: { status?: Status; note?: string }) => {
    setError(null);
    try {
      await api(`/v1/admin/contact/${m.id}`, { method: "PATCH", body: patch });
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const website = m.website && /^https?:\/\//.test(m.website) ? m.website : null;
  const subject = encodeURIComponent(`Re: ${TOPIC[m.topic] ?? "Your message"} — Stele`);
  return (
    <li className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[m.status]}>{m.status}</Badge>
            <Badge tone="neutral">{TOPIC[m.topic] ?? m.topic}</Badge>
            <span className="text-[12.5px] text-fg-subtle">{formatDateTime(m.createdAt)}</span>
          </div>
          <p className="mt-2 text-[15px] font-semibold text-fg">
            {m.name}
            {m.company && <span className="font-normal text-fg-muted"> · {m.company}</span>}
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-fg-muted">
            <span className="break-all">{m.email}</span>
            {website ? (
              <a
                href={website}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                {m.website} <ExternalIcon className="h-3 w-3" />
              </a>
            ) : (
              m.website && <span>{m.website}</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <a
            href={`mailto:${m.email}?subject=${subject}`}
            onClick={() => void update({ status: "replied" })}
            className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-ink"
          >
            Reply by e-mail
          </a>
          {m.status === "new" && (
            <Button size="sm" variant="secondary" onClick={() => void update({ status: "read" })}>
              Mark read
            </Button>
          )}
          {m.status !== "archived" ? (
            <Button size="sm" variant="ghost" onClick={() => void update({ status: "archived" })}>
              Archive
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => void update({ status: "read" })}>
              Restore
            </Button>
          )}
        </div>
      </div>
      <p className="mt-4 whitespace-pre-wrap break-words rounded-xl bg-surface-2 px-4 py-3 text-[14px] leading-relaxed text-fg">
        {m.message}
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Textarea
          aria-label="Internal note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Internal note (never sent)"
          className="min-w-0 flex-1 text-[13px]"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={note === (m.note ?? "")}
          onClick={() => void update({ note })}
        >
          Save note
        </Button>
      </div>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
    </li>
  );
}

export default function InboxPage() {
  const { platformAdmin } = useDashboard();
  const [filter, setFilter] = useState<Status | "all">("new");
  const inbox = useApi<{ requests: Message[]; counts: Record<string, number> }>(
    platformAdmin ? `/v1/admin/contact${filter === "all" ? "" : `?status=${filter}`}` : null,
  );
  const counts = inbox.data?.counts ?? {};
  const label = (s: Status, text: string) => (counts[s] ? `${text} (${counts[s]})` : text);

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Messages sent with the contact form on the website. Only Stele's team sees this page."
      />
      {!platformAdmin ? (
        <Alert tone="info" className="mt-6">
          This page is for Stele&apos;s team.
        </Alert>
      ) : (
        <>
          <Tabs
            className="mt-6"
            value={filter}
            onChange={setFilter}
            items={[
              { value: "new", label: label("new", "New") },
              { value: "read", label: label("read", "Read") },
              { value: "replied", label: label("replied", "Replied") },
              { value: "archived", label: label("archived", "Archived") },
              { value: "all", label: "All" },
            ]}
          />
          {inbox.error && (
            <Alert tone="danger" className="mt-6">
              {inbox.error.message}
            </Alert>
          )}
          {inbox.loading && !inbox.data ? (
            <div className="mt-6">
              <LoadingRows />
            </div>
          ) : inbox.data?.requests.length ? (
            <ul className="mt-6 space-y-4">
              {inbox.data.requests.map((m) => (
                <MessageCard key={`${m.id}-${m.status}-${m.note}`} m={m} onChange={inbox.reload} />
              ))}
            </ul>
          ) : (
            <div className="mt-6 rounded-2xl border border-line">
              <EmptyState
                icon={<InboxIcon className="h-5 w-5" />}
                title="Nothing here"
                description="Messages from the contact form appear here."
              />
            </div>
          )}
        </>
      )}
    </>
  );
}
