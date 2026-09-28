#!/bin/bash
# Restart the Omarchy shell and make sure it is really back (QML changes need a
# restart: the shell reloads plugins from its compiled-component cache).
# `omarchy restart shell` relaunches through a Hyprland exec dispatch and gives
# up after 2 s; if no shell answers afterwards, try once more rather than leave
# the desktop without its bar.
set -uo pipefail

up() {
  local deadline=$((SECONDS + ${1:-8}))
  while ((SECONDS < deadline)); do
    omarchy-shell shell ping >/dev/null 2>&1 && return 0
    timeout 0.2 tail -f /dev/null
  done
  return 1
}

omarchy restart shell >/dev/null 2>&1
if ! up 8; then
  echo "shell didn't come back; restarting again" >&2
  omarchy restart shell >/dev/null 2>&1
  up 12 || { echo "Omarchy shell is not running; start it with: omarchy restart shell" >&2; exit 1; }
fi
echo "shell restarted"
