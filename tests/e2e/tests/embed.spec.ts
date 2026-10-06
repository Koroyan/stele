/**
 * Integrator embedding: another site loads `/sdk/v1/stele.js`, the widget verifies the agreement
 * against Solana, connects the visitor's wallet itself and records the acceptance, with the
 * integrator's hostname bound into the signed message.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { toBase58, toBase64, utf8 } from "@stele/protocol";
import { seedState } from "../fixtures/localnet";
import { connectThroughDialog, installTestWallet } from "../fixtures/wallet";

const state = seedState();
test.skip(!state, "requires a seeded localnet (pnpm localnet:seed)");

// The integrator's site: a real server on another origin. `*.localhost` resolves to loopback in
// browsers, so it may load the local Stele deployment (a public origin would be stopped by Private
// Network Access, which never applies between two public sites).
let partner: Server;
let partnerOrigin = "";
let partnerPage = "";
test.beforeAll(async () => {
  partner = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(partnerPage);
  });
  await new Promise<void>((resolve) => partner.listen(0, resolve));
  partnerOrigin = `http://shop.localhost:${(partner.address() as AddressInfo).port}`;
});
test.afterAll(() => new Promise<void>((resolve) => partner.close(() => resolve())));

function freshKeypair(): Uint8Array {
  const secret = ed25519.utils.randomSecretKey();
  const out = new Uint8Array(64);
  out.set(secret);
  out.set(ed25519.getPublicKey(secret), 32);
  return out;
}

test("a partner site embeds the agreement with one script tag and records an acceptance", async ({
  page,
  baseURL,
}) => {
  const wallet = await installTestWallet(page, freshKeypair());
  await page.addInitScript(() => {
    document.addEventListener("stele:accepted", (e) => {
      (window as unknown as { __accepted: unknown }).__accepted = (e as CustomEvent).detail;
    });
  });
  // All the integrator adds: one placeholder and one script tag.
  partnerPage = `<!doctype html><html lang="en"><head><title>Checkout · Shop</title></head><body>
<h1>Checkout</h1>
<div data-stele-organization="${state!.domain}" data-stele-document="terms-of-service"></div>
<script src="${baseURL}/sdk/v1/stele.js" defer></script>
</body></html>`;
  await page.goto(`${partnerOrigin}/checkout`);

  await expect(page.getByText("Text verified against Solana")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(`✓ ${state!.domain}`)).toBeVisible();
  await page.getByRole("button", { name: "Stele Test Wallet" }).click();
  const accept = page.getByRole("button", { name: "Accept & sign" });
  await expect(accept).toBeDisabled();
  await page.getByRole("checkbox", { name: /I have read and agree/ }).check();
  await accept.click();
  await expect(page.getByText("Accepted and recorded on Solana")).toBeVisible({
    timeout: 60_000,
  });

  const message = wallet.signedMessages.at(-1)!;
  expect(message.split("\n")[0]).toBe("Stele Protocol v1 - Accept Agreement");
  expect(message.split("\n").at(-1)).toBe("Requested by: shop.localhost");
  const detail = await page.waitForFunction(
    () => (window as unknown as { __accepted?: { acceptanceId: string } }).__accepted,
  );
  const { acceptanceId } = (await detail.jsonValue()) as { acceptanceId: string };
  await expect(page.getByRole("link", { name: "View receipt" })).toHaveAttribute(
    "href",
    `${baseURL}/receipt/${acceptanceId}`,
  );
});

test("accepting on the hosted page works while signed in to the dashboard", async ({
  page,
  baseURL,
}) => {
  // Sign in through the API in this browser context (session + CSRF cookies), as a dashboard user.
  const owner = freshKeypair();
  const address = toBase58(owner.slice(32));
  const headers = { origin: baseURL! };
  const challenge = await page.request.post("/api/v1/auth/challenge", {
    data: { address },
    headers,
  });
  const { message } = (await challenge.json()) as { message: string };
  const signed = await page.request.post("/api/v1/auth/verify", {
    data: {
      address,
      signedMessage: toBase64(utf8(message)),
      signature: toBase58(ed25519.sign(utf8(message), owner.slice(0, 32))),
    },
    headers,
  });
  expect(signed.ok()).toBe(true);
  expect((await page.request.get("/api/v1/auth/me")).ok()).toBe(true);

  // Public acceptance calls must not ride on that session (they would fail its CSRF check).
  await installTestWallet(page, freshKeypair());
  await page.goto(`/accept/${state!.domain}/terms-of-service`);
  await expect(page.getByText("Checked before display")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Connect wallet to accept" }).click();
  await connectThroughDialog(page);
  await page.getByRole("button", { name: "Accept & sign" }).click();
  await expect(page.getByText("Acceptance recorded on Solana")).toBeVisible({ timeout: 60_000 });
});
