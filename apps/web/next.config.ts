import path from "node:path";
import type { NextConfig } from "next";

/** The API is reached through a same-origin rewrite so session cookies stay first-party. */
const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000").replace(
  /\/$/,
  "",
);
const REPO_ROOT = path.resolve(process.cwd(), "../..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  // Self-contained server for container images; STELE_STANDALONE=false skips it for local builds.
  output: process.env.STELE_STANDALONE === "false" ? undefined : "standalone",
  outputFileTracingRoot: REPO_ROOT,
  // Documentation pages read the repository's Markdown at request time from STELE_REPO_ROOT
  // (default: the monorepo root, or the standalone root, where scripts/prepare-standalone.mjs
  // copies docs/ and the root Markdown files after `next build`).
  turbopack: { root: REPO_ROOT },
  // The persistent dev cache can grow to hundreds of MB; STELE_NEXT_DEV_CACHE=false disables it.
  experimental: { turbopackFileSystemCacheForDev: process.env.STELE_NEXT_DEV_CACHE !== "false" },
  transpilePackages: ["@stele/ui", "@stele/protocol", "@stele/sdk", "@stele/verifier"],
  // The SDK's <script> build is loaded by integrators' sites: it must be embeddable cross-origin.
  async headers() {
    return [
      {
        source: "/sdk/:path*",
        headers: [
          { key: "access-control-allow-origin", value: "*" },
          { key: "cross-origin-resource-policy", value: "cross-origin" },
          { key: "x-content-type-options", value: "nosniff" },
          { key: "cache-control", value: "public, max-age=300, must-revalidate" },
        ],
      },
    ];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_INTERNAL_URL}/:path*` }];
  },
};

export default nextConfig;
