#!/bin/bash
# The sync folder's conflict copies (Syncthing's .sync-conflict-…, Dropbox's "conflicted copy"),
# for Service.qml to merge with contracts/Merge.js. The folder comes from another machine, so
# nothing in it is trusted: no name with a control character, no link (a "copy" linking to
# ~/.ssh/id_rsa would be merged into a synced file and sent away; a link where a file should be
# would be written through), nothing outside the folder, nothing larger than 20 MB.
#
#   sync-conflicts.sh list DIR
#     A stage folder of our own, then one JSON line per copy:
#       {"stage": "/run/…", "root": DIR resolved (every path below starts with it)}
#       {"copy", "base", "copyTime", "baseTime", "copyText", "baseText"}
#     copyText and baseText: the two files' bytes, copied into the stage through an open
#     descriptor that was checked to be the plain file itself (the QML reads only these). Times in
#     ms; baseTime 0 and no baseText when the file beside it is missing.
#   sync-conflicts.sh apply DIR STAGE
#     STAGE/manifest, one line per merged copy, tab separated: copy, base, merged text, and
#     optionally the kept file's path and text. Each text is moved into place by a rename in its
#     own folder (a rename replaces a link, never writes through it), the kept file first, then the
#     copy removed. A line with any path outside DIR, or a failure, leaves that copy. Then the stage
#     goes. Prints each copy merged.
set -euo pipefail
MODE=${1:?usage: sync-conflicts.sh list DIR | apply DIR STAGE}
DIR=${2:?usage: sync-conflicts.sh list DIR | apply DIR STAGE}
MAX=20971520
# GNU mv's -T: never into a folder a link points to (BSD mv, for tests on a Mac, has no -T)
if mv --version >/dev/null 2>&1; then MV=(mv -fT --); else MV=(mv -f --); fi

mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"; } # seconds, GNU or BSD stat

json() { # a JSON string (control characters never get here)
  local s=${1//\\/\\\\}
  s=${s//\"/\\\"}
  printf '"%s"' "$s"
}

# The folder itself, resolved; every path must be inside it.
ROOT=$(cd "$DIR" 2>/dev/null && pwd -P) || exit 0

# plain PATH: no control characters, and a plain name at its end.
plain() {
  local n
  n=$(basename -- "$1")
  case "$1" in *[[:cntrl:]]*) return 1 ;; esac
  [ "$n" != "." ] && [ "$n" != ".." ]
}

# enter PATH (in a subshell): into PATH's folder, checked by where we are (pwd -P: the folder
# actually entered, not what its path names a moment later) to be ROOT or under it; NAME is set to
# the file's name, and everything after works on NAME alone. A folder swapped for a link after
# that can't redirect anything.
enter() {
  plain "$1" || return 1
  NAME=$(basename -- "$1")
  cd -- "$(dirname -- "$1")" 2>/dev/null || return 1
  case "$(pwd -P)/" in "$ROOT"/*) return 0 ;; esac
  return 1
}

# copy_plain SRC DEST: SRC's bytes into DEST (the stage), only if SRC, as opened, is a regular file
# (not a link swapped in after it was listed) and not too large.
copy_plain() (
  enter "$1" || exit 1
  [ ! -L "$NAME" ] && [ -f "$NAME" ] || exit 1
  exec 3<"$NAME" || exit 1
  if [ -e /proc/self/fd/3 ]; then # Linux: what was opened (readlink inherits fd 3)
    [ "$(readlink /proc/self/fd/3)" = "$(pwd -P)/$NAME" ] || exit 1
  fi
  head -c $((MAX + 1)) <&3 >"$2"
  [ "$(wc -c <"$2")" -le "$MAX" ]
)

# place TEXT DEST: TEXT (a stage file) moved over DEST by a rename in DEST's folder.
place() (
  enter "$2" || exit 1
  [ -d "$NAME" ] && exit 1
  tmp=$(mktemp ./.oma-zotero-merge.XXXXXX) || exit 1
  if cat -- "$1" >"$tmp" && "${MV[@]}" "$tmp" "$NAME"; then exit 0; fi
  rm -f -- "$tmp"
  exit 1
)

# remove PATH: the copy, from inside its folder.
remove() (
  enter "$1" || exit 1
  rm -f -- "$NAME"
)

list() {
  local stage n=0
  stage=$(mktemp -d "${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/oma-zotero-merge.XXXXXX")
  printf '{"stage":%s,"root":%s}\n' "$(json "$stage")" "$(json "$ROOT")"
  find "$ROOT" -type f \( -name '*.sync-conflict-*' -o -name "*'s conflicted copy*" \) -not -name '*.tmp' -print0 |
    while IFS= read -r -d '' copy; do
      plain "$copy" || continue
      name=$(basename -- "$copy")
      base=$(printf '%s' "$name" | sed -E 's/\.sync-conflict-[0-9]{8}-[0-9]{6}-[A-Z0-9]{7}(\.[^./]+)?$/\1/; s/ \([^)]*'"'"'s conflicted copy[^)]*(\([0-9]+\))?\)(\.[^./]+)?$/\2/')
      [ "$base" != "$name" ] && [ -n "$base" ] || continue
      path="$(dirname -- "$copy")/$base"
      n=$((n + 1))
      copy_plain "$copy" "$stage/$n.copy" || continue
      if [ -e "$path" ] || [ -L "$path" ]; then
        copy_plain "$path" "$stage/$n.base" || continue # a link, or not a plain file: left alone
        printf '{"copy":%s,"base":%s,"copyTime":%d,"baseTime":%d,"copyText":%s,"baseText":%s}\n' "$(json "$copy")" "$(json "$path")" \
          "$(($(mtime "$copy") * 1000))" "$(($(mtime "$path") * 1000))" "$(json "$stage/$n.copy")" "$(json "$stage/$n.base")"
      else
        printf '{"copy":%s,"base":%s,"copyTime":%d,"baseTime":0,"copyText":%s}\n' "$(json "$copy")" "$(json "$path")" \
          "$(($(mtime "$copy") * 1000))" "$(json "$stage/$n.copy")"
      fi
    done
}

apply() {
  local stage
  stage=$(cd "${1:?a stage}" && pwd -P) || exit 1
  case "$(basename -- "$stage")" in oma-zotero-merge.*) ;; *) exit 1 ;; esac
  if [ -f "$stage/manifest" ]; then
    while IFS=$'\t' read -r copy base text kept keptText; do
      case "$text" in "$stage"/*) ;; *) continue ;; esac
      [ -z "$kept" ] || case "$keptText" in "$stage"/*) ;; *) continue ;; esac
      plain "$copy" && plain "$base" || continue
      [ "$(dirname -- "$copy")" = "$(dirname -- "$base")" ] || continue
      if [ -n "$kept" ]; then
        [ "$(dirname -- "$kept")" = "$(dirname -- "$base")" ] && place "$keptText" "$kept" || continue
      fi
      place "$text" "$base" || continue
      remove "$copy" && printf '%s\n' "$copy"
    done <"$stage/manifest"
  fi
  rm -rf -- "$stage"
}

case "$MODE" in
  list) list ;;
  apply) apply "${3:-}" ;;
  *) echo "usage: sync-conflicts.sh list DIR | apply DIR STAGE" >&2; exit 2 ;;
esac
