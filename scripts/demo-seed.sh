#!/usr/bin/env bash
# Pre-create a Qwack session with both Alice and Bob as participants.
# Run BEFORE the VHS tapes.
set -euo pipefail

SERVER="http://localhost:4000"
SID="demo-session-001"

# Clean slate
sqlite3 "$(dirname "$0")/../packages/qwack-server/qwack.db" \
  "DELETE FROM session_events; DELETE FROM session_participants; DELETE FROM sessions;" 2>/dev/null
sqlite3 ~/.local/share/opencode/opencode-local.db \
  "DELETE FROM session WHERE title LIKE '🦆%';" 2>/dev/null

# Create session (Alice is creator)
curl -sf -X POST "$SERVER/api/sessions" \
  -H "Authorization: Bearer alice" \
  -H "Content-Type: application/json" \
  -d "{\"title\": \"Sprint Planning\", \"id\": \"$SID\"}" > /dev/null

# Add both as participants (409 = already joined, that's fine)
curl -s -X POST "$SERVER/api/sessions/$SID/join" -H "Authorization: Bearer alice" > /dev/null
curl -s -X POST "$SERVER/api/sessions/$SID/join" -H "Authorization: Bearer bob" > /dev/null

echo "Session created: $SID"
curl -s -H "Authorization: Bearer alice" "$SERVER/api/sessions" | \
  python3 -c "import json,sys; [print(f\"  {s['title']} ({s['shortCode']})\") for s in json.load(sys.stdin)]"
