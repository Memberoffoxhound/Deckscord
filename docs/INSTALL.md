# Install notes

Prefer:

```bash
curl -fsSL https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/install.sh | bash
```

From a git checkout (what you want while developing):

```bash
./install.sh --yes
```

`--yes` / `DECKSCORD_NONINTERACTIVE=1` skips the Continue prompt. Vesktop is still installed if missing — it is not optional.

## What must be present after install

| Path / unit | Role |
|---|---|
| Flatpak `dev.vencord.Vesktop` | Discord client |
| `~/.config/systemd/user/deckscord-vesktop.service` | Keeps Vesktop up, CDP on port 9222 |
| `~/homebrew/plugins/Deckscord/` | Decky plugin (`main.py`, `bridge.js`, `dist/index.js`) |

If the QAM tile is missing: Decky → Developer Mode, then reopen the QAM. `sudo systemctl restart plugin_loader` only if the plugin still does not appear.

## Updates (no sudo)

Older installs `chown`’d the plugin to root, which is why `update.sh` asked for a password. The plugin dir is now **yours**. After a one-time `sudo chown -R "$USER" ~/homebrew/plugins/Deckscord` if it is still root-owned:

```bash
./update.sh          # git pull + copy
./update.sh --local  # copy this working tree (uncommitted diffs too)
```

QAM → **Update from GitHub** git-pulls, shows a progress bar, copies files, then restarts Decky so the new plugin loads.

## First login

Vesktop must be logged in once (Desktop Mode is easiest). After that, Game Mode only needs the QAM plugin.
