#!/bin/bash
# Shared helpers for the end-to-end scripts (source it). They drive the live
# overlay through its IPC target (omarchy-shell oma-zotero-launcher …) and read Zotero's
# state through the dev bridge (make bridge-link).

E2E_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
H="${XDG_RUNTIME_DIR:?}/oma-zotero/bridge.json"
[[ -r $H ]] || { echo "no bridge handshake at $H (is Zotero running with the bridge?)" >&2; exit 2; }
T=$(jq -r .token "$H")
B="http://127.0.0.1:$(jq -r .port "$H")/oma-zotero"

pass=0
fail=0
check() { if [[ $3 == "$2" ]]; then echo "✔ $1"; ((pass++)); else echo "✖ $1: expected '$2', got '$3'"; ((fail++)); fi; }
post() { curl -s -H "Zotero-Allowed-Request: 1" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "$2" "$B$1"; }
ipc() { omarchy-shell oma-zotero-launcher "$@" 2>/dev/null; }
state() { ipc state; }
pause() { timeout "$1" tail -f /dev/null; }
wait_for() { # <jq condition on overlay state> [seconds] → prints the last state; status 1 on timeout
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
key_json() { jq -nc --arg k "$1" '{key: $k}'; }
close_overlay() { local i; for i in 1 2 3; do [[ $(state | jq -r .opened) == true ]] || return 0; ipc key escape >/dev/null; done; }

# A search query that finds this title: the query syntax's operators (| ! # ' ^ $ :) dropped.
query_for() { sed "s/[|!#'^\$:]/ /g; s/  */ /g; s/^ //; s/ $//" <<<"$1" | cut -c1-80; }

# Open the overlay and put item <key> under the cursor in the search view.
select_item() {
  local key=$1 title q s idx i
  title=$(post /item "$(key_json "$key")" | jq -r .item.title)
  q=$(query_for "$title")
  close_overlay
  ipc search "$q" >/dev/null
  s=$(wait_for '.opened and (.loading | not) and .shownQuery == .filterText and .count > 0' 6)
  idx=$(jq --arg k "$key" '[.rows[].key] | index($k)' <<<"$s")
  if [[ $idx == null ]]; then
    echo "✖ $key not found for query \"$q\""
    ((fail++))
    return 1
  fi
  for ((i = 0; i < idx; i++)); do ipc key down >/dev/null; done
  wait_for "(.selectedIndex == $idx)" 3 >/dev/null
}

# Snapshot the focused window and Zotero's tabs/selection; restore them on exit.
E2E_FOCUS=$(hyprctl activewindow -j | jq -r .address)
E2E_UI0=$(post /dev/ui-state '{}')
E2E_CLEANUPS=()
e2e_restore() {
  local c
  for c in "${E2E_CLEANUPS[@]}"; do eval "$c"; done
  E2E_CLEANUPS=()
  close_overlay
  post /dev/ui-restore "$(jq -c '{state: .}' <<<"$E2E_UI0")" >/dev/null
  hyprctl dispatch "hl.dsp.focus({ window = \"address:$E2E_FOCUS\" })" >/dev/null 2>&1
}
trap e2e_restore EXIT

# Final checks: Zotero looks as it did, then the summary line and exit status.
e2e_finish() {
  e2e_restore
  trap - EXIT
  local ui1
  ui1=$(post /dev/ui-state '{}')
  check "Zotero tabs restored" "$(jq -c '[.tabs[] | [.topKey, .type]]' <<<"$E2E_UI0")" "$(jq -c '[.tabs[] | [.topKey, .type]]' <<<"$ui1")"
  check "Zotero selection restored" "$(jq -c '.selectedItemKeys | sort' <<<"$E2E_UI0")" "$(jq -c '.selectedItemKeys | sort' <<<"$ui1")"
  echo "== $pass passed, $fail failed"
  ((fail == 0))
}

# Real keys: the keybinding through a kernel uinput keyboard, then typing with wtype.
real_open() {
  close_overlay
  "$E2E_ROOT/scripts/uinput-keys.py" super+shift+z
  wait_for '.opened and .keyboardFocus and (.loading | not)' 6 >/dev/null ||
    { echo "✖ overlay never got keyboard focus; not typing"; ((fail++)); return 1; }
}
