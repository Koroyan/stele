/** The Stele Verified badge decides what to show from the public verification and the page's host. */
import { describe, expect, it } from "vitest";
import { badgeStateOf, badgeValidOn } from "../src/badge";

const view = (status: "verified" | "failed" | "incomplete", domains: string[]) => ({
  status,
  organization: { name: "Acme", domains },
  document: { title: "Terms", requiredVersion: 2 },
});

describe("Stele Verified badge", () => {
  it("is valid on the organization's verified domains and their subdomains only", () => {
    expect(badgeValidOn("acme.com", ["acme.com"])).toBe(true);
    expect(badgeValidOn("app.acme.com", ["acme.com"])).toBe(true);
    expect(badgeValidOn("acme.com", ["www.acme.com"])).toBe(true);
    expect(badgeValidOn("evil-acme.com", ["acme.com"])).toBe(false);
    expect(badgeValidOn("acme.com.evil.io", ["acme.com"])).toBe(false);
    expect(badgeValidOn("localhost", ["acme.com"])).toBe(true);
  });

  it("only says verified when the program is verified and the page is the organization's", () => {
    expect(badgeStateOf(view("verified", ["acme.com"]), "acme.com")).toBe("verified");
    expect(badgeStateOf(view("verified", ["acme.com"]), "evil.io")).toBe("elsewhere");
    expect(badgeStateOf(view("failed", ["acme.com"]), "acme.com")).toBe("failed");
    expect(badgeStateOf(view("incomplete", ["acme.com"]), "acme.com")).toBe("pending");
    expect(badgeStateOf(null, "acme.com")).toBe("unavailable");
  });
});
