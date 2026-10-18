/**
 * A new organization from nothing, as a first-time user does it: a fresh wallet signs in, accepts
 * Stele's Terms (when published), is told its balance is too low before anything fails, gets test
 * SOL, and creates the organization on Solana.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { expect, test } from "@playwright/test";
import { seedState } from "../fixtures/localnet";
import { connectThroughDialog, installTestWallet, signInToDashboard } from "../fixtures/wallet";

test.skip(!seedState(), "requires a seeded localnet (pnpm localnet:seed)");

test("a first-time user creates an organization", async ({ page }) => {
  test.setTimeout(180_000);
  const secret = ed25519.utils.randomSecretKey();
  const key = new Uint8Array(64);
  key.set(secret);
  key.set(ed25519.getPublicKey(secret), 32);
  await installTestWallet(page, key);

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await connectThroughDialog(page);
  await signInToDashboard(page);
  await expect(
    page.getByRole("heading", { name: "Create your organization on Solana" }),
  ).toBeVisible();

  // An empty wallet is told so — and what to do — before it tries.
  await page.getByLabel("Organization name").fill(`Onboarding ${Date.now() % 100000}`);
  await expect(page.getByText(/Your wallet has 0 SOL/)).toBeVisible({ timeout: 20_000 });
  const create = page.getByRole("button", { name: "Create organization" });
  await expect(create).toBeDisabled();
  await page.getByRole("button", { name: "Get 2 test SOL" }).click();
  await expect(create).toBeEnabled({ timeout: 30_000 });

  await create.click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Organization created on Solana")).toBeVisible();
  await expect(page.getByText("Acceptances enabled")).toBeVisible();
});
