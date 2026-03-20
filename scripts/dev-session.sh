#!/usr/bin/env bash
#
# Launch a local Qwack dev session with tmux.
#
# Creates 3 panes:
#   Top:          Qwack server (with seeded DB)
#   Bottom-left:  Alice test client
#   Bottom-right: Bob test client
#
# Usage:
#   bash scripts/dev-session.sh          # create new tmux session
#   bash scripts/dev-session.sh --here   # use current tmux session
#
# Prerequisites:
#   - tmux
#   - bun
#   - Run from the qwack repo root

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SESSION_NAME="qwack-dev"

# Colors for terminal output
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🦆 Qwack Dev Session${NC}"
echo ""

# Seed the database first (runs in foreground)
echo "Seeding database..."
bun "$REPO_ROOT/scripts/seed-dev.ts"
echo ""

if [[ "${1:-}" == "--here" ]]; then
  # Use current tmux window — split into 3 panes
  echo "Setting up panes in current tmux window..."

  # Start server in current pane (will be top pane)
  # First split horizontally to create bottom pane
  tmux split-window -v -c "$REPO_ROOT/packages/server" "bun run dev; read"

  # Split the bottom pane vertically for two clients
  tmux split-window -h -c "$REPO_ROOT" "sleep 2 && bun scripts/test-client.ts bob; read"

  # Select the bottom-left pane and run alice
  tmux select-pane -t 1
  tmux send-keys "sleep 2 && bun scripts/test-client.ts alice" Enter

  # Select the top pane (server) and start it
  tmux select-pane -t 0
  tmux send-keys "bun run dev" Enter
else
  # Create a new tmux session
  if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "Session '$SESSION_NAME' already exists. Attaching..."
    tmux attach-session -t "$SESSION_NAME"
    exit 0
  fi

  echo "Creating tmux session: $SESSION_NAME"

  # Create session with server pane
  tmux new-session -d -s "$SESSION_NAME" -c "$REPO_ROOT/packages/server"
  tmux send-keys -t "$SESSION_NAME" "bun run dev" Enter

  # Bottom pane: split for two clients
  tmux split-window -v -t "$SESSION_NAME" -c "$REPO_ROOT"
  tmux send-keys -t "$SESSION_NAME" "sleep 2 && bun scripts/test-client.ts alice" Enter

  tmux split-window -h -t "$SESSION_NAME" -c "$REPO_ROOT"
  tmux send-keys -t "$SESSION_NAME" "sleep 2 && bun scripts/test-client.ts bob" Enter

  # Layout: server on top (big), two clients on bottom
  tmux select-layout -t "$SESSION_NAME" main-horizontal

  # Focus on alice's pane
  tmux select-pane -t "$SESSION_NAME:0.1"

  echo ""
  echo -e "${YELLOW}Tmux session ready!${NC}"
  echo ""
  echo "Pane layout:"
  echo "  ┌─────────────────────────────────┐"
  echo "  │         Qwack Server            │"
  echo "  ├────────────────┬────────────────┤"
  echo "  │  Alice (client) │  Bob (client)  │"
  echo "  └────────────────┴────────────────┘"
  echo ""
  echo "Quick test:"
  echo "  Alice: /qwack start Sprint Planning"
  echo "  Bob:   /qwack join <session-id>"
  echo "  Alice: /qwack msg hello from alice!"
  echo "  Bob:   /qwack msg hey alice!"
  echo ""
  echo "Attaching..."
  tmux attach-session -t "$SESSION_NAME"
fi
