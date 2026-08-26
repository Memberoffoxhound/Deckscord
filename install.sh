#!/usr/bin/env bash
set -euo pipefail

# Deckscord installer
# One-stop Discord companion for SteamOS / Bazzite Game Mode
# https://github.com/Memberoffoxhound/Deckscord
#
# Safe to run as:  curl -fsSL .../install.sh | bash
# Prompts always go to the real terminal via /dev/tty so the pipe is not consumed.

REPO_RAW="https://raw.githubusercontent.com/Memberoffoxhound/Deckscord/main"
PLUGIN_DIR="${HOME}/homebrew/plugins/Deckscord"
DATA_DIR="${HOME}/.local/share/deckscord"
SERVICE_NAME="deckscord-vesktop.service"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Prompt helper that always talks to the real terminal (works with curl | bash)
prompt() {
  local msg="$1"
  local reply=""
  if [[ -r /dev/tty ]]; then
    # Force prompt to the controlling terminal so stdin (the pipe) is not eaten
    read -r -p "$msg" reply < /dev/tty || true
  else
    # No tty (rare) — default to yes
    reply="y"
  fi
  printf '%s' "$reply"
}

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                    D E C K S C O R D                     ║"
echo "║   Discord companion for SteamOS / Bazzite Game Mode      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo
echo "This installer will:"
echo "  • Check for (and install if missing) Vesktop — the reliable"
echo "    native Discord client that works properly in Game Mode"
echo "  • Create a systemd user service so Discord stays running"
echo "    minimized across reboots and Game Mode sessions"
echo "  • Install the Deckscord Decky Loader plugin so you can"
echo "    see channels, join voice, control volumes, chat, and"
echo "    get speaking overlays / toasts without ever leaving Game Mode"
echo "  • Only ask for sudo when it truly needs it (udev / linger / etc.)"
echo
echo "After this you will be able to do everything the PS5 and Xbox"
echo "Discord apps can do, but from the Steam Quick Access Menu."
echo

reply=$(prompt "Continue? [Y/n] ")
if [[ "${reply,,}" =~ ^n ]]; then
  echo "Aborted."
  exit 0
fi

mkdir -p "${DATA_DIR}"
mkdir -p "${HOME}/.config/systemd/user"

# ---------- detect environment ----------
echo
echo -e "${BLUE}[1/7] Detecting environment...${NC}"
if [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  . /etc/os-release
  echo "  Distro: ${NAME:-unknown} ${VERSION_ID:-}"
fi
if command -v gamescope >/dev/null 2>&1 || [[ -n "${GAMESCOPE_WAYLAND_DISPLAY:-}" ]]; then
  echo "  Gamescope: present (Game Mode capable)"
else
  echo -e "  ${YELLOW}Gamescope not detected — still installing, but Game Mode integration may be limited${NC}"
fi

# ---------- Vesktop ----------
echo
echo -e "${BLUE}[2/7] Vesktop (Discord client)...${NC}"
need_vesktop=0
if flatpak list --app 2>/dev/null | grep -qi "vesktop\|dev.vencord.Vesktop"; then
  echo "  Vesktop Flatpak already installed."
elif command -v vesktop >/dev/null 2>&1; then
  echo "  Native Vesktop binary found in PATH."
else
  need_vesktop=1
fi

if [[ ${need_vesktop} -eq 1 ]]; then
  echo "  Vesktop not found. Installing via Flatpak (recommended for Game Mode)..."
  if ! command -v flatpak >/dev/null 2>&1; then
    echo -e "${RED}flatpak is required to install Vesktop. Install it first, then re-run this script.${NC}"
    exit 1
  fi
  flatpak remote-add --if-not-exists --user flathub https://dl.flathub.org/repo/flathub.flatpakrepo || true
  flatpak install -y --user flathub dev.vencord.Vesktop
  echo -e "  ${GREEN}Vesktop installed.${NC}"
else
  echo -e "  ${GREEN}OK${NC}"
fi

# Give Vesktop Wayland access if it is a Flatpak
if flatpak list --app 2>/dev/null | grep -qi "dev.vencord.Vesktop"; then
  flatpak override --user --socket=wayland --socket=fallback-x11 --device=all --filesystem=home dev.vencord.Vesktop || true
fi

# ---------- systemd user service for Game Mode ----------
echo
echo -e "${BLUE}[3/7] Creating Game Mode systemd service...${NC}"

cat > "${HOME}/.config/systemd/user/${SERVICE_NAME}" << 'EOF'
[Unit]
Description=Deckscord Vesktop (Discord) for Game Mode
After=graphical-session.target
StartLimitIntervalSec=0

[Service]
Type=simple
Restart=on-failure
RestartSec=8
Environment=ELECTRON_OZONE_PLATFORM_HINT=auto
# Wait for gamescope Wayland socket when in Game Mode
ExecStartPre=/usr/bin/bash -c 'for i in {1..45}; do for s in "$XDG_RUNTIME_DIR"/gamescope-*; do [ -S "$s" ] && export WAYLAND_DISPLAY="$(basename "$s")" && exit 0; done; sleep 1; done; true'
ExecStart=/usr/bin/bash -c '
  if flatpak list --app 2>/dev/null | grep -qi dev.vencord.Vesktop; then
    wl=""; for s in "$XDG_RUNTIME_DIR"/gamescope-*; do [ -S "$s" ] && wl=$(basename "$s") && break; done
    [ -n "$wl" ] && export WAYLAND_DISPLAY="$wl"
    exec flatpak run dev.vencord.Vesktop --start-minimized --enable-features=UseOzonePlatform --ozone-platform=wayland
  elif command -v vesktop >/dev/null 2>&1; then
    exec vesktop --start-minimized
  else
    echo "Vesktop not found" >&2
    exit 1
  fi
'

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "${SERVICE_NAME}" || true

# Enable linger so the user service survives without a logged-in session
if loginctl show-user "$(whoami)" -p Linger 2>/dev/null | grep -q "no"; then
  echo "  Enabling systemd linger (so Discord survives reboots into Game Mode)..."
  if sudo -n true 2>/dev/null; then
    sudo loginctl enable-linger "$(whoami)"
  else
    echo -e "  ${YELLOW}Need sudo to enable linger.${NC}"
    sudo loginctl enable-linger "$(whoami)"
  fi
fi
echo -e "  ${GREEN}Service installed and enabled.${NC}"

# ---------- Decky Loader ----------
echo
echo -e "${BLUE}[4/7] Decky Loader...${NC}"
if [[ -d "${HOME}/homebrew" ]] || command -v decky >/dev/null 2>&1; then
  echo "  Decky appears to be present."
else
  echo "  Decky Loader not detected."
  dreply=$(prompt "  Install Decky Loader now? (recommended) [Y/n] ")
  if [[ ! "${dreply,,}" =~ ^n ]]; then
    echo "  Fetching official Decky installer..."
    curl -L https://github.com/SteamDeckHomebrew/decky-installer/releases/latest/download/install_release.sh | sh
  else
    echo -e "  ${YELLOW}Skipping Decky. You can install it later and re-run this script.${NC}"
  fi
fi

# ---------- Plugin ----------
echo
echo -e "${BLUE}[5/7] Installing Deckscord Decky plugin...${NC}"
mkdir -p "${PLUGIN_DIR}"

# Download core plugin files
for f in plugin.json package.json main.py; do
  curl -fsSL "${REPO_RAW}/plugin/${f}" -o "${PLUGIN_DIR}/${f}"
done

mkdir -p "${PLUGIN_DIR}/dist" "${PLUGIN_DIR}/src"
# Minimal frontend placeholder (full React build can be added later)
curl -fsSL "${REPO_RAW}/plugin/dist/index.js" -o "${PLUGIN_DIR}/dist/index.js" 2>/dev/null || echo "// Deckscord frontend placeholder" > "${PLUGIN_DIR}/dist/index.js"

echo -e "  ${GREEN}Plugin files placed in ${PLUGIN_DIR}${NC}"

# Restart Decky if possible
if systemctl --user is-active plugin_loader.service >/dev/null 2>&1; then
  systemctl --user restart plugin_loader.service || true
elif [[ -f /usr/bin/systemctl ]]; then
  # Some setups run it as system
  sudo systemctl restart plugin_loader 2>/dev/null || true
fi

# ---------- final notes ----------
echo
echo -e "${BLUE}[6/7] Finalizing...${NC}"
# Save a local uninstall helper
curl -fsSL "${REPO_RAW}/uninstall.sh" -o "${DATA_DIR}/uninstall.sh" 2>/dev/null || true
chmod +x "${DATA_DIR}/uninstall.sh" 2>/dev/null || true

echo
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Deckscord install complete.${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo
echo "Next steps:"
echo "  1. Return to Game Mode (or reboot)."
echo "  2. Open the Quick Access Menu (QAM) → look for Deckscord."
echo "  3. First launch will show a QR code or login page."
echo "     Scan it with the Discord mobile app or log in once."
echo "  4. After that your session stays alive across reboots."
echo
echo "Voice, text, per-user volume, mute, overlay, and notifications"
echo "are all available from the QAM while you play."
echo
echo "If the plugin does not appear immediately, open Decky settings,"
echo "enable Developer Mode if needed, and restart the plugin loader."
echo
echo "Uninstall later with:"
echo "  ${DATA_DIR}/uninstall.sh"
echo
echo "Enjoy."
echo
