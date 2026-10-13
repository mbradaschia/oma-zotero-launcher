# One repository, zotero-companion-launcher: migration plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the Omarchy launcher, the bridge with `contracts/`, and the Mac app (`macos/`) in this one public repository, renamed `zotero-companion-launcher`, each project green in its own CI.

**Architecture:** the Omarchy launcher stays at the root and the bridge at `zotero-bridge/` (both paths are fixed from outside). `contracts/` takes `Paths.js`, its fixtures and tests. `macos/` arrives by `git subtree` with its history, gets its own copies of the view logic and the runner, and reads only `contracts/` from the rest. A boundary script keeps the two launchers apart.

**Tech Stack:** git (subtree), bash, Node 22 (`node --test`), XcodeGen + Xcode, GitHub Actions, `gh`.

**Spec:** `docs/superpowers/specs/2026-10-13-monorepo-design.md`.

## Global Constraints

- The Omarchy launcher stays at the repository root; `zotero-bridge/` stays at that path.
- Shared names don't change: the plugin id, `~/.config/omarchy/oma-zotero-launcher/`, `~/.local/state/oma-zotero/`, `oma-zotero-prompt`, `/oma-zotero/*`, the `.xpi` file name.
- `macos/` never reads the root launcher's `lib/`, `daemon/`, `scripts/` or `*.qml`; the root never reads `macos/`.
- With no sync folder, the Omarchy launcher behaves byte for byte as before (the `contracts/fixtures/paths.json` first case).
- Every step that acts on GitHub (push, PR merge, the rename, archiving) waits for the user's explicit go.
- No em dashes anywhere. Commits: a plain descriptive subject, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The installed bridge's update URL across the rename:** `raw.githubusercontent.com/mbradaschia/oma-zotero-launcher/master/zotero-bridge/updates.json` must still answer after the rename. Task 8 checks it with `curl` right after renaming, and sets up the fallback repository if it doesn't.
2. **`omarchy plugin add` with the old URL** must still install the plugin, with `contracts/Paths.js` in the copy. Task 8 (redirect) and the fresh-install test on the Omarchy machine.
3. **The plugin as installed** must contain `contracts/Paths.js` and still load: `dev-sync.sh`'s include list. Task 1 checks the include, the Omarchy machine checks the load.
4. **A copied test that still reaches the root launcher** (`../lib/`, `../daemon/`) would pass while testing the wrong code. Task 2's boundary script fails it; Task 4 runs the copied tests with the root's `lib/` hidden.
5. **The Mac app's Swift tests** must find `js/lib` as their bundled resource after the move. Task 4 runs `xcodebuild test` from `macos/`.

---

### Task 1: `contracts/`

**Files:**
- Move: `lib/Paths.js` → `contracts/Paths.js`; `tests/fixtures/paths.json` → `contracts/fixtures/paths.json`; `tests/{paths,settings-scopes,sync-plan}.test.js` → `contracts/tests/`
- Create: `contracts/SYNC-FORMAT.md`
- Modify: `Service.qml:10`, `ZoteroSearch.qml:13` (imports), `daemon/lib/paths.mjs` (the checkout path), `scripts/copy-shared-paths.sh`, `scripts/dev-sync.sh` (include `contracts/Paths.js`), `Makefile` (`test`), `scripts/lint.sh` (check `contracts/**/*.js`), `tests/runner-paths.test.js` (the copy's source), the comments that name `lib/Paths.js`

- [ ] **Step 1: Move with history.** `git mv` the five files.
- [ ] **Step 2: Run the suite to see it fail.** `make test`: expected failures in `contracts/tests/*` (`Cannot find module '../lib/Paths.js'`), `runner-paths` and every runner test that loads `paths.mjs`.
- [ ] **Step 3: Fix the paths.** In `contracts/tests/*.test.js`: `../lib/Paths.js` → `../Paths.js`, `./fixtures/` → `../fixtures/`, `../lib/Settings.js` and `../lib/Client.js` → `../../lib/...`. `daemon/lib/paths.mjs`: `../../lib/Paths.js` → `../../contracts/Paths.js`. `copy-shared-paths.sh`: `$ROOT/lib/Paths.js` → `$ROOT/contracts/Paths.js`. `runner-paths.test.js`: compare with `contracts/Paths.js`. QML: `import "contracts/Paths.js" as Paths`. `Makefile`: `node --test tests/*.test.js contracts/tests/*.test.js`. `lint.sh`: add `contracts/*.js contracts/tests/*.js` to the `node --check` list. `dev-sync.sh`: add `--include='/contracts/' --include='/contracts/Paths.js'` before the final exclude.
- [ ] **Step 4: Run it to see it pass.** `make test && make lint`: the same 428 tests (426 pass, 2 skipped), lint clean. `grep -rn "lib/Paths" --include=*.js --include=*.mjs --include=*.qml --include=*.sh .` finds nothing outside docs and the CHANGELOG.
- [ ] **Step 5: Check the plugin copy's include list:** `grep -n contracts scripts/dev-sync.sh` shows
  `/contracts/` and `/contracts/Paths.js` before the final `--exclude='*'`. (Running `dev-sync.sh`
  writes into the Omarchy plugins folder, so loading the plugin is checked on the Omarchy machine.)
- [ ] **Step 6: `contracts/SYNC-FORMAT.md`:** the sync folder in words, from `docs/superpowers/specs/2026-10-12-phase-2.5-paths-design.md` sections 1 to 4 (layout, scopes and provider addresses, fill/join/leave and refused, read-only, the shared-settings copy, the marker, `.stignore`), each rule pointing to the test that pins it.
- [ ] **Step 7: Commit:** "contracts/: Paths.js, its fixtures and tests, and the sync format in words".

### Task 2: the boundary check

**Files:**
- Create: `scripts/check-boundaries.sh`, `tests/check-boundaries.test.js`
- Modify: `Makefile` (`lint` runs it)

- [ ] **Step 1: The failing test.** `tests/check-boundaries.test.js` runs the script on temporary trees: a clean one (passes); `macos/js/tests/x.test.js` with `require("../../../lib/Views.js")` (fails, names the file); `macos/runner/lib/x.mjs` importing `../../../daemon/lib/chat.mjs` (fails); a root `Service.qml` naming `macos/` (fails); `macos/runner/lib/paths.mjs` loading `../../../contracts/Paths.js` (passes).
- [ ] **Step 2: Run it to see it fail** (the script is missing).
- [ ] **Step 3: The script.** `scripts/check-boundaries.sh [ROOT]`: under `macos/`, any `.js`, `.mjs`, `.swift`, `.sh`, `.yml` file whose text matches `\.\./(\.\./)*(lib|daemon|scripts)/` resolving outside `macos/` and not into `contracts/`, or naming a root `*.qml`, is a violation; at the root (outside `macos/`, `docs/`, `.github/`), any file naming `macos/`. Prints each `file:line`, exits 1 on any.
- [ ] **Step 4: Run it to see it pass,** then `make lint` (which now runs it on the real tree: passes before `macos/` exists).
- [ ] **Step 5: Commit:** "scripts/check-boundaries.sh: the two launchers share only contracts/ and the bridge".

### Task 3: the Mac app's history in `macos/`

**Files:**
- Create: `macos/` (by subtree)
- Remove: `macos/.gitmodules`, the `macos/shared` gitlink

- [ ] **Step 1:** `git subtree add --prefix=macos "/Volumes/Extreme Pro/Documents/Programming/zotero-launcher-macos" main`.
- [ ] **Step 2:** `git ls-files -s macos/shared` shows mode `160000`; `git rm --cached macos/shared && git rm macos/.gitmodules`; `rm -rf macos/shared`.
- [ ] **Step 3:** `git log --oneline -- macos | wc -l` counts the Mac repo's commits (at least its 20); `git log --follow macos/PLAN.md | head` shows its history.
- [ ] **Step 4: Commit:** "macos/: the Mac app's own submodule (shared/) removed".

### Task 4: the Mac app's own copies

**Files:**
- Create: `macos/js/lib/` (root `lib/*.js`), `macos/js/tests/` (the 30 files listed below, the 3 mixed ones without their bridge tests), `macos/runner/` (`daemon/` without `node_modules`), `macos/scripts/{install-runner,safe-dest,copy-shared-paths}.sh`, `macos/reference/{ZoteroSearch,Service,ChatWindow,NoteWindow}.qml`, `macos/VENDORED.md`
- Modify: `macos/project.yml` (`shared/lib` → `js/lib`), `macos/runner/lib/paths.mjs` (`../../../contracts/Paths.js`), `macos/scripts/copy-shared-paths.sh` (`$ROOT/../contracts/Paths.js`), `macos/scripts/install-runner.sh` (`runner/`), the copied tests' paths

The 30 files: `artifacts atomic auto-extract catchup citations codex-paper-only context-bar default-task extract-chat fuzzy grouping key-tests layout menu-keys platform plugin-actions plugin-lib plugin-notes-tags prompts providers runner-paths runner-settings safe-dest safe-markdown searches settings synced-input taxonomies taxonomy-edit todos` (`.test.js`), plus `collections`, `paper-status`, `sync` with their `zotero-bridge` tests removed.

- [ ] **Step 1: Copy.** `cp` the files; record the source commit (`git rev-parse HEAD`) in `macos/VENDORED.md` with the list.
- [ ] **Step 2: Run the copied tests to see them fail:** `npm ci --prefix macos/runner && node --test macos/js/tests/*.test.js`: failures on `../daemon/` imports and on `contracts` lookups.
- [ ] **Step 3: Fix the paths.** In `macos/js/tests/`: `../daemon/` → `../../runner/`; `../scripts/` → `../../scripts/`; `path.join(ROOT, "daemon")` → `path.join(ROOT, "runner")` where `ROOT` is `macos/`; Paths (in `runner-paths`, `runner-settings`) from `../../../contracts/Paths.js`. In the runner: `paths.mjs` loads `../../../contracts/Paths.js`. In the scripts: `install-runner.sh` copies `$ROOT/runner/`; `copy-shared-paths.sh` copies `$ROOT/../contracts/Paths.js`.
- [ ] **Step 4: Run them to see them pass, with the root's code hidden:** `mv lib lib.hidden && mv daemon daemon.hidden && node --test macos/js/tests/*.test.js; mv lib.hidden lib; mv daemon.hidden daemon`: all pass. Then `scripts/check-boundaries.sh`: passes.
- [ ] **Step 5: The Swift build.** `macos/project.yml`: the resource folder `js/lib`. `cd macos && xcodegen generate && xcodebuild test -project ZoteroLauncher.xcodeproj -scheme ZoteroLauncher -destination 'platform=macOS,arch=arm64' -derivedDataPath build`: `** TEST SUCCEEDED **`, 12 tests.
- [ ] **Step 6: `macos/PLAN.md` revision 4:** the monorepo (from the spec): decisions 1, 6, 7, 8 name `js/lib`, `runner/`, `contracts/`; "Shared-code contract" becomes "What is common"; phase 2.6 is this migration; `parity.sh` reads `reference/ZoteroSearch.qml`; the record and the estimate. `macos/README.md`: the layout, the build from `macos/`, the release URLs.
- [ ] **Step 7: Commit:** "macos/: its own view logic, runner and tests; the Omarchy QML kept for reference".

### Task 5: CI for both projects

**Files:**
- Move: `macos/.github/workflows/ci.yml` → `.github/workflows/macos.yml`
- Modify: `.github/workflows/ci.yml`, `.github/workflows/macos.yml`, `macos/scripts/install.sh`

- [ ] **Step 1:** `macos.yml`: triggers on `push` to `master` and `pull_request` with `paths: [macos/**, contracts/**, .github/workflows/macos.yml]`; `defaults.run.working-directory: macos`; no submodules; the nightly release as tag `macos-nightly` (delete and create as now); a `js` job (Node 22, `npm ci --prefix runner`, `node --test js/tests/*.test.js`).
- [ ] **Step 2:** `ci.yml`: `paths-ignore: [macos/**]` on both triggers; the lint step already runs `check-boundaries.sh` (Task 2).
- [ ] **Step 3:** `macos/scripts/install.sh`: `REPO=mbradaschia/zotero-companion-launcher`, tag `macos-nightly`.
- [ ] **Step 4:** `actionlint` if installed, else `python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))"` on both files.
- [ ] **Step 5: Commit:** "CI: a workflow per project; the Mac app's nightly as macos-nightly".

### Task 6: the new name in the repository

**Files:**
- Modify: `scripts/install-bridge.sh:8`, `zotero-bridge/manifest.in.json` (`homepage_url`, `update_url`), `ZoteroSearch.qml:3624`, `README.md`, `CHANGELOG.md` (an Unreleased entry), `macos/README.md`

- [ ] **Step 1:** every `github.com/mbradaschia/oma-zotero-launcher` and `mbradaschia/oma-zotero-launcher` → `mbradaschia/zotero-companion-launcher`, except the CHANGELOG's past entries and the shared names (Global Constraints). `update_url` → `https://raw.githubusercontent.com/mbradaschia/zotero-companion-launcher/master/zotero-bridge/updates.json`.
- [ ] **Step 2:** `make test && make lint`, and the bridge tests that read the manifest pass.
- [ ] **Step 3:** CHANGELOG Unreleased: the repository's new name and layout; the Mac app inside; `contracts/`; update URLs kept working by GitHub's redirect.
- [ ] **Step 4: Commit:** "The repository's new name, zotero-companion-launcher, in links and the bridge's update URL".

### Task 7: review, push, PR (needs your go)

- [ ] **Step 1:** the final whole-branch review (a fresh reviewer, the spec, this plan's Review Focus).
- [ ] **Step 2 (your go):** `git push -u origin monorepo`; `gh pr create`; both workflows green.
- [ ] **Step 3 (your go):** merge.

### Task 8: rename and archive (needs your go)

- [ ] **Step 1 (your go):** `gh repo rename zotero-companion-launcher -R mbradaschia/oma-zotero-launcher`.
- [ ] **Step 2: Check the redirects.** `curl -sI https://raw.githubusercontent.com/mbradaschia/oma-zotero-launcher/master/zotero-bridge/updates.json` (expect 200 after redirects with `-L`, the new repository's file); `git ls-remote https://github.com/mbradaschia/oma-zotero-launcher` (expect refs). If the raw URL fails: create `mbradaschia/oma-zotero-launcher` holding only `zotero-bridge/updates.json` (your go), and `scripts/release.sh` copies it there on each release.
- [ ] **Step 3:** this clone's `origin` → the new URL; the local folder renamed to `zotero-companion-launcher` (with your go: open sessions point at the old path).
- [ ] **Step 4 (your go):** zotero-launcher-macos: a README pointing to `zotero-companion-launcher/macos`, its open branch `plan/independent-app` deleted, then `gh repo archive`.
