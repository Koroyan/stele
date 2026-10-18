/**
 * Every dashboard page fits a 390px-wide screen. Measured in a desktop browser: an emulated phone
 * zooms out to fit a page that is too wide, which hides exactly what this test looks for.
 */
import { expect, test } from "@playwright/test";
import { keypair, seedState } from "../fixtures/localnet";
import { connectThroughDialog, installTestWallet, signInToDashboard } from "../fixtures/wallet";

test.skip(!seedState(), "requires a seeded localnet (pnpm localnet:seed)");

const ROUTES = [
  "/dashboard",
  "/dashboard/documents",
  "/dashboard/acceptances",
  "/dashboard/insights",
  "/dashboard/gate",
  "/dashboard/organization",
  "/dashboard/team",
  "/dashboard/api-keys",
  "/dashboard/integrations",
  "/dashboard/signing",
  "/dashboard/billing",
  "/dashboard/security",
  "/dashboard/audit-log",
];

test("every dashboard page fits a 390px-wide screen", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "measured in a desktop browser at 390px");
  test.setTimeout(300_000);
  await installTestWallet(page, keypair("owner"));
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await connectThroughDialog(page);
  await signInToDashboard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const problems: string[] = [];
  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    const wide = await page.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const out: string[] = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        const parent = el.parentElement?.getBoundingClientRect();
        if (r.width > 0 && r.right > W + 1 && !(parent && parent.right > W + 1)) {
          let clipped = false;
          for (let a = el.parentElement; a && a !== document.body; a = a.parentElement)
            if (getComputedStyle(a).overflowX !== "visible") clipped = true;
          if (!clipped) out.push(`${el.tagName} ${Math.round(r.right)}px`);
        }
      }
      return { scroll: document.documentElement.scrollWidth - W, out: out.slice(0, 3) };
    });
    if (wide.scroll > 0 || wide.out.length) problems.push(`${route}: ${JSON.stringify(wide)}`);
  }
  expect(problems).toEqual([]);
});
