# Cheap Go Live — game screen + game audio, 720p30

Outbound share from a handheld (Bazzite / SteamOS Game Mode) to Discord
viewers. This is **not** the QAM JPEG path in `LIVE_VIDEO.md`. That path copies
*inbound* tiles for the 400px overlay. This path publishes *our* game.

## Default

| | |
|---|---|
| Video | Gamescope PipeWire node (the game framebuffer Steam Game Recording already publishes) |
| Size / rate | **1280×720 @ 30 fps** (Discord encoder constraint, not a second transcode) |
| Audio | The running game’s PipeWire output only |
| Encoder | Discord / Chromium (VAAPI H.264 on AMD) |
| Not captured | QAM, desktop, Vesktop, speaker monitor, other call participants |

720p30 is the handheld default because it is Discord’s non-Nitro Go Live cap
and because 1080p60 is roughly 8× the encode cost (4× pixels × 2× frames) on
the same APU that is already drawing the game.

## Why not the other pipes

| Approach | Why we don’t |
|---|---|
| QAM JPEG of self | CPU copies, ~1 fps, viewers never see it |
| Discord window / X11 share | Vesktop is X11-on-Xwayland and gamescope is a different compositor → black |
| Whole-desktop portal (KDE) | Includes QAM, desktop, other windows |
| GStreamer `vaapih264enc` + v4l2loopback | Second encode, extra copies, kernel module |
| Default sink `.monitor` as stream audio | Re-broadcasts Discord + Steam UI (the loopback bug we just fixed on the mic) |

The cheap pipe is: **zero extra capture compositor, one encode, Discord’s**.

```
 gamescope  ──PipeWire Video/Source──►  ScreenCast portal
                                                   │
                                                   ▼
                                     Vesktop getDisplayMedia
                                     MediaEngine.getDesktopSource
                                     STREAM_START { sourceId }
                                                   │
                                                   ▼
                                     Discord WebRTC  720p30 VAAPI
                                                   │
                                                   ▼
                                              viewers

 game output node ──► (Vesktop audio picker, game only)
                      never HDMI/default *.monitor
 mic ──► voice  (unchanged; still not a monitor)
```

## Video

Gamescope already exports a PipeWire node (same one Steam Game Recording
uses). In Game Mode there is **no** xdg-desktop-portal backend, which is why
stock Discord Go Live is a black screen.

`plugin/portal_shim.py` owns `org.freedesktop.portal.Desktop` **only while a
gamescope session is the active session** and answers ScreenCast v2 with that
node. It auto-approves Vesktop/Vencord and refuses everyone else. In Desktop
Mode it releases the name so KWin’s portal keeps working.

Chromium then reads DMA-BUF frames from PipeWire. We do not convert, scale, or
JPEG them. Resolution/FPS are handed to Discord as capture constraints
(`getDesktopSource({ width: 1280, height: 720, frameRate: 30 })` plus
Vesktop `screenshareQuality: { resolution: "720", frameRate: "30" }`).
Changing the setting does not re-encode an in-flight share; it applies to the
next start.

Optional later (not required for v1): gamescope
`--pipewire-width=1280 --pipewire-height=720` so the compositor downscales
before we even see the node. That needs a gamescope-session hook, not Discord.

## Audio

Two tracks, never mixed:

| Track | Source |
|---|---|
| Voice | Real microphone (never `*.monitor`) |
| Stream | The game’s `Stream/Output/Audio` PipeWire node, picked in Vesktop’s share modal |

The QAM auto-confirms Vesktop’s hidden picker for shares **we** started, but
it will **not** tick “Entire system”. It ticks application rows that look like
the game (skips vesktop / discord / chrome / steamwebhelper / plasma). If it
cannot tell, it shares video only rather than leaking call audio.

## QAM

Voice strip, while in a call:

- **Share game** — start 720p30
- **Stop sharing** — `STREAM_STOP`

We do **not** JPEG-copy our own outbound screenshare back into the QAM. You
are looking at the game. A LIVE state on the toggle is enough. Other people’s
cameras / Go Lives still use the inbound JPEG ladder.

## Cost on the handheld

| State | Extra work |
|---|---|
| Voice only | Opus + AEC (small) |
| Viewing someone else’s stream | Discord decode; QAM JPEG is a few kb/s on top |
| **Sharing our game 720p30** | One VAAPI H.264 encode at 1280×720 30 fps + PipeWire copies gamescope already does for recording |

No software x264, no GStreamer, no v4l2loopback, no extra 1080p scaler.

## Failure modes

| Symptom | Likely cause |
|---|---|
| Black for viewers, LIVE in QAM | `STREAM_START` without `getDesktopSource` (Discord ≥ 2026-07) |
| Black in Game Mode, works on desktop | Portal shim not owning the name / gamescope node missing |
| Viewers hear the call twice | Stream audio fell back to default sink monitor — refuse that |
| Share button dies after stop→start | getDisplayMedia modal never auto-clicked; wait ≥1.2 s after stop |
| Other apps lose portal in Game Mode | Shim holds the session-wide portal name; it must step aside in Desktop |

## Out of scope

- 1080p60 / source quality picker (add later; same pipe, different constraint)
- Camera
- Sharing a desktop window
- Re-encoding through GStreamer “to save CPU” (it does the opposite)
