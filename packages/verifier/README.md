# @stelehq/verifier

Verify Stele evidence yourself, against Solana — no Stele server involved. Give it a receipt (or a
transaction signature) and an RPC endpoint; it checks the document fingerprint, the signer's
signature, the on-chain record and the version history, and returns a verdict with every check
listed.

```bash
npm install @stelehq/verifier
```

```ts
import { chainFromUrls, verifyAcceptance } from "@stelehq/verifier";

const report = await verifyAcceptance(
  { receipt }, // or { transactionSignature: "…" }
  { chain: chainFromUrls(["https://api.devnet.solana.com"]) },
);
console.log(report.verdict); // "VALID" | "VALID_WITH_WARNINGS" | "INVALID" | "INCONCLUSIVE"
```

Used by the Stele website's "Verify agreement" page and by `@stelehq/sdk`.

License: Apache-2.0.
