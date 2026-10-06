/** Hosted acceptance: verified display, exact signed message, receipt, and refusal on tampering. */
import { expect, test } from "@playwright/test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { seedState } from "../fixtures/localnet";
import { connectThroughDialog, installTestWallet } from "../fixtures/wallet";

const state = seedState();
test.skip(!state, "requires a seeded localnet (pnpm localnet:seed)");

/** A fresh user key: acceptances need no SOL (the relayer pays). */
function freshKeypair(): Uint8Array {
  const secret = ed25519.utils.randomSecretKey();
  const out = new Uint8Array(64);
  out.set(secret);
  out.set(ed25519.getPublicKey(secret), 32);
  return out;
}

test("a user reviews verified terms, signs the exact message and receives a verifiable receipt", async ({
  page,
}) => {
  const wallet = await installTestWallet(page, freshKeypair());
  await page.goto(`/accept/${state!.domain}/terms-of-service`);
  await expect(page.getByText("Checked before display")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(`Verified domain`).first()).toBeVisible();

  await page.getByRole("button", { name: "Connect wallet to accept" }).click();
  await connectThroughDialog(page);
  await page.getByRole("button", { name: "Accept & sign" }).click();
  await expect(page.getByText("Acceptance recorded on Solana")).toBeVisible({ timeout: 60_000 });

  const message = wallet.signedMessages.at(-1)!;
  const lines = message.split("\n");
  expect(lines[0]).toBe("Stele Protocol v1 - Accept Agreement");
  expect(lines[1]).toBe("I accept the exact document version below.");
  expect(message).toContain(`Organization: `);
  expect(message).toContain(`(verified: ${state!.domain})`);
  expect(message).toContain(`Account: ${wallet.address}`);
  expect(lines.at(-1)).toBe("Requested by: localhost");

  await page.getByRole("link", { name: "View verifiable receipt" }).click();
  await expect(page.getByText("Valid evidence", { exact: false }).first()).toBeVisible({
    timeout: 60_000,
  });
});

test("tampered document text is never displayed or offered for signing", async ({ page }) => {
  const wallet = await installTestWallet(page, freshKeypair());
  await page.route("**/api/v1/public/content/**", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace('"text":"', '"text":"Amended: ');
    await route.fulfill({ response, body });
  });
  await page.goto(`/accept/${state!.domain}/terms-of-service`);
  await expect(page.getByText("Do not accept this agreement")).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole("button", { name: /Accept & sign|Connect wallet to accept/ }),
  ).toHaveCount(0);
  expect(wallet.signedMessages).toHaveLength(0);
});

test("declining in the wallet records nothing", async ({ page }) => {
  const wallet = await installTestWallet(page, freshKeypair());
  await page.goto(`/accept/${state!.domain}/terms-of-service`);
  await page.getByRole("button", { name: "Connect wallet to accept" }).click();
  await connectThroughDialog(page);
  wallet.rejectNext = true;
  await page.getByRole("button", { name: "Accept & sign" }).click();
  await expect(
    page.getByText("You declined the signature request. Nothing was recorded."),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Acceptance recorded on Solana")).toHaveCount(0);
});
