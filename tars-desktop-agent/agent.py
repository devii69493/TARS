#!/usr/bin/env python3
"""TARS Desktop Agent — Phase 2B: Full OS Control."""

import asyncio
import base64
import json
import os
import struct
import subprocess
import sys
import threading
import time
import urllib.parse

try:
    import websockets
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets>=12.0", "-q"])
    import websockets

HOST = "localhost"
PORT = 7354

# ── Connected clients (for broadcast) ─────────────────────────────────────────
CLIENTS = set()
MAIN_LOOP = None  # set to the running event loop in main()

async def broadcast(msg: dict):
    if not CLIENTS:
        return
    data = json.dumps(msg)
    await asyncio.gather(*[c.send(data) for c in set(CLIENTS)], return_exceptions=True)

def sync_broadcast(msg: dict):
    """Call broadcast() from any thread."""
    if MAIN_LOOP:
        asyncio.run_coroutine_threadsafe(broadcast(msg), MAIN_LOOP)


# ── Helpers ───────────────────────────────────────────────────────────────────

def osa(script: str, timeout: int = 10) -> str:
    r = subprocess.run(["osascript", "-e", script],
                       capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or "osascript error")
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
    raw = osa('tell application "System Events" to get name of '
              '(processes where background only is false)')
    return [a.strip() for a in raw.split(",") if a.strip()]


# ── Screenshot ────────────────────────────────────────────────────────────────

def screenshot(mode: str = "full") -> dict:
    desktop = os.path.expanduser("~/Desktop")
    filename = f"TARS-{int(time.time())}.png"
    path = os.path.join(desktop, filename)
    if mode == "window":
        subprocess.run(["screencapture", "-x", "-C", path], check=True)
    else:
        subprocess.run(["screencapture", "-x", path], check=True)
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    return {"path": path, "filename": filename, "data": data}


# ── Spotify ───────────────────────────────────────────────────────────────────

def _spotify_active() -> bool:
    return "Spotify" in app_list()

def spotify_play() -> str:
    if not _spotify_active():
        subprocess.Popen(["open", "-a", "Spotify"])
        time.sleep(1.5)
    osa('tell application "Spotify" to play')
    return "Playing"

def spotify_pause() -> str:
    osa('tell application "Spotify" to pause')
    return "Paused"

def spotify_next() -> str:
    osa('tell application "Spotify" to next track')
    return "Next track"

def spotify_prev() -> str:
    osa('tell application "Spotify" to previous track')
    return "Previous track"

def spotify_current() -> dict:
    if not _spotify_active():
        raise RuntimeError("Spotify is not running")
    return {
        "name":   osa('tell application "Spotify" to get name of current track'),
        "artist": osa('tell application "Spotify" to get artist of current track'),
        "album":  osa('tell application "Spotify" to get album of current track'),
        "state":  osa('tell application "Spotify" to get player state as string'),
    }

def spotify_search(query: str) -> str:
    """Open Spotify and search. Uses keyboard shortcut to trigger play."""
    encoded = urllib.parse.quote(query)
    if not _spotify_active():
        subprocess.Popen(["open", "-a", "Spotify"])
        time.sleep(2)
    subprocess.run(["open", f"spotify:search:{encoded}"])
    time.sleep(1.5)
    # Focus Spotify and trigger play on search results
    osa(f'''
tell application "Spotify" to activate
delay 0.8
tell application "System Events"
    keystroke return
end tell
''')
    return f"Searching Spotify: {query}"

def spotify_volume(level: int) -> str:
    level = max(0, min(100, int(level)))
    osa(f'tell application "Spotify" to set sound volume to {level}')
    return f"Spotify volume: {level}%"


# ── Apple Music ───────────────────────────────────────────────────────────────

def _music_active() -> bool:
    return "Music" in app_list()

def music_play() -> str:
    osa('tell application "Music" to play')
    return "Playing"

def music_pause() -> str:
    osa('tell application "Music" to pause')
    return "Paused"

def music_next() -> str:
    osa('tell application "Music" to next track')
    return "Next track"

def music_prev() -> str:
    osa('tell application "Music" to previous track')
    return "Previous track"

def music_current() -> dict:
    return {
        "name":   osa('tell application "Music" to get name of current track'),
        "artist": osa('tell application "Music" to get artist of current track'),
        "album":  osa('tell application "Music" to get album of current track'),
        "state":  osa('tell application "Music" to get player state as string'),
    }

def media_current() -> dict:
    apps = app_list()
    if "Spotify" in apps: return {**spotify_current(), "app": "Spotify"}
    if "Music"   in apps: return {**music_current(),   "app": "Music"}
    raise RuntimeError("No music app running")


# ── YouTube via yt-dlp + VLC ──────────────────────────────────────────────────

_vlc_proc = None
_vlc_lock = threading.Lock()

def _vlc_open(url: str):
    global _vlc_proc
    with _vlc_lock:
        if _vlc_proc and _vlc_proc.poll() is None:
            _vlc_proc.terminate()
        _vlc_proc = subprocess.Popen(
            ["vlc", "--no-osd", "--play-and-exit", url],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )

def youtube_play(query: str) -> str:
    try:
        result = subprocess.run(
            ["yt-dlp", "--no-playlist", "--no-warnings", "-f",
             "bestvideo[height<=720]+bestaudio/best[height<=720]",
             "-g", f"ytsearch1:{query}"],
            capture_output=True, text=True, timeout=30
        )
        urls = [u for u in result.stdout.strip().split("\n") if u]
        if not urls:
            raise RuntimeError("No results")
        url = urls[0]
    except FileNotFoundError:
        raise RuntimeError("yt-dlp not installed — run: brew install yt-dlp")
    try:
        _vlc_open(url)
    except FileNotFoundError:
        raise RuntimeError("VLC not installed — run: brew install --cask vlc")
    return f"Playing on YouTube: {query}"

def youtube_pause() -> str:
    try:
        osa('tell application "VLC" to pause')
        return "Paused"
    except Exception:
        raise RuntimeError("VLC not responding")

def youtube_resume() -> str:
    try:
        osa('tell application "VLC" to play')
        return "Resumed"
    except Exception:
        raise RuntimeError("VLC not responding")

def youtube_stop() -> str:
    global _vlc_proc
    with _vlc_lock:
        if _vlc_proc and _vlc_proc.poll() is None:
            _vlc_proc.terminate()
        _vlc_proc = None
    try:
        osa('tell application "VLC" to stop')
    except Exception:
        pass
    return "Stopped"


# ── Volume ────────────────────────────────────────────────────────────────────

def volume_get() -> int:
    return int(osa("output volume of (get volume settings)"))

def volume_set(level: int) -> str:
    level = max(0, min(100, int(level)))
    osa(f"set volume output volume {level}")
    return f"Volume: {level}%"

def volume_mute(muted: bool) -> str:
    osa(f"set volume {'with' if muted else 'without'} output muted")
    return "Muted" if muted else "Unmuted"

def volume_change(delta: int) -> str:
    current = volume_get()
    return volume_set(current + delta)


# ── Brightness ────────────────────────────────────────────────────────────────

def brightness_set(level: float) -> str:
    """level: 0.0–1.0. Requires: brew install brightness"""
    level = max(0.0, min(1.0, float(level)))
    try:
        subprocess.run(["brightness", str(round(level, 2))], check=True, timeout=5)
        return f"Brightness: {int(level * 100)}%"
    except FileNotFoundError:
        # Fallback: use OSD keyboard brightness keys via HID
        raise RuntimeError("Install brightness CLI: brew install brightness")

def brightness_change(delta: float) -> str:
    """delta: positive = brighter, negative = dimmer"""
    try:
        cur = float(cmd("brightness", "-l").split()[-1])
    except Exception:
        cur = 0.5
    return brightness_set(cur + delta)


# ── Files ─────────────────────────────────────────────────────────────────────

def file_open(path: str) -> str:
    subprocess.Popen(["open", os.path.expanduser(path)])
    return f"Opening {path}"

def folder_create(path: str) -> str:
    p = os.path.expanduser(path)
    os.makedirs(p, exist_ok=True)
    return f"Created {p}"

def spotlight(query: str, limit: int = 10) -> list:
    r = subprocess.run(["mdfind", "-name", query],
                       capture_output=True, text=True, timeout=8)
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
    label = "Turn On Do Not Disturb" if enabled else "Turn Off Do Not Disturb"
    try:
        subprocess.run(["shortcuts", "run", label], timeout=6, check=True)
        return f"Do Not Disturb {'on' if enabled else 'off'}"
    except Exception:
        pass
    try:
        # Fallback: Control Center AppleScript (macOS 13+)
        script = '''
tell application "System Events"
    tell application process "Control Center"
        set mb to menu bar 1
        click menu bar item "Control Center" of mb
        delay 0.6
        tell window 1
            set focusBtn to (first button whose description contains "Focus")
            click focusBtn
        end tell
        delay 0.3
        key code 53
    end tell
end tell
'''
        osa(script, timeout=8)
        return f"Focus mode toggled"
    except Exception:
        return ("DND needs a Shortcut named 'Turn On/Off Do Not Disturb'. "
                "Create it in Shortcuts.app.")

def battery() -> dict:
    raw = cmd("pmset", "-g", "batt")
    if "%" not in raw:
        return {"percent": None, "charging": False,
                "note": "Desktop Mac — no battery, running on AC"}
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

def lock_screen() -> str:
    osa('tell application "System Events" to keystroke "q" using {control down, command down}',
        timeout=5)
    return "Screen locked"

def set_timer(seconds: int, label: str = "Timer") -> str:
    script = (f'delay {seconds}\n'
              f'display notification "{label} complete" '
              f'with title "TARS" sound name "Ping"')
    subprocess.Popen(["osascript", "-e", script])
    m, s = divmod(int(seconds), 60)
    human = f"{m}m {s}s" if m else f"{s}s"
    return f"Timer set: {label} in {human}"


# ── Window management ─────────────────────────────────────────────────────────

def _screen_size() -> tuple[int, int]:
    raw = osa('tell application "Finder" to get bounds of window of desktop')
    parts = [int(x.strip()) for x in raw.split(",")]
    return parts[2], parts[3]   # width, height

def _front_app() -> str:
    return osa('tell application "System Events" to get name of '
               'first application process whose frontmost is true')

def window_fullscreen(enable: bool = True) -> str:
    script = f'''
tell application "System Events"
    set frontApp to first application process whose frontmost is true
    set value of attribute "AXFullScreen" of first window of frontApp to {'true' if enable else 'false'}
end tell
'''
    osa(script)
    return "Fullscreen on" if enable else "Fullscreen off"

def window_minimize() -> str:
    script = '''
tell application "System Events"
    set miniaturized of first window of (first application process whose frontmost is true) to true
end tell
'''
    osa(script)
    return "Window minimized"

def window_restore() -> str:
    script = '''
tell application "System Events"
    set p to first application process whose frontmost is true
    repeat with w in windows of p
        if miniaturized of w then set miniaturized of w to false
    end repeat
end tell
'''
    osa(script)
    return "Window restored"

def window_snap(direction: str) -> str:
    w, h = _screen_size()
    half = w // 2
    x = 0 if direction == "left" else half
    script = f'''
tell application "System Events"
    set p to first application process whose frontmost is true
    set position of first window of p to {{{x}, 0}}
    set size of first window of p to {{{half}, {h}}}
end tell
'''
    osa(script)
    return f"Snapped {direction}"

def window_resize(width: int, height: int) -> str:
    script = f'''
tell application "System Events"
    set p to first application process whose frontmost is true
    set size of first window of p to {{{width}, {height}}}
end tell
'''
    osa(script)
    return f"Window resized to {width}×{height}"

def window_move_monitor(target: str = "next") -> str:
    """Move window to next/previous display."""
    w, h = _screen_size()
    script = f'''
tell application "System Events"
    set p to first application process whose frontmost is true
    set pos to position of first window of p
    set x to item 1 of pos
    set newX to (x + {w}) mod ({w} * 2)
    set position of first window of p to {{newX, 0}}
end tell
'''
    try:
        osa(script)
        return f"Window moved to {target} display"
    except Exception:
        raise RuntimeError("Could not move window — check display configuration")


# ── Porcupine hotword detection (optional) ────────────────────────────────────

def start_hotword_detection():
    """
    Background thread for 'Hey TARS' wake word via Porcupine.
    Requires:
      brew install portaudio
      pip3 install pvporcupine pyaudio
      PORCUPINE_ACCESS_KEY env var
      tars-desktop-agent/hey-tars.ppn  (trained at console.picovoice.ai)
    """
    access_key = os.environ.get("PORCUPINE_ACCESS_KEY", "")
    model_path  = os.path.join(os.path.dirname(__file__), "hey-tars.ppn")

    if not access_key:
        print("[TARS agent] Hotword disabled — set PORCUPINE_ACCESS_KEY to enable")
        return

    def _run():
        try:
            import pvporcupine
            import pyaudio

            if os.path.exists(model_path):
                porcupine = pvporcupine.create(
                    access_key=access_key,
                    keyword_paths=[model_path],
                )
                print(f"[TARS agent] Hotword: using custom model {model_path}")
            else:
                # Fallback to built-in 'porcupine' for testing (not 'Hey TARS')
                porcupine = pvporcupine.create(
                    access_key=access_key,
                    keywords=["porcupine"],
                )
                print("[TARS agent] Hotword: no hey-tars.ppn found, using 'porcupine' keyword")

            pa = pyaudio.PyAudio()
            stream = pa.open(
                rate=porcupine.sample_rate,
                channels=1,
                format=pyaudio.paInt16,
                input=True,
                frames_per_buffer=porcupine.frame_length,
            )

            print("[TARS agent] Hotword detection active — listening…")
            while True:
                pcm = stream.read(porcupine.frame_length, exception_on_overflow=False)
                pcm = struct.unpack_from("h" * porcupine.frame_length, pcm)
                if porcupine.process(pcm) >= 0:
                    print("[TARS agent] Hotword detected!")
                    sync_broadcast({"type": "hotword"})

        except ImportError as e:
            print(f"[TARS agent] Hotword disabled — missing library: {e}")
            print("  Install: pip3 install pvporcupine pyaudio")
            print("  System:  brew install portaudio")
        except Exception as e:
            print(f"[TARS agent] Hotword thread error: {e}")

    t = threading.Thread(target=_run, daemon=True)
    t.start()


# ── Dispatcher ────────────────────────────────────────────────────────────────

def dispatch(tool: str, args: dict):
    # App
    if   tool == "app_open":      return app_open(args["name"])
    elif tool == "app_close":     return app_close(args["name"])
    elif tool == "app_switch":    return app_switch(args["name"])
    elif tool == "app_list":      return app_list()
    elif tool == "screenshot":    return screenshot(args.get("mode", "full"))

    # Spotify
    elif tool == "spotify_play":    return spotify_play()
    elif tool == "spotify_pause":   return spotify_pause()
    elif tool == "spotify_next":    return spotify_next()
    elif tool == "spotify_prev":    return spotify_prev()
    elif tool == "spotify_current": return spotify_current()
    elif tool == "spotify_search":  return spotify_search(args["query"])
    elif tool == "spotify_volume":  return spotify_volume(args["level"])

    # Music
    elif tool == "music_play":    return music_play()
    elif tool == "music_pause":   return music_pause()
    elif tool == "music_next":    return music_next()
    elif tool == "music_prev":    return music_prev()
    elif tool == "music_current": return music_current()
    elif tool == "media_current": return media_current()

    # YouTube / VLC
    elif tool == "youtube_play":   return youtube_play(args["query"])
    elif tool == "youtube_pause":  return youtube_pause()
    elif tool == "youtube_resume": return youtube_resume()
    elif tool == "youtube_stop":   return youtube_stop()

    # Volume
    elif tool == "volume_get":    return volume_get()
    elif tool == "volume_set":    return volume_set(args["level"])
    elif tool == "volume_mute":   return volume_mute(bool(args.get("muted", True)))
    elif tool == "volume_change": return volume_change(int(args["delta"]))

    # Brightness
    elif tool == "brightness_set":    return brightness_set(float(args["level"]))
    elif tool == "brightness_change": return brightness_change(float(args["delta"]))

    # Files
    elif tool == "file_open":     return file_open(args["path"])
    elif tool == "folder_create": return folder_create(args["path"])
    elif tool == "spotlight":     return spotlight(args["query"], int(args.get("limit", 10)))
    elif tool == "recent_files":  return recent_files(int(args.get("limit", 10)))

    # System
    elif tool == "dnd":           return dnd_set(bool(args.get("enabled", True)))
    elif tool == "battery":       return battery()
    elif tool == "lock_screen":   return lock_screen()
    elif tool == "set_timer":     return set_timer(int(args["seconds"]), str(args.get("label", "Timer")))

    # Window
    elif tool == "window_fullscreen": return window_fullscreen(bool(args.get("enable", True)))
    elif tool == "window_minimize":   return window_minimize()
    elif tool == "window_restore":    return window_restore()
    elif tool == "window_snap":       return window_snap(args["direction"])
    elif tool == "window_resize":     return window_resize(int(args["width"]), int(args["height"]))
    elif tool == "window_move":       return window_move_monitor(args.get("target", "next"))

    else:
        raise ValueError(f"Unknown tool: {tool}")


# ── WebSocket handler ─────────────────────────────────────────────────────────

async def handler(websocket):
    CLIENTS.add(websocket)
    print(f"[TARS agent] connected  ({len(CLIENTS)} clients)")
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
                await websocket.send(json.dumps({
                    "id": msg_id, "success": True, "result": result
                }))
            except Exception as e:
                print(f"[TARS agent] error: {e}")
                await websocket.send(json.dumps({
                    "id": msg_id or "", "success": False, "error": str(e)
                }))
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        CLIENTS.discard(websocket)
        print(f"[TARS agent] disconnected ({len(CLIENTS)} clients)")


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    global MAIN_LOOP
    MAIN_LOOP = asyncio.get_event_loop()

    print(f"[TARS agent] Phase 2B starting on ws://{HOST}:{PORT}")
    start_hotword_detection()

    async with websockets.serve(handler, HOST, PORT):
        print(f"[TARS agent] ready ✓")
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[TARS agent] stopped")
