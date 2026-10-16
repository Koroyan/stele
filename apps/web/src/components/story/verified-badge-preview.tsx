/**
 * The Stele Verified badge as it appears on an organization's site (verified state, both themes) —
 * a picture for the marketing pages; the live badge comes from the SDK.
 */
const THEMES = {
  dark: { bg: "#0b1017", border: "#273244", fg: "#e6edf5", muted: "#94a3b8", ok: "#34d399" },
  light: { bg: "#ffffff", border: "#dbe1ea", fg: "#0f172a", muted: "#475569", ok: "#047857" },
};

function Badge({ theme }: { theme: keyof typeof THEMES }) {
  const c = THEMES[theme];
  return (
    <svg width="200" height="40" viewBox="0 0 200 40" aria-hidden="true">
      <rect x=".5" y=".5" width="199" height="39" rx="19.5" fill={c.bg} stroke={c.border} />
      <circle
        cx="20"
        cy="20"
        r="14"
        fill={c.ok}
        fillOpacity=".14"
        stroke={c.ok}
        strokeOpacity=".45"
      />
      <g transform="translate(10.1 10.1) scale(.62)" fill="none" stroke={c.ok}>
        <path d="M9.5 4.5h13l4 4v19h-21v-19z" strokeWidth="2.2" strokeLinejoin="round" />
        <path
          d="M11.6 16.4l3.3 3.3 6.4-6.7"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <text x="42" y="17.5" fill={c.fg} fontSize="12.5" fontWeight="650" fontFamily="inherit">
        Stele Verified
      </text>
      <text x="42" y="30.5" fill={c.muted} fontSize="10.5" fontFamily="inherit">
        Terms enforced on-chain
      </text>
      <path
        d="M183 16l4 4-4 4"
        stroke={c.muted}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function VerifiedBadgePreview() {
  return (
    <div
      role="img"
      aria-label="The Stele Verified badge: Terms enforced on-chain"
      className="flex flex-wrap items-center justify-center gap-4"
    >
      <Badge theme="dark" />
      <Badge theme="light" />
    </div>
  );
}
