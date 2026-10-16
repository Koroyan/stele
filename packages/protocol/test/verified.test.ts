/** Stele Verified probes: recognising the Stele check's refusals from transaction logs. */
import { describe, expect, it } from "vitest";
import { probePassed, steleCheckRefusal } from "../src";

describe("Stele Verified probes", () => {
  it("recognises the stele-gate crate's error codes", () => {
    expect(
      steleCheckRefusal(["Program Abc failed: custom program error: 0x1db2"]), // 7602
    ).toBe("AccessPassMissing");
    expect(steleCheckRefusal(["Program Abc failed: custom program error: 0x1db4"])).toBe(
      "AccessPassMismatch",
    );
  });

  it("recognises an inlined check by its Anchor error name, and nothing else", () => {
    expect(
      steleCheckRefusal([
        "Program log: AnchorError occurred. Error Code: AccessPassOutdated. Error Number: 6005. Error Message: x.",
      ]),
    ).toBe("AccessPassOutdated");
    expect(
      steleCheckRefusal([
        "Program log: AnchorError occurred. Error Code: InsufficientFunds. Error Number: 6001.",
        "Program Abc failed: custom program error: 0x1771",
      ]),
    ).toBeNull();
  });

  it("decides each scenario", () => {
    expect(probePassed("refuses_without_acceptance", "AccessPassMissing")).toBe(true);
    expect(probePassed("refuses_without_acceptance", null)).toBe(false);
    expect(probePassed("refuses_without_acceptance", "InvalidPolicy")).toBe(false);
    expect(probePassed("allows_with_acceptance", null)).toBe(true);
    expect(probePassed("allows_with_acceptance", "AccessPassOutdated")).toBe(false);
    expect(probePassed("refuses_borrowed_passport", "AccessPassMismatch")).toBe(true);
    expect(probePassed("refuses_borrowed_passport", null)).toBe(false);
  });
});
