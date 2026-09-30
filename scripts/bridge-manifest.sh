#!/bin/bash
# zotero-bridge/manifest.json, generated from zotero-bridge/manifest.in.json (the one in git).
# Zotero needs manifest.json in the add-on's folder; the repository keeps it under another name
# because the Omarchy Plugin Marketplace takes a manifest.json there for a second Omarchy plugin
# (it lists repositories with exactly one). build-xpi.sh, bridge-dev-link.sh and release.sh run it.
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../zotero-bridge" && pwd)"
cmp -s "$SRC/manifest.in.json" "$SRC/manifest.json" 2>/dev/null || cp "$SRC/manifest.in.json" "$SRC/manifest.json"
