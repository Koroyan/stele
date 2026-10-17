/**
 * Walletless signing in a real browser: a CDP virtual authenticator with user verification stands
 * in for Face ID / Windows Hello / a security key. No wallet is installed and no signer holds SOL.
 *
 *   - hosted acceptance with a NATIVE passkey (stele/2): the passkey's own P-256 key signs, nothing
 *     secret reaches browser storage, the receipt is stele-receipt/2 with browser-attested origin;
 *   - the embed widget on another site (passkey bound to that page's origin), receipt downloaded and
 *     re-verified by uploading it on /verify; an altered copy fails;
 *   - a purchase proof confirmed on the hosted /confirm page with a PRF-protected key (stele/1) and
 *     verified from its receipt;
 *   - without the PRF extension, native passkeys still sign (there is no key to unlock), while the
 *     PRF path is refused cleanly — never replaced by a server-held key.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { toBase58, toBase64, utf8 } from "@stelehq/protocol";
import { keypair, seedState } from "../fixtures/localnet";
import { connectThroughDialog, signInToDashboard, installTestWallet } from "../fixtures/wallet";

const state = seedState();
test.skip(!state, "requires a seeded localnet (pnpm localnet:seed)");

const API = "http://127.0.0.1:4000";
const APP = "http://localhost:3000";

/** Owner session against the API (cookie + CSRF), as the dashboard would have. */
async function ownerApi() {
  const kp = keypair("owner");
  const addr = toBase58(kp.slice(32));
  const headers = { "content-type": "application/json", origin: APP };
  const { message } = (await (
    await fetch(`${API}/v1/auth/challenge`, {
      method: "POST",
      headers,
      body: JSON.stringify({ address: addr }),
    })
  ).json()) as { message: string };
  const res = await fetch(`${API}/v1/auth/verify`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      address: addr,
      signedMessage: toBase64(utf8(message)),
      signature: toBase58(ed25519.sign(utf8(message), kp.slice(0, 32))),
    }),
  });
  if (!res.ok) throw new Error(`sign-in failed: ${await res.text()}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]!);
  const csrf = cookies.find((c) => c.startsWith("stele_csrf="))?.split("=")[1] ?? "";
  const session = { ...headers, cookie: cookies.join("; "), "x-csrf-token": csrf };
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: session,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
    return (await r.json()) as T;
  };
  const { organizations } = await call<{ organizations: { id: string; address: string }[] }>(
    "GET",
    "/v1/organizations",
  );
  const orgId = organizations.find((o) => o.address === state!.organization)!.id;
  return { call, orgId };
}

async function addAuthenticator(page: Page, opts: { prf: boolean }) {
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
      hasPrf: opts.prf,
    },
  });
  return cdp;
}

let owner: Awaited<ReturnType<typeof ownerApi>>;
test.beforeAll(async () => {
  owner = await ownerApi();
  await owner.call("PATCH", `/v1/organizations/${owner.orgId}/settings`, {
    signingPolicy: "WALLET_OR_PASSKEY",
  });
});

test("hosted acceptance with a native passkey: no wallet, no SOL, browser-attested evidence in the receipt", async ({
  page,
}) => {
  await addAuthenticator(page, { prf: true });
  await page.goto(`/accept/${state!.domain}/terms-of-service`);
  await expect(page.getByText("This text was hashed in your browser")).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("button", { name: "No wallet? Sign with a passkey instead" }).click();
  // Two prompts: create the passkey, then prove possession (its enrollment statement).
  await page.getByRole("button", { name: "Create a passkey to accept" }).click();
  await page.getByRole("button", { name: "Accept & sign" }).click({ timeout: 30_000 });
  await expect(page.getByText("Acceptance recorded on Solana")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Signed with\s+your passkey\./)).toBeVisible();
  await expect(page.getByText(/You paid nothing/)).toBeVisible();
  // Nothing secret exists to leak: browser storage holds only the non-secret hint.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).toMatch(/p256:0[23][0-9a-f]{64}/);
  expect(stored).not.toMatch(/wrapped|ciphertext|seed|prf|private/i);

  await page.getByRole("link", { name: "View verifiable receipt" }).click();
  await expect(page.getByText("Native passkey (ES256 · P-256)", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/attested by the browser/)).toBeVisible();
  await expect(page.getByText("Signer paid")).toBeVisible();
});

// ---- the embed widget on another site ----------------------------------------------------------

let partner: Server;
let partnerOrigin = "";
let partnerPage = "";
test.beforeAll(async () => {
  partner = createServer((_req, res) =>
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(partnerPage),
  );
  await new Promise<void>((resolve) => partner.listen(0, resolve));
  // Passkeys over plain http are allowed only on "localhost" itself: the partner is another port.
  partnerOrigin = `http://localhost:${(partner.address() as AddressInfo).port}`;
});
test.afterAll(() => new Promise<void>((resolve) => partner.close(() => resolve())));

test("the widget signs with a native passkey on the partner page; the downloaded receipt verifies on /verify", async ({
  page,
  baseURL,
}) => {
  await addAuthenticator(page, { prf: true });
  partnerPage = `<!doctype html><html lang="en"><head><title>Shop</title></head><body>
<div data-stele-organization="${state!.domain}" data-stele-document="terms-of-service"></div>
<script src="${baseURL}/sdk/v1/stele.js" defer></script></body></html>`;
  await page.goto(`${partnerOrigin}/checkout`);
  await expect(page.getByText("Text verified against Solana")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /Create a passkey/ }).click();
  await page.getByRole("checkbox").check({ timeout: 30_000 });
  await page.getByRole("button", { name: "Accept with passkey" }).click();
  await expect(page.getByText("Accepted and recorded on Solana")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/You paid nothing/)).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON" }).click();
  const file = await (await download).path();
  const receipt = JSON.parse(readFileSync(file, "utf8")) as {
    format: string;
    signer: { type: string };
    webauthn: { rpId: string };
    origin: { attestation: string; origin: string };
    acceptance: { requestDomain: string };
  };
  expect(receipt.format).toBe("stele-receipt/2");
  expect(receipt.signer.type).toBe("NATIVE_PASSKEY");
  expect(receipt.webauthn.rpId).toBe("localhost");
  // The browser attested the partner page's own origin.
  expect(receipt.origin).toMatchObject({ attestation: "BROWSER_ATTESTED", origin: partnerOrigin });

  // Anyone can verify the file — and an edited copy fails.
  await page.goto(`${baseURL}/verify`);
  await page.getByRole("tab", { name: "Receipt file" }).click();
  await page.locator("input[type=file]").setInputFiles(file);
  await page
    .getByRole("button", { name: /Verify/ })
    .first()
    .click();
  await expect(page.getByText(/Valid evidence/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Native passkey (ES256 · P-256)", { exact: true })).toBeVisible();
  const forged = { ...receipt, origin: { ...receipt.origin, origin: "https://evil.example" } };
  await page.locator("textarea#receipt").fill(JSON.stringify(forged));
  await page
    .getByRole("button", { name: /Verify/ })
    .first()
    .click();
  await expect(page.getByText("Invalid — do not rely on this evidence")).toBeVisible({
    timeout: 60_000,
  });
});

test("a purchase is confirmed with a passkey on the hosted page and its receipt verifies", async ({
  page,
  baseURL,
}) => {
  const { key } = await owner.call<{ key: string }>(
    "POST",
    `/v1/organizations/${owner.orgId}/api-keys`,
    {
      name: `e2e proofs ${Date.now()}`,
      scopes: ["proofs:write", "proofs:read"],
    },
  );
  const created = await fetch(`${API}/v1/proof-requests`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      type: "PURCHASE",
      reference: `e2e-order-${Date.now()}`,
      summary: "Purchase of 1 item from Acme",
      details: {
        currency: "USD",
        items: [{ name: "Notebook", quantity: 1, unitPrice: "9.50", total: "9.50" }],
        subtotal: "9.50",
        total: "9.50",
      },
    }),
  });
  expect(created.ok).toBe(true);
  const { confirmUrl } = (await created.json()) as { confirmUrl: string };

  await addAuthenticator(page, { prf: true });
  await page.goto(confirmUrl.replace("http://localhost:3000", baseURL!));
  await expect(page.getByText("Statement matches the hash you will sign")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Total: 9.50 USD")).toBeVisible();
  await page.getByRole("button", { name: /Create a passkey/ }).click();
  await page.getByRole("button", { name: "I saved it" }).click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Confirm & sign" }).click();
  await expect(page.getByText("Confirmed and recorded on Solana")).toBeVisible({ timeout: 60_000 });

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON" }).click();
  const file = await (await download).path();
  const receipt = JSON.parse(readFileSync(file, "utf8")) as {
    format: string;
    statement: { details: { total: string } };
  };
  expect(receipt.format).toBe("stele-proof-v1");

  await page.goto(`${baseURL}/verify`);
  await page.getByRole("tab", { name: "Receipt file" }).click();
  await page.locator("input[type=file]").setInputFiles(file);
  await page
    .getByRole("button", { name: /Verify/ })
    .first()
    .click();
  await expect(page.getByText(/Valid evidence/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Total: 9.50 USD")).toBeVisible();
  receipt.statement.details.total = "0.95";
  await page.locator("textarea#receipt").fill(JSON.stringify(receipt));
  await page
    .getByRole("button", { name: /Verify/ })
    .first()
    .click();
  await expect(page.getByText("Invalid — do not rely on this evidence")).toBeVisible({
    timeout: 60_000,
  });
});

test("without the PRF extension: native passkeys still sign; the PRF path is refused, never replaced by a server-held key", async ({
  page,
}) => {
  await addAuthenticator(page, { prf: false });
  // Native passkeys need no PRF: there is no key to unlock.
  await page.goto(`/accept/${state!.domain}/terms-of-service`);
  await expect(page.getByText("This text was hashed in your browser")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "No wallet? Sign with a passkey instead" }).click();
  await page.getByRole("button", { name: "Create a passkey to accept" }).click();
  await page.getByRole("button", { name: "Accept & sign" }).click({ timeout: 30_000 });
  await expect(page.getByText("Acceptance recorded on Solana")).toBeVisible({ timeout: 60_000 });

  // The PRF-protected key (used by the proof page) cannot be created without PRF.
  const { key } = await owner.call<{ key: string }>(
    "POST",
    `/v1/organizations/${owner.orgId}/api-keys`,
    { name: `e2e no-prf ${Date.now()}`, scopes: ["proofs:write"] },
  );
  const created = await fetch(`${API}/v1/proof-requests`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      type: "PURCHASE",
      reference: `e2e-no-prf-${Date.now()}`,
      summary: "Purchase of 1 item from Acme",
      details: {
        currency: "USD",
        items: [{ name: "Pen", quantity: 1, unitPrice: "1.00", total: "1.00" }],
        subtotal: "1.00",
        total: "1.00",
      },
    }),
  });
  expect(created.ok, await created.clone().text()).toBe(true);
  const { confirmUrl } = (await created.json()) as { confirmUrl: string };
  const context = await page.context().browser()!.newContext();
  const fresh = await context.newPage();
  await addAuthenticator(fresh, { prf: false });
  await fresh.goto(confirmUrl.replace("http://localhost:3000", APP));
  const create = fresh.getByRole("button", { name: /Create a passkey/ });
  const unavailable = fresh.getByText(/not available|unavailable/i).first();
  await expect(create.or(unavailable)).toBeVisible({ timeout: 60_000 });
  if (await create.isVisible()) {
    await create.click();
    await expect(fresh.getByText(/cannot protect a signing key|PRF/)).toBeVisible({
      timeout: 30_000,
    });
  }
  await expect(fresh.getByText("Confirmed and recorded on Solana")).toHaveCount(0);
  await context.close();
});

test("the dashboard shows signing methods, sponsorship and passkey signers", async ({ page }) => {
  await installTestWallet(page, keypair("owner"));
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await connectThroughDialog(page);
  await signInToDashboard(page);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "Signing & fees" }).click();
  await expect(page.getByRole("heading", { name: "Signing & fees" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Wallet or passkey/ })).toBeChecked();
  await expect(page.getByText("Who pays network fees")).toBeVisible();
  await expect(page.getByText("Deposit address").first()).toBeVisible({ timeout: 30_000 });
  // Signers registered by the tests above appear, with their passkeys.
  await expect(page.getByRole("heading", { name: "Passkey signers" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /active/ }).first()).toBeVisible({ timeout: 30_000 });
});
