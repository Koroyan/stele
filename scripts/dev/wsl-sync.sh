#!/usr/bin/env bash
# Mirrors this repository into a Linux-native directory (default: ~/stele) so that SBF/Rust builds,
# LiteSVM tests and the local validator run on ext4 instead of a Windows mount.
# Usage (from Windows):  wsl.exe -d Ubuntu -- bash /mnt/c/.../scripts/dev/wsl-sync.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEST="${STELE_WSL_DIR:-$HOME/stele}"
mkdir -p "$DEST"
# Compare by content (--checksum) and do NOT preserve source mtimes: the Windows and WSL clocks can
# drift apart, and copied files carrying older timestamps would make cargo skip rebuilding them.
rsync -rlpD --checksum --delete \
  --exclude node_modules --exclude target --exclude .next --exclude .turbo --exclude dist \
  --exclude .git --exclude coverage --exclude test-ledger --exclude playwright-report \
  --exclude test-results --exclude .data \
  "$SRC/" "$DEST/"
echo "synced: $SRC -> $DEST"
