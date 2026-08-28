#!/usr/bin/env bash
# Update Deckscord by git-pulling the repo and copying plugin files.
# No sudo unless an old install left ~/homebrew/plugins/Deckscord owned by root
# (one-time chown). Does not reinstall Vesktop, linger, or Flatpak.
#
#   bash ~/.local/share/deckscord/update.sh
#   ./update.sh            # from a git checkout (pulls that clone, then copies)
#   ./update.sh --local    # copy this checkout as-is, no network
#
if [ -z "${BASH_VERSION:-}" ]; then
  echo "Deckscord updater needs bash (not sh/dash)." >&2
  exit 1
fi
set +o posix 2>/dev/null || true
set -euo pipefail

REPO="${DECKSCORD_REPO:-https://github.com/Memberoffoxhound/Deckscord.git}"
PLUGIN_DIR="${HOME}/homebrew/plugins/Deckscord"
DATA_DIR="${HOME}/.local/share/deckscord"
SRC_REPO="${DECKSCORD_SRC:-${DATA_DIR}/src}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
LOCAL_ONLY=0
[[ "${1:-}" == "--local" ]] && LOCAL_ONLY=1

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

bar() {
  local pct="$1"
  local msg="$2"
  local filled=$((pct / 5))
  local i out="["
  i=1
  while [[ "$i" -le 20 ]]; do
    if [[ "$i" -le "$filled" ]]; then
      out="${out}="
    else
      out="${out} "
    fi
    i=$((i + 1))
  done
  printf '\r%s\n' "${out}] ${pct}%  ${msg}"
}

sync_plugin() {
  bar 70 "Copying plugin files…"
  local src="$1"
  if [[ ! -f "${src}/main.py" ]]; then
    echo -e "${RED}No plugin at ${src}${NC}" >&2
    exit 1
  fi
  mkdir -p "${DATA_DIR}"
  mkdir -p "${PLUGIN_DIR}" 2>/dev/null || true
  local uid gid
  uid="$(id -u)"
  gid="$(id -g)"
  if [[ -d "${PLUGIN_DIR}" && -w "${PLUGIN_DIR}/." ]]; then
    if command -v rsync >/dev/null 2>&1; then
      rsync -rltD --chmod=Du+rwx,Fu+rw \
        --exclude '__pycache__' --exclude '*.pyc' --exclude 'node_modules' --exclude '.git' \
        "${src}/" "${PLUGIN_DIR}/"
    else
      cp -R "${src}/." "${PLUGIN_DIR}/"
    fi
  elif sudo -n true 2>/dev/null; then
    echo "Plugin dir is root-owned; copying with sudo, then giving it back to $(whoami)."
    sudo -n mkdir -p "${PLUGIN_DIR}"
    if command -v rsync >/dev/null 2>&1; then
      sudo -n rsync -rltD --chmod=Du+rwx,Fu+rw \
        --exclude '__pycache__' --exclude '*.pyc' --exclude 'node_modules' --exclude '.git' \
        "${src}/" "${PLUGIN_DIR}/"
    else
      sudo -n cp -R "${src}/." "${PLUGIN_DIR}/"
    fi
    sudo -n chown -R "${uid}:${gid}" "${PLUGIN_DIR}"
    sudo -n chmod -R u+rwX "${PLUGIN_DIR}"
  else
    echo -e "${YELLOW}Cannot write ${PLUGIN_DIR} (owned by root).${NC}"
    echo "SteamOS / Decky installed it as root. One-time:"
    echo "  sudo chown -R ${uid}:${gid} ${PLUGIN_DIR}"
    echo "  sudo chmod -R u+rwX ${PLUGIN_DIR}"
    echo "Then re-run this updater."
    exit 1
  fi
  if [[ -f "${src}/../launch-vesktop.sh" ]]; then
    cp "${src}/../launch-vesktop.sh" "${DATA_DIR}/launch-vesktop.sh"
    chmod +x "${DATA_DIR}/launch-vesktop.sh"
  fi
  for helper in update.sh uninstall.sh; do
    if [[ -f "${src}/../${helper}" ]]; then
      cp "${src}/../${helper}" "${DATA_DIR}/${helper}"
      chmod +x "${DATA_DIR}/${helper}"
    fi
  done
}

pull_repo() {
  local dir="$1"
  mkdir -p "$(dirname "${dir}")"
  if [[ -d "${dir}/.git" ]]; then
    bar 15 "Fetching from GitHub…"
    echo "git fetch ${dir}"
    git -C "${dir}" fetch --prune origin
    local branch
    branch="$(git -C "${dir}" rev-parse --abbrev-ref HEAD)"
    git -C "${dir}" merge --ff-only "origin/${branch}" || git -C "${dir}" merge --ff-only origin/main
  else
    bar 15 "Cloning repository…"
    echo "git clone ${REPO}"
    git clone --depth 1 "${REPO}" "${dir}"
  fi
  git -C "${dir}" log -1 --oneline
}

echo "Deckscord update (git, no reinstall)"
bar 4 "Starting…"

if [[ "${LOCAL_ONLY}" -eq 1 ]]; then
  if [[ -n "${SCRIPT_DIR}" && -f "${SCRIPT_DIR}/plugin/main.py" ]]; then
    echo "Copying ${SCRIPT_DIR}/plugin → ${PLUGIN_DIR}"
    sync_plugin "${SCRIPT_DIR}/plugin"
  else
    echo -e "${RED}--local needs a git checkout with plugin/main.py${NC}" >&2
    exit 1
  fi
else
  if [[ -n "${SCRIPT_DIR}" && -d "${SCRIPT_DIR}/.git" && -f "${SCRIPT_DIR}/plugin/main.py" ]]; then
    echo "Pulling this checkout: ${SCRIPT_DIR}"
    pull_repo "${SCRIPT_DIR}"
    sync_plugin "${SCRIPT_DIR}/plugin"
  else
    pull_repo "${SRC_REPO}"
    sync_plugin "${SRC_REPO}/plugin"
  fi
fi

bar 90 "Restarting Decky…"

restarted=0
if systemctl restart plugin_loader.service 2>/dev/null || systemctl restart plugin_loader 2>/dev/null; then
  restarted=1
elif sudo -n systemctl restart plugin_loader.service 2>/dev/null || sudo -n systemctl restart plugin_loader 2>/dev/null; then
  restarted=1
fi
if [[ "${restarted}" -eq 1 ]]; then
  bar 100 "Decky relaunched"
  echo
  echo -e "${GREEN}Update complete.${NC}"
else
  echo -e "${YELLOW}Files copied, but Decky did not restart.${NC}"
  echo "  sudo systemctl restart plugin_loader"
fi
