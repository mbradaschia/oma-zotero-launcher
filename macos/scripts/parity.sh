#!/usr/bin/env bash
# How much of the Omarchy launcher's activateAction the app has ported: the row ids its `case`
# labels name (reference/ZoteroSearch.qml), the ids Actions/ActionMap.swift handles, per phase
# from docs/parity-phases.tsv (PLAN.md's appendix as data).
#   scripts/parity.sh                 the counts
#   scripts/parity.sh --phase 3b      also fail if one of 3b's ids is unported (its PR's check);
#                                     repeat it for each phase done so far
#   --qml, --map, --phases <file>     other files (the tests)
set -euo pipefail
export LC_ALL=C # sort and comm agree on the order
cd "$(dirname "$0")/.."

qml=reference/ZoteroSearch.qml map=ZoteroLauncher/Actions/ActionMap.swift phases=docs/parity-phases.tsv wanted=()
while [ $# -gt 0 ]; do
  case "$1" in
    --qml) qml=$2; shift 2 ;;
    --map) map=$2; shift 2 ;;
    --phases) phases=$2; shift 2 ;;
    --phase) wanted+=("$2"); shift 2 ;;
    *) echo "parity.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# activateAction's case labels (PLAN.md: tested on BSD and GNU awk; no \s).
awk '/^  function activateAction\(/{f=1} f&&/^  }$/{f=0}
 f&&match($0,/^[ \t]*case "[^"]+"/){s=substr($0,RSTART,RLENGTH);sub(/^[ \t]*case "/,"",s);sub(/"$/,"",s);print s}' \
  "$qml" | sort -u > "$tmp/ids"
# The keys of ActionMap.handlers, and the inert set's ids.
awk '/static let handlers/{if ($0 !~ /\[:\]/) f=1; next} f&&/^[ \t]*\]/{f=0} f&&match($0,/^[ \t]*"[^"]+":/){s=substr($0,RSTART,RLENGTH);sub(/^[ \t]*"/,"",s);sub(/":$/,"",s);print s}' \
  "$map" | sort -u > "$tmp/ported"
awk '/static let inert/{f=1} f{print} f&&/\]/{f=0}' "$map" | grep -o '"[^"]*"' | tr -d '"' | sort -u > "$tmp/inert" || true
# Each phase's ids, one per line: "<id>\t<phase>".
awk -F'\t' 'NF>=2{n=split($2,a," "); for(i=1;i<=n;i++) print a[i]"\t"$1}' "$phases" | sort > "$tmp/assigned"

bad=0
while IFS= read -r id; do
  n=$(awk -F'\t' -v id="$id" '$1==id' "$tmp/assigned" | wc -l | tr -d ' ')
  if [ "$n" = 0 ]; then echo "parity: $id is in no phase ($phases)" >&2; bad=1; fi
  if [ "$n" -gt 1 ]; then echo "parity: $id is in two phases ($phases)" >&2; bad=1; fi
done < "$tmp/ids"
cut -f1 "$tmp/assigned" | sort -u | comm -23 - "$tmp/ids" | while IFS= read -r id; do
  echo "parity: $id is in $phases but not a case of activateAction" >&2
done
if cut -f1 "$tmp/assigned" | sort -u | comm -23 - "$tmp/ids" | grep -q .; then bad=1; fi
comm -23 "$tmp/ported" "$tmp/ids" | while IFS= read -r id; do echo "parity: ActionMap handles $id, not a case of activateAction" >&2; done
if comm -23 "$tmp/ported" "$tmp/ids" | grep -q .; then bad=1; fi
[ "$bad" = 0 ] || exit 1

row() { printf '%-6s ported %d of %d   remaining %d%s\n' "$1" "$2" "$3" "$(($3 - $2))" "${4:-}"; }
total=0 done=0
while IFS=$'\t' read -r name list; do
  [ -n "$name" ] || continue
  printf '%s\n' "$list" | tr ' ' '\n' | grep -v '^$' | sort -u > "$tmp/phase" || true
  n=$(wc -l < "$tmp/phase" | tr -d ' ')
  p=$(comm -12 "$tmp/phase" "$tmp/ported" | wc -l | tr -d ' ')
  row "$name" "$p" "$n"
  total=$((total + n)) done=$((done + p))
  cp "$tmp/phase" "$tmp/phase-$name"
done < "$phases"
row total "$done" "$total" "   inert by design $(wc -l < "$tmp/inert" | tr -d ' ')"

for phase in ${wanted[@]+"${wanted[@]}"}; do
  if [ ! -f "$tmp/phase-$phase" ]; then echo "parity: no phase $phase in $phases" >&2; exit 1; fi
  missing=$(comm -23 "$tmp/phase-$phase" "$tmp/ported" | tr '\n' ' ')
  if [ -n "$missing" ]; then echo "parity: phase $phase still has unported ids: $missing" >&2; exit 1; fi
done
