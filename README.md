# Deckscord

**Full Discord companion for SteamOS / Bazzite Game Mode.**

One-stop installer. Voice channels, text chats, per-user volume & mute, speaking overlay, toast notifications, join/leave alerts. Optional screen share. Runs natively through Vesktop so your mic and game audio just work. Decky Loader puts the whole thing in the Quick Access Menu.

Inspired by the PS5 and Xbox Discord implementations. Built for the Deck, Bazzite handhelds, and homemade Steam Machines.

Grandma-friendly. One script. Sudo only when needed. Persists through reboots.

Repository: https://github.com/Memberoffoxhound/Deckscord

## What this does

- Checks for and installs **Vesktop** (the reliable native Discord client for Linux/Game Mode) if it is missing
- Creates a systemd user service that keeps Discord alive and minimized in Game Mode across reboots
- Installs a **Decky Loader** plugin that surfaces everything in the Quick Access Menu (QAM)
- Gives you:
  - Full server / DM / channel list
  - Join and leave voice channels
  - Master + per-user input/output volume and local mute
  - Text chat with GIF / image / video support
  - Optional speaking overlay (who is talking right now)
  - Toast notifications that respect your Discord preferences
  - Notifications when someone joins or leaves the voice channel you are in
  - Nice-to-have: screen share + adjustable PiP windows for participant streams

Everything stays in Game Mode. No desktop window required after the first login.

## Quick Install (copy-paste)

Open a terminal in **Desktop Mode** and run:

```bash
curl -fsSL https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/install.sh | bash
```

Or download and inspect first:

```bash
curl -fsSL https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/install.sh -o install.sh
chmod +x install.sh
./install.sh
```

The script will:
1. Explain what it is doing and why
2. Detect SteamOS / Bazzite / Gamescope
3. Install Vesktop via Flatpak if needed
4. Set up the Game Mode systemd user service (with linger so it survives reboots)
5. Offer to install or verify Decky Loader
6. Drop the Deckscord plugin into `~/homebrew/plugins/`
7. Tell you exactly what to do next (scan QR / log in once, then stay in Game Mode forever)

After install, reboot into Game Mode (or just return to Game Mode). Open the QAM → Deckscord. First launch may show a QR code for login. After that it remembers your session.

## Requirements

- Bazzite (especially bazzite-deck / HTPC) or SteamOS / any modern Gamescope + Decky system
- x86_64
- Internet for the initial Vesktop download
- Decky Loader (the installer will help you get it if missing)

## First login

1. Return to Game Mode
2. Open Quick Access Menu → Deckscord
3. Scan the QR code with the Discord mobile app (Settings → Scan QR Code) or log in with the on-screen keyboard
4. Done. Your session persists.

## Controls (QAM)

- **Voice** tab — servers, channels, members, join/leave, per-user volume slider (0–200%) + local mute
- **Text** tab — channels, messages, send text / GIF / image / video
- **Settings** — overlay toggle, notification preferences, audio devices, screen-share options

## Uninstall

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/uninstall.sh)
```

Or from the local copy:

```bash
~/.local/share/deckscord/uninstall.sh
```

## Status

- [x] One-stop Bazzite / SteamOS installer
- [x] Vesktop auto-install + Game Mode systemd service + linger
- [x] Decky plugin skeleton with Voice / Text / Settings tabs
- [x] Per-user volume + local mute hooks
- [x] Speaking overlay toggle
- [x] Toast + join/leave voice notifications
- [ ] Full CDP-driven rich client (in progress — architecture matches proven Vesktop + CDP approach)
- [ ] Native Go Live screen share + PiP (nice-to-have)

## Architecture notes

Deckscord drives **Vesktop** (a real Electron Discord client with Vencord) over the Chrome DevTools Protocol. The Decky frontend talks to a small Python backend that owns the Vesktop process and injects the control surface. This is the same high-level approach used by the best existing Game Mode Discord plugins, but under your name and with a single-command installer that matches the GameModeLEDs / Dialdeck style.

## License

MIT

Built for the Bazzite / Universal Blue / SteamOS community.
