#!/bin/bash
# Get the Zotero plugin (the bridge): the latest release's .xpi, checked against its SHA-256,
# saved in Downloads, its path copied to the clipboard; Zotero is started if it isn't running.
# Zotero installs it from its own window (Tools → Plugins → ⚙ → Install Plugin From File…);
# nothing here touches your Zotero profile. Settings › Setup and the launcher's results run it.
# Prints the file's path.
set -euo pipefail
REPO=${OMA_ZOTERO_REPO:-mbradaschia/oma-zotero-launcher}
fail() { echo "install-bridge: $*" >&2; exit 1; }
command -v curl >/dev/null || fail "needs curl"
command -v jq >/dev/null || fail "needs jq"

DL=${OMA_DOWNLOAD_DIR:-$(xdg-user-dir DOWNLOAD 2>/dev/null || true)}
[[ -n $DL && -d $DL ]] || DL="$HOME/Downloads"
mkdir -p "$DL"

release=$(curl -fsSL --retry 2 "https://api.github.com/repos/$REPO/releases/latest") || fail "can't reach GitHub's releases for $REPO"
url=$(jq -r '[.assets[] | select(.name | endswith(".xpi"))][0].browser_download_url // empty' <<<"$release")
sumurl=$(jq -r '[.assets[] | select(.name | endswith(".xpi.sha256"))][0].browser_download_url // empty' <<<"$release")
[[ -n $url ]] || fail "the latest release has no .xpi"
name=$(basename "$url")
out="$DL/$name"

curl -fsSL --retry 2 -o "$out.part" "$url" || fail "the download failed"
if [[ -n $sumurl ]]; then
  want=$(curl -fsSL --retry 2 "$sumurl" | cut -d' ' -f1)
  got=$(sha256sum "$out.part" | cut -d' ' -f1)
  [[ $want == "$got" ]] || { rm -f "$out.part"; fail "the download doesn't match its SHA-256: not installing it"; }
fi
mv "$out.part" "$out"

[[ -n ${OMA_NO_CLIPBOARD:-} ]] || { command -v wl-copy >/dev/null && printf %s "$out" | wl-copy 2>/dev/null; } || true
# Zotero: the launcher's Zotero command (ZOTERO_CMD), else zotero on PATH.
read -ra ZCMD <<<"${ZOTERO_CMD:-zotero}"
pgrep -x zotero-bin >/dev/null || pgrep -x zotero >/dev/null || { command -v "${ZCMD[0]}" >/dev/null && setsid uwsm-app -- "${ZCMD[@]}" >/dev/null 2>&1 < /dev/null & } || true
echo "$out"
