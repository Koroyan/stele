/**
 * Signs in to the dashboard as the seeded localnet owner (injected test wallet) and captures each
 * dashboard page — for visual review and documentation.
 *
 *   pnpm --filter @stele/e2e exec tsx scripts/screenshot-dashboard.ts --out <dir>
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { keypair } from "../fixtures/localnet";
import { connectThroughDialog, installTestWallet } from "../fixtures/wallet";

const args = process.argv.slice(2).filter((a) => a !== "--");
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? args[outIndex + 1]! : "screenshots";
const base = process.env.BASE_URL ?? "http://localhost:3000";
const pages = [
  "/dashboard",
  "/dashboard/documents",
  "/dashboard/acceptances",
  "/dashboard/organization",
  "/dashboard/team",
  "/dashboard/api-keys",
  "/dashboard/integrations",
  "/dashboard/security",
  "/dashboard/audit-log",
];

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await installTestWallet(page, keypair("owner"));
await page.goto(`${base}/login`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Connect wallet" }).click();
await connectThroughDialog(page);
await page.getByRole("button", { name: "Sign in with this wallet" }).click();
await page.getByRole("heading", { name: "Overview" }).waitFor({ timeout: 30_000 });

for (const p of pages) {
  await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 1500));
  const file = path.join(out, `${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}.png`);
  await page.screenshot({ path: file, fullPage: process.env.FULL !== "0" });
  console.log(`saved ${file}`);
}

// A document detail page (first document in the list).
await page.goto(`${base}/dashboard/documents`, { waitUntil: "networkidle" });
await page.getByRole("link", { name: "Open" }).first().click();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(1500);
await page.screenshot({
  path: path.join(out, "dashboard_document.png"),
  fullPage: process.env.FULL !== "0",
});
console.log(`saved ${path.join(out, "dashboard_document.png")}`);
await browser.close();
