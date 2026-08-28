# Deckscord Architecture

```
┌──────────────────────┐   call("join_voice")    ┌─────────────────────┐
│  Decky QAM           │   call("send_message")  │  plugin/main.py     │
│  Voice / Text        │◄───────────────────────►│  CDP client         │
└──────────────────────┘                         └──────────┬──────────┘
                                                            │ ws://127.0.0.1:9222
                                                            ▼
                                                 ┌─────────────────────┐
                                                 │  Vesktop            │
                                                 │  (Electron+Vencord) │
                                                 │  Discord renderer   │
                                                 │  plugin/bridge.js   │
                                                 └──────────┬──────────┘
                                                            │
                                                 systemd --user
                                                 deckscord-vesktop.service
```

## Why Vesktop

Official Discord’s Flatpak overlay does not work as a Game Mode companion. Vesktop is a native client with working mic/speakers under PipeWire, Vencord already loaded, and a stable Electron debugger port.

## Chat + calls (current)

`bridge.js` is injected once per CDP session and uses `Vencord.Webpack`:

| Action | Module |
|---|---|
| Join / leave voice | `selectVoiceChannel` |
| Mute / deafen | `toggleSelfMute` / `toggleSelfDeaf` |
| Snapshot (guilds, channels, members) | `GuildStore`, `ChannelStore`, `VoiceStateStore`, `UserStore` |
| Read messages | `MessageStore.getMessages` |
| Send message | `sendMessage` |

The Python backend is stdlib-only (asyncio + a tiny WebSocket client). No pip packages.

## Persistence

- `systemctl --user enable --now deckscord-vesktop.service`
- `loginctl enable-linger` so it survives Game Mode / reboot
- Discord session lives in Vesktop’s Flatpak config

## Later

QAM live video copies JPEG tiles from Discord’s media engine after `STREAM_WATCH` (the actual Go Live/camera tracks), not from a screenshot of the Vesktop window. Call audio stays in PipeWire. Vesktop stays minimized unless a camera has no pixels yet.

Outbound **Share game** is a different pipe: gamescope’s PipeWire node → ScreenCast portal shim → Discord’s own 720p30 encoder. Documented in [GO_LIVE.md](GO_LIVE.md). Self screenshare is not JPEG-copied back into the QAM.
