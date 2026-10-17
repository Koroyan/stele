# Northwind Shop: a complete Stele integration

A small online store that uses every part of Stele, so you can try the whole product by hand and
read how each piece is integrated.

| Page | What it shows | Stele features |
|---|---|---|
| `/terms` | Accepting the Terms of Service | Widget with data attributes; a server-created **acceptance session** links the acceptance to the shop's user |
| `/privacy` | Accepting the Privacy Policy | **`Stele.mount()`** JavaScript API, `sessionToken` as a function, `onAccepted` / `onError` callbacks |
| `/checkout` | An order the server allows only after the current Terms were accepted | `stele:accepted` browser event for the button; **`hasAcceptedLatest()`** on the server for the decision |
| `/account` | The user's status per document and all their acceptances | `latestVersion()`, `hasAcceptedLatest()`, `listAcceptances()`, public document API, receipts |
| `/rewards` | **Stele Gate**: a Solana vault that refuses deposits until the Rewards Club Terms were accepted — checked by the program itself | **Stele Verified** badge, `Stele.wallets`, `gate.check()`, `gate.gate()` (Accept & Deposit), a direct call refused on-chain, the shop paying the customer's network fee |
| `/verify/<id>` | Checking an acceptance without trusting Stele | `GET /v1/acceptances/{id}` and **`@stelehq/verifier`** reading Solana directly |
| `/webhooks` | Notifications from Stele | **`verifyWebhook()`** over the raw body, de-duplication by event ID |
| `/api-log` | Every request the shop made to Stele | |

## Run it (local Stele)

1. Start the local Stele stack (validator, API and web app) as described in `docs/deployment.md`.
2. Set up the demo organization. Pass your own wallet address to manage it in the dashboard too:

   ```shell
   pnpm localnet:demo -- --member <your wallet address>
   ```

   This creates **Northwind Shop** on the local network (verified domain `northwind.test`, a Terms
   of Service, a Privacy Policy and the Rewards Club Terms), makes your wallet an admin and
   publisher, creates an API key and a webhook endpoint, turns on Stele Gate with a policy and a
   Rewards vault that requires it (registered and **Stele Verified**), and writes everything to
   `examples/demo-shop/.env`.

3. Start the shop and open <http://localhost:4300>:

   ```shell
   pnpm demo:shop
   ```

Use a Solana wallet set to the local network, as for any local testing.

## Try the full story

1. Sign in with any name, accept the Terms, then the Privacy Policy.
2. Place an order at **Checkout**. Before you accept, the server refuses the order (`403`).
3. Open **My acceptances**: both acceptances are listed. **Verify** checks one against Solana.
4. Open **Webhooks**: Stele's signed notifications arrived and were verified.
5. In the Stele dashboard (signed in with the wallet you passed to `--member`), open **Northwind
   Shop → Documents → Terms of Service → New version** and publish it.
6. Back in the shop, **My acceptances** and **Checkout** now ask you to accept again: your old
   acceptance was for the previous version.
7. Open **Rewards (Gate)**. Connect a wallet and press **Try without accepting**: the vault program
   refuses the deposit on-chain (`AccessPassMissing`). Press **Deposit 25 points**: Stele shows the
   Rewards Club Terms, you sign (free), and the deposit goes through. Click the **Stele Verified**
   badge for the evidence, and re-check it in your browser.
8. In the dashboard, **Insights** shows what happened: acceptances per day, completion, signing
   methods, who still has to accept the current version (CSV), and more.

## Notes

- The sign-in is a demo (any name, no password). A real shop uses its own login; Stele only needs
  your user ID (`externalUserRef`).
- The API key and webhook secret live only in this server's `.env`, never in the browser.
- `pnpm localnet:demo` refuses to run against public networks.
