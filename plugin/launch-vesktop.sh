#!/usr/bin/env bash
# Keep Vesktop running for Deckscord (Game Mode + Desktop).
#
# Render on X11/Xwayland — Electron SIGSEGVs on gamescope's Wayland socket.
# Capture is a different path: Chromium only talks to our ScreenCast portal
# (portal_shim.py → gamescope PipeWire node) when it thinks it is on Wayland.
# Deckcord/Steamcord use this split: --ozone-platform=x11 for the window,
# XDG_SESSION_TYPE=wayland + WAYLAND_DISPLAY for getDisplayMedia.
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

# Never render on gamescope's Wayland socket (Electron SIGSEGV). Capture
# still gets a dummy WAYLAND_DISPLAY later so Chromium uses the portal.
if [[ -n "${GAMESCOPE_WAYLAND_DISPLAY:-}" ]] || [[ "${WAYLAND_DISPLAY:-}" == gamescope-* ]]; then
  unset WAYLAND_DISPLAY
  unset GAMESCOPE_WAYLAND_DISPLAY
fi

in_gamescope=false
if { pgrep -x gamescope >/dev/null 2>&1 || pgrep -x gamescope-wl >/dev/null 2>&1; } \
  && ! pgrep -x kwin_wayland >/dev/null 2>&1 \
  && ! pgrep -x kwin_x11 >/dev/null 2>&1; then
  in_gamescope=true
fi

flags=(
  --remote-debugging-port="${CDP_PORT}"
  --remote-allow-origins=*
  --enable-features=WebRTCPipeWireCapturer
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
  unset GAMESCOPE_WAYLAND_DISPLAY
  export ELECTRON_OZONE_PLATFORM_HINT=x11
  export GDK_BACKEND=x11
  flags+=(--ozone-platform=x11)
  flatpak_extra+=(
    --socket=x11
    --nosocket=wayland
    --talk-name=org.freedesktop.portal.Desktop
    --filesystem=xdg-run/pipewire-0:ro
    --env=DISPLAY="${DISPLAY}"
    --env=ELECTRON_OZONE_PLATFORM_HINT=x11
    --env=GDK_BACKEND=x11
  )
  if [[ "${in_gamescope}" == true ]]; then
    # Dummy name is enough for Chromium IsRunningUnderWayland. Do not point
    # this at gamescope-* or ozone would try to render there.
    export XDG_SESSION_TYPE=wayland
    export WAYLAND_DISPLAY=wayland-0
    flatpak_extra+=(
      --env=XDG_SESSION_TYPE=wayland
      --env=WAYLAND_DISPLAY=wayland-0
    )
  else
    unset WAYLAND_DISPLAY
    export XDG_SESSION_TYPE="${XDG_SESSION_TYPE:-x11}"
    flatpak_extra+=(
      --env=WAYLAND_DISPLAY=
      --env=XDG_SESSION_TYPE="${XDG_SESSION_TYPE}"
    )
  fi
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
