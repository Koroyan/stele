"use client";
/**
 * An interactive reference for the Stele REST API, built from the API's own OpenAPI document
 * (/api/v1/openapi.json) so it always matches the running API: groups, descriptions, auth,
 * parameters, an example body, a live "Send" and the equivalent cURL command.
 */
import { useEffect, useMemo, useState } from "react";
import { Button, CodeBlock, CopyButton, Spinner, cn } from "@stele/ui";

/* eslint-disable @typescript-eslint/no-explicit-any -- JSON Schema is open-ended */
type Schema = Record<string, any>;

interface Operation {
  id: string;
  method: string;
  path: string;
  tag: string;
  summary: string;
  description: string;
  security: string[];
  parameters: {
    name: string;
    in: string;
    required: boolean;
    schema: Schema;
    description?: string;
  }[];
  body: Schema | null;
}

interface Spec {
  tags: { name: string; description?: string }[];
  ops: Operation[];
}

const METHOD_STYLES: Record<string, string> = {
  GET: "border-verified-line bg-verified-soft text-verified",
  POST: "border-accent-line bg-accent-soft text-accent",
  PATCH: "border-warning-line bg-warning-soft text-warning",
  DELETE: "border-danger-line bg-danger-soft text-danger",
};

function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-[54px] shrink-0 justify-center rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] font-bold",
        METHOD_STYLES[method] ?? "border-line text-fg-muted",
      )}
    >
      {method}
    </span>
  );
}

function parseSpec(doc: any): Spec {
  const ops: Operation[] = [];
  for (const [path, methods] of Object.entries<any>(doc.paths ?? {})) {
    for (const [m, op] of Object.entries<any>(methods)) {
      const method = m.toUpperCase();
      if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) continue;
      ops.push({
        id: `${method} ${path}`,
        method,
        path,
        tag: op.tags?.[0] ?? "Other",
        summary: op.summary ?? path,
        description: op.description ?? "",
        security: (op.security ?? []).flatMap((s: Record<string, unknown>) => Object.keys(s)),
        parameters: (op.parameters ?? []).map((p: any) => ({
          name: p.name,
          in: p.in,
          required: Boolean(p.required),
          schema: p.schema ?? {},
          description: p.description,
        })),
        body: op.requestBody?.content?.["application/json"]?.schema ?? null,
      });
    }
  }
  const named = (doc.tags ?? []) as Spec["tags"];
  const extra = [...new Set(ops.map((o) => o.tag))]
    .filter((t) => !named.some((n) => n.name === t))
    .map((name) => ({ name }));
  return { tags: [...named, ...extra], ops };
}

/** A small example value for a JSON Schema: enough to show the shape and edit it. */
function example(schema: Schema | undefined, depth = 0): unknown {
  if (!schema || depth > 5) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum) return schema.enum[0];
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants)
    return example(variants.find((v: Schema) => v.type !== "null") ?? variants[0], depth);
  const type = Array.isArray(schema.type)
    ? schema.type.find((t: string) => t !== "null")
    : schema.type;
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      const required: string[] = schema.required ?? [];
      for (const [k, v] of Object.entries<Schema>(schema.properties ?? {})) {
        if (required.includes(k) || depth === 0) out[k] = example(v, depth + 1);
      }
      return out;
    }
    case "array":
      return [example(schema.items, depth + 1)];
    case "integer":
    case "number":
      return schema.minimum ?? 0;
    case "boolean":
      return false;
    case "string":
      return schema.format === "date-time" ? new Date(0).toISOString() : "string";
    default:
      return null;
  }
}

function authLabel(op: Operation): { text: string; tone: string } {
  if (op.security.includes("apiKey")) {
    const scope = /`([a-z]+:[a-z]+)`/.exec(op.description)?.[1];
    return { text: scope ? `API key · ${scope}` : "API key", tone: "text-warning" };
  }
  if (op.security.includes("session")) return { text: "Dashboard session", tone: "text-fg-subtle" };
  if (op.security.includes("proofToken")) return { text: "Proof token", tone: "text-accent" };
  return { text: "Public", tone: "text-verified" };
}

function curlFor(
  origin: string,
  op: Operation,
  url: string,
  body: string | null,
  apiKey: string,
  proofToken: string,
): string {
  const lines = [`curl -X ${op.method} "${origin}/api${url}"`];
  if (op.security.includes("apiKey"))
    lines.push(`  -H "Authorization: Bearer ${apiKey ? "stl_…" : "<API key>"}"`);
  if (op.security.includes("proofToken"))
    lines.push(`  -H "x-proof-token: ${proofToken ? "<token>" : "<proof token>"}"`);
  if (body) {
    lines.push(`  -H "content-type: application/json"`);
    lines.push(`  -d '${body.replace(/\s*\n\s*/g, " ")}'`);
  }
  return lines.join(" \\\n");
}

function OperationView({ origin, op }: { origin: string; op: Operation }) {
  const [params, setParams] = useState<Record<string, string>>({});
  const [body, setBody] = useState(() =>
    op.body ? JSON.stringify(example(op.body), null, 2) : "",
  );
  const [apiKey, setApiKey] = useState("");
  const [proofToken, setProofToken] = useState("");
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<{
    status: number;
    ms: number;
    text: string;
  } | null>(null);
  const auth = authLabel(op);

  useEffect(() => {
    try {
      setApiKey(sessionStorage.getItem("stele:api-key") ?? "");
    } catch {
      // storage unavailable: the key is simply not remembered
    }
  }, []);

  const url = useMemo(() => {
    let p = op.path;
    const query = new URLSearchParams();
    for (const prm of op.parameters) {
      const v = params[prm.name] ?? "";
      if (prm.in === "path")
        p = p.replace(`{${prm.name}}`, encodeURIComponent(v || `{${prm.name}}`));
      else if (prm.in === "query" && v) query.set(prm.name, v);
    }
    const q = query.toString();
    return q ? `${p}?${q}` : p;
  }, [op, params]);

  const sendable = op.parameters
    .filter((p) => p.in === "path" || p.required)
    .every((p) => (params[p.name] ?? "").trim() !== "");

  async function send() {
    setSending(true);
    setResponse(null);
    const started = performance.now();
    try {
      const headers: Record<string, string> = {};
      if (op.body) headers["content-type"] = "application/json";
      if (op.security.includes("apiKey") && apiKey) headers.authorization = `Bearer ${apiKey}`;
      if (op.security.includes("proofToken") && proofToken) headers["x-proof-token"] = proofToken;
      const res = await fetch(`/api${url}`, {
        method: op.method,
        headers,
        body: op.body ? body : undefined,
        credentials: "same-origin",
      });
      const raw = await res.text();
      let text = raw;
      try {
        text = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        // not JSON (e.g. canonical content bytes): shown as is
      }
      setResponse({ status: res.status, ms: Math.round(performance.now() - started), text });
    } catch (e) {
      setResponse({ status: 0, ms: 0, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  }

  const inputs = op.parameters.filter((p) => p.in === "path" || p.in === "query");

  return (
    <article className="min-w-0">
      <div className="flex flex-wrap items-center gap-3">
        <MethodBadge method={op.method} />
        <code className="min-w-0 break-all font-mono text-[15px] text-fg">{op.path}</code>
        <CopyButton value={`${origin}/api${op.path}`} label="Copy URL" />
      </div>
      <h2 className="mt-3 text-[22px] font-semibold tracking-[-0.02em] text-fg">{op.summary}</h2>
      <p className={cn("mt-1 text-[12.5px] font-semibold uppercase tracking-[0.08em]", auth.tone)}>
        {auth.text}
      </p>
      {op.description && (
        <div className="mt-3 max-w-3xl space-y-2 text-[14px] leading-relaxed text-fg-muted">
          {op.description.split("\n\n").map((para) => (
            <p key={para}>{para.replace(/`/g, "")}</p>
          ))}
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-line bg-surface">
        <p className="border-b border-line px-5 py-3 text-[13px] font-semibold text-fg">Try it</p>
        <div className="space-y-4 p-5">
          {op.security.includes("apiKey") && (
            <label className="block text-[13px]">
              <span className="text-fg-muted">API key (kept in this tab only)</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  try {
                    sessionStorage.setItem("stele:api-key", e.target.value);
                  } catch {
                    // not remembered
                  }
                }}
                placeholder="stl_test_…"
                className="mt-1 w-full rounded-lg border border-line-strong bg-bg px-3 py-2 font-mono text-[13px] text-fg outline-none focus:border-accent-line"
              />
            </label>
          )}
          {op.security.includes("proofToken") && (
            <label className="block text-[13px]">
              <span className="text-fg-muted">Proof token</span>
              <input
                value={proofToken}
                onChange={(e) => setProofToken(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line-strong bg-bg px-3 py-2 font-mono text-[13px] text-fg outline-none focus:border-accent-line"
              />
            </label>
          )}
          {op.security.includes("session") && (
            <p className="text-[13px] text-fg-subtle">
              Uses your dashboard session: sign in to the dashboard in this browser first. Changes
              also need the CSRF header the dashboard sends.
            </p>
          )}
          {inputs.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {inputs.map((p) => (
                <label key={`${p.in}:${p.name}`} className="block text-[13px]">
                  <span className="font-mono text-fg">{p.name}</span>
                  <span className="ml-2 text-[11.5px] text-fg-subtle">
                    {p.in}
                    {p.required || p.in === "path" ? " · required" : ""}
                    {p.schema.enum ? ` · ${p.schema.enum.join(" | ")}` : ""}
                  </span>
                  <input
                    value={params[p.name] ?? ""}
                    onChange={(e) => setParams((v) => ({ ...v, [p.name]: e.target.value }))}
                    placeholder={p.description ?? (p.schema.type as string | undefined) ?? ""}
                    className="mt-1 w-full rounded-lg border border-line-strong bg-bg px-3 py-2 font-mono text-[13px] text-fg outline-none focus:border-accent-line"
                    spellCheck={false}
                  />
                </label>
              ))}
            </div>
          )}
          {op.body && (
            <label className="block text-[13px]">
              <span className="text-fg-muted">Request body (JSON)</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={Math.min(14, body.split("\n").length + 1)}
                spellCheck={false}
                className="mt-1 w-full rounded-lg border border-line-strong bg-bg px-3 py-2 font-mono text-[12.5px] leading-relaxed text-fg outline-none focus:border-accent-line"
              />
            </label>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void send()} loading={sending} disabled={!sendable}>
              Send request
            </Button>
            {!sendable && (
              <span className="text-[12.5px] text-fg-subtle">Fill in the required fields.</span>
            )}
          </div>
          {response && (
            <div>
              <p className="flex items-center gap-3 text-[13px]">
                <span
                  className={cn(
                    "rounded-md border px-2 py-0.5 font-mono text-[12px] font-bold",
                    response.status >= 200 && response.status < 300
                      ? "border-verified-line text-verified"
                      : "border-danger-line text-danger",
                  )}
                >
                  {response.status || "network error"}
                </span>
                <span className="text-fg-subtle">{response.ms} ms</span>
              </p>
              <pre className="mt-2 max-h-[420px] overflow-auto rounded-xl border border-line bg-bg p-4 font-mono text-[12px] leading-relaxed text-fg">
                {response.text || "(empty)"}
              </pre>
            </div>
          )}
        </div>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-[13px] font-semibold text-fg">cURL</p>
        <CodeBlock
          code={curlFor(origin, op, url, op.body ? body : null, apiKey, proofToken)}
          language="bash"
        />
      </div>
    </article>
  );
}

export function ApiExplorer({ origin }: { origin: string }) {
  const [spec, setSpec] = useState<Spec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showDashboard, setShowDashboard] = useState(false);

  useEffect(() => {
    fetch("/api/v1/openapi.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((doc) => {
        const s = parseSpec(doc);
        setSpec(s);
        const fromHash = decodeURIComponent(window.location.hash.slice(1));
        setSelected(
          s.ops.some((o) => o.id === fromHash)
            ? fromHash
            : (s.ops.find((o) => o.tag === "Network")?.id ?? s.ops[0]?.id ?? null),
        );
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const select = (id: string) => {
    setSelected(id);
    history.replaceState(null, "", `#${encodeURIComponent(id)}`);
  };

  if (error)
    return (
      <p className="rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-[14px] text-danger">
        Could not load the API description: {error}
      </p>
    );
  if (!spec)
    return (
      <p className="flex items-center gap-2 text-[14px] text-fg-muted">
        <Spinner /> Loading the API description…
      </p>
    );

  const q = query.trim().toLowerCase();
  const visible = spec.ops.filter(
    (o) =>
      (showDashboard || o.tag !== "Dashboard" || o.id === selected) &&
      (!q || `${o.id} ${o.summary} ${o.tag}`.toLowerCase().includes(q)),
  );
  const op = spec.ops.find((o) => o.id === selected) ?? null;

  return (
    <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-32 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search endpoints"
          aria-label="Search endpoints"
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] text-fg outline-none focus:border-accent-line"
        />
        <nav aria-label="API endpoints" className="mt-4 space-y-5 pb-6">
          {spec.tags.map((tag) => {
            const ops = visible.filter((o) => o.tag === tag.name);
            if (ops.length === 0) return null;
            return (
              <div key={tag.name}>
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-fg-subtle">
                  {tag.name}
                </p>
                <ul className="mt-2 space-y-0.5">
                  {ops.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => select(o.id)}
                        aria-current={o.id === selected ? "true" : undefined}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
                          o.id === selected
                            ? "bg-surface-2 text-fg"
                            : "text-fg-muted hover:bg-surface hover:text-fg",
                        )}
                      >
                        <MethodBadge method={o.method} />
                        <span className="min-w-0 truncate">{o.summary}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => setShowDashboard((v) => !v)}
            className="text-[12.5px] text-fg-subtle hover:text-fg"
          >
            {showDashboard ? "Hide" : "Show"} dashboard endpoints (
            {spec.ops.filter((o) => o.tag === "Dashboard").length})
          </button>
        </nav>
      </aside>
      <div className="min-w-0">
        {op ? (
          <>
            {spec.tags.find((t) => t.name === op.tag)?.description && (
              <p className="mb-6 rounded-xl border border-line bg-bg-raised px-4 py-3 text-[13px] leading-relaxed text-fg-muted">
                <span className="font-semibold text-fg">{op.tag}.</span>{" "}
                {spec.tags.find((t) => t.name === op.tag)!.description}
              </p>
            )}
            <OperationView key={op.id} origin={origin} op={op} />
          </>
        ) : (
          <p className="text-[14px] text-fg-muted">Choose an endpoint.</p>
        )}
      </div>
    </div>
  );
}
