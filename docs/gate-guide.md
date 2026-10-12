# Stele Gate: step-by-step guide

**What you will build:** a Solana program whose protected action (a deposit, a mint, a trade) runs
only for wallets that accepted your current terms — and a site that knows each user's status and
lets them accept in one click. About 15 minutes.

> [!TIP] Want to see it first?
> The [live demo](/demo) shows the finished result in two minutes. The [Stele Gate](gate.md) page
> explains the idea; this page is the recipe.

## Before you start

- A Stele organization with a **published document** — your terms (Dashboard → **Documents**).
- A Solana wallet (for example Phantom) with a little SOL on the network you use, to sign the
  policy transaction. Your users need no SOL to accept: Stele pays.
- An Anchor program, or [Solana Playground](https://beta.solpg.io) if you just want to try.

## Step 1 — Create the policy (2 minutes)

A **policy** says: "this action requires version N of this document".

1. Dashboard → **Gate → Policies**.
2. Next to your document, choose the version to require and click **Create policy**. Your wallet
   signs one transaction.
3. **Copy the policy address.** Your program will be pinned to it.

> [!NOTE] Publishing is not requiring
> Publishing a new version does not change the policy. You decide when to require it (same page,
> **Require** → newer version). A typo fix never locks your users out by accident.

## Step 2 — Add the check to your program (5 minutes)

Add the [`stele-gate` crate](https://crates.io/crates/stele-gate) — you call its function, you do
not copy any code:

```toml
[dependencies]
stele-gate = "1"   # needs anchor-lang 1.2 or later
```

Then add two accounts to the protected instruction — the policy and the user's AccessPass — and call
`stele_gate::require_current` before the action.

```rust
use anchor_lang::prelude::*;

/// Your policy from step 1. Pinned: the program accepts no other policy.
pub const POLICY: Pubkey = pubkey!("YOUR_POLICY_ADDRESS");

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub user: Signer<'info>,
    /// CHECK: pinned to POLICY; verified by require_current.
    #[account(address = POLICY)]
    pub policy: UncheckedAccount<'info>,
    /// CHECK: the user's AccessPass; verified by require_current.
    pub access_pass: UncheckedAccount<'info>,
    // … your own accounts
}

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    stele_gate::require_current(
        &ctx.accounts.access_pass,
        &ctx.accounts.policy,
        &ctx.accounts.user,
    )?;
    // … the protected action
    Ok(())
}
```

**One action, several documents?** Each document has its own policy (for example Terms of Service,
a Privacy Policy and a Risk Disclosure). Keep the list of required policies in your program and
check them all in one call — any number of them:

```rust
/// The policies a deposit requires — YOUR list, pinned in the program.
pub const REQUIRED: [Pubkey; 3] = [TERMS_POLICY, PRIVACY_POLICY, RISK_POLICY];

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    // The caller passes [policy, accessPass, policy, accessPass, …] as remaining accounts.
    stele_gate::require_policies(&REQUIRED, ctx.remaining_accounts, &ctx.accounts.user)?;
    // … the protected action
    Ok(())
}
```

The instruction needs no named account per document; add or remove a document by changing the
list. It fails if a required policy is missing from what the caller passed, or on the first one the
user has not accepted at the required version. The list must come from your program — never from
the caller, who could pass a policy that requires nothing. (With named accounts instead,
`stele_gate::require_all_current(&[(&pass, &policy), …], &user)` does the same.)

> [!IMPORTANT] Always pin the policy
> `#[account(address = POLICY)]` (or an address stored in your program's state). Without it, a caller
> could pass a policy of their own that requires nothing.

> [!DETAILS] Using Solana Playground? Copy the check instead of the crate
> Playground cannot add the `stele-gate` crate, so paste this function into `lib.rs` and call
> `require_current(&access_pass, &policy, &user)` the same way. It performs the same checks.
>
> ```rust
> const STELE_PROGRAM: Pubkey = pubkey!("6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV");
> const POLICY_DISCRIMINATOR: [u8; 8] = [3, 77, 45, 55, 30, 166, 143, 147];
> const PASS_DISCRIMINATOR: [u8; 8] = [24, 47, 32, 42, 150, 120, 87, 169];
>
> #[error_code]
> pub enum GateError {
>     InvalidPolicy, UserNotSigner, AccessPassMissing, AccessPassInvalid,
>     AccessPassMismatch, AccessPassOutdated, FingerprintMismatch,
> }
>
> fn key_at(d: &[u8], at: usize) -> Pubkey { Pubkey::try_from(&d[at..at + 32]).unwrap() }
> fn u32_at(d: &[u8], at: usize) -> u32 { u32::from_le_bytes(d[at..at + 4].try_into().unwrap()) }
>
> fn require_current(pass: &AccountInfo, policy: &AccountInfo, user: &AccountInfo) -> Result<u32> {
>     let p = policy.try_borrow_data()?;
>     require!(*policy.owner == STELE_PROGRAM && p.len() >= 157 && p[..8] == POLICY_DISCRIMINATOR,
>         GateError::InvalidPolicy);
>     let (organization, document) = (key_at(&p, 8), key_at(&p, 40));
>     let canonical = Pubkey::create_program_address(
>         &[b"policy", document.as_ref(), &[p[156]]], &STELE_PROGRAM)
>         .map_err(|_| GateError::InvalidPolicy)?;
>     require_keys_eq!(canonical, policy.key(), GateError::InvalidPolicy);
>     require!(user.is_signer, GateError::UserNotSigner);
>     let (expected, _) = Pubkey::find_program_address(
>         &[b"access-pass", document.as_ref(), user.key.as_ref()], &STELE_PROGRAM);
>     if *pass.owner != STELE_PROGRAM {
>         return Err(if pass.key() == expected { GateError::AccessPassMissing }
>                    else { GateError::AccessPassInvalid }.into());
>     }
>     let d = pass.try_borrow_data()?;
>     require!(d.len() >= 233 && d[..8] == PASS_DISCRIMINATOR, GateError::AccessPassInvalid);
>     require!(key_at(&d, 72) == *user.key && key_at(&d, 40) == document
>         && key_at(&d, 8) == organization, GateError::AccessPassMismatch);
>     require_keys_eq!(pass.key(), expected, GateError::AccessPassInvalid);
>     let version = u32_at(&d, 224);
>     require!(version >= u32_at(&p, 152), GateError::AccessPassOutdated);
>     if version == u32_at(&p, 152) {
>         require!(d[136..168] == p[72..104], GateError::FingerprintMismatch);
>     }
>     Ok(version)
> }
> ```

**Why a check inside your program, and not a call to Stele?** It is the cheaper and safer option:

| | Check inside your program (Stele Gate) | Calling another program (CPI) |
|---|---|---|
| Transaction fee | Unchanged — Solana charges per signature | Unchanged |
| Compute | Reads two accounts: a few thousand compute units (the whole demo deposit uses 9,406) | Adds the cost of the call itself, on top of the same reads |
| Who is in your transaction | Only your program | Another program runs inside your action and can make it fail or change |
| If Stele's servers are down | Still works — it reads Solana accounts | Same, but you depend on another program's upgrades |

Your program also gets bigger by a few kilobytes, which costs a little more rent once, at deploy.

## Step 3 — Pass the user's AccessPass to the instruction

Every wallet's AccessPass has a fixed address, so your app computes it — no lookup:

```text
AccessPass = PDA of ["access-pass", document, wallet] under the Stele program
             6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV
```

The `document` is shown on the Policies page and stored inside the policy (bytes 40–72).

```ts
import { getAddressEncoder, getProgramDerivedAddress, address } from "@solana/kit";

const STELE = address("6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV");
const enc = getAddressEncoder();
const [accessPass] = await getProgramDerivedAddress({
  programAddress: STELE,
  seeds: ["access-pass", enc.encode(document), enc.encode(wallet)],
});
// Add `policy` and `accessPass` to your instruction's accounts, as in step 2.
```

The address exists even before the user accepts: then the account is empty and your program
refuses with `AccessPassMissing`.

## Step 4 — Know each user's status on your site

Your site can ask "has this wallet accepted the required version?" in three ways. The answer is
for your interface — the decision is always your program's.

**With the SDK** (also verifies the document text against Solana):

```ts
const access = await stele.check(POLICY, wallet.address);
// access.status: "VALID" | "MISSING" | "OUTDATED"
// access.requiredVersion, access.pass?.versionNumber, access.accessPass (the address from step 3)
```

**With one HTTP request** (any language):

```bash
curl "https://app.stele.example/api/v1/public/gate/access?policy=<POLICY>&holder=<WALLET>"
```

```json
{
  "status": "VALID",
  "requiredVersion": 3,
  "accessPass": "9fZqgGKaf98xuxsH1NUMegFksETzWgG3f2J55WGGB6Mh",
  "pass": { "versionNumber": 3, "acceptedAt": 1791486069 }
}
```

**Straight from Solana** (no Stele server at all): read the AccessPass account from step 3. No account
→ `MISSING`. Otherwise its version number (u32, little-endian, bytes 224–228) compared with the
policy's required version (bytes 152–156): lower → `OUTDATED`, equal or higher → `VALID`.

## Step 5 — Let users accept: "Accept & Continue"

Wrap the protected action with `gate()`. It checks the status first and opens the Stele window only
when needed:

```ts
import { createSteleGate } from "@stelehq/sdk";

const stele = createSteleGate({
  apiBaseUrl: "https://app.stele.example/api",
  wallet: { address: wallet.publicKey.toBase58(), signMessage: (m) => wallet.signMessage(m) },
});

await stele.gate({
  policy: POLICY,
  action: () => sendDepositTransaction(), // your transaction, with policy + accessPass
  acceptLabel: "Accept & Continue",
});
```

- **Status VALID** → your action runs immediately; the user sees nothing extra.
- **MISSING or OUTDATED** → the Stele window shows the exact required text; the user signs a message
  (free); the AccessPass is created or updated on Solana; then your action runs.
- **The user closes the window** → `GateCancelledError`; your action never runs.

> [!NOTE] Each version is accepted once
> A wallet that already accepted the current version is not recorded again: Stele refuses before
> anyone signs (`409 already_accepted`, with the earlier acceptance's id), so no fee is spent twice —
> and the Stele program itself refuses a second record of the same version
> (`AccessPassAlreadyCurrent`), whoever submits it. A new acceptance happens only when you require a
> newer version.

## Step 6 — Test the bypass

Call your instruction directly — without your site — and check each case:

| Who calls | Expected |
|---|---|
| A wallet that never accepted | refused: `AccessPassMissing` |
| A wallet that accepted the required version | allowed |
| You raise the requirement; a wallet with the old version | refused: `AccessPassOutdated` |
| Another wallet presenting someone's AccessPass | refused: `AccessPassMismatch` |
| Any other policy than yours | refused by your `address = POLICY` constraint |

Dashboard → **Gate → Testing** runs these against your policy. In Playground, the **Test** tab
works: fill `user`, `policy` and `accessPass` (step 3's address) and press **Test**.

## Step 7 — Go live

1. Dashboard → **Gate → Program integration**: register your program's address and instruction.
   The Gate overview then lists your program's real transactions — allowed and refused, with
   reasons.
2. Deploy to Devnet, test with real users, then Mainnet. Stele currently runs on Devnet.

## If Stele disappears

Your users' access does not depend on Stele the company:

| | Without Stele's servers |
|---|---|
| Your program's check | Keeps working: it reads two Solana accounts. |
| Existing AccessPasses | Stay on Solana, valid as they are. |
| Verifying an acceptance | The open-source verifier checks receipts against Solana; receipts carry the document text. |
| New acceptances | The organization opens a nonce shard to everyone (once, with its own key); then any wallet records its own acceptance, paying the network fee and pass rent (≈0.0025 SOL). |

Both steps are a script in the Stele repository, built only from the open-source `@stelehq/protocol`
package — no Stele API, no Stele relayer:

```bash
# Once, by the organization (owner key): open a shard to any wallet.
pnpm --filter @stele/localnet self-accept -- --policy <POLICY> --keypair owner.json --open-shard
# Any wallet: rebuild the exact message from Solana, sign it, submit it yourself.
pnpm --filter @stele/localnet self-accept -- --policy <POLICY> --keypair wallet.json
# ✓ Accepted without Stele · AccessPass … now names version 1
```

Set `STELE_RPC_URL` to the network's RPC (for example `https://api.devnet.solana.com`). The program
itself is upgradeable by Stele's upgrade authority today; it moves to a multisig before Mainnet, as
the [trust model](trust-model.md#program-authority) describes.

## Reference: account layouts

Offsets include Anchor's 8-byte discriminator. Both accounts are owned by the Stele program.

| Account | Field | Bytes |
|---|---|---|
| Policy (157 bytes) | organization | 8–40 |
| | document | 40–72 |
| | required version fingerprint | 72–104 |
| | required version number (u32 LE) | 152–156 |
| AccessPass (233 bytes) | organization | 8–40 |
| | document | 40–72 |
| | holder (the wallet) | 72–104 |
| | accepted version fingerprint | 136–168 |
| | accepted version number (u32 LE) | 224–228 |

The full rules and error codes are on the [Stele Gate](gate.md) page.
