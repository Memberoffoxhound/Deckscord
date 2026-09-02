#!/usr/bin/env python3
"""ScreenCast portal for gamescope — Discord Go Live sees the game, not X11.

gamescope publishes its framebuffer as a PipeWire video node (the same one
Steam Game Recording uses) but ships no xdg-desktop-portal backend. Chromium
getDisplayMedia then either hangs or captures a black Xwayland root.

This process owns org.freedesktop.portal.Desktop only while a gamescope
session is the active session, implements ScreenCast v2, and hands Vesktop
that PipeWire node. Desktop Mode releases the name so KWin's portal stays in
charge. Auto-approve is Vesktop/Vencord only.
"""

from __future__ import annotations

import fcntl
import json
import logging
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

os.environ.setdefault(
    "DBUS_SESSION_BUS_ADDRESS",
    f"unix:path={os.environ.get('XDG_RUNTIME_DIR', f'/run/user/{os.getuid()}')}/bus",
)

# PluginLoader's PyInstaller env breaks system GI/OpenSSL. Always scrub.
for _k in (
    "LD_LIBRARY_PATH",
    "PYTHONPATH",
    "PYTHONHOME",
    "_PYI_APPLICATION_HOME_DIR",
    "_PYI_PARENT_PROCESS_LEVEL",
    "_PYI_LINUX_PROCESS_NAME",
):
    os.environ.pop(_k, None)

logging.basicConfig(
    level=logging.INFO,
    stream=sys.stdout,
    format="%(levelname)s portal: %(message)s",
    force=True,
)
log = logging.getLogger("portal")

try:
    import gi

    gi.require_version("Gio", "2.0")
    gi.require_version("GLib", "2.0")
    from gi.repository import Gio, GLib
except Exception as e:
    log.error("gi/Gio missing: %s", e)
    sys.exit(1)

PORTAL_NAME = "org.freedesktop.portal.Desktop"
PORTAL_PATH = "/org/freedesktop/portal/desktop"
SC_IFACE = "org.freedesktop.portal.ScreenCast"
REQ_IFACE = "org.freedesktop.portal.Request"
SESS_IFACE = "org.freedesktop.portal.Session"
PROXY_IFACE = "org.freedesktop.portal.ProxyResolver"
NET_IFACE = "org.freedesktop.portal.NetworkMonitor"
PROPS_IFACE = "org.freedesktop.DBus.Properties"

FD_RELEASE_S = 30.0
KWIN = {"kwin_wayland", "kwin_x11"}
# Last gamescope Video/Source we successfully dumped. Start() uses this when
# pw-dump is wedged (Share game connected) so we never block the GLib loop
# on a 5s hang, and never retry into a live PipeWire graph.
_NODE = {"id": None, "size": None, "at": 0.0}
_DUMPING = threading.Event()

XML = f"""
<node>
  <interface name="{SC_IFACE}">
    <method name="CreateSession">
      <arg type="a{{sv}}" name="options" direction="in"/>
      <arg type="o" name="handle" direction="out"/>
    </method>
    <method name="SelectSources">
      <arg type="o" name="session_handle" direction="in"/>
      <arg type="a{{sv}}" name="options" direction="in"/>
      <arg type="o" name="handle" direction="out"/>
    </method>
    <method name="Start">
      <arg type="o" name="session_handle" direction="in"/>
      <arg type="s" name="parent_window" direction="in"/>
      <arg type="a{{sv}}" name="options" direction="in"/>
      <arg type="o" name="handle" direction="out"/>
    </method>
    <method name="OpenPipeWireRemote">
      <arg type="o" name="session_handle" direction="in"/>
      <arg type="a{{sv}}" name="options" direction="in"/>
      <arg type="h" name="fd" direction="out"/>
    </method>
    <property name="version" type="u" access="read"/>
    <property name="AvailableSourceTypes" type="u" access="read"/>
    <property name="AvailableCursorModes" type="u" access="read"/>
  </interface>
  <interface name="{PROXY_IFACE}">
    <method name="Lookup">
      <arg type="s" name="uri" direction="in"/>
      <arg type="as" name="proxies" direction="out"/>
    </method>
    <property name="version" type="u" access="read"/>
  </interface>
  <interface name="{NET_IFACE}">
    <method name="GetAvailable">
      <arg type="b" name="available" direction="out"/>
    </method>
    <method name="GetMetered">
      <arg type="b" name="metered" direction="out"/>
    </method>
    <method name="GetConnectivity">
      <arg type="u" name="connectivity" direction="out"/>
    </method>
    <method name="CanReach">
      <arg type="s" name="hostname" direction="in"/>
      <arg type="u" name="port" direction="in"/>
      <arg type="b" name="reachable" direction="out"/>
    </method>
    <property name="version" type="u" access="read"/>
  </interface>
</node>
"""


def _runtime() -> str:
    return os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")


def _comms() -> set[str]:
    names: set[str] = set()
    try:
        for p in Path("/proc").iterdir():
            if not p.name.isdigit():
                continue
            try:
                names.add((p / "comm").read_text().strip())
            except OSError:
                continue
    except OSError:
        pass
    return names


def in_game_mode() -> bool:
    # Nested gamescope under KWin is still Desktop Mode. During login, kwin
    # is not up yet — do not treat a leftover gamescope binary as Game Mode
    # unless gamescope is actually the session compositor.
    # gamescope-session's /proc comm truncates to "gamescope-sessio".
    names = _comms()
    if names & KWIN:
        return False
    return any(n == "gamescope" or n.startswith("gamescope") for n in names)


def _msg_path(message) -> str:
    for name in ("get_path", "get_object_path"):
        fn = getattr(message, name, None)
        if callable(fn):
            try:
                return fn() or ""
            except Exception:
                continue
    return ""


def _systemctl_user(*args: str, timeout: int = 8) -> None:
    subprocess.run(
        ["systemctl", "--user", *args],
        timeout=timeout,
        capture_output=True,
        check=False,
    )


def _data_dir() -> Path:
    home = Path(os.environ.get("HOME") or "")
    return home / ".local" / "share" / "deckscord"


def _nudge_fresh() -> bool:
    p = _data_dir() / "want-portal"
    try:
        return p.is_file() and (time.time() - p.stat().st_mtime) < 90
    except OSError:
        return False


def _take_singleton():
    """One shim only. Leftover copies steal org.freedesktop.portal.Desktop from each other."""
    path = _data_dir() / "portal.lock"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fh = open(path, "a+", encoding="utf-8")
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        fh.seek(0)
        fh.truncate()
        fh.write(str(os.getpid()))
        fh.flush()
        try:
            (_data_dir() / "portal.pid").write_text(str(os.getpid()), encoding="utf-8")
        except OSError:
            pass
        return fh
    except OSError as e:
        log.info("another portal shim already holds the lock (%s) — exiting", e)
        return None


def _write_status(owned: bool) -> None:
    path = _data_dir() / "portal.status"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"owned": bool(owned), "ts": time.time(), "pid": os.getpid()}),
            encoding="utf-8",
        )
    except OSError:
        pass


def sender_token(sender: str) -> str:
    return (sender or "").lstrip(":").replace(".", "_")


def opt_str(options, key: str, default: str = "") -> str:
    if not options:
        return default
    v = options.get(key)
    if v is None:
        return default
    if isinstance(v, GLib.Variant):
        try:
            v = v.unpack()
        except Exception:
            return default
    return str(v) if v else default


def node_size(info: dict):
    try:
        for plist in (info.get("params") or {}).values():
            if not isinstance(plist, list):
                continue
            for prm in plist:
                if isinstance(prm, dict) and isinstance(prm.get("size"), dict):
                    s = prm["size"]
                    if s.get("width") and s.get("height"):
                        return int(s["width"]), int(s["height"])
    except Exception:
        pass
    return None


def _cached_node():
    nid = _NODE.get("id")
    if nid is None:
        return None, None
    if (time.monotonic() - float(_NODE.get("at") or 0)) > 180:
        return None, None
    return nid, _NODE.get("size")


def find_screen_node(timeout: float = 1.5):
    """Return (node_id, (w,h)|None) for the gamescope framebuffer, else (None, None)."""
    if _DUMPING.is_set():
        return _cached_node()
    _DUMPING.set()
    try:
        return _find_screen_node(timeout)
    finally:
        _DUMPING.clear()


def _find_screen_node(timeout: float = 1.5):
    try:
        proc = subprocess.run(
            ["pw-dump"],
            capture_output=True,
            text=True,
            timeout=timeout,
            env={k: v for k, v in os.environ.items() if k != "LD_LIBRARY_PATH"},
        )
        data = json.loads(proc.stdout or "[]")
    except subprocess.TimeoutExpired:
        log.warning("pw-dump silent (%.1fs) — PipeWire may be wedged", timeout)
        return _cached_node()
    except Exception as e:
        log.warning("pw-dump: %r", e)
        return _cached_node()

    vids = []
    for n in data:
        if not str(n.get("type", "")).endswith("Node"):
            continue
        info = n.get("info") or {}
        props = info.get("props") or {}
        mc = str(props.get("media.class", ""))
        name = str(props.get("node.name", ""))
        desc = str(props.get("node.description", ""))
        blob = f"{mc} {name} {desc}".lower()
        if any(x in blob for x in ("v4l2", "loopback", "video42", "deckscord")):
            continue
        if "video/source" in mc.lower() or "gamescope" in blob or "screen" in blob:
            vids.append((n.get("id"), name, mc, info))
    picked = None
    for nid, name, mc, info in vids:
        if "gamescope" in name.lower() or "screen" in name.lower():
            picked = (int(nid), node_size(info))
            break
    if picked is None:
        for nid, name, mc, info in vids:
            if "video/source" in mc.lower():
                picked = (int(nid), node_size(info))
                break
    if picked is not None:
        _NODE["id"], _NODE["size"], _NODE["at"] = picked[0], picked[1], time.monotonic()
        return picked
    return _cached_node()


def _safe_close(fd: int) -> None:
    try:
        os.close(fd)
    except OSError:
        pass


class Portal:
    def __init__(self) -> None:
        self.conn: Gio.DBusConnection | None = None
        self.regs: list[int] = []
        self.sessions: dict[str, dict] = {}
        self.owner_id = 0
        self._stopping_portal = False
        self._started = time.monotonic()
        self._gm_since = 0.0
        self._desk_since = 0.0
        self._last_stop = 0.0
        self._stable_gm = False
        self._own_at = 0.0
        self._masked = False

    def sender_is_vesktop(self, sender: str) -> bool:
        if not self.conn or not sender:
            return False
        try:
            reply = self.conn.call_sync(
                "org.freedesktop.DBus",
                "/org/freedesktop/DBus",
                "org.freedesktop.DBus",
                "GetConnectionUnixProcessID",
                GLib.Variant("(s)", (sender,)),
                GLib.VariantType.new("(u)"),
                Gio.DBusCallFlags.NONE,
                1000,
                None,
            )
            pid = int(reply.unpack()[0])
            cmd = (
                Path(f"/proc/{pid}/cmdline")
                .read_bytes()
                .replace(b"\0", b" ")
                .decode(errors="replace")
                .lower()
            )
            if any(k in cmd for k in ("vesktop", "vencord", "discord", "deckscord-profile", "xdg-desktop-portal", "google-chrome", "chrome")):
                return True
            cg = Path(f"/proc/{pid}/cgroup").read_text(errors="replace").lower()
            if any(k in cg for k in ("vesktop", "vencord", "chrome", "deckscord")):
                return True
            log.warning("refused sender %s pid=%s cmd=%r", sender, pid, cmd[:120])
        except Exception as e:
            log.warning("sender check %s: %r", sender, e)
        return False

    def request_path(self, sender: str, options) -> str:
        token = opt_str(options, "handle_token", "t") or "t"
        return f"/org/freedesktop/portal/desktop/request/{sender_token(sender)}/{token}"

    def emit_response(self, sender: str, path: str, code: int, results: dict) -> None:
        if not self.conn:
            return
        try:
            self.conn.emit_signal(
                sender,
                path,
                REQ_IFACE,
                "Response",
                GLib.Variant("(ua{sv})", (code, results)),
            )
        except Exception as e:
            log.warning("Response emit: %r", e)

    def close_session(self, path: str) -> None:
        sess = self.sessions.pop(path, None)
        if not sess:
            return
        for fd in list(sess.get("fds") or []):
            _safe_close(fd)
        sender = sess.get("sender")
        if sender and self.conn:
            try:
                self.conn.emit_signal(
                    sender, path, SESS_IFACE, "Closed", GLib.Variant("(a{sv})", ({},))
                )
            except Exception:
                pass
        log.info("session closed %s", path)

    def close_all(self) -> None:
        for p in list(self.sessions):
            self.close_session(p)

    def release_fd(self, session: str, fd: int) -> bool:
        sess = self.sessions.get(session)
        if sess and fd in sess.get("fds", []):
            sess["fds"].remove(fd)
            _safe_close(fd)
        return False

    def on_method(self, _conn, sender, _path, iface, method, params, invocation):
        try:
            if iface == SC_IFACE:
                return self._screencast(sender, method, params, invocation)
            if iface == PROXY_IFACE and method == "Lookup":
                invocation.return_value(GLib.Variant("(as)", (["direct://"],)))
                return
            if iface == NET_IFACE:
                if method == "GetAvailable":
                    invocation.return_value(GLib.Variant("(b)", (True,)))
                    return
                if method == "GetMetered":
                    invocation.return_value(GLib.Variant("(b)", (False,)))
                    return
                if method == "GetConnectivity":
                    invocation.return_value(GLib.Variant("(u)", (4,)))
                    return
                if method == "CanReach":
                    invocation.return_value(GLib.Variant("(b)", (True,)))
                    return
            invocation.return_dbus_error(
                "org.freedesktop.DBus.Error.UnknownMethod",
                f"{iface}.{method} not implemented by Deckscord",
            )
        except Exception as e:
            log.error("%s.%s: %r", iface, method, e)
            invocation.return_dbus_error("org.freedesktop.portal.Error.Failed", str(e))

    def _screencast(self, sender, method, params, invocation):
        if method == "CreateSession":
            (options,) = params.unpack()
            req = self.request_path(sender, options)
            st = opt_str(options, "session_handle_token", "s") or "s"
            session = f"/org/freedesktop/portal/desktop/session/{sender_token(sender)}/{st}"
            invocation.return_value(GLib.Variant("(o)", (req,)))
            if not self.sender_is_vesktop(sender):
                GLib.idle_add(self.emit_response, sender, req, 2, {})
                return
            # One ScreenCast at a time. Chromium retries with a new unique
            # name (:1.387, :1.390, …) so sender-prefix matching leaked
            # OpenPipeWireRemote fds and stacked gamescope consumers.
            for old in [p for p in self.sessions if p != session]:
                self.close_session(old)
            self.sessions[session] = {"fds": [], "sender": sender}
            log.info("CreateSession %s", session)
            GLib.idle_add(
                self.emit_response,
                sender,
                req,
                0,
                {"session_handle": GLib.Variant("s", session)},
            )
            return

        if method == "SelectSources":
            session, options = params.unpack()
            req = self.request_path(sender, options)
            invocation.return_value(GLib.Variant("(o)", (req,)))
            GLib.idle_add(self.emit_response, sender, req, 0, {})
            return

        if method == "Start":
            session, _parent, options = params.unpack()
            req = self.request_path(sender, options)
            invocation.return_value(GLib.Variant("(o)", (req,)))
            GLib.idle_add(self._start, sender, session, req, 0)
            return

        if method == "OpenPipeWireRemote":
            session = params.unpack()[0]
            if session not in self.sessions:
                invocation.return_dbus_error(
                    "org.freedesktop.portal.Error.Failed", "unknown session"
                )
                return
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                remote = os.environ.get("PIPEWIRE_REMOTE", "pipewire-0")
                sock.connect(os.path.join(_runtime(), remote))
            except OSError as e:
                sock.close()
                invocation.return_dbus_error(
                    "org.freedesktop.portal.Error.Failed", str(e)
                )
                return
            fd = sock.detach()
            fd_list = Gio.UnixFDList.new()
            fd_list.append(fd)
            self.sessions[session]["fds"].append(fd)
            GLib.timeout_add_seconds(int(FD_RELEASE_S), self.release_fd, session, fd)
            log.info("OpenPipeWireRemote session=%s", session)
            invocation.return_value_with_unix_fd_list(
                GLib.Variant("(h)", (0,)), fd_list
            )
            return

        invocation.return_dbus_error(
            "org.freedesktop.DBus.Error.UnknownMethod", method
        )

    def _start(self, sender: str, session: str, req: str, attempt: int = 0) -> bool:
        node, size = _cached_node()
        if node is None:
            node, size = find_screen_node()
        if node is None and attempt < 3:
            GLib.timeout_add(400, self._start, sender, session, req, attempt + 1)
            return False
        if node is None or session not in self.sessions:
            log.warning("Start: no gamescope video node")
            self.emit_response(sender, req, 2, {})
            return False
        props = {
            "position": GLib.Variant("(ii)", (0, 0)),
            "source_type": GLib.Variant("u", 1),
        }
        if size:
            props["size"] = GLib.Variant("(ii)", (size[0], size[1]))
        log.info("Start node=%s size=%s", node, size)
        self.emit_response(
            sender,
            req,
            0,
            {"streams": GLib.Variant("a(ua{sv})", [(int(node), props)])},
        )
        return False

    def on_get_prop(self, _conn, _sender, _path, iface, name):
        if name == "version":
            if iface == SC_IFACE:
                return GLib.Variant("u", 2)
            return GLib.Variant("u", 1)
        if name == "AvailableSourceTypes":
            return GLib.Variant("u", 1)  # MONITOR
        if name == "AvailableCursorModes":
            return GLib.Variant("u", 3)  # HIDDEN | EMBEDDED
        return None

    def on_filter(self, conn, message, incoming):
        # Must never raise: a thrown filter wedges the session bus and hangs
        # Game Mode / Plasma login (Legion splash, "logging in" forever).
        try:
            return self._on_filter(conn, message, incoming)
        except Exception as e:
            log.warning("filter: %r", e)
            return message

    def _on_filter(self, conn, message, incoming):
        if not incoming:
            return message
        iface = message.get_interface()
        member = message.get_member()
        path = _msg_path(message)
        if member == "Close" and iface == SESS_IFACE and path in self.sessions:
            self.close_session(path)
            try:
                conn.send_message(
                    Gio.DBusMessage.new_method_reply(message)
                )
            except Exception:
                pass
            return None
        if member == "Close" and iface == REQ_IFACE and path.startswith(
            "/org/freedesktop/portal/desktop/request/"
        ):
            try:
                conn.send_message(Gio.DBusMessage.new_method_reply(message))
            except Exception:
                pass
            return None
        if (
            path.startswith("/org/freedesktop/portal/")
            and iface
            and not iface.startswith("org.freedesktop.DBus")
            and iface not in (SC_IFACE, PROXY_IFACE, NET_IFACE, REQ_IFACE, SESS_IFACE)
            and message.get_message_type() == Gio.DBusMessageType.METHOD_CALL
        ):
            log.warning("refused %s %s.%s", message.get_sender(), iface, member)
        return message

    def register(self, conn: Gio.DBusConnection) -> None:
        self.conn = conn
        if self.regs:
            log.info("ScreenCast objects already on %s", PORTAL_PATH)
            return
        conn.add_filter(self.on_filter)
        info = Gio.DBusNodeInfo.new_for_xml(XML)
        for iface in info.interfaces:
            rid = conn.register_object(
                PORTAL_PATH, iface, self.on_method, self.on_get_prop, None
            )
            self.regs.append(rid)
        log.info("ScreenCast objects on %s", PORTAL_PATH)

    def unregister(self) -> None:
        self.close_all()
        if self.conn:
            for rid in self.regs:
                try:
                    self.conn.unregister_object(rid)
                except Exception:
                    pass
        self.regs = []

    def _mask_desktop_portal(self) -> None:
        """Runtime-mask so systemd cannot steal the name back during Game Mode."""
        now = time.monotonic()
        if (now - self._last_stop) < 4.0 and self._masked:
            return
        self._last_stop = now
        try:
            _systemctl_user("mask", "--runtime", "xdg-desktop-portal.service")
            self._masked = True
        except Exception as e:
            log.warning("mask portal: %r", e)
        try:
            _systemctl_user("stop", "xdg-desktop-portal.service")
        except Exception as e:
            log.warning("stop portal: %r", e)

    def _unmask_desktop_portal(self) -> None:
        if not self._masked:
            return
        try:
            _systemctl_user("unmask", "xdg-desktop-portal.service")
            self._masked = False
        except Exception as e:
            log.warning("unmask portal: %r", e)

    def try_own(self, force: bool = False) -> None:
        if self.owner_id:
            return
        now = time.monotonic()
        if not force and self._own_at and (now - self._own_at) < 1.0:
            return
        self._own_at = now
        if self._stable_gm or _nudge_fresh():
            self._mask_desktop_portal()
        if self.owner_id:
            try:
                Gio.bus_unown_name(self.owner_id)
            except Exception:
                pass
            self.owner_id = 0
        flags = Gio.BusNameOwnerFlags.DO_NOT_QUEUE
        try:
            flags |= Gio.BusNameOwnerFlags.REPLACE
        except Exception:
            pass
        self.owner_id = Gio.bus_own_name(
            Gio.BusType.SESSION,
            PORTAL_NAME,
            flags,
            self.on_bus_acquired,
            self.on_name_acquired,
            self.on_name_lost,
        )

    def drop_name(self) -> None:
        if self.owner_id:
            Gio.bus_unown_name(self.owner_id)
            self.owner_id = 0
        self.unregister()
        _write_status(False)
        log.info("released %s", PORTAL_NAME)

    def _start_desktop_portal(self) -> None:
        self._unmask_desktop_portal()
        try:
            _systemctl_user("start", "xdg-desktop-portal.service")
            log.info("started xdg-desktop-portal for Desktop Mode")
        except Exception as e:
            log.warning("start portal: %r", e)

    def on_bus_acquired(self, conn, _name):
        self.register(conn)

    def on_name_acquired(self, _conn, _name):
        self._stopping_portal = False
        _write_status(True)
        log.info("owned %s — Game Mode Go Live uses the gamescope node", PORTAL_NAME)

    def on_name_lost(self, _conn, _name):
        log.info("name lost")
        _write_status(False)
        self.unregister()
        self.owner_id = 0
        now = time.monotonic()
        # Only steal the name after Game Mode has been up for a bit. Stopping
        # xdg-desktop-portal during boot/login hangs Plasma and gamescope-session.
        if self._stable_gm and ((now - self._started) >= 20.0 or _nudge_fresh()):
            self._mask_desktop_portal()
            GLib.timeout_add(400, self._retry_own)

    def _retry_own(self) -> bool:
        if (self._stable_gm or _nudge_fresh()) and not self.owner_id:
            self.try_own(force=True)
        return False

    def tick(self) -> bool:
        want = in_game_mode()
        now = time.monotonic()
        if want:
            self._desk_since = 0.0
            if not self._gm_since:
                self._gm_since = now
            nudged = _nudge_fresh()
            self._stable_gm = nudged or (now - self._gm_since) >= 5.0
            if self._stable_gm and not self.owner_id:
                self.try_own(force=nudged)
            last = float(_NODE.get("at") or 0)
            if self._stable_gm and not _DUMPING.is_set() and (last == 0 or now - last >= 15):
                threading.Thread(target=find_screen_node, daemon=True).start()
        else:
            self._gm_since = 0.0
            self._stable_gm = False
            self._stopping_portal = False
            if not self._desk_since:
                self._desk_since = now
            # Stay on the name while Share game is still starting.
            if self.owner_id and (now - self._desk_since) >= 5.0 and not _nudge_fresh():
                self.drop_name()
                self._start_desktop_portal()
        return True


def main() -> int:
    lock = _take_singleton()
    if lock is None:
        return 0
    portal = Portal()
    GLib.timeout_add_seconds(1, portal.tick)
    portal.tick()
    log.info("watching for gamescope (idle in Desktop Mode) pid=%s", os.getpid())
    loop = GLib.MainLoop()

    def _quit(*_a):
        portal.drop_name()
        portal._unmask_desktop_portal()
        loop.quit()
        return False

    def _force_own(*_a):
        log.info("SIGUSR1 — take ScreenCast name now")
        portal._gm_since = portal._gm_since or time.monotonic()
        portal._stable_gm = True
        if portal.owner_id:
            log.info("already owns ScreenCast name")
            return True
        portal.try_own(force=True)
        return True

    def _drop_sessions(*_a):
        n = len(portal.sessions)
        portal.close_all()
        log.info("SIGUSR2 — closed %s ScreenCast session(s)", n)
        return True

    def _on_signal(sig, cb=_quit):
        try:
            from gi.repository import GLibUnix  # type: ignore

            GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, sig, cb)
        except Exception:
            GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, sig, cb)

    _on_signal(signal.SIGINT)
    _on_signal(signal.SIGTERM)
    _on_signal(signal.SIGUSR1, _force_own)
    _on_signal(signal.SIGUSR2, _drop_sessions)
    loop.run()
    try:
        lock.close()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
