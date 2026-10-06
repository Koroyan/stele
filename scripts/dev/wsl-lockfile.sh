#!/usr/bin/env bash
# Copies Cargo.lock from the Linux-native mirror back into the repository when cargo created or
# updated it there. The repository's lockfile is the committed, authoritative one: wsl-sync.sh
# mirrors it into every build, and CI builds with --locked.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/wsl-env.sh"
if ! cmp -s "$STELE_WSL_DIR/Cargo.lock" "$REPO_DIR/Cargo.lock"; then
  cp "$STELE_WSL_DIR/Cargo.lock" "$REPO_DIR/Cargo.lock"
  echo "Cargo.lock updated in the repository"
fi
