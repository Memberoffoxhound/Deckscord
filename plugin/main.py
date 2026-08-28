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


def _run(cmd: list[str], timeout: int = 15) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)


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


class Plugin:
    def __init__(self) -> None:
        self.cdp = Cdp()
        self._bridge_hash = ""
        self._injecting = asyncio.Lock()

    async def _main(self) -> None:
        decky.logger.info("Deckscord backend starting")
        await self._ensure_vesktop(wait=True)
        try:
            await self._ensure_cdp()
        except Exception as e:
            decky.logger.warning(f"CDP not ready yet: {e}")

    async def _unload(self) -> None:
        await self.cdp.close()

    async def _ensure_vesktop(self, wait: bool = False) -> dict[str, Any]:
        try:
            r = _run(["systemctl", "--user", "is-active", SERVICE], timeout=5)
            state = (r.stdout or "").strip() or "inactive"
            if state not in ("active", "activating"):
                _run(["systemctl", "--user", "start", SERVICE], timeout=10)
                r = _run(["systemctl", "--user", "is-active", SERVICE], timeout=5)
                state = (r.stdout or "").strip() or "inactive"
            if wait and state != "active":
                await asyncio.sleep(2)
                r = _run(["systemctl", "--user", "is-active", SERVICE], timeout=5)
                state = (r.stdout or "").strip() or "inactive"
            return {"running": state == "active", "state": state}
        except Exception as e:
            decky.logger.error(f"vesktop service: {e}")
            return {"running": False, "state": "failed", "error": str(e)}

    async def _ensure_cdp(self, inject: bool = True) -> None:
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
                    return
            except Exception:
                await self.cdp.close()
        last_err: Optional[Exception] = None
        for _ in range(8):
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
                return
            except Exception as e:
                last_err = e
                await self.cdp.close()
                await asyncio.sleep(1.2)
        raise ConnectionError(str(last_err) if last_err else "CDP connect failed")

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
        js = """
        (function(){
          try {
            var canvases = Array.prototype.slice.call(document.querySelectorAll('canvas'));
            var c = canvases.find(function(x){ return Math.min(x.width, x.height) >= 120; })
                 || canvases.find(function(x){ return Math.min(x.offsetWidth, x.offsetHeight) >= 120; });
            if (!c) return {ok:false, error:'no qr canvas'};
            var png = c.toDataURL('image/png');
            if (!png || png.length < 80) return {ok:false, error:'empty canvas'};
            return {ok:true, png:png, w:c.width, h:c.height};
          } catch (e) {
            return {ok:false, error:String(e && e.message ? e.message : e)};
          }
        })()
        """
        r = await self._eval(js)
        if isinstance(r, dict) and r.get("ok") and r.get("png"):
            return str(r["png"])
        clip = await self._eval(
            """
            (function(){
              var el = document.querySelector('[aria-label*="QR code"]')
                    || document.querySelector('[class*="qrCode"]')
                    || document.querySelector('canvas');
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
        svc = await self._ensure_vesktop(wait=False)
        running = bool(svc.get("running"))
        state = svc.get("state") or "inactive"
        out: dict[str, Any] = {
            "vesktop_running": running,
            "vesktop_state": state,
            "cdp": False,
            "logged_in": False,
            "ready": False,
            "phase": "starting",
            "phase_label": "Starting Discord…",
        }
        if state == "activating" or (not running and state != "failed"):
            out["phase"] = "loading"
            out["phase_label"] = "Discord is loading…"
            return out
        if not running:
            out["phase"] = "starting"
            out["phase_label"] = "Starting Discord…"
            if svc.get("error"):
                out["error"] = svc["error"]
            return out

        try:
            targets = _cdp_targets()
        except Exception:
            out["phase"] = "loading"
            out["phase_label"] = "Discord is loading…"
            return out

        out["cdp"] = True
        blob = " ".join(((t.get("url") or "") + " " + (t.get("title") or "")) for t in targets).lower()
        if "first-launch" in blob:
            try:
                await self._ensure_cdp(inject=False)
                await self._submit_first_launch()
            except Exception as e:
                decky.logger.warning(f"first-launch submit: {e}")
            out["phase"] = "loading"
            out["phase_label"] = "Opening Discord login…"
            return out

        on_login = "discord.com/login" in blob or "/login" in blob
        if on_login or "vesktop://static" in blob:
            out["phase"] = "login"
            out["phase_label"] = "Scan QR to log in"
            try:
                await self._ensure_cdp(inject=False)
                qr = await self._grab_login_qr()
                if qr:
                    out["qr_png"] = qr
                    out["phase_label"] = "Scan QR to log in"
                else:
                    out["phase_label"] = "Waiting for login QR…"
            except Exception as e:
                decky.logger.warning(f"login QR: {e}")
                out["phase_label"] = "Waiting for login QR…"
            return out

        try:
            snap = await self._bridge("snapshot()")
        except Exception as e:
            # Discord may still be on login even if the URL hasn't settled.
            try:
                await self._ensure_cdp(inject=False)
                href = str(await self._eval("location.href") or "")
                qr = await self._grab_login_qr()
                if qr or "/login" in href:
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

    async def join_voice(self, channel_id: str, channel_name: str = "") -> dict[str, Any]:
        r = await self._bridge(f"joinVoice({json.dumps(channel_id)})")
        return r if isinstance(r, dict) else {"ok": False, "error": "bad response"}

    async def leave_voice(self) -> dict[str, Any]:
        r = await self._bridge("leaveVoice()")
        return r if isinstance(r, dict) else {"ok": False, "error": "bad response"}

    async def toggle_mute(self) -> dict[str, Any]:
        r = await self._bridge("toggleMute()")
        return r if isinstance(r, dict) else {"ok": False, "error": "bad response"}

    async def toggle_deafen(self) -> dict[str, Any]:
        r = await self._bridge("toggleDeafen()")
        return r if isinstance(r, dict) else {"ok": False, "error": "bad response"}

    async def select_text(self, channel_id: str) -> dict[str, Any]:
        r = await self._bridge(f"selectText({json.dumps(channel_id)})")
        return r if isinstance(r, dict) else {"ok": False, "error": "bad response"}

    async def get_messages(self, channel_id: str, limit: int = 40) -> dict[str, Any]:
        r = await self._bridge(f"getMessages({json.dumps(channel_id)}, {int(limit)})")
        return r if isinstance(r, dict) else {"ok": False, "error": "bad response"}

    async def send_message(self, channel_id: str, content: str) -> dict[str, Any]:
        r = await self._bridge(f"sendMessage({json.dumps(channel_id)}, {json.dumps(content)})")
        return r if isinstance(r, dict) else {"ok": False, "error": "bad response"}

    async def start_vesktop(self) -> dict[str, Any]:
        return await self._ensure_vesktop(wait=True)
