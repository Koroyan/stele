/** Documentation catalog: routes map to Markdown files in the repository (server only). */
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface DocEntry {
  slug: string;
  file: string;
  title: string;
  group: DocGroup;
  summary: string;
}

/**
 * Values in documentation code samples that readers replace with their own. They are highlighted
 * in code blocks (never in JSON responses); copying a block copies them unchanged.
 */
export const DOC_PLACEHOLDERS = [
  "https://app.stele.example",
  "acme.com",
  "terms-of-service",
  "user_12345",
  "stl_live_…",
  "stl_test_…",
  "whsec_…",
  "SESSION_TOKEN_FROM_YOUR_SERVER",
] as const;

export const DOC_GROUPS = [
  "Start here",
  "Developers",
  "Verification",
  "Protocol",
  "Security",
] as const;
export type DocGroup = (typeof DOC_GROUPS)[number];

/**
 * The PUBLIC documentation. Only files listed here are routed or linked on the website. Operator
 * documentation (deployment, infrastructure, secrets, monitoring, recovery and incident runbooks)
 * stays in the repository and must never be added here.
 */
export const DOCS: DocEntry[] = [
  {
    slug: "overview",
    file: "docs/overview.md",
    title: "Product overview",
    group: "Start here",
    summary: "What Stele is, the problem it solves and what you get.",
  },
  {
    slug: "how-it-works",
    file: "docs/how-it-works.md",
    title: "How Stele works",
    group: "Start here",
    summary: "Publishing, accepting and verifying, and what is stored where.",
  },
  {
    slug: "get-started",
    file: "docs/get-started.md",
    title: "Get started",
    group: "Developers",
    summary:
      "From zero to a working integration: publish, embed, confirm from your server in any language.",
  },
  {
    slug: "gate",
    file: "docs/gate.md",
    title: "Stele Gate",
    group: "Developers",
    summary:
      "Require the current terms before a protected action: policies, AccessPasses and require_current() in your Solana program.",
  },
  {
    slug: "verification",
    file: "docs/verification.md",
    title: "Verification",
    group: "Verification",
    summary: "Check any acceptance against Solana: in the browser, the command line or code.",
  },
  {
    slug: "acceptance-signing",
    file: "docs/acceptance-signing.md",
    title: "What a signature proves",
    group: "Verification",
    summary: "What users sign, how it is checked, and what it does and does not prove.",
  },
  {
    slug: "api",
    file: "docs/api.md",
    title: "SDK & API",
    group: "Developers",
    summary: "The widget, the REST API with samples in eight languages, webhooks and errors.",
  },
  {
    slug: "protocol",
    file: "docs/protocol.md",
    title: "Protocol overview",
    group: "Protocol",
    summary: "Accounts, instructions, fingerprints and versioning in plain language.",
  },
  {
    slug: "spec",
    file: "PROTOCOL_SPEC.md",
    title: "Protocol specification",
    group: "Protocol",
    summary: "The normative stele/1 specification.",
  },
  {
    slug: "canonicalization",
    file: "docs/canonicalization.md",
    title: "Canonicalization",
    group: "Protocol",
    summary: "How documents become exact bytes, and the shared test vectors.",
  },
  {
    slug: "organization-authority",
    file: "docs/organization-authority.md",
    title: "Organizations & authority",
    group: "Protocol",
    summary: "Owners, roles, multisig, domain verification, recovery and freezing.",
  },
  {
    slug: "storage",
    file: "docs/storage.md",
    title: "Content storage",
    group: "Protocol",
    summary: "Content addressing, copies and retrieval of document text.",
  },
  {
    slug: "security",
    file: "docs/security.md",
    title: "Security architecture",
    group: "Security",
    summary: "How each layer protects the evidence and your users.",
  },
  {
    slug: "trust-model",
    file: "docs/trust-model.md",
    title: "Trust model",
    group: "Security",
    summary:
      "Who controls what: what nobody can forge or backdate, and what still rests on the signing page and enrollment.",
  },
  {
    slug: "threat-model",
    file: "docs/threat-model.md",
    title: "Threat model",
    group: "Security",
    summary: "Attackers, 134 attack scenarios with their defenses, and residual risks.",
  },
  {
    slug: "costs",
    file: "docs/cost-analysis.md",
    title: "Measured costs",
    group: "Protocol",
    summary: "Fees, compute units, sizes and rent of real recordings, direct and batched.",
  },
  {
    slug: "security-policy",
    file: "SECURITY.md",
    title: "Security policy",
    group: "Security",
    summary: "Reporting vulnerabilities and our disclosure process.",
  },
];

const FILE_TO_SLUG = new Map<string, string>(
  DOCS.map((d) => [
    path.posix.basename(d.file).toLowerCase() + (d.file.startsWith("docs/") ? "" : ":root"),
    d.slug,
  ]),
);

export function repoRoot(): string {
  return process.env.STELE_REPO_ROOT ?? path.resolve(process.cwd(), "../..");
}

export async function loadDoc(slug: string): Promise<{ entry: DocEntry; markdown: string } | null> {
  const entry = DOCS.find((d) => d.slug === slug);
  if (!entry) return null;
  try {
    // Deployments copy the Markdown next to the server (scripts/prepare-standalone.mjs); this read
    // must not make the bundler trace — and ship — the entire repository.
    const file = path.join(/*turbopackIgnore: true*/ repoRoot(), entry.file);
    const markdown = await readFile(/*turbopackIgnore: true*/ file, "utf8");
    return { entry, markdown };
  } catch {
    return null;
  }
}

/**
 * Rewrites repository-relative Markdown links (`docs/storage.md#x`, `../PROTOCOL_SPEC.md`) to site
 * routes. Returns `null` for links that have no page on this site (including internal documents).
 */
export function resolveDocLink(href: string, fromFile: string): string | null {
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (href.startsWith("#")) return href;
  if (href.startsWith("/")) return href;
  const [target, hash] = href.split("#", 2) as [string, string | undefined];
  if (!target.toLowerCase().endsWith(".md")) return null;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), target));
  const base = path.posix.basename(resolved).toLowerCase();
  const isDocsDir = resolved.startsWith("docs/");
  const slug = FILE_TO_SLUG.get(isDocsDir ? base : `${base}:root`);
  if (!slug && base === "readme.md") return `/docs${hash ? `#${hash}` : ""}`;
  if (!slug) return null;
  return `/docs/${slug}${hash ? `#${hash}` : ""}`;
}

/** GitHub-compatible heading anchor. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Second-level headings for the "On this page" list. */
export function outline(markdown: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      const text = m[1]!.replace(/[`*_]/g, "");
      out.push({ id: headingId(text), text });
    }
  }
  return out;
}
