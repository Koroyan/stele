/**
 * The AI assistant. It answers questions about Stele from the PUBLIC documentation — passages found
 * for the question, and more found by the model itself with a `search_docs` tool, so a question in
 * any language reaches the English documentation — and, in the dashboard, from a summary of the
 * asking member's organization (never keys or secrets). Any OpenAI-compatible chat completions
 * endpoint works (OPENAI_BASE_URL). Conversations are not stored; only abuse counters are kept, in
 * memory.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  and,
  apiKeys,
  count,
  eq,
  isNull,
  nonceShards,
  organizationMembers,
  organizations,
  webhookEndpoints,
} from "@stele/db";
import type { Deps } from "../deps.js";
import { ApiError } from "../errors.js";
import { gateOverview } from "./gate.js";

export const assistantEnabled = (deps: Deps) => Boolean(deps.config.OPENAI_API_KEY);

// ---- knowledge: the public documentation, in passages ------------------------------------------------

interface KnowledgeDoc {
  slug: string;
  file: string;
  title: string;
  markdown: string;
}

export interface Passage {
  slug: string;
  title: string;
  heading: string;
  text: string;
  tf: Map<string, number>;
  length: number;
}

const CATALOG_ENTRY = /slug: "([^"]+)",\s*file: "([^"]+\.md)",\s*title: "([^"]+)"/g;

function readKnowledge(): KnowledgeDoc[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Production: bundled next to the server by scripts/build-knowledge.mjs.
  const bundled = path.join(here, "knowledge.json");
  if (existsSync(bundled)) return JSON.parse(readFileSync(bundled, "utf8")) as KnowledgeDoc[];
  // Development: the same public catalog, read from the repository.
  const repo = path.resolve(here, "../../../..");
  const catalog = readFileSync(path.join(repo, "apps/web/src/lib/docs.ts"), "utf8");
  return [...catalog.matchAll(CATALOG_ENTRY)].map((m) => ({
    slug: m[1]!,
    file: m[2]!,
    title: m[3]!,
    markdown: readFileSync(path.join(repo, m[2]!), "utf8"),
  }));
}

const STOP = new Set(
  "the a an and or of to in is it its for on with as by be are was this that these from at can you your i we our how what why when which do does did my me not no if then than so use using into about there their they will would should could".split(
    " ",
  ),
);

const stem = (t: string) =>
  t.length > 4 && t.endsWith("ies")
    ? `${t.slice(0, -3)}y`
    : t.length > 3 && t.endsWith("s") && !t.endsWith("ss")
      ? t.slice(0, -1)
      : t;

/** Lower-case words (snake_case also split into its parts), without stop words. */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.toLowerCase().split(/[^\p{L}\p{N}_]+/u)) {
    if (!raw) continue;
    for (const t of raw.includes("_") ? [raw, ...raw.split("_")] : [raw])
      if (t.length > 1 && !STOP.has(t)) out.push(stem(t));
  }
  return out;
}

const MAX_PASSAGE = 1800;

/** Splits Markdown at its headings, then long sections at paragraph boundaries. */
export function passagesOf(doc: { slug: string; title: string; markdown: string }): Passage[] {
  const out: Passage[] = [];
  let heading = doc.title;
  let buf: string[] = [];
  const flush = () => {
    let text = buf.join("\n").trim();
    buf = [];
    while (text) {
      let cut = text.length;
      if (cut > MAX_PASSAGE) {
        const para = text.lastIndexOf("\n\n", MAX_PASSAGE);
        cut = para > MAX_PASSAGE / 3 ? para : MAX_PASSAGE;
      }
      const part = text.slice(0, cut).trim();
      text = text.slice(cut).trim();
      if (!part) continue;
      const words = tokenize(`${doc.title} ${heading} ${part}`);
      const tf = new Map<string, number>();
      for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
      out.push({ slug: doc.slug, title: doc.title, heading, text: part, tf, length: words.length });
    }
  };
  for (const line of doc.markdown.split("\n")) {
    const h = /^#{1,4}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      heading = h[1]!.replace(/[`*_]/g, "");
    } else buf.push(line);
  }
  flush();
  return out;
}

export class Knowledge {
  private readonly df = new Map<string, number>();
  private readonly avgLength: number;

  constructor(readonly passages: Passage[]) {
    for (const p of passages)
      for (const t of p.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.avgLength = passages.reduce((n, p) => n + p.length, 0) / Math.max(passages.length, 1);
  }

  static fromDocs(docs: { slug: string; title: string; markdown: string }[]): Knowledge {
    return new Knowledge(docs.flatMap(passagesOf));
  }

  /** BM25 ranking; passages with no matching word are left out. */
  search(query: string, limit = 6): Passage[] {
    const terms = [...new Set(tokenize(query))];
    const N = this.passages.length;
    const scored: { p: Passage; score: number }[] = [];
    for (const p of this.passages) {
      let score = 0;
      for (const t of terms) {
        const f = p.tf.get(t);
        if (!f) continue;
        const n = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * p.length) / this.avgLength));
      }
      if (score > 0) scored.push({ p, score });
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.p);
  }
}

let knowledge: Knowledge | null = null;
export function getKnowledge(): Knowledge {
  knowledge ??= Knowledge.fromDocs(readKnowledge());
  return knowledge;
}

const formatPassages = (passages: Passage[], origin: string) =>
  passages
    .map((p) => `[${p.title} — ${p.heading}](${origin}/docs/${p.slug})\n${p.text}`)
    .join("\n\n---\n\n");

// ---- the asking member's organization ---------------------------------------------------------------

/** A summary of the organization for the assistant: configuration and status, never secrets. */
export async function organizationContext(
  deps: Deps,
  organizationId: string,
  role: string,
): Promise<string> {
  const [org] = await deps.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!org) return "";
  const [members] = await deps.db
    .select({ n: count() })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.active, true),
      ),
    );
  const shards = await deps.db
    .select()
    .from(nonceShards)
    .where(eq(nonceShards.organizationId, organizationId));
  const [keys] = await deps.db
    .select({ n: count() })
    .from(apiKeys)
    .where(and(eq(apiKeys.organizationId, organizationId), isNull(apiKeys.revokedAt)));
  const [hooks] = await deps.db
    .select({ n: count() })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.organizationId, organizationId));
  const gate = await gateOverview(deps, organizationId);
  const summary = {
    organization: {
      name: org.name,
      address: org.address,
      verifiedDomain: org.verifiedDomain ?? null,
      yourRole: role,
      activeMembers: members?.n ?? 0,
      settings: org.settings,
    },
    acceptanceShards: shards.map((s) => ({
      shardId: s.shardId,
      relayerIsStele: s.relayerAddress === deps.chain.relayer.address,
      sponsorship: s.sponsorship ? "enabled" : "off",
    })),
    apiKeys: keys?.n ?? 0,
    webhookEndpoints: hooks?.n ?? 0,
    documents: gate.documents.map((d) => ({
      slug: d.slug,
      type: d.documentType,
      versions: d.versionCount,
      current: d.currentVersion
        ? {
            number: d.currentVersion.number,
            label: d.currentVersion.label,
            title: d.currentVersion.title,
          }
        : null,
      gatePolicy: d.policy
        ? { address: d.policy.address, requiredVersion: d.policy.requiredVersion }
        : null,
      acceptedWallets: d.passes,
    })),
    gate: {
      enabled: gate.enabled,
      programs: gate.programs.map((p) => ({
        label: p.label,
        programAddress: p.programAddress,
        protectedInstruction: p.action,
        policyDocument: gate.documents.find((d) => d.id === p.policyDocumentId)?.slug ?? null,
        isDemoVault: p.isDemo,
        probeAccounts: p.probeTemplate?.accounts.map((a) => a.role) ?? null,
        verification: p.verification
          ? {
              status: p.verification.status,
              reason: p.verification.reason,
              checks: p.verification.checks.map((c) => ({
                id: c.id,
                outcome: c.outcome,
                error: c.error,
                detail: c.detail,
              })),
              upgradeAuthority: p.verification.program.authorityKind,
            }
          : "not checked",
        ownershipProven: Boolean(p.ownership),
      })),
    },
  };
  return JSON.stringify(summary, null, 1);
}

// ---- limits -----------------------------------------------------------------------------------------

const hits = new Map<string, number[]>();
let today = "";
let todayCount = 0;

/** Admits one answer, or throws 429. Counters live in this process (one API process per node). */
export function admitQuestion(deps: Deps, ipHash: string): void {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  if (day !== today) {
    today = day;
    todayCount = 0;
    hits.clear();
  }
  const recent = (hits.get(ipHash) ?? []).filter((t) => now - t < 3_600_000);
  if (
    recent.length >= deps.config.STELE_ASSISTANT_PER_IP_HOUR ||
    todayCount >= deps.config.STELE_ASSISTANT_DAILY_LIMIT
  )
    throw new ApiError(
      429,
      "rate_limited",
      "The assistant has answered many questions for now. Please try again later, or read the docs.",
    );
  recent.push(now);
  hits.set(ipHash, recent);
  todayCount++;
}

// ---- answering --------------------------------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AskInput {
  messages: ChatMessage[];
  /** The page the question was asked on (e.g. /dashboard/gate/verification). */
  page?: string;
  /** The organization summary (dashboard only). */
  organization?: string;
}

export type AssistantEvent =
  { type: "delta"; text: string } | { type: "searching"; query: string } | { type: "done" };

const SEARCH_TOOL = {
  type: "function",
  function: {
    name: "search_docs",
    description:
      "Search Stele's public documentation (guides, API, SDK, on-chain reference, protocol, security, terms). Use English keywords, e.g. 'require_current_passport policy pinned InvalidPolicy'.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "English search keywords" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
} as const;

/** The pages the assistant may link to: the app's own, and every public documentation page. */
function siteMap(origin: string, kb: Knowledge): string[] {
  const app: [string, string][] = [
    ["/", "Home"],
    ["/proof", "Stele Proof"],
    ["/gate", "Stele Gate"],
    ["/how-it-works", "How it works"],
    ["/demo", "Live demo"],
    ["/pricing", "Pricing"],
    ["/security", "Security"],
    ["/verify", "Verify an agreement"],
    ["/developers", "Developers"],
    ["/developers/sdk", "SDK reference"],
    ["/developers/api", "API explorer"],
    ["/developers/onchain", "On-chain reference"],
    ["/dashboard", "Dashboard"],
    ["/contact", "Contact"],
    ["/terms", "Terms of Service"],
    ["/privacy", "Privacy Policy"],
  ];
  const docs = new Map<string, string>();
  for (const p of kb.passages) if (!docs.has(p.slug)) docs.set(p.slug, p.title);
  return [
    ...app.map(([path, title]) => `${origin}${path === "/" ? "" : path} — ${title}`),
    ...[...docs]
      .filter(([slug]) => slug !== "terms-of-service" && slug !== "privacy-policy")
      .map(([slug, title]) => `${origin}/docs/${slug} — ${title}`),
  ];
}

/** Facts the documentation leaves to this deployment's configuration (prices, network). */
function deploymentFacts(deps: Deps): string[] {
  const sol = (lamports: number) => `${(lamports / 1e9).toFixed(9).replace(/0+$/, "")} SOL`;
  const packs = deps.config.billing.packs
    .map(
      (p) =>
        `${p.credits.toLocaleString("en-US")} recordings for ${sol(p.lamports)} (${sol(Math.round(p.lamports / p.credits))} each)`,
    )
    .join("; ");
  return [
    `- Network: Solana ${deps.config.network.label}.${deps.config.network.cluster === "mainnet" ? "" : " Records here are test records, not evidence; Mainnet is not available yet."}`,
    `- Free: ${deps.config.STELE_FREE_RECORDS_PER_MONTH.toLocaleString("en-US")} recordings (acceptances or proofs) per organization every month.`,
    `- After that, prepaid credits in SOL, one per recording, never expiring: ${packs || "no packs configured"}.${deps.config.billing.treasury ? " Bought in the dashboard (Billing)." : " Credit purchases are not enabled on this deployment yet."}`,
    "- The people who accept pay nothing and need no crypto: Stele's relayer pays every network fee; they sign with a passkey (Face ID, fingerprint) or a wallet.",
    "- Organizations pay Solana rent directly from their wallet for what they create (organization, documents, versions, nonce shards), at cost — see the pricing page.",
  ];
}

export function systemPrompt(deps: Deps, input: AskInput, kb: Knowledge = getKnowledge()): string {
  const origin = deps.config.APP_ORIGIN;
  const lines = [
    `You are the Stele assistant on ${origin}. You help companies and developers understand and set up Stele.`,
    "Stele records cryptographic evidence on Solana: organizations publish versions of their documents (terms, privacy policies, offering terms), people accept a specific version by signing it (wallet or passkey, free for them), and anyone can verify both against the chain without Stele. Stele Gate lets a Solana program refuse users who have not accepted the required version (policies, passports, the stele-gate Rust crate). Stele Verified checks a deployed program and shows a badge.",
    "",
    "How to answer:",
    "- Answer the question directly in the first sentence, then add only what helps. Keep answers under about 150 words unless the user asks for detail or code.",
    "- Base every answer on Stele's documentation (the passages below, and search_docs when they do not cover the question) and on the facts below. Never invent endpoints, functions, parameters, prices or behaviour. If neither says, say so and suggest the contact page.",
    "- Link only to pages from the site map below, with Markdown links, and never make up a URL.",
    "- Reply in the language of the user's last message, in natural, grammatical language. Short code samples follow the documentation (TypeScript for the SDK and API, Rust for programs).",
    "- Never ask for private keys, seed phrases, API keys or webhook secrets. If the user pastes one, tell them to rotate it immediately.",
    "- You do not give legal advice. Explain what a Stele record proves and what it does not, and recommend a lawyer for legal questions.",
    "- Politely decline questions unrelated to Stele, Solana development with Stele, or legal-tech workflows Stele supports.",
    "",
    "Facts about this deployment:",
    ...deploymentFacts(deps),
    "",
    "Site map (the only pages you may link to):",
    ...siteMap(origin, kb),
  ];
  if (input.page) lines.push("", `The user is on the page ${input.page}.`);
  if (input.organization)
    lines.push(
      "",
      "The user is signed in to the dashboard. Their organization (a summary of its configuration and status, for specific help — for example why a verification check failed and what to change):",
      input.organization,
    );
  return lines.join("\n");
}

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

type OpenAiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: unknown[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Reads an OpenAI-style SSE stream: text deltas, accumulated tool calls, and the finish reason. */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onText: (t: string) => void,
): Promise<{ text: string; toolCalls: ToolCall[]; finish: string | null }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const calls: ToolCall[] = [];
  let text = "";
  let finish: string | null = null;
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let chunk: {
        choices?: {
          delta?: {
            content?: string | null;
            tool_calls?: {
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }[];
          };
          finish_reason?: string | null;
        }[];
      };
      try {
        chunk = JSON.parse(data) as typeof chunk;
      } catch {
        continue;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.delta?.content) {
        text += choice.delta.content;
        onText(choice.delta.content);
      }
      for (const tc of choice.delta?.tool_calls ?? []) {
        const c = (calls[tc.index] ??= { id: "", name: "", arguments: "" });
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name += tc.function.name;
        if (tc.function?.arguments) c.arguments += tc.function.arguments;
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }
  return { text, toolCalls: calls.filter(Boolean), finish };
}

/**
 * Answers the conversation, streaming events. At most three documentation searches by the model,
 * then it must answer.
 */
export async function answer(
  deps: Deps,
  input: AskInput,
  emit: (e: AssistantEvent) => void,
  opts: { fetch?: typeof fetch; signal?: AbortSignal; knowledge?: Knowledge } = {},
): Promise<void> {
  const doFetch = opts.fetch ?? fetch;
  const kb = opts.knowledge ?? getKnowledge();
  const origin = deps.config.APP_ORIGIN;
  const question = input.messages.at(-1)?.content ?? "";
  const found = kb.search(`${question} ${input.page ?? ""}`, 5);
  const messages: OpenAiMessage[] = [
    {
      role: "system",
      content: `${systemPrompt(deps, input, kb)}\n\nDocumentation passages found for the question:\n\n${
        found.length > 0 ? formatPassages(found, origin) : "(none: use search_docs)"
      }`,
    },
    ...input.messages.map((m) => ({ role: m.role, content: m.content }) as OpenAiMessage),
  ];
  const model = deps.config.OPENAI_MODEL;
  const reasoning = /^(gpt-5|o\d)/.test(model) ? { reasoning_effort: "low" } : {};
  for (let round = 0; round < 4; round++) {
    const res = await doFetch(`${deps.config.OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deps.config.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_completion_tokens: 2000,
        ...(round < 3 ? { tools: [SEARCH_TOOL] } : {}),
        ...reasoning,
      }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      deps.logger.error(
        { status: res.status, detail: detail.slice(0, 500) },
        "assistant: provider error",
      );
      throw new ApiError(
        503,
        "assistant_unavailable",
        res.status === 429
          ? "The assistant is busy. Please try again in a minute."
          : "The assistant is unavailable right now.",
      );
    }
    const out = await readStream(res.body, (text) => emit({ type: "delta", text }));
    if (out.toolCalls.length === 0) {
      emit({ type: "done" });
      return;
    }
    messages.push({
      role: "assistant",
      content: out.text || null,
      tool_calls: out.toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.arguments },
      })),
    });
    for (const call of out.toolCalls) {
      let query = "";
      try {
        query = String((JSON.parse(call.arguments) as { query?: unknown }).query ?? "");
      } catch {
        // An unreadable call: answered with no results.
      }
      emit({ type: "searching", query });
      const results = call.name === "search_docs" ? kb.search(query, 5) : [];
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: results.length > 0 ? formatPassages(results, origin) : "No matching passage.",
      });
    }
  }
  emit({ type: "done" });
}
