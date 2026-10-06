/**
 * Captures full-page screenshots for visual review.
 *
 *   pnpm --filter @stele/e2e screenshot -- --out <dir> [--width 1440] [--mobile] /path1 /path2 …
 *
 * BASE_URL (default http://localhost:3000) selects the app; PW_CHANNEL=chrome|msedge drives an
 * installed browser instead of Playwright's bundled Chromium.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2).filter((a) => a !== "--");
let out = "screenshots";
let width = 1440;
let mobile = false;
const paths: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--out") out = args[++i]!;
  else if (a === "--width") width = Number(args[++i]);
  else if (a === "--mobile") mobile = true;
  else paths.push(a);
}

const base = process.env.BASE_URL ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const context = await browser.newContext(
  mobile
    ? {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      }
    : { viewport: { width, height: 900 } },
);
const page = await context.newPage();
const errors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`${page.url()}: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));

for (const p of paths.length ? paths : ["/"]) {
  await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 600));
  const file = path.join(
    out,
    `${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}${mobile ? "-mobile" : ""}.png`,
  );
  await page.screenshot({ path: file, fullPage: process.env.FULL !== "0" });
  console.log(`saved ${file}`);
}
await browser.close();
if (errors.length) {
  console.log("console errors:");
  for (const e of errors) console.log(`  ${e}`);
}
