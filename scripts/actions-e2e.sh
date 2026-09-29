#!/bin/bash
# End-to-end test of the Tab actions (PLAN.md phase 3) in the live shell + Zotero:
# the actions view for items with 0, 1 and several PDFs, standalone PDFs,
# snapshots and missing files; the file picker; opening in the external viewer
# and in a new Zotero window; Show in library; Alt accelerators; real keys.
#
# Every window it opens is closed again; Zotero's tabs/selection and your focused
# window are restored. Opening a file externally records it as opened in Zotero
# (like Zotero's own external open). Needs the dev bridge (make bridge-link).
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
H="${XDG_RUNTIME_DIR:?}/oma-zotero/bridge.json"
[[ -r $H ]] || { echo "no bridge handshake at $H" >&2; exit 2; }
T=$(jq -r .token "$H")
B="http://127.0.0.1:$(jq -r .port "$H")/oma-zotero"

pass=0
fail=0
check() { if [[ $3 == "$2" ]]; then echo "✔ $1"; ((pass++)); else echo "✖ $1: expected '$2', got '$3'"; ((fail++)); fi; }
post() { curl -s -H "Zotero-Allowed-Request: 1" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "$2" "$B$1"; }
ipc() { omarchy-shell oma-zotero-launcher "$@" 2>/dev/null; }
state() { ipc state; }
pause() { timeout "$1" tail -f /dev/null; }
wait_for() { # <jq condition on overlay state> [seconds]
  local deadline=$((SECONDS + ${2:-5})) s=""
  while ((SECONDS <= deadline)); do
    s=$(state)
    jq -e "$1" <<<"$s" >/dev/null 2>&1 && { echo "$s"; return 0; }
    pause 0.1
  done
  echo "$s"
  return 1
}
clients() { hyprctl clients -j; }
# new_window <class regex> <addresses before (json array)> [seconds] → address of a new matching window
# (a cold viewer start on a busy machine can take >10 s, hence the generous waits)
new_window() {
  local deadline=$((SECONDS + ${3:-8})) a=""
  while ((SECONDS <= deadline)); do
    a=$(clients | jq -r --arg re "$1" --argjson before "$2" \
      '[.[] | select((.class | test($re; "i")) and ((.address as $x | $before | index($x)) | not))][0].address // empty')
    [[ -n $a ]] && { echo "$a"; return 0; }
    pause 0.2
  done
  return 1
}
addresses() { clients | jq -c '[.[].address]'; }
close_window() {
  hyprctl dispatch "hl.dsp.window.close({ window = \"address:$1\" })" >/dev/null 2>&1
  local deadline=$((SECONDS + 4))
  while ((SECONDS <= deadline)); do
    clients | jq -e --arg a "$1" 'any(.[]; .address == $a)' >/dev/null || return 0
    pause 0.2
  done
  hyprctl dispatch closewindow "address:$1" >/dev/null 2>&1
}
row_ids() { jq -c '[.actionRows[] | .rowId]'; }
# The attachment's path, without recording it as opened.
att_path() { post /attachment "$(jq -nc --arg k "$1" '{key: $k, target: "path", markOpened: false, dryRun: true}')" | jq -r .path; }
# Does the window's process command line mention this file?
window_shows() { # <address> <path>
  local pid
  pid=$(clients | jq -r --arg a "$1" '.[] | select(.address == $a) | .pid')
  [[ -n $pid ]] && tr '\0' '\n' <"/proc/$pid/cmdline" 2>/dev/null | grep -qxF -e "$2" -e "file://$2" && echo true || echo false
}
row() { jq -c --arg id "$1" '.actionRows[] | select(.rowId == $id)'; }

# Put item <key> under the cursor in the search view (query = its title).
select_item() {
  local key=$1 title
  title=$(post /item "$(jq -nc --arg k "$key" '{key: $k}')" | jq -r .item.title)
  [[ $(state | jq -r .opened) == true ]] && { ipc key escape >/dev/null; ipc key escape >/dev/null; }
  ipc search "$title" >/dev/null
  local s idx
  s=$(wait_for '.opened and (.loading | not) and .shownQuery == .filterText and .count > 0' 6)
  idx=$(jq --arg k "$key" '[.rows[].key] | index($k)' <<<"$s")
  [[ $idx == null ]] && { echo "✖ $key not found for query \"$title\""; ((fail++)); return 1; }
  for ((i = 0; i < idx; i++)); do ipc key down >/dev/null; done
  wait_for "(.selectedIndex == $idx)" 3 >/dev/null
}
enter_actions() { ipc key tab >/dev/null; wait_for '.view == "actions" and .detailsLoaded' 5; }

focus=$(hyprctl activewindow -j | jq -r .address)
ui0=$(post /dev/ui-state '{}')
opened_windows=()
restore() {
  for a in "${opened_windows[@]}"; do close_window "$a"; done
  [[ $(state | jq -r .opened) == true ]] && { ipc key escape >/dev/null; ipc key escape >/dev/null; ipc key escape >/dev/null; }
  post /dev/ui-restore "$(jq -c '{state: .}' <<<"$ui0")" >/dev/null
  hyprctl dispatch "hl.dsp.focus({ window = \"address:$focus\" })" >/dev/null 2>&1
}
trap restore EXIT

S=$(post /dev/attachment-samples '{}')
k() { jq -r ".$1.key // .$1.attachment.key // empty" <<<"$S"; }
onePdf=$(k onePdf); multiPdf=$(k multiPdf); oneOnDisk=$(k multiPdfOneOnDisk); urlOnly=$(k urlOnly)
standalone=$(k standalonePdf); missing=$(k missingFile); snapshot=$(k snapshotOnly)
evince=$(xdg-mime query default application/pdf | sed 's/\.desktop$//; s/.*\.//')

echo "== one PDF: actions view"
select_item "$onePdf"
s=$(enter_actions)
check "Tab opens the actions view" actions "$(jq -r .view <<<"$s")"
check "actions in order (Notes first, its notes below, then Prompts)" '["notes","prompts","open","external","window","tags","reveal"]' "$(jq -c '[.actionRows[] | .rowId | select(. != "note")]' <<<"$s")"
check "Open in Zotero explains what Enter does" "Open it in Zotero's reader" "$(row open <<<"$s" | jq -r .detail)"
check "external: enabled, direct" "true false" "$(row external <<<"$s" | jq -r '"\(.enabled) \(.submenu)"')"
check "external: names the viewer" true "$(row external <<<"$s" | jq --arg v "$evince" '.detail | startswith($v + " · ")')"
check "window: enabled, direct" "true false" "$(row window <<<"$s" | jq -r '"\(.enabled) \(.submenu)"')"

echo "== one PDF: open externally"
onePath=$(att_path "$(row external <<<"$s" | jq -r .attKey)")
before=$(addresses)
ipc key down >/dev/null
ipc key enter >/dev/null
check "overlay closes on the action" false "$(wait_for '.opened | not' 3 | jq .opened)"
w=$(new_window "evince" "$before" 20) && opened_windows+=("$w")
check "an $evince window opened" true "$([[ -n $w ]] && echo true || echo false)"
check "…showing the item's PDF" true "$(window_shows "$w" "$onePath")"
check "…and has focus" "$w" "$(hyprctl activewindow -j | jq -r .address)"
[[ -n $w ]] && close_window "$w"

echo "== several PDFs on disk: picker"
select_item "$multiPdf"
s=$(enter_actions)
check "external opens a picker" "true true" "$(row external <<<"$s" | jq -r '"\(.enabled) \(.submenu)"')"
check "…detail says so" "2 files: choose one…" "$(row external <<<"$s" | jq -r .detail)"
check "window opens a picker too" true "$(row window <<<"$s" | jq .submenu)"
ipc key down >/dev/null
ipc key enter >/dev/null
s=$(wait_for '.view == "files"' 3)
check "Enter on external → file picker" files "$(jq -r .view <<<"$s")"
check "picker lists both PDFs, both usable" '[true,true]' "$(jq -c '[.actionRows[].enabled]' <<<"$s")"
secondKey=$(jq -r '.actionRows[1].attKey' <<<"$s")
ipc key backspace >/dev/null
s=$(wait_for '.view == "actions"' 3)
check "Backspace goes back to the actions" actions "$(jq -r .view <<<"$s")"
check "…with the cursor still on external" external "$(jq -r '.actionRows[.selectedIndex].rowId' <<<"$s")"
ipc key enter >/dev/null
wait_for '.view == "files"' 3 >/dev/null
before=$(addresses)
ipc key down >/dev/null
ipc key enter >/dev/null
w=$(new_window "evince" "$before" 20) && opened_windows+=("$w")
check "choosing the second PDF opens it in $evince" true "$([[ -n $w ]] && echo true || echo false)"
check "…and it is the second file, not the first" true "$(window_shows "$w" "$(att_path "$secondKey")")"
[[ -n $w ]] && close_window "$w"

echo "== several PDFs, one on disk: no picker"
select_item "$oneOnDisk"
s=$(enter_actions)
check "external goes straight to the file on disk" "true false" "$(row external <<<"$s" | jq -r '"\(.enabled) \(.submenu)"')"
check "Enter would open that file in Zotero" "Open it in Zotero's reader" "$(row open <<<"$s" | jq -r .detail)"

echo "== URL-only attachments: file actions disabled"
select_item "$urlOnly"
s=$(enter_actions)
check "external disabled" "false No file attached" "$(row external <<<"$s" | jq -r '"\(.enabled) \(.detail)"')"
check "window disabled" false "$(row window <<<"$s" | jq .enabled)"
ipc key down >/dev/null
ipc key enter >/dev/null
check "Enter on a disabled action does nothing" "true actions" "$(state | jq -r '"\(.opened) \(.view)"')"
ipc type "lib" >/dev/null
s=$(wait_for '.filterText == "lib"' 3)
check "typing filters the actions" '["reveal"]' "$(row_ids <<<"$s")"

echo "== snapshot-only and missing file"
select_item "$snapshot"
s=$(enter_actions)
check "snapshot labels" "Open snapshot externally|Open snapshot in a new Zotero window" \
  "$(jq -r '[.actionRows[] | select(.rowId == "external" or .rowId == "window") | .label] | join("|")' <<<"$s")"
if [[ -n $missing ]]; then
  select_item "$missing"
  s=$(enter_actions)
  check "missing file: external disabled with a reason" "false The file is missing" "$(row external <<<"$s" | jq -r '"\(.enabled) \(.detail)"')"
fi

echo "== standalone PDF: open in a new Zotero window"
select_item "$standalone"
s=$(enter_actions)
check "the standalone PDF is its own file" "$standalone" "$(row external <<<"$s" | jq -r .attKey)"
before=$(addresses)
ipc key down >/dev/null
ipc key down >/dev/null
ipc key enter >/dev/null
w=$(new_window "^Zotero$" "$before" 10) && opened_windows+=("$w")
check "a separate Zotero reader window opened" true "$([[ -n $w ]] && echo true || echo false)"
check "…and has focus" "$w" "$(hyprctl activewindow -j | jq -r .address)"
check "…it is a reader window (initialTitle empty)" "" "$(clients | jq -r --arg a "$w" '.[] | select(.address == $a) | .initialTitle')"
post /dev/close-reader-windows "$(jq -nc --arg k "$standalone" '{key: $k}')" >/dev/null

echo "== Show in library"
select_item "$onePdf"
enter_actions >/dev/null
ipc key up >/dev/null
check "cursor on Show in library (wraps up)" reveal "$(state | jq -r '.actionRows[.selectedIndex].rowId')"
ipc key enter >/dev/null
deadline=$((SECONDS + 6)); ui=""
while ((SECONDS <= deadline)); do ui=$(post /dev/ui-state '{}'); [[ $(jq -r --arg k "$onePdf" '.selectedItemKeys | index($k) != null' <<<"$ui") == true ]] && break; pause 0.2; done
check "library tab selected" zotero-pane "$(jq -r .selectedTabId <<<"$ui")"
check "the item is selected" true "$(jq -r --arg k "$onePdf" '.selectedItemKeys | index($k) != null' <<<"$ui")"
check "Zotero has focus" Zotero "$(hyprctl activewindow -j | jq -r .class)"

echo "== Alt accelerators from the results"
select_item "$onePdf"
before=$(addresses)
ipc key alt+o >/dev/null
w=$(new_window "evince" "$before" 20) && opened_windows+=("$w")
check "Alt+O opens the single PDF externally, no menu" true "$([[ -n $w ]] && echo true || echo false)"
check "…overlay closed" false "$(state | jq .opened)"
[[ -z $w ]] && echo "  overlay state: $(state | jq -c '{opened, view, detailsLoaded, lastError, filterText, selectedIndex, rows: [.actionRows[]? | {rowId, enabled}]}')"
[[ -n $w ]] && close_window "$w"
select_item "$multiPdf"
ipc key alt+w >/dev/null
s=$(wait_for '.view == "files"' 5)
check "Alt+W with two PDFs → picker for the window action" "files window" "$(jq -r '"\(.view) \(.filePurpose)"' <<<"$s")"
ipc key escape >/dev/null

echo "== real keystrokes: keybinding, type, Tab, Down, Enter"
[[ $(state | jq -r .opened) == true ]] && { ipc key escape >/dev/null; ipc key escape >/dev/null; }
"$ROOT/scripts/uinput-keys.py" super+shift+z
wait_for '.opened and .keyboardFocus and (.loading | not)' 6 >/dev/null ||
  { echo "✖ overlay never got keyboard focus; not typing"; exit 1; }
title=$(post /item "$(jq -nc --arg k "$standalone" '{key: $k}')" | jq -r .item.title)
wtype "$title"
s=$(wait_for "(.shownQuery == $(jq -Rn --arg t "$title" '$t')) and (.loading | not)" 6)
idx=$(jq --arg k "$standalone" '[.rows[].key] | index($k)' <<<"$s")
for ((i = 0; i < idx; i++)); do wtype -k Down; done
wtype -k Tab
s=$(wait_for '.view == "actions" and .detailsLoaded' 5)
check "real Tab opens the actions" actions "$(jq -r .view <<<"$s")"
wtype -k Down
wtype -k Down
check "real Down moves to the window action" window "$(wait_for '.actionRows[.selectedIndex].rowId == "window"' 3 | jq -r '.actionRows[.selectedIndex].rowId')"
before=$(addresses)
wtype -k Return
w=$(new_window "^Zotero$" "$before" 10) && opened_windows+=("$w")
check "real Enter opens the PDF in a new Zotero window" true "$([[ -n $w ]] && echo true || echo false)"
post /dev/close-reader-windows "$(jq -nc --arg k "$standalone" '{key: $k}')" >/dev/null

restore
trap - EXIT
ui1=$(post /dev/ui-state '{}')
check "Zotero tabs restored" "$(jq -c '[.tabs[] | [.topKey, .type]]' <<<"$ui0")" "$(jq -c '[.tabs[] | [.topKey, .type]]' <<<"$ui1")"
check "Zotero selection restored" "$(jq -c '.selectedItemKeys | sort' <<<"$ui0")" "$(jq -c '.selectedItemKeys | sort' <<<"$ui1")"
check "no test windows left" 0 "$(clients | jq --argjson ws "$(printf '%s\n' "${opened_windows[@]}" | jq -R . | jq -sc .)" '[.[] | select(.address as $a | $ws | index($a))] | length')"

echo "== $pass passed, $fail failed"
((fail == 0))
