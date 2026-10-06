/**
 * Browser end-to-end tests against the real stack: local validator (seeded with
 * `pnpm localnet:seed`), API and web app. Servers are started here unless already running.
 *
 *   pnpm test:e2e                      # dev servers, Playwright's Chromium
 *   PW_CHANNEL=msedge pnpm test:e2e    # an installed browser instead
 *   E2E_PRODUCTION=1 pnpm test:e2e     # the production builds (run `pnpm build` first); CI does this
 */
import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env.CI);
const PRODUCTION = CI || process.env.E2E_PRODUCTION === "1";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const NETWORKS =
  "localnet=http://localhost:3000,devnet=https://devnet.app.stele.example,testnet=,mainnet=https://app.stele.example";

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    channel: process.env.PW_CHANNEL || undefined,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL || undefined },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], channel: process.env.PW_CHANNEL || undefined },
      testMatch: /site\.spec\.ts/,
    },
  ],
  webServer: [
    {
      // The API bundle (dist/) or the TypeScript sources; both read the repository's .env.
      command: `pnpm --filter @stele/api run ${PRODUCTION ? "start" : "dev"}`,
      url: "http://127.0.0.1:4000/health",
      reuseExistingServer: !CI,
      timeout: 120_000,
      cwd: "../..",
    },
    {
      // The standalone server reads its listen address and the RPC endpoints allowed by the CSP
      // from the environment (HOSTNAME is often preset to the machine name, so it is set here).
      command: `pnpm --filter @stele/web run ${PRODUCTION ? "start" : "dev"}`,
      url: BASE_URL,
      reuseExistingServer: !CI,
      timeout: 180_000,
      cwd: "../..",
      env: {
        // Other networks are separate deployments; these addresses only need to look real.
        STELE_NETWORKS: NETWORKS,
        ...(PRODUCTION
          ? {
              PORT: new URL(BASE_URL).port || "3000",
              HOSTNAME: new URL(BASE_URL).hostname,
              PUBLIC_RPC_URLS: process.env.PUBLIC_RPC_URLS ?? "http://127.0.0.1:8899",
            }
          : {}),
      },
    },
  ],
});
