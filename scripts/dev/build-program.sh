#!/usr/bin/env bash
# Builds the SBF programs (Stele and the Stele Gate demo; optionally the IDL) inside the Linux-native
# mirror, together with the CPI probe that the program tests deploy next to them.
# Output: $STELE_WSL_DIR/target/deploy/{stele,stele_gate_demo}.so (+ target/idl/stele.json with --idl)
#
# The program keypair is NEVER stored in the repository. If $STELE_PROGRAM_KEYPAIR (default
# ~/.config/stele/stele-program-keypair.json) exists it is placed in target/deploy so deploy
# tooling uses the address declared in `declare_id!`.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/wsl-env.sh"
bash "$SCRIPT_DIR/wsl-sync.sh" >/dev/null
cd "$STELE_WSL_DIR"
KEYPAIR="${STELE_PROGRAM_KEYPAIR:-$HOME/.config/stele/stele-program-keypair.json}"
mkdir -p target/deploy
if [ -f "$KEYPAIR" ]; then
  install -m 600 "$KEYPAIR" target/deploy/stele-keypair.json
fi
GATE_DEMO_KEYPAIR="${STELE_GATE_DEMO_KEYPAIR:-$HOME/.config/stele/stele-gate-demo-keypair.json}"
if [ -f "$GATE_DEMO_KEYPAIR" ]; then
  install -m 600 "$GATE_DEMO_KEYPAIR" target/deploy/stele_gate_demo-keypair.json
fi
quiet() { grep -vE "^\s*(Compiling|Downloaded|Downloading|Checking|Fresh)" || true; }
# pipefail: a failed build stops here instead of leaving a stale stele.so in place.
cargo build-sbf --manifest-path programs/stele/Cargo.toml --sbf-out-dir target/deploy 2>&1 | quiet
cargo build-sbf --manifest-path programs/gate-demo/Cargo.toml --sbf-out-dir target/deploy 2>&1 | quiet
cargo build-sbf --manifest-path tests/programs/cpi-probe/Cargo.toml --sbf-out-dir target/deploy 2>&1 \
  | quiet
bash "$SCRIPT_DIR/wsl-lockfile.sh"
ls -la target/deploy/stele.so target/deploy/stele_gate_demo.so
sha256sum target/deploy/stele.so target/deploy/stele_gate_demo.so
if [ "${1:-}" = "--idl" ]; then
  mkdir -p target/idl
  anchor idl build -p stele -o target/idl/stele.json 2>&1 | tail -3
  test -s target/idl/stele.json
  echo "IDL: $STELE_WSL_DIR/target/idl/stele.json"
fi
