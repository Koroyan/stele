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
   wallet. It is free for the user. Solana now holds an entry in the user's **passport** — one Stele
   account per wallet, listing every document it accepted: "this wallet accepted version 2".
3. **Your program checks the passport.** One call, `require_current_passport()`, before the action.
   No entry, an old version or someone else's passport, and the transaction fails.

```text
Organization ── publishes ──▶ Document v1, v2 …                   (Stele program)
Organization ── sets ───────▶ Policy: "requires ≥ v2"              (Stele program)
User wallet ─── accepts v2 ─▶ Passport: "Offering Terms → v2, …"   (Stele program)

User wallet ─── deposit ────▶ Your program
                              └─ require_current_passport(passport, policy, user)  ✓ or ✕
```

When you require a new version, older entries stop working until the user accepts again. Nothing is
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
> how your site reads each user's passport and how to test in Solana Playground.

### 1. Create the policy

In the dashboard: publish the document (**Documents**), turn on Stele Gate for the organization,
then **Gate → Policies → Create policy**. Copy the policy address.

### 2. Call `require_current_passport` in your program

Add the policy and the user's passport to the protected instruction, and call
`require_current_passport` before the action.

> [!IMPORTANT] Pin the policy address
> Store it in your program's state or make it a constant, as `#[account(address = vault.policy)]`
> does below. Otherwise a caller could pass a policy of their own.

```rust
// Cargo.toml: stele-gate = "1.1"
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct DepositWithPassport<'info> {
    pub investor: Signer<'info>,
    #[account(mut, seeds = [b"vault", vault.policy.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: pinned to the vault's policy; verified by require_current_passport.
    #[account(address = vault.policy)]
    pub policy: UncheckedAccount<'info>,
    /// CHECK: the investor's Stele passport; verified by require_current_passport.
    pub passport: UncheckedAccount<'info>,
}

pub fn deposit_with_passport(ctx: Context<DepositWithPassport>, amount: u64) -> Result<()> {
    let granted = stele_gate::require_current_passport(
        &ctx.accounts.passport,
        &ctx.accounts.policy,
        &ctx.accounts.investor,
    )?;
    // granted.version_number and granted.accepted_at name the acceptance that allowed
    // this deposit — useful in your own events.
    // … the protected action
    Ok(())
}
```

This is the deposit of the Atlas Real Estate Vault from the live demo (`programs/gate-demo`),
shortened. Several documents for one action (terms, privacy, risk disclosure): one passport and
`require_passport_policies(&REQUIRED, ctx.remaining_accounts, &passport, &user)`. The crate is [`stele-gate` on crates.io](https://crates.io/crates/stele-gate) (source:
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

- **The acceptance is current** → it runs `action` right away. The user sees nothing extra.
- **Missing or outdated** → it opens the Stele window with the exact text of the required version
  (checked against Solana), records the acceptance, waits until it is visible on-chain, then runs
  `action`.
- **The user closes the window** → it throws `GateCancelledError`; `action` never runs.

For your own UI, pass `ui: "none"`: `gate()` then throws `AccessRequiredError` instead of opening the
window, and `stele.check(policy, wallet)` returns the status without prompting. The SDK is in the
Stele repository (`packages/sdk`); in a plain HTML page, load `/sdk/v1/stele.js` and use
`Stele.createGate()`.

### Then: test the bypass

Your tests should cover at least:

| Scenario | Expected |
|---|---|
| Never accepted | `AccessPassMissing` (7602) |
| Accepted the required version | success |
| Policy raised to a newer version, old entry | `AccessPassOutdated` (7605) |
| Another wallet's passport | `AccessPassMismatch` (7604) |
| A policy that is not the pinned one | your constraint (the demo: `WrongPolicy`) |

The dashboard's **Gate → Testing** runs the same scenarios live against your policy, and against
the demo vault's `deposit` by simulation.

## Stele Verified

Your users cannot read your program, so give them proof instead: a **Stele Verified** badge on your
site that opens public evidence that your program really waits for the current terms.

```html
<script src="https://stele.site/sdk/v1/stele.js" defer></script>
<span data-stele-verified="YOUR_PROGRAM_ID"></span>
```

(React: `<SteleVerifiedBadge program="YOUR_PROGRAM_ID" />` from `@stelehq/sdk/react`; README:
`https://stele.site/api/v1/public/verified/YOUR_PROGRAM_ID/badge.svg`.)

**How Stele checks it.** In the dashboard (**Gate → Verification**) you describe how your protected
instruction is called: its data and its accounts, with the user, their passport and your policy as
placeholders. Stele then simulates that instruction against your **deployed** program — nothing is
signed or sent — in three scenarios:

| Scenario | A verified program |
|---|---|
| A wallet that never accepted the terms | is refused by the Stele check (`AccessPassMissing`) |
| A wallet that accepted the required version | is not refused by the Stele check |
| A wallet presenting someone else's acceptance | is refused by the Stele check |

A program passes only if the Stele check of **your** policy is what decides — a refusal for another
reason, or another organization's policy, fails. The deployed code is fingerprinted (sha256), and
Stele re-runs the probes whenever the program is upgraded or its upgrade authority changes (checked
every minute), and at least every six hours. A status change is sent as the
`gate.program_verification_changed` webhook.

**Ownership.** Your program's upgrade authority signs a memo `stele-verify <program> <organization>`
— from the dashboard with the connected wallet, or from a multisig (paste the transaction
signature). An immutable program has no authority: it cannot change, which is stronger still.

**What a visitor sees** at `stele.site/verified/<program>`: what was checked and when, the terms and
version, the code fingerprint, who can change the program (nobody, a multisig or a single key), the
ownership proof — and a **Re-check in my browser** button that runs the same three simulations from
the visitor's browser against Solana, so nobody has to trust Stele's word.

**Copies of the badge.** The live badge reads "Not valid on this site" outside your verified
domains, and the evidence page warns when the visitor came from another site. A static image can be
copied anywhere, so the page always states which websites the verification belongs to.

**What it does not prove.** That a website sends the user to this program (their wallet shows the
program they sign for — the page tells them to compare), who controls a wallet, or anything about
the program besides this check. It is not an audit.

## Good to know

### "Accept & Continue" is two transactions

1. **The acceptance.** The user signs a message (not a transaction); Stele's relayer submits it and
   pays the fee and the passport deposit.
2. **Your action.** The user signs your transaction as usual.

They are not atomic:

- If the second transaction fails or the user rejects it, the acceptance stays recorded and the
  passport entry stays current. The user does not have to accept again.
- If the organization requires a newer version between the two, the action fails with
  `AccessPassOutdated` and the next attempt shows the window again.
- If the document changes while the window is open, the SDK refuses to sign the old text and loads
  the new version.

### Why a direct call fails

A Solana program cannot know which website a transaction came from. `require_current_passport`
runs inside the program that executes the action, so it holds for every caller:

| Someone tries… | Result |
|---|---|
| A wallet that never accepted | No passport, or no entry for the document → `AccessPassMissing` |
| Someone else's passport | The passport's holder is not the signer → `AccessPassMismatch` |
| A forged account | Not owned by the Stele program, or not at the canonical address → `AccessPassInvalid` |
| A policy of their own | Not the address your program pinned → your constraint |
| Writing an entry for someone | Impossible: the program writes only into the passport of the wallet whose signature it verified, over the required version's fingerprint |

To see it from a terminal, against a local validator in a clone of the repository:

```bash
# Without --keypair, a fresh wallet (funded by airdrop on localnet) that never accepted.
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
  `require_current_passport` in every protected instruction, is not protected.
- **The policy is the organization's.** Its owner, admins and publishers can change the requirement,
  including back to an older version; each change is a public on-chain event.
- **The Stele program is upgradeable** by its upgrade authority, as described in the
  [trust model](trust-model.md#program-authority). Stele currently runs on Devnet.

## Questions

**Does Stele Gate replace my frontend?** No. Your app keeps its UI; the SDK adds a window only when
acceptance is needed.

**What does the user pay?** Nothing for the acceptance. They pay your protected transaction as they
would without Stele; the check adds no fee.

**Can I gate several instructions?** Yes. Call `require_current_passport` in each, with the same
policy or different ones.

**Can I require several documents?** Yes: `require_passport_policies` checks a pinned list of
policies against the one passport — N documents, N + 1 accounts.

**What if Stele shuts down?** Your program's check, existing passports and verification keep
working — they live on Solana. For new acceptances, the organization opens a shard to everyone and wallets
record their own acceptances; see the guide's
["If Stele disappears"](gate-guide.md#if-stele-disappears).

**Can a user lose their entry?** Only by choice: the holder (or whoever paid an entry's deposit) can
remove it, and the deposit returns to its payer. Raising the requirement makes an older entry
insufficient, not invalid. Either way the earlier acceptance remains verifiable.

**Can a passkey (Face ID) open a Gate?** No. A passport belongs to a Solana wallet, because the same
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

### Passport

A passport records, for one wallet, the latest version it accepted of every gated document.

| | |
|---|---|
| Address | PDA `["passport", wallet]` under the Stele program — deterministic, so your program and the SDK derive it from the wallet alone |
| Contents | `holder`, `base_payer`, and one entry per document, sorted: `document`, `version_number`, `accepted_at`, `payer` |
| Written by | `record_passport_acceptance` only: a verified Ed25519 signature of the holder over the canonical acceptance payload (the same domain-separated, single-use payload as every Stele acceptance) |
| Size / deposit | 77 bytes + 76 per document: 1,955,760 lamports (≈0.002 SOL) for the first document, 528,960 (≈0.0005 SOL) for each further one. Paid by Stele's relayer today — the user pays nothing — and refundable to whoever paid it |

The program derives the passport from the wallet whose signature it verified; the relayer cannot
name another account. Nobody — not Stele, not the organization — can add or advance an entry without
the holder's signature, and an entry never moves back to an older version. The acceptance
identifier of each acceptance is in its `PassportUpdated` event and its receipt
(`/receipt/<acceptance_id>`).

The holder, or whoever paid an entry's deposit, can remove the entry (`remove_passport_entry`); the
deposit returns to its payer. Receipts still verify; protected programs refuse the wallet for that
document until it accepts again.

> [!NOTE] Per-document access passes
> Organizations can instead keep one **AccessPass** per (document, wallet) — PDA
> `["access-pass", document, wallet]`, 233 bytes, ≈0.0025 SOL each, never closed — and check it
> with `require_current(&access_pass, &policy, &user)`: organization setting `gateStorage: "pass"`
> (`PATCH /v1/organizations/:id/settings`). The SDK and the API read both.

### Versions, step by step

1. The policy requires v1. An investor accepts v1 → their passport's entry names v1 → deposits
   succeed.
2. The organization publishes v2. The policy still requires v1 → deposits still succeed.
3. The organization requires v2. The entry still names v1 — that acceptance stays on record and
   verifiable — but it no longer satisfies the policy: the next deposit fails with
   `AccessPassOutdated`.
4. The investor accepts v2 → the entry is advanced in place (no new deposit) → deposits succeed
   again.

### What `require_current_passport` checks

In this order — the first failure is returned:

| # | Check | Error |
|---|---|---|
| 1 | The policy is owned by the Stele program, has the policy layout and sits at its canonical address | `InvalidPolicy` (7600) |
| 2 | The user signed the transaction | `UserNotSigner` (7601) |
| 3 | The passport is owned by the Stele program (an empty account at the user's passport address means the user never accepted) | `AccessPassMissing` (7602) / `AccessPassInvalid` (7603) |
| 4 | It has the passport layout, and its length matches its entry count | `AccessPassInvalid` (7603) |
| 5 | Its holder is the user | `AccessPassMismatch` (7604) |
| 6 | It sits at its canonical address `["passport", user]` | `AccessPassInvalid` (7603) |
| 7 | It has an entry for the policy's document (binary search) | `AccessPassMissing` (7602) |
| 8 | The entry's version number is at least the required one | `AccessPassOutdated` (7605) |

It reads two accounts and never writes. A document's version numbers never change once published,
so the version number alone identifies the accepted text.

### Costs

Measured on the real program binaries, for 1 to 1,000,000 investors — the numbers do not change with
the number of users.

| | |
|---|---|
| First gated acceptance (creates the passport) | ≈44,000 compute units; 10,000 lamports fee and a 1,955,760 lamports deposit (refundable), paid by Stele's relayer |
| Each further document | ≈44,000 compute units; 10,000 lamports fee and a 528,960 lamports deposit (refundable) |
| Accepting a newer version | ≈36,500 compute units; 10,000 lamports fee; no new deposit |
| `require_current_passport` + the demo deposit | ≈9,200 compute units (≈10,800 with 10,000 documents in the passport); no extra fee |
| Policy | 157 bytes: 1,983,600 lamports (≈0.002 SOL) rent, paid by the organization once per document |

See [Measured costs](cost-analysis.md).
