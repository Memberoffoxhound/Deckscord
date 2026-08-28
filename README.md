# Deckscord

**Discord in Steam Game Mode**, in the Quick Access Menu. Voice calls and text chat without leaving a game. Inspired by the Xbox and PS5 Discord apps.

Repository: https://github.com/Memberoffoxhound/Deckscord

## What you get

- **Vesktop** (real Discord client) kept alive in Game Mode
- **Decky plugin** in the QAM:
  - **Voice** — servers, voice channels, join/leave, mute, deafen, who’s in the call
  - **Text** — servers / DMs, channel list, read messages, send messages
- Log in once. Session persists across Game Mode and reboot.

Speaking overlay, toasts, per-user volume, and screen share come after chat + calls are solid.

## Install (Desktop Mode terminal)

```bash
curl -fsSL https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/install.sh | bash
```

Or from a clone:

```bash
git clone https://github.com/Memberoffoxhound/Deckscord.git
cd Deckscord
chmod +x install.sh
./install.sh
```

The script **always** installs dependencies:

1. Vesktop from Flathub (not optional — this is Discord)
2. Wayland / PipeWire Flatpak overrides so mic and Game Mode audio work
3. systemd user service + linger
4. The Decky plugin (and Decky itself if missing)
5. Restarts plugin_loader

Sudo is used for linger, plugin install, and restarting Decky.

## First login

1. Desktop Mode: open **Vesktop** and log into Discord (QR or password).
2. Return to Game Mode.
3. QAM → **Deckscord**.
4. Voice tab to join a call. Text tab to chat.

Steam keyboard in the QAM: **Steam + X**.

## Uninstall

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/uninstall.sh)
```

## How it works

Vesktop runs with a localhost Chrome DevTools port. The Decky backend talks CDP into Vencord’s webpack helpers (`selectVoiceChannel`, `sendMessage`, stores). Nothing talks to Discord’s API with a user token.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- Bazzite (deck / HTPC) or SteamOS-like Gamescope + Decky
- x86_64, internet for the first Vesktop download
- Decky Loader (installer will set it up if missing)

## License

MIT
