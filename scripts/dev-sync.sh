#!/bin/bash
# Copy the Omarchy shell plugin (the repo root's manifest.json, *.qml, lib/, …)
# into ~/.config/omarchy/plugins/<id>/, then validate it. The shell hot-reloads
# plugins on any change under that directory.
#
#   scripts/dev-sync.sh                sync once
#   scripts/dev-sync.sh --watch        sync, then re-sync on every change in the repo
#   scripts/dev-sync.sh --as NAME …    install it as another plugin, io.github.mbradaschia.oma-zotero-NAME
#                                      ("Zotero Launcher (NAME)"), next to the installed one: for a second
#                                      checkout (a worktree). It answers IPC as oma-zotero-launcher-NAME;
#                                      open it with omarchy-shell shell toggle <its id>. The two share
#                                      your settings, pins and saved searches.
#
# A real copy, not a symlink: `omarchy plugin validate` refuses links and the
# shell's inotify watcher may not follow them.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ID=$(jq -r .id "$ROOT/manifest.json")
NAME=$(jq -r .name "$ROOT/manifest.json")
WATCH=false
while (($#)); do
  case $1 in
    --watch) WATCH=true ;;
    --as)
      [[ ${2:-} =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "dev-sync: --as takes a name like 'searches' (a-z, 0-9, -)" >&2; exit 2; }
      ID="$ID-$2"
      NAME="$NAME ($2)"
      shift
      ;;
    *) echo "dev-sync: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done
[[ $ID =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ && $ID != *..* ]] || { echo "dev-sync: odd plugin id '$ID' in manifest.json" >&2; exit 2; }
PLUGINS="$HOME/.config/omarchy/plugins"
DEST="$PLUGINS/$ID"
# shellcheck source=scripts/safe-dest.sh
source "$ROOT/scripts/safe-dest.sh"
# The copy is replaced wholesale (rsync --delete): only a real directory of yours under the
# plugins directory, empty or already this plugin.
is_this_plugin() { [[ -f $1/manifest.json ]] && [[ $(jq -r .id "$1/manifest.json" 2>/dev/null) == "$ID" ]]; }

sync_once() {
  safe_dest "$DEST" "$PLUGINS" is_this_plugin
  mkdir -p "$DEST"
  # What the shell loads, and the runner's source for Settings › Install AI features (as in a
  # clone from omarchy plugin add); bridge sources, tests and dev tooling stay out.
  rsync -a --delete \
    --include='/manifest.json' --include='/*.qml' --include='/lib/***' --include='/components/***' \
    --include='/README.md' --include='/LICENSE' --include='/preview.png' \
    --include='/Makefile' --include='/scripts/' --include='/scripts/install-runner.sh' --include='/scripts/safe-dest.sh' --include='/scripts/install-bridge.sh' --include='/scripts/add-keybinding.sh' --include='/scripts/setup-check.sh' \
    --exclude='/daemon/node_modules' --include='/daemon/***' \
    --exclude='*' \
    "$ROOT/" "$DEST/"
  # Under another id (--as): the copy's manifest says so.
  if [[ $ID != "$(jq -r .id "$ROOT/manifest.json")" ]]; then
    jq --arg id "$ID" --arg name "$NAME" '.id = $id | .name = $name' "$ROOT/manifest.json" >"$DEST/manifest.json.tmp"
    mv "$DEST/manifest.json.tmp" "$DEST/manifest.json"
  fi
  omarchy-plugin-validate "$DEST"
  echo "synced $ID → $DEST"
}

sync_once
$WATCH || exit 0

echo "watching $ROOT (Ctrl+C to stop)…"
# Excluded below the checkout only (a worktree itself lives under .claude/).
inotifywait -m -r -q -e close_write,create,delete,move \
  --exclude "^$(printf '%s' "$ROOT" | sed 's/[.[\*^$()+?{|]/\\&/g')/(\.git|\.claude|zotero-bridge|tests|scripts|spikes|node_modules)(/|$)" \
  --format '%w%f' "$ROOT" | while read -r _; do
  # Coalesce bursts (editors write several events per save).
  while read -r -t 0.3 _; do :; done
  sync_once || echo "sync failed" >&2
done
