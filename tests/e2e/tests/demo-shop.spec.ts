/**
 * The Northwind demo shop end to end with passkeys (no wallet): accept the Terms with a native passkey
 * (stele/2), buy with a purchase proof signed by a PRF-protected key (proofs are stele/1) paid for
 * by the organization's sponsorship, see the signers on the security page.
 * Runs only when the demo is set up and running (`pnpm localnet:demo`, `pnpm demo:shop`).
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const SHOP = "http://localhost:4300";

async function shopUp(): Promise<boolean> {
  try {
    return (await fetch(SHOP)).ok;
  } catch {
    return false;
  }
}

test("a customer without a wallet accepts the Terms and confirms a purchase with a passkey", async ({
  page,
}) => {
  test.skip(!(await shopUp()), "requires the demo shop (pnpm localnet:demo && pnpm demo:shop)");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  });

  await page.goto(SHOP);
  await page.getByPlaceholder("for example: nino").fill(`e2e ${Date.now() % 100000}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/terms/);
  await expect(page.getByText("Text verified against Solana")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /Create a passkey/ }).click();
  await page.getByRole("checkbox").check({ timeout: 30_000 });
  await page.getByRole("button", { name: "Accept with passkey" }).click();
  await expect(page.getByText("Accepted and recorded on Solana")).toBeVisible({ timeout: 60_000 });
  // The signer's PDF certificate (rendered by the PDF service, the JSON receipt inside it).
  const [pdf] = await Promise.all([
    page.waitForEvent("download", { timeout: 90_000 }),
    page.getByRole("button", { name: "Download PDF" }).click(),
  ]);
  expect(pdf.suggestedFilename()).toMatch(/^stele-receipt-[0-9a-f]{16}\.pdf$/);
  expect(
    readFileSync(await pdf.path())
      .subarray(0, 5)
      .toString(),
  ).toBe("%PDF-");
  // Northwind sponsors fees on-chain.
  await expect(
    page.getByText("You paid nothing: the organization sponsored the network fee."),
  ).toBeVisible();

  await page.goto(`${SHOP}/checkout`);
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByText("Statement matches the hash you will sign")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Total: 30.00 EUR")).toBeVisible();
  // Proofs use a PRF-protected key: created here once (with its recovery kit).
  await page.getByRole("button", { name: /Create a passkey/ }).click();
  await page.getByRole("button", { name: "I saved it" }).click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Confirm & sign" }).click();
  await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Purchase proof")).toBeVisible();
  await expect(page.getByText(/\(passkey\)/)).toBeVisible();

  await page.goto(`${SHOP}/security`);
  await expect(page.getByRole("cell", { name: "active" })).toBeVisible();
});
