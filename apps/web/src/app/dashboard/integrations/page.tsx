"use client";
/** Webhooks (signed, retried, pointing to on-chain proof) and integration snippets. */
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  CodeBlock,
  Dialog,
  EmptyState,
  Field,
  Input,
  PlugIcon,
} from "@stele/ui";
import { LoadingRows, PageHeader, Panel, RoleNotice, Table, Td } from "@/components/dashboard/ui";
import { api, errorMessage } from "@/lib/api";
import { useDashboard } from "@/lib/dashboard";
import { formatDateTime, relativeTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface WebhookRow {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  status: "active" | "disabled";
  consecutiveFailures: number;
  createdAt: string;
}

interface DeliveryRow {
  id: string;
  eventId: string;
  eventType: string;
  status: "pending" | "delivered" | "failed" | "dead";
  attempts: number;
  lastResponseStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

function Deliveries({ orgId, webhookId }: { orgId: string; webhookId: string }) {
  const q = useApi<{ deliveries: DeliveryRow[] }>(
    `/v1/organizations/${orgId}/webhooks/${webhookId}/deliveries`,
  );
  if (!q.data) return <LoadingRows />;
  if (q.data.deliveries.length === 0)
    return <p className="px-6 py-4 text-[12.5px] text-fg-subtle">No deliveries yet.</p>;
  return (
    <Table head={["Event", "Status", "Attempts", "Response", "Created"]}>
      {q.data.deliveries.map((d) => (
        <tr key={d.id}>
          <Td>
            <span className="font-mono text-[12px] text-fg">{d.eventType}</span>
            <p className="font-mono text-[11px] text-fg-subtle">{d.eventId}</p>
          </Td>
          <Td>
            <Badge
              tone={
                d.status === "delivered"
                  ? "accent"
                  : d.status === "dead"
                    ? "danger"
                    : d.status === "failed"
                      ? "warning"
                      : "neutral"
              }
            >
              {d.status}
            </Badge>
          </Td>
          <Td>{d.attempts}</Td>
          <Td className="max-w-[260px] truncate" mono>
            {d.lastResponseStatus ?? d.lastError ?? "—"}
          </Td>
          <Td className="whitespace-nowrap">{relativeTime(d.createdAt)}</Td>
        </tr>
      ))}
    </Table>
  );
}

export default function IntegrationsPage() {
  const { org, detail, withStepUp } = useDashboard();
  const isAdmin = detail?.role === "owner" || detail?.role === "admin";
  const hooks = useApi<{ webhooks: WebhookRow[]; events: string[] }>(
    org && isAdmin ? `/v1/organizations/${org.id}/webhooks` : null,
  );
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<string[]>(["agreement.accepted"]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  if (!detail || !org) return null;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  async function act<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(key);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    const res = await act("create", () =>
      withStepUp(() =>
        api<{ secret: string }>(`/v1/organizations/${org!.id}/webhooks`, {
          body: { url: url.trim(), description: description.trim() || undefined, events },
        }),
      ),
    );
    if (res) {
      setSecret({ title: "Webhook created", value: res.secret });
      setUrl("");
      setDescription("");
      hooks.reload();
    }
  }

  const server = `import express from "express";
import { verifyWebhook } from "@stelehq/sdk/server";

const app = express();
app.post("/webhooks/stele", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = verifyWebhook(process.env.STELE_WEBHOOK_SECRET!, req.header("Stele-Signature"), req.body);
  } catch {
    return res.sendStatus(400);
  }
  // Deliveries can repeat: de-duplicate on event.id.
  if (event.type === "agreement.accepted") {
    // event.data.acceptanceId / transactionSignature → verify with @stelehq/verifier
  }
  res.sendStatus(204);
});`;

  const sessions = `import { SteleServerClient } from "@stelehq/sdk/server";

const stele = new SteleServerClient({ apiBaseUrl: "${origin}/api", apiKey: process.env.STELE_API_KEY! });

// Before showing the acceptance UI to a signed-in user:
const { sessionToken } = await stele.createAcceptanceSession({
  document: "terms-of-service",
  externalUserRef: user.id,   // stays off-chain
});`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Webhooks notify your systems; they never replace on-chain proof. Each payload carries the transaction signature and acceptance ID to verify."
      />
      <RoleNotice allowed={isAdmin}>Only the owner or an admin can manage webhooks.</RoleNotice>
      {error && <Alert tone="danger">{error}</Alert>}

      {isAdmin && (
        <Panel title="Webhook endpoints" bodyClassName="p-0 sm:p-0">
          {hooks.loading && !hooks.data ? (
            <LoadingRows />
          ) : (hooks.data?.webhooks.length ?? 0) === 0 ? (
            <EmptyState
              icon={<PlugIcon className="h-5 w-5" />}
              title="No webhooks"
              description="Add an HTTPS endpoint to be notified of acceptances and publications."
            />
          ) : (
            <ul className="divide-y divide-line">
              {hooks.data!.webhooks.map((w) => (
                <li key={w.id}>
                  <div className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[13px] text-fg">{w.url}</p>
                      <p className="mt-0.5 text-[12px] text-fg-subtle">
                        {w.events.join(", ")}
                        {w.description ? ` · ${w.description}` : ""} · added{" "}
                        {formatDateTime(w.createdAt)}
                      </p>
                    </div>
                    {w.status === "active" ? (
                      <Badge tone="accent">Active</Badge>
                    ) : (
                      <Badge>Disabled</Badge>
                    )}
                    {w.consecutiveFailures > 0 && (
                      <Badge tone="warning">{w.consecutiveFailures} failures</Badge>
                    )}
                    <div className="flex flex-wrap gap-3 text-[12.5px]">
                      <button
                        type="button"
                        className="text-fg-muted hover:text-fg"
                        onClick={() => setOpen(open === w.id ? null : w.id)}
                      >
                        {open === w.id ? "Hide deliveries" : "Deliveries"}
                      </button>
                      <button
                        type="button"
                        className="text-fg-muted hover:text-fg disabled:opacity-50"
                        disabled={busy !== null}
                        onClick={() =>
                          void act(`test-${w.id}`, () =>
                            api(`/v1/organizations/${org.id}/webhooks/${w.id}/test`, {
                              method: "POST",
                            }),
                          ).then(() => setOpen(w.id))
                        }
                      >
                        Send test
                      </button>
                      <button
                        type="button"
                        className="text-fg-muted hover:text-fg"
                        onClick={() =>
                          void act(`status-${w.id}`, () =>
                            api(`/v1/organizations/${org.id}/webhooks/${w.id}`, {
                              method: "PATCH",
                              body: { status: w.status === "active" ? "disabled" : "active" },
                            }),
                          ).then(() => hooks.reload())
                        }
                      >
                        {w.status === "active" ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        className="text-fg-muted hover:text-fg"
                        onClick={() =>
                          void act(`rotate-${w.id}`, () =>
                            withStepUp(() =>
                              api<{ secret: string }>(
                                `/v1/organizations/${org.id}/webhooks/${w.id}/rotate-secret`,
                                { method: "POST" },
                              ),
                            ),
                          ).then(
                            (r) => r && setSecret({ title: "Secret rotated", value: r.secret }),
                          )
                        }
                      >
                        Rotate secret
                      </button>
                      <button
                        type="button"
                        className="text-fg-muted hover:text-danger"
                        onClick={() =>
                          void act(`delete-${w.id}`, () =>
                            api(`/v1/organizations/${org.id}/webhooks/${w.id}`, {
                              method: "DELETE",
                            }),
                          ).then(() => hooks.reload())
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {open === w.id && (
                    <div className="border-t border-line bg-bg-raised">
                      <Deliveries orgId={org.id} webhookId={w.id} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {isAdmin && (
        <Panel
          title="Add an endpoint"
          description="HTTPS only; private and internal addresses are refused. Requires a fresh wallet signature."
        >
          <form
            className="max-w-2xl space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim() && events.length) void create();
            }}
          >
            <Field label="Endpoint URL" htmlFor="wh-url">
              <Input
                id="wh-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://api.acme.com/webhooks/stele"
                className="font-mono text-[13px]"
              />
            </Field>
            <Field label="Description (optional)" htmlFor="wh-desc">
              <Input
                id="wh-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
              />
            </Field>
            <fieldset>
              <legend className="text-[13px] font-medium text-fg">Events</legend>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(hooks.data?.events ?? []).map((ev) => (
                  <label
                    key={ev}
                    className="flex items-center gap-2 font-mono text-[12.5px] text-fg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={events.includes(ev)}
                      onChange={(e) =>
                        setEvents((cur) =>
                          e.target.checked ? [...cur, ev] : cur.filter((x) => x !== ev),
                        )
                      }
                      className="accent-[var(--color-accent)]"
                    />
                    {ev}
                  </label>
                ))}
              </div>
            </fieldset>
            <Button
              type="submit"
              size="sm"
              loading={busy === "create"}
              disabled={!url.trim() || events.length === 0}
            >
              Add endpoint
            </Button>
          </form>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel
          title="Verify webhook signatures"
          description="Header Stele-Signature: t=<unix>,v1=<HMAC-SHA256(secret, t.body)>. Reject stale timestamps."
        >
          <CodeBlock code={server} language="ts" />
        </Panel>
        <Panel
          title="Issue acceptance sessions"
          description="Server-side, with an API key that has the acceptances:write scope."
        >
          <CodeBlock code={sessions} language="ts" />
        </Panel>
      </div>

      <Dialog
        open={secret !== null}
        onClose={() => setSecret(null)}
        title={secret?.title ?? ""}
        description="Copy the signing secret now — it will not be shown again. Stele stores it encrypted."
        footer={<Button onClick={() => setSecret(null)}>Done</Button>}
      >
        {secret && (
          <div className="space-y-4">
            <CodeBlock code={secret.value} />
            <p className="text-[12.5px] leading-relaxed text-fg-muted">
              Ready for your server&apos;s environment:
            </p>
            <CodeBlock language="env" code={`STELE_WEBHOOK_SECRET=${secret.value}`} />
          </div>
        )}
      </Dialog>
    </div>
  );
}
