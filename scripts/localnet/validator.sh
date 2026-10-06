#!/usr/bin/env bash
# Runs a local Solana test validator (WSL/Linux) in the FOREGROUND with the Stele program deployed
# as an UPGRADEABLE program whose upgrade authority is the local admin key — exactly like a real
# deployment, so `initialize_protocol`'s upgrade-authority gate is exercised.
#
# Usage: scripts/localnet/validator.sh <ADMIN_PUBKEY>     (pnpm --filter @stele/localnet keys)
# Run it in its own terminal (or a supervised background job); stop with Ctrl-C.
#
# History retention is raised above the default (10,000 shreds, pruned within the hour): the indexer
# rebuild and the verifier need transaction history (`getSignaturesForAddress`, `getTransaction`).
# In production that history comes from archival RPC providers.
#
# DISK USAGE: the ledger grows until it reaches the cap. Even idle, a test validator produces a few
# hundred shreds per second, so the default cap of 1,000,000 shreds keeps roughly the last hour of
# history (a few hundred MB on disk). Raise STELE_LEDGER_SHREDS only with disk space to match —
# under WSL the ledger lives in the distribution's virtual disk, which grows on the Windows drive
# and does not shrink by itself. Run tests soon after seeding: older transactions are pruned.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/../dev/wsl-env.sh"
ADMIN_PUBKEY="${1:?usage: validator.sh <ADMIN_PUBKEY>}"
PROGRAM_ID="${STELE_PROGRAM_ID:-6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV}"
SO="${STELE_PROGRAM_SO:-$STELE_WSL_DIR/target/deploy/stele.so}"
LEDGER="${STELE_LEDGER_DIR:-$HOME/stele-ledger}"
LEDGER_SHREDS="${STELE_LEDGER_SHREDS:-1000000}"

test -f "$SO" || { echo "missing $SO — run scripts/dev/build-program.sh first" >&2; exit 1; }
# The validator needs many file descriptors; WSL defaults the soft limit to 1024.
ulimit -n "$(ulimit -Hn)"
pkill -x "solana-test-val" 2>/dev/null || true
sleep 1
echo "starting validator: program $PROGRAM_ID (upgrade authority $ADMIN_PUBKEY), RPC http://127.0.0.1:8899, ledger cap $LEDGER_SHREDS shreds"
exec solana-test-validator --reset --quiet \
  --ledger "$LEDGER" \
  --rpc-port 8899 \
  --limit-ledger-size "$LEDGER_SHREDS" \
  --upgradeable-program "$PROGRAM_ID" "$SO" "$ADMIN_PUBKEY"
