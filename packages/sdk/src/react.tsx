/**
 * `<TermsAcceptance/>`: the acceptance widget as a React component (a thin wrapper around
 * {@link mount}).
 *
 * It renders ONLY content whose SHA-256 the browser has matched against the on-chain commitment,
 * shows exactly what will be accepted, re-derives the message from chain data before signing, and
 * connects the visitor's wallet itself (Wallet Standard). Theme with CSS variables on the element
 * (`--stele-accent`, `--stele-bg`, `--stele-fg`, `--stele-border`, `--stele-radius`, …).
 *
 * ```tsx
 * <TermsAcceptance
 *   apiBaseUrl="https://stele.site/api"
 *   appUrl="https://stele.site"
 *   organization="acme.com"
 *   document="terms-of-service"
 *   onAccepted={(r) => console.log(r.acceptanceId)}
 * />
 * ```
 */
import { useEffect, useRef, type CSSProperties } from "react";
import type { AcceptanceResult, MessageSigner } from "./accept";
import { mountVerifiedBadge, type VerifiedBadgeOptions } from "./badge";
import { mount, type EmbedOptions } from "./embed";

export interface TermsAcceptanceProps {
  /** Stele API base URL, e.g. `https://stele.site/api`. */
  apiBaseUrl: string;
  /** Where receipts open, e.g. `https://stele.site`. */
  appUrl?: string;
  organization: string;
  document: string;
  /** Optional: your own wallet integration. Without it the built-in wallet picker is used. */
  signer?: MessageSigner | null;
  sessionToken?: EmbedOptions["sessionToken"];
  theme?: EmbedOptions["theme"];
  rpcUrls?: string[];
  expected?: EmbedOptions["expected"];
  onAccepted?: (result: AcceptanceResult) => void;
  onError?: (error: Error) => void;
  className?: string;
  style?: CSSProperties;
}

export function TermsAcceptance(props: TermsAcceptanceProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Callbacks and the signer are read through a ref so that new function identities on every render
  // do not reload the document.
  const latest = useRef(props);
  latest.current = props;

  const signerAddress = props.signer?.address ?? null;
  const sessionKey = typeof props.sessionToken === "string" ? props.sessionToken : null;
  const rpcKey = (props.rpcUrls ?? []).join(",");
  const expectedKey = JSON.stringify(props.expected ?? {});

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const p = latest.current;
    const signer: MessageSigner | null = p.signer
      ? {
          address: p.signer.address,
          walletName: p.signer.walletName,
          signMessage: (m) => (latest.current.signer ?? p.signer!).signMessage(m),
        }
      : null;
    const handle = mount(el, {
      apiBaseUrl: p.apiBaseUrl,
      appUrl: p.appUrl,
      organization: p.organization,
      document: p.document,
      signer,
      sessionToken:
        typeof p.sessionToken === "function"
          ? () => (latest.current.sessionToken as () => Promise<string | undefined>)()
          : p.sessionToken,
      theme: p.theme,
      rpcUrls: p.rpcUrls,
      expected: p.expected,
      onAccepted: (r) => latest.current.onAccepted?.(r),
      onError: (e) => latest.current.onError?.(e),
    });
    return () => handle.destroy();
  }, [
    props.apiBaseUrl,
    props.appUrl,
    props.organization,
    props.document,
    props.theme,
    signerAddress,
    sessionKey,
    rpcKey,
    expectedKey,
  ]);

  return <div ref={ref} className={props.className} style={props.style} />;
}

/**
 * `<SteleVerifiedBadge/>`: the live Stele Verified badge for a protected program.
 *
 * ```tsx
 * <SteleVerifiedBadge program="YOUR_PROGRAM_ID" />
 * ```
 */
export function SteleVerifiedBadge(
  props: VerifiedBadgeOptions & { className?: string; style?: CSSProperties },
) {
  const ref = useRef<HTMLSpanElement>(null);
  const { program, apiBaseUrl, appUrl, theme } = props;
  useEffect(() => {
    if (!ref.current) return;
    const handle = mountVerifiedBadge(ref.current, { program, apiBaseUrl, appUrl, theme });
    return () => handle.destroy();
  }, [program, apiBaseUrl, appUrl, theme]);
  return <span ref={ref} className={props.className} style={props.style} />;
}
