#!/bin/bash
PLIST="$HOME/Library/LaunchAgents/com.tars.agent.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "TARS Desktop Agent uninstalled."
