import { expect, test, type Page } from "@playwright/test";

/**
 * The public Stele Gate demo against the real stack: a fresh policy and vault per session, the Stele
 * modal, real acceptances and real (relayed) deposits checked by the vault program's
 * require_current(). Needs the live demo configured (`pnpm --filter @stele/localnet live-demo`).
 */

// The transaction log (announced to screen readers), newest entry first.
const log = (page: Page) => page.locator('ul[aria-live="polite"] > li').first();
const pass = (page: Page) =>
  page.locator("p", { hasText: /^Your AccessPass$/ }).locator("xpath=..");

test.describe("Stele Gate demo", () => {
  test.setTimeout(240_000);

  test("deposits need the current terms; direct calls fail on-chain", async ({ page }) => {
    const status = await page.request.get("/api/v1/demo");
    test.skip(
      !status.ok() || !((await status.json()) as { available?: boolean }).available,
      "live demo not configured",
    );

    await page.goto("/demo");
    await page.getByRole("button", { name: "Start the vault demo" }).click();
    await expect(pass(page)).toContainText("Missing", { timeout: 60_000 });

    // 1. A script deposit with no pass is rejected by the program.
    await page.getByRole("button", { name: "Script: wallet without a pass" }).click();
    await expect(log(page)).toContainText("Rejected · AccessPassMissing", { timeout: 60_000 });

    // 2. Through Stele: the modal shows the verified terms; accepting runs the deposit.
    await page.getByRole("button", { name: "Deposit (through Stele)" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Text verified on Solana", { timeout: 60_000 });
    const accept = dialog.getByRole("button", { name: "Accept & Deposit" });
    await expect(accept).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await accept.click();
    await expect(log(page)).toContainText("Deposit executed", { timeout: 90_000 });
    await expect(pass(page)).toContainText("Valid · v1", { timeout: 30_000 });

    // 3. Someone else presenting this pass is rejected.
    await page.getByRole("button", { name: "Script: reuse your pass from another wallet" }).click();
    await expect(log(page)).toContainText("Rejected · AccessPassMismatch", { timeout: 60_000 });

    // 4. The organization requires v2: the v1 pass no longer satisfies the policy.
    await page.getByRole("button", { name: /publish & require the next version/ }).click();
    await expect(pass(page)).toContainText("Outdated · v1", { timeout: 60_000 });
    await page.getByRole("button", { name: "Direct call (no SDK)" }).click();
    await expect(log(page)).toContainText("Rejected · AccessPassOutdated", { timeout: 60_000 });

    // 5. Through Stele again: the modal explains the update; accepting v2 restores access.
    await page.getByRole("button", { name: "Deposit (through Stele)" }).click();
    await expect(dialog).toContainText("This policy was updated", { timeout: 60_000 });
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Accept & Deposit" }).click();
    await expect(pass(page)).toContainText("Valid · v2", { timeout: 90_000 });

    // 6. The acceptance behind the pass is an ordinary, verifiable Proof receipt.
    await page.getByRole("link", { name: "Open the receipt of your latest acceptance" }).click();
    await expect(page).toHaveURL(/\/receipt\/[0-9a-f]{64}/);
    await expect(page.getByText(/^Valid evidence/)).toBeVisible({ timeout: 60_000 });
  });
});
