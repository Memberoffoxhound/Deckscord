# Manual install notes

Prefer the one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/install.sh | bash
```

If you want to install only the Decky plugin (Vesktop already running):

1. Enable Developer Mode in Decky → General.
2. Developer → Install Plugin from URL (or copy the `plugin/` folder into `~/homebrew/plugins/Deckscord`).
3. Restart the plugin loader.

The plugin expects the `deckscord-vesktop.service` user unit (created by `install.sh`) to keep Vesktop alive.
