#!/usr/bin/env bash
# Launch TUI for demo recording — no OMO plugin, clean workspace.
# Temporarily swaps global config to disable OMO, restores on exit.
# Usage: bash scripts/demo-env.sh alice|bob
set -euo pipefail

ROLE="${1:-alice}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUTH_DIR="/tmp/qwack-dev"
GLOBAL_CFG="$HOME/.config/opencode/opencode.json"
BACKUP_CFG="$GLOBAL_CFG.demo-bak"

# Swap global config to disable OMO for demo
if [[ -f "$GLOBAL_CFG" ]]; then
  cp "$GLOBAL_CFG" "$BACKUP_CFG"
  echo '{"$schema": "https://opencode.ai/config.json", "autoupdate": false, "plugin": []}' > "$GLOBAL_CFG"
  trap 'mv "$BACKUP_CFG" "$GLOBAL_CFG" 2>/dev/null' EXIT
fi

DEMO_DIR="/tmp/qwack-demo-workspace"
mkdir -p "$DEMO_DIR"
cd "$DEMO_DIR"

export OPENCODE_CHANNEL=dev
export OPENCODE_VERSION=0.0.0-dev
export QWACK_AUTH_FILE="$AUTH_DIR/${ROLE}.json"
export QWACK_SESSION_FILE="$AUTH_DIR/${ROLE}-session.json"

# Run TUI (not exec — need trap to fire on exit)
bun run --cwd "$REPO_ROOT/packages/opencode" --conditions=browser src/index.ts
# trap restores config automatically on exit