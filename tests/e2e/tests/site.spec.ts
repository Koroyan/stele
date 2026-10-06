import { expect, test } from "@playwright/test";

const PAGES: { path: string; heading: string | RegExp }[] = [
  { path: "/", heading: "Prove what was agreed." },
  { path: "/product", heading: /Evidence infrastructure/ },
  { path: "/how-it-works", heading: /proof anyone can check/ },
  { path: "/security", heading: /Evidence you can check/ },
  { path: "/developers", heading: /Verifiable acceptance/ },
  { path: "/pricing", heading: /Pay for evidence/ },
  { path: "/docs", heading: "Stele documentation" },
  { path: "/docs/spec", heading: /Protocol/ },
  { path: "/docs/get-started", heading: "Get started" },
  { path: "/docs/api", heading: "SDK & API" },
  { path: "/docs/how-it-works", heading: "How Stele works" },
  { path: "/verify", heading: "Verify an agreement" },
];

test.describe("public site", () => {
  for (const p of PAGES) {
    test(`${p.path} renders under a strict CSP without errors or overflow`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(e.message));
      const res = await page.goto(p.path);
      expect(res?.status()).toBe(200);
      const headers = res!.headers();
      expect(headers["content-security-policy"]).toContain("'strict-dynamic'");
      expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(p.heading);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    });
  }

  // Scripts that trusted scripts insert at runtime need no nonce under 'strict-dynamic'; every script
  // tag in the server-rendered HTML must carry this response's nonce.
  test("every server-rendered script carries the response's nonce", async ({ request }) => {
    const res = await request.get("/");
    const nonce = /'nonce-([^']+)'/.exec(res.headers()["content-security-policy"]!)![1]!;
    const tags = (await res.text()).match(/<script(?:\s[^>]*)?>/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toContain(`nonce="${nonce}"`);
    // A fresh nonce per response.
    const again = /'nonce-([^']+)'/.exec(
      (await request.get("/")).headers()["content-security-policy"]!,
    )![1];
    expect(again).not.toBe(nonce);
  });

  test("documentation samples can be copied and show what to replace", async ({ page }) => {
    await page.goto("/docs/get-started");
    const blocks = page.locator(".doc-code");
    // Consecutive samples in several languages form one block with tabs and one Copy button.
    expect(await blocks.count()).toBeGreaterThan(8);
    for (const block of await blocks.all()) {
      // Blocks inside collapsed sections count too.
      await expect(block.getByRole("button", { name: /^Copy/, includeHidden: true })).toHaveCount(
        1,
      );
    }
    await expect(page.getByTitle("Placeholder: replace with your own value").first()).toBeVisible();
    await expect(page.getByRole("note").first()).toBeVisible(); // callouts
    await expect(page.getByRole("list", { name: "Flow" }).first()).toBeVisible();
  });

  test("code samples switch language everywhere, remember it, and use this app's address", async ({
    page,
  }) => {
    await page.goto("/docs/api");
    const origin = new URL(page.url()).origin;
    const setup = page.locator(".doc-code").filter({ has: page.getByRole("tab", { name: "C#" }) });
    const python = page.getByRole("tab", { name: "Python", exact: true });
    await python.first().click();
    // Every group that offers Python now shows it, and only its panel is visible.
    for (const tab of await python.all())
      await expect(tab).toHaveAttribute("aria-selected", "true");
    const panel = setup.first().getByRole("tabpanel");
    await expect(panel).toHaveCount(1);
    await expect(panel).toContainText(`BASE_URL = "${origin}/api/v1"`);

    // Arrow keys move between languages (and the choice follows).
    await python.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Java", exact: true }).first()).toBeFocused();
    await expect(setup.first().getByRole("tabpanel")).toContainText("public final class Stele");
    await page.keyboard.press("ArrowLeft");

    // Remembered across pages and reloads.
    await page.goto("/docs/get-started#7-verify-acceptance-on-your-server");
    await expect(page.getByRole("tab", { name: "Python", exact: true }).first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.goto("/developers");
    await expect(page.getByRole("tab", { name: "Python", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText(`${origin}/api/v1`).first()).toBeVisible();
  });

  // Operator documentation stays in the repository: it is neither routed nor linked publicly.
  test("internal operations documentation is not published", async ({ request }) => {
    for (const slug of ["deployment", "architecture", "threat-model-full"]) {
      expect((await request.get(`/docs/${slug}`)).status()).toBe(404);
    }
    const internal =
      /deployment|runbook|disaster recovery|secret[- ]manag|on-call|SECURITY_THREAT_MODEL|ARCHITECTURE\.md/i;
    const pages = ["/docs", "/docs/security", "/docs/threat-model", "/docs/storage"];
    for (const path of [...pages, "/developers", "/pricing", "/product", "/security"]) {
      const html = await (await request.get(path)).text();
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
      expect(
        links.filter((href) => internal.test(href)),
        path,
      ).toEqual([]);
      const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
      expect(text, path).not.toMatch(/runbook|disaster recovery|secret manager/i);
    }
  });
});
