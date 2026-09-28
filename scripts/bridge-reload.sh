#!/bin/bash
# Hot-reload the dev-linked Zotero bridge (re-reads zotero-bridge/lib/*.js)
# without restarting Zotero. Needs the dev pref (set by bridge-dev-link.sh).
set -euo pipefail

D="${XDG_RUNTIME_DIR:?}/oma-zotero"
H="$D/bridge.json"
[[ -r $H ]] || { echo "bridge not running (no $H)" >&2; exit 1; }
T=$(jq -r .token "$H")
B="http://127.0.0.1:$(jq -r .port "$H")/oma-zotero"
HDR=(-H "Zotero-Allowed-Request: 1" -H "Authorization: Bearer $T")

# The bridge rewrites its handshake file (tmp + rename) once it is back up.
inotifywait -q -t 30 -e moved_to --include 'bridge\.json$' "$D" >/dev/null &
waiter=$!
curl -sf "${HDR[@]}" -H 'Content-Type: application/json' -d '{}' "$B/dev/reload" >/dev/null
wait "$waiter" || { echo "timed out waiting for the bridge to come back" >&2; exit 1; }
curl -s --retry 20 --retry-delay 1 --retry-all-errors -f "${HDR[@]}" "$B/ping" |
  jq -c '{reloaded: true, bridgeVersion, index: (if .index.builtAt then "\(.index.count) entries" else "building in background" end)}'
