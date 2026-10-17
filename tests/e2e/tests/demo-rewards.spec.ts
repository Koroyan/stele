/**
 * The Northwind demo shop's Rewards Club (Stele Gate) end to end with a wallet: the Stele Verified
 * badge, a direct deposit refused on-chain by the vault program, then "Accept & Deposit".
 * Runs only when the demo is set up and running (`pnpm localnet:demo`, `pnpm demo:shop`).
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { expect, test } from "@playwright/test";
import { installTestWallet } from "../fixtures/wallet";

const SHOP = "http://localhost:4300";

async function rewardsReady(): Promise<boolean> {
  try {
    const res = await fetch(`${SHOP}/rewards`);
    return res.ok && !(await res.text()).includes("Not set up");
  } catch {
    return false;
  }
}

test("a wallet is refused until it accepts the Rewards Club Terms, then deposits", async ({
  page,
}) => {
  test.skip(
    !(await rewardsReady()),
    "requires the demo shop (pnpm localnet:demo && pnpm demo:shop)",
  );
  test.setTimeout(180_000);
  // A brand-new wallet: it has accepted nothing, and holds no SOL (the shop pays the fee).
  const secret = ed25519.utils.randomSecretKey();
  const key = new Uint8Array(64);
  key.set(secret, 0);
  key.set(ed25519.getPublicKey(secret), 32);
  const wallet = await installTestWallet(page, key);

  await page.goto(SHOP);
  await page.getByPlaceholder("for example: nino").fill(`e2e ${Date.now() % 100000}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.goto(`${SHOP}/rewards`);
  await expect(
    page.getByRole("link", { name: /^Stele Verified: Terms enforced on-chain/ }),
  ).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Connect Stele Test Wallet" }).click();
  await expect(page.getByText("You have not accepted the Rewards Club Terms yet.")).toBeVisible({
    timeout: 30_000,
  });

  // Skipping Stele: the vault program itself refuses the deposit.
  await page.getByRole("button", { name: "Try without accepting (direct call)" }).click();
  await expect(
    page.getByText(/Refused on-chain by the vault program: AccessPassMissing/),
  ).toBeVisible({ timeout: 60_000 });

  // Accept & Deposit: the Stele window, a signed message (free), then the deposit.
  await page.getByRole("button", { name: "Deposit 25 points" }).click();
  await expect(page.getByRole("dialog")).toContainText("Rewards Club Terms", { timeout: 60_000 });
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page.getByRole("dialog").getByRole("button", { name: "Accept & Deposit" }).click();
  await expect(page.getByText(/Deposited 25 points/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/You accepted the Rewards Club Terms \(version 1\)/)).toBeVisible({
    timeout: 30_000,
  });
  expect(wallet.signedMessages.at(-1)).toContain("Rewards Club Terms");
  expect(wallet.signedTransactions).toBe(2);
});
