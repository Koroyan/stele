/**
 * The Stele Verified badge as a static SVG (READMEs, pages without JavaScript). Same design as the
 * SDK's live badge: the Stele tablet whose inscription becomes a check once the program is verified.
 * Every string is a constant — nothing from a request reaches the markup.
 */

type Status = "verified" | "failed" | "incomplete" | "unverified";
type Theme = "dark" | "light";

const PALETTE = {
  dark: {
    bg: "#0b1017",
    border: "#273244",
    fg: "#e6edf5",
    muted: "#94a3b8",
    ok: "#34d399",
    bad: "#f87171",
    idle: "#94a3b8",
  },
  light: {
    bg: "#ffffff",
    border: "#dbe1ea",
    fg: "#0f172a",
    muted: "#475569",
    ok: "#047857",
    bad: "#b91c1c",
    idle: "#64748b",
  },
} as const;

const COPY: Record<Status, { title: string; line: string; tone: "ok" | "bad" | "idle" }> = {
  verified: { title: "Stele Verified", line: "Terms enforced on-chain", tone: "ok" },
  failed: { title: "Not verified", line: "Enforcement not confirmed", tone: "bad" },
  incomplete: { title: "Stele Gate", line: "Verification pending", tone: "idle" },
  unverified: { title: "Stele Gate", line: "Verification pending", tone: "idle" },
};

/** The tablet (from the Stele mark), scaled into the seal; a check or the inscription inside. */
function glyph(color: string, verified: boolean): string {
  const inner = verified
    ? `<path d="M11.6 16.4l3.3 3.3 6.4-6.7" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
    : `<path d="M10.5 12.5h11M10.5 16.5h11M10.5 20.5h6" stroke="${color}" stroke-width="2" stroke-linecap="round" opacity=".7" fill="none"/>`;
  return `<g transform="translate(10.1 10.1) scale(.62)"><path d="M9.5 4.5h13l4 4v19h-21v-19z" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" fill="none"/>${inner}</g>`;
}

export function badgeSvg(status: Status, theme: Theme = "dark"): string {
  const c = PALETTE[theme];
  const copy = COPY[status];
  const tone = c[copy.tone];
  const font = `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40" viewBox="0 0 200 40" role="img" aria-label="${copy.title}: ${copy.line}">
<title>${copy.title} — ${copy.line}</title>
<rect x=".5" y=".5" width="199" height="39" rx="19.5" fill="${c.bg}" stroke="${c.border}"/>
<circle cx="20" cy="20" r="14" fill="${tone}" fill-opacity=".14" stroke="${tone}" stroke-opacity=".45"/>
${glyph(tone, status === "verified")}
<text x="42" y="17.5" fill="${c.fg}" font-family="${font}" font-size="12.5" font-weight="650" letter-spacing="-.1">${copy.title}</text>
<text x="42" y="30.5" fill="${c.muted}" font-family="${font}" font-size="10.5">${copy.line}</text>
<path d="M183 16l4 4-4 4" stroke="${c.muted}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;
}
