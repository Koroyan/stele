/**
 * The Stele Verified badge: a live, clickable proof that the site's Solana program enforces its
 * terms on-chain. It reads the program's verification from Stele (re-checked after every program
 * upgrade) and opens the full evidence on Stele's site when clicked.
 *
 *   mountVerifiedBadge("#stele-badge", { program: "YOUR_PROGRAM_ID" });
 *
 * The badge refuses to vouch for a site the organization has not verified: copied to another
 * domain it reads "Not valid on this site". (Its static image can be copied anywhere, which is why
 * the evidence page states the organization's verified domains and checks where the visitor came
 * from.) Framework-free, in a shadow root: the host page's styles cannot reach it.
 */
import { applyStyles, h } from "./dom";

export interface VerifiedBadgeOptions {
  /** The protected program's address. */
  program: string;
  /** Default: Stele's hosted API. */
  apiBaseUrl?: string;
  /** Where the evidence page lives (default: the API's origin). */
  appUrl?: string;
  /** Default "auto" (follows the visitor's color scheme). */
  theme?: "auto" | "light" | "dark";
  fetch?: typeof fetch;
}

export type BadgeState =
  "checking" | "verified" | "elsewhere" | "failed" | "pending" | "unavailable";

export interface VerifiedBadgeHandle {
  readonly state: BadgeState;
  refresh(): Promise<void>;
  destroy(): void;
}

interface VerifiedView {
  status: "verified" | "failed" | "incomplete" | "unverified";
  organization: { name: string; domains: string[] };
  document: { title: string; requiredVersion: number };
}

const DEFAULT_API = "https://stele.site/api";

const COPY: Record<BadgeState, { title: string; line: string }> = {
  checking: { title: "Stele", line: "Checking…" },
  verified: { title: "Stele Verified", line: "Terms enforced on-chain" },
  elsewhere: { title: "Not valid on this site", line: "This badge belongs elsewhere" },
  failed: { title: "Not verified", line: "Enforcement not confirmed" },
  pending: { title: "Stele Gate", line: "Verification pending" },
  unavailable: { title: "Stele Gate", line: "Status unavailable" },
};

const CSS = `
:host { all: initial; display: inline-block; vertical-align: middle;
  --_bg: #ffffff; --_border: #dbe1ea; --_fg: #0f172a; --_muted: #475569;
  --_ok: #047857; --_bad: #b91c1c; --_warn: #b45309; --_idle: #64748b; --_ring: #0e7490;
  --_font: var(--stele-font, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); }
:host([data-theme="dark"]) { --_bg: #0b1017; --_border: #273244; --_fg: #e6edf5; --_muted: #94a3b8;
  --_ok: #34d399; --_bad: #f87171; --_warn: #f5b544; --_idle: #94a3b8; --_ring: #4cc9f0; }
@media (prefers-color-scheme: dark) {
  :host([data-theme="auto"]) { --_bg: #0b1017; --_border: #273244; --_fg: #e6edf5; --_muted: #94a3b8;
    --_ok: #34d399; --_bad: #f87171; --_warn: #f5b544; --_idle: #94a3b8; --_ring: #4cc9f0; }
}
a { box-sizing: border-box; display: inline-flex; align-items: center; gap: 10px; height: 40px;
  padding: 0 12px 0 5px; border-radius: 999px; border: 1px solid var(--_border); background: var(--_bg);
  color: var(--_fg); font: 12.5px/1.15 var(--_font); text-decoration: none; cursor: pointer;
  transition: transform .14s ease, box-shadow .14s ease, border-color .14s ease; }
a:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--_tone) 45%, var(--_border));
  box-shadow: 0 6px 18px -8px color-mix(in srgb, var(--_tone) 55%, transparent); }
a:focus-visible { outline: 2px solid var(--_ring); outline-offset: 2px; }
.seal { width: 30px; height: 30px; border-radius: 50%; flex: none; display: grid; place-items: center;
  background: color-mix(in srgb, var(--_tone) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--_tone) 45%, transparent); color: var(--_tone); }
.seal svg { width: 18px; height: 18px; }
.text { display: grid; gap: 2px; white-space: nowrap; }
.title { font-weight: 650; letter-spacing: -.01em; }
.line { font-size: 10.5px; color: var(--_muted); }
.go { width: 14px; height: 14px; color: var(--_muted); flex: none; }
a[data-state="verified"] { --_tone: var(--_ok); }
a[data-state="failed"] { --_tone: var(--_bad); }
a[data-state="elsewhere"] { --_tone: var(--_warn); }
a[data-state="checking"], a[data-state="pending"], a[data-state="unavailable"] { --_tone: var(--_idle); }
a[data-state="checking"] .seal { animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) { a { transition: none; } a:hover { transform: none; }
  a[data-state="checking"] .seal { animation: none; } }
`;

const SVG = "http://www.w3.org/2000/svg";
function svg(tag: string, attrs: Record<string, string>, ...children: Element[]): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

/** The Stele tablet; its inscription becomes a check when verified, a mark when not valid here. */
function glyph(state: BadgeState): SVGElement {
  const stroke = {
    stroke: "currentColor",
    fill: "none",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  };
  const inside =
    state === "verified"
      ? svg("path", { d: "M11.6 16.4l3.3 3.3 6.4-6.7", "stroke-width": "2.6", ...stroke })
      : state === "elsewhere" || state === "failed"
        ? svg("path", { d: "M16 11.5v5.5M16 21h.01", "stroke-width": "2.6", ...stroke })
        : svg("path", {
            d: "M10.5 12.5h11M10.5 16.5h11M10.5 20.5h6",
            "stroke-width": "2",
            opacity: ".7",
            ...stroke,
          });
  return svg(
    "svg",
    { viewBox: "0 0 32 32", "aria-hidden": "true" },
    svg("path", { d: "M9.5 4.5h13l4 4v19h-21v-19z", "stroke-width": "2.2", ...stroke }),
    inside,
  );
}

/** True when `host` is one of the organization's verified domains (or a subdomain), or local. */
export function badgeValidOn(host: string, domains: string[]): boolean {
  if (domains.length === 0) return true;
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")) return true;
  const h = host.toLowerCase().replace(/\.$/, "");
  return domains.some((d) => {
    const domain = d.toLowerCase().replace(/^www\./, "");
    return h === domain || h.endsWith(`.${domain}`);
  });
}

/** Maps the public verification to what the badge shows on `host`. */
export function badgeStateOf(view: VerifiedView | null, host: string): BadgeState {
  if (!view) return "unavailable";
  if (view.status === "failed") return "failed";
  if (view.status !== "verified") return "pending";
  return badgeValidOn(host, view.organization.domains) ? "verified" : "elsewhere";
}

export function mountVerifiedBadge(
  target: string | Element,
  options: VerifiedBadgeOptions,
): VerifiedBadgeHandle {
  const parent = typeof target === "string" ? document.querySelector(target) : target;
  if (!parent) throw new Error(`Stele badge: no element matches ${String(target)}`);
  const api = (options.apiBaseUrl ?? DEFAULT_API).replace(/\/$/, "");
  const appUrl = (options.appUrl ?? new URL(api).origin).replace(/\/$/, "");
  const doFetch = options.fetch ?? fetch.bind(globalThis);
  const program = encodeURIComponent(options.program);

  const host = document.createElement("span");
  host.dataset.theme = options.theme ?? "auto";
  const root = host.attachShadow({ mode: "open" });
  applyStyles(root, CSS);
  const link = h("a", {
    href: `${appUrl}/verified/${program}`,
    target: "_blank",
    rel: "noopener",
    // The evidence page checks the visitor came from one of the organization's domains.
    referrerpolicy: "origin",
  });
  root.append(link);
  parent.append(host);

  let state: BadgeState = "checking";
  let view: VerifiedView | null = null;
  const render = () => {
    const copy = COPY[state];
    link.dataset.state = state;
    const subject =
      view && state === "verified"
        ? `${view.organization.name} requires its ${view.document.title} (version ${view.document.requiredVersion} or later) in its Solana program, verified by Stele. `
        : "";
    link.setAttribute(
      "aria-label",
      `${copy.title}: ${copy.line}. ${subject}Opens the evidence on Stele.`,
    );
    link.replaceChildren(
      h("span", { class: "seal" }, glyph(state)),
      h(
        "span",
        { class: "text" },
        h("span", { class: "title" }, copy.title),
        h("span", { class: "line" }, copy.line),
      ),
      svg(
        "svg",
        { class: "go", viewBox: "0 0 16 16", "aria-hidden": "true" },
        svg("path", {
          d: "M6 4l4 4-4 4",
          stroke: "currentColor",
          "stroke-width": "1.6",
          fill: "none",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        }),
      ),
    );
  };
  render();

  const refresh = async () => {
    try {
      const res = await doFetch(`${api}/v1/public/verified/${program}`, { credentials: "omit" });
      view = res.ok ? ((await res.json()) as VerifiedView) : null;
      state = res.status === 404 ? "pending" : badgeStateOf(view, window.location.hostname);
    } catch {
      view = null;
      state = "unavailable";
    }
    render();
  };
  void refresh();
  // A program can be upgraded at any time: the badge follows the latest verification.
  const timer = setInterval(() => void refresh(), 10 * 60_000);

  return {
    get state() {
      return state;
    },
    refresh,
    destroy() {
      clearInterval(timer);
      host.remove();
    },
  };
}
