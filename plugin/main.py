#!/usr/bin/env python3
"""Deckscord Decky backend — drives Vesktop over Chrome DevTools Protocol."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import struct
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import decky

CDP_PORT = int(os.environ.get("DECKSCORD_CDP_PORT", "9222"))
SERVICE = "deckscord-vesktop.service"
FLATPAK_ID = "dev.vencord.Vesktop"
PLUGIN_DIR = Path(getattr(decky, "DECKY_PLUGIN_DIR", Path(__file__).parent))
BRIDGE_PATH = PLUGIN_DIR / "bridge.js"
REPO_URL = os.environ.get(
    "DECKSCORD_REPO", "https://github.com/Memberoffoxhound/Deckscord.git"
)


def _login_home() -> Path:
    """Home of the desktop user, even when PluginLoader runs as root.

    DECKY_HOME is ~/homebrew — not a login home. Prefer DECKY_USER_HOME, then
    the parent of the homebrew tree the plugin lives in. SteamOS is /home/deck.
    """
    cands: list[Path] = []
    v = getattr(decky, "DECKY_USER_HOME", None) or os.environ.get("DECKY_USER_HOME")
    if v:
        cands.append(Path(v))
    user = getattr(decky, "DECKY_USER", None) or os.environ.get("DECKY_USER") or os.environ.get("SUDO_USER")
    if user and user not in ("root",):
        cands.append(Path("/home") / str(user))
        cands.append(Path("/var/home") / str(user))
    plugin = PLUGIN_DIR.resolve()
    for p in [plugin, *plugin.parents]:
        if p.name == "homebrew":
            cands.append(p.parent)
            break
    cands.extend([Path("/home/deck"), Path("/var/home/bazzite"), Path("/home/bazzite")])
    h = Path.home()
    if str(h) not in ("/root", "/"):
        cands.append(h)
    seen: set[str] = set()
    for p in cands:
        if p.name == "homebrew":
            p = p.parent
        key = str(p)
        if key in seen:
            continue
        seen.add(key)
        if p.name in ("root", "") or key in ("/", "/root"):
            continue
        if p.is_dir():
            return p
    return Path("/home/deck")


def _ensure_dir(path: Path) -> Path:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".w"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return path
    except OSError:
        alt = Path(f"/tmp/deckscord-{os.getuid()}")
        alt.mkdir(parents=True, exist_ok=True)
        return alt


DATA_DIR = _ensure_dir(_login_home() / ".local" / "share" / "deckscord")
SETTINGS_PATH = DATA_DIR / "settings.json"
PIP_DIR = _ensure_dir(DATA_DIR / "pip")
WANT_PORTAL = DATA_DIR / "want-portal"


def _nudge_portal() -> None:
    try:
        WANT_PORTAL.write_text(str(time.time()), encoding="utf-8")
    except OSError:
        pass

DEFAULT_SETTINGS: dict[str, Any] = {
    "pip": {
        "enabled": False,
        "corner": "bottom-right",
        "size": "small",
        "opacity": 100,
        "userId": None,
        "kind": "screenshare",
        "name": "",
    },
    "talking": {
        "enabled": False,
        "corner": "top-left",
        "size": "small",
        "opacity": 90,
        "showSelf": True,
    },
    "golive": {"width": 1280, "height": 720, "fps": 30},
}

VESKTOP_AUDIO_DEFAULTS: dict[str, Any] = {
    "workaround": False,
    "deviceSelect": False,
    "granularSelect": False,
    "ignoreVirtual": False,
    "ignoreDevices": True,
    "ignoreInputMedia": True,
    "onlySpeakers": True,
    "onlyDefaultSpeakers": True,
}

# PluginLoader is a PyInstaller binary. Child plugin processes inherit
# LD_LIBRARY_PATH=/tmp/_MEI... which makes systemctl (and other host
# binaries) fail to load libcrypto. Also no XDG_RUNTIME_DIR / D-Bus.
_PYI_KEYS = (
    "LD_LIBRARY_PATH",
    "PYTHONPATH",
    "PYTHONHOME",
    "_PYI_APPLICATION_HOME_DIR",
    "_PYI_PARENT_PROCESS_LEVEL",
    "_PYI_LINUX_PROCESS_NAME",
)


def _login_uid_gid() -> tuple[int, int]:
    home = _login_home()
    try:
        st = home.stat()
        return int(st.st_uid), int(st.st_gid)
    except OSError:
        return 1000, 1000


def _subprocess_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in _PYI_KEYS}
    home = _login_home()
    uid, _gid = _login_uid_gid()
    runtime = f"/run/user/{uid}"
    env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:" + (env.get("PATH") or "")
    env["HOME"] = str(home)
    env["USER"] = home.name
    env["XDG_RUNTIME_DIR"] = runtime
    env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={runtime}/bus"
    return env


def _system_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in _PYI_KEYS}
    env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
    env.pop("DBUS_SESSION_BUS_ADDRESS", None)
    env.pop("XDG_RUNTIME_DIR", None)
    return env


def _chown_tree(path: Path, uid: int, gid: int) -> None:
    try:
        os.chown(path, uid, gid)
    except OSError:
        pass
    if not path.is_dir():
        return
    for root, dirs, files in os.walk(path):
        try:
            os.chown(root, uid, gid)
        except OSError:
            pass
        for name in dirs + files:
            try:
                os.chown(os.path.join(root, name), uid, gid)
            except OSError:
                pass


def _chmod_write(path: Path, directory: bool) -> None:
    try:
        os.chmod(path, 0o775 if directory else 0o664)
    except OSError:
        try:
            mode = path.stat().st_mode
            os.chmod(path, mode | (0o220 if not directory else 0o220))
        except OSError:
            pass


def _force_writable(path: Path, uid: int, gid: int) -> None:
    if os.geteuid() == 0:
        try:
            os.chown(path, uid, gid)
        except OSError:
            pass
    _chmod_write(path, path.is_dir())


def _plugin_dst() -> Path:
    here = Path(getattr(decky, "DECKY_PLUGIN_DIR", None) or PLUGIN_DIR).resolve()
    if here.name == "plugin" and (here.parent / "plugin.json").is_file():
        here = here.parent
    return here


def _dir_is_writable(path: Path) -> bool:
    try:
        return path.is_dir() and os.access(path, os.W_OK | os.X_OK)
    except OSError:
        return False


def _write_bytes(path: Path, data: bytes, uid: int, gid: int) -> None:
    """Write `path` even when the parent directory is root-owned 0755.

    Atomic replace needs +w on the directory (Decky often leaves
    ~/homebrew/plugins/Deckscord owned by root). Files the user already
    owns can still be truncated in place — that is the QAM updater path
    on Bazzite, where PluginLoader is euid=1000 and sudo -n is not set.
    """
    parent = path.parent
    orig_mode = None
    try:
        if path.exists():
            orig_mode = path.stat().st_mode
    except OSError:
        pass

    if _dir_is_writable(parent):
        tmp = parent / f".{path.name}.decknew.{os.getpid()}"
        tmp.write_bytes(data)
        os.replace(tmp, path)
    elif path.exists():
        if not os.access(path, os.W_OK):
            _chmod_write(path, False)
        fd = os.open(str(path), os.O_WRONLY | os.O_TRUNC)
        try:
            os.write(fd, data)
            os.fsync(fd)
        finally:
            os.close(fd)
    else:
        raise PermissionError(f"cannot create {path}: {parent} is not writable")

    if orig_mode is not None:
        try:
            os.chmod(path, orig_mode)
        except OSError:
            pass
    if os.geteuid() == 0:
        try:
            os.chown(path, uid, gid)
        except OSError:
            pass


def _install_file(src: Path, dst: Path, uid: int, gid: int) -> None:
    data = src.read_bytes()
    try:
        dst.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        if not dst.parent.is_dir():
            raise
    _force_writable(dst.parent, uid, gid)
    _write_bytes(dst, data, uid, gid)
    _force_writable(dst, uid, gid)


def _copy_plugin_tree(src: Path, dst: Path, uid: int, gid: int) -> list[str]:
    """Overlay-copy plugin files. No rsync -a (that preserves root owner and --delete hits EACCES).

    Returns a list of per-file errors. Core files may still have been written.
    """
    skip_dir = {"__pycache__", "node_modules", ".git"}
    errors: list[str] = []
    try:
        dst.mkdir(parents=True, exist_ok=True)
    except OSError:
        if not dst.is_dir():
            return [f"mkdir {dst}: permission denied"]
    _force_writable(dst, uid, gid)
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in skip_dir]
        rel = Path(root).relative_to(src)
        dest_dir = dst / rel
        try:
            dest_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            if not dest_dir.is_dir():
                errors.append(f"mkdir {dest_dir}: permission denied")
                continue
        _force_writable(dest_dir, uid, gid)
        for name in files:
            if name.endswith(".pyc") or name.endswith(".decknew"):
                continue
            try:
                _install_file(Path(root) / name, dest_dir / name, uid, gid)
            except OSError as e:
                errors.append(f"{rel / name}: {e}")
    for junk in dst.glob("n.*"):
        try:
            if junk.is_file() and len(junk.name) < 20:
                junk.unlink()
        except OSError:
            pass
    for tmp in dst.rglob("*.decknew*"):
        try:
            tmp.unlink()
        except OSError:
            pass
    return errors


def _load_settings() -> dict[str, Any]:
    doc: dict[str, Any] = json.loads(json.dumps(DEFAULT_SETTINGS))
    try:
        raw = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            pip = dict(doc["pip"])
            pip.update((raw.get("pip") or {}) if isinstance(raw.get("pip"), dict) else {})
            talking = dict(doc["talking"])
            talking.update((raw.get("talking") or {}) if isinstance(raw.get("talking"), dict) else {})
            golive = dict(doc["golive"])
            golive.update((raw.get("golive") or {}) if isinstance(raw.get("golive"), dict) else {})
            doc["pip"] = pip
            doc["talking"] = talking
            doc["golive"] = golive
    except Exception:
        pass
    return doc


def _save_settings(doc: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = SETTINGS_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    tmp.replace(SETTINGS_PATH)
    uid, gid = _login_uid_gid()
    try:
        os.chown(SETTINGS_PATH, uid, gid)
    except OSError:
        pass


def _vesktop_config_dir() -> Path:
    home = _login_home()
    cands = [
        home / ".var" / "app" / "dev.vencord.Vesktop" / "config" / "vesktop",
        home / ".config" / "vesktop",
    ]
    for p in cands:
        if (p / "settings.json").is_file() or p.is_dir():
            return p
    return cands[0]


def _read_json(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def _write_json(path: Path, doc: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(doc, indent=4), encoding="utf-8")
    tmp.replace(path)
    uid, gid = _login_uid_gid()
    try:
        os.chown(path, uid, gid)
    except OSError:
        pass


def _set_nested(doc: dict[str, Any], key: str, value: Any) -> dict[str, Any]:
    parts = [p for p in str(key).split(".") if p]
    if not parts:
        return doc
    cur: dict[str, Any] = doc
    for p in parts[:-1]:
        nxt = cur.get(p)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[p] = nxt
        cur = nxt
    cur[parts[-1]] = value
    return doc


def _pip_dims(size: str) -> tuple[int, int]:
    if str(size) == "large":
        return 854, 480
    return 426, 240


def _pick_display() -> Optional[str]:
    raw = os.environ.get("DISPLAY") or ""
    if raw:
        n = raw.lstrip(":").split(".")[0]
        if Path(f"/tmp/.X11-unix/X{n}").exists():
            return raw if raw.startswith(":") else f":{n}"
    for n in range(0, 8):
        if Path(f"/tmp/.X11-unix/X{n}").exists():
            return f":{n}"
    return None


def _vesktop_unit_text() -> str:
    return f"""[Unit]
Description=Deckscord Vesktop (Discord) for Game Mode
After=graphical-session.target
StartLimitIntervalSec=0

[Service]
Type=simple
Restart=on-failure
RestartSec=8
KillMode=control-group
TimeoutStopSec=12
TimeoutStartSec=200
Environment=ELECTRON_OZONE_PLATFORM_HINT=x11
Environment=DECKSCORD_CDP_PORT={CDP_PORT}
ExecStartPre=/bin/bash -c 'for i in $(seq 1 180); do pgrep -x kwin_wayland >/dev/null && exit 0; pgrep -x kwin_x11 >/dev/null && exit 0; pgrep -x gamescope >/dev/null && exit 0; pgrep -x gamescope-wl >/dev/null && exit 0; sleep 1; done; exit 1'
ExecStart=%h/.local/share/deckscord/launch-vesktop.sh
ExecStop=/usr/bin/flatpak kill {FLATPAK_ID}

[Install]
WantedBy=default.target
"""


def _harden_vesktop_unit() -> None:
    """Wait for a compositor before Electron starts, so linger cannot grab DRM at boot."""
    path = _login_home() / ".config" / "systemd" / "user" / SERVICE
    try:
        cur = path.read_text(encoding="utf-8") if path.is_file() else ""
    except OSError:
        return
    if "ExecStartPre=" in cur and "pgrep -x gamescope" in cur:
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(_vesktop_unit_text(), encoding="utf-8")
        _systemctl("daemon-reload", timeout=8)
        decky.logger.info("rewrote vesktop unit to wait for compositor")
    except Exception as e:
        decky.logger.warning(f"vesktop unit: {e}")


def _overlay_env() -> dict[str, str]:
    env = _subprocess_env()
    home = _login_home()
    disp = _pick_display()
    if disp:
        env["DISPLAY"] = disp
    env["GDK_BACKEND"] = "x11"
    env.pop("WAYLAND_DISPLAY", None)
    env.pop("GAMESCOPE_WAYLAND_DISPLAY", None)
    for auth in (home / ".Xauthority", Path("/tmp/.Xauthority"), Path(f"/run/user/{_login_uid_gid()[0]}/gdm/Xauthority")):
        if auth.is_file():
            env["XAUTHORITY"] = str(auth)
            break
    return env


def _run(cmd: list[str], timeout: int = 15) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        env=_subprocess_env(),
    )


def _systemctl(*args: str, timeout: int = 8) -> subprocess.CompletedProcess:
    return _run(["/usr/bin/systemctl", "--user", *args], timeout=timeout)


def _pactl(*args: str, timeout: int = 5) -> subprocess.CompletedProcess:
    pactl = "/usr/bin/pactl"
    if not Path(pactl).exists():
        pactl = "pactl"
    return _run([pactl, *args], timeout=timeout)


SILENCE_SINK = "deckscord_silence"
SILENCE_MIC = "deckscord.mic"

_VOICE_SKIP = (
    "monitor",
    "loopback",
    "stereo mix",
    "what-u-hear",
    "wave out",
    "vencord-screen-share",
    "venmic",
    "screen-share",
    "screenshare",
    "screen share",
    "audio share",
    "share audio",
    "desktop audio",
    "system audio",
    "entire system",
    "chromium",
    "chrome",
    "deckscord_silence",
    "deckscord.silence",
)


def _is_monitor_source(name: str) -> bool:
    """True for anything that is not a microphone (speakers, share virtmic, default)."""
    n = (name or "").lower().strip()
    if not n:
        return True
    if n == SILENCE_MIC or n.startswith("deckscord.mic"):
        return False
    if n in ("default", "communications"):
        return True
    if n.startswith("alsa_output") or n.startswith("bluez_output"):
        return True
    return any(s in n for s in _VOICE_SKIP)


def _pulse_sources() -> list[str]:
    r = _pactl("list", "short", "sources")
    names: list[str] = []
    for line in (r.stdout or "").splitlines():
        parts = line.split()
        if len(parts) >= 2:
            names.append(parts[1])
    return names


def _pick_real_mic(sources: list[str]) -> Optional[str]:
    real = [s for s in sources if not _is_monitor_source(s) and s != SILENCE_MIC]
    if not real:
        return None
    for s in real:
        sl = s.lower()
        if "mic" in sl or "headset" in sl or "headphone" in sl:
            return s
    for s in real:
        if s.startswith("alsa_input") or s.startswith("bluez_input"):
            return s
    return real[0]


def _ensure_silence_mic() -> Optional[str]:
    """Silent capture source so voice never falls through to a speaker monitor."""
    sources = _pulse_sources()
    if SILENCE_MIC in sources:
        return SILENCE_MIC
    _pactl(
        "load-module",
        "module-null-source",
        f"source_name={SILENCE_MIC}",
        'source_properties=device.description="Deckscord Silent Mic"',
    )
    sources = _pulse_sources()
    if SILENCE_MIC in sources:
        return SILENCE_MIC
    _pactl(
        "load-module",
        "module-null-sink",
        f"sink_name={SILENCE_SINK}",
        'sink_properties=device.description="Deckscord Silence"',
    )
    _pactl(
        "load-module",
        "module-remap-source",
        f"source_name={SILENCE_MIC}",
        f"master={SILENCE_SINK}.monitor",
        'source_properties=device.description="Deckscord Silent Mic"',
    )
    sources = _pulse_sources()
    return SILENCE_MIC if SILENCE_MIC in sources else None


def ensure_mic_not_loopback() -> dict[str, Any]:
    """Voice capture is a microphone, or silence — never a speaker/desktop monitor.

    Discord's 'default' input follows PipeWire's default source. HDMI *.monitor
    and Vesktop's vencord-screen-share virtmic both dump game/system audio into
    the voice channel. Game audio belongs on the Go Live track only.
    """
    cur = (_pactl("get-default-source").stdout or "").strip()
    sources = _pulse_sources()
    mic = _pick_real_mic(sources)
    silent = False
    if not mic:
        mic = _ensure_silence_mic()
        silent = bool(mic)
        sources = _pulse_sources()
    changed = False
    if mic and (not cur or _is_monitor_source(cur) or (not silent and cur == SILENCE_MIC)):
        _pactl("set-default-source", mic)
        changed = True
        cur = mic
    loopback = bool(cur and _is_monitor_source(cur))
    return {
        "source": cur,
        "mic": mic if not silent else None,
        "silent": silent,
        "loopback": loopback,
        "changed": changed,
        "sources": sources[:12],
    }


_AUDIO_SKIP = (
    "vesktop",
    "vencord",
    "discord",
    "chrome",
    "chromium",
    "firefox",
    "steamwebhelper",
    "plasmashell",
    "pipewire",
    "wireplumber",
    "pulseaudio",
    "deckscord",
)


def _pw_dump() -> list[Any]:
    try:
        r = _run(["/usr/bin/pw-dump"], timeout=5)
        if r.returncode != 0:
            r = _run(["pw-dump"], timeout=5)
        return json.loads(r.stdout or "[]")
    except Exception as e:
        decky.logger.warning(f"pw-dump: {e}")
        return []


def find_gamescope_node() -> Optional[dict[str, Any]]:
    vids: list[dict[str, Any]] = []
    for n in _pw_dump():
        if not str(n.get("type") or "").endswith("Node"):
            continue
        info = n.get("info") or {}
        props = info.get("props") or {}
        mc = str(props.get("media.class") or "")
        name = str(props.get("node.name") or "")
        desc = str(props.get("node.description") or "")
        blob = f"{mc} {name} {desc}".lower()
        if any(x in blob for x in ("v4l2", "loopback", "video42", "deckscord")):
            continue
        if "video/source" in mc.lower() or "gamescope" in blob or "screen" in blob:
            vids.append({"id": n.get("id"), "name": name, "class": mc, "description": desc})
    for v in vids:
        nm = (v.get("name") or "").lower()
        if "gamescope" in nm or "screen" in nm:
            return v
    return vids[0] if vids else None


def list_game_audio_nodes() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in _pw_dump():
        if not str(n.get("type") or "").endswith("Node"):
            continue
        props = ((n.get("info") or {}).get("props")) or {}
        mc = str(props.get("media.class") or "")
        if "stream/output/audio" not in mc.lower():
            continue
        name = str(props.get("node.name") or "")
        app = str(props.get("application.name") or props.get("node.description") or "")
        binary = str(props.get("application.process.binary") or "")
        blob = f"{name} {app} {binary}".lower()
        if any(s in blob for s in _AUDIO_SKIP):
            continue
        out.append({
            "id": n.get("id"),
            "name": name,
            "app": app,
            "binary": binary,
        })
    return out[:8]


def in_game_mode() -> bool:
    kwin = False
    gamescope = False
    try:
        for p in Path("/proc").iterdir():
            if not p.name.isdigit():
                continue
            try:
                comm = (p / "comm").read_text().strip()
            except OSError:
                continue
            if comm in ("kwin_wayland", "kwin_x11"):
                kwin = True
            if comm in ("gamescope", "gamescope-wl"):
                gamescope = True
    except OSError:
        pass
    if kwin:
        return False
    return gamescope


class Cdp:
    """Minimal CDP client. Stdlib only — no extra Python deps."""

    def __init__(self) -> None:
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._recv_task: Optional[asyncio.Task] = None
        self._buf = bytearray()
        self._lock = asyncio.Lock()

    @property
    def connected(self) -> bool:
        return self._writer is not None and not self._writer.is_closing()

    async def close(self) -> None:
        if self._recv_task:
            self._recv_task.cancel()
            self._recv_task = None
        if self._writer:
            try:
                self._writer.close()
                await self._writer.wait_closed()
            except Exception:
                pass
        self._writer = None
        self._reader = None
        for fut in self._pending.values():
            if not fut.done():
                fut.cancel()
        self._pending.clear()

    async def connect(self, ws_url: str) -> None:
        await self.close()
        u = urlparse(ws_url)
        host = u.hostname or "127.0.0.1"
        port = u.port or 9222
        path = u.path or "/"
        if u.query:
            path += "?" + u.query
        reader, writer = await asyncio.open_connection(host, port)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        )
        writer.write(req.encode())
        await writer.drain()
        header = b""
        while b"\r\n\r\n" not in header:
            chunk = await asyncio.wait_for(reader.read(1024), timeout=8)
            if not chunk:
                raise ConnectionError("CDP websocket handshake closed")
            header += chunk
        if b"101" not in header.split(b"\r\n", 1)[0]:
            raise ConnectionError(f"CDP handshake failed: {header[:200]!r}")
        leftover = header.split(b"\r\n\r\n", 1)[1]
        self._reader = reader
        self._writer = writer
        self._buf = bytearray(leftover)
        self._recv_task = asyncio.create_task(self._recv_loop())

    async def call(self, method: str, params: Optional[dict] = None, timeout: float = 12.0) -> Any:
        if not self.connected:
            raise ConnectionError("not connected")
        self._id += 1
        msg_id = self._id
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[msg_id] = fut
        payload = {"id": msg_id, "method": method}
        if params is not None:
            payload["params"] = params
        async with self._lock:
            self._send_frame(json.dumps(payload, separators=(",", ":")))
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        finally:
            self._pending.pop(msg_id, None)

    def _send_frame(self, text: str) -> None:
        assert self._writer is not None
        data = text.encode("utf-8")
        mask = os.urandom(4)
        header = bytearray([0x81])
        n = len(data)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", n))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", n))
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        self._writer.write(header + mask + masked)

    async def _recv_loop(self) -> None:
        try:
            while self._reader:
                msg = await self._read_message()
                if msg is None:
                    break
                try:
                    obj = json.loads(msg)
                except Exception:
                    continue
                mid = obj.get("id")
                if mid in self._pending and not self._pending[mid].done():
                    if "error" in obj:
                        self._pending[mid].set_exception(RuntimeError(obj["error"]))
                    else:
                        self._pending[mid].set_result(obj.get("result"))
        except asyncio.CancelledError:
            return
        except Exception as e:
            decky.logger.error(f"CDP recv: {e}")
        finally:
            self._writer = None
            self._reader = None
            for fut in list(self._pending.values()):
                if not fut.done():
                    fut.set_exception(ConnectionError("CDP disconnected"))

    async def _read_message(self) -> Optional[str]:
        assert self._reader is not None
        parts: list[bytes] = []
        while True:
            op, payload, fin = await self._read_frame()
            if op == 0x8:
                return None
            if op == 0x9:
                continue
            parts.append(payload)
            if fin:
                return b"".join(parts).decode("utf-8", "replace")

    async def _ensure(self, n: int) -> None:
        assert self._reader is not None
        while len(self._buf) < n:
            chunk = await self._reader.read(4096)
            if not chunk:
                raise ConnectionError("CDP closed")
            self._buf.extend(chunk)

    async def _read_frame(self) -> tuple[int, bytes, bool]:
        await self._ensure(2)
        b0, b1 = self._buf[0], self._buf[1]
        del self._buf[:2]
        fin = bool(b0 & 0x80)
        op = b0 & 0x0F
        masked = bool(b1 & 0x80)
        length = b1 & 0x7F
        if length == 126:
            await self._ensure(2)
            length = struct.unpack("!H", bytes(self._buf[:2]))[0]
            del self._buf[:2]
        elif length == 127:
            await self._ensure(8)
            length = struct.unpack("!Q", bytes(self._buf[:8]))[0]
            del self._buf[:8]
        mask = b""
        if masked:
            await self._ensure(4)
            mask = bytes(self._buf[:4])
            del self._buf[:4]
        await self._ensure(length)
        payload = bytes(self._buf[:length])
        del self._buf[:length]
        if masked:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        return op, payload, fin


def _cdp_targets() -> list[dict]:
    url = f"http://127.0.0.1:{CDP_PORT}/json"
    req = urllib.request.Request(url, headers={"Host": f"127.0.0.1:{CDP_PORT}"})
    with urllib.request.urlopen(req, timeout=3) as resp:
        return json.loads(resp.read().decode())


def _pick_target(targets: list[dict]) -> Optional[dict]:
    scored: list[tuple[int, dict]] = []
    for t in targets:
        u = (t.get("url") or "") + " " + (t.get("title") or "")
        ws = t.get("webSocketDebuggerUrl")
        if not ws:
            continue
        score = 0
        lu = u.lower()
        if "discord.com" in lu:
            score += 10
        if "/channels" in lu or "/app" in lu:
            score += 5
        if "vesktop://" in lu:
            score += 3
        if t.get("type") == "page":
            score += 2
        if "devtools://" in lu:
            continue
        if score:
            scored.append((score, t))
    if not scored:
        return next((t for t in targets if t.get("webSocketDebuggerUrl") and "devtools://" not in (t.get("url") or "")), None)
    scored.sort(key=lambda x: -x[0])
    return scored[0][1]


SINK_ID = "deckscord-qam"


class Plugin:
    def __init__(self) -> None:
        self.cdp = Cdp()
        self._bridge_hash = ""
        self._injecting = asyncio.Lock()
        self._status_lock = asyncio.Lock()
        self._can_hide_window = True
        self._video_enabled = True
        self._grab_alive_until = 0.0
        self._last_frames: list[dict[str, Any]] = []
        self._audio_focus: dict[str, Any] = {"userId": None, "saved": {}}
        self._grab_lock = asyncio.Lock()
        self._last_voice_channel: Optional[str] = None
        self._grab_log_at = 0.0
        self._audio_hygiene_at = 0.0
        self._portal_proc: Optional[subprocess.Popen] = None
        self._update: dict[str, Any] = {"phase": "idle", "percent": 0, "message": ""}
        self._update_task: Optional[asyncio.Task] = None
        self._settings = _load_settings()
        self._pip_proc: Optional[subprocess.Popen] = None
        self._pip_task: Optional[asyncio.Task] = None
        self._talk_hold: dict[str, float] = {}
        self._talk_last: dict[str, dict[str, Any]] = {}
        self._talk_in_voice = False
        self._mic_pin_until = 0.0
        self._go_live_until = 0.0
        self._go_live_pending = False

    async def _main(self) -> None:
        decky.logger.info("Deckscord backend starting")
        try:
            _harden_vesktop_unit()
        except Exception as e:
            decky.logger.warning(f"vesktop unit: {e}")
        try:
            svc = await self._ensure_vesktop(wait=True)
            decky.logger.info(f"vesktop service: {svc}")
        except Exception as e:
            decky.logger.warning(f"vesktop start: {e}")
        try:
            hy = ensure_mic_not_loopback()
            decky.logger.info(f"capture source: {hy}")
        except Exception as e:
            decky.logger.warning(f"capture source: {e}")
        try:
            self._ensure_portal_shim()
        except Exception as e:
            decky.logger.warning(f"portal shim: {e}")
        pip = (self._settings.get("pip") or {})
        if pip.get("enabled") and pip.get("userId"):
            pip["enabled"] = False
            pip["userId"] = None
            self._settings["pip"] = pip
            _save_settings(self._settings)
        self._pip_task = asyncio.create_task(self._pip_loop())

    async def _unload(self) -> None:
        try:
            await self._eval("window.__deckscord && window.__deckscord.ensureVideoSinks(false)")
        except Exception:
            pass
        task = self._pip_task
        self._pip_task = None
        if task:
            task.cancel()
        self._stop_pip_overlay()
        self._stop_portal_shim()
        await self.cdp.close()

    def _ensure_portal_shim(self) -> None:
        proc = self._portal_proc
        if proc is not None and proc.poll() is None:
            return
        script = PLUGIN_DIR / "portal_shim.py"
        if not script.is_file():
            decky.logger.warning("portal_shim.py missing")
            return
        log = DATA_DIR / "portal-shim.log"
        log_f = open(log, "ab")
        log_f.write(f"\n--- {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n".encode())
        log_f.flush()
        env = _subprocess_env()
        self._portal_proc = subprocess.Popen(
            ["/usr/bin/python3", str(script)],
            stdout=log_f,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            env=env,
            start_new_session=True,
            close_fds=True,
        )
        decky.logger.info(f"portal shim pid={self._portal_proc.pid} log={log}")

    def _stop_portal_shim(self) -> None:
        proc = self._portal_proc
        self._portal_proc = None
        if not proc or proc.poll() is not None:
            return
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    async def _ensure_vesktop(self, wait: bool = False) -> dict[str, Any]:
        try:
            r = _systemctl("is-active", SERVICE, timeout=5)
            state = (r.stdout or "").strip() or "inactive"
            if r.returncode != 0 and (r.stderr or "").strip():
                decky.logger.warning(f"systemctl is-active: {r.stderr.strip()[:300]}")
            if state not in ("active", "activating"):
                _systemctl("start", SERVICE, timeout=10)
                r = _systemctl("is-active", SERVICE, timeout=5)
                state = (r.stdout or "").strip() or "inactive"
            if wait and state != "active":
                await asyncio.sleep(2)
                r = _systemctl("is-active", SERVICE, timeout=5)
                state = (r.stdout or "").strip() or "inactive"
            return {"running": state == "active", "state": state}
        except Exception as e:
            decky.logger.error(f"vesktop service: {e}")
            return {"running": False, "state": "failed", "error": str(e)}

    async def _ensure_cdp(self, inject: bool = True, attempts: int = 8, hide: bool = False) -> None:
        want = None
        try:
            want = _pick_target(_cdp_targets())
        except Exception:
            want = None
        if self.cdp.connected:
            try:
                href = await self._eval("location.href", timeout=3)
                want_url = (want or {}).get("url") or ""
                if href and want_url and href.split("#")[0] not in want_url and want_url.split("#")[0] not in str(href):
                    await self.cdp.close()
                else:
                    if inject:
                        try:
                            await self._inject_bridge()
                        except Exception:
                            pass
                    if hide:
                        await self._hide_window()
                    return
            except Exception:
                await self.cdp.close()
        last_err: Optional[Exception] = None
        for i in range(max(1, attempts)):
            try:
                targets = _cdp_targets()
                t = _pick_target(targets)
                if not t:
                    raise ConnectionError("no CDP targets (is Vesktop running / logged in?)")
                await self.cdp.connect(t["webSocketDebuggerUrl"])
                if inject:
                    try:
                        await self._inject_bridge()
                    except Exception:
                        pass
                if hide:
                    await self._hide_window()
                return
            except Exception as e:
                last_err = e
                await self.cdp.close()
                if i + 1 < attempts:
                    await asyncio.sleep(1.2)
        raise ConnectionError(str(last_err) if last_err else "CDP connect failed")

    async def _hide_window(self) -> None:
        if not self._can_hide_window:
            return
        try:
            info = await self.cdp.call("Browser.getWindowForTarget", {}, timeout=3)
            wid = (info or {}).get("windowId")
            if wid is None:
                return
            await self.cdp.call(
                "Browser.setWindowBounds",
                {"windowId": wid, "bounds": {"windowState": "minimized"}},
                timeout=3,
            )
        except Exception as e:
            if "wasn't found" in str(e) or "-32601" in str(e):
                self._can_hide_window = False

    async def _inject_bridge(self) -> None:
        src = BRIDGE_PATH.read_text(encoding="utf-8")
        h = hashlib.sha1(src.encode()).hexdigest()
        async with self._injecting:
            if self._bridge_hash == h:
                ping = await self._eval("window.__deckscord ? window.__deckscord.ping() : {ok:false}")
                if isinstance(ping, dict) and ping.get("ok"):
                    return
            result = await self._eval(f"(function(){{ {src}\n }})()")
            if isinstance(result, dict) and result.get("ok") is False:
                raise RuntimeError(result.get("error") or "bridge inject failed")
            self._bridge_hash = h
            if self._audio_focus.get("userId"):
                try:
                    await self._eval(
                        "window.__deckscord && window.__deckscord.restoreAudioFocus("
                        + json.dumps(self._audio_focus)
                        + ")"
                    )
                except Exception:
                    pass

    async def _eval(self, expression: str, timeout: float = 12.0) -> Any:
        res = await self.cdp.call(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": True,
                "userGesture": True,
            },
            timeout=timeout,
        )
        if not res:
            return None
        if res.get("exceptionDetails"):
            desc = res["exceptionDetails"].get("text") or res["exceptionDetails"]
            raise RuntimeError(str(desc))
        val = (res.get("result") or {}).get("value")
        return val

    async def _bridge(self, call: str) -> Any:
        await self._ensure_vesktop(wait=False)
        await self._ensure_cdp(inject=True)
        await self._inject_bridge()
        return await self._eval(f"window.__deckscord.{call}")

    async def _submit_first_launch(self) -> bool:
        js = """
        (function(){
          var b = document.getElementById('submit');
          if (!b) return {ok:false, error:'no submit'};
          b.click();
          return {ok:true};
        })()
        """
        r = await self._eval(js)
        return isinstance(r, dict) and r.get("ok") is True

    async def _grab_login_qr(self) -> Optional[str]:
        # Discord login QR is an SVG inside [aria-label*="QR"], not the hidden
        # 240x240 fingerprint canvas (toDataURL of that is a dummy pattern).
        clip = await self._eval(
            """
            (function(){
              var el = document.querySelector('[aria-label*="QR code"]')
                    || document.querySelector('[class*="qrCodeContainer"]')
                    || document.querySelector('[class*="qrCode"] svg')
                    || document.querySelector('[class*="qrCode"]');
              if (!el) return null;
              var r = el.getBoundingClientRect();
              if (r.width < 80 || r.height < 80) return null;
              return {x:r.x, y:r.y, width:r.width, height:r.height};
            })()
            """
        )
        if not isinstance(clip, dict):
            return None
        try:
            shot = await self.cdp.call(
                "Page.captureScreenshot",
                {
                    "format": "png",
                    "clip": {
                        "x": float(clip["x"]),
                        "y": float(clip["y"]),
                        "width": float(clip["width"]),
                        "height": float(clip["height"]),
                        "scale": 1,
                    },
                },
                timeout=6,
            )
            data = (shot or {}).get("data")
            if data:
                return "data:image/png;base64," + data
        except Exception as e:
            decky.logger.warning(f"QR screenshot: {e}")
        return None

    # ---- Decky-callable -------------------------------------------------

    async def get_status(self) -> dict[str, Any]:
        async with self._status_lock:
            return await self._get_status_unlocked()

    async def _get_status_unlocked(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "vesktop_running": False,
            "vesktop_state": "unknown",
            "cdp": False,
            "logged_in": False,
            "ready": False,
            "phase": "starting",
            "phase_label": "Starting Discord…",
            "videoEnabled": bool(self._video_enabled),
            "update": dict(self._update),
            "pip": dict((self._settings.get("pip") or {})),
            "talking": dict((self._settings.get("talking") or {})),
        }

        targets: Optional[list] = None
        try:
            targets = _cdp_targets()
        except Exception:
            targets = None

        if not targets:
            svc = await self._ensure_vesktop(wait=False)
            out["vesktop_running"] = bool(svc.get("running"))
            out["vesktop_state"] = svc.get("state") or "inactive"
            if svc.get("error"):
                out["error"] = svc["error"]
            try:
                targets = _cdp_targets()
            except Exception:
                targets = None
            if not targets:
                if out["vesktop_state"] in ("active", "activating") or out["vesktop_running"]:
                    out["phase"] = "loading"
                    out["phase_label"] = "Discord is loading…"
                else:
                    out["phase"] = "starting"
                    out["phase_label"] = "Starting Discord…"
                return out

        out["cdp"] = True
        out["vesktop_running"] = True
        out["vesktop_state"] = "active"
        blob = " ".join(((t.get("url") or "") + " " + (t.get("title") or "")) for t in targets).lower()
        if "first-launch" in blob or "vesktop://static" in blob:
            try:
                await self._ensure_cdp(inject=False, attempts=2, hide=False)
                if "first-launch" in blob:
                    await self._submit_first_launch()
            except Exception as e:
                decky.logger.warning(f"first-launch submit: {e}")
            out["phase"] = "loading"
            out["phase_label"] = "Opening Discord login…"
            return out

        on_login = "discord.com/login" in blob
        if on_login:
            out["phase"] = "login"
            out["phase_label"] = "Scan QR to log in"
            try:
                await self._ensure_cdp(inject=False, attempts=2, hide=False)
                qr = await self._grab_login_qr()
                if qr:
                    out["qr_png"] = qr
                    out["phase_label"] = "Scan QR to log in"
                else:
                    out["phase_label"] = "Waiting for login QR…"
            except Exception as e:
                decky.logger.warning(f"login QR: {e}")
                out["phase_label"] = "Waiting for login QR…"
                out["error"] = str(e)
            decky.logger.info(f"login phase qr={bool(out.get('qr_png'))}")
            return out

        try:
            snap = await self._bridge("snapshot()")
        except Exception as e:
            # Discord may still be on login even if the URL hasn't settled.
            try:
                await self._ensure_cdp(inject=False, attempts=2, hide=False)
                href = str(await self._eval("location.href") or "")
                qr = await self._grab_login_qr()
                if qr or "discord.com/login" in href:
                    out["phase"] = "login"
                    out["phase_label"] = "Scan QR to log in"
                    if qr:
                        out["qr_png"] = qr
                    return out
            except Exception:
                pass
            out["phase"] = "loading"
            out["phase_label"] = "Discord is loading…"
            out["error"] = str(e)
            return out

        if isinstance(snap, dict):
            out.update(snap)
            out["cdp"] = True
        if out.get("logged_in") and out.get("ok") is not False:
            out["ready"] = True
            out["phase"] = "ready"
            name = ""
            user = out.get("user") or {}
            if isinstance(user, dict):
                name = user.get("name") or user.get("username") or ""
            out["phase_label"] = f"Ready{(' · ' + name) if name else ''}"
            out["videoEnabled"] = bool(self._video_enabled)
            voice = out.get("voice") if isinstance(out.get("voice"), dict) else None
            vch = str((voice or {}).get("channelId") or "") or None
            if self._last_voice_channel and vch != self._last_voice_channel:
                try:
                    await self._eval("window.__deckscord && window.__deckscord.clearAudioFocus()")
                except Exception:
                    pass
                self._audio_focus = {"userId": None, "saved": {}}
            if not vch and self._audio_focus.get("userId"):
                try:
                    await self._eval("window.__deckscord && window.__deckscord.clearAudioFocus()")
                except Exception:
                    pass
                self._audio_focus = {"userId": None, "saved": {}}
            self._last_voice_channel = vch
            if vch and time.monotonic() - self._audio_hygiene_at > 15:
                self._audio_hygiene_at = time.monotonic()
                try:
                    hy = ensure_mic_not_loopback()
                    cap = {k: hy[k] for k in ("source", "loopback", "mic", "silent") if k in hy}
                    gs = find_gamescope_node()
                    if gs:
                        cap["gamescope"] = gs
                    cap["game_audio"] = list_game_audio_nodes()
                    cap["game_mode"] = in_game_mode()
                    out["capture"] = cap
                    if hy.get("loopback"):
                        out["phase_label"] = (out.get("phase_label") or "Ready") + " · mic is speakers"
                    elif hy.get("silent"):
                        out["phase_label"] = (out.get("phase_label") or "Ready") + " · no mic"
                    await self._eval("window.__deckscord && window.__deckscord.ensureVoiceProcessing()")
                except Exception as e:
                    decky.logger.warning(f"voice processing: {e}")
            pip = (self._settings.get("pip") or {})
            pip_on = bool(pip.get("enabled") and pip.get("userId"))
            out["pip"] = dict(pip)
            if pip_on and not vch:
                pip["enabled"] = False
                pip["userId"] = None
                self._settings["pip"] = pip
                _save_settings(self._settings)
                self._stop_overlay_if_idle()
                pip_on = False
                out["pip"] = dict(pip)
            talk = dict(self._settings.get("talking") or {})
            out["talking"] = dict(talk)
            out["talking"]["live"] = bool(talk.get("enabled") and vch)
            now_m = time.monotonic()
            snap_live = bool(
                out.get("streaming")
                or (
                    isinstance(out.get("stream"), dict)
                    and out["stream"].get("active")
                )
                or (isinstance(voice, dict) and voice.get("streaming"))
            )
            if snap_live:
                self._go_live_until = max(self._go_live_until, now_m + 8.0)
                self._go_live_pending = False
            if self._go_live_pending or now_m < self._go_live_until:
                out["streaming"] = True
                st = dict(out["stream"]) if isinstance(out.get("stream"), dict) else {}
                st["active"] = True
                st["pending"] = bool(self._go_live_pending and not snap_live)
                out["stream"] = st
                if isinstance(out.get("voice"), dict):
                    v = dict(out["voice"])
                    v["streaming"] = True
                    out["voice"] = v
            try:
                if pip_on or (self._video_enabled and time.monotonic() < self._grab_alive_until):
                    pass
                else:
                    if self._video_enabled and self._grab_alive_until and time.monotonic() >= self._grab_alive_until:
                        try:
                            await self._eval("window.__deckscord && window.__deckscord.ensureVideoSinks(false)")
                        except Exception:
                            pass
                        self._grab_alive_until = 0.0
                    await self._hide_window()
            except Exception:
                pass
        elif out.get("booting") or not on_login:
            # Logged-in session is still hydrating UserStore — keep waiting, don't
            # bounce back to the QR screen.
            out["ready"] = False
            out["phase"] = "loading"
            out["phase_label"] = "Signing into Discord…"
        else:
            out["ready"] = False
            out["phase"] = "login"
            out["phase_label"] = "Scan QR to log in"
            try:
                qr = await self._grab_login_qr()
                if qr:
                    out["qr_png"] = qr
            except Exception:
                pass
        return out

    def _ok(self, r: Any) -> dict[str, Any]:
        return r if isinstance(r, dict) else {"ok": False, "error": "bad response"}

    async def _clear_audio_focus_safe(self) -> None:
        try:
            await self._bridge("clearAudioFocus()")
        except Exception as e:
            decky.logger.warning(f"clearAudioFocus: {e}")
        self._audio_focus = {"userId": None, "saved": {}}

    async def join_voice(self, channel_id: str = "", channel_name: str = "", **kwargs: Any) -> dict[str, Any]:
        cid = str(channel_id or kwargs.get("channel_id") or kwargs.get("id") or "")
        decky.logger.info(f"join_voice {cid} {channel_name}")
        if not cid:
            return {"ok": False, "error": "missing channel_id"}
        await self._clear_audio_focus_safe()
        try:
            hy = ensure_mic_not_loopback()
            self._mic_pin_until = time.monotonic() + 20.0
            decky.logger.info(f"join capture source: {hy}")
        except Exception as e:
            decky.logger.warning(f"join capture source: {e}")
        r = await self._bridge(f"joinVoice({json.dumps(cid)})")
        try:
            await self._eval("window.__deckscord && window.__deckscord.ensureVoiceProcessing()")
        except Exception as e:
            decky.logger.warning(f"ensureVoiceProcessing: {e}")
        decky.logger.info(f"join_voice result {r}")
        return self._ok(r)

    async def leave_voice(self) -> dict[str, Any]:
        decky.logger.info("leave_voice")
        await self.unpin_pip()
        await self._clear_audio_focus_safe()
        try:
            await self._eval("window.__deckscord && window.__deckscord.stopGoLive()")
        except Exception:
            pass
        try:
            await self._eval("window.__deckscord && window.__deckscord.ensureVideoSinks(false)")
        except Exception:
            pass
        r = await self._bridge("leaveVoice()")
        try:
            ensure_mic_not_loopback()
        except Exception:
            pass
        decky.logger.info(f"leave_voice result {r}")
        return self._ok(r)

    async def start_go_live(self, width: int = 1280, height: int = 720, fps: int = 30, **kwargs: Any) -> dict[str, Any]:
        if isinstance(width, dict):
            kwargs.update(width)
            width = kwargs.get("width", 1280)
            height = kwargs.get("height", height)
            fps = kwargs.get("fps", fps)
        saved = self._settings.get("golive") if isinstance(self._settings.get("golive"), dict) else {}
        w = int(kwargs.get("width") or width or saved.get("width") or 1280)
        h = int(kwargs.get("height") or height or saved.get("height") or 720)
        f = int(kwargs.get("fps") or fps or saved.get("fps") or 30)
        games = []
        try:
            games = list_game_audio_nodes()
        except Exception as e:
            decky.logger.warning(f"game audio nodes: {e}")
        game_audio = []
        for g in games:
            for k in ("app", "name", "binary"):
                v = str(g.get(k) or "").strip()
                if v and v not in game_audio:
                    game_audio.append(v)
        decky.logger.info(f"start_go_live {w}x{h}@{f} game_audio={game_audio}")
        self._go_live_pending = True
        _nudge_portal()
        try:
            self._ensure_portal_shim()
        except Exception as e:
            decky.logger.warning(f"portal shim: {e}")
        try:
            ensure_mic_not_loopback()
        except Exception:
            pass
        await self._ensure_cdp(inject=True)
        await self._inject_bridge()
        r = await self._eval(
            "window.__deckscord.startGoLive("
            + json.dumps({"width": w, "height": h, "fps": f, "gameAudio": game_audio})
            + ")",
            timeout=28.0,
        )
        ok = isinstance(r, dict) and r.get("ok") is not False
        self._go_live_pending = False
        if ok:
            self._go_live_until = time.monotonic() + 20.0
        else:
            self._go_live_until = 0.0
        self._mic_pin_until = time.monotonic() + 25.0
        asyncio.create_task(self._pin_mic_burst())
        decky.logger.info(f"start_go_live result {r}")
        return self._ok(r)

    async def _pin_mic_burst(self) -> None:
        for _ in range(8):
            try:
                await asyncio.to_thread(ensure_mic_not_loopback)
            except Exception:
                pass
            try:
                await self._eval("window.__deckscord && window.__deckscord.ensureVoiceProcessing()")
            except Exception:
                pass
            await asyncio.sleep(0.35)

    async def stop_go_live(self) -> dict[str, Any]:
        decky.logger.info("stop_go_live")
        self._go_live_pending = False
        self._go_live_until = 0.0
        r = await self._bridge("stopGoLive()")
        try:
            await self._eval("window.__deckscord && window.__deckscord.ensureVoiceProcessing()")
        except Exception:
            pass
        try:
            ensure_mic_not_loopback()
        except Exception as e:
            decky.logger.warning(f"voice capture after stop: {e}")
        decky.logger.info(f"stop_go_live result {r}")
        return self._ok(r)

    async def toggle_mute(self) -> dict[str, Any]:
        r = await self._bridge("toggleMute()")
        decky.logger.info(f"toggle_mute result {r}")
        return self._ok(r)

    async def toggle_deafen(self) -> dict[str, Any]:
        r = await self._bridge("toggleDeafen()")
        decky.logger.info(f"toggle_deafen result {r}")
        return self._ok(r)

    async def set_input_device(self, device_id: str = "", **kwargs: Any) -> dict[str, Any]:
        did = str(device_id or kwargs.get("device_id") or kwargs.get("id") or "")
        decky.logger.info(f"set_input_device {did}")
        if not did:
            return {"ok": False, "error": "missing device_id"}
        if _is_monitor_source(did):
            return {"ok": False, "error": "that input is desktop/game capture, not a microphone"}
        r = await self._bridge(f"setInputDevice({json.dumps(did)})")
        return self._ok(r)

    async def set_output_device(self, device_id: str = "", **kwargs: Any) -> dict[str, Any]:
        did = str(device_id or kwargs.get("device_id") or kwargs.get("id") or "")
        decky.logger.info(f"set_output_device {did}")
        if not did:
            return {"ok": False, "error": "missing device_id"}
        r = await self._bridge(f"setOutputDevice({json.dumps(did)})")
        return self._ok(r)

    async def set_user_volume(self, user_id: str = "", volume: float = 100, **kwargs: Any) -> dict[str, Any]:
        uid = str(user_id or kwargs.get("user_id") or kwargs.get("id") or "")
        vol = kwargs.get("volume", volume)
        if not uid:
            return {"ok": False, "error": "missing user_id"}
        r = await self._bridge(f"setUserVolume({json.dumps(uid)}, {float(vol)})")
        return self._ok(r)

    async def toggle_user_mute(self, user_id: str = "", **kwargs: Any) -> dict[str, Any]:
        uid = str(user_id or kwargs.get("user_id") or kwargs.get("id") or "")
        if not uid:
            return {"ok": False, "error": "missing user_id"}
        r = await self._bridge(f"toggleUserMute({json.dumps(uid)})")
        return self._ok(r)

    async def set_server_mute(self, guild_id: str = "", user_id: str = "", mute: bool = True, **kwargs: Any) -> dict[str, Any]:
        gid = str(guild_id or kwargs.get("guild_id") or "")
        uid = str(user_id or kwargs.get("user_id") or kwargs.get("id") or "")
        flag = kwargs.get("mute", mute)
        if not gid or not uid:
            return {"ok": False, "error": "missing guild_id or user_id"}
        r = await self._bridge(f"setServerMute({json.dumps(gid)}, {json.dumps(uid)}, {json.dumps(bool(flag))})")
        return self._ok(r)

    async def set_server_deaf(self, guild_id: str = "", user_id: str = "", deaf: bool = True, **kwargs: Any) -> dict[str, Any]:
        gid = str(guild_id or kwargs.get("guild_id") or "")
        uid = str(user_id or kwargs.get("user_id") or kwargs.get("id") or "")
        flag = kwargs.get("deaf", deaf)
        if not gid or not uid:
            return {"ok": False, "error": "missing guild_id or user_id"}
        r = await self._bridge(f"setServerDeaf({json.dumps(gid)}, {json.dumps(uid)}, {json.dumps(bool(flag))})")
        return self._ok(r)

    async def set_input_volume(self, volume: float = 100, **kwargs: Any) -> dict[str, Any]:
        vol = kwargs.get("volume", volume)
        r = await self._bridge(f"setInputVolume({float(vol)})")
        return self._ok(r)

    async def set_output_volume(self, volume: float = 100, **kwargs: Any) -> dict[str, Any]:
        vol = kwargs.get("volume", volume)
        r = await self._bridge(f"setOutputVolume({float(vol)})")
        return self._ok(r)

    async def set_window_mode(self, mode: str = "minimized", **kwargs: Any) -> dict[str, Any]:
        mode = str(kwargs.get("mode") or mode or "minimized")
        if not self._can_hide_window:
            return {"ok": False, "error": "window api missing"}
        try:
            await self._ensure_cdp(inject=False, attempts=2, hide=False)
            info = await self.cdp.call("Browser.getWindowForTarget", {}, timeout=3)
            wid = (info or {}).get("windowId")
            if wid is None:
                return {"ok": False, "error": "no windowId"}
            if mode == "minimized":
                bounds: dict[str, Any] = {"windowState": "minimized"}
            elif mode == "offscreen":
                bounds = {"windowState": "normal", "left": -600, "top": 0, "width": 480, "height": 640}
            else:
                bounds = {"windowState": "normal", "width": 480, "height": 640}
            await self.cdp.call("Browser.setWindowBounds", {"windowId": wid, "bounds": bounds}, timeout=3)
            return {"ok": True, "mode": mode}
        except Exception as e:
            decky.logger.warning(f"set_window_mode: {e}")
            return {"ok": False, "error": str(e)}

    async def _arm_grab_window(self) -> None:
        if not self._video_enabled:
            return
        self._grab_alive_until = time.monotonic() + 3.0

    async def _maybe_show_for_camera(self, frames: list) -> None:
        """Only raise Vesktop if we still have no pixels and someone has a camera.
        Screenshare stills come from Discord preview URLs and do not need a window."""
        if not self._video_enabled:
            return
        need = False
        for f in frames or []:
            if not isinstance(f, dict):
                continue
            if f.get("kind") == "camera" and not f.get("jpeg"):
                need = True
                break
        if need:
            await self.set_window_mode("normal")

    async def _bridge_hot(self, call: str, timeout: float = 0.4) -> Any:
        if not self.cdp.connected:
            await self._bridge("ping()")
        if not self.cdp.connected:
            raise ConnectionError("not connected")
        return await self._eval(f"window.__deckscord.{call}", timeout=timeout)

    async def probe_video(self, restore: bool = False, **kwargs: Any) -> dict[str, Any]:
        restore = bool(kwargs.get("restore", restore))
        if restore:
            await self._arm_grab_window()
        r = await self._bridge("probeVideo()")
        out = self._ok(r)
        try:
            info = await self.cdp.call("Browser.getWindowForTarget", {}, timeout=3)
            out["windowState"] = ((info or {}).get("bounds") or {}).get("windowState")
        except Exception:
            out["windowState"] = None
        decky.logger.info(
            f"probe_video winner={out.get('winner')} engine={out.get('engineType')} "
            f"sink={out.get('sinkApi')} streams={out.get('streamIds')} videos={len(out.get('dom') or [])}"
        )
        return out

    async def get_video_frames(self, user_id: str = "", w: int = 0, h: int = 0, **kwargs: Any) -> dict[str, Any]:
        uid = str(user_id or kwargs.get("user_id") or kwargs.get("userId") or "")
        ww = int(kwargs.get("w") or w or 0)
        hh = int(kwargs.get("h") or h or 0)
        if not self._video_enabled:
            return {"ok": True, "frames": [], "videoEnabled": False}
        if self._status_lock.locked() or self._grab_lock.locked():
            return {"ok": True, "frames": self._last_frames, "cached": True, "videoEnabled": True}
        async with self._grab_lock:
            t0 = time.monotonic()
            opts: dict[str, Any] = {}
            if uid:
                opts["userId"] = uid
            if ww and hh:
                opts["w"] = ww
                opts["h"] = hh
            call = f"grabVideoFrames({json.dumps(opts)})" if opts else "grabVideoFrames()"
            try:
                r = await self._bridge_hot(call, timeout=1.6)
            except Exception as e:
                decky.logger.warning(f"grab: {e}")
                return {"ok": True, "frames": self._last_frames, "cached": True, "error": "grab_timeout", "videoEnabled": True}
            ms = int((time.monotonic() - t0) * 1000)
            if isinstance(r, dict) and r.get("ok") and r.get("frames"):
                frames = r["frames"]
                clips = r.get("clips") or []
                if clips and any(not (f or {}).get("jpeg") for f in frames):
                    await self._fill_frames_from_clips(frames, clips)
                if any((f or {}).get("kind") == "camera" and not (f or {}).get("jpeg") for f in frames):
                    await self._maybe_show_for_camera(frames)
                    try:
                        r2 = await self._bridge_hot(call, timeout=1.6)
                        if isinstance(r2, dict) and r2.get("frames"):
                            frames = r2["frames"]
                            await self._fill_frames_from_clips(frames, r2.get("clips") or [])
                    except Exception:
                        pass
                self._last_frames = frames
                r["frames"] = frames
            if time.monotonic() - self._grab_log_at > 5:
                n = len((r or {}).get("frames") or [])
                raw = 0
                for f in (r or {}).get("frames") or []:
                    raw += len(str((f or {}).get("jpeg") or ""))
                decky.logger.info(f"video_grab n={n} ms={ms} jpeg_chars={raw}")
                self._grab_log_at = time.monotonic()
            if isinstance(r, dict):
                r["videoEnabled"] = True
                r["ms"] = ms
                return r
            return {"ok": False, "error": "bad response", "frames": self._last_frames}

    async def _fill_frames_from_clips(self, frames: list, clips: list) -> None:
        if not clips:
            try:
                rects = await self._bridge_hot("videoClipRects()", timeout=0.4)
                if isinstance(rects, dict):
                    clips = rects.get("clips") or []
            except Exception:
                clips = []
        for i, f in enumerate(frames):
            if not isinstance(f, dict) or f.get("jpeg"):
                continue
            clip = clips[i] if i < len(clips) else (clips[0] if clips else None)
            if not clip:
                continue
            try:
                shot = await self.cdp.call(
                    "Page.captureScreenshot",
                    {
                        "format": "jpeg",
                        "quality": 45,
                        "clip": {
                            "x": float(clip["x"]),
                            "y": float(clip["y"]),
                            "width": float(clip["width"]),
                            "height": float(clip["height"]),
                            "scale": 1,
                        },
                    },
                    timeout=1.2,
                )
                data = (shot or {}).get("data")
                if data:
                    f["jpeg"] = "data:image/jpeg;base64," + data
                    f["black"] = False
            except Exception as e:
                decky.logger.warning(f"clip grab: {e}")

    async def get_speaking(self) -> dict[str, Any]:
        try:
            r = await self._bridge_hot("speakingNow()", timeout=0.4)
        except Exception:
            try:
                r = await self._bridge("speakingNow()")
            except Exception as e:
                return {"ok": False, "ids": [], "error": str(e)}
        return r if isinstance(r, dict) else {"ok": False, "ids": []}

    async def focus_stream(self, user_id: str = "", **kwargs: Any) -> dict[str, Any]:
        uid = str(user_id or kwargs.get("user_id") or kwargs.get("id") or "")
        r = await self._bridge(f"focusStream({json.dumps(uid)})")
        if isinstance(r, dict) and r.get("focus"):
            self._audio_focus = r["focus"]
        elif isinstance(r, dict) and r.get("ok") and uid:
            self._audio_focus = {"userId": uid, "saved": (self._audio_focus or {}).get("saved") or {}, "kind": "stream"}
        decky.logger.info(f"focus_stream {uid} {r if isinstance(r, dict) else ''}")
        return self._ok(r)

    async def focus_audio(self, user_id: str = "", **kwargs: Any) -> dict[str, Any]:
        uid = str(user_id or kwargs.get("user_id") or kwargs.get("id") or "")
        if not uid:
            return {"ok": False, "error": "missing user_id"}
        r = await self._bridge(f"focusAudio({json.dumps(uid)})")
        if isinstance(r, dict) and r.get("focus"):
            self._audio_focus = r["focus"]
        elif isinstance(r, dict) and r.get("ok"):
            self._audio_focus = {"userId": uid, "saved": (self._audio_focus or {}).get("saved") or {}}
        decky.logger.info(f"focus_audio {uid} {r if isinstance(r, dict) else ''}")
        return self._ok(r)

    async def clear_audio_focus(self) -> dict[str, Any]:
        await self._clear_audio_focus_safe()
        return {"ok": True}

    async def select_text(self, channel_id: str = "", **kwargs: Any) -> dict[str, Any]:
        cid = str(channel_id or kwargs.get("channel_id") or kwargs.get("id") or "")
        if not cid:
            return {"ok": False, "error": "missing channel_id"}
        r = await self._bridge(f"selectText({json.dumps(cid)})")
        return self._ok(r)

    async def get_messages(self, channel_id: str = "", limit: int = 40, **kwargs: Any) -> dict[str, Any]:
        cid = str(channel_id or kwargs.get("channel_id") or kwargs.get("id") or "")
        lim = int(kwargs.get("limit") or limit or 40)
        if not cid:
            return {"ok": False, "error": "missing channel_id"}
        r = await self._bridge(f"getMessages({json.dumps(cid)}, {lim})")
        return self._ok(r)

    async def send_message(self, channel_id: str = "", content: str = "", **kwargs: Any) -> dict[str, Any]:
        cid = str(channel_id or kwargs.get("channel_id") or kwargs.get("id") or "")
        body = str(content if content != "" else kwargs.get("content") or "")
        decky.logger.info(f"send_message {cid} len={len(body)}")
        if not cid:
            return {"ok": False, "error": "missing channel_id"}
        r = await self._bridge(f"sendMessage({json.dumps(cid)}, {json.dumps(body)})")
        return self._ok(r)

    async def start_vesktop(self) -> dict[str, Any]:
        return await self._ensure_vesktop(wait=True)

    def _set_update(self, phase: str, percent: int, message: str, **extra: Any) -> None:
        blob: dict[str, Any] = {
            "phase": phase,
            "percent": int(percent),
            "message": message,
            "ok": extra.get("ok", True),
            "error": extra.get("error") or "",
            "head": extra.get("head") or self._update.get("head") or "",
            "ts": time.time(),
        }
        self._update = blob
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            (DATA_DIR / "update.status").write_text(json.dumps(blob), encoding="utf-8")
        except OSError:
            pass

    def _restart_plugin_loader(self) -> None:
        """Detach so restarting plugin_loader does not kill this process first."""
        env = _system_env()
        log = DATA_DIR / "update.log"
        cmd = (
            "sleep 1; "
            "systemctl restart plugin_loader.service >/dev/null 2>&1 || "
            "systemctl restart plugin_loader >/dev/null 2>&1 || "
            "sudo -n systemctl restart plugin_loader.service >/dev/null 2>&1 || "
            "sudo -n systemctl restart plugin_loader >/dev/null 2>&1 || "
            "true"
        )
        log_f = open(log, "ab")
        log_f.write(b"restarting plugin_loader\n")
        log_f.flush()
        subprocess.Popen(
            ["/bin/bash", "-c", cmd],
            stdout=log_f,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            env=env,
            start_new_session=True,
            close_fds=True,
        )

    def _git(self, args: list[str], cwd: Optional[Path] = None, timeout: int = 90) -> subprocess.CompletedProcess:
        home = _login_home()
        uid, _gid = _login_uid_gid()
        env = _subprocess_env()
        env["GIT_CONFIG_GLOBAL"] = "/dev/null"
        env["GIT_CONFIG_NOSYSTEM"] = "1"
        cmd = ["git", "-c", "safe.directory=*"]
        if cwd is not None:
            cmd.extend(["-C", str(cwd)])
        cmd.extend(args)
        if os.geteuid() == 0 and uid != 0:
            runuser = "/usr/sbin/runuser" if Path("/usr/sbin/runuser").is_file() else "/usr/bin/runuser"
            if Path(runuser).is_file():
                wrapped = [runuser, "-u", home.name, "--", "env", f"HOME={home}", f"USER={home.name}"] + cmd
                r = _run(wrapped, timeout=timeout)
                if r.returncode == 0:
                    return r
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False, env=env)

    def _ensure_plugin_writable(self, dst: Path) -> None:
        uid, gid = _login_uid_gid()
        dst.mkdir(parents=True, exist_ok=True)
        if os.geteuid() == 0:
            _chown_tree(dst, uid, gid)
            _force_writable(dst, uid, gid)
            return
        if os.access(str(dst), os.W_OK):
            return
        _run(["sudo", "-n", "chown", "-R", f"{uid}:{gid}", str(dst)], timeout=15)
        _run(["sudo", "-n", "chmod", "-R", "u+rwX", str(dst)], timeout=15)
        if os.access(str(dst), os.W_OK):
            return
        # Leave it; _copy_plugin_tree / sudo rsync will try next.

    async def get_update_status(self) -> dict[str, Any]:
        return {"ok": True, **self._update}

    async def update_from_github(self) -> dict[str, Any]:
        """Start git pull + copy in the background; poll get_update_status."""
        task = self._update_task
        if task is not None and not task.done():
            return {"ok": True, "started": True, "already": True, **self._update}
        self._set_update("starting", 4, "Starting update…")
        self._update_task = asyncio.create_task(self._run_update())
        return {"ok": True, "started": True, **self._update}

    async def _run_update(self) -> None:
        import shutil

        home = _login_home()
        uid, gid = _login_uid_gid()
        src = Path(os.environ.get("DECKSCORD_SRC") or (DATA_DIR / "src"))
        dst = _plugin_dst()
        if dst == src or src in dst.parents or dst in src.parents:
            src = DATA_DIR / "src"
        log = DATA_DIR / "update.log"
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        lines: list[str] = [f"--- {time.strftime('%Y-%m-%d %H:%M:%S')} euid={os.geteuid()} ---"]

        def note(msg: str) -> None:
            lines.append(msg)
            decky.logger.info(f"update: {msg}")

        try:
            self._set_update("fetch", 12, "Fetching from GitHub…")
            src.parent.mkdir(parents=True, exist_ok=True)
            if os.geteuid() == 0:
                _chown_tree(DATA_DIR, uid, gid)
                _force_writable(DATA_DIR, uid, gid)
                if src.exists():
                    _chown_tree(src, uid, gid)
            if (src / ".git").is_dir():
                r = await asyncio.to_thread(self._git, ["fetch", "--prune", "origin"], src, 90)
                if r.returncode != 0:
                    err = (r.stderr or r.stdout or "git fetch failed").strip()
                    note(err)
                    self._set_update("error", 12, err, ok=False, error=err)
                    return
                self._set_update("merge", 40, "Applying commits…")
                r = await asyncio.to_thread(self._git, ["merge", "--ff-only", "origin/main"], src, 30)
                if r.returncode != 0:
                    r = await asyncio.to_thread(self._git, ["pull", "--ff-only"], src, 30)
                if r.returncode != 0:
                    err = (r.stderr or r.stdout or "git pull failed").strip()
                    note(err)
                    self._set_update("error", 40, err, ok=False, error=err)
                    return
                note(f"pulled {src}")
            else:
                if src.exists():
                    shutil.rmtree(src, ignore_errors=True)
                self._set_update("clone", 20, "Cloning repository…")
                r = await asyncio.to_thread(self._git, ["clone", "--depth", "1", REPO_URL, str(src)], None, 120)
                if r.returncode != 0:
                    err = (r.stderr or r.stdout or "git clone failed").strip()
                    note(err)
                    self._set_update("error", 20, err, ok=False, error=err)
                    return
                note(f"cloned {REPO_URL}")
            _chown_tree(src, uid, gid)
            head = await asyncio.to_thread(self._git, ["log", "-1", "--oneline"], src, 5)
            head_s = (head.stdout or "").strip() or "ok"
            note(head_s)
            self._set_update("copy", 70, "Copying plugin files…", head=head_s)
            plugin_src = src / "plugin"
            if not (plugin_src / "main.py").is_file():
                self._set_update("error", 70, "no plugin in repo", ok=False, error="no plugin")
                return
            own = "?"
            try:
                st = dst.stat()
                own = f"uid={st.st_uid} mode={oct(st.st_mode)}"
            except OSError:
                pass
            note(f"copy {plugin_src} -> {dst} euid={os.geteuid()} owner={own}")
            self._ensure_plugin_writable(dst)
            errors = await asyncio.to_thread(_copy_plugin_tree, plugin_src, dst, uid, gid)
            core = ("main.py", "bridge.js", Path("dist") / "index.js")
            missing_core = [str(c) for c in core if not (dst / c).is_file()]
            if missing_core:
                note("core missing after copy: " + ", ".join(missing_core))
                rsync = await asyncio.to_thread(
                    _run,
                    [
                        "sudo",
                        "-n",
                        "rsync",
                        "-rltD",
                        "--chmod=Du+rwx,Fu+rw",
                        "--exclude=__pycache__",
                        "--exclude=*.pyc",
                        "--exclude=node_modules",
                        "--exclude=.git",
                        str(plugin_src) + "/",
                        str(dst) + "/",
                    ],
                    30,
                )
                if rsync.returncode != 0:
                    err = (rsync.stderr or rsync.stdout or "copy failed").strip()
                    user = home.name
                    msg = (
                        f"Cannot write {dst} ({own}, euid={os.geteuid()}). "
                        f"One-time: sudo chown -R {user}:{user} {dst} && sudo chmod -R u+rwX {dst}"
                    )
                    note(err)
                    self._set_update("error", 70, msg, ok=False, error=msg, head=head_s)
                    return
                note("copied with sudo rsync")
                errors = []
            elif errors:
                note("skipped " + str(len(errors)) + " root-owned file(s): " + "; ".join(errors[:6]))
            _run(["sudo", "-n", "chown", "-R", f"{uid}:{gid}", str(dst)], timeout=15)
            for helper in ("launch-vesktop.sh", "update.sh", "uninstall.sh"):
                hf = src / helper
                if hf.is_file():
                    dest_h = DATA_DIR / helper
                    shutil.copy2(hf, dest_h)
                    dest_h.chmod(0o755)
            _chown_tree(dst, uid, gid)
            _chown_tree(src, uid, gid)
            _chown_tree(DATA_DIR, uid, gid)
            try:
                log.write_text("\n".join(lines) + "\n", encoding="utf-8")
            except OSError:
                pass
            self._bridge_hash = ""
            self._set_update("restart", 90, "Restarting Decky…", head=head_s)
            self._restart_plugin_loader()
        except PermissionError as e:
            decky.logger.error(f"update_from_github: {e}")
            self._set_update("error", int(self._update.get("percent") or 70), str(e), ok=False, error=str(e))
        except Exception as e:
            decky.logger.error(f"update_from_github: {e}")
            self._set_update("error", int(self._update.get("percent") or 0), str(e), ok=False, error=str(e))

    def _write_pip_state(self) -> None:
        PIP_DIR.mkdir(parents=True, exist_ok=True)
        pip = dict(self._settings.get("pip") or {})
        _write_json(PIP_DIR / "state.json", pip)

    def _stop_pip_overlay(self) -> None:
        proc = self._pip_proc
        self._pip_proc = None
        if not proc or proc.poll() is not None:
            return
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    def _overlay_needed(self) -> bool:
        pip = self._settings.get("pip") or {}
        talk = self._settings.get("talking") or {}
        pip_on = bool(pip.get("enabled") and pip.get("userId"))
        talk_on = bool(talk.get("enabled") and (self._talk_in_voice or self._last_voice_channel))
        return pip_on or talk_on

    def _start_pip_overlay(self) -> None:
        self._write_pip_state()
        if not self._overlay_needed():
            return
        if not in_game_mode():
            return
        proc = self._pip_proc
        if proc is not None and proc.poll() is None:
            return
        script = PLUGIN_DIR / "pip_overlay.py"
        if not script.is_file():
            decky.logger.warning("pip_overlay.py missing")
            return
        log = DATA_DIR / "pip-overlay.log"
        log_f = open(log, "ab")
        log_f.write(f"\n--- {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n".encode())
        log_f.flush()
        env = _overlay_env()
        self._pip_proc = subprocess.Popen(
            ["/usr/bin/python3", str(script), str(PIP_DIR)],
            stdout=log_f,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            env=env,
            start_new_session=True,
            close_fds=True,
        )
        decky.logger.info(f"overlay pid={self._pip_proc.pid} display={env.get('DISPLAY')}")

    def _stop_overlay_if_idle(self) -> None:
        if not self._overlay_needed():
            self._stop_pip_overlay()

    async def _pip_grab_once(self) -> None:
        pip = dict(self._settings.get("pip") or {})
        uid = str(pip.get("userId") or "")
        if not uid:
            return
        w, h = _pip_dims(str(pip.get("size") or "small"))
        self._grab_alive_until = time.monotonic() + 4.0
        r = await self.get_video_frames(user_id=uid, w=w, h=h)
        frames = (r or {}).get("frames") or []
        hit = None
        kind = str(pip.get("kind") or "")
        for f in frames:
            if not isinstance(f, dict):
                continue
            if str(f.get("userId") or "") != uid:
                continue
            if kind and str(f.get("kind") or "") == kind:
                hit = f
                break
            if hit is None:
                hit = f
        jpeg = (hit or {}).get("jpeg") or ""
        if not jpeg or (hit or {}).get("black"):
            return
        raw = jpeg.split(",", 1)[-1]
        try:
            data = base64.b64decode(raw)
        except Exception:
            return
        PIP_DIR.mkdir(parents=True, exist_ok=True)
        tmp = PIP_DIR / "frame.jpg.tmp"
        tmp.write_bytes(data)
        tmp.replace(PIP_DIR / "frame.jpg")

    def _cache_avatar(self, uid: str, url: str) -> str:
        if not uid:
            return ""
        dest_dir = PIP_DIR / "avatars"
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{uid}.png"
        if dest.is_file() and dest.stat().st_size > 32:
            return str(dest)
        if not url or not str(url).startswith("http"):
            return ""
        src = str(url).replace(".webp", ".png").replace(".gif", ".png")
        try:
            req = urllib.request.Request(src, headers={"User-Agent": "Deckscord/1.0"})
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = resp.read()
            if data:
                tmp = dest.with_suffix(".tmp")
                tmp.write_bytes(data)
                tmp.replace(dest)
                return str(dest)
        except Exception:
            return ""
        return ""

    def _cache_avatars_batch(self, items: list[tuple[str, str]]) -> None:
        for uid, url in items:
            self._cache_avatar(uid, url)

    def _write_talking_state(self, speakers: list[dict[str, Any]], live: bool) -> None:
        talk = dict(self._settings.get("talking") or {})
        blob = {
            "enabled": bool(live and talk.get("enabled")),
            "corner": talk.get("corner") or "top-left",
            "size": talk.get("size") or "small",
            "opacity": talk.get("opacity", 90),
            "speakers": speakers,
        }
        _write_json(PIP_DIR / "talking.json", blob)

    async def _talking_tick(self) -> None:
        talk = dict(self._settings.get("talking") or {})
        if not talk.get("enabled"):
            self._write_talking_state([], False)
            return
        try:
            r = await self.get_speaking()
        except Exception:
            r = {}
        in_voice = bool((r or {}).get("inVoice") or self._last_voice_channel)
        self._talk_in_voice = in_voice
        if not in_voice:
            self._talk_hold.clear()
            self._talk_last.clear()
            self._write_talking_state([], False)
            return
        now = time.monotonic()
        show_self = talk.get("showSelf", True) is not False
        incoming = (r or {}).get("speakers") or []
        if not incoming and (r or {}).get("ids"):
            incoming = [{"id": str(i)} for i in (r.get("ids") or [])]
        need: list[tuple[str, str]] = []
        fresh: list[dict[str, Any]] = []
        for sp in incoming:
            if not isinstance(sp, dict):
                continue
            uid = str(sp.get("id") or "")
            if not uid:
                continue
            if sp.get("self") and not show_self:
                continue
            dest = PIP_DIR / "avatars" / f"{uid}.png"
            path = str(dest) if dest.is_file() and dest.stat().st_size > 32 else ""
            url = str(sp.get("avatar") or "")
            if not path and url:
                need.append((uid, url))
            rec = {
                "id": uid,
                "name": str(sp.get("name") or uid),
                "self": bool(sp.get("self")),
                "file": path,
            }
            fresh.append(rec)
            self._talk_last[uid] = rec
            self._talk_hold[uid] = now + 0.6
        if need:
            await asyncio.to_thread(self._cache_avatars_batch, need)
            for rec in fresh:
                dest = PIP_DIR / "avatars" / f"{rec['id']}.png"
                if dest.is_file() and dest.stat().st_size > 32:
                    rec["file"] = str(dest)
                    self._talk_last[rec["id"]] = rec
        live = []
        for uid, until in list(self._talk_hold.items()):
            if until < now:
                self._talk_hold.pop(uid, None)
                self._talk_last.pop(uid, None)
                continue
            rec = self._talk_last.get(uid)
            if rec:
                live.append(rec)
        live = live[:5]
        self._write_talking_state(live, True)

    async def _pip_loop(self) -> None:
        talk_at = 0.0
        pin_at = 0.0
        while True:
            try:
                pip = self._settings.get("pip") or {}
                talk = self._settings.get("talking") or {}
                pip_on = bool(pip.get("enabled") and pip.get("userId"))
                talk_pref = bool(talk.get("enabled"))
                now = time.monotonic()
                pin_iv = 1.0 if now < self._mic_pin_until else 12.0
                if (self._last_voice_channel or now < self._mic_pin_until) and now - pin_at >= pin_iv:
                    pin_at = now
                    try:
                        await asyncio.to_thread(ensure_mic_not_loopback)
                    except Exception:
                        pass
                    try:
                        await self._eval("window.__deckscord && window.__deckscord.ensureVoiceProcessing()")
                    except Exception:
                        pass
                talk_iv = 0.25 if self._talk_in_voice else 1.0
                if talk_pref and now - talk_at >= talk_iv:
                    await self._talking_tick()
                    talk_at = now
                elif not talk_pref:
                    self._write_talking_state([], False)
                talk_on = bool(talk_pref and self._talk_in_voice)
                if pip_on:
                    await self._pip_grab_once()
                if pip_on or talk_on:
                    self._start_pip_overlay()
                    await asyncio.sleep(1.0 / 30.0 if pip_on else 0.25)
                else:
                    self._stop_overlay_if_idle()
                    await asyncio.sleep(0.4)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                decky.logger.warning(f"overlay loop: {e}")
                await asyncio.sleep(1.0)

    def _pip_summary(self) -> dict[str, Any]:
        return dict(self._settings.get("pip") or {})

    async def get_settings(self) -> dict[str, Any]:
        self._settings = _load_settings()
        vdir = _vesktop_config_dir()
        vesktop = _read_json(vdir / "settings.json")
        state = _read_json(vdir / "state.json")
        audio = dict(VESKTOP_AUDIO_DEFAULTS)
        if isinstance(vesktop.get("audio"), dict):
            audio.update(vesktop["audio"])
        vesktop = dict(vesktop)
        vesktop["audio"] = audio
        discord: dict[str, Any] = {}
        try:
            r = await self._bridge("getDiscordSettings()")
            if isinstance(r, dict):
                discord = r
        except Exception as e:
            discord = {"ok": False, "error": str(e)}
        return {
            "ok": True,
            "pip": self._pip_summary(),
            "talking": dict(self._settings.get("talking") or DEFAULT_SETTINGS["talking"]),
            "golive": dict(self._settings.get("golive") or DEFAULT_SETTINGS["golive"]),
            "vesktop": vesktop,
            "vesktopState": state,
            "discord": discord,
            "vesktopPath": str(vdir),
        }

    async def set_pip_settings(self, corner: str = "", size: str = "", opacity: Any = None, **kwargs: Any) -> dict[str, Any]:
        pip = dict(self._settings.get("pip") or {})
        corner = str(kwargs.get("corner") or corner or pip.get("corner") or "bottom-right")
        if corner not in ("top-left", "top-right", "bottom-left", "bottom-right"):
            corner = "bottom-right"
        size = str(kwargs.get("size") or size or pip.get("size") or "small")
        if size not in ("small", "large"):
            size = "small"
        op = kwargs.get("opacity") if kwargs.get("opacity") is not None else opacity
        if op is None:
            op = pip.get("opacity", 100)
        try:
            op_n = int(float(op))
        except (TypeError, ValueError):
            op_n = 100
        op_n = max(20, min(100, op_n))
        pip["corner"] = corner
        pip["size"] = size
        pip["opacity"] = op_n
        self._settings["pip"] = pip
        _save_settings(self._settings)
        self._write_pip_state()
        if pip.get("enabled") and pip.get("userId"):
            self._start_pip_overlay()
        return {"ok": True, "pip": pip}

    async def pin_pip(self, user_id: str = "", kind: str = "screenshare", name: str = "", **kwargs: Any) -> dict[str, Any]:
        if isinstance(user_id, dict):
            kwargs.update(user_id)
            user_id = str(kwargs.get("user_id") or kwargs.get("userId") or "")
        uid = str(user_id or kwargs.get("user_id") or kwargs.get("userId") or "")
        if not uid:
            return {"ok": False, "error": "missing user_id"}
        kind = str(kind or kwargs.get("kind") or "screenshare")
        name = str(name or kwargs.get("name") or "")
        try:
            await self.focus_stream(uid)
        except Exception as e:
            decky.logger.warning(f"pin focus: {e}")
        pip = dict(self._settings.get("pip") or {})
        pip["enabled"] = True
        pip["userId"] = uid
        pip["kind"] = kind
        pip["name"] = name
        self._settings["pip"] = pip
        _save_settings(self._settings)
        self._write_pip_state()
        self._grab_alive_until = time.monotonic() + 8.0
        try:
            await self._pip_grab_once()
        except Exception as e:
            decky.logger.warning(f"pin grab: {e}")
        self._start_pip_overlay()
        return {"ok": True, "pip": pip}

    async def unpin_pip(self) -> dict[str, Any]:
        pip = dict(self._settings.get("pip") or {})
        pip["enabled"] = False
        pip["userId"] = None
        pip["name"] = ""
        self._settings["pip"] = pip
        _save_settings(self._settings)
        self._write_pip_state()
        self._stop_overlay_if_idle()
        try:
            await self._clear_audio_focus_safe()
        except Exception:
            pass
        return {"ok": True, "pip": pip}

    async def set_golive_quality(self, height: int = 720, fps: int = 30, **kwargs: Any) -> dict[str, Any]:
        h = int(kwargs.get("height") or height or 720)
        f = int(kwargs.get("fps") or fps or 30)
        if h not in (720, 1080):
            h = 720
        if f not in (15, 30):
            f = 30
        w = 1280 if h == 720 else 1920
        self._settings["golive"] = {"width": w, "height": h, "fps": f}
        _save_settings(self._settings)
        vdir = _vesktop_config_dir()
        state = _read_json(vdir / "state.json")
        state["screenshareQuality"] = {"resolution": str(h), "frameRate": str(f)}
        _write_json(vdir / "state.json", state)
        try:
            await self._bridge(f"setScreenshareQuality({json.dumps(str(h))}, {json.dumps(str(f))})")
        except Exception as e:
            decky.logger.warning(f"screenshareQuality: {e}")
        return {"ok": True, "golive": self._settings["golive"], "needsRestart": False}

    async def set_vesktop_setting(self, key: str = "", value: Any = None, **kwargs: Any) -> dict[str, Any]:
        if isinstance(key, dict):
            kwargs.update(key)
            key = str(kwargs.get("key") or "")
            if "value" in kwargs:
                value = kwargs.get("value")
        key = str(key or kwargs.get("key") or "")
        if "value" in kwargs:
            value = kwargs.get("value")
        if not key:
            return {"ok": False, "error": "missing key"}
        vdir = _vesktop_config_dir()
        path = vdir / "settings.json"
        doc = _read_json(path)
        if key.startswith("audio."):
            audio = dict(VESKTOP_AUDIO_DEFAULTS)
            if isinstance(doc.get("audio"), dict):
                audio.update(doc["audio"])
            audio[key.split(".", 1)[1]] = value
            doc["audio"] = audio
        else:
            doc[key] = value
        _write_json(path, doc)
        restart = key in (
            "hardwareAcceleration",
            "hardwareVideoAcceleration",
            "discordBranch",
            "nativeTitleBar",
            "enableShadow",
            "enableRoundedCorners",
            "disableSmoothScroll",
            "webRTCIPHandlingPolicy",
        )
        return {"ok": True, "key": key, "value": value, "needsRestart": restart, "vesktop": doc}

    async def set_discord_setting(self, key: str = "", value: Any = None, **kwargs: Any) -> dict[str, Any]:
        if isinstance(key, dict):
            kwargs.update(key)
            key = str(kwargs.get("key") or "")
            if "value" in kwargs:
                value = kwargs.get("value")
        key = str(key or kwargs.get("key") or "")
        if "value" in kwargs:
            value = kwargs.get("value")
        if not key:
            return {"ok": False, "error": "missing key"}
        r = await self._bridge(f"setDiscordSetting({json.dumps(key)}, {json.dumps(bool(value))})")
        return self._ok(r)

    async def set_talking_settings(
        self,
        enabled: Any = None,
        corner: str = "",
        size: str = "",
        opacity: Any = None,
        show_self: Any = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        if isinstance(enabled, dict):
            kwargs.update(enabled)
            enabled = kwargs.get("enabled")
        talk = dict(self._settings.get("talking") or DEFAULT_SETTINGS["talking"])
        if enabled is None:
            enabled = kwargs.get("enabled")
        if enabled is not None:
            talk["enabled"] = bool(enabled)
        corner = str(kwargs.get("corner") or corner or talk.get("corner") or "top-left")
        if corner not in ("top-left", "top-right", "bottom-left", "bottom-right"):
            corner = "top-left"
        talk["corner"] = corner
        size = str(kwargs.get("size") or size or talk.get("size") or "small")
        if size not in ("small", "large"):
            size = "small"
        talk["size"] = size
        op = kwargs.get("opacity") if kwargs.get("opacity") is not None else opacity
        if op is None:
            op = talk.get("opacity", 90)
        try:
            op_n = int(float(op))
        except (TypeError, ValueError):
            op_n = 90
        talk["opacity"] = max(20, min(100, op_n))
        ss = kwargs.get("showSelf") if kwargs.get("showSelf") is not None else (kwargs.get("show_self") if kwargs.get("show_self") is not None else show_self)
        if ss is not None:
            talk["showSelf"] = bool(ss)
        self._settings["talking"] = talk
        _save_settings(self._settings)
        live = bool(talk.get("enabled") and (self._talk_in_voice or self._last_voice_channel))
        speakers = list(self._talk_last.values())[:5] if live else []
        self._write_talking_state(speakers, live)
        if live or (self._settings.get("pip") or {}).get("enabled"):
            self._start_pip_overlay()
        else:
            self._stop_overlay_if_idle()
        return {"ok": True, "talking": talk}

