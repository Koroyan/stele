/**
 * Stele Gate for Solana apps: require the current acceptance of a policy before a protected action.
 *
 * ```ts
 * import { createSteleGate } from "@stelehq/sdk";
 *
 * const stele = createSteleGate({ apiBaseUrl: "https://stele.site/api", wallet });
 *
 * const signature = await stele.gate({
 *   policy: OFFERING_TERMS_POLICY, // the Stele policy address your program pins
 *   action: () => sendDepositTransaction(),
 *   acceptLabel: "Accept & Deposit",
 * });
 * ```
 *
 * The SDK is the user experience: it reads the policy and the wallet's AccessPass from Solana, shows
 * the embedded modal when the pass is missing or outdated, records the acceptance (which creates or
 * advances the pass on-chain), waits until the pass satisfies the policy, and then runs the original
 * action — in a second transaction (acceptance and action are not atomic). Enforcement is NOT here:
 * the protected program calls `stele_gate::require_current`, so a client that skips this SDK is
 * rejected on-chain.
 */
import {
  decodeAccessPass,
  decodeDocument,
  decodeGatePolicy,
  decodePassport,
  evaluateAccess,
  evaluatePassport,
  findAccessPassPda,
  findPassportPda,
  type AccessPassAccount,
  type AccessStatus,
  type GatePolicyAccount,
  type PassportAccount,
  type PassportEntry,
} from "@stelehq/protocol";
import { address } from "@solana/kit";
import { chainFromUrls } from "@stelehq/verifier";
import { acceptDocument, type AcceptanceResult, type MessageSigner } from "./accept";
import { SteleClient } from "./client";
import { IntegrityError, loadVerifiedDocument, type VerifiedDocument } from "./verified-document";

export type { AccessStatus } from "@stelehq/protocol";

/** The wallet's standing for a policy, read from Solana. */
export interface AccessCheck {
  status: AccessStatus;
  policy: string;
  policyAccount: GatePolicyAccount;
  holder: string;
  /** The wallet's per-document AccessPass address (Gate v2: `require_current`). */
  accessPass: string;
  pass: AccessPassAccount | null;
  /** The wallet's passport address (Gate v3: `require_current_passport`) and its entry. */
  passport: string;
  passportEntry: PassportEntry | null;
  /** Which account satisfies (or comes closest to satisfying) the policy, if any. */
  storage: "pass" | "passport" | null;
  /**
   * The account to pass to your protected instruction: the passport when it satisfies the policy
   * (or when nothing does yet), otherwise the AccessPass.
   */
  gateAccount: string;
  /** The version number the policy requires (a later accepted version also satisfies it). */
  requiredVersion: number;
  /** The policy's document, hash-verified against its on-chain fingerprint (what the modal shows). */
  document: VerifiedDocument;
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
    super("The terms were not accepted; the action did not run.");
    this.name = "GateCancelledError";
  }
}

/** Thrown when access is required and `ui: "none"`: show your own UI, then call `accept()`. */
export class AccessRequiredError extends Error {
  constructor(readonly access: AccessCheck) {
    super(
      access.status === "OUTDATED"
        ? "The terms changed: the new version must be accepted first."
        : "The terms must be accepted first.",
    );
    this.name = "AccessRequiredError";
  }
}

/** The terms changed while the user was reading; the modal reloads them. */
export class StaleTermsError extends Error {
  constructor() {
    super("The terms were updated while you were reading. Please review the new version.");
    this.name = "StaleTermsError";
  }
}

/** Renders the acceptance step. The default is the embedded Stele modal (`./gate-modal`). */
export interface GateUi {
  /**
   * Shows the terms and, when the user agrees, calls `accept` (which reports progress through
   * `onStatus`). Resolves `true` once access was granted, `false` if the user cancelled.
   */
  requestAcceptance(i: {
    access: AccessCheck;
    walletAddress: string;
    acceptLabel: string;
    accept: (onStatus: (s: GateStatus) => void) => Promise<AcceptanceResult>;
    /** Re-reads the terms (after a StaleTermsError). */
    reload: () => Promise<AccessCheck>;
  }): Promise<boolean>;
}

export interface SteleGateOptions {
  /** Stele API base URL, e.g. `https://stele.site/api`. */
  apiBaseUrl?: string;
  client?: SteleClient;
  /** The wallet that signs the protected transactions (Wallet Standard `signMessage`). */
  wallet?: MessageSigner | (() => MessageSigner | Promise<MessageSigner>);
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
  /** The Stele policy (its address) your program requires. */
  policy: string;
  /** The protected action: build, sign and send your program's transaction here. */
  action: () => T | Promise<T>;
  /** The wallet for this call (default: the one given to `createSteleGate`). */
  wallet?: MessageSigner;
  /** The modal's button, e.g. "Accept & Deposit". Default "Accept & Continue". */
  acceptLabel?: string;
}

export class SteleGate {
  readonly client: SteleClient;
  private readonly opts: SteleGateOptions;
  /** The most recent acceptance this gate recorded (its receipt: `/receipt/<acceptanceId>`). */
  lastAcceptance: AcceptanceResult | null = null;

  constructor(opts: SteleGateOptions) {
    if (!opts.client && !opts.apiBaseUrl)
      throw new Error("createSteleGate needs apiBaseUrl (or a SteleClient)");
    this.opts = opts;
    this.client = opts.client ?? new SteleClient({ apiBaseUrl: opts.apiBaseUrl! });
  }

  /** The wallet for a call: the one passed to the call, else the configured one. */
  async resolveWallet(override?: MessageSigner): Promise<MessageSigner> {
    const configured = this.opts.wallet;
    const w =
      override ?? (typeof configured === "function" ? await configured() : configured) ?? null;
    if (!w) throw new Error("Stele Gate needs the wallet that signs the protected transaction");
    if (w.signerType && w.signerType !== "wallet")
      throw new Error(
        "Stele Gate binds access to the wallet that signs the protected transaction: use a wallet signer",
      );
    return w;
  }

  /** Reads the policy, its document (hash-verified) and the wallet's AccessPass from Solana. */
  async check(policy: string, holder: string): Promise<AccessCheck> {
    const network = await this.client.getNetwork();
    if (this.opts.expected?.programId && network.programId !== this.opts.expected.programId)
      throw new IntegrityError(
        `The API advertises program ${network.programId}, but ${this.opts.expected.programId} is pinned.`,
      );
    const chain = chainFromUrls(
      this.opts.rpcUrls && this.opts.rpcUrls.length > 0 ? this.opts.rpcUrls : network.publicRpcUrls,
    );
    const [policyAcc] = await chain.getAccounts([policy], "confirmed");
    if (!policyAcc || policyAcc.owner !== network.programId)
      throw new IntegrityError(`The policy ${policy} was not found on-chain.`);
    const policyAccount = decodeGatePolicy(policyAcc.data);
    const [docAcc] = await chain.getAccounts([policyAccount.document], "confirmed");
    if (!docAcc || docAcc.owner !== network.programId)
      throw new IntegrityError("The policy's document was not found on-chain.");
    const document = await loadVerifiedDocument({
      client: this.client,
      organization: policyAccount.organization,
      document: decodeDocument(docAcc.data).slug,
      rpcUrls: this.opts.rpcUrls,
      expected: this.opts.expected,
    });
    const programAddress = address(network.programId);
    const [accessPass] = await findAccessPassPda(
      policyAccount.document,
      address(holder),
      programAddress,
    );
    const [passport] = await findPassportPda(address(holder), programAddress);
    const [acc, passportAcc] = await chain.getAccounts([accessPass, passport], "confirmed");
    // Only the Stele program can own an account at these addresses; anything else is "none".
    const pass =
      acc && acc.owner === network.programId && acc.data.length > 0
        ? decodeAccessPass(acc.data)
        : null;
    let passportAccount: PassportAccount | null = null;
    if (passportAcc && passportAcc.owner === network.programId && passportAcc.data.length > 0) {
      try {
        passportAccount = decodePassport(passportAcc.data);
      } catch {
        passportAccount = null;
      }
    }
    const byPass = evaluateAccess({
      policy: address(policy),
      policyAccount,
      holder: address(holder),
      accessPass,
      pass,
    });
    const byPassport = evaluatePassport({
      policyAccount,
      holder: address(holder),
      passport: passportAccount,
    });
    const rank = { MISSING: 0, OUTDATED: 1, VALID: 2 } as const;
    const passportFirst = rank[byPassport.status] >= rank[byPass.status];
    const status = passportFirst ? byPassport.status : byPass.status;
    return {
      status,
      policy,
      policyAccount,
      holder,
      accessPass,
      pass,
      passport,
      passportEntry: byPassport.entry,
      storage: status === "MISSING" ? null : passportFirst ? "passport" : "pass",
      gateAccount: passportFirst ? passport : accessPass,
      requiredVersion: byPass.requiredVersion,
      document,
    };
  }

  /**
   * Records the wallet's acceptance of the document's current version (the wallet signs the exact
   * text), then waits until the AccessPass on Solana satisfies the policy.
   */
  async accept(
    policy: string,
    wallet: MessageSigner,
    onStatus: (s: GateStatus) => void = () => undefined,
    verified?: VerifiedDocument,
  ): Promise<{ acceptance: AcceptanceResult; access: AccessCheck }> {
    const document = verified ?? (await this.check(policy, wallet.address)).document;
    let acceptance: AcceptanceResult;
    try {
      acceptance = await acceptDocument({
        client: this.client,
        verified: document,
        signer: wallet,
        requestDomain: this.requestDomain(),
        onStatus: (s) => {
          if (s === "awaiting-signature") onStatus("awaiting-signature");
          else if (s === "recording") onStatus("recording");
        },
      });
    } catch (e) {
      if (e instanceof IntegrityError && /newer version/i.test(e.message))
        throw new StaleTermsError();
      throw e;
    }
    this.lastAcceptance = acceptance;
    onStatus("confirming");
    const deadline = Date.now() + (this.opts.confirmTimeoutMs ?? 30_000);
    for (;;) {
      const access = await this.check(policy, wallet.address);
      if (access.status === "VALID") return { acceptance, access };
      if (Date.now() > deadline)
        throw new Error(
          "The acceptance was recorded, but it is not visible on Solana yet. Try again in a moment.",
        );
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }

  /**
   * Runs `action` once the wallet holds a pass that satisfies the policy, asking for acceptance
   * first if needed. Throws `GateCancelledError` if the user declines (the action never runs).
   */
  async gate<T>(request: GateRequest<T>): Promise<T> {
    const report = this.opts.onStatus ?? (() => undefined);
    report("checking");
    const wallet = await this.resolveWallet(request.wallet);
    const access = await this.check(request.policy, wallet.address);
    if (access.status !== "VALID") {
      report("access-required");
      const ui = await this.ui();
      if (!ui) throw new AccessRequiredError(access);
      let current = access;
      const granted = await ui.requestAcceptance({
        access,
        walletAddress: wallet.address,
        acceptLabel: request.acceptLabel ?? "Accept & Continue",
        accept: async (onStatus) => {
          const relay = (s: GateStatus) => {
            onStatus(s);
            report(s);
          };
          const { acceptance } = await this.accept(request.policy, wallet, relay, current.document);
          return acceptance;
        },
        reload: async () => {
          current = await this.check(request.policy, wallet.address);
          return current;
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

/** Creates a Stele Gate client. */
export function createSteleGate(opts: SteleGateOptions): SteleGate {
  return new SteleGate(opts);
}
