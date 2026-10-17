#!/usr/bin/env bash
# Installed by the existing bootstrap; no credentials are copied or requested.
set -euo pipefail
repo="${OMAR_CODEX_HOME:-$HOME/Documents/Codex/codex}"
node="$HOME/.local/share/node-v24.20.0/bin/node"
entry="$repo/products/scv-instagram/scripts/restore-desktop-gold.mjs"
[[ -x "$node" && -f "$entry" ]] || { echo 'Trusted bootstrap/recovery entry point is not installed on this device' >&2; exit 1; }
[[ "$("$node" --version)" == 'v24.20.0' ]] || { echo 'Pinned Node.js 24.20.0 required' >&2; exit 1; }
exec "$node" "$entry" "$@"
