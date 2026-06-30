#!/bin/bash
# Install TARS Desktop Agent as a macOS login item via launchd
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PYTHON="$(which python3)"
PLIST="$HOME/Library/LaunchAgents/com.tars.agent.plist"
TOKEN_FILE="$TARS_DIR/.tars-token"

echo "Installing TARS Desktop Agent…"

# Generate token if needed
if [ ! -f "$TOKEN_FILE" ]; then
  openssl rand -hex 16 > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "  Generated new security token → .tars-token"
fi
TARS_TOKEN=$(cat "$TOKEN_FILE")

# Install Python deps (websockets is required; others are optional)
echo "  Installing Python dependencies…"
pip3 install "websockets>=12.0" -q

# Write the plist
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.tars.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$PYTHON</string>
        <string>$SCRIPT_DIR/agent.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/tars-agent-out.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/tars-agent-err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>TARS_TOKEN</key>
        <string>$TARS_TOKEN</string>
    </dict>
</dict>
</plist>
EOF

# Load it
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo ""
echo "  TARS agent installed and running."
echo "  It will start automatically on every login."
echo "  Token : $TARS_TOKEN"
echo "  Logs  : /tmp/tars-agent-out.log"
echo ""
echo "  To uninstall: ./uninstall-agent.sh"
