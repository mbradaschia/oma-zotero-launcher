#!/bin/bash
# lib/Paths.js into an installed runner, as lib/shared-paths.cjs next to its paths.mjs: the runner
# outside this checkout resolves every path exactly as the launcher does. install-runner.sh runs it.
#   copy-shared-paths.sh RUNNER_DIR
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEST=${1:?usage: copy-shared-paths.sh RUNNER_DIR}
mkdir -p "$DEST/lib"
cp "$ROOT/lib/Paths.js" "$DEST/lib/shared-paths.cjs"
