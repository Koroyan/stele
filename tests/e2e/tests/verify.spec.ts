/** The in-browser verifier must confirm real evidence and never call forged evidence valid. */
import { expect, test } from "@playwright/test";
import { seedState } from "../fixtures/localnet";

const state = seedState();
test.skip(!state, "requires a seeded localnet (pnpm localnet:seed)");

test("verifies a recorded acceptance against Solana in the browser", async ({ page }) => {
  await page.goto(`/verify?tx=${state!.acceptances[0]!.signature}`);
  await expect(page.getByText("Valid evidence", { exact: false }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Exact message signed", { exact: true })).toBeVisible();
  await expect(page.getByText("Stele Protocol v1 - Accept Agreement")).toBeVisible();
});

test("a forged receipt is reported invalid", async ({ page, request }) => {
  const sig = state!.acceptances[0]!.signature;
  const { acceptanceId } = (await (
    await request.get(`/api/v1/public/transactions/${sig}/acceptance`)
  ).json()) as { acceptanceId: string };
  const { receipt } = (await (
    await request.get(`/api/v1/public/acceptances/${acceptanceId}/receipt`)
  ).json()) as { receipt: Record<string, Record<string, unknown>> };
  receipt.version!.title = "Forged Terms";

  await page.goto("/verify");
  await page.getByRole("tab", { name: "Receipt file" }).click();
  await page.getByLabel(/^Receipt \(stele-receipt-v1/).fill(JSON.stringify(receipt));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByText("Invalid — do not rely on this evidence")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Valid evidence", { exact: true })).toHaveCount(0);
});

test("an unknown transaction is never shown as valid", async ({ page }) => {
  await page.goto("/verify");
  await page.getByLabel("Transaction signature or acceptance ID").fill("5".repeat(87));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(
    page.getByText(/Invalid — do not rely|Inconclusive|could not run/).first(),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Valid evidence", { exact: true })).toHaveCount(0);
});
