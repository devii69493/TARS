#!/bin/bash
# TARS startup script — local + online (LAN / ngrok / cloudflared)
# To make double-clickable: rename to start-tars.command and chmod +x

set -e
TARS_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$TARS_DIR/tars-desktop-agent"
TOKEN_FILE="$TARS_DIR/.tars-token"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " T·A·R·S  STARTUP"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Kill stale processes ──────────────────────────────────────────────────────
pkill -f "agent.py" 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 0.4

# ── Token — generate once, persist in .tars-token ────────────────────────────
if [ ! -f "$TOKEN_FILE" ]; then
  openssl rand -hex 16 > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "▶ New security token generated → .tars-token"
fi
TARS_TOKEN=$(cat "$TOKEN_FILE")

# ── LAN IP ────────────────────────────────────────────────────────────────────
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null \
      || ipconfig getifaddr en1 2>/dev/null \
      || python3 -c "import socket; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.connect(('8.8.8.8',80)); print(s.getsockname()[0]); s.close()" 2>/dev/null \
      || echo "unknown")

# ── Python agent ──────────────────────────────────────────────────────────────
PYTHON=/usr/bin/python3
echo "▶ Starting desktop agent..."
if ! $PYTHON -c "import websockets" 2>/dev/null; then
  echo "  Installing Python deps..."
  $PYTHON -m pip install "websockets>=12.0" -q
fi
cd "$AGENT_DIR"
TARS_TOKEN="$TARS_TOKEN" $PYTHON agent.py &
AGENT_PID=$!

# ── Vite dev server ───────────────────────────────────────────────────────────
echo "▶ Starting Vite dev server..."
cd "$TARS_DIR"
npm run dev --silent &
VITE_PID=$!

# ── Wait for both ports ───────────────────────────────────────────────────────
echo "▶ Waiting for services..."
for i in $(seq 1 30); do
  nc -z localhost 7354 2>/dev/null && nc -z localhost 5173 2>/dev/null && break
  sleep 0.5
done

# ── Tunnel (ngrok or cloudflared) ─────────────────────────────────────────────
TUNNEL_URL=""
TUNNEL_PID=""

if command -v cloudflared >/dev/null 2>&1; then
  echo "▶ Starting Cloudflare tunnel..."
  # cloudflared prints the public URL to stderr
  cloudflared tunnel --url "http://localhost:7354" --no-autoupdate \
    > /tmp/tars-cloudflared.log 2>&1 &
  TUNNEL_PID=$!
  # Wait up to 8 seconds for the URL to appear
  for i in $(seq 1 16); do
    TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/tars-cloudflared.log 2>/dev/null | head -1 || true)
    [ -n "$TUNNEL_URL" ] && break
    sleep 0.5
  done
  if [ -n "$TUNNEL_URL" ]; then
    # Convert https:// → wss://
    TUNNEL_WS=$(echo "$TUNNEL_URL" | sed 's/https:/wss:/')
    echo "  Tunnel: $TUNNEL_WS"
  fi
elif command -v ngrok >/dev/null 2>&1; then
  echo "▶ Starting ngrok tunnel..."
  ngrok http 7354 --log stdout > /tmp/tars-ngrok.log 2>&1 &
  TUNNEL_PID=$!
  # Poll the ngrok API for the public URL
  for i in $(seq 1 16); do
    TUNNEL_URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null \
      | python3 -c "import sys,json; t=json.load(sys.stdin)['tunnels']; u=[x['public_url'] for x in t if x['proto']=='https']; print(u[0])" 2>/dev/null || true)
    [ -n "$TUNNEL_URL" ] && break
    sleep 0.5
  done
  if [ -n "$TUNNEL_URL" ]; then
    TUNNEL_WS=$(echo "$TUNNEL_URL" | sed 's/https:/wss:/')
    echo "  Tunnel: $TUNNEL_WS"
  fi
fi

# ── Print connection summary ──────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " CONNECTION INFO"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Token : $TARS_TOKEN"
echo ""
echo "  Local : ws://localhost:7354?token=$TARS_TOKEN"
echo "  LAN   : ws://$LAN_IP:7354?token=$TARS_TOKEN"
if [ -n "$TUNNEL_WS" ]; then
  echo "  Online: $TUNNEL_WS?token=$TARS_TOKEN"
else
  echo ""
  echo "  No tunnel found. To expose online:"
  echo "    brew install cloudflared   (free, no account needed)"
  echo "    brew install ngrok && ngrok config add-authtoken YOUR_TOKEN"
  echo "  Then re-run start-tars.sh"
fi
echo ""
echo "  Paste one of the above URLs into TARS Settings → Desktop Agent URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "▶ Opening TARS in Chrome..."
open -a "Google Chrome" "http://localhost:5173" 2>/dev/null || open "http://localhost:5173"

echo "  Press Ctrl+C to shut down"

# ── Cleanup on exit ───────────────────────────────────────────────────────────
trap "echo ''; echo 'Shutting down...'; kill $AGENT_PID $VITE_PID ${TUNNEL_PID:-} 2>/dev/null; exit 0" INT TERM
wait
