#!/usr/bin/env bash
# Re-pull Deckscord from GitHub and re-run the installer.
# Until the plugin is on the Decky store, this is the update path.
#
#   curl -fsSL https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/update.sh | bash
#
if [ -z "${BASH_VERSION:-}" ]; then
  echo "Deckscord updater needs bash (not sh/dash)." >&2
  echo "  curl -fsSL https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/update.sh | bash" >&2
  exit 1
fi
set +o posix 2>/dev/null || true
set -euo pipefail

INSTALL_URL="${DECKSCORD_INSTALL_URL:-https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/install.sh}"

echo "Deckscord update — fetching installer from GitHub…"
export DECKSCORD_NONINTERACTIVE=1
curl -fsSL "${INSTALL_URL}" | bash -s -- --yes
