#!/bin/bash
# Get the Zotero plugin (the bridge): its latest release's .xpi, checked against its SHA-256,
# saved in Downloads, its path copied to the clipboard; Zotero is started if it isn't running.
# Zotero installs it from its own window (Tools → Plugins → ⚙ → Install Plugin From File…);
# nothing here touches your Zotero profile. Settings › Setup and the launcher's results run it.
# Prints the file's path.
set -euo pipefail
REPO=${OMA_ZOTERO_REPO:-mbradaschia/zotero-companion-launcher}
fail() { echo "install-bridge: $*" >&2; exit 1; }
command -v curl >/dev/null || fail "needs curl"
command -v jq >/dev/null || fail "needs jq"

DL=${OMA_DOWNLOAD_DIR:-$(xdg-user-dir DOWNLOAD 2>/dev/null || true)}
[[ -n $DL && -d $DL ]] || DL="$HOME/Downloads"
mkdir -p "$DL"

# The bridge's newest release: a vX.Y.Z tag that isn't a draft or a prerelease and has an .xpi. Not
# GitHub's "latest": this repository also releases the Mac app (macos-v*), which may be the newest.
# OMA_ZOTERO_RELEASES_FILE reads the list from a file, OMA_ZOTERO_DRY_RUN prints the pick (tests).
if [[ -n ${OMA_ZOTERO_RELEASES_FILE:-} ]]; then
  releases=$(cat "$OMA_ZOTERO_RELEASES_FILE")
else
  releases=$(curl -fsSL --retry 2 "https://api.github.com/repos/$REPO/releases?per_page=30") || fail "can't reach GitHub's releases for $REPO"
fi
release=$(jq -c '[.[] | select((.tag_name | test("^v[0-9]")) and (.draft | not) and (.prerelease | not) and any(.assets[]; .name | endswith(".xpi")))][0] // empty' <<<"$releases")
[[ -n $release ]] || fail "no release of the bridge (a vX.Y.Z release with an .xpi) in $REPO"
url=$(jq -r '[.assets[] | select(.name | endswith(".xpi"))][0].browser_download_url // empty' <<<"$release")
sumurl=$(jq -r '[.assets[] | select(.name | endswith(".xpi.sha256"))][0].browser_download_url // empty' <<<"$release")
[[ -n $url ]] || fail "the bridge's release has no .xpi"
if [[ -n ${OMA_ZOTERO_DRY_RUN:-} ]]; then echo "$url"; exit 0; fi
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
