#!/bin/bash
# The steps of a sync-folder change (lib/Paths.js syncPlan), in order; stops at the first that fails
# and names it on stderr. Each step is safe to run again: a rerun after a failure finishes the job.
#   sync-apply.sh probe PATH...         one line per path: 1 if it exists, else 0
#   sync-apply.sh STEP... where STEP is
#     mkdir DIR                         the folder and its parents
#     copy FROM TO                      a file, or a folder's contents merged into TO; skipped if FROM is gone
#     move FROM TO                      skipped if FROM is gone (a rerun after it moved)
#     write PATH TEXT                   TEXT into PATH, through a temporary file renamed over it
set -euo pipefail

fail() { echo "sync-apply: $* failed" >&2; exit 1; }

if [[ ${1:-} == probe ]]; then
  shift
  for p in "$@"; do if [[ -e $p || -L $p ]]; then echo 1; else echo 0; fi; done
  exit 0
fi

while (( $# )); do
  step=$1
  shift
  case $step in
    mkdir)
      (( $# >= 1 )) || fail "mkdir (no folder given)"
      mkdir -p -- "$1" || fail "mkdir $1"
      shift ;;
    copy)
      (( $# >= 2 )) || fail "copy (two paths needed)"
      from=$1 to=$2
      shift 2
      if [[ -d $from ]]; then
        { mkdir -p -- "$to" && rsync -a -- "$from/" "$to/"; } || fail "copy $from $to"
      elif [[ -e $from ]]; then
        { mkdir -p -- "$(dirname -- "$to")" && cp -p -- "$from" "$to"; } || fail "copy $from $to"
      fi ;;
    move)
      (( $# >= 2 )) || fail "move (two paths needed)"
      from=$1 to=$2
      shift 2
      if [[ -e $from || -L $from ]]; then
        { mkdir -p -- "$(dirname -- "$to")" && mv -- "$from" "$to"; } || fail "move $from $to"
      fi ;;
    write)
      (( $# >= 2 )) || fail "write (a path and a text needed)"
      path=$1 text=$2
      shift 2
      tmp="$path.$$.tmp"
      if ! { mkdir -p -- "$(dirname -- "$path")" && printf '%s' "$text" > "$tmp" && mv -f -- "$tmp" "$path"; }; then
        rm -f -- "$tmp" 2>/dev/null || true
        fail "write $path"
      fi ;;
    *) fail "unknown step $step" ;;
  esac
done
