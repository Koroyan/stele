"use client";
/**
 * Mounts the SDK's proof widget: the statement is shown only after its hash was checked in this
 * browser, and the customer signs with a passkey or a wallet. The customer never pays the fee.
 */
import { useEffect, useRef, useState } from "react";
import { mountProof } from "@stele/sdk";
import { Alert } from "@stele/ui";

export function ConfirmClient({ requestId }: { requestId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [missingToken, setMissingToken] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (!token) {
      setMissingToken(true);
      return;
    }
    if (!host.current) return;
    const handle = mountProof(host.current, {
      apiBaseUrl: `${window.location.origin}/api`,
      appUrl: window.location.origin,
      requestId,
      token,
    });
    return () => handle.destroy();
  }, [requestId]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-fg">Confirm</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">
        Review the statement below. Confirming records your signature over its exact content on
        Solana; only its fingerprint is public.
      </p>
      <div className="mt-6">
        {missingToken ? (
          <Alert tone="warning" title="This link is incomplete">
            Open the full link you received from the merchant (it ends with <code>#token=…</code>).
          </Alert>
        ) : (
          <div ref={host} />
        )}
      </div>
    </div>
  );
}
