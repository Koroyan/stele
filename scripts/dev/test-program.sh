#!/usr/bin/env bash
# Builds the program and runs all Rust tests (core crates + LiteSVM program tests) in WSL.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/build-program.sh" >/dev/null
# shellcheck disable=SC1091
. "$SCRIPT_DIR/wsl-env.sh"
cd "$STELE_WSL_DIR"
cargo test --workspace --locked "$@" 2>&1 | { grep -vE "^\s*(Compiling|Downloaded|Downloading|Checking|Fresh)" || true; }
