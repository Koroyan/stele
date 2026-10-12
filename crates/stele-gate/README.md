# stele-gate

Require a current **Stele** acceptance before a protected action in your Solana program — one
function call.

```toml
[dependencies]
stele-gate = "1"
```

```rust
use anchor_lang::prelude::*;

pub const POLICY: Pubkey = pubkey!("YOUR_POLICY_ADDRESS"); // Stele dashboard → Gate → Policies

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub user: Signer<'info>,
    /// CHECK: pinned to POLICY; verified by require_current.
    #[account(address = POLICY)]
    pub policy: UncheckedAccount<'info>,
    /// CHECK: the user's Stele AccessPass; verified by require_current.
    pub access_pass: UncheckedAccount<'info>,
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

`require_current` succeeds only if `user` signed the transaction and holds a Stele AccessPass that
names the policy's required version of the document (or a later one). Otherwise the transaction
fails with `ProgramError::Custom(7600..=7606)`: `AccessPassMissing`, `AccessPassOutdated`,
`AccessPassMismatch`, …

- **No CPI, no proxy:** your program reads two accounts owned by the Stele program and decides.
  Stele's servers are not involved in the protected transaction.
- **Pin the policy** (`#[account(address = …)]` or an address in your state), or a caller could pass a
  policy of their own.
- **Several documents:** `require_policies(&REQUIRED, ctx.remaining_accounts, &user)` checks a
  list of any length — `REQUIRED` is your pinned list of policies, the caller passes
  `[policy, access_pass, …]` pairs as remaining accounts.
- Helpers: `access_pass_address(document, holder)` and `policy_address(document)` derive the PDAs.

Requires `anchor-lang` 1.2 or later. Guide: the Stele documentation, "Stele Gate: step by step".

License: Apache-2.0.
