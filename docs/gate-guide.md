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
stele-gate = "1.1"   # needs anchor-lang 1.2 or later
```

Then add two accounts to the protected instruction — the policy and the user's **passport** (one
Stele account per wallet, with an entry for every document it accepted) — and call
`stele_gate::require_current_passport` before the action.

```rust
use anchor_lang::prelude::*;

/// Your policy from step 1. Pinned: the program accepts no other policy.
pub const POLICY: Pubkey = pubkey!("YOUR_POLICY_ADDRESS");

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub user: Signer<'info>,
    /// CHECK: pinned to POLICY; verified by require_current_passport.
    #[account(address = POLICY)]
    pub policy: UncheckedAccount<'info>,
    /// CHECK: the user's Stele passport; verified by require_current_passport.
    pub passport: UncheckedAccount<'info>,
    // … your own accounts
}

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    stele_gate::require_current_passport(
        &ctx.accounts.passport,
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
    // The caller passes the policies as remaining accounts; one passport covers all of them.
    stele_gate::require_passport_policies(
        &REQUIRED,
        ctx.remaining_accounts,
        &ctx.accounts.passport,
        &ctx.accounts.user,
    )?;
    // … the protected action
    Ok(())
}
```

The instruction needs no named account per document — N documents take N + 1 accounts; add or
remove a document by changing the list. It fails if a required policy is missing from what the
caller passed, or on the first one the user has not accepted at the required version. The list must
come from your program — never from the caller, who could pass a policy that requires nothing.

> [!NOTE] Organizations on per-document access passes
> If your organization keeps one AccessPass per document (organization setting
> `gateStorage: "pass"`), call `stele_gate::require_current(&access_pass, &policy, &user)` and
> `require_policies` instead — same rules, PDA `["access-pass", document, wallet]`.

> [!IMPORTANT] Always pin the policy
> `#[account(address = POLICY)]` (or an address stored in your program's state). Without it, a caller
> could pass a policy of their own that requires nothing.

> [!DETAILS] Using Solana Playground? Copy the check instead of the crate
> Playground cannot add the `stele-gate` crate, so paste this function into `lib.rs` and call
> `require_current_passport(&passport, &policy, &user)` the same way. It performs the same checks.
>
> ```rust
> const STELE_PROGRAM: Pubkey = pubkey!("6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV");
> const POLICY_DISCRIMINATOR: [u8; 8] = [3, 77, 45, 55, 30, 166, 143, 147];
> const PASSPORT_DISCRIMINATOR: [u8; 8] = [18, 61, 245, 239, 6, 15, 18, 34];
>
> #[error_code]
> pub enum GateError {
>     InvalidPolicy, UserNotSigner, AccessPassMissing, AccessPassInvalid,
>     AccessPassMismatch, AccessPassOutdated,
> }
>
> fn key_at(d: &[u8], at: usize) -> Pubkey { Pubkey::try_from(&d[at..at + 32]).unwrap() }
> fn u32_at(d: &[u8], at: usize) -> u32 { u32::from_le_bytes(d[at..at + 4].try_into().unwrap()) }
>
> fn require_current_passport(
>     passport: &AccountInfo, policy: &AccountInfo, user: &AccountInfo,
> ) -> Result<u32> {
>     let p = policy.try_borrow_data()?;
>     require!(*policy.owner == STELE_PROGRAM && p.len() >= 157 && p[..8] == POLICY_DISCRIMINATOR,
>         GateError::InvalidPolicy);
>     let document = key_at(&p, 40);
>     let canonical = Pubkey::create_program_address(
>         &[b"policy", document.as_ref(), &[p[156]]], &STELE_PROGRAM)
>         .map_err(|_| GateError::InvalidPolicy)?;
>     require_keys_eq!(canonical, policy.key(), GateError::InvalidPolicy);
>     require!(user.is_signer, GateError::UserNotSigner);
>     if *passport.owner != STELE_PROGRAM {
>         let (expected, _) = Pubkey::find_program_address(
>             &[b"passport", user.key.as_ref()], &STELE_PROGRAM);
>         return Err(if passport.key() == expected { GateError::AccessPassMissing }
>                    else { GateError::AccessPassInvalid }.into());
>     }
>     let d = passport.try_borrow_data()?;
>     require!(d.len() >= 77 && d[..8] == PASSPORT_DISCRIMINATOR, GateError::AccessPassInvalid);
>     require!(key_at(&d, 8) == *user.key, GateError::AccessPassMismatch);
>     let canonical = Pubkey::create_program_address(
>         &[b"passport", user.key.as_ref(), &[d[44]]], &STELE_PROGRAM)
>         .map_err(|_| GateError::AccessPassInvalid)?;
>     require_keys_eq!(canonical, passport.key(), GateError::AccessPassInvalid);
>     let count = u32_at(&d, 40) as usize;
>     require!(d.len() == 77 + 76 * count, GateError::AccessPassInvalid);
>     // Entries (76 bytes each) are sorted by document: binary search.
>     let wanted = document.to_bytes();
>     let (mut lo, mut hi) = (0, count);
>     while lo < hi {
>         let mid = (lo + hi) / 2;
>         let at = 77 + 76 * mid;
>         match d[at..at + 32].cmp(&wanted[..]) {
>             std::cmp::Ordering::Less => lo = mid + 1,
>             std::cmp::Ordering::Greater => hi = mid,
>             std::cmp::Ordering::Equal => {
>                 let version = u32_at(&d, at + 32);
>                 require!(version >= u32_at(&p, 152), GateError::AccessPassOutdated);
>                 return Ok(version);
>             }
>         }
>     }
>     err!(GateError::AccessPassMissing)
> }
> ```

**Why a check inside your program, and not a call to Stele?** It is the cheaper and safer option:

| | Check inside your program (Stele Gate) | Calling another program (CPI) |
|---|---|---|
| Transaction fee | Unchanged — Solana charges per signature | Unchanged |
| Compute | Reads two accounts: a few thousand compute units (the whole demo deposit uses ≈9,200) | Adds the cost of the call itself, on top of the same reads |
| Who is in your transaction | Only your program | Another program runs inside your action and can make it fail or change |
| If Stele's servers are down | Still works — it reads Solana accounts | Same, but you depend on another program's upgrades |

Your program also gets bigger by a few kilobytes, which costs a little more rent once, at deploy.

## Step 3 — Pass the user's passport to the instruction

Every wallet's passport has a fixed address, so your app computes it from the wallet alone — no
lookup, and the same address for every document:

```text
Passport = PDA of ["passport", wallet] under the Stele program
           6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV
```

```ts
import { findPassportPda } from "@stelehq/protocol";

const [passport] = await findPassportPda(wallet);
// Add `policy` and `passport` to your instruction's accounts, as in step 2.
```

Without the package:

```ts
import { getAddressEncoder, getProgramDerivedAddress, address } from "@solana/kit";

const STELE = address("6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV");
const [passport] = await getProgramDerivedAddress({
  programAddress: STELE,
  seeds: ["passport", getAddressEncoder().encode(wallet)],
});
```

The address exists even before the user accepts anything: then the account is empty and your
program refuses with `AccessPassMissing`.

## Step 4 — Know each user's status on your site

Your site can ask "has this wallet accepted the required version?" in three ways. The answer is
for your interface — the decision is always your program's.

**With the SDK** (also verifies the document text against Solana):

```ts
const access = await stele.check(POLICY, wallet.address);
// access.status: "VALID" | "MISSING" | "OUTDATED"
// access.requiredVersion, access.passportEntry?.versionNumber, access.passport (step 3's address)
```

**With one HTTP request** (any language):

```bash
curl "https://app.stele.example/api/v1/public/gate/access?policy=<POLICY>&holder=<WALLET>"
```

```json
{
  "status": "VALID",
  "requiredVersion": 3,
  "storage": "passport",
  "passport": "9fZqgGKaf98xuxsH1NUMegFksETzWgG3f2J55WGGB6Mh",
  "passportEntry": { "versionNumber": 3, "acceptedAt": 1791486069 }
}
```

**Straight from Solana** (no Stele server at all): read the passport account from step 3 and find
the entry whose first 32 bytes are the policy's document (bytes 40–72 of the policy). No account or
no entry → `MISSING`. Otherwise the entry's version number (u32, little-endian, 32 bytes into the
entry) compared with the policy's required version (bytes 152–156): lower → `OUTDATED`, equal or
higher → `VALID`. `readAccess(rpc, { policy, holder })` in `@stelehq/protocol` does exactly this.

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
  action: () => sendDepositTransaction(), // your transaction, with policy + passport
  acceptLabel: "Accept & Continue",
});
```

- **Status VALID** → your action runs immediately; the user sees nothing extra.
- **MISSING or OUTDATED** → the Stele window shows the exact required text; the user signs a message
  (free); the entry is added to (or advanced in) their passport on Solana; then your action runs.
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
| Another wallet presenting someone's passport | refused: `AccessPassMismatch` |
| Any other policy than yours | refused by your `address = POLICY` constraint |

Dashboard → **Gate → Testing** runs these against your policy. In Playground, the **Test** tab
works: fill `user`, `policy` and `passport` (step 3's address) and press **Test**.

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
| Existing passports | Stay on Solana, valid as they are. |
| Verifying an acceptance | The open-source verifier checks receipts against Solana; receipts carry the document text. |
| New acceptances | The organization opens a nonce shard to everyone (once, with its own key); then any wallet records its own acceptance into its own passport, paying the network fee and a refundable deposit (≈0.002 SOL for the first document, ≈0.0005 for each further one). |

Both steps are a script in the Stele repository, built only from the open-source `@stelehq/protocol`
package — no Stele API, no Stele relayer:

```bash
# Once, by the organization (owner key): open a shard to any wallet.
pnpm --filter @stele/localnet self-accept -- --policy <POLICY> --keypair owner.json --open-shard
# Any wallet: rebuild the exact message from Solana, sign it, submit it yourself.
pnpm --filter @stele/localnet self-accept -- --policy <POLICY> --keypair wallet.json
# ✓ Accepted without Stele · Passport … now names version 1 of the document
```

Set `STELE_RPC_URL` to the network's RPC (for example `https://api.devnet.solana.com`). The program
itself is upgradeable by Stele's upgrade authority today; it moves to a multisig before Mainnet, as
the [trust model](trust-model.md#program-authority) describes.

## Reference: account layouts

Offsets include Anchor's 8-byte discriminator. All accounts are owned by the Stele program.

| Account | Field | Bytes |
|---|---|---|
| Policy (157 bytes) | organization | 8–40 |
| | document | 40–72 |
| | required version fingerprint | 72–104 |
| | required version number (u32 LE) | 152–156 |
| Passport (77 + 76 × entries) | holder (the wallet) | 8–40 |
| | entry count (u32 LE) | 40–44 |
| | bump | 44 |
| | base payer (refunded on close) | 45–77 |
| | entry *i*, sorted by document | 77 + 76·*i* … |
| Passport entry (76 bytes) | document | +0–32 |
| | accepted version number (u32 LE) | +32–36 |
| | accepted at (i64 LE, Unix seconds) | +36–44 |
| | payer of this entry's deposit | +44–76 |
| AccessPass (233 bytes, per-document storage) | holder | 72–104 |
| | accepted version number (u32 LE) | 224–228 |

The full rules and error codes are on the [Stele Gate](gate.md) page.
