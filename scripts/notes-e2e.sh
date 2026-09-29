#!/bin/bash
# End-to-end test of notes (PLAN.md phase 4) in the live shell + Zotero: how real
# notes come out of the bridge (tables, images, citations, note links, web links,
# long notes), the Notes action and Alt+N, the notes list (filter, dates), the
# reader (scrolling, back), Ctrl+C, opening a note in Zotero, and real keys.
#
# Opens one note in Zotero: a note already in the note editor's current format,
# checked unchanged afterwards. Ctrl+C replaces the clipboard; the previous content
# (its first type) is put back. Zotero's tabs/selection and your focused window
# are restored. Needs the dev bridge (make bridge-link).
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/e2e-lib.sh"

NS=$(post /dev/note-samples '{}')
n() { jq -r ".$1.key // empty" <<<"$NS"; }
LINK="#7aa2f7"
display() { post /note "$(jq -nc --arg k "$1" --arg c "$LINK" '{key: $k, linkColor: $c}')"; }

echo "== real notes through the bridge (display format)"
for s in withTable withImage withCitation withHighlight withZoteroLink withCode withMath withWebLink standalone; do
  k=$(n "$s")
  [[ -z $k ]] && { echo "  (no $s note in this library)"; continue; }
  d=$(display "$k")
  check "$s: Markdown, no zotero:// links, no raw images" "markdown false false" \
    "$(jq -r '"\(.format) \(.markdown | test("zotero://")) \(.markdown | test("!\\[|<img|data:image"; "i"))"' <<<"$d")"
done
d=$(display "$(n withTable)")
check "table: a Markdown table, one row per line" "true true" \
  "$(jq -r '.markdown | split("\n") | map(select(startswith("|"))) | "\(length > 2) \(all(endswith("|")))"' <<<"$d")"
check "table: has its separator row" true "$(jq '.markdown | test("\\| --- \\|")' <<<"$d")"
check "image → [image]" true "$(display "$(n withImage)" | jq '.markdown | contains("[image]")')"
cite=$(post /note "$(jq -nc --arg k "$(n withCitation)" '{key: $k, format: "export"}')" |
  jq -r '[.markdown | scan("\\[([^\\]]+)\\]\\(zotero://select")[0]][0] // empty')
check "citation → its text, without the link" true "$([[ -n $cite ]] && display "$(n withCitation)" | jq --arg c "$cite" '.markdown | contains($c)' || echo false)"
[[ -n $(n withWebLink) ]] && check "web links in the theme color" true "$(display "$(n withWebLink)" | jq --arg c "$LINK" '.markdown | contains("style=\"color:" + $c + "\"")')"
d=$(display "$(n longest)")
check "the longest note is cut and says so" "true true" "$(jq -r '"\(.truncated) \(.chars > 60000)"' <<<"$d")"
check "export format keeps Zotero's app links (for copying)" true "$([[ -n $cite ]] && echo true || echo false)"
check "a regular item is not a note → 400" not-a-note "$(post /note "$(key_json "$(n severalNotes)")" | jq -r .error.code)"

echo "== no notes"
select_item "$(n noNotes)"
ipc key tab >/dev/null
s=$(wait_for '.view == "actions" and .detailsLoaded' 5)
check "Notes row disabled: No notes" "false No notes" "$(jq -r '.actionRows[] | select(.rowId == "notes") | "\(.enabled) \(.detail)"' <<<"$s")"
ipc key escape >/dev/null # Esc with an empty filter closes the overlay
select_item "$(n noNotes)"
ipc key alt+n >/dev/null
s=$(wait_for '.view == "actions" and .detailsLoaded and (.actionRows[.selectedIndex].rowId == "notes")' 5)
check "Alt+N without notes: the actions, on the Notes row" "actions notes" "$(jq -r '"\(.view) \(.actionRows[.selectedIndex].rowId)"' <<<"$s")"

echo "== one note: Alt+N opens it directly"
select_item "$(n oneNote)"
ipc key alt+n >/dev/null
s=$(wait_for '.view == "note" and .note.loaded' 6)
check "straight to the reader" "note true" "$(jq -r '"\(.view) \(.note.loaded)"' <<<"$s")"
check "header is the note's title" true "$(jq '.header == ("‹ " + .note.title)' <<<"$s")"
check "the Markdown is rendered" true "$(jq '.note.rendered > 0 and .note.contentHeight > 0' <<<"$s")"

echo "== several notes: list, filter, read, scroll, back"
select_item "$(n severalNotes)"
ipc key tab >/dev/null
s=$(wait_for '.view == "actions" and .detailsLoaded' 5)
count=$(jq -r '.actionRows[] | select(.rowId == "notes") | .detail' <<<"$s")
check "Notes row counts them" true "$([[ $count =~ ^[0-9]+\ notes$ ]] && echo true || echo false)"
check "Notes is the top row, one row per note below it" "notes $(post /item "$(key_json "$(n severalNotes)")" | jq '.notes | length')" \
  "$(jq -r '"\(.actionRows[0].rowId) \([.actionRows[] | select(.rowId == "note")] | length)"' <<<"$s")"
idx=$(jq '[.actionRows[].rowId] | index("notes")' <<<"$s")
for ((i = 0; i < idx; i++)); do ipc key down >/dev/null; done
ipc key enter >/dev/null
s=$(wait_for '.view == "notes"' 4)
check "Enter on Notes → the list" notes "$(jq -r .view <<<"$s")"
nn=$(jq '.listCount' <<<"$s")
check "one row per note" "$(post /item "$(key_json "$(n severalNotes)")" | jq '.notes | length')" "$nn"
check "newest edit first" true "$(jq '[.actionRows[].detail | .[0:10]] | . == (sort | reverse)' <<<"$s")"
first=$(jq -r '.actionRows[0].label' <<<"$s")
q=$(cut -c1-3 <<<"$first" | tr '[:upper:]' '[:lower:]')
ipc type "$q" >/dev/null
s=$(wait_for ".filterText == \"$q\"" 3)
check "typing filters the notes (fuzzy) and highlights the match" "$first true" "$(jq -r '"\(.actionRows[0].label) \(.actionRows[0].highlighted)"' <<<"$s")"
ipc key escape >/dev/null # clears the filter
s=$(wait_for '.filterText == ""' 3)
check "Esc clears the filter first" "notes $nn" "$(jq -r '"\(.view) \(.listCount)"' <<<"$s")"
# Read the longest of these notes (so there is something to scroll).
long=$(post /item "$(key_json "$(n severalNotes)")" | jq -r '.notes | map(.excerpt | length) | index(max)')
for ((i = 0; i < long; i++)); do ipc key down >/dev/null; done
ipc key enter >/dev/null
s=$(wait_for '.view == "note" and .note.loaded' 6)
check "Enter reads the note" "note true" "$(jq -r '"\(.view) \(.note.loaded)"' <<<"$s")"
if jq -e '.note.contentHeight > .note.viewHeight + 50' <<<"$s" >/dev/null; then
  ipc key pagedown >/dev/null
  check "PgDn scrolls" true "$(wait_for '.note.contentY > 0' 2 | jq '.note.contentY > 0')"
  ipc key end >/dev/null
  check "End goes to the bottom" true "$(wait_for '.note.contentY == (.note.contentHeight - .note.viewHeight)' 2 | jq '.note.contentY == (.note.contentHeight - .note.viewHeight)')"
  ipc key up >/dev/null
  check "↑ scrolls back a little" true "$(wait_for '.note.contentY < (.note.contentHeight - .note.viewHeight)' 2 | jq '.note.contentY < (.note.contentHeight - .note.viewHeight)')"
  ipc key home >/dev/null
  check "Home goes to the top" 0 "$(wait_for '.note.contentY == 0' 2 | jq .note.contentY)"
else
  echo "  (note too short to scroll)"
fi
ipc type "x" >/dev/null
check "typing is ignored in the reader" "note " "$(state | jq -r '"\(.view) \(.filterText)"')"
ipc key backspace >/dev/null
s=$(wait_for '.view == "notes"' 3)
check "Backspace → back to the list, same row" "notes $long" "$(jq -r '"\(.view) \(.selectedIndex)"' <<<"$s")"
ipc key backspace >/dev/null
check "…and again → the actions" actions "$(wait_for '.view == "actions"' 3 | jq -r .view)"

echo "== Ctrl+C copies the note as Markdown"
clip_type=$(wl-paste --list-types 2>/dev/null | head -1)
clip_file=$(mktemp)
[[ -n $clip_type ]] && wl-paste --no-newline --type "$clip_type" >"$clip_file" 2>/dev/null
E2E_CLEANUPS+=("restore_clipboard")
restore_clipboard() {
  # wl-copy stays in the background to serve the clipboard: detach it from our output.
  if [[ -n $clip_type ]]; then setsid wl-copy --type "$clip_type" <"$clip_file" >/dev/null 2>&1; else wl-copy --clear >/dev/null 2>&1; fi
  rm -f "$clip_file"
}
select_item "$(n oneNote)"
ipc key alt+n >/dev/null
s=$(wait_for '.view == "note" and .note.loaded' 6)
ipc key ctrl+c >/dev/null
s=$(wait_for '.flash == "Copied the note as Markdown"' 5)
check "Ctrl+C confirms in the footer" "Copied the note as Markdown" "$(jq -r .flash <<<"$s")"
pause 0.5
want=$(post /note "$(jq -nc --arg k "$(jq -r .note.key <<<"$s")" '{key: $k, format: "export"}')" | jq -r .markdown)
check "the clipboard holds Zotero's Markdown export of the note" true "$([[ $(wl-paste --no-newline 2>/dev/null) == "$want" ]] && echo true || echo false)"

echo "== real keys: keybinding, type, Alt+N, Enter, PgDn, Backspace, Esc"
if real_open; then
  title=$(post /item "$(key_json "$(n severalNotes)")" | jq -r .item.title)
  q=$(query_for "$title")
  wtype "$q"
  s=$(wait_for "(.shownQuery == $(jq -Rn --arg t "$q" '$t')) and (.loading | not)" 6)
  idx=$(jq --arg k "$(n severalNotes)" '[.rows[].key] | index($k)' <<<"$s")
  for ((i = 0; i < idx; i++)); do wtype -k Down; done
  wtype -M alt n -m alt
  s=$(wait_for '.view == "notes"' 5)
  check "real Alt+N opens the notes list" notes "$(jq -r .view <<<"$s")"
  wtype -k Return
  s=$(wait_for '.view == "note" and .note.loaded' 6)
  check "real Enter reads the first note" "note true" "$(jq -r '"\(.view) \(.note.loaded)"' <<<"$s")"
  if jq -e '.note.contentHeight > .note.viewHeight + 50' <<<"$s" >/dev/null; then
    wtype -k Next
    check "real PgDn scrolls" true "$(wait_for '.note.contentY > 0' 2 | jq '.note.contentY > 0')"
  fi
  wtype -k BackSpace
  check "real Backspace goes back" notes "$(wait_for '.view == "notes"' 3 | jq -r .view)"
  wtype -k Escape
  check "real Esc closes" false "$(wait_for '.opened | not' 3 | jq .opened)"
fi

echo "== Enter in the reader opens the note in Zotero"
safe=$(n safeToOpen)
if [[ -z $safe ]]; then
  echo "  (no note in the note editor's current format to open safely; skipped)"
else
  before=$(post /dev/note-state "$(key_json "$safe")")
  # Enter must only ever reach the note chosen here: stop if anything is off.
  select_item "$(jq -r .safeToOpen.parent.key <<<"$NS")" || { echo "  (skipping: couldn't select the note's parent)"; e2e_finish; exit; }
  ipc key alt+n >/dev/null
  s=$(wait_for '.view == "note" or .view == "notes"' 5)
  if [[ $(jq -r .view <<<"$s") == notes ]]; then
    idx=$(jq --arg k "$safe" '[.actionRows[].noteKey] | index($k)' <<<"$s")
    for ((i = 0; i < idx; i++)); do ipc key down >/dev/null; done
    ipc key enter >/dev/null
  fi
  s=$(wait_for '.view == "note" and .note.loaded' 6)
  check "reading the note to open" "$safe" "$(jq -r .note.key <<<"$s")"
  [[ $(jq -r .note.key <<<"$s") == "$safe" ]] || { echo "  (skipping: the reader shows another note)"; e2e_finish; exit; }
  ipc key enter >/dev/null
  check "the overlay closes" false "$(wait_for '.opened | not' 3 | jq .opened)"
  deadline=$((SECONDS + 8)); ui=""
  while ((SECONDS <= deadline)); do
    ui=$(post /dev/ui-state '{}')
    [[ $(jq -r .selectedTabItemKey <<<"$ui") == "$safe" ]] && break
    pause 0.2
  done
  check "Zotero shows the note in a tab" "$safe" "$(jq -r .selectedTabItemKey <<<"$ui")"
  check "…and has focus" Zotero "$(hyprctl activewindow -j | jq -r .class)"
  pause 1.5 # let the note editor settle before checking nothing was saved
  after=$(post /dev/note-state "$(key_json "$safe")")
  check "opening the note didn't change it" "$(jq -c '{version, dateModified, hash}' <<<"$before")" "$(jq -c '{version, dateModified, hash}' <<<"$after")"
fi

e2e_finish
