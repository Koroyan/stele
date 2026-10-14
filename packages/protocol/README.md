# @stelehq/protocol

The open Stele protocol in TypeScript: canonical document bytes and fingerprints, the exact
acceptance messages, program addresses (PDAs), account decoders and instruction builders for the
Stele Solana program.

```bash
npm install @stelehq/protocol
```

Everything needed to work **without Stele's servers** is here — for example to read a wallet's
Stele Gate status straight from Solana:

```ts
import { createRpc, readAccess } from "@stelehq/protocol";

const rpc = createRpc("https://api.devnet.solana.com");
const access = await readAccess(rpc, { policy: POLICY, holder: wallet });
// access.status: "VALID" | "MISSING" | "OUTDATED"; access.storage: "passport" | "pass"
```

or by hand, from the wallet's passport (one account per wallet, an entry per document):

```ts
import { decodeGatePolicy, decodePassport, fetchAccountData, findPassportPda, passportEntry } from "@stelehq/protocol";

const policy = decodeGatePolicy((await fetchAccountData(rpc, POLICY))!);
const [passport] = await findPassportPda(wallet);
const data = await fetchAccountData(rpc, passport);
const entry = data ? passportEntry(decodePassport(data), policy.document) : null;
const status = !entry ? "MISSING" : entry.versionNumber >= policy.requiredVersion ? "VALID" : "OUTDATED";
```

Most apps use [`@stelehq/sdk`](https://www.npmjs.com/package/@stelehq/sdk) instead, which builds on
this package.

License: Apache-2.0.
