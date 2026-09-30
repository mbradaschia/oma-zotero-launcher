#!/bin/bash
# End-to-end test of the Settings view (PLAN-providers.md §5, §8) in the live shell: its pages
# over IPC, a General setting changed and saved (and changed back), an OpenAI-compatible
# endpoint added and removed, a provider page's Test connection, and the launcher picking up
# where it was left. The settings file is put back exactly as it was. Needs the prompt runner.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/e2e-lib.sh"

SETTINGS="$HOME/.config/omarchy/oma-zotero-launcher.json"
SETTINGS_BAK=$(mktemp)
had_settings=false
[[ -f $SETTINGS ]] && { cp -p "$SETTINGS" "$SETTINGS_BAK"; had_settings=true; }
restore_settings() {
  if $had_settings; then cp -p "$SETTINGS_BAK" "$SETTINGS"; else rm -f "$SETTINGS"; fi
  rm -f "$SETTINGS_BAK"
}
E2E_CLEANUPS+=("restore_settings")

# Move the cursor to the row matching a jq condition, then press Enter.
enter_row() {
  local s idx i
  s=$(state)
  idx=$(jq "[.actionRows[] | ($1)] | index(true)" <<<"$s")
  [[ $idx == null ]] && { echo "✖ no row where $1"; ((fail++)); return 1; }
  ipc key pagedown >/dev/null; ipc key pageup >/dev/null # to the top… (Home isn't bound)
  for ((i = 0; i < 40; i++)); do [[ $(state | jq .selectedIndex) -le 0 ]] && break; ipc key up >/dev/null; done
  for ((i = 0; i < idx; i++)); do ipc key down >/dev/null; done
  wait_for "(.selectedIndex == $idx)" 3 >/dev/null
  ipc key enter >/dev/null
}

echo "== the root"
close_overlay
ipc settings root >/dev/null
s=$(wait_for '.view == "settings" and (.actionRows | length) >= 5' 8)
check "Settings: its pages, then the requirements" '["Models & providers","Defaults","General"]' "$(jq -c '[.actionRows[] | select(.section == "Settings") | .label]' <<<"$s")"
check "…the requirements say what's there" "true" "$(jq '[.actionRows[] | select(.section == "Requirements")] | length >= 3' <<<"$s")"

echo "== General: a setting changed, saved, and changed back"
enter_row '.value == "general"'
s=$(wait_for '.view == "settings-general"' 4)
before=$(jq -r '.actionRows[] | select(.value == "general.accelerators") | .label' <<<"$s")
enter_row '.value == "general.accelerators"'
s=$(wait_for '.actionRows[] | select(.value == "general.accelerators") | .detail | startswith("Off")' 4)
check "Enter on Alt keys turns them off" "false" "$(jq '.general.accelerators' "$SETTINGS")"
check "…saved in the general section" "true" "$(jq 'has("providers") and has("general")' "$SETTINGS")"
enter_row '.value == "general.accelerators"'
wait_for '.actionRows[] | select(.value == "general.accelerators") | .detail | startswith("On")' 4 >/dev/null
check "…and back on (at its default: left out of the file)" "null" "$(jq '.general.accelerators' "$SETTINGS")"
enter_row '.value == "general.maxResults"'
wait_for '.view == "settings-edit"' 4 >/dev/null
ipc key ctrl+u >/dev/null
ipc type "7" >/dev/null
s=$(wait_for '.actionRows[0].label == "Save “7”"' 3)
ipc key enter >/dev/null
s=$(wait_for '.footer | test("10 to 200")' 3)
check "an out-of-range value is refused, and the footer says why" "Results per search: 10 to 200" "$(jq -r .footer <<<"$s")"
ipc key escape >/dev/null; ipc key escape >/dev/null; ipc key escape >/dev/null

echo "== Models & providers: an endpoint added, tested, removed"
close_overlay
ipc settings providers >/dev/null
s=$(wait_for '.view == "settings-providers" and (.actionRows | map(.rowId) | index("set-endpoint-new")) != null' 10)
check "Add a provider lists the ways, and an endpoint" "true" "$(jq '[.actionRows[] | select(.section == "Add a provider")] | length >= 1' <<<"$s")"
enter_row '.rowId == "set-endpoint-new"'
wait_for '.view == "settings-edit"' 4 >/dev/null
ipc type "E2E lab" >/dev/null
wait_for '.actionRows[0].label == "Save “E2E lab”"' 3 >/dev/null
ipc key enter >/dev/null
wait_for '.actionRows[0].label | startswith("Type the base url")' 3 >/dev/null
ipc type "http://127.0.0.1:9/v1" >/dev/null
wait_for '.actionRows[0].label == "Save “http://127.0.0.1:9/v1”"' 3 >/dev/null
ipc key enter >/dev/null
s=$(wait_for '.view == "settings-provider" and (.actionRows[] | select(.rowId == "set-test") | .detail | test("can.t reach|✗"))' 15)
check "saved as an endpoint" '[{"id":"e2e-lab","name":"E2E lab","baseURL":"http://127.0.0.1:9/v1","enabled":true}]' "$(jq -c '.providers.compatible' "$SETTINGS")"
check "…its page tests it at once, and says what's wrong" "true" "$(jq '[.actionRows[] | select(.rowId == "set-test") | .detail | test("127.0.0.1")] | any' <<<"$s")"
enter_row '.rowId == "set-endpoint-remove"'
wait_for '.view == "settings-providers"' 5 >/dev/null
check "Remove this endpoint takes it out" "null" "$(jq -c '.providers.compatible' "$SETTINGS")"

echo "== picks up where it was left"
omarchy-shell shell toggle io.github.mbradaschia.oma-zotero >/dev/null 2>&1 # close
pause 0.8
omarchy-shell shell toggle io.github.mbradaschia.oma-zotero >/dev/null 2>&1 # and again
s=$(wait_for '.opened' 4)
check "reopened on the same page" "settings-providers" "$(jq -r .view <<<"$s")"
ipc key escape >/dev/null
s=$(wait_for '.view == "settings"' 3)
check "…and Esc goes back a level from there" "settings" "$(jq -r .view <<<"$s")"
close_overlay

e2e_finish
