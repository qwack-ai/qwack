#!/usr/bin/env bash
#
# Launch a Qwack collaboration dev environment in tmux.
#
# Creates a new WINDOW in your current tmux session with 3 panes:
#   Top:          Qwack server (port 4000)
#   Bottom-left:  Qwack TUI as Alice
#   Bottom-right: Qwack TUI as Bob
#
# Usage:
#   bash scripts/dev-collab.sh          # create window in current session
#   bash scripts/dev-collab.sh --kill   # kill the qwack-collab window
#
# Quick start once running:
#   Alice pane:  /qstart Sprint Planning
#   Bob pane:    /qjoin <session-id>
#   Either:      just type — prompts auto-relay to collaborators

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_PORT=4000
WINDOW_NAME="qwack-collab"
AUTH_DIR="/tmp/qwack-dev"

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
DIM='\033[2m'
NC='\033[0m'

TUI_CMD="OPENCODE_CHANNEL=dev OPENCODE_VERSION=0.0.0-dev bun run --cwd $REPO_ROOT/packages/opencode --conditions=browser src/index.ts"

# ── Kill ─────────────────────────────────────────────────────────

if [ "${1:-}" = "--kill" ]; then
  found=0
  for target in $(tmux list-windows -a -F '#{session_name}:#{window_index}:#{window_name}' 2>/dev/null); do
    if [[ "$target" == *":${WINDOW_NAME}" ]]; then
      # Extract session:index (drop the name)
      si="${target%:*}"
      tmux kill-window -t "$si"
      echo -e "${GREEN}Killed $si ($WINDOW_NAME)${NC}"
      found=1
    fi
  done
  [ $found -eq 0 ] && echo "No '$WINDOW_NAME' window found."
  # Restore OMO config if it was swapped
  GLOBAL_CFG="$HOME/.config/opencode/opencode.json"
  BACKUP_CFG="$GLOBAL_CFG.collab-bak"
  if [[ -f "$BACKUP_CFG" ]]; then
    mv "$BACKUP_CFG" "$GLOBAL_CFG"
    echo -e "${GREEN}OMO config restored${NC}"
  fi
  exit 0
fi

# ── Setup ────────────────────────────────────────────────────────

echo -e "${YELLOW}🦆 Qwack Collaboration Dev Environment${NC}"
echo ""

# Create separate auth files per user
mkdir -p "$AUTH_DIR"
echo '{"server":"http://localhost:'$SERVER_PORT'","token":"alice","name":"Alice"}' > "$AUTH_DIR/alice.json"
echo '{"server":"http://localhost:'$SERVER_PORT'","token":"bob","name":"Bob"}' > "$AUTH_DIR/bob.json"
# Clean stale session files so TUIs don't auto-connect to old sessions
rm -f "$AUTH_DIR/alice-session.json" "$AUTH_DIR/bob-session.json"
echo -e "  ${GREEN}Auth${NC}: $AUTH_DIR/alice.json, $AUTH_DIR/bob.json"

echo "Seeding database..."
bun "$REPO_ROOT/scripts/seed-dev.ts"
echo ""
# Disable OMO plugin for dev sessions (swap global config, restore on kill)
GLOBAL_CFG="$HOME/.config/opencode/opencode.json"
BACKUP_CFG="$GLOBAL_CFG.collab-bak"
if [[ -f "$GLOBAL_CFG" ]] && grep -q 'oh-my-opencode' "$GLOBAL_CFG" 2>/dev/null; then
  cp "$GLOBAL_CFG" "$BACKUP_CFG"
  echo '{"$schema": "https://opencode.ai/config.json", "autoupdate": false, "plugin": []}' > "$GLOBAL_CFG"
  echo "  OMO disabled for dev session (restored on --kill)"
fi

# ── Create window and capture its session:index target ───────────

# -P -F prints the new window's target so we can address it reliably
WIN_TARGET=$(tmux new-window -n "$WINDOW_NAME" -c "$REPO_ROOT" -P -F '#{session_name}:#{window_index}')
PANE_BASE=$(tmux show-option -gv pane-base-index 2>/dev/null || echo 0)
P0=$PANE_BASE
P1=$((PANE_BASE + 1))
P2=$((PANE_BASE + 2))

# Pane P0 (top): Server (QWACK_DEV=true keeps stub auth for local testing)
tmux send-keys -t "$WIN_TARGET" "QWACK_DEV=true bun run --cwd $REPO_ROOT/packages/qwack-server src/index.ts" Enter

# Pane P1 (bottom-left): Alice
tmux split-window -v -t "$WIN_TARGET" -c "$REPO_ROOT"
tmux send-keys -t "${WIN_TARGET}.${P1}" \
  "sleep 2 && QWACK_AUTH_FILE=$AUTH_DIR/alice.json QWACK_SESSION_FILE=$AUTH_DIR/alice-session.json $TUI_CMD" Enter

# Pane P2 (bottom-right): Bob
tmux split-window -h -t "${WIN_TARGET}.${P1}" -c "$REPO_ROOT"
tmux send-keys -t "${WIN_TARGET}.${P2}" \
  "sleep 4 && QWACK_AUTH_FILE=$AUTH_DIR/bob.json QWACK_SESSION_FILE=$AUTH_DIR/bob-session.json $TUI_CMD" Enter

# Server gets a small strip, TUIs get the rest
tmux select-layout -t "$WIN_TARGET" main-horizontal
tmux resize-pane -t "${WIN_TARGET}.${P0}" -y 8

# Focus Alice
tmux select-pane -t "${WIN_TARGET}.${P1}"

echo "  ┌──────────────────────────────────┐"
echo "  │       Qwack Server (:$SERVER_PORT)       │"
echo "  ├─────────────────┬────────────────┤"
echo "  │  Alice (TUI)    │  Bob (TUI)     │"
echo "  └─────────────────┴────────────────┘"
echo ""
echo "Quick start:"
echo "  Alice:  /qstart Sprint Planning"
echo "  Bob:    /qjoin <session-id>"
echo "  Either: just type — prompts auto-relay"
echo ""
echo -e "${DIM}Kill: bash scripts/dev-collab.sh --kill${NC}"
