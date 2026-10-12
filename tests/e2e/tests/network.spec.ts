/** The network switcher: each network is its own deployment; the switcher links between them. */
import { expect, test } from "@playwright/test";

test("a test network is labelled on every page and the switcher links to other networks", async ({
  page,
}) => {
  await page.goto("/docs/get-started");
  await expect(
    page.getByRole("note").filter({ hasText: "local development network" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Switch network/ }).click();
  const menu = page.getByRole("menu", { name: "Choose a network" });
  // The same page on the other deployment. Only Devnet and Mainnet are offered; the local
  // network appears only as this machine's current one.
  await expect(menu.getByRole("menuitem", { name: /Solana Devnet/ })).toHaveAttribute(
    "href",
    "https://devnet.app.stele.example/docs/get-started",
  );
  await expect(menu.getByRole("menuitem")).toHaveCount(3);
  await expect(menu.getByRole("menuitem", { name: /Testnet/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // Network-specific pages map to a safe entry point on the other network.
  await page.goto("/verify");
  await page.getByRole("button", { name: /Switch network/ }).click();
  await expect(
    page.getByRole("menu").getByRole("menuitem", { name: /Solana Mainnet/ }),
  ).toHaveAttribute("href", "https://app.stele.example/verify");
});
