#!/usr/bin/env bash
# Keep Vesktop running for Deckscord (Game Mode + Desktop).
#
# Electron SIGSEGVs on gamescope's Wayland socket. This process always
# prefers X11/Xwayland and starts minimized — the QAM is the UI.
set -euo pipefail

FLATPAK_ID="dev.vencord.Vesktop"
CDP_PORT="${DECKSCORD_CDP_PORT:-9222}"

x11_socket_for() {
  local d="$1"
  local n="${d#:}"
  n="${n%%.*}"
  [[ -S "/tmp/.X11-unix/X${n}" ]]
}

pick_display() {
  if [[ -n "${DISPLAY:-}" ]] && x11_socket_for "${DISPLAY}"; then
    printf '%s' "${DISPLAY}"
    return 0
  fi
  local n
  for n in 0 1 2 3; do
    if [[ -S "/tmp/.X11-unix/X${n}" ]]; then
      printf ':%s' "${n}"
      return 0
    fi
  done
  return 1
}

# Drop gamescope Wayland even if we later fall back to a desktop compositor.
if [[ -n "${GAMESCOPE_WAYLAND_DISPLAY:-}" ]] || [[ "${WAYLAND_DISPLAY:-}" == gamescope-* ]]; then
  unset WAYLAND_DISPLAY
  unset GAMESCOPE_WAYLAND_DISPLAY
fi

flags=(
  --remote-debugging-port="${CDP_PORT}"
  --remote-allow-origins=*
)

flatpak_extra=()
# Never let Discord's "default" capture follow a speaker monitor.
pick_mic_source() {
  command -v pactl >/dev/null 2>&1 || return 1
  local name
  while read -r _ name _; do
    [[ -z "${name:-}" ]] && continue
    [[ "${name}" == *.monitor ]] && continue
    [[ "${name,,}" == *monitor* ]] && continue
    [[ "${name,,}" == *loopback* ]] && continue
    [[ "${name,,}" == *vencord-screen-share* ]] && continue
    [[ "${name,,}" == *venmic* ]] && continue
    [[ "${name,,}" == *screen-share* || "${name,,}" == *screenshare* ]] && continue
    [[ "${name,,}" == *desktop*audio* || "${name,,}" == *system*audio* ]] && continue
    [[ "${name}" == alsa_output* || "${name}" == bluez_output* ]] && continue
    [[ "${name}" == deckscord.mic ]] && continue
    printf '%s' "${name}"
    return 0
  done < <(pactl list short sources 2>/dev/null || true)
  return 1
}

if MIC_SRC="$(pick_mic_source)"; then
  export PULSE_SOURCE="${MIC_SRC}"
  pactl set-default-source "${MIC_SRC}" 2>/dev/null || true
  flatpak_extra+=(--env=PULSE_SOURCE="${MIC_SRC}")
fi

if DISPLAY_VAL="$(pick_display)"; then
  export DISPLAY="${DISPLAY_VAL}"
  unset WAYLAND_DISPLAY
  unset GAMESCOPE_WAYLAND_DISPLAY
  export ELECTRON_OZONE_PLATFORM_HINT=x11
  export GDK_BACKEND=x11
  flags+=(--ozone-platform=x11)
  flatpak_extra+=(
    --socket=x11
    --nosocket=wayland
    --env=DISPLAY="${DISPLAY}"
    --env=WAYLAND_DISPLAY=
    --env=ELECTRON_OZONE_PLATFORM_HINT=x11
  )
else
  export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-auto}"
fi

if flatpak list --app 2>/dev/null | grep -qi "${FLATPAK_ID}"; then
  exec flatpak run "${flatpak_extra[@]}" "${FLATPAK_ID}" "${flags[@]}"
elif command -v vesktop >/dev/null 2>&1; then
  exec vesktop "${flags[@]}"
fi

echo "Vesktop not found" >&2
exit 1
