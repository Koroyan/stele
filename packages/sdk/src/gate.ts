/**
 * Stele Gate for Solana apps: require the current acceptance of a policy before a protected action.
 *
 * ```ts
 * import { createSteleGate } from "@stele/sdk";
 *
 * const stele = createSteleGate({ apiBaseUrl: "https://stele.example/api", wallet });
 * const riskPolicy = { organization: "acme.markets", document: "risk-disclosure" };
 *
 * const signature = await stele.gate({
 *   policy: riskPolicy,
 *   action: () => placeBet(), // runs only once the wallet holds a current access pass
 * });
 * ```
 *
 * The SDK is the user experience: it reads the wallet's access pass from Solana, shows the embedded
 * modal when the pass is missing or outdated, records the acceptance (which creates or advances the
 * pass on-chain), and then continues the original action. Enforcement is NOT here: the protected
 * Solana program checks the pass itself (`stele-gate` crate or the `check_access` CPI), so a client
 * that skips this SDK is rejected on-chain.
 */
import {
  decodeAccessPass,
  evaluateAccess,
  findAccessPassPda,
  type AccessPassAccount,
  type AccessStatus,
} from "@stele/protocol";
import { address } from "@solana/kit";
import { acceptDocument, type AcceptanceResult, type MessageSigner } from "./accept";
import { SteleClient } from "./client";
import { loadVerifiedDocument, type VerifiedDocument } from "./verified-document";

export type { AccessStatus } from "@stele/protocol";

/** A Stele policy: a document of an organization, and which of its versions is required. */
export interface GatePolicy {
  /** The organization's verified domain or its on-chain address. */
  organization: string;
  /** The policy document's slug, e.g. `risk-disclosure`. */
  document: string;
  /**
   * Must match what the protected program enforces. `0` / absent: the current version (every new
   * version requires a new acceptance). `n`: version `n` or later.
   */
  minVersion?: number;
}

/** The holder's standing for a policy, read from Solana. */
export interface AccessCheck {
  status: AccessStatus;
  holder: string;
  /** The access-pass account the protected program will read. */
  accessPass: string;
  pass: AccessPassAccount | null;
  /** The policy, hash-verified against its on-chain fingerprint (what the modal displays). */
  document: VerifiedDocument;
  requiredVersionNumber: number;
}

export type GateStatus =
  | "checking"
  | "access-required"
  | "awaiting-signature"
  | "recording"
  | "confirming"
  | "granted"
  | "continuing";

export class GateCancelledError extends Error {
  constructor() {
    super("The policy was not accepted; the action did not run.");
    this.name = "GateCancelledError";
  }
}

/** Thrown when access is required and `ui: "none"`: show your own UI, then call `accept()`. */
export class AccessRequiredError extends Error {
  constructor(readonly access: AccessCheck) {
    super(
      access.status === "OUTDATED"
        ? "The policy changed: the new version must be accepted first."
        : "The policy must be accepted first.",
    );
    this.name = "AccessRequiredError";
  }
}

/** Renders the acceptance step. The default is the embedded Stele modal (`./gate-modal`). */
export interface GateUi {
  /**
   * Shows the policy and, when the user agrees, calls `accept` (which reports progress through
   * `onStatus`). Resolves `true` once access was granted, `false` if the user cancelled.
   */
  requestAcceptance(i: {
    access: AccessCheck;
    walletAddress: string;
    accept: (onStatus: (s: GateStatus) => void) => Promise<AcceptanceResult>;
  }): Promise<boolean>;
}

export interface SteleGateOptions {
  /** Stele API base URL, e.g. `https://stele.example/api`. */
  apiBaseUrl?: string;
  client?: SteleClient;
  /** The wallet that signs the protected transactions (Wallet Standard `signMessage`). */
  wallet: MessageSigner | (() => MessageSigner | Promise<MessageSigner>);
  /** Solana RPC endpoints to read from (default: those the Stele API advertises). */
  rpcUrls?: string[];
  /** Pin the program and network; loading aborts if the API advertises anything else. */
  expected?: { programId?: string; chainId?: string };
  /** The site requesting acceptance (default: `location.hostname`). */
  requestDomain?: string;
  /** `"modal"` (default in browsers), `"none"` (throw AccessRequiredError) or a custom UI. */
  ui?: "modal" | "none" | GateUi;
  /** Theme of the default modal. */
  theme?: "auto" | "dark" | "light";
  onStatus?: (status: GateStatus) => void;
  /** How long to wait for the new pass to be visible on-chain after recording. Default 30 s. */
  confirmTimeoutMs?: number;
}

export interface GateRequest<T> {
  policy: GatePolicy;
  /** The protected action: build, sign and send your program's transaction here. */
  action: () => T | Promise<T>;
}

export class SteleGate {
  readonly client: SteleClient;
  private readonly opts: SteleGateOptions;

  constructor(opts: SteleGateOptions) {
    if (!opts.client && !opts.apiBaseUrl)
      throw new Error("createSteleGate needs apiBaseUrl (or a SteleClient)");
    this.opts = opts;
    this.client = opts.client ?? new SteleClient({ apiBaseUrl: opts.apiBaseUrl! });
  }

  private async wallet(): Promise<MessageSigner> {
    const w = typeof this.opts.wallet === "function" ? await this.opts.wallet() : this.opts.wallet;
    if (w.signerType && w.signerType !== "wallet")
      throw new Error(
        "Stele Gate binds access to the wallet that signs the protected transaction: use a wallet signer",
      );
    return w;
  }

  /** Reads the policy (hash-verified) and the wallet's access pass from Solana. */
  async check(policy: GatePolicy, holder?: string): Promise<AccessCheck> {
    const who = holder ?? (await this.wallet()).address;
    const document = await loadVerifiedDocument({
      client: this.client,
      organization: policy.organization,
      document: policy.document,
      rpcUrls: this.opts.rpcUrls,
      expected: this.opts.expected,
    });
    const programAddress = address(document.network.programId);
    const [accessPass] = await findAccessPassPda(
      address(document.documentAddress),
      address(who),
      programAddress,
    );
    const [acc] = await document.chain.getAccounts([accessPass], "confirmed");
    // Only the Stele program can own an account at this address; anything else is "no pass".
    const pass =
      acc && acc.owner === programAddress && acc.data.length > 0
        ? decodeAccessPass(acc.data)
        : null;
    const e = evaluateAccess({
      document: address(document.documentAddress),
      documentAccount: document.document,
      holder: address(who),
      accessPass,
      pass,
      requirement: { minVersion: policy.minVersion ?? 0 },
    });
    return {
      status: e.status,
      holder: who,
      accessPass,
      pass,
      document,
      requiredVersionNumber: e.requiredVersionNumber,
    };
  }

  /**
   * Records the wallet's acceptance of the policy's current version (the wallet signs the exact
   * text), then waits until the access pass on Solana satisfies the policy.
   */
  async accept(
    policy: GatePolicy,
    onStatus: (s: GateStatus) => void = () => undefined,
    verified?: VerifiedDocument,
  ): Promise<{ acceptance: AcceptanceResult; access: AccessCheck }> {
    const wallet = await this.wallet();
    const document = verified ?? (await this.check(policy, wallet.address)).document;
    const acceptance = await acceptDocument({
      client: this.client,
      verified: document,
      signer: wallet,
      requestDomain: this.requestDomain(),
      onStatus: (s) => {
        if (s === "awaiting-signature") onStatus("awaiting-signature");
        else if (s === "recording") onStatus("recording");
      },
    });
    onStatus("confirming");
    const deadline = Date.now() + (this.opts.confirmTimeoutMs ?? 30_000);
    for (;;) {
      const access = await this.check(policy, wallet.address);
      if (access.status === "VALID") return { acceptance, access };
      if (Date.now() > deadline)
        throw new Error(
          "The acceptance was recorded, but the access pass is not visible on Solana yet. Try again in a moment.",
        );
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }

  /**
   * Runs `action` once the wallet holds a pass that satisfies the policy, asking for acceptance
   * first if needed. Throws `GateCancelledError` if the user declines.
   */
  async gate<T>(request: GateRequest<T>): Promise<T> {
    const report = this.opts.onStatus ?? (() => undefined);
    report("checking");
    const wallet = await this.wallet();
    const access = await this.check(request.policy, wallet.address);
    if (access.status !== "VALID") {
      report("access-required");
      const ui = await this.ui();
      if (!ui) throw new AccessRequiredError(access);
      const granted = await ui.requestAcceptance({
        access,
        walletAddress: wallet.address,
        accept: async (onStatus) => {
          const relay = (s: GateStatus) => {
            onStatus(s);
            report(s);
          };
          const { acceptance } = await this.accept(request.policy, relay, access.document);
          return acceptance;
        },
      });
      if (!granted) throw new GateCancelledError();
    }
    report("granted");
    report("continuing");
    return request.action();
  }

  private requestDomain(): string {
    if (this.opts.requestDomain) return this.opts.requestDomain;
    if (typeof location !== "undefined") return location.hostname;
    throw new Error("requestDomain is required outside a browser");
  }

  private async ui(): Promise<GateUi | null> {
    const ui = this.opts.ui ?? (typeof document === "undefined" ? "none" : "modal");
    if (ui === "none") return null;
    if (ui === "modal") {
      const { gateModal } = await import("./gate-modal");
      return gateModal({ theme: this.opts.theme });
    }
    return ui;
  }
}

/** Creates a Stele Gate client for one wallet. */
export function createSteleGate(opts: SteleGateOptions): SteleGate {
  return new SteleGate(opts);
}
