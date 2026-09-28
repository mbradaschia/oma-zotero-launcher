#!/bin/bash
# Copy the Omarchy shell plugin (the repo root's manifest.json, *.qml, lib/, …)
# into ~/.config/omarchy/plugins/<id>/, then validate it. The shell hot-reloads
# plugins on any change under that directory.
#
#   scripts/dev-sync.sh          sync once
#   scripts/dev-sync.sh --watch  sync, then re-sync on every change in the repo
#
# A real copy, not a symlink: `omarchy plugin validate` refuses links and the
# shell's inotify watcher may not follow them.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ID=$(jq -r .id "$ROOT/manifest.json")
DEST="$HOME/.config/omarchy/plugins/$ID"

sync_once() {
  mkdir -p "$DEST"
  # Only what the shell loads; bridge sources, tests and dev tooling stay out.
  rsync -a --delete \
    --include='/manifest.json' --include='/*.qml' --include='/lib/***' --include='/components/***' \
    --include='/README.md' --include='/LICENSE' --include='/preview.png' \
    --exclude='*' \
    "$ROOT/" "$DEST/"
  omarchy-plugin-validate "$DEST"
  echo "synced $ID → $DEST"
}

sync_once
[[ ${1:-} == --watch ]] || exit 0

echo "watching $ROOT (Ctrl+C to stop)…"
inotifywait -m -r -q -e close_write,create,delete,move \
  --exclude '/(\.git|\.claude|zotero-bridge|tests|scripts|spikes|node_modules)(/|$)' \
  --format '%w%f' "$ROOT" | while read -r _; do
  # Coalesce bursts (editors write several events per save).
  while read -r -t 0.3 _; do :; done
  sync_once || echo "sync failed" >&2
done
