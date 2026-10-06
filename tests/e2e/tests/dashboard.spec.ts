/**
 * Dashboard: wallet sign-in, organization view, and the full publication flow — draft, canonical
 * preview, independent fingerprint recomputation, wallet-signed transaction and on-chain mirror.
 */
import { expect, test } from "@playwright/test";
import { keypair, seedState } from "../fixtures/localnet";
import { connectThroughDialog, installTestWallet } from "../fixtures/wallet";

const state = seedState();
test.skip(!state, "requires a seeded localnet (pnpm localnet:seed)");

test("the owner signs in and publishes a new version with a wallet-signed transaction", async ({
  page,
}) => {
  const wallet = await installTestWallet(page, keypair("owner"));

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await connectThroughDialog(page);
  await page.getByRole("button", { name: "Sign in with this wallet" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 30_000 });

  // The sign-in message names this site and states that it authorizes nothing else.
  const signIn = wallet.signedMessages.at(-1)!;
  expect(signIn).toMatch(/^localhost:3000 wants you to sign in with your Solana account:/);
  expect(signIn).toContain("does not accept any agreement and does not authorize any transaction");

  await page.getByRole("link", { name: "Documents", exact: true }).click();
  await page
    .getByRole("link", { name: /Terms of Service/ })
    .first()
    .click();
  await page.getByRole("button", { name: "New version" }).click();

  const label = `e2e-${Date.now() % 1_000_000}`;
  await page.getByLabel("Title").fill("Acme Terms of Service");
  await page.getByLabel("Version label").fill(label);
  await page
    .getByLabel("Document text")
    .fill(
      "# Terms\n\nThis version was published by an end-to-end test.\n\n- First clause\n- Second clause",
    );
  await expect(page.getByText("Canonical preview")).toBeVisible();
  await page.getByRole("button", { name: "Create draft" }).click();

  // The browser independently recomputes the publication before the wallet is asked to sign.
  await expect(page.getByText("Fingerprint you are about to sign")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Publication blocked")).toHaveCount(0);
  await page.getByRole("button", { name: "Sign & publish" }).click();
  await expect(page.getByText(`Version ${label} is published`)).toBeVisible({ timeout: 90_000 });
  expect(wallet.signedTransactions).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(`Version ${label}`).first()).toBeVisible();
});

test("sensitive actions require being signed in", async ({ page }) => {
  await page.goto("/dashboard/api-keys");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fapi-keys/);
});
