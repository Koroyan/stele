#!/usr/bin/env bash
# Runs rustfmt in the Linux-native mirror and copies every reformatted source back into the
# repository (Windows hosts have no Rust toolchain). Usage (from Windows):
#   wsl.exe -d Ubuntu -- bash /mnt/c/.../scripts/dev/wsl-run.sh "bash scripts/dev/fmt-rust.sh <repo dir>"
set -euo pipefail
REPO_DIR="${1:?usage: fmt-rust.sh <repository directory>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/wsl-env.sh"
cd "$STELE_WSL_DIR"
cargo fmt --all
while IFS= read -r -d '' f; do
  if ! cmp -s "$f" "$REPO_DIR/$f"; then
    cp "$f" "$REPO_DIR/$f"
    echo "formatted: $f"
  fi
done < <(find programs crates tests/programs -name '*.rs' -print0)
