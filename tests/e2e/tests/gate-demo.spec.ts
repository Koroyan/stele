import { expect, test, type Page } from "@playwright/test";

/**
 * The public Stele Gate demo against the real stack: a fresh policy and vault per session, the Stele
 * modal, real acceptances and real (relayed) deposits checked by the vault program's
 * require_current(). Needs the live demo configured (`pnpm --filter @stele/localnet live-demo`).
 */

// The transaction log (announced to screen readers), newest entry first.
const log = (page: Page) => page.locator('ul[aria-live="polite"] > li').first();
const pass = (page: Page) => page.locator("p", { hasText: /^Your passport$/ }).locator("xpath=..");
const next = (page: Page) =>
  page.getByRole("button", { name: /^(Next step|See the summary)/ }).click();

async function acceptInModal(page: Page, notice?: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(notice ?? "Text verified on Solana", { timeout: 60_000 });
  const accept = dialog.getByRole("button", { name: "Accept & Deposit" });
  await expect(accept).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await accept.click();
}

test.describe("Stele Gate demo", () => {
  test.setTimeout(300_000);

  test.beforeEach(async ({ page }) => {
    const status = await page.request.get("/api/v1/demo");
    test.skip(
      !status.ok() || !((await status.json()) as { available?: boolean }).available,
      "live demo not configured",
    );
  });

  test("the guided story: direct calls fail on-chain, accepting the current terms opens the vault", async ({
    page,
  }) => {
    await page.goto("/demo");
    await page.getByRole("button", { name: "Start the demo" }).click();
    await expect(page.getByText("Step 1 of 6")).toBeVisible({ timeout: 60_000 });
    await expect(pass(page)).toContainText("Missing", { timeout: 60_000 });

    // 1. Skipping the terms: the vault program itself refuses the deposit.
    await page.getByRole("button", { name: "Send the deposit directly" }).click();
    await expect(page.getByText("this wallet never accepted the terms").first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(log(page)).toContainText("Rejected · AccessPassMissing");
    await next(page);

    // 2. Through Stele: the modal shows the verified terms; accepting runs the deposit.
    await page.getByRole("button", { name: "Deposit 5,000 USDC" }).click();
    await acceptInModal(page);
    await expect(page.getByText("Accepted v1 and invested")).toBeVisible({ timeout: 90_000 });
    await expect(pass(page)).toContainText("Valid · v1", { timeout: 30_000 });
    await expect(page.getByText("5,000 USDC in · 1 deposit")).toBeVisible();
    await next(page);

    // 3. The issuer requires v2: the v1 entry no longer satisfies the policy. A finished step
    //    offers no second click.
    await page.getByRole("button", { name: "Publish & require v2 (as Atlas)" }).click();
    await expect(page.getByText("Version 2 is now required")).toBeVisible({ timeout: 60_000 });
    await expect(pass(page)).toContainText("Outdated · v1", { timeout: 60_000 });
    await expect(page.getByRole("button", { name: /Publish & require/ })).toHaveCount(0);
    await next(page);

    // 4. The old acceptance is refused on-chain.
    await page.getByRole("button", { name: "Send the deposit directly" }).click();
    await expect(page.getByText("the acceptance is out of date").first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(log(page)).toContainText("Rejected · AccessPassOutdated");
    await next(page);

    // 5. Through Stele again: the modal explains the update; accepting v2 restores access.
    await page.getByRole("button", { name: "Deposit 5,000 USDC" }).click();
    await acceptInModal(page, "This policy was updated");
    await expect(page.getByText("Accepted v2 and invested")).toBeVisible({ timeout: 90_000 });
    await expect(pass(page)).toContainText("Valid · v2", { timeout: 30_000 });
    await next(page);

    // 6. Another wallet presenting this passport is refused.
    await page.getByRole("button", { name: "Deposit from another wallet" }).click();
    await expect(page.getByText("that passport belongs to someone else").first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(log(page)).toContainText("Rejected · AccessPassMismatch");
    await next(page);

    // Summary: the acceptance behind the passport entry is an ordinary, verifiable Proof receipt.
    await expect(
      page.getByRole("heading", { name: "The frontend is optional. The program check is not." }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Open the receipt of your latest acceptance" }).click();
    await expect(page).toHaveURL(/\/receipt\/[0-9a-f]{64}/);
    await expect(page.getByText(/^Valid evidence/)).toBeVisible({ timeout: 60_000 });
  });

  test("free play: closing the terms runs nothing; a wallet that never accepted is refused", async ({
    page,
  }) => {
    await page.goto("/demo");
    await page.getByRole("button", { name: "Start the demo" }).click();
    await expect(page.getByText("Step 1 of 6")).toBeVisible({ timeout: 60_000 });

    await page.getByText("Free play — every control, in any order").click();
    await page.getByRole("button", { name: "Script: wallet that never accepted" }).click();
    await expect(log(page)).toContainText("Rejected · AccessPassMissing", { timeout: 60_000 });

    await page.getByRole("button", { name: "Deposit (through Stele)" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Text verified on Solana", { timeout: 60_000 });
    await dialog.getByText("Cancel", { exact: true }).click(); // the text button, not the × icon
    await expect(page.getByText("You closed the terms — nothing happened")).toBeVisible();
    await expect(pass(page)).toContainText("Missing");
  });
});
