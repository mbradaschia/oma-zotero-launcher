#!/bin/bash
# End-to-end test of the overlay's states and settings (PLAN.md phase 6) in the live
# shell + Zotero: no matches, a search that times out, a rejected token, and each
# setting in ~/.config/omarchy/oma-zotero-launcher.json (accelerators, emptyQuery, maxResults,
# enterAction), including invalid values, which are reported in the footer.
#
# The settings file and the bridge handshake are put back exactly as they were;
# Zotero's tabs/selection and your focused window are restored. (Zotero down and a
# missing bridge are covered by overlay-e2e.sh.) Needs the dev bridge.
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
write_settings() { printf '%s\n' "$1" >"$SETTINGS"; }
open_query() { close_overlay; ipc search "$1" >/dev/null; wait_for "${2:-.opened and (.loading | not) and .shownQuery == .filterText}" "${3:-6}"; }

echo "== no matches"
s=$(open_query "'zzqxjqqzzx")
check "the card says so" "No matches for “'zzqxjqqzzx”" "$(jq -r .emptyTitle <<<"$s")"

echo "== a search that times out (the bridge made slow on purpose)"
post /dev/delay '{"ms": 6000}' >/dev/null
E2E_CLEANUPS+=("post /dev/delay '{\"ms\": 0}' >/dev/null")
s=$(open_query "resilience" '.lastError != ""' 8)
check "after 4 s: Zotero didn't answer in time" "Zotero didn't answer in time" "$(jq -r .lastError <<<"$s")"
check "…shown on the card" "Search failed" "$(jq -r .emptyTitle <<<"$s")"
post /dev/delay '{"ms": 0}' >/dev/null
pause 2.5 # let the slow request drain
ipc type "s" >/dev/null
s=$(wait_for '(.loading | not) and .shownQuery == .filterText and .count > 0' 6)
check "the next keystroke searches again" "true \"\"" "$(jq -r '"\(.count > 0) \(.lastError | tojson)"' <<<"$s")"

echo "== a rejected token"
HS_BAK=$(mktemp)
cp -p "$H" "$HS_BAK"
restore_handshake() { cp -p "$HS_BAK" "$H"; rm -f "$HS_BAK"; }
E2E_CLEANUPS+=("restore_handshake")
jq --arg t "$(printf '0%.0s' {1..64})" '.token = $t' "$HS_BAK" >"$H.tmp" && chmod 600 "$H.tmp" && mv "$H.tmp" "$H"
s=$(open_query "resilience" '.status == "unauthorized"' 6)
check "status: unauthorized" unauthorized "$(jq -r .status <<<"$s")"
check "…the card explains" "Zotero rejected the bridge token" "$(jq -r .emptyTitle <<<"$s")"
restore_handshake
E2E_CLEANUPS=("${E2E_CLEANUPS[@]/restore_handshake/}")
s=$(open_query "resilience" '.status == "ready" and .count > 0' 6)
check "with the right token again: results" "ready true" "$(jq -r '"\(.status) \(.count > 0)"' <<<"$s")"

echo "== settings: accelerators off"
write_settings '{"accelerators": false}'
s=$(open_query "resilience")
check "hints without the Alt keys" "↵ open     ⇥ actions     esc close" "$(jq -r .hints <<<"$s")"
ipc key alt+n >/dev/null
ipc key alt+t >/dev/null
pause 0.5
check "Alt+N / Alt+T do nothing" search "$(state | jq -r .view)"
ipc key tab >/dev/null
check "Tab still opens the actions" actions "$(wait_for '.view == "actions"' 3 | jq -r .view)"

echo "== settings: emptyQuery"
write_settings '{"emptyQuery": {"showOpen": false, "recent": "modified", "recentLimit": 3}}'
s=$(open_query "")
check "no open items, 3 recently modified" '["Recently modified","Recently modified","Recently modified"]' "$(jq -c '[.rows[].section]' <<<"$s")"
want=$(post /search '{"query": "", "emptyQuery": {"showOpen": false, "recent": "modified", "recentLimit": 3}}' | jq -c '[.recent[].key]')
check "…the bridge's newest three" "$want" "$(jq -c '[.rows[].key]' <<<"$s")"
write_settings '{"emptyQuery": {"recent": "none", "tabOrder": "tabbar"}}'
s=$(open_query "")
want=$(post /search '{"query": "", "emptyQuery": {"recent": "none", "tabOrder": "tabbar"}}' | jq -c '[.open[].key]')
check "recent none: only the open items, in tab-bar order" "$want" "$(jq -c '[.rows[].key]' <<<"$s")"
check "…all in the open section" true "$(jq '[.rows[].section] | all(. == "Open in Zotero")' <<<"$s")"

echo "== settings: maxResults"
write_settings '{"maxResults": 10}'
s=$(open_query "a")
check "10 rows for a broad query" 10 "$(jq .count <<<"$s")"

echo "== settings: invalid values are reported, defaults used"
write_settings '{"maxResults": "lots", "colour": "red"}'
s=$(open_query "a")
check "the footer names the first problem" "oma-zotero-launcher.json: maxResults must be a number from 10 to 200" "$(jq -r .footer <<<"$s")"
check "…and the default limit applies" 60 "$(jq .count <<<"$s")"
write_settings 'not json'
s=$(open_query "a")
check "a broken file is reported too" true "$(jq '.footer | startswith("oma-zotero-launcher.json: not valid JSON")' <<<"$s")"

echo "== settings: enterAction select"
write_settings '{"enterAction": "select"}'
SS=$(post /dev/samples '{}')
k=$(jq -r '.pdfNotOpen.key' <<<"$SS")
tabs0=$(post /dev/ui-state '{}' | jq -c '[.tabs[].id]')
select_item "$k" && ipc key enter >/dev/null
deadline=$((SECONDS + 6)); ui=""
while ((SECONDS <= deadline)); do ui=$(post /dev/ui-state '{}'); [[ $(jq -r --arg k "$k" '.selectedItemKeys | index($k) != null' <<<"$ui") == true ]] && break; pause 0.2; done
check "Enter selects the item in the library" "true zotero-pane" "$(jq -r --arg k "$k" '"\(.selectedItemKeys | index($k) != null) \(.selectedTabId)"' <<<"$ui")"
check "…instead of opening its PDF" "$tabs0" "$(jq -c '[.tabs[].id]' <<<"$ui")"

restore_settings
E2E_CLEANUPS=("${E2E_CLEANUPS[@]/restore_settings/}")
s=$(open_query "a")
check "settings removed: defaults, nothing reported" '60 ""' "$(jq -r '"\(.count) \(.footer | tojson)"' <<<"$s")"

e2e_finish
