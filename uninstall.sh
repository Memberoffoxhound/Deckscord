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

if [[ -d "${PLUGIN_DIR}" ]]; then
  if sudo -n true 2>/dev/null; then
    sudo rm -rf "${PLUGIN_DIR}"
  else
    sudo rm -rf "${PLUGIN_DIR}"
  fi
  echo "Removed Decky plugin."
fi

sudo systemctl restart plugin_loader 2>/dev/null || true

read -r -p "Also remove Vesktop Flatpak? [y/N] " reply || true
if [[ "${reply,,}" =~ ^y ]]; then
  flatpak uninstall -y --user dev.vencord.Vesktop 2>/dev/null || sudo flatpak uninstall -y dev.vencord.Vesktop 2>/dev/null || true
fi

rm -rf "${DATA_DIR}"
echo "Done. Reboot into Game Mode or restart Decky if the QAM tile is still listed."
