#!/bin/bash
# Install or update Zotero Launcher from the Nightly release, in one go:
#
#   gh release download nightly -R mbradaschia/zotero-launcher-macos -p install.sh -O - | bash
#
# or, with a zip you already have:  bash install.sh ~/Downloads/ZoteroLauncher.zip
#
# Downloads ZoteroLauncher.zip (with the GitHub CLI: the repository is private), checks it is a
# whole zip of an app this Mac can run, replaces /Applications/ZoteroLauncher.app with it, clears
# the download quarantine (the app is signed ad hoc, not notarized) and opens it. DEST=~/Applications
# installs it there instead; NO_OPEN=1 doesn't open it (CI).
set -euo pipefail

REPO=mbradaschia/zotero-launcher-macos
BUNDLE_ID=io.github.mbradaschia.zotero-launcher
DEST=${DEST:-/Applications}
APP="$DEST/ZoteroLauncher.app"

fail() { echo "install: $*" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [[ $# -ge 1 ]]; then
  zip=$1
  [[ -f $zip ]] || fail "no such file: $zip"
else
  command -v gh >/dev/null || fail "needs the GitHub CLI: brew install gh, then gh auth login"
  echo "Downloading the nightly build…"
  gh release download nightly -R "$REPO" -p ZoteroLauncher.zip -D "$work" || fail "couldn't download it (gh auth login?)"
  zip=$work/ZoteroLauncher.zip
fi
unzip -tq "$zip" >/dev/null 2>&1 || fail "$zip isn't a whole zip (a broken download?): download it again"

ditto -x -k "$zip" "$work/unpacked"
new="$work/unpacked/ZoteroLauncher.app"
[[ -d $new ]] || fail "the zip doesn't hold ZoteroLauncher.app"
[[ $(plutil -extract CFBundleIdentifier raw "$new/Contents/Info.plist") == "$BUNDLE_ID" ]] || fail "the zip holds some other app"

# This Mac can run it: its processor, its macOS.
mac_arch=$(uname -m)
app_archs=$(lipo -archs "$new/Contents/MacOS/ZoteroLauncher")
[[ " $app_archs " == *" $mac_arch "* ]] || fail "the app is built for $app_archs; this Mac is $mac_arch"
need=$(plutil -extract LSMinimumSystemVersion raw "$new/Contents/Info.plist")
have=$(sw_vers -productVersion)
[[ ${have%%.*} -ge ${need%%.*} ]] || fail "the app needs macOS $need or newer; this Mac has $have"
codesign --verify --deep "$new" 2>/dev/null || fail "the app's signature doesn't check out: download it again"

# Replace the installed copy, only if it is ours.
if [[ -e $APP ]]; then
  [[ $(plutil -extract CFBundleIdentifier raw "$APP/Contents/Info.plist" 2>/dev/null) == "$BUNDLE_ID" ]] ||
    fail "$APP exists and isn't Zotero Launcher: not replacing it"
  pkill -x ZoteroLauncher 2>/dev/null && sleep 1 || true
  rm -rf "$APP"
fi
mkdir -p "$DEST"
mv "$new" "$APP"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

[[ -n ${NO_OPEN:-} ]] || open "$APP"
echo "Installed $APP ($app_archs, macOS $need+). It's in the menu bar; press ⌃⌥Z with Zotero running."
