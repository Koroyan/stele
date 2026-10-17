/**
 * Billing: an owner buys credits from the dashboard. The wallet pays SOL straight to the treasury in
 * a real local-validator transaction; the API credits the purchase only after finding that payment
 * on-chain. Requires the API to run with STELE_TREASURY_ADDRESS set (the repository's .env).
 */
import { expect, test } from "@playwright/test";
import { keypair, seedState } from "../fixtures/localnet";
import { connectThroughDialog, signInToDashboard, installTestWallet } from "../fixtures/wallet";

const state = seedState();
test.skip(!state, "requires a seeded localnet (pnpm localnet:seed)");

async function balance(rpcUrl: string, address: string): Promise<number> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [address, { commitment: "confirmed" }],
    }),
  });
  return ((await res.json()) as { result: { value: number } }).result.value;
}

test("an owner buys credits with SOL paid on-chain to the treasury", async ({ page, request }) => {
  const billing = (await (await request.get("/api/v1/billing")).json()) as {
    enabled: boolean;
    treasury: string;
    packs: { credits: number; lamports: number }[];
  };
  test.skip(!billing.enabled, "billing is not enabled on this API (STELE_TREASURY_ADDRESS)");
  const pack = billing.packs[0]!;
  const before = await balance(state!.rpcUrl, billing.treasury);

  const wallet = await installTestWallet(page, keypair("owner"));
  await page.goto("/dashboard/billing");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await connectThroughDialog(page);
  await signInToDashboard(page);
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Free recordings used")).toBeVisible();
  await expect(page.getByText(billing.treasury).first()).toBeVisible();

  const credits = page
    .getByText("Credits", { exact: true })
    .locator("xpath=following-sibling::p[1]");
  const startCredits = Number((await credits.textContent())!.replace(/\D/g, ""));
  const pay = page.getByRole("button", { name: /^Pay / }).first();
  await pay.click();
  await expect(page.getByText(`${pack.credits.toLocaleString("en-US")} credits added`)).toBeVisible(
    {
      timeout: 90_000,
    },
  );
  expect(wallet.signedTransactions).toBeGreaterThan(0);
  await expect(credits).toHaveText((startCredits + pack.credits).toLocaleString("en-US"));
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();

  // The money is where the page says it went.
  expect(await balance(state!.rpcUrl, billing.treasury)).toBe(before + pack.lamports);
});
