/**
 * Entry point of the `<script>` build (`stele.js`, served by every Stele deployment at
 * `/sdk/v1/stele.js`). It needs no configuration: the API and receipt URLs default to the origin the
 * script was loaded from.
 *
 *   <script src="https://stele.site/sdk/v1/stele.js" defer></script>
 *   <div data-stele-organization="acme.com" data-stele-document="terms-of-service"></div>
 *   <div data-stele-proof-request="<request id>" data-stele-proof-token="<client token>"></div>
 *
 *   <span data-stele-verified="<your program id>"></span>   (the Stele Verified badge)
 *
 * Elements with `data-stele-document`, `data-stele-proof-request` or `data-stele-verified` are
 * mounted automatically (also
 * when added later). For full control call `Stele.mount(element, options)` or
 * `Stele.mountProof(element, options)`; listen for the `stele:accepted` / `stele:confirmed` DOM
 * events or pass `onAccepted` / `onConfirmed`.
 */
import {
  mount,
  mountProof,
  type EmbedHandle,
  type EmbedOptions,
  type ProofEmbedOptions,
} from "./embed";
import { SteleClient } from "./client";
import { createSteleGate, type SteleGate, type SteleGateOptions } from "./gate";
import { mountVerifiedBadge, type VerifiedBadgeHandle, type VerifiedBadgeOptions } from "./badge";
import { PasskeySigner, passkeySigningSupport } from "./passkey";

const script = document.currentScript as HTMLScriptElement | null;
const origin = script?.src ? new URL(script.src).origin : window.location.origin;
const DEFAULTS = { apiBaseUrl: `${origin}/api`, appUrl: origin };

function mountWithDefaults(
  target: string | Element,
  options: Omit<EmbedOptions, "apiBaseUrl" | "appUrl"> & Partial<EmbedOptions>,
): EmbedHandle {
  return mount(target, { ...DEFAULTS, ...options });
}

function mountProofWithDefaults(
  target: string | Element,
  options: Omit<ProofEmbedOptions, "apiBaseUrl" | "appUrl"> & Partial<ProofEmbedOptions>,
): EmbedHandle {
  return mountProof(target, { ...DEFAULTS, ...options });
}

function badgeWithDefaults(
  target: string | Element,
  options: Omit<VerifiedBadgeOptions, "apiBaseUrl" | "appUrl"> & Partial<VerifiedBadgeOptions>,
): VerifiedBadgeHandle {
  return mountVerifiedBadge(target, { ...DEFAULTS, ...options });
}

const declared = new WeakSet<Element>();
const themeOf = (t: string | undefined) => (t === "light" || t === "dark" ? t : "auto");

function mountDeclared(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>(
    "[data-stele-document], [data-stele-proof-request], [data-stele-verified]",
  )) {
    if (declared.has(el)) continue;
    declared.add(el);
    const d = el.dataset;
    try {
      if (d.steleVerified) {
        badgeWithDefaults(el, { program: d.steleVerified, theme: themeOf(d.steleTheme) });
      } else if (d.steleProofRequest) {
        mountProofWithDefaults(el, {
          requestId: d.steleProofRequest,
          token: d.steleProofToken ?? "",
          theme: themeOf(d.steleTheme),
          sessionToken: d.steleSession || undefined,
        });
      } else {
        mountWithDefaults(el, {
          organization: d.steleOrganization ?? "",
          document: d.steleDocument ?? "",
          theme: themeOf(d.steleTheme),
          sessionToken: d.steleSession || undefined,
        });
      }
    } catch (e) {
      console.error(e);
    }
  }
}

declare global {
  interface Window {
    Stele?: {
      version: string;
      mount: typeof mountWithDefaults;
      mountProof: typeof mountProofWithDefaults;
      scan: typeof mountDeclared;
      /** An API client for this deployment (account pages: passkeys, recovery kits). */
      client: () => SteleClient;
      PasskeySigner: typeof PasskeySigner;
      passkeySigningSupport: typeof passkeySigningSupport;
      /** The Stele Verified badge: `Stele.badge("#badge", { program })`. */
      badge: typeof badgeWithDefaults;
      /** Stele Gate for Solana apps: `Stele.createGate({ wallet }).gate({ policy, action })`. */
      createGate: (
        options: Omit<SteleGateOptions, "apiBaseUrl"> & { apiBaseUrl?: string },
      ) => SteleGate;
    };
  }
}

function start(): void {
  mountDeclared();
  // Single-page apps often render the placeholder after this script ran.
  new MutationObserver(() => mountDeclared()).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

// Loaded twice (a duplicated script tag): the first copy already manages the page.
if (!window.Stele) {
  window.Stele = {
    version: "1",
    mount: mountWithDefaults,
    mountProof: mountProofWithDefaults,
    scan: mountDeclared,
    client: () => new SteleClient({ apiBaseUrl: DEFAULTS.apiBaseUrl }),
    PasskeySigner,
    passkeySigningSupport,
    badge: badgeWithDefaults,
    createGate: (options) => createSteleGate({ apiBaseUrl: DEFAULTS.apiBaseUrl, ...options }),
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
