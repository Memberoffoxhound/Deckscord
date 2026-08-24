#!/usr/bin/env python3
"""
Deckscord backend

Owns the relationship with the Vesktop process (via the systemd user service)
and exposes a clean API to the Decky frontend for:

  - status (running, current voice channel, members)
  - join / leave voice
  - per-user volume (0–200) and local mute
  - settings (overlay, toasts, join/leave alerts, master volume)
  - toast emission for notifications

The live channel list, speaking indicators, and message history will be filled
by a CDP (Chrome DevTools Protocol) client that attaches to Vesktop. That
layer is the next major piece; the hooks and data model are already here.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

# Decky environment
try:
    import decky  # type: ignore
    from decky import logger, emit  # type: ignore
except ImportError:
    class _Logger:
        def info(self, *a: Any) -> None: print("[INFO]", *a)
        def error(self, *a: Any) -> None: print("[ERROR]", *a)
        def warning(self, *a: Any) -> None: print("[WARN]", *a)
    logger = _Logger()
    def emit(event: str, data: Any = None) -> None:
        print(f"[EMIT] {event}", data)

PLUGIN_DIR = Path(os.environ.get("DECKY_PLUGIN_DIR", Path(__file__).parent))
DATA_DIR = Path.home() / ".local" / "share" / "deckscord"
DATA_DIR.mkdir(parents=True, exist_ok=True)
SETTINGS_FILE = DATA_DIR / "settings.json"

DEFAULT_SETTINGS = {
    "overlay_enabled": True,
    "toasts_enabled": True,
    "join_leave_notify": True,
    "master_volume": 100,
}


class DeckscordBackend:
    def __init__(self) -> None:
        self.vesktop_running = False
        self.current_voice_channel: Optional[Dict[str, str]] = None
        self.members: Dict[str, Dict[str, Any]] = {}
        self.settings = dict(DEFAULT_SETTINGS)
        self._load_settings()

    def _load_settings(self) -> None:
        if SETTINGS_FILE.exists():
            try:
                self.settings.update(json.loads(SETTINGS_FILE.read_text()))
            except Exception as e:
                logger.warning(f"Could not load settings: {e}")

    def _save_settings(self) -> None:
        try:
            SETTINGS_FILE.write_text(json.dumps(self.settings, indent=2))
        except Exception as e:
            logger.error(f"Could not save settings: {e}")

    async def _ensure_vesktop(self) -> None:
        """Make sure the Game Mode Vesktop service is alive."""
        try:
            r = subprocess.run(
                ["systemctl", "--user", "is-active", "deckscord-vesktop.service"],
                capture_output=True, text=True, timeout=5,
            )
            if r.stdout.strip() != "active":
                subprocess.run(
                    ["systemctl", "--user", "start", "deckscord-vesktop.service"],
                    check=False, timeout=10,
                )
                await asyncio.sleep(2)
            self.vesktop_running = True
            logger.info("Vesktop service is active")
        except Exception as e:
            logger.error(f"Could not ensure Vesktop: {e}")
            self.vesktop_running = False

    async def get_status(self) -> Dict[str, Any]:
        await self._ensure_vesktop()
        return {
            "vesktop_running": self.vesktop_running,
            "voice_channel": self.current_voice_channel,
            "members": list(self.members.values()),
            "settings": self.settings,
        }

    async def join_voice(self, channel_id: str, channel_name: str = "") -> Dict[str, Any]:
        """Request join. Real implementation will issue CDP commands to Vesktop."""
        logger.info(f"Join voice request: {channel_id} ({channel_name})")
        self.current_voice_channel = {"id": channel_id, "name": channel_name or channel_id}
        # TODO: CDP → Discord client join
        return {"ok": True, "channel": self.current_voice_channel}

    async def leave_voice(self) -> Dict[str, Any]:
        logger.info("Leave voice request")
        self.current_voice_channel = None
        # TODO: CDP → leave
        return {"ok": True}

    async def set_user_volume(self, user_id: str, volume: int) -> Dict[str, Any]:
        volume = max(0, min(200, int(volume)))
        if user_id not in self.members:
            self.members[user_id] = {"id": user_id, "name": user_id, "volume": 100, "local_mute": False}
        self.members[user_id]["volume"] = volume
        logger.info(f"Set volume {user_id} → {volume}")
        # TODO: CDP or local audio graph
        return {"ok": True, "volume": volume}

    async def set_user_mute(self, user_id: str, muted: bool) -> Dict[str, Any]:
        muted = bool(muted)
        if user_id not in self.members:
            self.members[user_id] = {"id": user_id, "name": user_id, "volume": 100, "local_mute": False}
        self.members[user_id]["local_mute"] = muted
        logger.info(f"Local mute {user_id} → {muted}")
        return {"ok": True, "muted": muted}

    async def set_setting(self, key: str, value: Any) -> Dict[str, Any]:
        if key in self.settings:
            self.settings[key] = value
            self._save_settings()
            logger.info(f"Setting {key} = {value}")
        return {"ok": True, "settings": self.settings}

    async def notify_join_leave(self, user_name: str, joined: bool) -> None:
        if not self.settings.get("join_leave_notify", True):
            return
        if not self.settings.get("toasts_enabled", True):
            return
        msg = f"{user_name} {'joined' if joined else 'left'} the voice channel"
        try:
            emit("deckscord_toast", {"title": "Deckscord", "body": msg})
        except Exception:
            logger.info(msg)


backend = DeckscordBackend()


async def _startup() -> None:
    logger.info("Deckscord backend starting")
    await backend._ensure_vesktop()
    logger.info("Deckscord backend ready")


# ---- Decky-callable entry points ----

async def get_status() -> Dict[str, Any]:
    return await backend.get_status()

async def join_voice(channel_id: str, channel_name: str = "") -> Dict[str, Any]:
    return await backend.join_voice(channel_id, channel_name)

async def leave_voice() -> Dict[str, Any]:
    return await backend.leave_voice()

async def set_user_volume(user_id: str, volume: int) -> Dict[str, Any]:
    return await backend.set_user_volume(user_id, volume)

async def set_user_mute(user_id: str, muted: bool) -> Dict[str, Any]:
    return await backend.set_user_mute(user_id, muted)

async def set_setting(key: str, value: Any) -> Dict[str, Any]:
    return await backend.set_setting(key, value)


# Decky load hook
async def _main() -> None:
    await _startup()
