# @stelehq/sdk

The Stele SDK for browsers, React and Node.js: show the exact terms, record verifiable acceptance on
Solana, and — with **Stele Gate** — let a protected action run only after the current terms were
accepted.

```bash
npm install @stelehq/sdk
```

## Stele Gate: "Accept & Continue"

```ts
import { createSteleGate } from "@stelehq/sdk";

const stele = createSteleGate({
  apiBaseUrl: "https://<your Stele app>/api",
  wallet: {
    address: wallet.publicKey.toBase58(),
    signMessage: (message) => wallet.signMessage(message),
  },
});

// Has this wallet accepted the version the policy requires?
const access = await stele.check(POLICY, wallet.publicKey.toBase58());
// access.status: "VALID" | "MISSING" | "OUTDATED"

// Runs your action right away if VALID; otherwise shows the terms, records the acceptance (free
// for the user) and then runs it. Closing the window throws GateCancelledError.
await stele.gate({
  policy: POLICY,
  action: () => sendDepositTransaction(),
  acceptLabel: "Accept & Continue",
});
```

Your Solana program enforces the same rule with the
[`stele-gate`](https://crates.io/crates/stele-gate) crate:
`stele_gate::require_current_passport(&passport, &policy, &user)` — the passport is one Stele
account per wallet (`findPassportPda(wallet)` in `@stelehq/protocol`). `stele.check(policy, wallet)`
reports the wallet's status from its passport or, for organizations on per-document storage, its
access pass.

### The Stele Verified badge

Once Stele has verified your deployed program (dashboard → Gate → Verification), show it:

```ts
import { mountVerifiedBadge } from "@stelehq/sdk";

mountVerifiedBadge("#stele-badge", { program: "YOUR_PROGRAM_ID" });
// React: import { SteleVerifiedBadge } from "@stelehq/sdk/react";
```

The badge shows the live verification (re-checked after every program upgrade) and opens the public
evidence, where visitors can re-run the checks in their own browser. Outside your organization's
verified domains it reads "Not valid on this site".

## Stele Proof: accept any document

```ts
import { SteleClient, loadVerifiedDocument, acceptDocument } from "@stelehq/sdk";

const client = new SteleClient({ apiBaseUrl: "https://<your Stele app>/api" });
const verified = await loadVerifiedDocument({ client, organization: "acme.com", document: "terms-of-service" });
const { acceptanceId } = await acceptDocument({ client, verified, signer, requestDomain: location.hostname });
```

`loadVerifiedDocument` checks the text against its on-chain fingerprint before showing it.
`@stelehq/sdk/react` has a React component; `@stelehq/sdk/server` has server helpers (sessions,
webhooks).

Documentation: the Stele docs — "Get started", "SDK & API" and "Stele Gate: step by step".

License: Apache-2.0.
