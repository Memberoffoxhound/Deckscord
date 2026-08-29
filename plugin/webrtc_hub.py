#!/usr/bin/env python3
"""Local WebRTC signaling + viewer pages for Deckscord inbound video.

Discord already decoded the remote streams. This process is only the
localhost signaling board and the HTML the PiP / QAM subscribers load.
Bind 127.0.0.1 only. Pin to a high-numbered CPU so the game keeps 0–3.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

for _k in (
    "LD_LIBRARY_PATH",
    "PYTHONPATH",
    "PYTHONHOME",
    "_PYI_APPLICATION_HOME_DIR",
    "_PYI_PARENT_PROCESS_LEVEL",
    "_PYI_LINUX_PROCESS_NAME",
):
    os.environ.pop(_k, None)

PORT_DEFAULT = 18765
HOST = "127.0.0.1"


def _data_dir() -> Path:
    home = Path(os.environ.get("HOME") or Path.home())
    d = home / ".local" / "share" / "deckscord"
    d.mkdir(parents=True, exist_ok=True)
    return d


def pin_core() -> int:
    n = os.cpu_count() or 4
    core = max(0, n - 1)
    try:
        os.sched_setaffinity(0, {core})
    except Exception:
        pass
    return core


class Rooms:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.rooms: dict[str, dict] = {}
        self.frames: dict[str, bytes] = {}

    def room(self, name: str) -> dict:
        r = self.rooms.get(name)
        if r is None:
            r = {
                "offer": None,
                "answer": None,
                "pub_ice": [],
                "sub_ice": [],
                "tracks": [],
                "gen": 0,
                "ts": 0.0,
            }
            self.rooms[name] = r
        return r

    def put_offer(self, name: str, sdp: str, tracks: list) -> dict:
        with self.lock:
            r = self.room(name)
            r["offer"] = sdp
            r["tracks"] = tracks if isinstance(tracks, list) else []
            r["answer"] = None
            r["pub_ice"] = []
            r["sub_ice"] = []
            r["gen"] = int(r["gen"]) + 1
            r["ts"] = time.time()
            return {"ok": True, "gen": r["gen"]}

    def get_offer(self, name: str) -> dict:
        with self.lock:
            r = self.room(name)
            if not r.get("offer"):
                return {"ok": True, "empty": True}
            return {
                "ok": True,
                "sdp": r["offer"],
                "tracks": r.get("tracks") or [],
                "gen": r["gen"],
                "ts": r["ts"],
            }

    def put_answer(self, name: str, sdp: str) -> dict:
        with self.lock:
            r = self.room(name)
            r["answer"] = sdp
            r["sub_ice"] = []
            r["ts"] = time.time()
            return {"ok": True, "gen": r["gen"]}

    def get_answer(self, name: str) -> dict:
        with self.lock:
            r = self.room(name)
            if not r.get("answer"):
                return {"ok": True, "empty": True}
            return {"ok": True, "sdp": r["answer"], "gen": r["gen"]}

    def add_ice(self, name: str, side: str, cand: dict) -> dict:
        key = "pub_ice" if side == "pub" else "sub_ice"
        with self.lock:
            r = self.room(name)
            r[key].append(cand)
            return {"ok": True, "n": len(r[key])}

    def get_ice(self, name: str, side: str, n: int) -> dict:
        key = "pub_ice" if side == "pub" else "sub_ice"
        with self.lock:
            r = self.room(name)
            bag = r[key]
            return {"ok": True, "candidates": bag[n:], "n": len(bag), "gen": r["gen"]}

    def put_frame(self, key: str, data: bytes) -> None:
        with self.lock:
            self.frames[key] = data

    def get_frame(self, key: str) -> bytes | None:
        with self.lock:
            return self.frames.get(key)


ROOMS = Rooms()

PIP_HTML = r"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Deckscord PiP</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:100%;height:100%;}
  video{width:100%;height:100%;object-fit:contain;background:#000;display:block;}
  #cap{position:fixed;left:6px;bottom:4px;color:#fff;font:700 12px/1.2 sans-serif;
       text-shadow:0 1px 3px #000;pointer-events:none;opacity:.9}
</style>
</head>
<body>
<video id="v" autoplay playsinline muted></video>
<div id="cap"></div>
<script>
(function(){
  var room = (new URLSearchParams(location.search).get("room")) || "pip";
  var cap = document.getElementById("cap");
  var video = document.getElementById("v");
  var pc = null;
  var appliedGen = -1;
  var iceN = 0;
  var iceServers = [];
  function api(path, body){
    var opt = {headers: {"Content-Type": "application/json"}};
    if (body !== undefined){ opt.method = "POST"; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function(r){ return r.json(); });
  }
  function attach(ev){
    var s = ev.streams && ev.streams[0];
    if (s) video.srcObject = s;
    else {
      var ms = video.srcObject;
      if (!ms || !ms.addTrack) { ms = new MediaStream(); video.srcObject = ms; }
      if (ev.track) ms.addTrack(ev.track);
    }
    video.play && video.play().catch(function(){});
  }
  function ensurePc(){
    if (pc) return pc;
    pc = new RTCPeerConnection({iceServers: iceServers, bundlePolicy: "max-bundle"});
    pc.ontrack = attach;
    pc.onicecandidate = function(ev){
      if (!ev.candidate) return;
      api("/room/"+room+"/ice/sub", {
        candidate: ev.candidate.candidate,
        sdpMid: ev.candidate.sdpMid,
        sdpMLineIndex: ev.candidate.sdpMLineIndex
      }).catch(function(){});
    };
    return pc;
  }
  async function tick(){
    try {
      var off = await api("/room/"+room+"/offer");
      if (off && off.sdp && off.gen !== appliedGen){
        var p = ensurePc();
        await p.setRemoteDescription({type:"offer", sdp: off.sdp});
        var ans = await p.createAnswer();
        await p.setLocalDescription(ans);
        await api("/room/"+room+"/answer", {sdp: ans.sdp});
        appliedGen = off.gen;
        iceN = 0;
        var names = (off.tracks || []).map(function(t){ return t.name || t.userId; }).filter(Boolean);
        cap.textContent = names[0] || "";
      }
      if (pc){
        var ice = await api("/room/"+room+"/ice/pub?n="+iceN);
        (ice.candidates || []).forEach(function(c){
          if (!c || !c.candidate) return;
          pc.addIceCandidate(c).catch(function(){});
        });
        iceN = ice.n || iceN;
      }
    } catch (e) {}
    setTimeout(tick, 250);
  }
  tick();
})();
</script>
</body>
</html>
"""

TILES_HTML = r"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Deckscord Tiles</title>
<style>
  html,body{margin:0;padding:0;background:#000;color:#fff;font:13px sans-serif;}
  .t{position:relative;width:100%;aspect-ratio:16/9;background:#000;margin:0 0 6px;overflow:hidden;}
  video{width:100%;height:100%;object-fit:contain;display:block;background:#000;}
  .n{position:absolute;left:6px;top:6px;text-shadow:0 1px 3px #000;opacity:.9}
</style>
</head>
<body>
<div id="root"></div>
<script>
(function(){
  var room = (new URLSearchParams(location.search).get("room")) || "qam";
  var root = document.getElementById("root");
  var pc = null, appliedGen = -1, iceN = 0, meta = [];
  function api(path, body){
    var opt = {headers: {"Content-Type": "application/json"}};
    if (body !== undefined){ opt.method = "POST"; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function(r){ return r.json(); });
  }
  function boxFor(t){
    var id = "v-"+t.userId+"-"+(t.kind||"camera");
    var el = document.getElementById(id);
    if (el) return el;
    var wrap = document.createElement("div");
    wrap.className = "t";
    var v = document.createElement("video");
    v.id = id; v.autoplay = true; v.muted = true; v.playsInline = true;
    var n = document.createElement("div");
    n.className = "n"; n.textContent = t.name || "";
    wrap.appendChild(v); wrap.appendChild(n); root.appendChild(wrap);
    return v;
  }
  function ensurePc(){
    if (pc) return pc;
    pc = new RTCPeerConnection({iceServers: [], bundlePolicy: "max-bundle"});
    pc.ontrack = function(ev){
      var mid = ev.transceiver && ev.transceiver.mid;
      var hit = null;
      for (var i=0;i<meta.length;i++){
        if (String(meta[i].mid) === String(mid) || String(meta[i].order) === String(ev.transceiver&&ev.transceiver.sender?i:i)) hit = meta[i];
      }
      if (!hit && meta.length === 1) hit = meta[0];
      if (!hit) hit = {userId: "x", kind: "screenshare", name: ""};
      var v = boxFor(hit);
      var s = ev.streams && ev.streams[0];
      if (s) v.srcObject = s;
      else {
        var ms = new MediaStream();
        if (ev.track) ms.addTrack(ev.track);
        v.srcObject = ms;
      }
      v.play && v.play().catch(function(){});
    };
    pc.onicecandidate = function(ev){
      if (!ev.candidate) return;
      api("/room/"+room+"/ice/sub", {
        candidate: ev.candidate.candidate,
        sdpMid: ev.candidate.sdpMid,
        sdpMLineIndex: ev.candidate.sdpMLineIndex
      }).catch(function(){});
    };
    return pc;
  }
  async function tick(){
    try {
      var off = await api("/room/"+room+"/offer");
      if (off && off.sdp && off.gen !== appliedGen){
        meta = off.tracks || [];
        var p = ensurePc();
        await p.setRemoteDescription({type:"offer", sdp: off.sdp});
        var ans = await p.createAnswer();
        await p.setLocalDescription(ans);
        await api("/room/"+room+"/answer", {sdp: ans.sdp});
        appliedGen = off.gen; iceN = 0;
      }
      if (pc){
        var ice = await api("/room/"+room+"/ice/pub?n="+iceN);
        (ice.candidates || []).forEach(function(c){ if (c && c.candidate) pc.addIceCandidate(c).catch(function(){}); });
        iceN = ice.n || iceN;
      }
    } catch (e) {}
    setTimeout(tick, 280);
  }
  tick();
})();
</script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("hub: " + (fmt % args) + "\n")

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")

    def _json(self, code: int, obj: dict) -> None:
        raw = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _bytes(self, code: int, data: bytes, mime: str) -> None:
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        raw = self.rfile.read(n)
        try:
            obj = json.loads(raw.decode() or "{}")
            return obj if isinstance(obj, dict) else {}
        except Exception:
            return {}

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        u = urlparse(self.path)
        path = u.path.rstrip("/") or "/"
        q = parse_qs(u.query)
        if path in ("/", "/health"):
            self._json(200, {"ok": True, "service": "deckscord-webrtc", "ts": time.time()})
            return
        if path == "/pip.html" or path == "/pip":
            self._bytes(200, PIP_HTML.encode(), "text/html; charset=utf-8")
            return
        if path == "/tiles.html" or path == "/tiles":
            self._bytes(200, TILES_HTML.encode(), "text/html; charset=utf-8")
            return
        if path.startswith("/room/") and path.endswith("/offer"):
            name = path.split("/")[2]
            self._json(200, ROOMS.get_offer(name))
            return
        if path.startswith("/room/") and path.endswith("/answer"):
            name = path.split("/")[2]
            self._json(200, ROOMS.get_answer(name))
            return
        if path.startswith("/room/") and "/ice/" in path:
            parts = path.split("/")
            # /room/{name}/ice/{pub|sub}
            if len(parts) >= 5:
                name, side = parts[2], parts[4]
                n = 0
                try:
                    n = int((q.get("n") or ["0"])[0])
                except Exception:
                    n = 0
                self._json(200, ROOMS.get_ice(name, "pub" if side == "pub" else "sub", n))
                return
        if path.startswith("/frame/"):
            key = path.split("/", 2)[-1]
            data = ROOMS.get_frame(key)
            if not data:
                self._json(404, {"ok": False, "error": "no frame"})
                return
            self._bytes(200, data, "image/jpeg")
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        u = urlparse(self.path)
        path = u.path.rstrip("/") or "/"
        if path.startswith("/room/") and path.endswith("/offer"):
            name = path.split("/")[2]
            body = self._read_json()
            self._json(200, ROOMS.put_offer(name, str(body.get("sdp") or ""), body.get("tracks") or []))
            return
        if path.startswith("/room/") and path.endswith("/answer"):
            name = path.split("/")[2]
            body = self._read_json()
            self._json(200, ROOMS.put_answer(name, str(body.get("sdp") or "")))
            return
        if path.startswith("/room/") and "/ice/" in path:
            parts = path.split("/")
            if len(parts) >= 5:
                name, side = parts[2], parts[4]
                body = self._read_json()
                self._json(200, ROOMS.add_ice(name, "pub" if side == "pub" else "sub", body))
                return
        if path.startswith("/frame/"):
            key = path.split("/", 2)[-1]
            n = int(self.headers.get("Content-Length") or 0)
            data = self.rfile.read(n) if n > 0 else b""
            if data:
                ROOMS.put_frame(key, data)
            self._json(200, {"ok": True, "bytes": len(data)})
            return
        self._json(404, {"ok": False, "error": "not found"})


def bind_server() -> tuple[ThreadingHTTPServer, int]:
    last = None
    for port in range(PORT_DEFAULT, PORT_DEFAULT + 12):
        try:
            httpd = ThreadingHTTPServer((HOST, port), Handler)
            httpd.daemon_threads = True
            return httpd, port
        except OSError as e:
            last = e
            continue
    raise SystemExit(f"webrtc hub: no free port: {last}")


def main() -> int:
    core = pin_core()
    httpd, port = bind_server()
    path = _data_dir() / "webrtc.port"
    path.write_text(str(port), encoding="utf-8")
    print(f"hub: http://{HOST}:{port} core={core}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            httpd.server_close()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
