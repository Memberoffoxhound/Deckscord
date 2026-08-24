#!/usr/bin/env python3
"""
Deckscord backend
Manages Vesktop process, exposes Discord state to the Decky frontend,
and provides hooks for voice, volume, overlay, and notifications.
"""

import asyncio
import json
import logging
import os
import subprocess
from pathlib import Path

# Decky environment
try:
    import decky
    from decky import logger, emit
except ImportError:
    # Local testing fallback
    class Logger:
        def info(self, *a): print("[INFO]", *a)
        def error(self, *a): print("[ERROR]", *a)
        def warning(self, *a): print("[WARN]", *a)
    logger = Logger()
    def emit(event, data=None): pass

PLUGIN_DIR = Path(os.environ.get("DECKY_PLUGIN_DIR", Path(__file__).parent))
DATA_DIR = Path.home() / ".local" / "share" / "deckscord"
DATA_DIR.mkdir(parents=True, exist_ok=True)

class DeckscordBackend:
    def __init__(self):
        self.vesktop_running = False
        self.current_voice_channel = None
        self.members = {}
        self.settings = {
            "overlay_enabled": True,
            "toasts_enabled": True,
            "join_leave_notify": True,
            "master_volume": 100,
        }

    async def _ensure_vesktop(self):
        """Make sure the Game Mode Vesktop service is alive."""
        try:
            r = subprocess.run(
                ["systemctl", "--user", "is-active", "deckscord-vesktop.service"],
                capture_output=True, text=True
            )
            if r.stdout.strip() != "active":
                subprocess.run(["systemctl", "--user", "start", "deckscord-vesktop.service"], check=False)
                await asyncio.sleep(2)
            self.vesktop_running = True
            logger.info("Vesktop service is active")
        except Exception as e:
            logger.error(f"Could not ensure Vesktop: {e}")
            self.vesktop_running = False

    async def get_status(self):
        await self._ensure_vesktop()
        return {
            "vesktop_running": self.vesktop_running,
            "voice_channel": self.current_voice_channel,
            "members": list(self.members.values()),
            "settings": self.settings,
        }

    async def join_voice(self, channel_id: str, channel_name: str = ""):
        """Placeholder for CDP / IPC join."""
        logger.info(f"Join voice request: {channel_id} ({channel_name})")
        self.current_voice_channel = {"id": channel_id, "name": channel_name}
        # TODO: drive Vesktop via Chrome DevTools Protocol
        return {"ok": True, "channel": self.current_voice_channel}

    async def leave_voice(self):
        logger.info("Leave voice request")
        self.current_voice_channel = None
        return {"ok": True}

    async def set_user_volume(self, user_id: str, volume: int):
        """0–200. Local only."""
        volume = max(0, min(200, volume))
        if user_id in self.members:
            self.members[user_id]["volume"] = volume
        logger.info(f"Set volume {user_id} → {volume}")
        return {"ok": True, "volume": volume}

    async def set_user_mute(self, user_id: str, muted: bool):
        if user_id in self.members:
            self.members[user_id]["local_mute"] = muted
        logger.info(f"Local mute {user_id} → {muted}")
        return {"ok": True, "muted": muted}

    async def set_setting(self, key: str, value):
        if key in self.settings:
            self.settings[key] = value
            # Persist
            (DATA_DIR / "settings.json").write_text(json.dumps(self.settings, indent=2))
        return {"ok": True}

    async def notify_join_leave(self, user_name: str, joined: bool):
        if not self.settings.get("join_leave_notify", True):
            return
        msg = f"{user_name} {'joined' if joined else 'left'} the voice channel"
        try:
            # Decky toaster
            emit("deckscord_toast", {"title": "Deckscord", "body": msg})
        except Exception:
            logger.info(msg)

# Global instance
backend = DeckscordBackend()

async def _main():
    logger.info("Deckscord backend starting")
    await backend._ensure_vesktop()
    # Load settings
    settings_file = DATA_DIR / "settings.json"
    if settings_file.exists():
        try:
            backend.settings.update(json.loads(settings_file.read_text()))
        except Exception:
            pass
    logger.info("Deckscord backend ready")

# Decky entry points
async def get_status():
    return await backend.get_status()

async def join_voice(channel_id: str, channel_name: str = ""):
    return await backend.join_voice(channel_id, channel_name)

async def leave_voice():
    return await backend.leave_voice()

async def set_user_volume(user_id: str, volume: int):
    return await backend.set_user_volume(user_id, volume)

async def set_user_mute(user_id: str, muted: bool):
    return await backend.set_user_mute(user_id, muted)

async def set_setting(key: str, value):
    return await backend.set_setting(key, value)

# Called by Decky on load
async def _main_():
    await _main()
