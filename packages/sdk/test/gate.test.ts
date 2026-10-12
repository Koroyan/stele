/**
 * Stele Gate SDK orchestration: when the modal appears, when the action runs, and that a
 * cancellation never runs it. Chain reads are replaced by fixed AccessChecks (the requirement rule
 * itself is tested in @stelehq/protocol and on-chain in programs/stele/tests/gate.rs).
 */
import { describe, expect, it, vi } from "vitest";
import {
  AccessRequiredError,
  GateCancelledError,
  SteleGate,
  type AccessCheck,
  type AcceptanceResult,
  type GateUi,
  type MessageSigner,
} from "../src";

const POLICY = "8CWdKxyZH7QGKQJzKQjqJZVASmtW5sBDwy6xHzA3NX2F";
const wallet: MessageSigner = {
  address: "FFdgxv5a35vG1yuNuBqFyFYnfVdCBssDadmdszgmUtsf",
  signMessage: async () => new Uint8Array(64),
};

function access(status: AccessCheck["status"]): AccessCheck {
  return {
    status,
    policy: POLICY,
    holder: wallet.address,
    accessPass: "11111111111111111111111111111111",
    pass: null,
    requiredVersion: 2,
    policyAccount: {} as AccessCheck["policyAccount"],
    document: {} as AccessCheck["document"],
  };
}

const ACCEPTED = { acceptanceId: "ab".repeat(32) } as AcceptanceResult;

/** A gate whose chain reads return `states` in order, with a scripted UI. */
function gateWith(states: AccessCheck["status"][], ui: GateUi | "none") {
  const gate = new SteleGate({
    apiBaseUrl: "https://stele.test/api",
    wallet,
    ui,
    requestDomain: "app.test",
  });
  const queue = [...states];
  gate.check = vi.fn(async () => access(queue.length > 1 ? queue.shift()! : queue[0]!));
  gate.accept = vi.fn(async () => ({ acceptance: ACCEPTED, access: access("VALID") }));
  return gate;
}

function scriptedUi(decision: "accept" | "cancel") {
  const shown: AccessCheck[] = [];
  const ui: GateUi = {
    requestAcceptance: async ({ access, accept }) => {
      shown.push(access);
      if (decision === "cancel") return false;
      await accept(() => undefined);
      return true;
    },
  };
  return { ui, shown };
}

describe("stele.gate()", () => {
  it("runs the action without a modal when the pass is valid", async () => {
    const { ui, shown } = scriptedUi("accept");
    const gate = gateWith(["VALID"], ui);
    const action = vi.fn(async () => "deposit-signature");
    await expect(gate.gate({ policy: POLICY, action })).resolves.toBe("deposit-signature");
    expect(shown).toHaveLength(0);
    expect(action).toHaveBeenCalledOnce();
    expect(gate.accept).not.toHaveBeenCalled();
  });

  it("shows the modal when the pass is missing, then continues the action", async () => {
    const { ui, shown } = scriptedUi("accept");
    const gate = gateWith(["MISSING"], ui);
    const action = vi.fn(async () => "deposit-signature");
    await expect(gate.gate({ policy: POLICY, action })).resolves.toBe("deposit-signature");
    expect(shown.map((a) => a.status)).toEqual(["MISSING"]);
    expect(gate.accept).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledOnce();
  });

  it("shows the modal when the pass is outdated", async () => {
    const { ui, shown } = scriptedUi("accept");
    const gate = gateWith(["OUTDATED"], ui);
    const action = vi.fn(async () => 1);
    await gate.gate({ policy: POLICY, action });
    expect(shown.map((a) => a.status)).toEqual(["OUTDATED"]);
    expect(action).toHaveBeenCalledOnce();
  });

  it("never runs the action when the user cancels", async () => {
    const { ui } = scriptedUi("cancel");
    const gate = gateWith(["MISSING"], ui);
    const action = vi.fn(async () => 1);
    await expect(gate.gate({ policy: POLICY, action })).rejects.toBeInstanceOf(GateCancelledError);
    expect(action).not.toHaveBeenCalled();
    expect(gate.accept).not.toHaveBeenCalled();
  });

  it("never runs the action when recording the acceptance fails", async () => {
    const ui: GateUi = {
      requestAcceptance: async ({ accept }) => {
        await accept(() => undefined).catch(() => undefined);
        return false; // the modal shows the error; the user closes it
      },
    };
    const gate = gateWith(["MISSING"], ui);
    gate.accept = vi.fn(async () => {
      throw new Error("relay failed");
    });
    const action = vi.fn(async () => 1);
    await expect(gate.gate({ policy: POLICY, action })).rejects.toBeInstanceOf(GateCancelledError);
    expect(action).not.toHaveBeenCalled();
  });

  it("with ui: none, reports the requirement instead of continuing", async () => {
    const gate = gateWith(["OUTDATED"], "none");
    const action = vi.fn(async () => 1);
    const err = await gate.gate({ policy: POLICY, action }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccessRequiredError);
    expect((err as AccessRequiredError).access.status).toBe("OUTDATED");
    expect(action).not.toHaveBeenCalled();
  });

  it("refuses passkey signers: access binds to the wallet that signs the transaction", async () => {
    const { ui } = scriptedUi("accept");
    const gate = gateWith(["VALID"], ui);
    await expect(
      gate.gate({
        policy: POLICY,
        action: async () => 1,
        wallet: { ...wallet, signerType: "passkey_p256" },
      }),
    ).rejects.toThrow(/wallet signer/);
  });
});
