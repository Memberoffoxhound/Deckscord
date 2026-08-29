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
  # Decky often leaves the plugin directory root-owned 0755. rsync/cp temps
  # need +w on the directory; files the user owns can still be truncated.
  if ! python3 - "${src}" "${PLUGIN_DIR}" "${uid}" "${gid}" <<'PY'
import os, sys
from pathlib import Path

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
uid, gid = int(sys.argv[3]), int(sys.argv[4])
skip_dir = {"__pycache__", "node_modules", ".git"}
errors = []

def dir_writable(p: Path) -> bool:
    try:
        return p.is_dir() and os.access(p, os.W_OK | os.X_OK)
    except OSError:
        return False

def write_bytes(path: Path, data: bytes) -> None:
    parent = path.parent
    mode = path.stat().st_mode if path.exists() else None
    if dir_writable(parent):
        tmp = parent / (".%s.decknew.%s" % (path.name, os.getpid()))
        tmp.write_bytes(data)
        os.replace(tmp, path)
    elif path.exists():
        if not os.access(path, os.W_OK):
            try:
                os.chmod(path, path.stat().st_mode | 0o220)
            except OSError:
                pass
        fd = os.open(str(path), os.O_WRONLY | os.O_TRUNC)
        try:
            os.write(fd, data)
            os.fsync(fd)
        finally:
            os.close(fd)
    else:
        raise PermissionError("cannot create %s" % path)
    if mode is not None:
        try:
            os.chmod(path, mode)
        except OSError:
            pass

for root, dirs, files in os.walk(src):
    dirs[:] = [d for d in dirs if d not in skip_dir]
    rel = Path(root).relative_to(src)
    dest_dir = dst / rel
    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        if not dest_dir.is_dir():
            errors.append("mkdir %s" % dest_dir)
            continue
    for name in files:
        if name.endswith(".pyc") or ".decknew" in name:
            continue
        try:
            write_bytes(dest_dir / name, (Path(root) / name).read_bytes())
        except OSError as e:
            errors.append("%s: %s" % (rel / name, e))

core_ok = all((dst / c).is_file() for c in ("main.py", "bridge.js", "dist/index.js"))
if errors:
    sys.stderr.write("skipped %s file(s): %s\n" % (len(errors), "; ".join(errors[:6])))
if not core_ok:
    sys.exit(2)
print("copied %s -> %s" % (src, dst))
PY
  then
    if sudo -n true 2>/dev/null; then
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
  fi
  sudo -n chown -R "${uid}:${gid}" "${PLUGIN_DIR}" 2>/dev/null || true
  if [[ -f "${src}/../launch-vesktop.sh" ]]; then
    cp "${src}/../launch-vesktop.sh" "${DATA_DIR}/launch-vesktop.sh"
    chmod +x "${DATA_DIR}/launch-vesktop.sh"
  fi
  rm -f "${DATA_DIR}/webrtc_hub.py" "${PLUGIN_DIR}/webrtc_hub.py" "${PLUGIN_DIR}/portal_shim.py"
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
    # This clone is an update cache, not a working tree. Discard local
    # edits so "your local changes would be overwritten" cannot fail QAM update.
    git -C "${dir}" reset --hard origin/main 2>/dev/null \
      || git -C "${dir}" reset --hard FETCH_HEAD
    git -C "${dir}" clean -fd
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

bar 90 "Reloading Deckscord…"

reloaded=0
if /usr/bin/python3 - <<'PY'
import json, os, struct, time, urllib.request
from urllib.parse import urlparse

def ws_connect(url, timeout=4):
    import socket
    u = urlparse(url)
    host = u.hostname or "127.0.0.1"
    port = int(u.port or 1337)
    path = u.path or "/"
    if u.query:
        path += "?" + u.query
    s = socket.create_connection((host, port), timeout=timeout)
    key = __import__("base64").b64encode(os.urandom(16)).decode()
    req = (
        f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    )
    s.sendall(req.encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = s.recv(1024)
        if not chunk:
            raise ConnectionError("ws handshake closed")
        buf += chunk
    if b"101" not in buf.split(b"\r\n", 1)[0]:
        raise ConnectionError("ws handshake failed")
    return s

def ws_send(s, text):
    data = text.encode()
    mask = os.urandom(4)
    n = len(data)
    hdr = bytearray([0x81])
    if n < 126:
        hdr.append(0x80 | n)
    elif n < 65536:
        hdr.append(0x80 | 126)
        hdr.extend(struct.pack("!H", n))
    else:
        hdr.append(0x80 | 127)
        hdr.extend(struct.pack("!Q", n))
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    s.sendall(hdr + mask + masked)

token = urllib.request.urlopen("http://127.0.0.1:1337/auth/token", timeout=3).read().decode().strip()
ws = ws_connect("ws://127.0.0.1:1337/ws?auth=" + token)
ws_send(ws, json.dumps({"type": 0, "route": "loader/reload_plugin", "args": ["Deckscord"], "id": 1}))
time.sleep(1.0)
ws.close()
print("ok")
PY
then
  reloaded=1
fi
if [[ "${reloaded}" -eq 1 ]]; then
  bar 100 "Deckscord reloaded"
  echo
  echo -e "${GREEN}Update complete.${NC}"
else
  echo -e "${YELLOW}Files copied, but Deckscord did not reload.${NC}"
  echo "  Open the QAM → Deckscord, or: Decky → Deckscord → ⋮ → Reload"
fi
