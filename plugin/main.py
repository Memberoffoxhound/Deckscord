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
PLUGIN_DIR = Path(getattr(decky, "DECKY_PLUGIN_DIR", Path(__file__).parent))
BRIDGE_PATH = PLUGIN_DIR / "bridge.js"
DATA_DIR = Path.home() / ".local" / "share" / "deckscord"
DATA_DIR.mkdir(parents=True, exist_ok=True)

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


def _subprocess_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in _PYI_KEYS}
    uid = os.getuid()
    runtime = f"/run/user/{uid}"
    env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:" + (env.get("PATH") or "")
    try:
        home = str(Path.home())
    except Exception:
        home = f"/home/{os.environ.get('USER', 'bazzite')}"
    env.setdefault("HOME", home)
    env.setdefault("USER", Path(home).name)
    env.setdefault("XDG_RUNTIME_DIR", runtime)
    env.setdefault("DBUS_SESSION_BUS_ADDRESS", f"unix:path={runtime}/bus")
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
    "deckscord_silence",
    "deckscord.silence",
)


def _is_monitor_source(name: str) -> bool:
    n = (name or "").lower()
    if n == SILENCE_MIC or n.startswith("deckscord.mic"):
        return False
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
    if mic and (not cur or _is_monitor_source(cur)):
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

    async def _main(self) -> None:
        decky.logger.info("Deckscord backend starting")
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

    async def _unload(self) -> None:
        try:
            await self._eval("window.__deckscord && window.__deckscord.ensureVideoSinks(false)")
        except Exception:
            pass
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
            try:
                if self._video_enabled and time.monotonic() < self._grab_alive_until:
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
        w = int(kwargs.get("width") or width or 1280)
        h = int(kwargs.get("height") or height or 720)
        f = int(kwargs.get("fps") or fps or 30)
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
        try:
            await self._eval("window.__deckscord && window.__deckscord.ensureVoiceProcessing()")
        except Exception:
            pass
        try:
            ensure_mic_not_loopback()
        except Exception:
            pass
        decky.logger.info(f"start_go_live result {r}")
        return self._ok(r)

    async def stop_go_live(self) -> dict[str, Any]:
        decky.logger.info("stop_go_live")
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

    async def get_video_frames(self) -> dict[str, Any]:
        if not self._video_enabled:
            return {"ok": True, "frames": [], "videoEnabled": False}
        if self._status_lock.locked() or self._grab_lock.locked():
            return {"ok": True, "frames": self._last_frames, "cached": True, "videoEnabled": True}
        async with self._grab_lock:
            t0 = time.monotonic()
            try:
                r = await self._bridge_hot("grabVideoFrames()", timeout=1.6)
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
                        r2 = await self._bridge_hot("grabVideoFrames()", timeout=1.6)
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

    async def update_from_github(self) -> dict[str, Any]:
        """Re-run the GitHub installer in a detached session so plugin_loader
        restart does not kill the update. Until the Decky store hosts us."""
        log = DATA_DIR / "update.log"
        script = DATA_DIR / "update.sh"
        url = "https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/update.sh"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Deckscord-updater"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                script.write_bytes(resp.read())
            script.chmod(0o755)
        except Exception as e:
            decky.logger.warning(f"update fetch: {e}")
            if not script.is_file():
                return {"ok": False, "error": f"could not download updater: {e}"}
        env = _subprocess_env()
        env["DECKSCORD_NONINTERACTIVE"] = "1"
        log_f = open(log, "ab")
        log_f.write(f"\n--- {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n".encode())
        log_f.flush()
        try:
            subprocess.Popen(
                ["/bin/bash", str(script)],
                stdout=log_f,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                env=env,
                start_new_session=True,
                close_fds=True,
            )
        except Exception as e:
            log_f.close()
            decky.logger.error(f"update spawn: {e}")
            return {"ok": False, "error": str(e)}
        decky.logger.info("update_from_github spawned")
        return {
            "ok": True,
            "started": True,
            "log": str(log),
            "message": "Update started. The QAM will reload in a few seconds.",
        }
