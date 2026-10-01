#!/bin/bash
# Install the prompt runner (the AI features: prompts, chat, text extraction) from this
# checkout's daemon/: copy it to ~/.local/share/oma-zotero-launcher/runner, install its packages
# there, and link ~/.local/bin/oma-zotero-prompt. `make prompts-install` and the launcher's
# Settings › Install AI features both run this; the launcher shows it in Tasks.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
RUNNER_BASE=${XDG_DATA_HOME:-$HOME/.local/share}/oma-zotero-launcher
RUNNER_DIR=${RUNNER_DIR:-$RUNNER_BASE/runner}
BIN=$HOME/.local/bin/oma-zotero-prompt
# shellcheck source=scripts/safe-dest.sh
source "$ROOT/scripts/safe-dest.sh"

command -v node >/dev/null || { echo "install-runner: needs Node.js 22 or newer (omarchy install dev-env node)" >&2; exit 1; }
major=$(node -p 'process.versions.node.split(".")[0]')
(( major >= 22 )) || { echo "install-runner: needs Node.js 22 or newer (this is $(node --version))" >&2; exit 1; }
command -v npm >/dev/null || { echo "install-runner: needs npm (it comes with Node.js)" >&2; exit 1; }

# A task in the launcher's queue (tasks.mjs needs no packages, so it runs before npm ci).
task() {
  node --input-type=module -e "
    const t = await import(process.argv[1]);
    const [op, id, detail] = process.argv.slice(2);
    if (op === 'start') { const task = t.startTask({ kind: 'install', title: 'Install the AI features', paper: 'the prompt runner' }); process.stdout.write(task.id); }
    else {
      const dir = t.tasksDir(); const fs = await import('node:fs'); const p = dir + '/' + id + '.json';
      const task = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (op === 'done') t.finishTask(task, { detail }); else t.failTask(task, detail);
    }" "$ROOT/daemon/lib/tasks.mjs" "$@" 2>/dev/null || true
}

TASK=$(task start)
trap 'task fail "$TASK" "the install stopped (see the terminal or the shell log)"' ERR

# The runner's directory is replaced wholesale (rsync --delete): only a real directory of yours,
# inside its base, that is empty or already a runner (RUNNER_DIR set: inside its parent).
is_runner() { [[ -f $1/package.json ]] && [[ $(node -p 'require(process.argv[1]).name' "$1/package.json" 2>/dev/null) == oma-zotero-prompt ]]; }
if [[ $RUNNER_DIR == "$RUNNER_BASE/runner" ]]; then safe_dest "$RUNNER_DIR" "$RUNNER_BASE" is_runner
else safe_dest "$RUNNER_DIR" "$(dirname "$RUNNER_DIR")" is_runner; fi
# The command is a link to it: never written over a file that isn't a link.
if [[ -e $BIN || -L $BIN ]] && [[ ! -L $BIN ]]; then
  echo "install-runner: $BIN exists and isn't a link: not replacing it (move it away, then run this again)" >&2
  exit 1
fi

mkdir -p "$RUNNER_DIR" "$HOME/.local/bin"
rsync -a --delete --exclude node_modules "$ROOT/daemon/" "$RUNNER_DIR/"
(cd "$RUNNER_DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
ln -sfn "$RUNNER_DIR/bin/oma-zotero-prompt.mjs" "$BIN"
"$BIN" list >/dev/null

trap - ERR
task done "$TASK" "$(node -p "require('$RUNNER_DIR/package.json').version") in $RUNNER_DIR"
echo "installed the prompt runner in $RUNNER_DIR ($BIN)"
