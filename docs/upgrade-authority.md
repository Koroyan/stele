# Program authority: current status and the move to a multisig

Stele's guarantees rest on the on-chain program. Whoever holds its **upgrade authority** can deploy
different code. This page states, without rounding, who that is today and how it moves to a Squads
multisig. **The program is not immutable**, and no Stele material should say otherwise.

## Current status (Devnet, 2026-10-05)

| Authority | Holder | Kind |
|---|---|---|
| Program upgrade authority — `6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV` | `C6q9uiQsmxy5E2hx3hjv1i36i98vXvtBF35Hfq54GJ4p` | **single key** (a file on one workstation) |
| Protocol admin (`ProtocolConfig.admin`: pause, attestor, admin hand-over) | `C6q9uiQsmxy5E2hx3hjv1i36i98vXvtBF35Hfq54GJ4p` | single key |
| Domain attestor | `tc2njAHNGKp6wfcn6Ts1t1MgFf122EnHpHth4woHaUe` | hot key (API server) |
| Relayer (fee payer for recordings) | `EdLvTmdNd7JG68po2Up6B4b1uU6uLZ8EEUCDhdMbVAUX` | hot key (API server) |

Check it yourself:

```shell
solana -u devnet program show 6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV   # "Authority: …"
```

What a single upgrade key could do: deploy a program that accepts forged acceptances or changes
state from then on. What it could **not** do: change past transactions, or make a verifier accept
evidence that fails the verifier's own checks — verifiers re-verify signatures, hashes and Merkle
proofs themselves, so evidence verified today stays verified. Organizations' and users' keys are
never held by this authority.

The relayer and attestor are deliberately separate hot keys with bounded power (they cannot
authorize records; see `SECURITY_THREAT_MODEL.md` R07). They stay single keys — they sign often —
and live in a secret manager in production.

## Target model

| Network | Upgrade authority | Protocol admin | Threshold | Time lock |
|---|---|---|---|---|
| Devnet (demo) | Squads v4 vault | same vault | 2 of 3 | none |
| Mainnet | Squads v4 vault | same vault (or a second multisig) | 3 of 5, members on hardware wallets, ≥ 2 organizations or individuals outside the core team | 48 h on upgrades |
| Later | **none** (`--final`) once the core verification program is audited and stable | multisig | — | — |

Members and threshold are a governance decision for the Stele maintainers; the table is the
recommended minimum. Squads v4's program is `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` on both
Devnet and Mainnet.

## Procedure: hand the upgrade authority to a Squads vault

1. Create the multisig (Squads app or `@sqds/multisig`), add the members, set the threshold. Note
   the **vault** address (vault index 0) — not the multisig account address. Fund it with a little
   SOL for rent and fees.
2. Rehearse on Devnet with a throw-away program first.
3. From the current authority's machine:

   ```shell
   solana -u devnet program set-upgrade-authority 6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV \
     --new-upgrade-authority <SQUADS_VAULT_ADDRESS> \
     --skip-new-upgrade-authority-signer-check \
     -k ~/.config/stele-devnet/owner.json
   ```

   The vault is a PDA and cannot co-sign, hence `--skip-new-upgrade-authority-signer-check`. Type the
   vault address carefully: a wrong address loses the program for good.
4. Verify: `solana program show …` must print the vault as `Authority`.
5. Hand over the protocol admin the same way, with Stele's two-step instructions: the current admin
   sends `propose_protocol_admin(new = vault)`; a Squads proposal then executes
   `accept_protocol_admin` signed by the vault.
6. Record the change (date, transaction signatures, members, threshold) in this file.

## Procedure: upgrade through the multisig

1. Build reproducibly (`scripts/dev/build-program.sh`; publish the `sha256sum` of `stele.so`).
2. Write a buffer and give it to the vault:

   ```shell
   solana -u devnet program write-buffer target/deploy/stele.so      # prints <BUFFER>
   solana -u devnet program set-buffer-authority <BUFFER> --new-buffer-authority <SQUADS_VAULT_ADDRESS>
   ```

3. Create the upgrade proposal in Squads (Programs → Add upgrade → buffer, spill address). Members
   check the buffer's hash against the published build hash before approving.
4. On threshold the proposal executes `BPFLoaderUpgradeable::Upgrade`. If the new build is larger,
   extend the program data first (`solana program extend`, any payer).

## Toward immutability

Making the program immutable (`solana program set-upgrade-authority <PROGRAM> --final`, executed by
the multisig) is **irreversible**. It is the end state for the core verification logic once it has
been audited and no protocol change is expected. Until then, the multisig removes single-key control
while keeping the ability to fix vulnerabilities.

## Why verifiers do not need to trust the upgrade authority for past evidence

The verifier (`packages/verifier`, CLI `stele-verify`) does not ask the program whether something is
valid. It re-derives every fact from transactions and accounts: Ed25519 and P-256 signatures, WebAuthn
bindings, message reconstruction, content hashes, version chains, Merkle inclusion. A future malicious
program could record new false records; it cannot make an already-recorded acceptance say something
else.
