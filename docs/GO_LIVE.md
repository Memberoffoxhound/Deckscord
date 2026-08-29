# Share game — 720p Go Live from gamescope

Outbound share from a handheld in Game Mode. Viewers see the game through
Discord’s own encoder. This is not inbound call video.

## Default

| | |
|---|---|
| Video | Gamescope PipeWire node (same pixels Steam Game Recording uses) |
| Size | **1280×720** asked of Chromium; gamescope may already be that size |
| Encoder | Discord / Chromium VAAPI, **720p30** |
| Framerate on gamescope | **never 30/1** — the node advertises `0/1`; forcing 30fps kills it |
| Audio | The running game’s PipeWire output only |
| Required off | **Steam Game Recording** |

Share game and Game Recording both encode the same APU. Recording must be
off (Steam → Settings → Game Recording) before Share game starts.

## Pipe

```
gamescope Video/Source
        │  OpenPipeWireRemote (portal_shim.py)
        ▼
Vesktop getDisplayMedia  →  Discord WebRTC 720p30 VAAPI  →  viewers
```

Game Mode has no ScreenCast portal. `plugin/portal_shim.py` owns
`org.freedesktop.portal.Desktop` only while gamescope is the session
compositor, auto-approves Vesktop, and returns the `gamescope` node id.

Vesktop renders on X11 (`--ozone-platform=x11`) and lies
`XDG_SESSION_TYPE=wayland` + dummy `WAYLAND_DISPLAY` so Chromium takes the
PipeWire portal path.

Do not downsample in Deckscord. Do not run GStreamer, v4l2loopback, or a
second H.264 encode.

## QAM

Voice strip, while in a call:

- **Share game · 720p** — start
- **Stop sharing** — `STREAM_STOP`
- Button reads **Share game (recording on)** if Steam is already consuming
  the gamescope node; start then fails with the same instruction.
