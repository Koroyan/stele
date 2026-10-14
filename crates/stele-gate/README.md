# stele-gate

Require a current **Stele** acceptance before a protected action in your Solana program — one
function call.

```toml
[dependencies]
stele-gate = "1.1"
```

```rust
use anchor_lang::prelude::*;

pub const POLICY: Pubkey = pubkey!("YOUR_POLICY_ADDRESS"); // Stele dashboard → Gate → Policies

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub user: Signer<'info>,
    /// CHECK: pinned to POLICY; verified by require_current_passport.
    #[account(address = POLICY)]
    pub policy: UncheckedAccount<'info>,
    /// CHECK: the user's Stele passport (stele_gate::passport_address(user).0); verified below.
    pub passport: UncheckedAccount<'info>,
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

`require_current_passport` succeeds only if `user` signed the transaction and their Stele
**passport** — one account per wallet, holding an entry for every document the wallet accepted —
names the policy's document at the required version or later. Otherwise the transaction fails with
`ProgramError::Custom(7600..=7606)`: `AccessPassMissing`, `AccessPassOutdated`,
`AccessPassMismatch`, …

The client derives the passport address from the wallet alone (`["passport", user]` under the Stele
program): `passport_address(user)` here, `findPassportPda(user)` in `@stelehq/protocol`. Stele
records the entry when the wallet accepts the document; the check itself costs no fee and about
10k compute units, whether the wallet accepted one document or ten thousand.

- **No CPI, no proxy:** your program reads two accounts owned by the Stele program and decides.
  Stele's servers are not involved in the protected transaction.
- **Pin the policy** (`#[account(address = …)]` or an address in your state), or a caller could pass a
  policy of their own.
- **Several documents:** `require_passport_policies(&REQUIRED, ctx.remaining_accounts, &passport,
  &user)` — `REQUIRED` is your pinned list of policies, the caller passes the policies as remaining
  accounts and one passport for all of them.
- **Per-document access passes:** organizations that keep the earlier storage write an access pass
  per (document, wallet); check it with `require_current(&access_pass, &policy, &user)` and
  `require_policies` (pairs `[policy, access_pass, …]`).
- Helpers: `passport_address(holder)`, `access_pass_address(document, holder)` and
  `policy_address(document)` derive the PDAs.

Requires `anchor-lang` 1.2 or later. Guide: the Stele documentation, "Stele Gate: step by step".

License: Apache-2.0.
