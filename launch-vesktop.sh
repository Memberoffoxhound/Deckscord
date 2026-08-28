#!/usr/bin/env bash
# Keep Vesktop running for Deckscord (Game Mode + Desktop).
set -euo pipefail

FLATPAK_ID="dev.vencord.Vesktop"
CDP_PORT="${DECKSCORD_CDP_PORT:-9222}"

export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-auto}"

# Only steal the Wayland display when we are actually inside Game Mode.
# gamescope-0 often exists during Desktop Mode too; attaching to it crashes Electron (SIGSEGV).
if [[ -n "${GAMESCOPE_WAYLAND_DISPLAY:-}" && -S "${XDG_RUNTIME_DIR}/${GAMESCOPE_WAYLAND_DISPLAY}" ]]; then
  export WAYLAND_DISPLAY="${GAMESCOPE_WAYLAND_DISPLAY}"
fi

flags=(
  --remote-debugging-port="${CDP_PORT}"
  --remote-allow-origins=*
)

if flatpak list --app 2>/dev/null | grep -qi "${FLATPAK_ID}"; then
  exec flatpak run "${FLATPAK_ID}" "${flags[@]}"
elif command -v vesktop >/dev/null 2>&1; then
  exec vesktop "${flags[@]}"
fi

echo "Vesktop not found" >&2
exit 1
