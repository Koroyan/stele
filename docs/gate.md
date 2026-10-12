# Stele Gate

**Your Solana program refuses a protected action until the signing wallet has accepted your current
terms.** Deposits into a real-world-asset vault, a token offering, a permissioned credit pool: if
the terms were not accepted, the transaction fails on-chain, whoever sent it.

> [!TIP] See it before you read it
> The [live demo](/demo) walks through the whole story in two minutes: no wallet, no fees, real
> transactions.

## In one minute

A checkbox on a website protects only that website. Anyone can build the transaction themselves and
call your program directly, and the checkbox never runs. Stele Gate puts the check inside the
program:

1. **You publish your terms and set a policy.** In the Stele dashboard: "deposits require version 2
   of the Offering Terms".
2. **The user accepts once.** A small Stele window shows the exact text; the user signs with their
   wallet. It is free: Stele pays the fee. Solana now holds the user's **AccessPass**: "this wallet
   accepted version 2".
3. **Your program checks the pass.** One call, `require_current()`, before the action. No pass, an
   old version or someone else's pass, and the transaction fails.

```text
Organization ── publishes ──▶ Document v1, v2 …            (Stele program)
Organization ── sets ───────▶ Policy: "requires ≥ v2"       (Stele program)
User wallet ─── accepts v2 ─▶ AccessPass: "accepted v2"     (Stele program)

User wallet ─── deposit ────▶ Your program
                              └─ require_current(pass, policy, user)  ✓ or ✕
```

When you require a new version, older passes stop working until the user accepts again. Nothing is
rewritten: earlier acceptances stay on record and verifiable.

Two things to remember:

- **Stele is not in the execution path.** Your program reads two Stele accounts and decides. No
  proxy, no CPI into Stele, no shared signer and no Stele server takes part in the protected
  transaction.
- **The frontend is optional; the program check is not.** The SDK gives users a smooth "Accept &
  Continue". The check in your program is what a script, the CLI or another frontend cannot skip.

### Proof or Gate?

| You need to… | Use |
|---|---|
| Prove later which exact terms a user accepted (website, SaaS, app, onboarding, consent) | **Stele Proof** — see [Get started](get-started.md) |
| Stop a Solana action until the user has accepted the current terms | **Stele Gate** (includes Proof) |

Every acceptance that opens a Gate is an ordinary [Stele Proof](how-it-works.md) acceptance, with a
public receipt anyone can verify.

## Add it in three steps

> [!TIP] Building it now?
> The [step-by-step guide](gate-guide.md) walks through every step with copy-paste code, including
> how your site reads each user's AccessPass and how to test in Solana Playground.

### 1. Create the policy

In the dashboard: publish the document (**Documents**), turn on Stele Gate for the organization,
then **Gate → Policies → Create policy**. Copy the policy address.

### 2. Call `require_current` in your program

Add the policy and the user's AccessPass to the protected instruction, and call `require_current`
before the action.

> [!IMPORTANT] Pin the policy address
> Store it in your program's state or make it a constant, as `#[account(address = vault.policy)]`
> does below. Otherwise a caller could pass a policy of their own.

```rust
// Cargo.toml: stele-gate = "1"
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub investor: Signer<'info>,
    #[account(mut, seeds = [b"vault", vault.policy.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: pinned to the vault's policy; verified by require_current.
    #[account(address = vault.policy)]
    pub policy: UncheckedAccount<'info>,
    /// CHECK: verified by require_current.
    pub access_pass: UncheckedAccount<'info>,
}

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let granted = stele_gate::require_current(
        &ctx.accounts.access_pass,
        &ctx.accounts.policy,
        &ctx.accounts.investor,
    )?;
    // granted.version_number, granted.version_hash and granted.acceptance_id name the
    // acceptance that allowed this deposit — useful in your own events.
    // … the protected action
    Ok(())
}
```

This is the deposit of the Atlas Real Estate Vault from the live demo (`programs/gate-demo`),
shortened. The crate is [`stele-gate` on crates.io](https://crates.io/crates/stele-gate) (source:
`crates/stele-gate` in the Stele repository).

### 3. Add "Accept & Continue" to your app

Wrap the protected action with `gate()`:

```ts
import { createSteleGate } from "@stelehq/sdk";

const stele = createSteleGate({
  apiBaseUrl: "https://app.stele.example/api",
  wallet: {
    address: wallet.publicKey.toBase58(),
    signMessage: (message) => wallet.signMessage(message),
  },
});

const signature = await stele.gate({
  policy: OFFERING_TERMS_POLICY,
  action: () => sendDepositTransaction(5_000_000_000n),
  acceptLabel: "Accept & Continue",
});
```

What `gate()` does:

- **The pass is current** → it runs `action` right away. The user sees nothing extra.
- **The pass is missing or outdated** → it opens the Stele window with the exact text of the
  required version (checked against Solana), records the acceptance, waits until the pass is
  visible on-chain, then runs `action`.
- **The user closes the window** → it throws `GateCancelledError`; `action` never runs.

For your own UI, pass `ui: "none"`: `gate()` then throws `AccessRequiredError` instead of opening the
window, and `stele.check(policy, wallet)` returns the status without prompting. The SDK is in the
Stele repository (`packages/sdk`); in a plain HTML page, load `/sdk/v1/stele.js` and use
`Stele.createGate()`.

### Then: test the bypass

Your tests should cover at least:

| Scenario | Expected |
|---|---|
| No AccessPass | `AccessPassMissing` (7602) |
| Pass for the required version | success |
| Policy raised to a newer version, old pass | `AccessPassOutdated` (7605) |
| Another wallet's pass | `AccessPassMismatch` (7604) |
| A policy that is not the pinned one | your constraint (the demo: `WrongPolicy`) |

The dashboard's **Gate → Testing** runs the same scenarios live against your policy, and against
the demo vault's `deposit` by simulation.

## Good to know

### "Accept & Continue" is two transactions

1. **The acceptance.** The user signs a message (not a transaction); Stele's relayer submits it and
   pays the fee and the pass rent.
2. **Your action.** The user signs your transaction as usual.

They are not atomic:

- If the second transaction fails or the user rejects it, the acceptance stays recorded and the
  pass stays current. The user does not have to accept again.
- If the organization requires a newer version between the two, the action fails with
  `AccessPassOutdated` and the next attempt shows the window again.
- If the document changes while the window is open, the SDK refuses to sign the old text and loads
  the new version.

### Why a direct call fails

A Solana program cannot know which website a transaction came from. `require_current` runs inside
the program that executes the action, so it holds for every caller:

| Someone tries… | Result |
|---|---|
| A wallet that never accepted | No Stele account at its pass address → `AccessPassMissing` |
| Someone else's pass | The pass's holder is not the signer → `AccessPassMismatch` |
| A forged account | Not owned by the Stele program, or not at the canonical address → `AccessPassInvalid` |
| A policy of their own | Not the address your program pinned → your constraint |
| Creating a pass for someone | Impossible: only the holder's own signature, over the required version's fingerprint, creates or advances it |

To see it from a terminal, against a local validator in a clone of the repository:

```bash
# Without --keypair, a fresh wallet (funded by airdrop on localnet) that has no pass.
pnpm --filter @stele/localnet vault-deposit -- --policy <policy address>
# ✘ rejected on-chain by the vault program — AccessPassMissing
```

### What Gate does not do

- **It is not KYC.** A wallet signature proves control of a key, not who holds it. Gate answers
  "which exact version did this wallet accept?", not "who is this?". Identity, jurisdiction and
  accreditation checks are outside Stele.
- **It is not a compliance engine.** It enforces one thing: acceptance of a required document
  version. Whether that satisfies a regulation is a question for your counsel.
- **It does not custody funds** or route your transactions.
- **It is only as good as your integration.** A program that forgets to pin the policy, or to call
  `require_current` in every protected instruction, is not protected.
- **The policy is the organization's.** Its owner, admins and publishers can change the requirement,
  including back to an older version; each change is a public on-chain event.
- **The Stele program is upgradeable** by its upgrade authority, as described in the
  [trust model](trust-model.md#program-authority). Stele currently runs on Devnet.

## Questions

**Does Stele Gate replace my frontend?** No. Your app keeps its UI; the SDK adds a window only when
acceptance is needed.

**What does the user pay?** Nothing for the acceptance. They pay your protected transaction as they
would without Stele.

**Can I gate several instructions?** Yes. Call `require_current` in each, with the same policy or
different ones.

**Can I require several documents?** Call `require_current` once per policy. Each document has its
own pass.

**What if Stele shuts down?** Your program's check, existing passes and verification keep working —
they live on Solana. For new acceptances, the organization opens a shard to everyone and wallets
record their own acceptances; see the guide's
["If Stele disappears"](gate-guide.md#if-stele-disappears).

**Can a user lose their pass?** No. Passes are never closed. Raising the requirement makes an older
pass insufficient, not invalid: the earlier acceptance remains verifiable.

**Can a passkey (Face ID) open a Gate?** No. A pass belongs to a Solana wallet, because the same
wallet must sign the protected transaction. Passkey acceptances remain available everywhere else in
Stele Proof.

## Reference

### Policy

A policy names the version of one document that a protected action requires.

| | |
|---|---|
| Address | PDA `["policy", document]` under the Stele program — one policy per document |
| Fields | `organization`, `document`, `required_version`, `required_version_hash` (the fingerprint of that version), `updated_by`, `created_at`, `updated_at` |
| Who can change it | The organization's owner, an admin or a publisher (on-chain roles), with a wallet signature; not while the organization is frozen |
| Size / rent | 157 bytes, paid once by the organization |

Publishing a new version does **not** change the policy. The organization chooses when to require it
(`set_policy_requirement`), so publishing a typo fix does not lock every investor out. The
requirement can name any published version, lower or higher; every change emits a `PolicyChanged`
event with the previous requirement.

### AccessPass

An AccessPass records the latest version of a document that one wallet accepted.

| | |
|---|---|
| Address | PDA `["access-pass", document, wallet]` under the Stele program — deterministic, so your program and the SDK derive it without a lookup |
| Fields | `organization`, `document`, `holder`, `version`, `version_number`, `version_hash`, `acceptance_id`, `accepted_at`, `accepted_slot`, `first_accepted_at`, `acceptance_count` |
| Created / advanced by | `record_gated_acceptance` only: a verified Ed25519 signature of the holder over the canonical acceptance payload (the same domain-separated, single-use payload as every Stele acceptance) |
| Size / rent | 233 bytes, ≈0.0025 SOL, paid by Stele's relayer — the user pays nothing |

The holder must be the wallet that signed the acceptance; the relayer cannot name another account.
Nobody — not Stele, not the organization — can create or advance a pass without the holder's
signature, and a pass never moves back to an older version. `acceptance_id` is the receipt of the
acceptance that last advanced it: `/receipt/<acceptance_id>`.

### Versions, step by step

1. The policy requires v1. An investor accepts v1 → their pass names v1 → deposits succeed.
2. The organization publishes v2. The policy still requires v1 → deposits still succeed.
3. The organization requires v2. The pass still names v1 — that acceptance stays on record and
   verifiable — but it no longer satisfies the policy: the next deposit fails with
   `AccessPassOutdated`.
4. The investor accepts v2 → the pass names v2 → deposits succeed again.

### What `require_current` checks

In this order — the first failure is returned:

| # | Check | Error |
|---|---|---|
| 1 | The policy is owned by the Stele program, has the policy layout and sits at its canonical address | `InvalidPolicy` (7600) |
| 2 | The user signed the transaction | `UserNotSigner` (7601) |
| 3 | The pass is owned by the Stele program with the pass layout (an empty account at the expected address means the user never accepted) | `AccessPassMissing` (7602) / `AccessPassInvalid` (7603) |
| 4 | The pass's holder is the user, and its document and organization are the policy's | `AccessPassMismatch` (7604) |
| 5 | The pass sits at its canonical address `["access-pass", document, user]` | `AccessPassInvalid` (7603) |
| 6 | The pass's version number is at least the required one | `AccessPassOutdated` (7605) |
| 7 | If it is the required version, its fingerprint equals the policy's | `FingerprintMismatch` (7606) |

It reads two accounts and never writes.

### Costs

| | |
|---|---|
| First gated acceptance (creates the pass) | 41,978 compute units; 10,000 lamports fee and 2,512,560 lamports (≈0.0025 SOL) pass rent, paid by Stele's relayer |
| Later gated acceptance (advances the pass) | 39,368 compute units; 10,000 lamports fee |
| `require_current` + the demo deposit | 9,406 compute units, part of your transaction |
| Policy | 157 bytes: 1,983,600 lamports (≈0.002 SOL) rent, paid by the organization once per document |

See [Measured costs](cost-analysis.md).
