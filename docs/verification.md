# Verification

Every acceptance recorded through Stele is evidence that anyone can check: you, your customer, an
auditor or a court. Verification reads Solana directly. It does not ask Stele, or the company that
published the document, whether the evidence is genuine.

## What is checked

Given a transaction signature, an acceptance ID or a receipt, the verifier:

1. confirms that the Solana endpoints it reads from serve the expected network and the Stele program;
2. fetches the acceptance transaction from **every** endpoint you configured (they must agree) and
   reports whether it is finalized;
3. re-verifies the user's signature locally — Ed25519 (wallets), or P-256 over the WebAuthn data
   together with the challenge, origin, relying party and user-verification rules (native passkeys);
4. rebuilds the signed message from on-chain data and compares it with what was signed:
   organization, domain status, document title, version, fingerprint, network, validity window and
   requesting site;
5. recomputes the document's fingerprint and checks the document text against it (SHA-256 of the
   exact canonical bytes);
6. walks the document's version history back to version 1 and checks each version against the
   transaction that published it;
7. confirms the single-use nonce was consumed by this acceptance;
8. for account-bound passkeys, checks the on-chain enrollment and reports whether the key is still
   the account's signer, was rotated, or was replaced by the organization;
9. reports who vouches for the requesting site — **browser-attested** (passkeys) or
   **merchant-claimed** (wallets; a warning) — and the on-chain evidence behind the organization's
   verified domain;
10. for a batched acceptance, verifies the signature itself (the program did not) and the Merkle
    proof into the root anchored on Solana;
11. for a receipt, compares **every** claim in the file with the facts it derived itself.

## Verdicts

| Verdict | Meaning |
|---|---|
| `VALID` | Every check passed |
| `VALID_WITH_WARNINGS` | The evidence is genuine, with something worth knowing, for example "confirmed but not yet finalized" or "the organization has been renamed since" |
| `INVALID` | A critical check failed: the evidence is forged, altered or does not belong together |
| `INCONCLUSIVE` | A critical check could not be completed: endpoints disagree, the document text is unavailable, or the endpoint no longer holds that part of Solana's history |

The verifier never reports success for something it could not check. `INCONCLUSIVE` is not a
failure of the evidence: retry with an archival RPC provider, or with the receipt, which carries the
document text.

## Three ways to verify

### In the browser

Open **[Verify](/verify)** and paste a transaction signature or an acceptance ID, or paste a receipt.
The check runs in your browser against Solana. Under advanced options you can enter your own RPC
endpoints, the program ID and the required network.

You can also check a **document version** there by its address or fingerprint: the page confirms the
version exists on-chain, recomputes its fingerprint and checks its text.

### From the command line

The `stele-verify` command (in the `@stele/verifier` package) needs no Stele server:

```shell
stele-verify --rpc https://api.mainnet-beta.solana.com --tx <transaction signature>
stele-verify --rpc <url> --rpc <second url> --receipt receipt.json
stele-verify --rpc <url> --fingerprint <64-hex fingerprint>
```

| Option | |
|---|---|
| `--rpc <url>` | Solana endpoint; repeat it to require agreement between providers |
| `--tx`, `--receipt`, `--version`, `--fingerprint` | What to verify (one of them) |
| `--program <id>`, `--expect-chain <caip2>` | Pin the program and the network |
| `--mirror <url>` | Extra source for document text |
| `--dns` | Re-check the organization's domain in DNS now |
| `--deep` | Search deeper for publication transactions |
| `--json` | Machine-readable report |

Exit codes: `0` valid, `1` valid with warnings, `2` invalid, `3` inconclusive.

### In code

```ts
import { chainFromUrls, verifyAcceptance } from "@stele/verifier";

const report = await verifyAcceptance(
  { transactionSignature: "5h3K…" }, // or { receipt } or { acceptanceId }
  { chain: chainFromUrls(["https://rpc-one.example", "https://rpc-two.example"]) },
);
console.log(report.verdict); // "VALID" | "VALID_WITH_WARNINGS" | "INVALID" | "INCONCLUSIVE"
```

The report lists every check with its result and explanation.

## Receipts

Each acceptance has a receipt: a JSON file with the transaction, the signed message, the signature
evidence, the document version and its full text. It is designed to be kept: archive it with your own
records, or give it to the user. Wallet acceptances recorded directly use `stele-receipt-v1`; native
passkey acceptances and batched acceptances use `stele-receipt/2`, which adds the WebAuthn data
(authenticator data, client data, signature, relying party), the browser-attested origin, the
enrollment reference, the evidence mode (`DIRECT_ONCHAIN` or `MERKLE_BATCHED`) and, for batches, the
inclusion proof. Only the message hash (or a batch root) is on-chain for these, so the receipt is
where the exact signed text lives.

A receipt is a **claim**, not proof. The verifier re-derives everything from Solana and reports
`INVALID` if any field in the file differs. Because the receipt carries the document text, it
remains verifiable even if every other copy of the text disappears.

Receipts may also carry:

- **`signer`** — how the key was controlled. For passkey signers the verifier checks the key
  statement (signed by the key, endorsed by the passkey) and the passkey's user-verified approval of
  this exact message on the requesting site; any mismatch makes the receipt `INVALID`.
- **`fees`** — who paid the network fee (always the relayer, never the signer) and whether the
  organization reimbursed it. Checked against the transaction itself.

Receipts without these fields (older ones) verify exactly as before.

## Proof receipts

Purchases, refunds, consents and other confirmed statements have **`stele-proof-v1`** receipts.
They contain the full statement — which is not on-chain — so keep them as private as the order.
Upload one on **Verify → Receipt file**, or:

```ts
import { chainFromUrls, verifyProof } from "@stele/verifier";
const report = await verifyProof({ receipt }, { chain: chainFromUrls([rpcA, rpcB]) });
```

The verifier checks the signature, the anchor message (organization, network, statement hash), the
nonce and the recorded event, and that the statement in the receipt hashes to exactly what the signer
confirmed. A single changed amount makes the receipt `INVALID`.

## Choosing RPC endpoints

The verifier trusts no single source. Use two independent providers (or your own node): if they
disagree, the result is `INCONCLUSIVE` rather than a guess. Public endpoints often keep only recent
history; for acceptances older than a few days, use a provider with full history.

## Further reading

- [What a signature proves](acceptance-signing.md), and what it does not
- [Protocol specification](../PROTOCOL_SPEC.md): the normative verification rules
