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

test("a passkey signer the organization no longer knows is replaced, not a dead end", async ({
  page,
}) => {
  test.skip(!(await shopUp()), "requires the demo shop (pnpm localnet:demo && pnpm demo:shop)");
  test.setTimeout(180_000);
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
  // This browser remembers a passkey signer that the organization's records no longer contain
  // (a reset database, or a revoked signer).
  await page.addInitScript(() => {
    // A valid P-256 key (the curve's generator) that no organization has on record.
    const hint = JSON.stringify({
      publicKey: "p256:036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296",
      credentialId: "AAAAAAAAAAAAAAAAAAAAAA",
    });
    for (const org of ["northwind.test", "5b9tyU87fgPq3Rm5TVJyrayxN7Nhsf3cpYKWB9QW3kvU"])
      localStorage.setItem(`stele:native-passkey:http://localhost:3000/api:${org}:localhost`, hint);
  });
  await page.goto(SHOP);
  await page.getByPlaceholder("for example: nino").fill(`e2e ${Date.now() % 100000}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /Continue with your passkey/ }).click({ timeout: 60_000 });
  await expect(page.getByText("Signing with your passkey as")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Accept with passkey" }).click();
  await expect(
    page.getByText("This passkey is no longer registered with this organization"),
  ).toBeVisible({ timeout: 60_000 });
  // The way forward is offered right away: a new passkey, then the acceptance.
  await page.getByRole("button", { name: /Create a passkey/ }).click();
  await page.getByRole("checkbox").check({ timeout: 30_000 });
  await page.getByRole("button", { name: "Accept with passkey" }).click();
  await expect(page.getByText("Accepted and recorded on Solana")).toBeVisible({ timeout: 60_000 });
});

test("a purchase can be confirmed after the remembered Stele key was forgotten by the organization", async ({
  page,
}) => {
  test.skip(!(await shopUp()), "requires the demo shop (pnpm localnet:demo && pnpm demo:shop)");
  test.setTimeout(180_000);
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
  await expect(page.getByText("Text verified against Solana")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /Create a passkey/ }).click();
  await page.getByRole("checkbox").check({ timeout: 30_000 });
  await page.getByRole("button", { name: "Accept with passkey" }).click();
  await expect(page.getByText("Accepted and recorded on Solana")).toBeVisible({ timeout: 60_000 });

  // This browser remembers a Stele key the organization no longer has on record.
  await page.evaluate(() => {
    const hint = JSON.stringify({
      publicKey: "4L95dmjRqz5u9wXKXa6R5gH6rbsZxCQ6xqJJgXGWX4h1",
      credentialId: "AAAAAAAAAAAAAAAAAAAAAA",
    });
    for (const org of ["northwind.test", "5b9tyU87fgPq3Rm5TVJyrayxN7Nhsf3cpYKWB9QW3kvU"])
      localStorage.setItem(`stele:passkey-signer:http://localhost:3000/api:${org}:localhost`, hint);
  });
  await page.goto(`${SHOP}/checkout`);
  await page.getByRole("button", { name: "Place order" }).click();
  await page.getByRole("button", { name: /Continue with your passkey/ }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Confirm & sign" }).click();
  await expect(
    page.getByText("This passkey is no longer registered with this organization"),
  ).toBeVisible({ timeout: 60_000 });
  // The way forward: a new passkey-protected key, then the confirmation.
  await page.getByRole("button", { name: /Create a passkey/ }).click();
  await page.getByRole("button", { name: "I saved it" }).click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Confirm & sign" }).click();
  await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible({ timeout: 60_000 });
});
