#!/usr/bin/env python3
"""Deckscord overlay on gamescope's external overlay plane.

One transparent fullscreen X11 window (GAMESCOPE_EXTERNAL_OVERLAY):
  - PiP stamp from state.json + frame.jpg
  - Who's-talking roster from talking.json (avatar + name, speakers only)

Game Mode only. Mapping this onto KWin/SDDM (the first :0 socket) covers
login and steals Steam's overlay. Clicks pass through so the game keeps input.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
from pathlib import Path

for _k in (
    "LD_LIBRARY_PATH",
    "PYTHONPATH",
    "PYTHONHOME",
    "_PYI_APPLICATION_HOME_DIR",
    "_PYI_PARENT_PROCESS_LEVEL",
    "_PYI_LINUX_PROCESS_NAME",
):
    os.environ.pop(_k, None)

os.environ.setdefault("GDK_BACKEND", "x11")
os.environ.pop("WAYLAND_DISPLAY", None)
os.environ.pop("GAMESCOPE_WAYLAND_DISPLAY", None)

KWIN = {"kwin_wayland", "kwin_x11"}


def _die(msg: str, code: int = 1) -> None:
    print(f"overlay: {msg}", file=sys.stderr, flush=True)
    sys.exit(code)


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
    names = _comms()
    if names & KWIN:
        return False
    return any(n == "gamescope" or n.startswith("gamescope") for n in names)


def _display_is_gamescope(disp: str) -> bool:
    """True if this X server interned gamescope's root atoms (not KWin Xwayland)."""
    try:
        from ctypes import c_char_p, c_int, c_ulong, c_void_p, cdll

        x = cdll.LoadLibrary("libX11.so.6")
        x.XOpenDisplay.argtypes = [c_char_p]
        x.XOpenDisplay.restype = c_void_p
        x.XInternAtom.argtypes = [c_void_p, c_char_p, c_int]
        x.XInternAtom.restype = c_ulong
        x.XCloseDisplay.argtypes = [c_void_p]
        d = x.XOpenDisplay(disp.encode())
        if not d:
            return False
        try:
            return bool(x.XInternAtom(d, b"GAMESCOPE_FOCUSED_WINDOW", True))
        finally:
            x.XCloseDisplay(d)
    except Exception:
        pass
    try:
        r = subprocess.run(
            ["xprop", "-display", disp, "-root"],
            capture_output=True,
            text=True,
            timeout=2,
        )
        return "GAMESCOPE_" in (r.stdout or "")
    except Exception:
        return False


def _pick_display() -> str | None:
    """Gamescope Xwayland only. Never the first :0 on a desktop session."""
    cands: list[str] = []
    raw = os.environ.get("DISPLAY") or ""
    if raw:
        n = raw.lstrip(":").split(".")[0]
        sock = Path(f"/tmp/.X11-unix/X{n}")
        if sock.exists():
            cands.append(raw if raw.startswith(":") else f":{n}")
    for n in range(0, 8):
        if Path(f"/tmp/.X11-unix/X{n}").exists():
            cands.append(f":{n}")
    seen: set[str] = set()
    ordered: list[str] = []
    for d in cands:
        if d not in seen:
            seen.add(d)
            ordered.append(d)
    gs = [d for d in ordered if _display_is_gamescope(d)]
    if gs:
        return gs[0]
    return None


def _set_overlay_atoms(xid: int) -> None:
    """GAMESCOPE_EXTERNAL_OVERLAY=1 plus OSD window type, before Steam takes focus."""
    try:
        from ctypes import POINTER, c_char_p, c_int, c_ulong, c_void_p, cdll

        x = cdll.LoadLibrary("libX11.so.6")
        x.XOpenDisplay.argtypes = [c_char_p]
        x.XOpenDisplay.restype = c_void_p
        x.XInternAtom.argtypes = [c_void_p, c_char_p, c_int]
        x.XInternAtom.restype = c_ulong
        x.XChangeProperty.argtypes = [
            c_void_p, c_ulong, c_ulong, c_ulong, c_int, c_int, POINTER(c_ulong), c_int,
        ]
        x.XSync.argtypes = [c_void_p, c_int]
        x.XCloseDisplay.argtypes = [c_void_p]
        d = x.XOpenDisplay(None)
        if not d:
            raise RuntimeError("XOpenDisplay failed")
        try:
            xa_atom, xa_cardinal, replace = 4, 6, 0
            one = (c_ulong * 1)(1)
            x.XChangeProperty(
                d, xid, x.XInternAtom(d, b"GAMESCOPE_EXTERNAL_OVERLAY", False),
                xa_cardinal, 32, replace, one, 1,
            )
            types = (c_ulong * 2)(
                x.XInternAtom(d, b"_KDE_NET_WM_WINDOW_TYPE_ON_SCREEN_DISPLAY", False),
                x.XInternAtom(d, b"_NET_WM_WINDOW_TYPE_NOTIFICATION", False),
            )
            x.XChangeProperty(
                d, xid, x.XInternAtom(d, b"_NET_WM_WINDOW_TYPE", False),
                xa_atom, 32, replace, types, 2,
            )
            x.XSync(d, False)
        finally:
            x.XCloseDisplay(d)
        return
    except Exception as e:
        print(f"overlay: xlib atoms failed: {e}", flush=True)
    try:
        subprocess.run(
            [
                "xprop",
                "-id",
                str(xid),
                "-f",
                "GAMESCOPE_EXTERNAL_OVERLAY",
                "32c",
                "-set",
                "GAMESCOPE_EXTERNAL_OVERLAY",
                "1",
            ],
            check=False,
            timeout=2,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def _load(path: Path) -> dict:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def main() -> None:
    state_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "").expanduser()
    if not state_dir.is_dir():
        _die("usage: pip_overlay.py <state-dir>")

    if not in_game_mode():
        _die("not Game Mode (kwin present or no gamescope) — refusing to map")

    disp = _pick_display()
    if not disp:
        _die("no gamescope X11 display")
    os.environ["DISPLAY"] = disp

    try:
        import gi

        gi.require_version("Gtk", "3.0")
        gi.require_version("Gdk", "3.0")
        from gi.repository import Gdk, GLib, Gtk
    except Exception as e:
        _die(f"gtk3 missing: {e}")

    try:
        import cairo
    except Exception as e:
        _die(f"cairo missing: {e}")

    win = Gtk.Window(type=Gtk.WindowType.TOPLEVEL)
    win.set_title("Deckscord Overlay")
    win.set_decorated(False)
    win.set_app_paintable(True)
    win.set_accept_focus(False)
    win.set_focus_on_map(False)
    try:
        win.set_can_focus(False)
    except Exception:
        pass
    win.set_keep_above(True)
    win.set_skip_taskbar_hint(True)
    win.set_skip_pager_hint(True)
    win.set_resizable(True)
    try:
        win.set_type_hint(Gdk.WindowTypeHint.NOTIFICATION)
    except Exception:
        pass

    screen = win.get_screen()
    visual = screen.get_rgba_visual() if screen else None
    if visual:
        win.set_visual(visual)

    sw, sh = 1280, 800
    try:
        gd = Gdk.Display.get_default()
        mon = gd.get_primary_monitor() if gd else None
        if mon is None and gd:
            mon = gd.get_monitor(0)
        geo = mon.get_geometry() if mon else None
        if geo and geo.width > 0 and geo.height > 0:
            sw, sh = int(geo.width), int(geo.height)
        elif screen:
            sw = screen.get_width()
            sh = screen.get_height()
    except Exception:
        if screen:
            sw = screen.get_width() or sw
            sh = screen.get_height() or sh
    win.set_default_size(sw, sh)
    win.set_size_request(sw, sh)
    try:
        win.move(0, 0)
    except Exception:
        pass
    win.resize(sw, sh)

    bag = {
        "pip": {},
        "talk": {},
        "pixbuf": None,
        "mtime": -1.0,
        "stamp": (0, 0, 0, 0),
        "faces": {},
    }

    def stamp_box(st: dict) -> tuple[int, int, int, int]:
        size = str(st.get("size") or "small")
        cap = 480 if size == "large" else 240
        frac = 0.42 if size == "large" else 0.30
        h = min(cap, max(90, int(sh * frac)))
        w = int(h * 16 / 9)
        pad = max(10, int(min(sw, sh) * 0.012))
        corner = str(st.get("corner") or "bottom-right")
        if corner == "top-left":
            x, y = pad, pad
        elif corner == "top-right":
            x, y = sw - w - pad, pad
        elif corner == "bottom-left":
            x, y = pad, sh - h - pad
        else:
            x, y = sw - w - pad, sh - h - pad
        return x, y, w, h

    def draw_stamp(cr) -> None:
        st = bag["pip"] or {}
        if not st.get("enabled"):
            return
        pb = bag["pixbuf"]
        if pb is None:
            return
        x, y, tw, th = bag["stamp"]
        alpha = max(0.15, min(1.0, float(st.get("opacity") or 100) / 100.0))
        iw, ih = pb.get_width(), pb.get_height()
        if iw < 2 or ih < 2:
            return
        scale = min(tw / iw, th / ih)
        dw, dh = max(1, int(iw * scale)), max(1, int(ih * scale))
        ox, oy = x + (tw - dw) // 2, y + (th - dh) // 2
        cr.set_operator(cairo.OPERATOR_OVER)
        cr.save()
        cr.translate(ox, oy)
        cr.scale(dw / iw, dh / ih)
        Gdk.cairo_set_source_pixbuf(cr, pb, 0, 0)
        cr.paint_with_alpha(alpha)
        cr.restore()
        name = str(st.get("name") or "")
        if name:
            cr.set_source_rgba(0, 0, 0, 0.55 * alpha)
            cr.rectangle(ox, oy + dh - 22, dw, 22)
            cr.fill()
            cr.set_source_rgba(1, 1, 1, alpha)
            cr.select_font_face("sans-serif", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
            cr.set_font_size(12)
            cr.move_to(ox + 6, oy + dh - 7)
            cr.show_text(name[:42])

    def face_for(path: str):
        if not path:
            return None
        try:
            mt = Path(path).stat().st_mtime
        except OSError:
            return None
        hit = bag["faces"].get(path)
        if hit and hit[0] == mt:
            return hit[1]
        try:
            pb = Gdk.pixbuf_new_from_file(path)
        except Exception:
            return None
        bag["faces"][path] = (mt, pb)
        return pb

    def draw_talking(cr) -> None:
        st = bag["talk"] or {}
        if not st.get("enabled"):
            return
        speakers = st.get("speakers") or []
        if not speakers:
            return
        speakers = speakers[:5]
        alpha = max(0.25, min(1.0, float(st.get("opacity") or 90) / 100.0))
        size = str(st.get("size") or "small")
        frac = 0.055 if size == "large" else 0.038
        d = min(48 if size == "large" else 32, max(22, int(sh * frac)))
        font = max(13, int(d * 0.52))
        pad = max(10, int(min(sw, sh) * 0.012))
        gap = max(6, int(d * 0.28))
        row_h = d + gap
        corner = str(st.get("corner") or "top-left")
        right = corner.endswith("right")
        bottom = "bottom" in corner
        total_h = len(speakers) * row_h - gap
        name_w = int(min(sw * 0.28, d * 8))
        block_w = d + 10 + name_w

        x0 = sw - pad - (d if right else block_w)
        if not right:
            x0 = pad
        y0 = pad
        if bottom:
            y0 = sh - pad - total_h

        pip = bag["pip"] or {}
        if pip.get("enabled"):
            px, py, pw, ph = bag["stamp"]
            same_v = (py < sh / 2) == (not bottom)
            same_h = (px < sw / 2) == (not right)
            if same_v and same_h:
                if bottom:
                    y0 = py - pad - total_h
                else:
                    y0 = py + ph + pad
                y0 = max(pad, min(y0, sh - pad - total_h))

        cr.set_operator(cairo.OPERATOR_OVER)
        cr.select_font_face("sans-serif", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
        cr.set_font_size(font)
        for i, sp in enumerate(speakers):
            if not isinstance(sp, dict):
                continue
            y = y0 + i * row_h
            name = str(sp.get("name") or "Someone")[:28]
            if sp.get("self"):
                name = name + " (you)"
            ax = x0 + (block_w - d if right else 0)
            cx, cy = ax + d / 2.0, y + d / 2.0
            pb = face_for(str(sp.get("file") or ""))
            cr.save()
            cr.new_path()
            cr.arc(cx, cy, d / 2.0, 0, 2 * math.pi)
            cr.close_path()
            cr.clip()
            if pb is not None:
                iw, ih = pb.get_width(), pb.get_height()
                sc = max(d / max(iw, 1), d / max(ih, 1))
                cr.save()
                cr.translate(ax, y)
                cr.scale(sc, sc)
                Gdk.cairo_set_source_pixbuf(cr, pb, 0, 0)
                cr.paint_with_alpha(alpha)
                cr.restore()
            else:
                cr.set_source_rgba(0.12, 0.14, 0.18, 0.85 * alpha)
                cr.paint()
                letter = (name[:1] or "?").upper()
                cr.set_source_rgba(1, 1, 1, alpha)
                cr.set_font_size(max(12, int(d * 0.45)))
                xb, _yb, tw, th, _xa, _ya = cr.text_extents(letter)
                cr.move_to(cx - tw / 2 - xb, cy + th / 2)
                cr.show_text(letter)
            cr.restore()
            cr.set_source_rgba(0.23, 0.65, 0.36, alpha)
            cr.set_line_width(max(2.0, d * 0.07))
            cr.arc(cx, cy, d / 2.0 - 1.0, 0, 2 * math.pi)
            cr.stroke()
            cr.set_font_size(font)
            tx = x0 if right else ax + d + 8
            ty = y + d * 0.68
            cr.set_source_rgba(0, 0, 0, 0.75 * alpha)
            cr.move_to(tx + 1, ty + 1)
            cr.show_text(name)
            cr.set_source_rgba(1, 1, 1, alpha)
            cr.move_to(tx, ty)
            cr.show_text(name)

    def draw(_widget, cr):
        cr.set_operator(cairo.OPERATOR_SOURCE)
        cr.set_source_rgba(0, 0, 0, 0)
        cr.paint()
        draw_stamp(cr)
        draw_talking(cr)
        return False

    da = Gtk.DrawingArea()
    da.connect("draw", draw)
    win.add(da)

    def pass_clicks() -> None:
        gdk_win = win.get_window()
        if not gdk_win:
            return
        try:
            gdk_win.input_shape_combine_region(cairo.Region(), 0, 0)
        except Exception:
            try:
                import cairo as _c

                gdk_win.input_shape_combine_region(_c.Region(), 0, 0)
            except Exception:
                pass

    def mark_overlay() -> None:
        gdk_win = win.get_window()
        if not gdk_win:
            return
        try:
            xid = int(gdk_win.get_xid())
        except Exception:
            xid = 0
        if xid:
            _set_overlay_atoms(xid)
        try:
            atom = Gdk.Atom.intern("GAMESCOPE_EXTERNAL_OVERLAY", False)
            Gdk.property_change(
                gdk_win,
                atom,
                Gdk.Atom.intern("CARDINAL", False),
                32,
                Gdk.PropMode.REPLACE,
                [1],
            )
        except Exception:
            pass

    misses = {"gm": 0}

    def tick() -> bool:
        # Stay up across a brief /proc miss or gamescope restart. Quitting on
        # a single False is why PiP vanished a frame after join.
        if in_game_mode() or _display_is_gamescope(disp):
            misses["gm"] = 0
        else:
            misses["gm"] += 1
            if misses["gm"] >= 90:
                print("overlay: left Game Mode, quitting", flush=True)
                Gtk.main_quit()
                return False
        pip = _load(state_dir / "state.json")
        talk = _load(state_dir / "talking.json")
        bag["pip"] = pip
        bag["talk"] = talk
        if not pip.get("enabled") and not talk.get("enabled"):
            Gtk.main_quit()
            return False
        bag["stamp"] = stamp_box(pip) if pip.get("enabled") else (0, 0, 0, 0)
        frame = state_dir / "frame.jpg"
        try:
            mt = frame.stat().st_mtime
        except OSError:
            mt = -1.0
        if pip.get("enabled") and mt != bag["mtime"] and frame.is_file():
            try:
                bag["pixbuf"] = Gdk.pixbuf_new_from_file(str(frame))
                bag["mtime"] = mt
            except Exception:
                pass
        da.queue_draw()
        return True

    def on_map(_w) -> None:
        mark_overlay()
        pass_clicks()

    win.connect("map", on_map)
    win.connect("destroy", Gtk.main_quit)
    win.realize()
    mark_overlay()
    try:
        win.fullscreen()
    except Exception:
        pass
    win.show_all()
    mark_overlay()
    pass_clicks()
    GLib.timeout_add(33, tick)
    tick()
    print(f"overlay: display={disp} {sw}x{sh} gamescope", flush=True)
    Gtk.main()


if __name__ == "__main__":
    main()
