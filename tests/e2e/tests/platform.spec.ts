/**
 * Stele as a customer of itself, end to end: its Terms are published with Stele and verified in the
 * browser, a new dashboard user accepts them with their wallet before anything else, the contact
 * form reaches Stele's inbox, and the AI assistant answers (against the mock OpenAI endpoint).
 * The Terms tests run when the deployment publishes them (`pnpm --filter @stele/localnet platform`).
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { expect, test } from "@playwright/test";
import { keypair, seedState } from "../fixtures/localnet";
import { connectThroughDialog, installTestWallet, signInToDashboard } from "../fixtures/wallet";

const API = process.env.API_URL ?? "http://localhost:4000";

async function platform(): Promise<{ terms: unknown; assistant: { enabled: boolean } } | null> {
  try {
    return (await (await fetch(`${API}/v1/public/platform`)).json()) as never;
  } catch {
    return null;
  }
}

function freshKey(): Uint8Array {
  const secret = ed25519.utils.randomSecretKey();
  const key = new Uint8Array(64);
  key.set(secret);
  key.set(ed25519.getPublicKey(secret), 32);
  return key;
}

test("Stele's Terms are published with Stele and verified in the browser", async ({ page }) => {
  test.skip(!(await platform())?.terms, "Stele's Terms are not published on this deployment");
  await page.goto("/terms");
  await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();
  await expect(
    page.getByText("Published with Stele and verified against Solana in your browser"),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("1. Who may use the Services")).toBeVisible();
  await page.goto("/docs/privacy-policy");
  await expect(page).toHaveURL(/\/privacy$/);
});

test("a new dashboard user accepts Stele's Terms with their wallet first", async ({ page }) => {
  test.skip(!seedState(), "requires a seeded localnet (pnpm localnet:seed)");
  test.skip(!(await platform())?.terms, "Stele's Terms are not published on this deployment");
  test.setTimeout(120_000);
  const wallet = await installTestWallet(page, freshKey());
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await connectThroughDialog(page);
  await page.getByRole("button", { name: "Sign in with this wallet" }).click();

  await expect(page.getByRole("heading", { name: "Stele's Terms of Service" })).toBeVisible({
    timeout: 30_000,
  });
  const accept = page.getByRole("button", { name: "Accept with my wallet" });
  await expect(accept).toBeDisabled();
  await page.getByRole("checkbox", { name: /I have read and accept/ }).check();
  await accept.click();
  await expect(page.getByRole("navigation", { name: "Dashboard" })).toBeVisible({
    timeout: 60_000,
  });
  // The wallet signed the Terms themselves: a Stele acceptance message naming them.
  expect(wallet.signedMessages.at(-1)).toContain("Stele Terms of Service");

  // Accepted once: the next sign-in goes straight to the dashboard.
  const me = await page.evaluate(async () => (await fetch("/api/v1/auth/me")).json());
  expect(me.terms).toMatchObject({ accepted: true });
});

test("a message from the contact form reaches Stele's inbox", async ({ page }) => {
  test.skip(!seedState(), "requires a seeded localnet (pnpm localnet:seed)");
  test.setTimeout(120_000);
  const company = `Partner ${Date.now() % 100000}`;
  await page.goto("/contact");
  await page.getByLabel("What is it about?").selectOption("partnership");
  await page.getByLabel("Your name").fill("Nino Beridze");
  await page.getByLabel("Work e-mail").fill("nino@example.com");
  await page.getByLabel("Organization").fill(company);
  await page.getByLabel("Message").fill("We want Stele Gate in our tokenized fund. Can we talk?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Thank you — message sent")).toBeVisible();

  // Stele's staff (the live demo owner in these tests) read it in the dashboard.
  await installTestWallet(page, keypair("live-demo-owner"));
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await connectThroughDialog(page);
  await signInToDashboard(page);
  const inbox = page.getByRole("navigation", { name: "Dashboard" }).getByRole("link", {
    name: "Inbox",
  });
  test.skip(!(await inbox.isVisible()), "the live demo owner is not in STELE_PLATFORM_ADMINS");
  await inbox.click();
  const card = page.getByRole("listitem").filter({ hasText: company });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("We want Stele Gate in our tokenized fund");
  await card.getByRole("button", { name: "Mark read" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: company })).toHaveCount(0);
});

test("the AI assistant answers on the website and knows the organization in the dashboard", async ({
  page,
}) => {
  test.skip(!(await platform())?.assistant.enabled, "the assistant is off on this deployment");
  await page.goto("/");
  await page.getByRole("button", { name: "Ask Stele AI" }).click();
  const panel = page.getByRole("dialog", { name: "Stele assistant" });
  await panel.getByRole("button", { name: "What is Stele, in two sentences?" }).click();
  await expect(panel).toContainText("Mock answer to: “What is Stele, in two sentences?”");
  await expect(panel.getByRole("link", { name: "Get started" })).toBeVisible();

  // In the dashboard, the answer uses the selected organization (its name comes back here).
  test.skip(!seedState(), "requires a seeded localnet (pnpm localnet:seed)");
  await installTestWallet(page, keypair("owner"));
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await connectThroughDialog(page);
  await signInToDashboard(page);
  await page.getByRole("button", { name: "Ask Stele AI" }).click();
  await panel.getByRole("button", { name: "New chat" }).click();
  await panel.getByLabel("Your question").fill("რა დავაყენო შემდეგ?");
  await panel.getByLabel("Your question").press("Enter");
  await expect(panel).toContainText("Mock answer to: “რა დავაყენო შემდეგ?”");
  await expect(panel).toContainText("Your organization: Acme");
});
