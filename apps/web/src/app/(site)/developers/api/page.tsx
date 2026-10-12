import type { Metadata } from "next";
import { siteOrigin } from "@/lib/origin";
import { ApiExplorer } from "./api-explorer";

export const metadata: Metadata = {
  title: "API explorer",
  description:
    "Every Stele REST endpoint, grouped and described, with live requests and cURL — built from the API's OpenAPI document.",
};

export default async function ApiPage() {
  const origin = await siteOrigin();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-semibold tracking-[-0.025em] text-fg">API explorer</h1>
          <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-fg-muted">
            Every endpoint of this Stele app, with live requests. Base URL{" "}
            <code className="font-mono text-[13px] text-fg">{origin}/api</code>. Public endpoints
            need nothing; server endpoints need an API key from the dashboard.
          </p>
        </div>
        <a
          href="/api/v1/openapi.json"
          className="text-[13px] font-medium text-accent hover:text-accent-strong"
        >
          OpenAPI JSON ↗
        </a>
      </div>
      <ApiExplorer origin={origin} />
    </div>
  );
}
