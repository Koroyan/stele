/**
 * Stele Verified probes, shared by the API (which re-checks programs after every upgrade) and the
 * browser (which lets anyone re-check without trusting Stele): how a protected instruction is built
 * for one scenario, and how to tell that the Stele check — not something else — refused it.
 */
import { AccountRole, address, type Address, type Instruction } from "@solana/kit";
import { describeGateError } from "./gate";
import { fromHex } from "./encoding";

/** Who a probe account stands for; "address" is a fixed account. */
export type ProbeAccountRole = "user" | "passport" | "accessPass" | "policy" | "address";

/** The protected instruction, with placeholders filled per scenario. */
export interface ProbeTemplate {
  /** Instruction data, hex. */
  data: string;
  accounts: { role: ProbeAccountRole; address?: string; signer: boolean; writable: boolean }[];
}

export interface ProbeFill {
  user: Address;
  passport: Address;
  accessPass: Address;
  policy: Address;
}

/** The three scenarios a verified program must pass. */
export const PROBE_SCENARIOS = [
  {
    id: "refuses_without_acceptance",
    label: "A wallet that never accepted the terms is refused",
  },
  {
    id: "allows_with_acceptance",
    label: "A wallet that accepted the required version is let through",
  },
  {
    id: "refuses_borrowed_passport",
    label: "A wallet presenting someone else's acceptance is refused",
  },
] as const;

/** Builds the protected instruction for one scenario. */
export function probeInstruction(program: Address, t: ProbeTemplate, fill: ProbeFill): Instruction {
  return {
    programAddress: program,
    accounts: t.accounts.map((a) => ({
      address: a.role === "address" ? address(a.address!) : fill[a.role],
      role: a.signer
        ? a.writable
          ? AccountRole.WRITABLE_SIGNER
          : AccountRole.READONLY_SIGNER
        : a.writable
          ? AccountRole.WRITABLE
          : AccountRole.READONLY,
    })),
    data: fromHex(t.data),
  };
}

/** The Stele Gate checks' errors, by name (the stele-gate crate, or an inlined copy of it). */
export const STELE_CHECK_ERRORS = [
  "InvalidPolicy",
  "UserNotSigner",
  "AccessPassMissing",
  "AccessPassInvalid",
  "AccessPassMismatch",
  "AccessPassOutdated",
  "FingerprintMismatch",
] as const;

/**
 * The Stele check that refused a failed transaction, from its logs: a stele-gate error code
 * (7600–7606) or an Anchor error with a Stele check's name. Null when no Stele check refused it.
 */
export function steleCheckRefusal(logs: readonly string[]): string | null {
  for (const line of logs) {
    const custom = /^Program \w+ failed: custom program error: 0x([0-9a-f]+)/i.exec(line);
    if (custom) {
      const gate = describeGateError(Number.parseInt(custom[1]!, 16));
      if (gate) return gate.name;
    }
  }
  const anchor = logs.map((l) => /Error Code: (\w+)\./.exec(l)?.[1]).find(Boolean);
  return anchor && (STELE_CHECK_ERRORS as readonly string[]).includes(anchor) ? anchor : null;
}

/** Whether one scenario's simulation came out as a verified program requires. */
export function probePassed(
  scenario: (typeof PROBE_SCENARIOS)[number]["id"],
  refusal: string | null,
): boolean {
  if (scenario === "refuses_without_acceptance") return refusal === "AccessPassMissing";
  if (scenario === "allows_with_acceptance") return refusal === null;
  return (
    refusal === "AccessPassMismatch" ||
    refusal === "AccessPassInvalid" ||
    refusal === "AccessPassMissing"
  );
}
