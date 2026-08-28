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

Speaking overlay, join/leave toasts, per-user volume, screen share / PiP. Those wait until Voice + Text stay up in Game Mode.
