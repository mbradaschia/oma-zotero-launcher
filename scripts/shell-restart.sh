#!/bin/bash
# Restart the Omarchy shell and make sure it is really back (QML changes need a
# restart: the shell reloads plugins from its compiled-component cache).
#
#   scripts/shell-restart.sh           restart it
#   scripts/shell-restart.sh --sync    stop it, sync the plugin (scripts/dev-sync.sh), start it: a running shell
#                                      hot-reloads the plugin on every file the sync writes (dozens of reloads of a
#                                      half-copied plugin, and their errors) just before it's restarted anyway
#
# `omarchy restart shell` relaunches through a Hyprland exec dispatch and gives
# up after 2 s; if no shell answers afterwards, try once more rather than leave
# the desktop without its bar.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SYNC=false
[[ ${1:-} == --sync ]] && SYNC=true

up() {
  local deadline=$((SECONDS + ${1:-8}))
  while ((SECONDS < deadline)); do
    omarchy-shell shell ping >/dev/null 2>&1 && return 0
    timeout 0.2 tail -f /dev/null
  done
  return 1
}

synced=0
if $SYNC; then
  # The lock screen is the shell: never stop it under a locked session (omarchy restart shell refuses too).
  if omarchy-hyprland-session-locked 2>/dev/null; then
    echo "the session is locked: not restarting the shell" >&2
    exit 1
  fi
  # The shell the session runs (as omarchy restart shell finds it), stopped: each kill ends the oldest instance
  # and returns once it has exited.
  omarchy_path=$(systemctl --user show-environment 2>/dev/null | sed -n 's/^OMARCHY_PATH=//p' | tail -n 1)
  : "${omarchy_path:=${OMARCHY_PATH:-/usr/share/omarchy}}"
  while timeout 5 quickshell kill -p "$omarchy_path/shell" --any-display >/dev/null 2>&1; do :; done
  "$ROOT/scripts/dev-sync.sh" || synced=1 # the shell comes back either way
fi

omarchy restart shell >/dev/null 2>&1
if ! up 8; then
  echo "shell didn't come back; restarting again" >&2
  omarchy restart shell >/dev/null 2>&1
  up 12 || { echo "Omarchy shell is not running; start it with: omarchy restart shell" >&2; exit 1; }
fi
echo "shell restarted"
exit $synced
