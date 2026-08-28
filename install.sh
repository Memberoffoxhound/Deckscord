#!/usr/bin/env bash
# Piped installs ignore the shebang. SteamOS /bin/sh is often bash in POSIX
# mode, which rejects arrays and ${var,,} — that shows up as
# "syntax error near unexpected token" around the Flatpak override block.
if [ -z "${BASH_VERSION:-}" ]; then
  echo "Deckscord installer needs bash (not sh/dash)." >&2
  echo "  curl -fsSL https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/install.sh | bash" >&2
  exit 1
fi
set +o posix 2>/dev/null || true
set -euo pipefail

# Deckscord installer — Discord in Steam Game Mode (QAM), Xbox/PS5 style.
# https://github.com/Memberoffoxhound/Deckscord
#
# Always installs dependencies (Vesktop, plugin files, user service).
# Safe as:  curl -fsSL .../install.sh | bash
# Prompts go to /dev/tty so a pipe is not consumed.

REPO="https://github.com/Memberoffoxhound/Deckscord.git"
PLUGIN_DIR="${HOME}/homebrew/plugins/Deckscord"
DATA_DIR="${HOME}/.local/share/deckscord"
SERVICE_NAME="deckscord-vesktop.service"
CDP_PORT="${DECKSCORD_CDP_PORT:-9222}"
FLATPAK_ID="dev.vencord.Vesktop"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
NONINTERACTIVE=0
[[ "${1:-}" == "--yes" || "${DECKSCORD_NONINTERACTIVE:-}" == "1" ]] && NONINTERACTIVE=1

prompt() {
  local msg="$1"
  local reply=""
  if [[ ${NONINTERACTIVE} -eq 1 ]]; then
    printf 'y'
    return
  fi
  if [[ -r /dev/tty ]]; then
    read -r -p "$msg" reply < /dev/tty || true
  else
    reply="y"
  fi
  printf '%s' "$reply"
}

need_sudo() {
  if sudo -n true 2>/dev/null; then
    return 0
  fi
  echo -e "  ${YELLOW}Need sudo: $*${NC}"
  sudo -v
}

have_vesktop() {
  flatpak list --app 2>/dev/null | grep -Fqi "${FLATPAK_ID}" && return 0
  flatpak list --app 2>/dev/null | grep -Fqi vesktop && return 0
  command -v vesktop >/dev/null 2>&1 && return 0
  return 1
}

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                    D E C K S C O R D                     ║"
echo "║   Discord in Game Mode — chat + calls in the QAM         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo
echo "This installer will:"
echo "  • Install Vesktop (Discord client that actually works in Game Mode)"
echo "  • Give it Wayland, PipeWire, and a local DevTools port so the QAM"
echo "    plugin can join voice and send messages"
echo "  • Create a systemd user service so Discord stays logged in"
echo "  • Install the Deckscord Decky plugin (Quick Access Menu)"
echo
echo "After this: log in once, then Voice + Text live in the QAM like Xbox/PS5."
echo

reply=$(prompt "Continue? [Y/n] ")
if [[ "${reply,,}" =~ ^n ]]; then
  echo "Aborted."
  exit 0
fi

mkdir -p "${DATA_DIR}"
mkdir -p "${HOME}/.config/systemd/user"

echo
echo -e "${BLUE}[1/6] Environment${NC}"
if [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  . /etc/os-release
  echo "  Distro: ${NAME:-unknown} ${VERSION_ID:-}"
fi
if command -v gamescope >/dev/null 2>&1 || [[ -n "${GAMESCOPE_WAYLAND_DISPLAY:-}" ]]; then
  echo "  Gamescope: present"
else
  echo -e "  ${YELLOW}Gamescope not detected — installing anyway${NC}"
fi
if [[ -d "${HOME}/homebrew" ]]; then
  echo "  Decky Loader: ${HOME}/homebrew"
else
  echo -e "  ${YELLOW}Decky Loader not found. Installing it (required for the QAM plugin).${NC}"
  curl -L https://github.com/SteamDeckHomebrew/decky-installer/releases/latest/download/install_release.sh | sh
fi

echo
echo -e "${BLUE}[2/6] Vesktop (required)${NC}"
if ! command -v flatpak >/dev/null 2>&1; then
  echo -e "${RED}flatpak is required. Install it, then re-run.${NC}"
  exit 1
fi

if have_vesktop; then
  echo "  Vesktop already installed."
else
  echo "  Installing Vesktop from Flathub (this is the Discord client)…"
  flatpak remote-add --if-not-exists --user flathub https://dl.flathub.org/repo/flathub.flatpakrepo || true
  if ! flatpak install -y --user flathub "${FLATPAK_ID}"; then
    echo "  User install failed — trying system install with sudo…"
    need_sudo "install Vesktop system-wide"
    sudo flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo || true
    sudo flatpak install -y flathub "${FLATPAK_ID}"
  fi
fi

if ! have_vesktop; then
  echo -e "${RED}Vesktop did not install. Check network / Flathub and re-run.${NC}"
  exit 1
fi
echo -e "  ${GREEN}Vesktop OK${NC}"

# Discord "default" input is PipeWire's default source. If that source is a
# speaker monitor, everyone in the call hears game/system audio.
if command -v pactl >/dev/null 2>&1; then
  src="$(pactl get-default-source 2>/dev/null || true)"
  if [[ "${src}" == *.monitor || "${src,,}" == *monitor* ]]; then
    mic=""
    while read -r _ name _; do
      [[ -z "${name:-}" ]] && continue
      [[ "${name}" == *.monitor || "${name,,}" == *monitor* ]] && continue
      mic="${name}"
      break
    done < <(pactl list short sources 2>/dev/null || true)
    if [[ -n "${mic}" ]]; then
      echo "  Default capture was speaker loopback — switching to ${mic}"
      pactl set-default-source "${mic}" 2>/dev/null || true
    else
      echo -e "  ${YELLOW}Default capture is a speaker monitor and no microphone was found.${NC}"
    fi
  fi
fi

# Permissions Vesktop needs in Game Mode: mic, speakers, X11 (gamescope Wayland
# SIGSEGVs Electron), home (session).
# No bash arrays here — SteamOS often runs this via `sh` (POSIX bash).
if flatpak list --app 2>/dev/null | grep -Fqi "${FLATPAK_ID}"; then
  echo "  Applying Flatpak overrides (X11, PipeWire, devices)..."
  apply_overrides() {
    # shellcheck disable=SC2068
    "$@" \
      --socket=x11 \
      --socket=fallback-x11 \
      --socket=wayland \
      --socket=pulseaudio \
      --socket=session-bus \
      --device=all \
      --share=network \
      --share=ipc \
      --filesystem=home \
      --filesystem=xdg-run/pipewire-0:ro \
      "${FLATPAK_ID}" || true
  }
  if flatpak list --app --user 2>/dev/null | grep -Fqi "${FLATPAK_ID}"; then
    apply_overrides flatpak override --user
  else
    need_sudo "Flatpak override"
    apply_overrides sudo flatpak override
  fi
fi

echo
echo -e "${BLUE}[3/6] Game Mode systemd service${NC}"

LAUNCH="${DATA_DIR}/launch-vesktop.sh"
if [[ -n "${SCRIPT_DIR}" && -f "${SCRIPT_DIR}/launch-vesktop.sh" ]]; then
  cp "${SCRIPT_DIR}/launch-vesktop.sh" "${LAUNCH}"
else
  curl -fsSL "https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/launch-vesktop.sh" -o "${LAUNCH}"
fi
chmod +x "${LAUNCH}"

cat > "${HOME}/.config/systemd/user/${SERVICE_NAME}" << EOF
[Unit]
Description=Deckscord Vesktop (Discord) for Game Mode
After=graphical-session.target
StartLimitIntervalSec=0

[Service]
Type=simple
Restart=on-failure
RestartSec=8
KillMode=control-group
TimeoutStopSec=12
Environment=ELECTRON_OZONE_PLATFORM_HINT=x11
Environment=DECKSCORD_CDP_PORT=${CDP_PORT}
ExecStart=%h/.local/share/deckscord/launch-vesktop.sh
ExecStop=/usr/bin/flatpak kill ${FLATPAK_ID}

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "${SERVICE_NAME}"

if loginctl show-user "$(whoami)" -p Linger 2>/dev/null | grep -q "no"; then
  echo "  Enabling linger so Discord survives Game Mode / reboot…"
  need_sudo "loginctl enable-linger"
  sudo loginctl enable-linger "$(whoami)"
fi
echo -e "  ${GREEN}Service $(systemctl --user is-active "${SERVICE_NAME}" || true)${NC}"

echo
echo -e "${BLUE}[4/6] Deckscord Decky plugin${NC}"

SRC=""
if [[ -n "${SCRIPT_DIR}" && -f "${SCRIPT_DIR}/plugin/main.py" ]]; then
  SRC="${SCRIPT_DIR}/plugin"
else
  tmp="$(mktemp -d)"
  echo "  Cloning plugin from GitHub…"
  git clone --depth 1 "${REPO}" "${tmp}/repo"
  SRC="${tmp}/repo/plugin"
fi

need_sudo "install plugin into ${PLUGIN_DIR}"
sudo mkdir -p "${PLUGIN_DIR}"
if command -v rsync >/dev/null 2>&1; then
  sudo rsync -a --delete \
    --exclude '__pycache__' --exclude '*.pyc' --exclude 'node_modules' \
    "${SRC}/" "${PLUGIN_DIR}/"
else
  sudo find "${PLUGIN_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  sudo cp -a "${SRC}/." "${PLUGIN_DIR}/"
fi
sudo chown -R root:root "${PLUGIN_DIR}" 2>/dev/null || true
echo "  Installed ${PLUGIN_DIR}"

if [[ -n "${tmp:-}" && -d "${tmp:-}" ]]; then
  rm -rf "${tmp}"
fi

echo
echo -e "${BLUE}[5/6] Restart Decky Loader${NC}"
need_sudo "restart plugin_loader"
sudo systemctl restart plugin_loader 2>/dev/null || sudo systemctl restart plugin_loader.service || true
sleep 1
echo -e "  ${GREEN}plugin_loader restarted${NC}"

echo
echo -e "${BLUE}[6/6] Verify${NC}"
ok=1
if have_vesktop; then
  echo -e "  ${GREEN}✓${NC} Vesktop"
else
  echo -e "  ${RED}✗${NC} Vesktop missing"
  ok=0
fi
if [[ -f "${PLUGIN_DIR}/main.py" && -f "${PLUGIN_DIR}/dist/index.js" && -f "${PLUGIN_DIR}/bridge.js" ]]; then
  echo -e "  ${GREEN}✓${NC} Plugin files"
else
  echo -e "  ${RED}✗${NC} Plugin files incomplete"
  ok=0
fi
if systemctl --user is-enabled "${SERVICE_NAME}" >/dev/null 2>&1; then
  echo -e "  ${GREEN}✓${NC} ${SERVICE_NAME} enabled ($(systemctl --user is-active "${SERVICE_NAME}" || true))"
else
  echo -e "  ${YELLOW}!${NC} service not enabled"
fi
if [[ -d "${HOME}/homebrew" ]]; then
  echo -e "  ${GREEN}✓${NC} Decky homebrew dir"
fi

echo
if [[ ${ok} -eq 1 ]]; then
  echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Deckscord install complete.${NC}"
  echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
else
  echo -e "${YELLOW}Install finished with warnings. Re-run if something above is red.${NC}"
fi
echo
echo "Next:"
echo "  1. If this is the first time, open Vesktop in Desktop Mode and log in."
echo "     (After that the session persists.)"
echo "  2. Return to Game Mode."
echo "  3. Quick Access Menu → Deckscord."
echo "  4. Voice tab: pick a server, join a call, mute/deafen."
echo "     Text tab: pick a channel, read and send messages."
echo
echo "Update (until the Decky store listing):"
echo "  bash ${DATA_DIR}/update.sh"
echo "  or:  curl -fsSL https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/update.sh | bash"
echo "Uninstall:"
echo "  bash ${DATA_DIR}/uninstall.sh"
echo "  or:  curl -fsSL https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/uninstall.sh | bash"
echo

for helper in uninstall.sh update.sh; do
  if [[ -n "${SCRIPT_DIR}" && -f "${SCRIPT_DIR}/${helper}" ]]; then
    cp "${SCRIPT_DIR}/${helper}" "${DATA_DIR}/${helper}"
    chmod +x "${DATA_DIR}/${helper}"
  else
    curl -fsSL "https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main/${helper}" -o "${DATA_DIR}/${helper}" && chmod +x "${DATA_DIR}/${helper}" || true
  fi
done
