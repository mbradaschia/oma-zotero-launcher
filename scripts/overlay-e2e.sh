#!/bin/bash
# End-to-end test of the overlay inside the running Omarchy shell + Zotero
# (PLAN.md phase 2 acceptance: SUPER+SHIFT+Z → type → Enter lands on the right
# Zotero tab, focused; an empty query lists the open items).
#
# Real input: the keybinding is pressed through a kernel uinput keyboard
# (scripts/uinput-keys.py), text and keys through wtype. State is observed via
# the plugin's IPC target (`omarchy-shell oma-zotero-launcher state`), the bridge's dev
# routes and hyprctl. Zotero's tabs/selection, the handshake file and your
# focused window are restored afterwards. Needs the dev bridge (make bridge-link).
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
state() { omarchy-shell oma-zotero-launcher state 2>/dev/null; }
pause() { timeout "$1" tail -f /dev/null; }
# wait_for <jq condition on state> [seconds] → prints the last state; status 1 on timeout
wait_for() {
  local deadline=$((SECONDS + ${2:-5})) s=""
  while ((SECONDS <= deadline)); do
    s=$(state)
    jq -e "$1" <<<"$s" >/dev/null 2>&1 && { echo "$s"; return 0; }
    pause 0.1
  done
  echo "$s"
  return 1
}
wait_zotero() { # <top-level item key> → waits until Zotero shows it and has focus
  local deadline=$((SECONDS + 6))
  while ((SECONDS <= deadline)); do
    [[ $(post /dev/ui-state '{}' | jq -r .selectedTabTopKey) == "$1" && $(hyprctl activewindow -j | jq -r .class) == Zotero ]] && return 0
    pause 0.1
  done
  return 1
}
keybinding() { "$ROOT/scripts/uinput-keys.py" super+shift+z; }
# Only type once the compositor has given the overlay keyboard focus; keys sent
# earlier would land in whatever window was focused before. Abort otherwise.
typing_ready() {
  wait_for '.opened and .keyboardFocus and (.loading | not)' 6 >/dev/null ||
    { echo "✖ overlay never got keyboard focus; not typing (would hit another window)"; exit 1; }
}

focus=$(hyprctl activewindow -j | jq -r .address)
ui0=$(post /dev/ui-state '{}')
cp -p "$H" "$H.e2e-backup"
restore() {
  [[ -f $H.e2e-backup ]] && mv -f "$H.e2e-backup" "$H"
  [[ $(state | jq -r .opened) == true ]] && omarchy-shell oma-zotero-launcher key escape >/dev/null && omarchy-shell oma-zotero-launcher key escape >/dev/null
  post /dev/ui-restore "$(jq -c '{state: .}' <<<"$ui0")" >/dev/null
  hyprctl dispatch "hl.dsp.focus({ window = \"address:$focus\" })" >/dev/null 2>&1
}
trap restore EXIT

samples=$(post /dev/samples '{}')
openKeys=$(post /search '{"query":""}' | jq -c '[.open[].key]')
pimm=$(post /search '{"query":"pimm 1984","limit":1}' | jq -r '.results[0].key')
stev=$(post /search '{"query":"stev resil","limit":1}' | jq -r '.results[0].key')
[[ $(state | jq -r .opened) == true ]] && omarchy-shell oma-zotero-launcher key escape >/dev/null

echo "== SUPER+SHIFT+Z opens the overlay with the open items first"
keybinding
s=$(wait_for '.opened and .count > 0 and .keyboardFocus and (.loading | not)' 6)
check "keybinding opens the overlay with keyboard focus" true "$(jq '.opened and .keyboardFocus' <<<"$s")"
check "keybinding opens the overlay" true "$(jq .opened <<<"$s")"
check "status ready" ready "$(jq -r .status <<<"$s")"
check "empty query: the items open in Zotero come first" "$openKeys" \
  "$(jq -c '[.rows[] | select(.section == "Open in Zotero") | .key]' <<<"$s")"
check "…followed by recently added" true "$(jq '[.rows[] | select(.section == "Recently added")] | length > 0' <<<"$s")"

echo "== typing 'pimm 1984' + Enter (real keystrokes)"
typing_ready
wtype "pimm 1984"
s=$(wait_for '.filterText == "pimm 1984" and .shownQuery == "pimm 1984" and (.loading | not)' 6)
check "typed text reached the overlay" "pimm 1984" "$(jq -r .filterText <<<"$s")"
check "top result is the Pimm item" "$pimm" "$(jq -r '.rows[0].key' <<<"$s")"
wtype -k Return
wait_for '.opened | not' 3 >/dev/null
check "Enter closes the overlay" false "$(state | jq .opened)"
wait_zotero "$pimm"
check "Zotero shows the Pimm tab" "$pimm" "$(post /dev/ui-state '{}' | jq -r .selectedTabTopKey)"
check "Zotero window has focus" Zotero "$(hyprctl activewindow -j | jq -r .class)"

echo "== keybinding again → 'stev resil' + Enter"
keybinding
typing_ready
wtype "stev resil"
s=$(wait_for '.shownQuery == "stev resil" and (.loading | not)' 6)
check "top result is Stevenson's paper" "$stev" "$(jq -r '.rows[0].key' <<<"$s")"
wtype -k Return
wait_zotero "$stev"
check "Zotero switched to that tab" "$stev" "$(post /dev/ui-state '{}' | jq -r .selectedTabTopKey)"
check "Zotero window has focus" Zotero "$(hyprctl activewindow -j | jq -r .class)"

echo "== navigation and Escape"
keybinding
typing_ready
wtype "sup"
wait_for '.shownQuery == "sup" and (.loading | not) and .count > 2' 6 >/dev/null
wtype -k Down
check "Down moves the cursor" 1 "$(wait_for '.selectedIndex == 1' 2 | jq .selectedIndex)"
wtype -k Up
check "Up moves it back" 0 "$(wait_for '.selectedIndex == 0' 2 | jq .selectedIndex)"
wtype -k BackSpace
check "Backspace edits the query" "su" "$(wait_for '.filterText == "su"' 2 | jq -r .filterText)"
wtype -k Escape
check "Escape clears the query first" "" "$(wait_for '.filterText == ""' 2 | jq -r .filterText)"
wtype -k Escape
check "…then closes the overlay" false "$(wait_for '.opened | not' 2 | jq .opened)"

echo "== status cards"
rm -f "$H"
omarchy-shell oma-zotero-launcher search "" >/dev/null
s=$(wait_for '.status == "bridge-missing"' 5)
check "no handshake, Zotero up → bridge-missing" bridge-missing "$(jq -r .status <<<"$s")"
check "…and no rows" 0 "$(jq .count <<<"$s")"
jq -c '.port = 9' "$H.e2e-backup" >"$H"
chmod 600 "$H"
omarchy-shell oma-zotero-launcher type "x" >/dev/null
s=$(wait_for '.status == "zotero-down"' 5)
check "bridge unreachable → zotero-down" zotero-down "$(jq -r .status <<<"$s")"
cp -p "$H.e2e-backup" "$H"
omarchy-shell oma-zotero-launcher key escape >/dev/null
omarchy-shell oma-zotero-launcher key escape >/dev/null
omarchy-shell oma-zotero-launcher search "" >/dev/null
s=$(wait_for '.status == "ready" and .count > 0' 5)
check "handshake back → ready again" ready "$(jq -r .status <<<"$s")"
omarchy-shell oma-zotero-launcher key escape >/dev/null

restore
trap - EXIT
rm -f "$H.e2e-backup"
ui1=$(post /dev/ui-state '{}')
check "Zotero tabs restored" "$(jq -c '[.tabs[] | [.topKey, .type]]' <<<"$ui0")" "$(jq -c '[.tabs[] | [.topKey, .type]]' <<<"$ui1")"
check "Zotero selected tab restored" "$(jq -r .selectedTabTopKey <<<"$ui0")" "$(jq -r .selectedTabTopKey <<<"$ui1")"
check "handshake restored" "$(jq -r .token "$H")" "$T"

echo "== $pass passed, $fail failed"
((fail == 0))
