#!/usr/bin/env bash
# Sync the repo into WSL, then run a command inside the Linux-native copy.
# Usage: wsl.exe -d Ubuntu -- bash /mnt/c/.../scripts/dev/wsl-run.sh <command...>
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/wsl-env.sh"
bash "$SCRIPT_DIR/wsl-sync.sh" >/dev/null
cd "$STELE_WSL_DIR"
exec bash -c "$*"
