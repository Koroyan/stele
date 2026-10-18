/** How checks turn into a verdict: notes inform, warnings warn, critical failures invalidate. */
import { describe, expect, it } from "vitest";
import { ReportBuilder } from "../src/report.js";

const builder = () => new ReportBuilder({ kind: "acceptance", reference: "test" });

describe("verdict", () => {
  it("is VALID when every check passes and the rest are notes", () => {
    const b = builder();
    b.pass("signature.ed25519", "Signature", "verifies");
    b.note("origin.attestation", "Requesting-site attestation", "stated by the requesting site");
    const r = b.build("solana:test");
    expect(r.verdict).toBe("VALID");
    expect(r.checks.find((c) => c.id === "origin.attestation")).toMatchObject({
      status: "note",
      critical: false,
    });
  });

  it("is VALID_WITH_WARNINGS on a warning, and INVALID on a critical failure", () => {
    const warned = builder();
    warned.pass("signature.ed25519", "Signature", "verifies");
    warned.warn("message.timing", "Recording time", "late");
    expect(warned.build("solana:test").verdict).toBe("VALID_WITH_WARNINGS");

    const failed = builder();
    failed.note("origin.attestation", "Requesting-site attestation", "stated");
    failed.fail("signature.ed25519", "Signature", "does not verify");
    expect(failed.build("solana:test").verdict).toBe("INVALID");
  });
});
