#!/usr/bin/env bash
# Hidden Chrome Discord engine for Deckscord.
set -euo pipefail
unset LD_PRELOAD LD_PRELOAD_32 LD_PRELOAD_64

FLATPAK_ID="com.google.Chrome"
CDP_PORT="${DECKSCORD_CDP_PORT:-9222}"
PROFILE="${HOME}/.var/app/com.google.Chrome/config/deckscord-profile"
LOG="${HOME}/.local/share/deckscord/chrome-launch.log"
mkdir -p "${PROFILE}" "$(dirname "${LOG}")"

x11_socket_for() {
  local n="${1#:}"; n="${n%%.*}"
  [[ -S "/tmp/.X11-unix/X${n}" ]]
}

pick_display() {
  # Gamescope :0 is overlay (Chromium SIGTRAPs). Steam apps use :1.
  if [[ -n "${DISPLAY:-}" && "${DISPLAY}" != :0 && "${DISPLAY}" != :0.0 ]] && x11_socket_for "${DISPLAY}"; then
    printf '%s' "${DISPLAY}"; return 0
  fi
  if x11_socket_for ":1"; then printf ':1'; return 0; fi
  if [[ -n "${DISPLAY:-}" ]] && x11_socket_for "${DISPLAY}"; then
    printf '%s' "${DISPLAY}"; return 0
  fi
  local n
  for n in 1 2 3 0; do
    [[ -S "/tmp/.X11-unix/X${n}" ]] && { printf ':%s' "${n}"; return 0; }
  done
  return 1
}

unset WAYLAND_DISPLAY GAMESCOPE_WAYLAND_DISPLAY
DISPLAY_VAL="$(pick_display)" || { echo "no X11 display" >>"${LOG}"; exit 1; }
export DISPLAY="${DISPLAY_VAL}"

in_gamescope=false
if { pgrep -x gamescope >/dev/null 2>&1 || pgrep -x gamescope-wl >/dev/null 2>&1; } \
  && ! pgrep -x kwin_wayland >/dev/null 2>&1 && ! pgrep -x kwin_x11 >/dev/null 2>&1; then
  in_gamescope=true
fi

flags=(
  --user-data-dir="${PROFILE}"
  --class=deckscord
  --app=https://discord.com/app
  --remote-debugging-port="${CDP_PORT}"
  --remote-allow-origins=*
  --no-first-run
  --ozone-platform=x11
  --no-sandbox
  --disable-gpu-sandbox
  --window-size=960,540
)
if [[ "${in_gamescope}" == true ]]; then
  flags+=(--force-device-scale-factor=1)
  (
    disp="${DISPLAY}"
    while sleep 2; do
      DISPLAY="${disp}" xdotool search --class deckscord windowsize 960 540 windowmove 8000 8000 >/dev/null 2>&1 || true
    done
  ) &
  disown || true
fi

{
  echo "---- $(date -Iseconds) DISPLAY=${DISPLAY} gamescope=${in_gamescope}"
} >>"${LOG}"

cleanup() {
  pkill -f -- "--user-data-dir=${PROFILE}" >/dev/null 2>&1 || true
  rm -f "${PROFILE}/SingletonLock" "${PROFILE}/SingletonSocket" "${PROFILE}/SingletonCookie"
}
trap cleanup EXIT TERM INT

# zypak may hand the process to an existing Chrome sandbox and exit 0.
# Stay up so systemd tracks the engine; stop kills this profile only.
/usr/bin/flatpak run \
  --socket=x11 --socket=pulseaudio --device=all --share=network \
  --env=DISPLAY="${DISPLAY}" --env=WAYLAND_DISPLAY= \
  "${FLATPAK_ID}" "${flags[@]}" >>"${LOG}" 2>&1 &
child=$!
ok=0
for _ in $(seq 1 60); do
  if curl -sf -m 1 "http://127.0.0.1:${CDP_PORT}/json" >/dev/null 2>&1; then
    ok=1
    break
  fi
  kill -0 "${child}" 2>/dev/null || break
  sleep 0.25
done
[[ "${ok}" -eq 1 ]] || { echo "CDP did not come up" >>"${LOG}"; exit 1; }
while [[ -L "${PROFILE}/SingletonLock" ]] || kill -0 "${child}" 2>/dev/null; do
  sleep 2
done

