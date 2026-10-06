import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhook, WebhookVerificationError } from "../src/server";

const secret = "whsec_test_secret";
const body = JSON.stringify({
  id: "evt_1",
  type: "agreement.accepted",
  createdAt: "2026-09-28T00:00:00Z",
  organizationId: "o",
  data: { acceptanceId: "a" },
});
const sign = (t: number, b = body, s = secret) =>
  `t=${t},v1=${createHmac("sha256", s).update(`${t}.${b}`).digest("hex")}`;

describe("webhook verification", () => {
  it("accepts a fresh, correctly signed event", () => {
    const now = 1_790_000_000;
    expect(verifyWebhook(secret, sign(now), body, 300, now).type).toBe("agreement.accepted");
  });

  it("rejects tampered bodies, wrong secrets, replays and malformed headers", () => {
    const now = 1_790_000_000;
    expect(() => verifyWebhook(secret, sign(now), body.replace('"a"', '"b"'), 300, now)).toThrow(
      WebhookVerificationError,
    );
    expect(() => verifyWebhook(secret, sign(now, body, "whsec_other"), body, 300, now)).toThrow(
      /invalid signature/,
    );
    expect(() => verifyWebhook(secret, sign(now - 3600), body, 300, now)).toThrow(/tolerance/);
    expect(() => verifyWebhook(secret, undefined, body, 300, now)).toThrow(/missing/);
    expect(() => verifyWebhook(secret, "v1=abc", body, 300, now)).toThrow(/malformed/);
  });
});
