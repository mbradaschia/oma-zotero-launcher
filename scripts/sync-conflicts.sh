#!/bin/bash
# The sync folder's conflict copies (Syncthing's .sync-conflict-…, Dropbox's "conflicted copy"),
# one JSON line each: {"copy", "base", "copyTime", "baseTime"} (modification times in ms; 0 when
# the file beside it is gone). Service.qml merges them with contracts/Merge.js, which checks each
# name again, then deletes the copy. Only regular files (find -type f: no links, no linked folders),
# none larger than 20 MB, and never a file beside it that is a link.
#   sync-conflicts.sh DIR
set -euo pipefail
DIR=${1:?usage: sync-conflicts.sh DIR}
[ -d "$DIR" ] || exit 0

mtime() { # seconds, GNU or BSD stat; 0 when missing
  [ -e "$1" ] || { echo 0; return; }
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"
}

json() { # a JSON string
  local s=${1//\\/\\\\}
  s=${s//\"/\\\"}
  printf '"%s"' "$s"
}

find "$DIR" -type f \( -name '*.sync-conflict-*' -o -name "*'s conflicted copy*" \) -not -name '*.tmp' -print0 |
  while IFS= read -r -d '' copy; do
    name=$(basename "$copy")
    base=$(printf '%s' "$name" | sed -E 's/\.sync-conflict-[0-9]{8}-[0-9]{6}-[A-Z0-9]{7}(\.[^./]+)?$/\1/; s/ \([^)]*'"'"'s conflicted copy[^)]*(\([0-9]+\))?\)(\.[^./]+)?$/\2/')
    [ "$base" != "$name" ] && [ -n "$base" ] || continue
    path="$(dirname "$copy")/$base"
    # the folder comes from another machine: never through a link (find -type f already skips linked copies)
    [ -L "$path" ] && continue
    [ "$(wc -c < "$copy")" -le 20971520 ] || continue
    printf '{"copy":%s,"base":%s,"copyTime":%d,"baseTime":%d}\n' "$(json "$copy")" "$(json "$path")" "$(( $(mtime "$copy") * 1000 ))" "$(( $(mtime "$path") * 1000 ))"
  done
