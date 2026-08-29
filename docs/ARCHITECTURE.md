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

## Chat + voice

`bridge.js` is injected once per CDP session and uses `Vencord.Webpack`:

| Action | Module |
|---|---|
| Join / leave voice | `selectVoiceChannel` |
| Mute / deafen | `toggleSelfMute` / `toggleSelfDeaf` |
| Snapshot (guilds, channels, members) | `GuildStore`, `ChannelStore`, `VoiceStateStore`, `UserStore` |
| Read messages | `MessageStore.getMessages` |
| Send message | `sendMessage` |

The Python backend is stdlib-only (asyncio + a tiny WebSocket client). No pip packages.

Deckscord is chat, voice, and **outbound Share game**. There is no inbound live-video viewer and no WebRTC hub.

Share game (Game Mode): `portal_shim.py` owns `org.freedesktop.portal.Desktop` and hands Vesktop the gamescope PipeWire node (`OpenPipeWireRemote`). Discord encodes 720p. Steam Game Recording must be off. Do not ask gamescope for a size or framerate — native DMA-BUF, `0/1` fps. Asking 1280×720 or 30/1 aborts gamescope in `destroy_buffer`.

## Persistence

- `systemctl --user enable --now deckscord-vesktop.service`
- `loginctl enable-linger` so it survives Game Mode / reboot
- Discord session lives in Vesktop’s Flatpak config

## Who's talking

An opt-in gamescope overlay (`plugin/pip_overlay.py`) draws avatar + name over the game while that person speaks. Overlay is Game Mode only (gamescope Xwayland, input-empty, `GAMESCOPE_EXTERNAL_OVERLAY` before map) so it cannot cover SDDM/KWin or steal the Steam QAM. Settings tree: [SETTINGS.md](SETTINGS.md).
