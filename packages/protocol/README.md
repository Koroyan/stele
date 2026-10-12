# @stelehq/protocol

The open Stele protocol in TypeScript: canonical document bytes and fingerprints, the exact
acceptance messages, program addresses (PDAs), account decoders and instruction builders for the
Stele Solana program.

```bash
npm install @stelehq/protocol
```

Everything needed to work **without Stele's servers** is here — for example to read a wallet's
AccessPass straight from Solana:

```ts
import { createRpc, decodeAccessPass, decodeGatePolicy, fetchAccountData, findAccessPassPda } from "@stelehq/protocol";

const rpc = createRpc("https://api.devnet.solana.com");
const policy = decodeGatePolicy((await fetchAccountData(rpc, POLICY))!);
const [pass] = await findAccessPassPda(policy.document, wallet);
const data = await fetchAccountData(rpc, pass);
const status = !data
  ? "MISSING"
  : decodeAccessPass(data).versionNumber >= policy.requiredVersion
    ? "VALID"
    : "OUTDATED";
```

Most apps use [`@stelehq/sdk`](https://www.npmjs.com/package/@stelehq/sdk) instead, which builds on
this package.

License: Apache-2.0.
