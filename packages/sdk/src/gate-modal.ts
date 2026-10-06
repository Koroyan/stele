/**
 * The embedded Stele Gate modal: shows the policy (hash-verified against Solana), asks the user to
 * agree, records the acceptance with their wallet and reports "Access granted" before the original
 * action continues. Framework-free: a shadow root on `document.body`, so the host page's styles
 * cannot reach it. Accessible: `role="dialog"` with `aria-modal`, focus trapped while open and
 * restored afterwards, Escape cancels (except while recording), progress is announced, and all
 * motion stops under `prefers-reduced-motion`.
 */
import { groupedFingerprint, type Block } from "@stele/protocol";
import { isUserRejection } from "./wallets";
import { applyStyles, displayNotice, h, renderBlocks } from "./dom";
import type { GateStatus, GateUi } from "./gate";

const CSS = `
:host { all: initial; position: fixed; inset: 0; z-index: 2147483000; color-scheme: dark;
  --_bg: var(--stele-bg, #0b1017); --_fg: var(--stele-fg, #e6edf5); --_muted: var(--stele-muted, #94a3b8);
  --_border: var(--stele-border, rgba(148,163,184,.18)); --_surface: var(--stele-surface, rgba(148,163,184,.06));
  --_accent: var(--stele-accent, #4cc9f0); --_on-accent: var(--stele-on-accent, #04121a);
  --_ok: var(--stele-verified, #34d399); --_warn: var(--stele-warning, #f5b544); --_danger: var(--stele-danger, #f87171);
  --_font: var(--stele-font, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); }
:host([data-theme="light"]) { color-scheme: light;
  --_bg: var(--stele-bg, #ffffff); --_fg: var(--stele-fg, #0f172a); --_muted: var(--stele-muted, #475569);
  --_border: var(--stele-border, rgba(15,23,42,.14)); --_surface: var(--stele-surface, rgba(15,23,42,.04));
  --_accent: var(--stele-accent, #0e7490); --_on-accent: var(--stele-on-accent, #ffffff);
  --_ok: var(--stele-verified, #047857); --_warn: var(--stele-warning, #b45309); --_danger: var(--stele-danger, #b91c1c); }
* { box-sizing: border-box; }
.backdrop { position: fixed; inset: 0; background: rgba(2,6,12,.62); backdrop-filter: blur(6px);
  display: grid; place-items: center; padding: 16px; animation: fade .18s ease-out; }
.dialog { width: min(440px, 100%); max-height: calc(100dvh - 32px); display: flex; flex-direction: column;
  background: var(--_bg); color: var(--_fg); border: 1px solid var(--_border); border-radius: 18px;
  box-shadow: 0 30px 80px -20px rgba(0,0,0,.6); font: 14px/1.55 var(--_font); text-align: left;
  overflow: hidden; animation: rise .22s cubic-bezier(.2,.8,.2,1); }
.top { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 18px 0; }
.brand { display: inline-flex; align-items: center; gap: 8px; font-size: 11.5px; font-weight: 700;
  letter-spacing: .16em; color: var(--_muted); }
.brand i { width: 8px; height: 8px; border-radius: 2px; background: var(--_accent); display: inline-block; }
.close { width: 30px; height: 30px; border-radius: 8px; border: 1px solid transparent; background: none;
  color: var(--_muted); font-size: 18px; line-height: 1; cursor: pointer; }
.close:hover { background: var(--_surface); color: var(--_fg); }
.body { padding: 10px 18px 18px; overflow-y: auto; display: grid; gap: 14px; }
.title { margin: 0; font-size: 21px; font-weight: 700; letter-spacing: -.015em; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; color: var(--_muted); font-size: 12.5px; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px; border-radius: 999px; font-size: 12px;
  font-weight: 600; background: var(--_surface); border: 1px solid var(--_border); color: var(--_fg); }
.pill.ok { color: var(--_ok); border-color: color-mix(in srgb, var(--_ok) 35%, transparent); }
.updated { padding: 10px 12px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--_warn) 40%, transparent);
  background: color-mix(in srgb, var(--_warn) 10%, transparent); font-size: 13px; }
.updated strong { color: var(--_warn); }
.summary { margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--_surface); border: 1px solid var(--_border);
  display: grid; gap: 6px; font-size: 13.5px; }
.summary p { margin: 0; }
.toggle { justify-self: start; background: none; border: 0; padding: 0; color: var(--_accent); font: inherit;
  font-weight: 600; font-size: 13px; cursor: pointer; }
.full { max-height: 240px; overflow-y: auto; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--_border);
  font-size: 13px; }
.full h3 { margin: 12px 0 6px; font-size: 14px; } .full h3:first-child { margin-top: 0; }
.full p { margin: 0 0 8px; white-space: pre-wrap; } .full ul, .full ol { margin: 0 0 8px; padding-left: 20px; }
.agree { display: flex; gap: 10px; align-items: flex-start; font-size: 13.5px; cursor: pointer; }
.agree input { margin-top: 2px; width: 17px; height: 17px; accent-color: var(--_accent); flex: none; }
.actions { display: grid; gap: 8px; }
.primary { width: 100%; padding: 12px 18px; border: 0; border-radius: 12px; background: var(--_accent);
  color: var(--_on-accent); font: inherit; font-weight: 700; font-size: 15px; cursor: pointer;
  transition: transform .12s ease, opacity .12s ease; }
.primary:hover:not(:disabled) { transform: translateY(-1px); }
.primary:disabled { opacity: .5; cursor: not-allowed; }
.secondary { width: 100%; padding: 10px 18px; border: 1px solid var(--_border); border-radius: 12px; background: none;
  color: var(--_fg); font: inherit; font-weight: 600; cursor: pointer; }
button:focus-visible, input:focus-visible, .full:focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
.foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 18px;
  border-top: 1px solid var(--_border); color: var(--_muted); font-size: 11.5px; }
.foot .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.shield { color: var(--_ok); font-weight: 700; }
.progress { display: grid; gap: 10px; padding: 4px 0; }
.step { display: flex; align-items: center; gap: 10px; font-size: 13.5px; color: var(--_muted); }
.step[data-state="active"] { color: var(--_fg); font-weight: 600; }
.step[data-state="done"] { color: var(--_ok); }
.dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--_border); flex: none; display: grid;
  place-items: center; font-size: 11px; }
.step[data-state="active"] .dot { border-color: var(--_border); border-top-color: var(--_accent); animation: spin .8s linear infinite; }
.step[data-state="done"] .dot { border-color: var(--_ok); background: var(--_ok); color: var(--_bg); }
.success { display: grid; justify-items: center; gap: 10px; padding: 18px 0 8px; text-align: center; }
.badge { width: 58px; height: 58px; border-radius: 50%; display: grid; place-items: center; font-size: 28px;
  color: var(--_bg); background: var(--_ok); animation: pop .35s cubic-bezier(.2,1.4,.4,1); }
.success strong { font-size: 17px; }
.error { padding: 10px 12px; border-radius: 12px; color: var(--_danger); font-size: 13px;
  background: color-mix(in srgb, var(--_danger) 10%, transparent); }
.note { color: var(--_muted); font-size: 12px; }
.alert.error { padding: 10px 12px; border-radius: 12px; color: var(--_danger);
  background: color-mix(in srgb, var(--_danger) 10%, transparent); font-size: 12.5px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@keyframes fade { from { opacity: 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(14px) scale(.98); } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pop { from { transform: scale(.4); opacity: 0; } }
@media (max-width: 520px) {
  .backdrop { place-items: end center; padding: 0; }
  .dialog { width: 100%; border-radius: 18px 18px 0 0; max-height: 92dvh; }
}
@media (prefers-reduced-motion: reduce) {
  .backdrop, .dialog, .badge { animation: none; }
  .step[data-state="active"] .dot { animation: none; border-top-color: var(--_accent); }
  .primary { transition: none; }
}
`;

const STEPS: { status: GateStatus; label: string }[] = [
  { status: "awaiting-signature", label: "Confirm in your wallet" },
  { status: "recording", label: "Recording your acceptance on Solana" },
  { status: "confirming", label: "Activating access" },
];

function updatedOn(publishedAt: bigint): string {
  return new Date(Number(publishedAt) * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** The first few readable lines of the policy (the full text is one click away). */
function summaryOf(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "heading") continue;
    if (b.type === "paragraph") out.push(b.text);
    else out.push(...b.items.map((i) => `• ${i}`));
    if (out.length >= 3) break;
  }
  return out.slice(0, 3);
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]';

/** The default Gate UI. */
export function gateModal(opts: { theme?: "auto" | "dark" | "light" } = {}): GateUi {
  return {
    requestAcceptance: ({ access, walletAddress, accept }) =>
      new Promise<boolean>((resolve) => {
        const doc = access.document;
        const v = doc.version;
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const host = document.createElement("stele-gate");
        const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches;
        host.setAttribute(
          "data-theme",
          opts.theme && opts.theme !== "auto" ? opts.theme : prefersLight ? "light" : "dark",
        );
        const shadow = host.attachShadow({ mode: "open" });
        applyStyles(shadow, CSS);
        const overflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = "hidden";
        let busy = false;
        let finished = false;

        const live = h("div", { class: "sr", "aria-live": "polite" });
        const titleId = "stele-gate-title";
        const body = h("div", { class: "body" });
        const close = h(
          "button",
          { class: "close", type: "button", "aria-label": "Cancel", onclick: () => finish(false) },
          "×",
        );
        const dialog = h(
          "div",
          {
            class: "dialog",
            role: "dialog",
            "aria-modal": "true",
            "aria-labelledby": titleId,
          },
          h(
            "div",
            { class: "top" },
            h("span", { class: "brand" }, h("i", { "aria-hidden": "true" }), "STELE"),
            close,
          ),
          body,
          h(
            "div",
            { class: "foot" },
            h("span", {}, h("span", { class: "shield" }, "✓ "), "Verified by Stele"),
            h(
              "span",
              { class: "mono", title: "Fingerprint of this exact text, committed on Solana" },
              `${groupedFingerprint(doc.fingerprint).split(" ").slice(0, 2).join(" ")}… · ${doc.config.networkLabel}`,
            ),
          ),
          live,
        );
        const backdrop = h("div", { class: "backdrop", part: "backdrop" }, dialog);
        backdrop.addEventListener("mousedown", (e) => {
          if (e.target === backdrop && !busy) finish(false);
        });
        shadow.append(backdrop);
        document.body.append(host);

        function finish(granted: boolean) {
          if (finished) return;
          finished = true;
          document.removeEventListener("keydown", onKey, true);
          host.remove();
          document.documentElement.style.overflow = overflow;
          previouslyFocused?.focus?.();
          resolve(granted);
        }

        function onKey(e: KeyboardEvent) {
          if (e.key === "Escape" && !busy) {
            e.preventDefault();
            finish(false);
          } else if (e.key === "Tab") {
            const items = [...shadow.querySelectorAll<HTMLElement>(FOCUSABLE)];
            if (items.length === 0) return;
            const first = items[0]!;
            const last = items[items.length - 1]!;
            const active = shadow.activeElement;
            if (e.shiftKey && (active === first || !active)) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && active === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
        document.addEventListener("keydown", onKey, true);

        function renderReview(error?: string) {
          busy = false;
          close.removeAttribute("disabled");
          const outdated = access.status === "OUTDATED" && access.pass;
          const agree = h("input", { type: "checkbox", id: "stele-agree" }) as HTMLInputElement;
          const button = h(
            "button",
            { class: "primary", type: "button", disabled: true },
            "Accept & Continue",
          ) as HTMLButtonElement;
          agree.addEventListener("change", () => {
            button.disabled = !agree.checked;
          });
          const full = h(
            "div",
            { class: "full", tabindex: "0", hidden: true, "aria-label": "Full text" },
            ...renderBlocks(doc.content.blocks),
          );
          const toggle = h(
            "button",
            { class: "toggle", type: "button", "aria-expanded": "false" },
            "View full document",
          );
          toggle.addEventListener("click", () => {
            const open = full.hidden;
            full.hidden = !open;
            toggle.setAttribute("aria-expanded", String(open));
            toggle.textContent = open ? "Hide full document" : "View full document";
          });
          button.addEventListener("click", () => void run());
          const lines = summaryOf(doc.content.blocks);
          body.replaceChildren(
            ...[
              h("h2", { class: "title", id: titleId, dir: "auto" }, v.title),
              h(
                "div",
                { class: "meta" },
                h("span", { class: "pill" }, `Version ${v.versionLabel}`),
                h("span", {}, `Updated ${updatedOn(v.publishedAt)}`),
                h("span", { class: "pill ok" }, "Text verified on Solana"),
              ),
              outdated
                ? h(
                    "div",
                    { class: "updated", role: "note" },
                    h("strong", {}, "This policy was updated. "),
                    `You accepted version ${access.pass!.versionNumber}; version ${v.version} is required now.`,
                    doc.content.changeSummary ? ` What changed: ${doc.content.changeSummary}` : "",
                  )
                : null,
              h(
                "div",
                { class: "summary" },
                ...lines.map((l) => h("p", { dir: "auto" }, l)),
                toggle,
              ),
              full,
              displayNotice(doc),
              error ? h("div", { class: "error", role: "alert" }, error) : null,
              h(
                "label",
                { class: "agree", for: "stele-agree" },
                agree,
                h(
                  "span",
                  {},
                  `I have read and agree to the ${v.title} (version ${v.versionLabel}).`,
                ),
              ),
              h(
                "div",
                { class: "actions" },
                button,
                h(
                  "button",
                  { class: "secondary", type: "button", onclick: () => finish(false) },
                  "Cancel",
                ),
              ),
              h(
                "p",
                { class: "note" },
                `Your wallet ${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)} signs this exact text. You pay no network fee.`,
              ),
            ].filter((x): x is HTMLElement => x !== null),
          );
          (error ? button : agree).focus();
        }

        function renderProgress(current: GateStatus) {
          const index = STEPS.findIndex((s) => s.status === current);
          body.replaceChildren(
            h("h2", { class: "title", id: titleId, dir: "auto" }, v.title),
            h(
              "div",
              { class: "progress", role: "status" },
              ...STEPS.map((s, i) =>
                h(
                  "div",
                  {
                    class: "step",
                    "data-state": i < index ? "done" : i === index ? "active" : "pending",
                  },
                  h("span", { class: "dot", "aria-hidden": "true" }, i < index ? "✓" : ""),
                  s.label,
                ),
              ),
            ),
          );
          const step = STEPS[index];
          if (step) live.textContent = step.label;
        }

        function renderSuccess() {
          body.replaceChildren(
            h(
              "div",
              { class: "success", role: "status" },
              h("div", { class: "badge", "aria-hidden": "true" }, "✓"),
              h("strong", { id: titleId }, "Policy accepted"),
              h("span", { class: "note" }, "Access granted — continuing your action…"),
            ),
          );
          live.textContent = "Policy accepted. Access granted.";
        }

        async function run() {
          busy = true;
          close.setAttribute("disabled", "");
          renderProgress("awaiting-signature");
          try {
            await accept((s) => {
              if (STEPS.some((x) => x.status === s)) renderProgress(s);
            });
            renderSuccess();
            const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
            setTimeout(() => finish(true), reduce ? 400 : 900);
          } catch (e) {
            renderReview(
              isUserRejection(e)
                ? "You declined the signature in your wallet. Nothing was recorded."
                : e instanceof Error
                  ? e.message
                  : String(e),
            );
          }
        }

        renderReview();
      }),
  };
}
