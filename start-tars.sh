#!/bin/bash
# TARS startup script
# To make double-clickable: rename to start-tars.command and chmod +x

set -e
TARS_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$TARS_DIR/tars-desktop-agent"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " T·A·R·S  STARTUP"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Kill stale processes ──────────────────────────────────────────────────────
pkill -f "agent.py" 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 0.4

# ── Python agent (always use system Python 3.9 — brew python may be newer/broken) ──
PYTHON=/usr/bin/python3
echo "▶ Starting desktop agent..."
if ! $PYTHON -c "import websockets" 2>/dev/null; then
    echo "  Installing Python deps..."
    $PYTHON -m pip install "websockets>=12.0" -q
fi
cd "$AGENT_DIR"
$PYTHON agent.py &
AGENT_PID=$!

# ── Vite dev server ───────────────────────────────────────────────────────────
echo "▶ Starting Vite dev server..."
cd "$TARS_DIR"
npm run dev --silent &
VITE_PID=$!

# ── Wait for both ports ───────────────────────────────────────────────────────
echo "▶ Waiting for services..."
for i in $(seq 1 30); do
    AGENT_OK=0
    VITE_OK=0
    nc -z localhost 7354 2>/dev/null && AGENT_OK=1
    nc -z localhost 5173 2>/dev/null && VITE_OK=1
    [ $AGENT_OK -eq 1 ] && [ $VITE_OK -eq 1 ] && break
    sleep 0.5
done

echo "▶ Opening TARS in Chrome..."
open -a "Google Chrome" "http://localhost:5173" 2>/dev/null || \
open "http://localhost:5173"

echo ""
echo "  TARS is online — http://localhost:5173"
echo "  Press Ctrl+C to shut down"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Cleanup on exit ───────────────────────────────────────────────────────────
trap "echo ''; echo 'Shutting down...'; kill $AGENT_PID $VITE_PID 2>/dev/null; exit 0" INT TERM
wait
