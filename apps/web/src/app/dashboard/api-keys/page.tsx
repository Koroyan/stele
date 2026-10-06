"use client";
/** API keys: scoped, shown once, stored only as hashes, revocable. Creating one needs a fresh signature. */
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
  KeyIcon,
  Select,
} from "@stele/ui";
import { LoadingRows, PageHeader, Panel, RoleNotice, Table, Td } from "@/components/dashboard/ui";
import { api, errorMessage } from "@/lib/api";
import { useDashboard } from "@/lib/dashboard";
import { formatDate, relativeTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

const SCOPES = [
  {
    id: "acceptances:read",
    label: "Read acceptances",
    help: "Search acceptances and check whether a user accepted the current version.",
  },
  {
    id: "acceptances:write",
    label: "Create acceptance sessions",
    help: "Issue short-lived session tokens that bind acceptances to your user IDs.",
  },
  {
    id: "documents:read",
    label: "Read documents",
    help: "Look up the current version of a document.",
  },
] as const;

export default function ApiKeysPage() {
  const { org, detail, withStepUp } = useDashboard();
  const isAdmin = detail?.role === "owner" || detail?.role === "admin";
  const keys = useApi<{ apiKeys: ApiKeyRow[] }>(
    org && isAdmin ? `/v1/organizations/${org.id}/api-keys` : null,
  );
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([
    "acceptances:read",
    "acceptances:write",
    "documents:read",
  ]);
  const [expires, setExpires] = useState("365");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);

  if (!detail) return null;

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const res = await withStepUp(() =>
        api<{ key: string; apiKey: ApiKeyRow }>(`/v1/organizations/${org!.id}/api-keys`, {
          body: {
            name: name.trim(),
            scopes,
            ...(expires !== "never" ? { expiresInDays: Number(expires) } : {}),
          },
        }),
      );
      setCreated({ key: res.key, name: res.apiKey.name });
      setName("");
      keys.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(k: ApiKeyRow) {
    setError(null);
    try {
      await api(`/v1/organizations/${org!.id}/api-keys/${k.id}`, { method: "DELETE" });
      keys.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const rows = keys.data?.apiKeys ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="API keys"
        description="Server-to-server credentials for your backend. They can read data and issue acceptance sessions, but can never sign or publish on-chain. Never expose them in browsers."
      />
      <RoleNotice allowed={isAdmin}>
        Only the owner or an admin can view and manage API keys.
      </RoleNotice>
      {error && <Alert tone="danger">{error}</Alert>}

      {isAdmin && (
        <Panel
          title="Create a key"
          description="You will be asked to sign with your wallet if you haven't recently."
        >
          <form
            className="max-w-2xl space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && scopes.length) void create();
            }}
          >
            <Field
              label="Name"
              htmlFor="key-name"
              hint="Where the key is used, for example “production backend”."
            >
              <Input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
            </Field>
            <fieldset>
              <legend className="text-[13px] font-medium text-fg">Scopes</legend>
              <div className="mt-2 space-y-2.5">
                {SCOPES.map((s) => (
                  <label key={s.id} className="flex items-start gap-3 text-[13.5px]">
                    <input
                      type="checkbox"
                      checked={scopes.includes(s.id)}
                      onChange={(e) =>
                        setScopes((cur) =>
                          e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id),
                        )
                      }
                      className="mt-1 accent-[var(--color-accent)]"
                    />
                    <span>
                      <span className="text-fg">{s.label}</span>{" "}
                      <span className="font-mono text-[11.5px] text-fg-subtle">{s.id}</span>
                      <span className="block text-[12px] text-fg-subtle">{s.help}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Expires" htmlFor="key-exp">
              <Select
                id="key-exp"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
                className="max-w-[220px]"
              >
                <option value="30">In 30 days</option>
                <option value="90">In 90 days</option>
                <option value="365">In 1 year</option>
                <option value="730">In 2 years</option>
                <option value="never">Never</option>
              </Select>
            </Field>
            <Button
              type="submit"
              size="sm"
              loading={creating}
              disabled={!name.trim() || scopes.length === 0}
            >
              Create key
            </Button>
          </form>
        </Panel>
      )}

      {isAdmin && (
        <Panel title="Keys" bodyClassName="p-0 sm:p-0">
          {keys.loading && !keys.data ? (
            <LoadingRows />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<KeyIcon className="h-5 w-5" />}
              title="No API keys"
              description="Create a key for your backend to issue acceptance sessions and query acceptances."
            />
          ) : (
            <Table head={["Name", "Key", "Scopes", "Last used", "Expires", ""]}>
              {rows.map((k) => (
                <tr key={k.id}>
                  <Td>
                    <span className="text-fg">{k.name}</span>
                    <p className="text-[12px] text-fg-subtle">Created {formatDate(k.createdAt)}</p>
                  </Td>
                  <Td mono>{k.prefix}_••••</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s}>{s}</Badge>
                      ))}
                    </div>
                  </Td>
                  <Td>{k.lastUsedAt ? relativeTime(k.lastUsedAt) : "Never"}</Td>
                  <Td>
                    {k.revokedAt ? (
                      <Badge tone="danger">Revoked</Badge>
                    ) : k.expiresAt ? (
                      formatDate(k.expiresAt)
                    ) : (
                      "Never"
                    )}
                  </Td>
                  <Td className="text-right">
                    {!k.revokedAt && (
                      <button
                        type="button"
                        className="text-[12.5px] text-fg-muted hover:text-danger"
                        onClick={() => void revoke(k)}
                      >
                        Revoke
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      )}

      <Dialog
        open={created !== null}
        onClose={() => setCreated(null)}
        title={`API key “${created?.name ?? ""}” created`}
        description="Copy it now. It is shown only once — Stele stores only its hash."
        footer={<Button onClick={() => setCreated(null)}>I have stored it safely</Button>}
      >
        {created && (
          <div className="space-y-4">
            <CodeBlock code={created.key} />
            <p className="text-[12.5px] leading-relaxed text-fg-muted">
              Keep it in your server&apos;s secret manager. If it leaks, revoke it here — revocation
              is immediate. Ready for your server&apos;s environment:
            </p>
            <CodeBlock
              language="env"
              code={`STELE_API_URL=${typeof window === "undefined" ? "" : window.location.origin}/api
STELE_API_KEY=${created.key}`}
            />
            <p className="text-[12.5px] leading-relaxed text-fg-muted">
              Never put it in browser or frontend code.
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
