#!/bin/bash
# Build the Zotero bridge for release:
#   dist/oma-zotero-launcher-<version>.xpi the add-on (install it in Zotero: Tools → Plugins →
#                                         ⚙ → Install Plugin From File…); dev routes left out
#   dist/oma-zotero-launcher-<version>.xpi.sha256
#   zotero-bridge/updates.json            the update manifest Zotero polls (manifest.json's
#                                         update_url), pointing at the GitHub release asset
# The zip is reproducible: fixed file order, timestamps and modes, so the same sources give
# the same sha256 (which updates.json pins) on any machine: the release workflow rebuilds
# the .xpi from the tag and checks it against the committed updates.json.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SRC="$ROOT/zotero-bridge"
VERSION=$(jq -r .version "$SRC/manifest.json")
ID=$(jq -r .applications.zotero.id "$SRC/manifest.json")
MIN=$(jq -r .applications.zotero.strict_min_version "$SRC/manifest.json")
MAX=$(jq -r .applications.zotero.strict_max_version "$SRC/manifest.json")
REPO_URL=${OMA_ZOTERO_REPO_URL:-https://github.com/mbradaschia/oma-zotero-launcher}
NAME="oma-zotero-launcher-$VERSION.xpi"
OUT="$ROOT/dist/$NAME"

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp "$SRC/manifest.json" "$SRC/bootstrap.js" "$SRC/prefs.js" "$stage/"
mkdir "$stage/lib"
for f in "$SRC"/lib/*.js; do
  [[ $(basename "$f") == dev.js ]] && continue # dev routes: dev builds only (make bridge-link)
  cp "$f" "$stage/lib/"
done
# Every module the loader requires must be in the package (dev is optional).
missing=$(node -e '
  const src = require("fs").readFileSync(process.argv[1], "utf8");
  const mods = JSON.parse(/OMA_MODULES = (\[[^\]]*\])/.exec(src)[1]);
  const optional = JSON.parse(/OMA_OPTIONAL_MODULES = (\[[^\]]*\])/.exec(src)[1]);
  const fs = require("fs");
  console.log(mods.filter((m) => !optional.includes(m) && !fs.existsSync(process.argv[2] + "/lib/" + m + ".js")).join(" "));
' "$SRC/lib/loader.js" "$stage")
[[ -z $missing ]] || { echo "build-xpi: modules missing from the package: $missing" >&2; exit 1; }
for f in "$stage"/*.js "$stage"/lib/*.js; do node --check "$f"; done

mkdir -p "$ROOT/dist"
rm -f "$OUT"
find "$stage" -type f -exec chmod 0644 {} +
find "$stage" -exec touch -h -d '2026-01-01T00:00:00Z' {} +
(cd "$stage" && find . -type f | sed 's|^\./||' | LC_ALL=C sort | TZ=UTC zip -q -X -D -@ "$OUT")
SHA=$(sha256sum "$OUT" | cut -d' ' -f1)
(cd "$ROOT/dist" && sha256sum "$NAME" >"$NAME.sha256")

jq -n --arg id "$ID" --arg v "$VERSION" --arg link "$REPO_URL/releases/download/v$VERSION/$NAME" \
  --arg hash "sha256:$SHA" --arg min "$MIN" --arg max "$MAX" '{
    addons: { ($id): { updates: [{
      version: $v, update_link: $link, update_hash: $hash,
      applications: { zotero: { strict_min_version: $min, strict_max_version: $max } }
    }] } }
  }' >"$SRC/updates.json"

echo "built $OUT ($(du -h "$OUT" | cut -f1), sha256 $SHA)"
echo "wrote zotero-bridge/updates.json → $REPO_URL/releases/download/v$VERSION/$NAME"
