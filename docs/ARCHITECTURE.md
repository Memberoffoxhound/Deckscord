# Deckscord Architecture

## High-level

```
┌─────────────────────┐     CDP / IPC      ┌──────────────────┐
│  Decky QAM UI       │◄──────────────────►│  Vesktop         │
│  (React / @decky)   │                    │  (Electron +     │
│  Voice / Text /     │                    │   Vencord)       │
│  Settings tabs      │                    └──────────────────┘
└──────────┬──────────┘                              ▲
           │ call()                                  │ managed by
           ▼                                         │
┌─────────────────────┐                     ┌────────┴─────────┐
│  main.py backend    │────────────────────►│ systemd user     │
│  (Python)           │  start/stop/status  │ deckscord-       │
│  volume, mute,      │                     │ vesktop.service  │
│  overlay flags,     │                     └──────────────────┘
│  toast emit         │
└─────────────────────┘
```

## Why Vesktop

- Real native Discord client (not a webview hack)
- Microphone and voice audio work without capture tricks
- Vencord plugins available if the user wants them
- Can be driven over Chrome DevTools Protocol for channel list, join, volume, etc.

## Persistence

- `systemctl --user` service + `loginctl enable-linger` so Discord stays up when the session goes into pure Game Mode / after reboot.
- Settings stored in `~/.local/share/deckscord/settings.json`.

## Overlay & notifications

- Speaking overlay can be a transparent Gamescope overlay or a Decky-injected HUD element.
- Toasts use Decky’s built-in toaster (`emit`).
- Join/leave events come from the CDP member-list stream.

## Screen share / PiP (nice-to-have)

Gamescope has limited portal support. Future work can follow the portal-shim approach used by other Game Mode Discord projects or fall back to window capture when in Desktop Mode.
