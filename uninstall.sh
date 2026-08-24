#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="${HOME}/homebrew/plugins/Deckscord"
DATA_DIR="${HOME}/.local/share/deckscord"
SERVICE_NAME="deckscord-vesktop.service"

echo "Deckscord uninstall"
echo

systemctl --user disable --now "${SERVICE_NAME}" 2>/dev/null || true
rm -f "${HOME}/.config/systemd/user/${SERVICE_NAME}"
systemctl --user daemon-reload 2>/dev/null || true

rm -rf "${PLUGIN_DIR}"
echo "Removed Decky plugin."

read -r -p "Also remove Vesktop Flatpak? [y/N] " reply
if [[ "${reply,,}" =~ ^y ]]; then
  flatpak uninstall -y --user dev.vencord.Vesktop 2>/dev/null || true
fi

rm -rf "${DATA_DIR}"
echo "Done. You may want to restart Decky / reboot into Game Mode."
