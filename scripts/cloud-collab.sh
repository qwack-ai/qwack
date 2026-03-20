#!/usr/bin/env bash
#
# Test Qwack collaboration against a cloud deployment.
#
# Creates a tmux window with 2 panes (Alice + Bob), both pointing
# at the specified Qwack server (default: production).
#
# Usage:
#   bash scripts/cloud-collab.sh                          # production
#   bash scripts/cloud-collab.sh https://api.qwack.ai     # explicit server
#   bash scripts/cloud-collab.sh --kill                    # kill the window

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WINDOW_NAME="qwack-cloud-collab"
AUTH_DIR="/tmp/qwack-cloud-test"
SERVER="${1:-https://api.qwack.ai}"

if [ "$SERVER" = "--kill" ]; then
  for target in $(tmux list-windows -a -F '#{session_name}:#{window_index}:#{window_name}' 2>/dev/null); do
    if [[ "$target" == *":${WINDOW_NAME}" ]]; then
      si="${target%:*}"
      tmux kill-window -t "$si"
      echo "Killed $si ($WINDOW_NAME)"
    fi
  done
  exit 0
fi

echo "🦆 Qwack Cloud Collaboration Test"
echo "   Server: $SERVER"
echo ""

mkdir -p "$AUTH_DIR"
echo "{\"server\":\"$SERVER\",\"token\":\"alice-test\",\"name\":\"Alice\"}" > "$AUTH_DIR/alice.json"
echo "{\"server\":\"$SERVER\",\"token\":\"bob-test\",\"name\":\"Bob\"}" > "$AUTH_DIR/bob.json"
rm -f "$AUTH_DIR/alice-session.json" "$AUTH_DIR/bob-session.json"

BINARY="$REPO_ROOT/packages/opencode/dist/opencode-linux-x64/bin/qwack"
if [ ! -f "$BINARY" ]; then
  echo "Binary not found at $BINARY"
  echo "Build first: OPENCODE_VERSION=0.1.0-alpha bun run script/build.ts --cwd packages/opencode"
  exit 1
fi

WIN_TARGET=$(tmux new-window -n "$WINDOW_NAME" -c "$REPO_ROOT" -P -F '#{session_name}:#{window_index}')
PANE_BASE=$(tmux show-option -gv pane-base-index 2>/dev/null || echo 0)
P0=$PANE_BASE
P1=$((PANE_BASE + 1))

tmux send-keys -t "$WIN_TARGET" \
  "QWACK_CONFIG_FILE=$AUTH_DIR/alice.json QWACK_SESSION_FILE=$AUTH_DIR/alice-session.json $BINARY" Enter

tmux split-window -h -t "$WIN_TARGET" -c "$REPO_ROOT"
tmux send-keys -t "${WIN_TARGET}.${P1}" \
  "sleep 2 && QWACK_CONFIG_FILE=$AUTH_DIR/bob.json QWACK_SESSION_FILE=$AUTH_DIR/bob-session.json $BINARY" Enter

tmux select-pane -t "${WIN_TARGET}.${P0}"

echo "  ┌─────────────────┬────────────────┐"
echo "  │  Alice (TUI)    │  Bob (TUI)     │"
echo "  └─────────────────┴────────────────┘"
echo ""
echo "Both TUIs point at: $SERVER"
echo ""
echo "Quick start:"
echo "  Alice:  /qwack login  (or /qwack start if already logged in)"
echo "  Bob:    /qwack login  → /qwack join <code>"
echo ""
echo "Kill: bash scripts/cloud-collab.sh --kill"
