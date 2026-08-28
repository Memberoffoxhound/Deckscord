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

ensure_plugin_writable() {
  if [[ -d "${PLUGIN_DIR}" && -w "${PLUGIN_DIR}/." ]]; then
    return 0
  fi
  if mkdir -p "${PLUGIN_DIR}" 2>/dev/null && [[ -w "${PLUGIN_DIR}/." ]]; then
    return 0
  fi
  echo -e "${YELLOW}Plugin dir is not writable (old installs used sudo chown root).${NC}"
  echo "One-time, then updates are just git:"
  echo "  sudo chown -R $(whoami) ${PLUGIN_DIR}"
  if sudo -n true 2>/dev/null; then
    sudo mkdir -p "${PLUGIN_DIR}"
    sudo chown -R "$(id -u):$(id -g)" "${PLUGIN_DIR}"
    return 0
  fi
  sudo mkdir -p "${PLUGIN_DIR}"
  sudo chown -R "$(id -u):$(id -g)" "${PLUGIN_DIR}"
}

sync_plugin() {
  local src="$1"
  if [[ ! -f "${src}/main.py" ]]; then
    echo -e "${RED}No plugin at ${src}${NC}" >&2
    exit 1
  fi
  ensure_plugin_writable
  mkdir -p "${DATA_DIR}"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude '__pycache__' --exclude '*.pyc' --exclude 'node_modules' \
      "${src}/" "${PLUGIN_DIR}/"
  else
    find "${PLUGIN_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    cp -a "${src}/." "${PLUGIN_DIR}/"
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
    echo "git fetch ${dir}"
    git -C "${dir}" fetch --prune origin
    local branch
    branch="$(git -C "${dir}" rev-parse --abbrev-ref HEAD)"
    git -C "${dir}" merge --ff-only "origin/${branch}" || git -C "${dir}" merge --ff-only origin/main
  else
    echo "git clone ${REPO}"
    git clone --depth 1 "${REPO}" "${dir}"
  fi
  git -C "${dir}" log -1 --oneline
}

echo "Deckscord update (git, no reinstall)"

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

echo -e "${GREEN}Files copied to ${PLUGIN_DIR}${NC}"
echo "bridge.js reloads on the next QAM action. Close and reopen Deckscord for the menu."

if sudo -n systemctl restart plugin_loader 2>/dev/null; then
  echo "plugin_loader restarted (passwordless sudo)."
else
  echo "Decky was not restarted (no sudo). That is fine for most updates."
  echo "If the QAM still looks old: close it, or once: sudo systemctl restart plugin_loader"
fi
