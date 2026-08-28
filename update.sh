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
  bar 70 "Copying plugin files…"
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
else
  echo "Need sudo once to relaunch Decky so the new plugin loads."
  if sudo systemctl restart plugin_loader.service 2>/dev/null || sudo systemctl restart plugin_loader 2>/dev/null; then
    restarted=1
  fi
fi
if [[ "${restarted}" -eq 1 ]]; then
  bar 100 "Decky relaunched"
  echo
  echo -e "${GREEN}Update complete.${NC}"
else
  echo -e "${YELLOW}Files copied, but Decky did not restart.${NC}"
  echo "  sudo systemctl restart plugin_loader"
fi
