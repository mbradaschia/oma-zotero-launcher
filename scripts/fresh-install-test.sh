#!/bin/bash
# "A fresh install following the README works end-to-end" (PLAN.md phase 6), both halves:
#
#  A. Zotero: the release .xpi (make xpi) in a brand-new Zotero profile, run headless with
#     its own data directory, port (23129) and runtime directory, so your Zotero, library
#     and handshake are untouched. Checks the bridge starts, is locked down, has no dev
#     routes, and indexes, searches, reads notes and edits tags on an item saved through
#     Zotero's own connector API. The throwaway profile is deleted afterwards.
#  B. Omarchy: the shell plugin installed the README's way, `omarchy plugin add <git-url>
#     --enable`, from a git clone of this checkout; then the real SUPER+SHIFT+Z opens it
#     and it searches your (real) Zotero. Your current install and shell.json are put
#     back exactly as they were.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ID=$(jq -r .id "$ROOT/manifest.json")
PORT=23129
pass=0
fail=0
check() { if [[ $3 == "$2" ]]; then echo "✔ $1"; ((pass++)); else echo "✖ $1: expected '$2', got '$3'"; ((fail++)); fi; }
pause() { timeout "$1" tail -f /dev/null; }
WORK=$(mktemp -d)
CLEANUPS=()
cleanup() { local c; for c in "${CLEANUPS[@]}"; do eval "$c"; done; CLEANUPS=(); rm -rf "$WORK"; }
trap cleanup EXIT

echo "== A. the release bridge in a fresh Zotero profile"
"$ROOT/scripts/build-xpi.sh" >/dev/null || { echo "✖ build-xpi failed"; exit 1; }
XPI="$ROOT/dist/oma-zotero-bridge-$(jq -r .version "$ROOT/zotero-bridge/manifest.json").xpi"
ADDON_ID=$(jq -r .applications.zotero.id "$ROOT/zotero-bridge/manifest.json")
P="$WORK/profile"
mkdir -p "$P/extensions" "$WORK/data" "$WORK/run"
chmod 700 "$WORK/run"
# A profile-scope .xpi is what Tools → Plugins → Install Plugin From File… also produces.
cp "$XPI" "$P/extensions/$ADDON_ID.xpi"
cat >"$P/user.js" <<EOF
user_pref("extensions.zotero.dataDir", "$WORK/data");
user_pref("extensions.zotero.useDataDir", true);
user_pref("extensions.zotero.httpServer.port", $PORT);
user_pref("extensions.autoDisableScopes", 14);
user_pref("extensions.update.enabled", false);
user_pref("app.update.enabled", false);
user_pref("extensions.zotero.automaticScraperUpdates", false);
user_pref("extensions.zotero.sync.autoSync", false);
user_pref("extensions.zoteroOpenOfficeIntegration.skipInstallation", true);
EOF
# (skipInstallation: a new profile would otherwise try to install Zotero's LibreOffice
# plugin into *your* LibreOffice with unopkg on its first start.)
env -u WAYLAND_DISPLAY -u DISPLAY XDG_RUNTIME_DIR="$WORK/run" MOZ_HEADLESS=1 \
  setsid /usr/lib/zotero/zotero -profile "$P" -no-remote >"$WORK/zotero.log" 2>&1 &
stop_zotero() {
  local pids
  pids=$(pgrep -f -- "-profile $P") || return 0
  kill -TERM $pids 2>/dev/null
  for _ in $(seq 1 20); do pgrep -f -- "-profile $P" >/dev/null || return 0; pause 0.5; done
  kill -KILL $(pgrep -f -- "-profile $P") 2>/dev/null
}
CLEANUPS+=("stop_zotero")
HS="$WORK/run/oma-zotero/bridge.json"
for _ in $(seq 1 90); do [[ -s $HS ]] && break; pause 1; done
check "the bridge starts and writes its handshake" true "$([[ -s $HS ]] && echo true || echo false)"
check "…private: dir 700, file 600" "700 600" "$(stat -c %a "$WORK/run/oma-zotero") $(stat -c %a "$HS" 2>/dev/null)"
check "…on the profile's port" "$PORT" "$(jq .port "$HS" 2>/dev/null)"
check "your own Zotero's handshake is untouched" true "$([[ $(jq .port "$XDG_RUNTIME_DIR/oma-zotero/bridge.json") != "$PORT" ]] && echo true || echo false)"
T=$(jq -r .token "$HS" 2>/dev/null)
B="http://127.0.0.1:$PORT/oma-zotero"
q() { curl -s --max-time 30 -H "Zotero-Allowed-Request: 1" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "$2" "$B$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
ping=$(curl -s -H "Zotero-Allowed-Request: 1" -H "Authorization: Bearer $T" "$B/ping")
check "ping: release build, no dev mode" "true $(jq -r .version "$ROOT/zotero-bridge/manifest.json") false" "$(jq -r '"\(.ok) \(.bridgeVersion) \(.dev)"' <<<"$ping")"
check "no token → 401" 401 "$(code -H "Zotero-Allowed-Request: 1" "$B/ping")"
check "dev routes are not in the release" 404 "$(code -H "Zotero-Allowed-Request: 1" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{}' "$B/dev/echo")"
check "an empty library searches fine" "true 0" "$(q /search '{"query": ""}' | jq -r '"\(.ok) \(.recent | length)"')"
saved=$(code -H 'Content-Type: application/json' -H 'X-Zotero-Connector-API-Version: 3' -d '{
  "uri": "http://example.org/fresh", "items": [{ "id": "i1", "itemType": "journalArticle",
  "title": "Fresh Install Resilience Study", "date": "2024",
  "creators": [{ "firstName": "Ada", "lastName": "Tester", "creatorType": "author" }],
  "tags": [{ "tag": "fresh-tag" }],
  "notes": [{ "note": "<h1>Summary</h1><p>First.</p><p>A <a href=\"https://example.org\">link</a>.</p><table><tr><td><p>A</p></td><td><p>B</p></td></tr><tr><td>1</td><td>2</td></tr></table>" }] }] }' \
  "http://127.0.0.1:$PORT/connector/saveItems")
check "an item saved through Zotero's connector API" 201 "$saved"
r=""
for _ in $(seq 1 20); do r=$(q /search '{"query": "tester resil 2024"}'); [[ $(jq .total <<<"$r") == 1 ]] && break; pause 0.25; done
check "…is indexed and found by author + title + year" "1 Fresh Install Resilience Study" "$(jq -r '"\(.total) \(.results[0].title)"' <<<"$r")"
k=$(jq -r '.results[0].key' <<<"$r")
d=$(q /item "$(jq -nc --arg k "$k" '{key: $k}')")
check "…its note and automatic tag" "Summary fresh-tag 1" "$(jq -r '"\(.notes[0].title) \(.tags[0].tag) \(.tags[0].type)"' <<<"$d")"
# A new profile installs Zotero's translators in the background after startup; until the
# Note Markdown translator is there, notes come back as plain text (format "text").
for _ in $(seq 1 30); do
  n=$(q /note "$(jq -nc --arg k "$(jq -r '.notes[0].key' <<<"$d")" '{key: $k, linkColor: "#123456"}')")
  [[ $(jq -r .format <<<"$n") == markdown ]] && break
  pause 1
done
check "…the note converts (plain text while translators install, then Markdown)" markdown "$(jq -r .format <<<"$n")"
check "…the note as Markdown: table and colored link" "true true" \
  "$(jq -r '"\(.markdown | contains("| A | B |\n| --- | --- |\n| 1 | 2 |")) \(.markdown | contains("style=\"color:#123456\""))"' <<<"$n")"
u=$(q /tags/update "$(jq -nc --arg k "$k" '{key: $k, add: ["added-here"]}')")
check "…a tag added through the bridge" '["added-here","fresh-tag"]' "$(jq -c '[.tags[].tag] | sort' <<<"$u")"
for _ in $(seq 1 20); do r=$(q /search '{"query": "#added-here"}'); [[ $(jq .total <<<"$r") == 1 ]] && break; pause 0.25; done
check "…and search finds it by that tag" "$k" "$(jq -r '.results[0].key' <<<"$r")"
stop_zotero
check "the throwaway Zotero stopped" false "$(pgrep -f -- "-profile $P" >/dev/null && echo true || echo false)"

echo "== B. the Omarchy plugin installed with 'omarchy plugin add <git-url> --enable'"
PLUGINS="$HOME/.config/omarchy/plugins"
SHELL_JSON="$HOME/.config/omarchy/shell.json"
cp -p "$SHELL_JSON" "$WORK/shell.json.bak"
was_enabled=$(omarchy-shell shell listPlugins | jq -r --arg id "$ID" '.[] | select(.id == $id) | .enabled')
if [[ -e $PLUGINS/$ID ]]; then
  [[ $was_enabled == true ]] && omarchy plugin disable "$ID" >/dev/null
  mv "$PLUGINS/$ID" "$WORK/installed"
fi
restore_plugin() {
  [[ -d $PLUGINS/$ID/.git ]] && omarchy plugin remove "$ID" --yes >/dev/null 2>&1
  rm -rf "${PLUGINS:?}/$ID"
  [[ -d $WORK/installed ]] && mv "$WORK/installed" "$PLUGINS/$ID"
  omarchy-shell shell rescanPlugins >/dev/null 2>&1
  cmp -s "$SHELL_JSON" "$WORK/shell.json.bak" || cp -p "$WORK/shell.json.bak" "$SHELL_JSON"
  [[ $was_enabled == true ]] && omarchy plugin enable "$ID" >/dev/null 2>&1
  cmp -s "$SHELL_JSON" "$WORK/shell.json.bak" || cp -p "$WORK/shell.json.bak" "$SHELL_JSON"
}
CLEANUPS+=("restore_plugin")
# A git repo of this checkout, as if cloned from GitHub (what `git ls-files` would publish).
mkdir "$WORK/repo"
rsync -a --exclude '.git' --exclude 'dist' --exclude 'node_modules' "$ROOT/" "$WORK/repo/"
git -C "$WORK/repo" init -q
git -C "$WORK/repo" add -A
git -C "$WORK/repo" -c user.name=test -c user.email=test@localhost commit -qm "fresh install test"
out=$(omarchy plugin add "file://$WORK/repo" --enable --yes 2>&1)
check "omarchy plugin add clones, validates and enables it" true "$(grep -q "Added $ID" <<<"$out" && echo true || echo false)"
check "…installed as a git checkout" true "$([[ -d $PLUGINS/$ID/.git ]] && echo true || echo false)"
check "…enabled in the shell" true "$(omarchy-shell shell listPlugins | jq -r --arg id "$ID" '.[] | select(.id == $id) | .enabled')"
up=false
for _ in $(seq 1 40); do omarchy-shell oma-zotero state >/dev/null 2>&1 && { up=true; break; }; pause 0.25; done
check "…its overlay is loaded (IPC answers)" true "$up"
check "the README's keybinding is in place" true \
  "$(hyprctl binds -j | jq --arg id "$ID" 'any(.[]; (.description // "" | test("Zotero")) or ((.arg // "") | contains($id)))')"
if $up; then
  "$ROOT/scripts/uinput-keys.py" super+shift+z
  s=""
  for _ in $(seq 1 60); do s=$(omarchy-shell oma-zotero state); jq -e '.opened and .keyboardFocus and (.loading | not)' <<<"$s" >/dev/null && break; pause 0.1; done
  check "SUPER+SHIFT+Z opens it with keyboard focus" "true true" "$(jq -r '"\(.opened) \(.keyboardFocus)"' <<<"$s")"
  omarchy-shell oma-zotero type "resilience" >/dev/null
  for _ in $(seq 1 60); do s=$(omarchy-shell oma-zotero state); jq -e '.shownQuery == "resilience" and (.loading | not)' <<<"$s" >/dev/null && break; pause 0.1; done
  check "…and searches your Zotero" "ready true" "$(jq -r '"\(.status) \(.count > 0)"' <<<"$s")"
  omarchy-shell oma-zotero key tab >/dev/null
  for _ in $(seq 1 50); do s=$(omarchy-shell oma-zotero state); jq -e '.view == "actions" and .detailsLoaded' <<<"$s" >/dev/null && break; pause 0.1; done
  check "…Tab shows the item's actions, tags included" "actions true" "$(jq -r '"\(.view) \([.actionRows[].rowId] | index("tags") != null)"' <<<"$s")"
  for _ in 1 2 3; do omarchy-shell oma-zotero key escape >/dev/null; done
fi
restore_plugin
CLEANUPS=("${CLEANUPS[@]/restore_plugin/}")
check "your install is back" true "$([[ -f $PLUGINS/$ID/manifest.json && ! -d $PLUGINS/$ID/.git ]] && echo true || echo false)"
check "…enabled as before" "$was_enabled" "$(omarchy-shell shell listPlugins | jq -r --arg id "$ID" '.[] | select(.id == $id) | .enabled')"
check "…shell.json unchanged" true "$(cmp -s "$SHELL_JSON" "$WORK/shell.json.bak" && echo true || echo false)"

echo "== $pass passed, $fail failed"
((fail == 0))
