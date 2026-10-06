import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, CodeBlock, CodeTabs, CopyButton, buttonClasses, cn } from "@stele/ui";
import { PageHero, Section, SectionHeading } from "@/components/marketing";
import {
  VERIFY_SAMPLE,
  WEBHOOK_SAMPLE,
  browserEventSamples,
  serverSamples,
  widgetSamples,
  type Sample,
} from "@/lib/developer-samples";
import { getNetworkMenu } from "@/lib/networks";
import { siteOrigin } from "@/lib/origin";

export const metadata: Metadata = {
  title: "Developers",
  description:
    "Add verifiable acceptance to your site with two lines of HTML, then confirm acceptances from your server in cURL, Node.js, Python, Java, Go, PHP, Ruby or C#.",
};

/** Values readers replace; highlighted in the samples (this site's address is filled in). */
const PLACEHOLDERS = ["acme.com", "terms-of-service", "user_12345"];

const LANGUAGES = ["cURL", "Node.js", "Python", "Java", "Go", "PHP", "Ruby", "C#"];

interface Step {
  title: string;
  body: string;
  more: { href: string; label?: string };
  samples?: Sample[];
  link?: { href: string; label: string };
}

function steps(origin: string): Step[] {
  return [
    {
      title: "Publish your Terms",
      body: "In the dashboard: connect your wallet, create your organization, then Documents → New document. Publish the first version with your wallet; it can never be edited, only succeeded by a new version.",
      more: { href: "/docs/get-started#2-publish-your-terms" },
      link: { href: "/dashboard", label: "Open the dashboard" },
    },
    {
      title: "Add the widget to your page",
      body: "Replace acme.com with your organization and terms-of-service with your document slug. The widget checks the text against Solana, lets the visitor sign with a wallet or a passkey, and records the acceptance. Visitors never pay a fee.",
      more: { href: "/docs/get-started#3-add-stele-to-your-website" },
      samples: widgetSamples(origin),
    },
    {
      title: "Update your page when it's accepted",
      body: "The widget reports the acceptance ID and the Solana transaction. Use it for the interface, for example to enable your Continue button.",
      more: { href: "/docs/get-started#5-handle-the-acceptance-in-the-browser" },
      samples: browserEventSamples(),
    },
    {
      title: "Confirm it on your server",
      body: "Browser events can be faked. Link the acceptance to your logged-in user with a session, then ask Stele from your server before checkout or account creation. Keep the API key on the server.",
      more: {
        href: "/docs/get-started#7-verify-acceptance-on-your-server",
        label: "Set up the client and read the guide",
      },
      samples: serverSamples(origin),
    },
    {
      title: "Or receive webhooks",
      body: "Stele can notify your server when an acceptance is recorded. Deliveries are signed: verify them over the raw body and ignore duplicate event IDs.",
      more: {
        href: "/docs/get-started#9-webhooks",
        label: "Handlers for Python, Java, Go, PHP, Ruby and C#",
      },
      samples: [WEBHOOK_SAMPLE],
    },
    {
      title: "Verify anything, independently",
      body: "Every acceptance can be checked against Solana without Stele: on the Verify page, with the stele-verify command, or with @stele/verifier in your code.",
      more: { href: "/docs/verification" },
      samples: [VERIFY_SAMPLE],
    },
  ];
}

const PATHS = [
  {
    title: "Website widget",
    use: "stele.js",
    best: "Sites that need a Terms acceptance step. No build tools.",
  },
  {
    title: "Bundled JavaScript & React",
    use: "@stele/sdk · @stele/sdk/react",
    best: "React, Next.js, Vite and other bundled apps.",
  },
  {
    title: "Your server, any language",
    use: "REST API · @stele/sdk/server",
    best: "Linking acceptances to your users, checking them, proofs and webhooks.",
  },
];

const ENDPOINTS = [
  ["POST", "/acceptance-sessions", "Link the next acceptance to your user", "acceptances:write"],
  [
    "GET",
    "/documents/by-slug/{slug}/latest",
    "The current version of a document",
    "documents:read",
  ],
  [
    "GET",
    "/acceptances",
    "Search acceptances by user, version, signer or date",
    "acceptances:read",
  ],
  ["GET", "/acceptances/{id}", "One acceptance, with its receipt URL", "acceptances:read"],
  ["POST", "/proof-requests", "A purchase, refund or consent to confirm", "proofs:write"],
  ["GET", "/public/acceptances/{id}/receipt", "A receipt, verified against Solana", "public"],
  ["GET", "/network", "Network, program ID and chain ID of this Stele app", "public"],
];

function Samples({ samples }: { samples: Sample[] }) {
  if (samples.length === 1) {
    const [only] = samples;
    return <CodeBlock code={only!.code} language={only!.language} placeholders={PLACEHOLDERS} />;
  }
  return <CodeTabs tabs={samples} placeholders={PLACEHOLDERS} />;
}

export default async function DevelopersPage() {
  const [origin, menu] = await Promise.all([siteOrigin(), getNetworkMenu()]);
  const baseUrl = `${origin}/api/v1`;
  const networks = menu
    ? menu.choices.map((c) => ({
        label: c.label,
        baseUrl: c.current ? baseUrl : c.url ? `${c.url}/api/v1` : null,
        current: c.current,
        test: c.test,
      }))
    : [{ label: "This Stele app", baseUrl, current: true, test: false }];

  return (
    <>
      <PageHero
        eyebrow="Developers"
        title="Verifiable acceptance on your site, in two lines."
        lead="Drop in the widget: it shows your Terms on your own page, checks them against Solana, lets the visitor sign with a wallet or a passkey and records the acceptance. Confirm it from your server, in the language you use."
      >
        <div className="flex flex-wrap gap-3">
          <Link href="/docs/get-started" className={buttonClasses("primary", "md")}>
            Get started
          </Link>
          <Link href="/docs/api" className={buttonClasses("secondary", "md")}>
            SDK &amp; API reference <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-8 inline-flex max-w-full items-center gap-3 rounded-xl border border-line bg-surface py-1.5 pl-4 pr-1.5">
          <span className="shrink-0 text-[12px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
            Base URL
          </span>
          <span className="truncate font-mono text-[13px] text-fg">{baseUrl}</span>
          <CopyButton value={baseUrl} label="Copy base URL" />
        </div>
      </PageHero>

      <Section>
        <SectionHeading eyebrow="Choose your integration" title="Start simple. Add more later." />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {PATHS.map((p) => (
            <div key={p.title} className="rounded-2xl border border-line bg-surface p-5">
              <p className="text-[15px] font-semibold text-fg">{p.title}</p>
              <p className="mt-1 font-mono text-[12px] text-accent">{p.use}</p>
              <p className="mt-3 text-[13.5px] leading-relaxed text-fg-muted">{p.best}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section className="border-t border-line">
        <SectionHeading eyebrow="Get started" title="From zero to a verifiable acceptance." />
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          The samples use this site&apos;s address. Server samples come in{" "}
          {LANGUAGES.join(", ").replace(/, (?=[^,]*$)/, " and ")}: pick yours once and every sample
          follows. Highlighted values such as{" "}
          <span className="rounded-[3px] bg-accent/10 px-1 font-mono text-[12.5px] text-accent underline decoration-accent/60 decoration-dashed underline-offset-[3px]">
            acme.com
          </span>{" "}
          are placeholders for your own.
        </p>
        <ol className="mt-12 space-y-12">
          {steps(origin).map((s, i) => (
            <li key={s.title} className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="font-mono text-[12px] text-accent">
                  {String(i + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.015em] text-fg">
                  {s.title}
                </h3>
                <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{s.body}</p>
                <Link
                  href={s.more.href}
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:text-accent-strong"
                >
                  {s.more.label ?? "Read the guide"} <ArrowRightIcon className="h-3.5 w-3.5" />
                </Link>
              </div>
              {s.samples ? (
                <div className="min-w-0">
                  <Samples samples={s.samples} />
                </div>
              ) : s.link ? (
                <div className="flex items-start">
                  <Link href={s.link.href} className={buttonClasses("secondary", "md")}>
                    {s.link.label} <ArrowRightIcon className="h-4 w-4" />
                  </Link>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </Section>

      <Section className="border-t border-line bg-bg-raised">
        <SectionHeading
          eyebrow="REST API"
          title="Small surface, explicit scopes."
          lead="API keys are for servers only: scoped, shown once, stored as hashes and revocable. They can never act on Solana: publishing always requires your organization's wallet."
        />

        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          {networks.map((n) => (
            <div
              key={n.label}
              className={cn(
                "rounded-2xl border p-4",
                n.current ? "border-accent-line bg-accent/5" : "border-line bg-surface",
              )}
            >
              <p className="flex items-center gap-2 text-[13.5px] font-medium text-fg">
                {n.label}
                {n.current && (
                  <span className="text-[12px] font-normal text-accent">this site</span>
                )}
                {n.test && (
                  <span className="text-[12px] font-normal text-fg-subtle">test network</span>
                )}
              </p>
              {n.baseUrl ? (
                <div className="mt-2 flex items-center gap-2">
                  <span className="min-w-0 truncate font-mono text-[12.5px] text-fg-muted">
                    {n.baseUrl}
                  </span>
                  <CopyButton value={n.baseUrl} label={`Copy the ${n.label} base URL`} />
                </div>
              ) : (
                <p className="mt-2 text-[12.5px] text-fg-subtle">Not available</p>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-fg-subtle">
          Each network has its own Stele app, API keys and data: build on a test network, then use
          the Mainnet base URL and key in production.
        </p>

        <div className="mt-8 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[720px] border-collapse text-left text-[13.5px]">
            <thead>
              <tr className="bg-surface-2 text-[12px] uppercase tracking-[0.06em] text-fg-subtle">
                <th scope="col" className="px-4 py-3 font-medium">
                  Method
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Path
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Purpose
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Auth
                </th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map(([m, p, d, a]) => (
                <tr key={`${m}${p}`} className="border-t border-line align-top">
                  <td className="px-4 py-3 font-mono text-[12px] text-accent">{m}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-fg">{p}</td>
                  <td className="px-4 py-3 text-fg-muted">{d}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-fg-subtle">{a}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[13px] text-fg-subtle">
          Paths are relative to the base URL. Every endpoint, with samples in eight languages:{" "}
          <Link href="/docs/api" className="text-accent hover:text-accent-strong">
            SDK &amp; API reference
          </Link>
          . OpenAPI:{" "}
          <a
            href={`${baseUrl}/openapi.json`}
            className="font-mono text-accent hover:text-accent-strong"
          >
            /api/v1/openapi.json
          </a>
          .
        </p>
      </Section>
    </>
  );
}
