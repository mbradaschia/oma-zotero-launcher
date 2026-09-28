#!/bin/bash
# Gracefully restart Zotero (session saved, tabs restored) via the dev bridge.
# Only needed after editing zotero-bridge/bootstrap.js: Zotero caches it until
# restart, whereas lib/*.js changes are picked up by `make bridge-reload`.
set -euo pipefail

D="${XDG_RUNTIME_DIR:?}/oma-zotero"
H="$D/bridge.json"
[[ -r $H ]] || { echo "bridge not running (no $H)" >&2; exit 1; }
T=$(jq -r .token "$H")
B="http://127.0.0.1:$(jq -r .port "$H")/oma-zotero"
HDR=(-H "Zotero-Allowed-Request: 1" -H "Authorization: Bearer $T")
focus=$(hyprctl activewindow -j 2>/dev/null | jq -r '.address // empty')

# The new bridge rewrites the handshake file (tmp + rename) once Zotero is back.
inotifywait -q -t 120 -e moved_to --include 'bridge\.json$' "$D" >/dev/null &
waiter=$!
curl -sf "${HDR[@]}" -H 'Content-Type: application/json' -d '{}' "$B/dev/restart" >/dev/null
wait "$waiter" || { echo "timed out waiting for Zotero to come back" >&2; exit 1; }

# Zotero's window takes focus when it maps; hand it back.
if [[ -n $focus ]]; then
  hyprctl dispatch "hl.dsp.focus({ window = \"address:$focus\" })" >/dev/null 2>&1 ||
    hyprctl dispatch focuswindow "address:$focus" >/dev/null 2>&1 || true
fi
T=$(jq -r .token "$H")
curl -s --retry 30 --retry-delay 1 --retry-all-errors -f -H "Zotero-Allowed-Request: 1" -H "Authorization: Bearer $T" "$B/ping" |
  jq -c '{restarted: true, bridgeVersion, openCount}'
