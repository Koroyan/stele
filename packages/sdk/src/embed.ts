/**
 * The acceptance widget: shows an agreement on the integrator's own site and records the visitor's
 * acceptance on Solana. Framework-free (plain DOM in a shadow root), so it works on any page; the
 * `<script>` build and the React component are thin wrappers around {@link mount}. {@link mountProof}
 * renders the same experience for a proof request (a purchase, a refund, a consent…).
 *
 * Visitors sign with a Solana wallet or — if the organization allows it — with a passkey (no
 * wallet, no seed phrase, no SOL). New passkey signers are native (stele/2): the passkey's own key
 * signs and never leaves the device. Existing PRF-protected Stele keys keep working. Either way the
 * visitor never pays the network fee.
 *
 * Security properties are those of the SDK: the text is displayed only after its SHA-256 matched the
 * on-chain commitment, the message is rebuilt from chain data before anything is signed, and all
 * text is inserted as text nodes (never as HTML).
 */
import { groupedFingerprint, verifiedDomainAt } from "@stele/protocol";
import { acceptDocument, type AcceptanceResult, type MessageSigner } from "./accept";
import { SteleClient, type SignerType, type SigningPolicy } from "./client";
import { NativePasskeySigner, identifyPasskeySigner, nativePasskeySupport } from "./native-passkey";
import {
  PasskeySigner,
  PasskeyUnsupportedError,
  isPasskeyCancel,
  passkeySigningSupport,
} from "./passkey";
import {
  confirmProof,
  loadProofRequest,
  type ProofResult,
  type VerifiedProofRequest,
} from "./proofs";
import { applyStyles, displayNotice, h, present, renderBlocks, type Child } from "./dom";
import { downloadJson, verificationLink } from "./receipts";
import { loadVerifiedDocument, type VerifiedDocument } from "./verified-document";
import { connectWallet, isUserRejection, watchWallets, type AvailableWallet } from "./wallets";

interface CommonOptions {
  /** Stele API base URL, e.g. `https://stele.example/api`. The script build fills this in. */
  apiBaseUrl?: string;
  /** Where receipts open, e.g. `https://stele.example`. The script build fills this in. */
  appUrl?: string;
  /** Bring your own signer (wallet, `NativePasskeySigner` or `PasskeySigner`) instead of the built-in picker. */
  signer?: MessageSigner | null;
  /** Links the record to a user of yours (created server-side with an API key). */
  sessionToken?: string | (() => Promise<string | undefined>);
  /** Offer to create a recovery kit when a visitor creates a passkey signer. Default: true. */
  offerRecoveryKit?: boolean;
  /** `auto` follows the visitor's system setting. Default: `auto`. */
  theme?: "auto" | "dark" | "light";
  onError?: (error: Error) => void;
}

export interface EmbedOptions extends CommonOptions {
  /** The organization's verified domain (e.g. `acme.com`) or its on-chain address. */
  organization: string;
  /** The document's slug, e.g. `terms-of-service`. */
  document: string;
  /** Solana RPC endpoints to verify against (default: those the Stele API advertises). */
  rpcUrls?: string[];
  /** Pin the program and network; loading aborts if the API advertises anything else. */
  expected?: { programId?: string; chainId?: string };
  onAccepted?: (result: AcceptanceResult) => void;
}

export interface ProofEmbedOptions extends CommonOptions {
  /** From your server's `POST /v1/proof-requests`. */
  requestId: string;
  /** The request's client token (lets this browser see and confirm the statement). */
  token: string;
  onConfirmed?: (result: ProofResult) => void;
}

export interface EmbedHandle {
  /** Removes the widget and stops listening for wallets. */
  destroy(): void;
}

const mounted = new WeakMap<Element, EmbedHandle>();

const CSS = `
:host { all: initial; display: block; color-scheme: dark;
  --_bg: var(--stele-bg, #0b1017); --_fg: var(--stele-fg, #e6edf5); --_muted: var(--stele-muted, #94a3b8);
  --_border: var(--stele-border, rgba(148,163,184,.18)); --_surface: var(--stele-surface, rgba(148,163,184,.06));
  --_accent: var(--stele-accent, #4cc9f0); --_on-accent: var(--stele-on-accent, #04121a);
  --_ok: var(--stele-verified, #34d399); --_warn: var(--stele-warning, #f5b544); --_danger: var(--stele-danger, #f87171);
  --_radius: var(--stele-radius, 14px);
  --_font: var(--stele-font, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); }
:host([data-theme="light"]) { color-scheme: light;
  --_bg: var(--stele-bg, #ffffff); --_fg: var(--stele-fg, #0f172a); --_muted: var(--stele-muted, #475569);
  --_border: var(--stele-border, rgba(15,23,42,.14)); --_surface: var(--stele-surface, rgba(15,23,42,.04));
  --_accent: var(--stele-accent, #0e7490); --_on-accent: var(--stele-on-accent, #ffffff);
  --_ok: var(--stele-verified, #047857); --_warn: var(--stele-warning, #b45309); --_danger: var(--stele-danger, #b91c1c); }
* { box-sizing: border-box; }
.root { background: var(--_bg); color: var(--_fg); border: 1px solid var(--_border); border-radius: var(--_radius);
  font: 14px/1.55 var(--_font); overflow: hidden; text-align: left; }
.pad { padding: 18px 20px; }
.head { border-bottom: 1px solid var(--_border); }
.org { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; font-weight: 600; }
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.badge.ok { color: var(--_ok); background: color-mix(in srgb, var(--_ok) 14%, transparent); }
.badge.warn { color: var(--_warn); background: color-mix(in srgb, var(--_warn) 14%, transparent); }
.title { margin: 8px 0 2px; font-size: 19px; font-weight: 700; letter-spacing: -.01em; }
.muted { color: var(--_muted); font-size: 12.5px; }
.text { max-height: var(--stele-text-height, 340px); overflow-y: auto; border-bottom: 1px solid var(--_border); }
.text:focus-visible { outline: 2px solid var(--_accent); outline-offset: -2px; }
.text h3 { margin: 16px 0 6px; font-size: 15px; } .text h3:first-child { margin-top: 0; }
.text p { margin: 0 0 10px; white-space: pre-wrap; } .text ul, .text ol { margin: 0 0 10px; padding-left: 22px; }
.lines { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.lines li:first-child { font-weight: 600; }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; font-size: 13px; }
.facts dt { color: var(--_muted); } .facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.check { color: var(--_ok); }
details { font-size: 12.5px; color: var(--_muted); margin-top: 10px; } summary { cursor: pointer; }
details li { margin: 4px 0; }
.action { display: grid; gap: 12px; border-top: 1px solid var(--_border); }
.wallets { display: grid; gap: 8px; }
.group { display: grid; gap: 8px; }
.label { font-size: 12px; font-weight: 600; color: var(--_muted); text-transform: uppercase; letter-spacing: .04em; }
button { font: inherit; cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: .55; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
.wallet { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 14px; border: 1px solid var(--_border);
  border-radius: 10px; background: var(--_surface); color: var(--_fg); font-weight: 600; text-align: left; }
.wallet:hover:not(:disabled) { border-color: var(--_accent); }
.wallet img { width: 24px; height: 24px; border-radius: 6px; }
.wallet .icon { width: 24px; height: 24px; display: inline-grid; place-items: center; border-radius: 6px;
  background: color-mix(in srgb, var(--_accent) 18%, transparent); color: var(--_accent); font-size: 14px; }
.wallet small { display: block; font-weight: 400; color: var(--_muted); font-size: 12px; }
.account { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; }
.link { background: none; border: 0; padding: 0; color: var(--_accent); font-weight: 600; }
.agree { display: flex; gap: 10px; align-items: flex-start; font-size: 13.5px; cursor: pointer; }
.agree input { margin-top: 3px; width: 16px; height: 16px; accent-color: var(--_accent); }
.primary { width: 100%; padding: 11px 18px; border: 0; border-radius: 10px; background: var(--_accent); color: var(--_on-accent);
  font-weight: 700; font-size: 14.5px; }
.secondary { padding: 8px 12px; border: 1px solid var(--_border); border-radius: 9px; background: var(--_surface);
  color: var(--_fg); font-weight: 600; font-size: 13px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; }
.field { width: 100%; padding: 9px 11px; border: 1px solid var(--_border); border-radius: 9px; background: var(--_surface);
  color: var(--_fg); font: 12.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.kit { padding: 12px; border-radius: 10px; border: 1px dashed var(--_warn); display: grid; gap: 8px; }
.kit code { font-size: 12.5px; overflow-wrap: anywhere; color: var(--_fg); }
.note { color: var(--_muted); font-size: 12px; }
.alert { padding: 10px 12px; border-radius: 10px; font-size: 13px; }
.alert.error { color: var(--_danger); background: color-mix(in srgb, var(--_danger) 10%, transparent); }
.done { padding: 14px; border-radius: 10px; background: color-mix(in srgb, var(--_ok) 10%, transparent); display: grid; gap: 8px; }
.done strong { color: var(--_ok); }
.done a { color: var(--_accent); font-weight: 600; }
.status { display: flex; align-items: center; gap: 10px; font-size: 13.5px; }
.spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--_border); border-top-color: var(--_accent);
  animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
`;

function shortAddress(a: string): string {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function effectiveText(effectiveAt: bigint): string {
  if (effectiveAt === 0n) return "Effective upon publication";
  return `Effective ${new Date(Number(effectiveAt) * 1000).toISOString().slice(0, 10)}`;
}

const allowsWallet = (p: SigningPolicy) => p === "WALLET_ONLY" || p === "WALLET_OR_PASSKEY";
const allowsPasskey = (p: SigningPolicy) => p !== "WALLET_ONLY";

/** Shadow-root host, theming and destroy bookkeeping shared by both widgets. */
function setup(target: string | Element, theme: "auto" | "dark" | "light" = "auto") {
  const host = typeof target === "string" ? document.querySelector(target) : target;
  if (!host) throw new Error(`Stele: no element matches ${String(target)}`);
  mounted.get(host)?.destroy();
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)");
  const applyTheme = () =>
    host.setAttribute(
      "data-theme",
      theme === "auto" ? (prefersLight?.matches ? "light" : "dark") : theme,
    );
  applyTheme();
  prefersLight?.addEventListener?.("change", applyTheme);
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  shadow.replaceChildren();
  applyStyles(shadow, CSS);
  const root = h("div", { class: "root", part: "root" });
  shadow.append(root);
  return {
    host,
    root,
    cleanup() {
      prefersLight?.removeEventListener?.("change", applyTheme);
      shadow.replaceChildren();
      mounted.delete(host);
    },
  };
}

const isPasskey = (t: SignerType | undefined) => t === "passkey" || t === "passkey_p256";

/**
 * The "how do you want to sign?" panel: passkey signer (create, continue, find on another device,
 * restore from a recovery kit) and/or wallets, according to the organization's policy. Acceptances
 * create native passkeys (stele/2); proofs keep the PRF-protected Stele key (stele/1), the only
 * passkey signer the proof instruction verifies today.
 */
class SignerPicker {
  signer: MessageSigner | null;
  wallets: AvailableWallet[] = [];
  connecting: string | null = null;
  passkeySupport: boolean | null = null;
  passkeyReason: string | undefined;
  remembered: NativePasskeySigner | PasskeySigner | null = null;
  restoring = false;
  recoveryKit: string | null = null;
  error: string | null = null;
  busy: string | null = null;

  constructor(
    private readonly ctx: {
      client: SteleClient;
      organization: string;
      policy: SigningPolicy;
      walletChain: string;
      networkLabel: string;
      options: CommonOptions;
      rerender: () => void;
      fail: (e: unknown) => Error;
      /** Create native passkeys (acceptances). Proofs need the PRF-protected key. */
      native: boolean;
    },
  ) {
    this.signer = ctx.options.signer ?? null;
    if (allowsPasskey(ctx.policy)) {
      const legacy = PasskeySigner.remembered(ctx.client, ctx.organization);
      this.remembered = ctx.native
        ? (NativePasskeySigner.remembered(ctx.client, ctx.organization) ?? legacy)
        : legacy;
      if (ctx.native) {
        const s = nativePasskeySupport();
        this.passkeySupport = s.supported;
        this.passkeyReason = s.reason;
      } else {
        void passkeySigningSupport().then((s) => {
          this.passkeySupport = s.supported;
          this.passkeyReason = s.reason;
          ctx.rerender();
        });
      }
    }
  }

  private async sessionToken(): Promise<string | undefined> {
    const t = this.ctx.options.sessionToken;
    return typeof t === "function" ? await t() : t;
  }

  private async run(label: string, work: () => Promise<void>) {
    this.error = null;
    this.busy = label;
    this.ctx.rerender();
    try {
      await work();
    } catch (e) {
      this.error = isPasskeyCancel(e)
        ? "The passkey prompt was dismissed. Nothing was changed."
        : e instanceof PasskeyUnsupportedError
          ? e.message
          : isUserRejection(e)
            ? "The request was declined in your wallet."
            : this.ctx.fail(e).message;
    } finally {
      this.busy = null;
      this.ctx.rerender();
    }
  }

  render(): Child[] {
    const { policy, options } = this.ctx;
    if (this.recoveryKit) return this.renderKit();
    if (this.signer) {
      const s = this.signer;
      return [
        h(
          "div",
          { class: "account" },
          h(
            "span",
            {},
            isPasskey(s.signerType) ? "Signing with your passkey as " : "Signing as ",
            h("span", { class: "mono", title: s.address }, shortAddress(s.address)),
            !isPasskey(s.signerType) && s.walletName ? ` · ${s.walletName}` : "",
          ),
          options.signer
            ? null
            : h(
                "button",
                {
                  type: "button",
                  class: "link",
                  disabled: Boolean(this.busy),
                  onclick: () => {
                    this.signer = null;
                    this.error = null;
                    this.ctx.rerender();
                  },
                },
                "Change",
              ),
        ),
      ];
    }
    const out: Child[] = [];
    if (this.busy) out.push(h("div", { class: "status" }, h("span", { class: "spin" }), this.busy));
    if (allowsPasskey(policy)) out.push(this.renderPasskey());
    if (allowsWallet(policy)) out.push(this.renderWallets(allowsPasskey(policy)));
    if (this.error) out.push(h("div", { class: "alert error", role: "alert" }, this.error));
    return out;
  }

  private renderPasskey(): HTMLElement {
    const { client, organization } = this.ctx;
    const disabled = Boolean(this.busy);
    if (this.passkeySupport === false)
      return h(
        "div",
        { class: "group" },
        h("div", { class: "label" }, "Passkey"),
        h(
          "div",
          { class: "note" },
          this.passkeyReason ?? "Passkeys are not available in this browser.",
        ),
      );
    const items: Child[] = [h("div", { class: "label" }, "Sign with a passkey — no wallet needed")];
    if (this.remembered) {
      const r = this.remembered;
      items.push(
        h(
          "button",
          {
            type: "button",
            class: "wallet",
            disabled,
            onclick: () => ((this.signer = r), this.ctx.rerender()),
          },
          h("span", { class: "icon", "aria-hidden": "true" }, "🔑"),
          h(
            "span",
            {},
            "Continue with your passkey",
            h("small", {}, `Signer ${shortAddress(r.address)}`),
          ),
        ),
      );
    } else {
      items.push(
        h(
          "button",
          {
            type: "button",
            class: "wallet",
            disabled,
            onclick: () =>
              void this.run("Follow your device's passkey prompts…", async () => {
                if (this.ctx.native) {
                  const signer = await NativePasskeySigner.register({
                    client,
                    organization,
                    sessionToken: await this.sessionToken(),
                  });
                  this.remembered = signer;
                  this.signer = signer;
                  return;
                }
                const reg = await PasskeySigner.register({
                  client,
                  organization,
                  sessionToken: await this.sessionToken(),
                  recoveryKit: this.ctx.options.offerRecoveryKit !== false,
                });
                this.remembered = reg.signer;
                this.signer = reg.signer;
                this.recoveryKit = reg.recoveryKit;
              }),
          },
          h("span", { class: "icon", "aria-hidden": "true" }, "＋"),
          h(
            "span",
            {},
            "Create a passkey",
            h(
              "small",
              {},
              this.ctx.native
                ? "Face, fingerprint or device PIN. The passkey's private key never leaves your device."
                : "Face, fingerprint or device PIN. Your key never leaves this device unencrypted.",
            ),
          ),
        ),
        h(
          "div",
          { class: "row" },
          h(
            "button",
            {
              type: "button",
              class: "link",
              disabled,
              onclick: () =>
                void this.run("Choose your passkey…", async () => {
                  this.signer = this.remembered = this.ctx.native
                    ? await identifyPasskeySigner({ client, organization })
                    : await PasskeySigner.identify({ client, organization });
                }),
            },
            "I already have a passkey here",
          ),
          h("span", { class: "muted" }, "·"),
          h(
            "button",
            {
              type: "button",
              class: "link",
              disabled,
              onclick: () => ((this.restoring = !this.restoring), this.ctx.rerender()),
            },
            "Restore with a recovery kit",
          ),
        ),
      );
      if (this.restoring) {
        const input = h("input", {
          class: "field",
          placeholder: "stele-rk1-…",
          "aria-label": "Recovery kit",
          autocomplete: "off",
          spellcheck: "false",
        }) as HTMLInputElement;
        items.push(
          input,
          h(
            "button",
            {
              type: "button",
              class: "secondary",
              disabled,
              onclick: () =>
                void this.run(
                  "Unlocking your key and creating a passkey on this device…",
                  async () => {
                    this.signer = this.remembered = await PasskeySigner.recover({
                      client,
                      organization,
                      recoveryKit: input.value,
                    });
                    this.restoring = false;
                  },
                ),
            },
            "Restore",
          ),
        );
      }
    }
    return h("div", { class: "group" }, ...present(items));
  }

  private renderWallets(withHeading: boolean): HTMLElement {
    const items: Child[] = [];
    if (withHeading) items.push(h("div", { class: "label" }, "Or use a Solana wallet"));
    if (this.wallets.length === 0) {
      items.push(
        h(
          "div",
          { class: "note" },
          `No compatible wallet was found in this browser. Install a Solana wallet that supports ${this.ctx.networkLabel} (for example Phantom, Solflare or Backpack), then reload this page.`,
        ),
      );
    } else {
      if (!withHeading) items.push(h("div", { class: "muted" }, "Connect a wallet to continue"));
      items.push(
        h(
          "div",
          { class: "wallets" },
          ...this.wallets.map((w) =>
            h(
              "button",
              {
                type: "button",
                class: "wallet",
                disabled: this.connecting !== null || Boolean(this.busy),
                onclick: () => void this.connect(w),
              },
              h("img", {
                src: w.icon,
                alt: "",
                onerror: (e: Event) => (e.target as Element).remove(),
              }),
              this.connecting === w.name ? `Connecting ${w.name}…` : w.name,
            ),
          ),
        ),
      );
    }
    return h("div", { class: "group" }, ...present(items));
  }

  private renderKit(): Child[] {
    const kit = this.recoveryKit!;
    return [
      h(
        "div",
        { class: "kit", role: "status" },
        h("strong", {}, "Save your recovery kit"),
        h(
          "div",
          { class: "note" },
          "If you lose every device with this passkey, this kit is the only way to keep using the same signing key. It is shown once; Stele does not have it.",
        ),
        h("code", { class: "mono" }, kit),
        h(
          "div",
          { class: "row" },
          h(
            "button",
            {
              type: "button",
              class: "secondary",
              onclick: () =>
                downloadJson("stele-recovery-kit.json", {
                  format: "stele-recovery-kit-v1",
                  organization: this.ctx.organization,
                  signer: this.signer?.address,
                  recoveryKit: kit,
                }),
            },
            "Download",
          ),
          h(
            "button",
            {
              type: "button",
              class: "secondary",
              onclick: () => void navigator.clipboard?.writeText(kit),
            },
            "Copy",
          ),
          h(
            "button",
            {
              type: "button",
              class: "primary",
              style: "width:auto",
              onclick: () => ((this.recoveryKit = null), this.ctx.rerender()),
            },
            "I saved it",
          ),
        ),
      ),
    ];
  }

  private async connect(wallet: AvailableWallet) {
    this.connecting = wallet.name;
    this.error = null;
    this.ctx.rerender();
    try {
      this.signer = await connectWallet(wallet, this.ctx.walletChain);
    } catch (e) {
      this.error = isUserRejection(e)
        ? "The connection request was declined in your wallet."
        : this.ctx.fail(e).message;
    } finally {
      this.connecting = null;
      this.ctx.rerender();
    }
  }
}

function feeLine(fee: { sponsor: "stele" | "organization" } | null | undefined): string {
  if (!fee) return "You paid nothing: the network fee was sponsored.";
  return fee.sponsor === "organization"
    ? "You paid nothing: the organization sponsored the network fee."
    : "You paid nothing: Stele sponsored the network fee.";
}

/**
 * Renders the acceptance widget into `target` (an element or a CSS selector). Mounting again on the
 * same element replaces the previous widget.
 */
export function mount(target: string | Element, options: EmbedOptions): EmbedHandle {
  if (!options.apiBaseUrl) throw new Error("Stele: apiBaseUrl is required");
  if (!options.organization || !options.document)
    throw new Error("Stele: organization and document are required");
  const { host, root, cleanup } = setup(target, options.theme);
  const client = new SteleClient({ apiBaseUrl: options.apiBaseUrl });
  const appUrl = (options.appUrl ?? "").replace(/\/$/, "");
  let destroyed = false;
  let stopWatching: (() => void) | null = null;

  const state: {
    doc: VerifiedDocument | null;
    picker: SignerPicker | null;
    agreed: boolean;
    busy: string | null;
    error: string | null;
    result: AcceptanceResult | null;
    copied: boolean;
  } = {
    doc: null,
    picker: null,
    agreed: false,
    busy: null,
    error: null,
    result: null,
    copied: false,
  };

  const action = h("div", { class: "pad action", "aria-live": "polite" });
  let acceptButton: HTMLButtonElement | null = null;

  const emit = (name: string, detail: unknown) =>
    host.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  const fail = (error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    options.onError?.(err);
    emit("stele:error", err);
    return err;
  };

  function renderAction() {
    if (destroyed || !state.doc || !state.picker) return;
    const doc = state.doc;
    const picker = state.picker;
    const children: Child[] = [];
    acceptButton = null;

    if (state.result) {
      const r = state.result;
      const receipt = `${appUrl}${r.receiptPath}`;
      const verifyUrl = verificationLink(appUrl, r.acceptanceId);
      children.push(
        h(
          "div",
          { class: "done", role: "status" },
          h("strong", {}, "✓ Accepted and recorded on Solana"),
          h(
            "div",
            { class: "muted" },
            `Signed with ${r.signerType === "passkey_p256" ? "your passkey" : r.signerType === "passkey" ? "your passkey-protected key" : "your wallet"} · `,
            r.transactionSignature
              ? h(
                  "span",
                  {},
                  "Transaction ",
                  h("span", { class: "mono" }, shortAddress(r.transactionSignature)),
                )
              : "Queued for the next batch anchor on Solana (seconds)",
          ),
          h("div", { class: "muted" }, feeLine(r.fee)),
          h(
            "div",
            { class: "row" },
            h(
              "button",
              {
                type: "button",
                class: "secondary",
                onclick: () =>
                  void client
                    .getReceipt(r.acceptanceId)
                    .then(({ receipt: body }) =>
                      downloadJson(`stele-receipt-${r.acceptanceId.slice(0, 16)}.json`, body),
                    )
                    .catch((e: unknown) => ((state.error = fail(e).message), renderAction())),
              },
              "Download receipt",
            ),
            h(
              "button",
              {
                type: "button",
                class: "secondary",
                onclick: () =>
                  void navigator.clipboard
                    ?.writeText(verifyUrl)
                    .then(() => ((state.copied = true), renderAction())),
              },
              state.copied ? "Link copied" : "Copy verification link",
            ),
            h(
              "a",
              { href: verifyUrl, target: "_blank", rel: "noopener noreferrer", class: "secondary" },
              "Verify",
            ),
            h(
              "a",
              { href: receipt, target: "_blank", rel: "noopener noreferrer", class: "secondary" },
              "View receipt",
            ),
          ),
        ),
      );
      if (state.error)
        children.push(h("div", { class: "alert error", role: "alert" }, state.error));
      action.replaceChildren(...present(children));
      return;
    }

    children.push(...picker.render());
    if (picker.signer && !picker.recoveryKit) {
      children.push(
        h(
          "label",
          { class: "agree" },
          h("input", {
            type: "checkbox",
            ...(state.agreed ? { checked: true } : {}),
            disabled: Boolean(state.busy),
            onchange: (e: Event) => {
              state.agreed = (e.target as HTMLInputElement).checked;
              if (acceptButton) acceptButton.disabled = !state.agreed;
            },
          }),
          h("span", {}, `I have read and agree to the ${doc.version.title}.`),
        ),
        state.busy
          ? h("div", { class: "status" }, h("span", { class: "spin" }), state.busy)
          : (acceptButton = h(
              "button",
              {
                type: "button",
                class: "primary",
                disabled: !state.agreed,
                onclick: () => void accept(),
              },
              isPasskey(picker.signer.signerType) ? "Accept with passkey" : "Accept & sign",
            ) as HTMLButtonElement),
      );
    }
    if (state.error) children.push(h("div", { class: "alert error", role: "alert" }, state.error));
    children.push(
      h(
        "div",
        { class: "note" },
        "You see the exact text before you sign. Signing is free — you never pay a network fee — and records a public acceptance on Solana with no personal data. It never moves funds.",
      ),
    );
    action.replaceChildren(...present(children));
  }

  async function accept() {
    const signer = state.picker?.signer;
    if (!state.doc || !signer || !state.agreed || state.busy) return;
    state.error = null;
    state.busy = "Preparing…";
    renderAction();
    try {
      const token =
        typeof options.sessionToken === "function"
          ? await options.sessionToken()
          : options.sessionToken;
      const result = await acceptDocument({
        client,
        verified: state.doc,
        signer,
        requestDomain: window.location.hostname,
        sessionToken: token,
        onStatus: (s) => {
          state.busy =
            s === "awaiting-signature"
              ? isPasskey(signer.signerType)
                ? "Confirm with your passkey…"
                : "Confirm in your wallet…"
              : s === "recording"
                ? "Recording on Solana…"
                : s === "recorded"
                  ? null
                  : "Preparing…";
          renderAction();
        },
      });
      state.result = result;
      options.onAccepted?.(result);
      emit("stele:accepted", result);
    } catch (e) {
      state.error =
        isUserRejection(e) || isPasskeyCancel(e)
          ? "Signing was cancelled. Nothing was recorded."
          : fail(e).message;
    } finally {
      state.busy = null;
      renderAction();
    }
  }

  function renderDocument(doc: VerifiedDocument) {
    const domain = verifiedDomainAt(doc.organization, Math.floor(Date.now() / 1000));
    root.replaceChildren(
      h(
        "div",
        { class: "pad head" },
        h(
          "div",
          { class: "org" },
          doc.organization.name,
          domain
            ? h("span", { class: "badge ok" }, `✓ ${domain}`)
            : h("span", { class: "badge warn" }, "Unverified organization"),
        ),
        h("div", { class: "title" }, doc.version.title),
        h(
          "div",
          { class: "muted" },
          `Version ${doc.version.versionLabel} · ${effectiveText(doc.version.effectiveAt)}`,
        ),
      ),
      h(
        "div",
        { class: "pad text", tabindex: "0", role: "document", "aria-label": doc.version.title },
        ...renderBlocks(doc.content.blocks),
      ),
      ...present([displayNotice(doc) ? h("div", { class: "pad" }, displayNotice(doc)) : null]),
      h(
        "div",
        { class: "pad" },
        h(
          "dl",
          { class: "facts" },
          h("dt", {}, "Fingerprint"),
          h("dd", { class: "mono" }, groupedFingerprint(doc.fingerprint)),
          h("dt", {}, "Network"),
          h("dd", {}, doc.config.networkLabel),
          h("dt", {}, "Requested by"),
          h("dd", {}, window.location.hostname),
          h("dt", {}, "Integrity"),
          h("dd", { class: "check" }, "✓ Text verified against Solana"),
        ),
        h(
          "details",
          {},
          h("summary", {}, "What was checked"),
          h("ul", {}, ...doc.checks.map((c) => h("li", {}, `${c.label}: ${c.detail}`))),
        ),
      ),
      action,
    );
    renderAction();
  }

  root.replaceChildren(
    h(
      "div",
      { class: "pad status" },
      h("span", { class: "spin" }),
      "Verifying the document against Solana…",
    ),
  );

  loadVerifiedDocument({
    client,
    organization: options.organization,
    document: options.document,
    rpcUrls: options.rpcUrls,
    expected: options.expected,
  })
    .then((doc) => {
      if (destroyed) return;
      state.doc = doc;
      const policy = doc.api.organization.signingPolicy ?? "WALLET_ONLY";
      state.picker = new SignerPicker({
        client,
        organization: doc.organizationAddress,
        policy,
        walletChain: doc.network.walletChain,
        networkLabel: doc.config.networkLabel,
        options,
        rerender: renderAction,
        fail,
        native: true,
      });
      renderDocument(doc);
      if (!options.signer && allowsWallet(policy)) {
        stopWatching = watchWallets(doc.network.walletChain, (wallets) => {
          if (state.picker) state.picker.wallets = wallets;
          renderAction();
        });
      }
    })
    .catch((e: unknown) => {
      if (destroyed) return;
      const err = fail(e);
      root.replaceChildren(
        h(
          "div",
          { class: "pad" },
          h(
            "div",
            { class: "alert error", role: "alert" },
            `This agreement could not be verified, so it is not shown: ${err.message}`,
          ),
        ),
      );
    });

  const handle: EmbedHandle = {
    destroy() {
      destroyed = true;
      stopWatching?.();
      cleanup();
    },
  };
  mounted.set(host, handle);
  return handle;
}

/**
 * Renders a proof confirmation (purchase, refund, consent…) for a request your server created.
 * The statement is shown only after its hash was checked locally.
 */
export function mountProof(target: string | Element, options: ProofEmbedOptions): EmbedHandle {
  if (!options.apiBaseUrl) throw new Error("Stele: apiBaseUrl is required");
  if (!options.requestId || !options.token)
    throw new Error("Stele: requestId and token are required");
  const { host, root, cleanup } = setup(target, options.theme);
  const client = new SteleClient({ apiBaseUrl: options.apiBaseUrl });
  let destroyed = false;
  let stopWatching: (() => void) | null = null;
  const state: {
    request: VerifiedProofRequest | null;
    picker: SignerPicker | null;
    busy: string | null;
    error: string | null;
    result: ProofResult | null;
  } = { request: null, picker: null, busy: null, error: null, result: null };
  const action = h("div", { class: "pad action", "aria-live": "polite" });
  const emit = (name: string, detail: unknown) =>
    host.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  const fail = (error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    options.onError?.(err);
    emit("stele:error", err);
    return err;
  };

  function renderAction() {
    if (destroyed || !state.request || !state.picker) return;
    const req = state.request;
    const children: Child[] = [];
    if (state.result) {
      const r = state.result;
      children.push(
        h(
          "div",
          { class: "done", role: "status" },
          h("strong", {}, "✓ Confirmed and recorded on Solana"),
          h(
            "div",
            { class: "muted" },
            "Proof ",
            h("span", { class: "mono" }, shortAddress(r.proofId)),
            " · You paid nothing: the network fee was sponsored.",
          ),
          h(
            "div",
            { class: "row" },
            h(
              "button",
              {
                type: "button",
                class: "secondary",
                onclick: () =>
                  void client
                    .getProofReceipt(req.requestId, req.token)
                    .then(({ receipt }) =>
                      downloadJson(`stele-proof-${r.proofId.slice(0, 16)}.json`, receipt),
                    )
                    .catch((e: unknown) => ((state.error = fail(e).message), renderAction())),
              },
              "Download receipt",
            ),
          ),
          h(
            "div",
            { class: "note" },
            "Keep the receipt: it contains the full statement, which is not public. Anyone you share it with can verify it against Solana.",
          ),
        ),
      );
    } else if (req.status === "confirmed" || req.status === "expired") {
      children.push(
        h(
          "div",
          { class: "note" },
          req.status === "expired" ? "This request expired." : "This was already confirmed.",
        ),
      );
    } else {
      children.push(...state.picker.render());
      if (state.picker.signer && !state.picker.recoveryKit)
        children.push(
          state.busy
            ? h("div", { class: "status" }, h("span", { class: "spin" }), state.busy)
            : h(
                "button",
                { type: "button", class: "primary", onclick: () => void confirm() },
                "Confirm & sign",
              ),
        );
    }
    if (state.error) children.push(h("div", { class: "alert error", role: "alert" }, state.error));
    action.replaceChildren(...present(children));
  }

  async function confirm() {
    const signer = state.picker?.signer;
    if (!state.request || !signer || state.busy) return;
    state.error = null;
    state.busy = "Preparing…";
    renderAction();
    try {
      const result = await confirmProof({
        client,
        request: state.request,
        signer,
        requestDomain: window.location.hostname,
        onStatus: (s) => {
          state.busy =
            s === "awaiting-signature"
              ? "Confirm with your passkey or wallet…"
              : s === "recording"
                ? "Recording on Solana…"
                : s === "recorded"
                  ? null
                  : "Preparing…";
          renderAction();
        },
      });
      state.result = result;
      options.onConfirmed?.(result);
      emit("stele:confirmed", result);
    } catch (e) {
      state.error =
        isUserRejection(e) || isPasskeyCancel(e)
          ? "Signing was cancelled. Nothing was recorded."
          : fail(e).message;
    } finally {
      state.busy = null;
      renderAction();
    }
  }

  root.replaceChildren(
    h("div", { class: "pad status" }, h("span", { class: "spin" }), "Checking the statement…"),
  );
  Promise.all([
    loadProofRequest({ client, requestId: options.requestId, token: options.token }),
    client.getNetwork(),
  ])
    .then(([request, network]) => {
      if (destroyed) return;
      state.request = request;
      const signingPolicy = request.signingPolicy;
      state.picker = new SignerPicker({
        client,
        organization: request.organization.address,
        policy: signingPolicy,
        walletChain: network.walletChain,
        networkLabel: network.label,
        options,
        rerender: renderAction,
        fail,
        native: false,
      });
      const domain = request.statement.organization.domain;
      root.replaceChildren(
        h(
          "div",
          { class: "pad head" },
          h(
            "div",
            { class: "org" },
            request.organization.name,
            domain
              ? h("span", { class: "badge ok" }, `✓ ${domain}`)
              : h("span", { class: "badge warn" }, "Unverified organization"),
          ),
          h(
            "div",
            { class: "title" },
            request.statement.type
              .replace(/_/g, " ")
              .toLowerCase()
              .replace(/^./, (c) => c.toUpperCase()),
          ),
          h("div", { class: "muted" }, `Reference ${request.statement.reference}`),
        ),
        h(
          "div",
          { class: "pad text" },
          h("ul", { class: "lines" }, ...request.lines.map((l) => h("li", {}, l))),
        ),
        h(
          "div",
          { class: "pad" },
          h(
            "dl",
            { class: "facts" },
            h("dt", {}, "Statement hash"),
            h("dd", { class: "mono" }, groupedFingerprint(request.statementHash)),
            h("dt", {}, "Network"),
            h("dd", {}, network.label),
            h("dt", {}, "Integrity"),
            h("dd", { class: "check" }, "✓ Statement matches the hash you will sign"),
          ),
        ),
        action,
      );
      renderAction();
      if (!options.signer && allowsWallet(signingPolicy))
        stopWatching = watchWallets(network.walletChain, (wallets) => {
          if (state.picker) state.picker.wallets = wallets;
          renderAction();
        });
    })
    .catch((e: unknown) => {
      if (destroyed) return;
      const err = fail(e);
      root.replaceChildren(
        h(
          "div",
          { class: "pad" },
          h(
            "div",
            { class: "alert error", role: "alert" },
            `This request could not be shown: ${err.message}`,
          ),
        ),
      );
    });

  const handle: EmbedHandle = {
    destroy() {
      destroyed = true;
      stopWatching?.();
      cleanup();
    },
  };
  mounted.set(host, handle);
  return handle;
}
