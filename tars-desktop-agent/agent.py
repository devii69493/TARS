#!/usr/bin/env python3
"""TARS Desktop Agent — WebSocket server giving TARS macOS system control."""

import asyncio
import base64
import json
import os
import subprocess
import sys
import time

try:
    import websockets
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets>=12.0", "-q"])
    import websockets

HOST = "localhost"
PORT = 7354


# ── Helpers ───────────────────────────────────────────────────────────────────

def osa(script: str, timeout: int = 10) -> str:
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or f"osascript error")
    return r.stdout.strip()

def cmd(*args, timeout: int = 10) -> str:
    r = subprocess.run(list(args), capture_output=True, text=True, timeout=timeout)
    return r.stdout.strip()


# ── App control ───────────────────────────────────────────────────────────────

def app_open(name: str) -> str:
    subprocess.Popen(["open", "-a", name])
    return f"Opening {name}"

def app_close(name: str) -> str:
    osa(f'tell application "{name}" to quit')
    return f"Closed {name}"

def app_switch(name: str) -> str:
    osa(f'tell application "{name}" to activate')
    return f"Switched to {name}"

def app_list() -> list:
    raw = osa('tell application "System Events" to get name of (processes where background only is false)')
    return [a.strip() for a in raw.split(",") if a.strip()]

def screenshot() -> str:
    path = f"/tmp/tars_{int(time.time())}.png"
    subprocess.run(["screencapture", "-x", "-C", path], check=True)
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    os.unlink(path)
    return data


# ── Media ─────────────────────────────────────────────────────────────────────

def _running_music_app() -> str:
    apps = app_list()
    if "Music" in apps:   return "Music"
    if "Spotify" in apps: return "Spotify"
    raise RuntimeError("No music app running (Apple Music or Spotify)")

def media_playpause() -> str:
    osa(f'tell application "{_running_music_app()}" to playpause')
    return "Toggled play/pause"

def media_next() -> str:
    osa(f'tell application "{_running_music_app()}" to next track')
    return "Next track"

def media_prev() -> str:
    osa(f'tell application "{_running_music_app()}" to previous track')
    return "Previous track"

def media_current() -> dict:
    app = _running_music_app()
    return {
        "app":    app,
        "name":   osa(f'tell application "{app}" to get name of current track'),
        "artist": osa(f'tell application "{app}" to get artist of current track'),
        "album":  osa(f'tell application "{app}" to get album of current track'),
        "state":  osa(f'tell application "{app}" to get player state as string'),
    }


# ── Volume ────────────────────────────────────────────────────────────────────

def volume_get() -> int:
    return int(osa("output volume of (get volume settings)"))

def volume_set(level: int) -> str:
    level = max(0, min(100, int(level)))
    osa(f"set volume output volume {level}")
    return f"Volume set to {level}%"

def volume_mute(muted: bool) -> str:
    osa(f"set volume {'with' if muted else 'without'} output muted")
    return "Muted" if muted else "Unmuted"


# ── Files ─────────────────────────────────────────────────────────────────────

def file_open(path: str) -> str:
    subprocess.Popen(["open", os.path.expanduser(path)])
    return f"Opening {path}"

def folder_create(path: str) -> str:
    p = os.path.expanduser(path)
    os.makedirs(p, exist_ok=True)
    return f"Created {p}"

def spotlight(query: str, limit: int = 10) -> list:
    r = subprocess.run(["mdfind", "-name", query], capture_output=True, text=True, timeout=8)
    return [f for f in r.stdout.strip().split("\n") if f][:limit]

def recent_files(limit: int = 10) -> list:
    r = subprocess.run(
        ["mdfind", "-onlyin", os.path.expanduser("~"),
         "kMDItemFSContentChangeDate >= $time.today(-1)"],
        capture_output=True, text=True, timeout=8
    )
    return [f for f in r.stdout.strip().split("\n") if f][:limit]


# ── System ────────────────────────────────────────────────────────────────────

def dnd_set(enabled: bool) -> str:
    # Try Shortcuts app first (most reliable on macOS 12+)
    label = "Turn On Do Not Disturb" if enabled else "Turn Off Do Not Disturb"
    try:
        subprocess.run(["shortcuts", "run", label], timeout=6, check=True)
        return f"Do Not Disturb {'on' if enabled else 'off'}"
    except Exception:
        pass
    # Fallback: toggle via Focus menu bar item (macOS 13+)
    action = "on" if enabled else "off"
    try:
        script = f'''
tell application "System Events"
    tell application process "Control Center"
        set mb to menu bar 1
        set cc to menu bar item "Control Center" of mb
        click cc
        delay 0.5
        set focusBtn to (first button of window 1 whose description contains "Focus")
        click focusBtn
        delay 0.3
        key code 53
    end tell
end tell
'''
        osa(script, timeout=8)
        return f"Do Not Disturb {action}"
    except Exception:
        return ("DND requires a Shortcut named 'Turn On Do Not Disturb' / 'Turn Off Do Not Disturb'. "
                "Create them in the Shortcuts app, or toggle Focus manually.")

def battery() -> dict:
    raw = cmd("pmset", "-g", "batt")
    if "%" not in raw:
        return {"percent": None, "charging": False, "note": "No battery — desktop Mac on AC power"}
    pct, charging = None, False
    for line in raw.split("\n"):
        if "%" in line:
            for part in line.split():
                if "%" in part:
                    try: pct = int(part.replace("%", "").replace(";", ""))
                    except ValueError: pass
                if "charging" in part.lower() and "discharging" not in part.lower():
                    charging = True
    return {"percent": pct, "charging": charging}

def set_brightness(level: float) -> str:
    """Requires: brew install brightness"""
    try:
        subprocess.run(["brightness", str(round(level, 2))], check=True, timeout=5)
        return f"Brightness set to {int(level * 100)}%"
    except FileNotFoundError:
        raise RuntimeError("Install brightness CLI first: brew install brightness")

def lock_screen() -> str:
    # Ctrl+Cmd+Q — works on macOS 10.13+ without needing CGSession path
    osa('tell application "System Events" to keystroke "q" using {control down, command down}',
        timeout=5)
    return "Screen locked"

def set_timer(seconds: int, label: str = "Timer") -> str:
    script = f'delay {seconds}\ndisplay notification "{label} complete" with title "TARS" sound name "Ping"'
    subprocess.Popen(["osascript", "-e", script])
    m, s = divmod(int(seconds), 60)
    human = f"{m}m {s}s" if m else f"{s}s"
    return f"Timer set: {label} in {human}"


# ── Dispatcher ────────────────────────────────────────────────────────────────

def dispatch(tool: str, args: dict):
    if   tool == "app_open":      return app_open(args["name"])
    elif tool == "app_close":     return app_close(args["name"])
    elif tool == "app_switch":    return app_switch(args["name"])
    elif tool == "app_list":      return app_list()
    elif tool == "screenshot":    return screenshot()
    elif tool == "media_playpause": return media_playpause()
    elif tool == "media_next":      return media_next()
    elif tool == "media_prev":      return media_prev()
    elif tool == "media_current":   return media_current()
    elif tool == "volume_get":    return volume_get()
    elif tool == "volume_set":    return volume_set(args["level"])
    elif tool == "volume_mute":   return volume_mute(bool(args.get("muted", True)))
    elif tool == "file_open":     return file_open(args["path"])
    elif tool == "folder_create": return folder_create(args["path"])
    elif tool == "spotlight":     return spotlight(args["query"], int(args.get("limit", 10)))
    elif tool == "recent_files":  return recent_files(int(args.get("limit", 10)))
    elif tool == "dnd":           return dnd_set(bool(args.get("enabled", True)))
    elif tool == "battery":       return battery()
    elif tool == "brightness":    return set_brightness(float(args["level"]))
    elif tool == "lock_screen":   return lock_screen()
    elif tool == "set_timer":     return set_timer(int(args["seconds"]), str(args.get("label", "Timer")))
    else:
        raise ValueError(f"Unknown tool: {tool}")


# ── WebSocket handler ─────────────────────────────────────────────────────────

async def handler(websocket):
    addr = websocket.remote_address
    print(f"[TARS agent] client connected {addr}")
    try:
        async for raw in websocket:
            msg_id = None
            try:
                msg    = json.loads(raw)
                msg_id = msg.get("id", "")
                tool   = msg.get("tool", "")
                args   = msg.get("args", {})
                print(f"[TARS agent] {tool} {args}")
                loop   = asyncio.get_event_loop()
                result = await loop.run_in_executor(None, dispatch, tool, args)
                await websocket.send(json.dumps({"id": msg_id, "success": True, "result": result}))
            except Exception as e:
                print(f"[TARS agent] error: {e}")
                await websocket.send(json.dumps({"id": msg_id or "", "success": False, "error": str(e)}))
    except websockets.exceptions.ConnectionClosed:
        print(f"[TARS agent] client disconnected {addr}")


async def main():
    print(f"[TARS agent] starting on ws://{HOST}:{PORT}")
    async with websockets.serve(handler, HOST, PORT):
        print(f"[TARS agent] ready ✓")
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[TARS agent] stopped")
