#!/bin/bash
# The three parts share one version (semver): the Omarchy plugin (manifest.json), the
# Zotero bridge (zotero-bridge/manifest.in.json) and the prompt runner (daemon/package.json).
#   scripts/check-versions.sh            they agree → prints it
#   scripts/check-versions.sh 1.2.3      …and it is 1.2.3 (the release workflow passes the tag)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
plugin=$(jq -r .version manifest.json)
bridge=$(jq -r .version zotero-bridge/manifest.in.json)
runner=$(jq -r .version daemon/package.json)
lock=$(jq -r .version daemon/package-lock.json)
if [[ $plugin != "$bridge" || $plugin != "$runner" || $plugin != "$lock" ]]; then
  echo "versions differ: manifest.json $plugin, zotero-bridge/manifest.in.json $bridge, daemon/package.json $runner, daemon/package-lock.json $lock" >&2
  exit 1
fi
[[ $plugin =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "not a semver version: $plugin" >&2; exit 1; }
if [[ -n ${1:-} && $1 != "$plugin" ]]; then
  echo "the tag says $1, the manifests say $plugin" >&2
  exit 1
fi
echo "$plugin"
