/**
 * Stele Verified, end to end in the browser: an organization describes its protected instruction in
 * the dashboard and Stele verifies the deployed program (the Atlas demo vault on the local
 * validator); the public evidence page shows it and re-runs the probes in the visitor's browser;
 * the badge reads the live status.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { expect, test } from "@playwright/test";
import { GATE_DEMO_PROGRAM_ADDRESS, toBase58, utf8 } from "@stelehq/protocol";
import { keypair, seedState } from "../fixtures/localnet";
import { connectThroughDialog, installTestWallet } from "../fixtures/wallet";

const state = seedState();
test.skip(!state, "requires a seeded localnet (pnpm localnet:seed)");

const API = process.env.API_URL ?? "http://localhost:4000";
const ORIGIN = "http://localhost:3000";

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

test("an organization verifies its program; anyone can check the evidence and the badge", async ({
  page,
}) => {
  test.setTimeout(240_000);
  // A Gate document with its policy and a vault pinned to it (the live demo creates them), and one
  // wallet that accepted it — the "let through" probe needs an accepted wallet.
  const s = await call<{ organization: string; document: string; vault: string }>(
    "/v1/demo/sessions",
    { kind: "gate" },
  );
  const secret = ed25519.utils.randomSecretKey();
  const signer = toBase58(ed25519.getPublicKey(secret));
  const ch = await call<{ challengeId: string; clientBinding: string; message: string }>(
    "/v1/acceptance/challenges",
    { organization: s.organization, document: s.document, signer },
  );
  await call(`/v1/acceptance/challenges/${ch.challengeId}/submit`, {
    clientBinding: ch.clientBinding,
    signature: toBase58(ed25519.sign(utf8(ch.message), secret)),
  });

  // The demo organization's owner signs in and registers the vault for that document's policy.
  await installTestWallet(page, keypair("live-demo-owner"));
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await connectThroughDialog(page);
  await page.getByRole("button", { name: "Sign in with this wallet" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 30_000 });
  const sidebar = page.getByRole("navigation", { name: "Dashboard" });
  await sidebar.getByRole("link", { name: "Organization", exact: true }).click();
  const enable = page.getByRole("button", { name: "Enable Stele Gate" });
  const hide = page.getByRole("button", { name: "Hide Stele Gate" });
  await expect(enable.or(hide)).toBeVisible({ timeout: 30_000 });
  if (await enable.isVisible()) await enable.click();
  await expect(hide).toBeVisible({ timeout: 30_000 });

  const registered = await page.evaluate(
    async ({ document, program }) => {
      const csrf = /(?:^|;\s*)stele_csrf=([^;]+)/.exec(window.document.cookie)?.[1] ?? "";
      const headers = {
        "content-type": "application/json",
        "x-csrf-token": decodeURIComponent(csrf),
      };
      const { organizations } = (await (await fetch("/api/v1/organizations")).json()) as {
        organizations: { id: string }[];
      };
      for (const org of organizations) {
        const gate = (await (await fetch(`/api/v1/organizations/${org.id}/gate`)).json()) as {
          documents?: { id: string; address: string }[];
          programs?: { id: string; programAddress: string }[];
        };
        const doc = gate.documents?.find((d) => d.address === document);
        if (!doc) continue;
        // A fresh registration (an earlier run may have left one, with its own description).
        for (const p of gate.programs?.filter((x) => x.programAddress === program) ?? [])
          await fetch(`/api/v1/organizations/${org.id}/gate/programs/${p.id}`, {
            method: "DELETE",
            headers: { "x-csrf-token": headers["x-csrf-token"] },
          });
        const res = await fetch(`/api/v1/organizations/${org.id}/gate/programs`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            programAddress: program,
            label: "Atlas vault",
            action: "deposit_with_passport",
            policyDocumentId: doc.id,
          }),
        });
        return res.status;
      }
      return 0;
    },
    { document: s.document, program: GATE_DEMO_PROGRAM_ADDRESS },
  );
  expect(registered).toBe(200);

  // Describe the protected instruction: deposit_with_passport(amount = 1) with the vault fixed.
  await sidebar.getByRole("link", { name: "Verification", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verification", exact: true })).toBeVisible();
  await page.getByLabel("Instruction name").fill("deposit_with_passport");
  await page.getByLabel(/^Arguments/).fill("0100000000000000");
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Account 3 address").fill(s.vault);
  await page.locator("label", { hasText: "writable" }).nth(3).locator("input").check();
  // Move the vault (account 3) up to position 1: user, vault, policy, passport.
  await page.getByRole("button", { name: "Move up" }).nth(3).click();
  await page.getByRole("button", { name: "Move up" }).nth(2).click();
  await page.getByRole("button", { name: "Save and verify" }).click();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("A wallet that never accepted is refused")).toBeVisible();
  await expect(page.getByText("AccessPassMissing").first()).toBeVisible();

  // The public evidence, as a visitor sees it — then re-checked from this browser.
  await page.goto(`/verified/${GATE_DEMO_PROGRAM_ADDRESS}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("enforces its", {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Re-check in my browser" }).click();
  await expect(page.getByText(/^Your browser: same result/)).toHaveCount(3, { timeout: 60_000 });

  // The image badge says the same; the live badge refuses to vouch outside the verified domains.
  const svg = await (
    await fetch(`${API}/v1/public/verified/${GATE_DEMO_PROGRAM_ADDRESS}/badge.svg`)
  ).text();
  expect(svg).toContain("Stele Verified");
});
