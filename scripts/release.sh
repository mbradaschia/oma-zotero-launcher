#!/bin/bash
# Cut a release: make release VERSION=1.2.3 (semver: breaking.feature.fix).
#
#   1. checks: clean tree on master, the tag is new, the CHANGELOG's [Unreleased] has entries
#   2. sets the version in manifest.json, zotero-bridge/manifest.in.json, daemon/package.json
#      (+ its lockfile)
#   3. dates the CHANGELOG: [Unreleased] → [1.2.3] - YYYY-MM-DD, with its compare link
#   4. runs the tests, builds dist/oma-zotero-launcher-1.2.3.xpi and zotero-bridge/updates.json
#   5. commits "Release v1.2.3" and tags v1.2.3 (annotated)
#
# Nothing is pushed: check the commit, then `git push origin master v1.2.3`. The tag starts
# .github/workflows/release.yml, which rebuilds the .xpi, checks it byte for byte against
# updates.json, and publishes the GitHub release with it. Zotero updates installed bridges
# from updates.json on master (manifest.json's update_url); `omarchy plugin update` pulls
# the shell plugin from master.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
VERSION=${1:-}
BRANCH=${RELEASE_BRANCH:-master}
REPO_URL=${OMA_ZOTERO_REPO_URL:-https://github.com/mbradaschia/oma-zotero-launcher}

fail() { echo "release: $*" >&2; exit 1; }

[[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "usage: make release VERSION=X.Y.Z (semver)"
[[ -z $(git status --porcelain) ]] || fail "the working tree has changes: commit or stash them first"
[[ $(git branch --show-current) == "$BRANCH" ]] || fail "releases are cut from $BRANCH (RELEASE_BRANCH=… to override)"
git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null && fail "tag v$VERSION already exists"

current=$(scripts/check-versions.sh)
newest=$(printf '%s\n%s\n' "$current" "$VERSION" | sort -V | tail -1)
[[ $newest == "$VERSION" ]] || fail "$VERSION is older than the current $current"
if [[ $VERSION == "$current" ]] && git tag -l 'v*' | grep -q .; then
  fail "$VERSION is already the current version: pick the next one"
fi

# The [Unreleased] section must say what changed.
notes=$(awk '/^## \[Unreleased\]/{f=1; next} /^## \[/{f=0} f' CHANGELOG.md | grep -v '^\s*$' || true)
[[ -n $notes ]] || fail "CHANGELOG.md: [Unreleased] is empty; list the changes first"

echo "== version $current → $VERSION"
tmp=$(mktemp)
for f in manifest.json zotero-bridge/manifest.in.json daemon/package.json; do
  jq --indent 2 --arg v "$VERSION" '.version = $v' "$f" >"$tmp" && cat "$tmp" >"$f"
done
jq --indent 2 --arg v "$VERSION" '.version = $v | .packages[""].version = $v' daemon/package-lock.json >"$tmp" && cat "$tmp" >daemon/package-lock.json
rm -f "$tmp"
scripts/check-versions.sh "$VERSION" >/dev/null
scripts/bridge-manifest.sh # the dev-linked bridge gets the new version too

echo "== CHANGELOG"
today=$(date -u +%Y-%m-%d)
prev=$(git tag -l 'v*' --sort=-v:refname | head -1)
node - "$VERSION" "$today" "$prev" "$REPO_URL" <<'JS'
const fs = require("fs");
const [v, date, prev, repo] = process.argv.slice(2);
let s = fs.readFileSync("CHANGELOG.md", "utf8");
s = s.replace(/^## \[Unreleased\][ \t]*$/m, `## [Unreleased]\n\n## [${v}] - ${date}`);
s = s.replace(/^\[Unreleased\]: .*$/m, `[Unreleased]: ${repo}/compare/v${v}...HEAD`);
const link = prev ? `${repo}/compare/${prev}...v${v}` : `${repo}/releases/tag/v${v}`;
s = s.replace(/^(\[Unreleased\]: .*)$/m, `$1\n[${v}]: ${link}`);
fs.writeFileSync("CHANGELOG.md", s);
JS

echo "== tests"
make -s test >/dev/null || fail "the tests fail"

echo "== build"
scripts/build-xpi.sh

git add -A
git commit -q -m "Release v$VERSION"
git tag -a "v$VERSION" -m "v$VERSION"
echo
echo "Tagged v$VERSION. Check it (git show), then publish:"
echo "  git push origin $BRANCH v$VERSION"
