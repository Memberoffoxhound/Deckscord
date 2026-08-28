# Deckscord

**Discord in Steam Game Mode**, in the Quick Access Menu. Voice calls and text chat without leaving a game. Inspired by the Xbox and PS5 Discord apps.

Repository: https://github.com/Memberoffoxhound/Deckscord

## What you get

- **Vesktop** (real Discord client) kept alive in Game Mode
- **Decky plugin** in the QAM:
  - **Voice** — servers, voice channels, join/leave, mute, deafen, who’s in the call
  - **Text** — servers / DMs, channel list, read messages, send messages
  - **Share game** — 720p 30 Go Live of the gamescope framebuffer + game audio (not the desktop, not speaker loopback)
  - **Watch** — large spectator overlay of a friend’s Go Live (game audio only while focused; party voice stays). Not Nintendo GameShare: we do not let you play a game you don’t own.
- Log in once. Session persists across Game Mode and reboot.

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

1. Game Mode → QAM → **Deckscord**.
2. Wait for the login QR (amber light: **Scan QR to log in**). Discord stays minimized in the background — the QAM is the UI.
3. Phone: Discord → **Scan QR Code**.
4. The light turns green (**Ready**). Voice + Text work from the QAM.

Steam keyboard in the QAM: **Steam + X**.

## Update (until it is on the Decky store)

`git pull` the repo and copy `plugin/` into Decky. No sudo, no Vesktop reinstall.

From a checkout:

```bash
./update.sh          # pull this clone, then copy
./update.sh --local  # copy working tree as-is (your diffs)
```

From anywhere:

```bash
curl -fsSL https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/update.sh | bash
```

Or from a previous install:

```bash
bash ~/.local/share/deckscord/update.sh
```

In Game Mode: QAM → Deckscord → **Update from GitHub**. Progress shows in the QAM; Decky restarts when the copy is done.

Once Deckscord is listed in the Decky Plugin Store, use the store’s Update button instead.

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
