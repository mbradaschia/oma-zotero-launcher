#!/bin/bash
# Load zotero-bridge/ unpacked (from source) into your Zotero profile, for development.
#
#   scripts/bridge-dev-link.sh           link (Zotero must be closed; start it afterwards)
#   scripts/bridge-dev-link.sh --unlink  remove the link and the dev prefs (Zotero closed)
#
# Why each step (verified in Zotero 10.0.3 / Gecko 140 source):
# - A text file named after the add-on id in <profile>/extensions/ whose first line is the
#   source directory is an "extension proxy file" (XPIProvider _readLinkFile).
# - With extensions.startupScanScopes=0 Zotero only rescans the profile's extensions dir
#   when it thinks the app changed, hence dropping extensions.lastAppBuildId/lastAppVersion.
# - A newly detected profile-scope add-on is a "foreign install" and starts disabled because
#   extensions.autoDisableScopes=15 includes the profile scope (1). We set 14 for this one
#   startup; the bridge clears it again on start (dev.restoreAutoDisableScopes marker).
# - After this, iterate without restarting: POST /oma-zotero/dev/reload (make bridge-reload).
set -euo pipefail

ADDON_ID="oma-zotero-bridge@mbradaschia.github.io"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../zotero-bridge" && pwd)"
ZOTERO_HOME="${ZOTERO_HOME:-$HOME/.zotero/zotero}"

fail() { echo "bridge-dev-link: $*" >&2; exit 1; }

profile_dir() {
  local ini="$ZOTERO_HOME/profiles.ini" path rel
  [[ -f $ini ]] || fail "no profiles.ini in $ZOTERO_HOME"
  path=$(awk -F= '/^\[Profile/{p=""; r=1} /^Path=/{p=$2} /^IsRelative=/{r=$2} /^Default=1/{print r ":" p; exit}' "$ini")
  [[ -n $path ]] || path=$(awk -F= '/^IsRelative=/{r=$2} /^Path=/{print r ":" $2; exit}' "$ini")
  rel=${path%%:*}; path=${path#*:}
  [[ $rel == 1 ]] && path="$ZOTERO_HOME/$path"
  [[ -d $path ]] || fail "profile dir not found: $path"
  echo "$path"
}

pgrep -x zotero-bin >/dev/null && fail "Zotero is running; quit it first (prefs.js is rewritten on exit)"

PROFILE=$(profile_dir)
PREFS="$PROFILE/prefs.js"
PROXY="$PROFILE/extensions/$ADDON_ID"
[[ -f $PREFS ]] || fail "missing $PREFS"

cp -p "$PREFS" "$PREFS.oma-zotero.bak.$(date +%s)"

strip_prefs() {
  local tmp
  tmp=$(mktemp)
  grep -v -E '"extensions\.(lastAppBuildId|lastAppVersion|autoDisableScopes|oma-zotero-bridge\.dev(\.restoreAutoDisableScopes)?)"' "$PREFS" > "$tmp" || true
  cat "$tmp" > "$PREFS" # rewrite in place: keeps prefs.js's 0600 mode
  rm -f "$tmp"
}

if [[ ${1:-} == --unlink ]]; then
  rm -f "$PROXY"
  strip_prefs
  echo "Unlinked $ADDON_ID. Start Zotero; it will drop the add-on on its next scan."
  exit 0
fi

strip_prefs
cat >> "$PREFS" <<'EOF'
user_pref("extensions.autoDisableScopes", 14);
user_pref("extensions.oma-zotero-bridge.dev", true);
user_pref("extensions.oma-zotero-bridge.dev.restoreAutoDisableScopes", true);
EOF

mkdir -p "$PROFILE/extensions"
printf '%s\n' "$SRC" > "$PROXY"

echo "Linked $ADDON_ID -> $SRC"
echo "Profile: $PROFILE (prefs.js backed up)"
echo "Now start Zotero, e.g.: uwsm-app -- zotero"
