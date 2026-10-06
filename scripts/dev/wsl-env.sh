#!/usr/bin/env bash
# Shared environment for WSL helper scripts: Rust, Solana/Agave and Node (nvm) on PATH.
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null
  nvm use 24 >/dev/null 2>&1 || true
fi
export STELE_WSL_DIR="${STELE_WSL_DIR:-$HOME/stele}"
