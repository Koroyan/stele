import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, CodeTabs, CopyButton, cn } from "@stele/ui";
import { widgetSamples } from "@/lib/developer-samples";
import { getNetworkMenu } from "@/lib/networks";
import { siteOrigin } from "@/lib/origin";

export const metadata: Metadata = {
  title: "Developers",
  description:
    "Install the Stele SDK and crate, follow the Proof or Gate guide, and use the SDK, API and on-chain references.",
};

/**
 * The developers hub: install, the two products in a few lines each, and where everything else
 * lives. Each topic is written once — in its guide or its reference — and linked from here.
 */
const PLACEHOLDERS = ["acme.com", "terms-of-service", "YOUR_POLICY_ADDRESS"];

const GATE_RUST = `// Cargo.toml: stele-gate = "1.1"
pub const POLICY: Pubkey = pubkey!("YOUR_POLICY_ADDRESS");

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    stele_gate::require_current_passport(
        &ctx.accounts.passport, // stele_gate::passport_address(user).0
        &ctx.accounts.policy, // #[account(address = POLICY)]
        &ctx.accounts.user,
    )?;
    // … the protected action
    Ok(())
}`;

function gateTs(origin: string) {
  return `import { createSteleGate } from "@stelehq/sdk";

const stele = createSteleGate({ apiBaseUrl: "${origin}/api", wallet });

await stele.gate({
  policy: "YOUR_POLICY_ADDRESS",
  action: () => sendDepositTransaction(), // runs once the terms are accepted
});`;
}

function Install({
  label,
  command,
  href,
  hrefLabel,
}: {
  label: string;
  command: string;
  href: string;
  hrefLabel: string;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-4">
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-fg-subtle">{label}</p>
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg">{command}</code>
        <CopyButton value={command} label={`Copy: ${command}`} />
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="mt-2 text-[12.5px] text-fg-subtle hover:text-accent"
      >
        {hrefLabel} ↗
      </a>
    </div>
  );
}

function ProductCard({
  name,
  tagline,
  steps,
  guide,
  children,
}: {
  name: string;
  tagline: string;
  steps: string[];
  guide: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-accent">{name}</p>
      <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.02em] text-fg">{tagline}</h2>
      <ol className="mt-4 space-y-1.5 text-[14px] text-fg-muted">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-2.5">
            <span className="font-mono text-[12px] leading-6 text-accent">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <div className="mt-5 min-w-0 flex-1">{children}</div>
      <Link
        href={guide.href}
        className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:text-accent-strong"
      >
        {guide.label} <ArrowRightIcon className="h-4 w-4" />
      </Link>
    </div>
  );
}

const REFERENCES = [
  {
    href: "/developers/sdk",
    title: "SDK reference",
    body: "Every function of @stelehq/sdk — browser, React and server — with its options and an example.",
  },
  {
    href: "/developers/api",
    title: "API explorer",
    body: "Every REST endpoint, grouped and described. Send real requests from the page.",
  },
  {
    href: "/developers/onchain",
    title: "On-chain reference",
    body: "The stele-gate crate, the Stele program's instructions, accounts and error codes.",
  },
];

export default async function DevelopersPage() {
  const [origin, menu] = await Promise.all([siteOrigin(), getNetworkMenu()]);
  const baseUrl = `${origin}/api/v1`;
  const networks = menu
    ? menu.choices.map((c) => ({
        label: c.label,
        baseUrl: c.current ? baseUrl : c.url ? `${c.url}/api/v1` : null,
        current: c.current,
      }))
    : [{ label: "This Stele app", baseUrl, current: true }];

  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-14 sm:px-6 sm:pt-16">
          <h1 className="max-w-3xl text-balance text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] text-fg sm:text-[46px]">
            Build with Stele.
          </h1>
          <p className="mt-4 max-w-2xl text-[16.5px] leading-relaxed text-fg-muted">
            Prove which terms each user accepted — or make your Solana program require them. Install
            a package, follow one guide, look things up in the references.
          </p>
          <div className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Install
              label="Browser & Node.js"
              command="npm install @stelehq/sdk"
              href="https://www.npmjs.com/package/@stelehq/sdk"
              hrefLabel="npm"
            />
            <Install
              label="Solana program (Rust)"
              command="cargo add stele-gate"
              href="https://crates.io/crates/stele-gate"
              hrefLabel="crates.io"
            />
            <Install
              label="Plain HTML"
              command={`<script src="${origin}/sdk/v1/stele.js" defer></script>`}
              href="/docs/get-started#3-add-stele-to-your-website"
              hrefLabel="Widget guide"
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <ProductCard
            name="Stele Proof"
            tagline="Prove which terms each user accepted"
            steps={[
              "Publish your terms in the dashboard.",
              "Add the widget: the user signs the exact text, free.",
              "Check acceptances from your server or verify them on Solana.",
            ]}
            guide={{ href: "/docs/get-started", label: "Proof guide — step by step" }}
          >
            <CodeTabs tabs={widgetSamples(origin)} placeholders={PLACEHOLDERS} />
          </ProductCard>
          <ProductCard
            name="Stele Gate"
            tagline="Make your program require the current terms"
            steps={[
              "Create a policy: which document and version an action needs.",
              "Call require_current_passport() in your Solana program.",
              "Wrap the action with gate() in your app: Accept & Continue.",
            ]}
            guide={{ href: "/docs/gate-guide", label: "Gate guide — step by step" }}
          >
            <CodeTabs
              tabs={[
                { label: "Program (Rust)", language: "rust", code: GATE_RUST },
                { label: "App (TypeScript)", language: "ts", code: gateTs(origin) },
              ]}
              placeholders={PLACEHOLDERS}
            />
          </ProductCard>
        </div>
      </section>

      <section className="border-t border-line bg-bg-raised">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-fg-subtle">
            References
          </h2>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            {REFERENCES.map((r) => (
              <Link key={r.href} href={r.href} className="group">
                <div className="h-full rounded-2xl border border-line bg-surface p-5 transition-colors group-hover:border-accent-line">
                  <p className="flex items-center justify-between text-[16px] font-semibold text-fg">
                    {r.title}
                    <ArrowRightIcon className="h-4 w-4 text-fg-subtle group-hover:text-accent" />
                  </p>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">{r.body}</p>
                </div>
              </Link>
            ))}
          </div>

          <h2 className="mt-12 text-[13px] font-semibold uppercase tracking-[0.1em] text-fg-subtle">
            API base URL
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {networks.map((n) => (
              <div
                key={n.label}
                className={cn(
                  "rounded-2xl border p-4",
                  n.current ? "border-accent-line bg-accent/5" : "border-line bg-surface",
                )}
              >
                <p className="text-[13.5px] font-medium text-fg">
                  {n.label}
                  {n.current && <span className="ml-2 text-[12px] text-accent">this site</span>}
                </p>
                {n.baseUrl ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="min-w-0 truncate font-mono text-[12.5px] text-fg-muted">
                      {n.baseUrl}
                    </span>
                    <CopyButton value={n.baseUrl} label={`Copy the ${n.label} base URL`} />
                  </div>
                ) : (
                  <p className="mt-2 text-[12.5px] text-fg-subtle">Not available yet</p>
                )}
              </div>
            ))}
          </div>
          <p className="mt-4 text-[13px] text-fg-subtle">
            Each network is a separate Stele app with its own API keys and data. Server endpoints
            use an API key from the dashboard (API keys).
          </p>
        </div>
      </section>
    </>
  );
}
