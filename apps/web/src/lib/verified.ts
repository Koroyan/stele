/**
 * Stele Verified, in the visitor's browser: the public verification of a protected program, and
 * the same three probes re-run directly against a Solana RPC so nobody has to trust Stele's word.
 */
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";
import type { PROBE_SCENARIOS } from "@stelehq/protocol";
import {
  findAccessPassPda,
  findPassportPda,
  probeInstruction,
  probePassed,
  steleCheckRefusal,
  type ProbeFill,
  type ProbeTemplate,
} from "@stelehq/protocol";
import type { NetworkInfo } from "@stelehq/sdk";
import { rpcFor } from "./chain";

export type ScenarioId = (typeof PROBE_SCENARIOS)[number]["id"];

export interface VerifiedView {
  program: string;
  network: { label: string; cluster: string };
  status: "verified" | "failed" | "incomplete" | "unverified";
  checkedAt: string | null;
  verifiedSince: string | null;
  organization: { name: string; address: string; domains: string[] };
  policy: string;
  document: { address: string; title: string; slug: string; requiredVersion: number };
  code: {
    codeHash: string | null;
    deployedSlot: number | null;
    upgradeAuthority: string | null;
    authorityKind: "immutable" | "program" | "key";
  } | null;
  ownership: { authority: string; signature: string; provenAt: string; current: boolean } | null;
  checks: {
    id: ScenarioId;
    outcome: "passed" | "failed" | "skipped";
    error: string | null;
    detail: string;
  }[];
  reason: string | null;
  recheck: { template: ProbeTemplate; holder: string | null } | null;
}

export interface BrowserCheck {
  id: ScenarioId;
  outcome: "passed" | "failed" | "skipped";
  /** The Stele check's refusal, or the other error that stopped the simulation. */
  error: string | null;
}

/** True when `host` is one of the organization's verified domains or a subdomain of one. */
export function isOrganizationHost(host: string, domains: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return domains.some((d) => {
    const domain = d.toLowerCase().replace(/^www\./, "");
    return h === domain || h.endsWith(`.${domain}`);
  });
}

/** Re-runs the three probes from this browser against the network's RPC (nothing is signed). */
export async function recheckInBrowser(
  network: NetworkInfo,
  view: VerifiedView,
): Promise<BrowserCheck[]> {
  if (!view.recheck) throw new Error("This program has no probe description to re-run.");
  const rpc = rpcFor(network);
  const { template, holder } = view.recheck;
  const program = address(view.program);
  const steleProgram = address(network.programId);
  const fillFor = async (user: Address): Promise<ProbeFill> => ({
    user,
    passport: (await findPassportPda(user, steleProgram))[0],
    accessPass: (await findAccessPassPda(address(view.document.address), user, steleProgram))[0],
    policy: address(view.policy),
  });
  const simulate = async (fill: ProbeFill) => {
    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      // Any funded account can pay for a simulation; nothing is signed or sent.
      (m) => setTransactionMessageFeePayer(address(network.relayer), m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions([probeInstruction(program, template, fill)], m),
    );
    const { value } = await rpc
      .simulateTransaction(getBase64EncodedWireTransaction(compileTransaction(message)), {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
      })
      .send();
    const logs = [...(value.logs ?? [])];
    const refusal = value.err === null ? null : steleCheckRefusal(logs);
    const other =
      value.err === null
        ? null
        : (logs.map((l) => /Error Code: (\w+)\./.exec(l)?.[1]).find(Boolean) ??
          logs.find((l) => / failed: /.test(l))?.replace(/^Program \w+ failed: /, "") ??
          "failed");
    return { refusal, error: refusal ?? other };
  };

  const stranger = await fillFor(
    getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32))),
  );
  const accepted = holder ? await fillFor(address(holder)) : null;
  const runs: [ScenarioId, ProbeFill | null][] = [
    ["refuses_without_acceptance", stranger],
    ["allows_with_acceptance", accepted],
    [
      "refuses_borrowed_passport",
      accepted
        ? { ...stranger, passport: accepted.passport, accessPass: accepted.accessPass }
        : null,
    ],
  ];
  const out: BrowserCheck[] = [];
  for (const [id, fill] of runs) {
    if (!fill) {
      out.push({ id, outcome: "skipped", error: null });
      continue;
    }
    const { refusal, error } = await simulate(fill);
    out.push({ id, outcome: probePassed(id, refusal) ? "passed" : "failed", error });
  }
  return out;
}
