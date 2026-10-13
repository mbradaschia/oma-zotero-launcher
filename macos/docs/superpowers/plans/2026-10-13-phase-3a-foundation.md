# Phase 3a: the foundation, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Each task is test first: write the test, watch it fail for the stated reason, implement, watch it pass, run the whole suite, commit.

**Goal:** everything phase 3b stands on (JSCore with Glue.js and `Paths.js`, four decoders, scrubbed fixtures and goldens, `AppStore`, `KeyRouter`, the parity tracker), tested in CI, with no visible change.

**Spec:** `macos/docs/superpowers/specs/2026-10-13-phase-3a-foundation-design.md`.

**Tech stack:** Swift 6 language mode off (Swift 5 as `project.yml` sets), XCTest, JavaScriptCore, Node 22 (`node --test`), XcodeGen.

## Global constraints

- Work under `macos/`; read only `contracts/` outside it (`scripts/check-boundaries.sh`).
- `js/lib/*.js` and `contracts/Paths.js` are not edited in this phase.
- No visible change: the launcher's current search, Enter, Shift+Enter and Esc keep working.
- No library content in git: only scrubbed fixtures; the capture refuses otherwise.
- New Swift files: one type per file, `// ` comments in the codebase's voice, no force unwraps outside tests.
- Commands: from `macos/`, `xcodegen generate && xcodebuild test -project ZoteroLauncher.xcodeproj -scheme ZoteroLauncher -destination 'platform=macOS,arch=arm64' -derivedDataPath build`; `node --test js/tests/*.test.js`.
- No em dashes. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review focus

1. A fixture that leaks a real title, author, note or tag: the capture's own check, and a grep of the committed fixtures for the original strings during the run.
2. JavaScriptCore vs V8 differences (`normalize`, `Date`, sort stability) hidden by goldens generated with the same engine: goldens come from Node, comparisons run in JSC.
3. `KeyRouter` order: a later rule shadowing an earlier one (Esc with text in single-key mode, Backspace with text, Option+arrow in the search box).
4. `AppStore.back()` at the root, and twice in a row (the QML's "replace").
5. The app still launching with the new bundle layout (`Resources/lib`, `Resources/Paths.js`, `Glue.js`).

---

### Task 1: JSCore loads Paths.js and Glue.js

- Files: `project.yml` (resources `../contracts/Paths.js`, `ZoteroLauncher/Core/Glue.js`; test resources `ZoteroLauncherTests/Fixtures`, `../contracts/fixtures/paths.json`), `Core/JSCore.swift`, `Core/Glue.js`, `ZoteroLauncherTests/JSCoreTests.swift`.
- Interfaces: `JSCore.init(resources: URL?)` loads the six modules and Glue; `JSCore.glue<T: Decodable>(_ function: String, _ arguments: [Any], as: T.Type) throws -> T`; `JSCore.glueJSON(_ function: String, _ arguments: [Any]) throws -> String` (canonical JSON, for goldens).
- Tests first: the six globals exist; `Glue.resolvePaths` reproduces every case of `contracts/fixtures/paths.json`; an unknown Glue function throws; the existing search-row tests still pass through `Glue.searchRows`.

### Task 2: the fixture capture, scrubbed

- Files: `scripts/capture-fixtures.mjs`, `scripts/scrub.mjs`, `js/tests/capture-scrub.test.js`, `ZoteroLauncherTests/Fixtures/bridge/*.json`.
- Interfaces: `scrub(value, safeKeys) -> value`; `leaks(original, scrubbed) -> [string]` (originals that survive).
- Tests first: lengths kept; letters stay letters, digits digits, spaces and punctuation kept; `titleRanges` still slice the same length; the same string scrubs the same way twice; safe keys kept; `leaks` empty after scrubbing and non-empty for an unscrubbed copy.
- Then: start Zotero if it isn't running, wait for a fresh handshake, run the capture, grep the output for a sample of the original titles (none found), commit only the scrubbed files.

### Task 3: Glue wrappers, goldens and decoders

- Files: `Core/Glue.js` (the 3a wrappers), `Core/SearchRow.swift` (from `Row.swift`), `Core/ListRow.swift`, `Core/SetupItem.swift`, `Core/Pill.swift`, `scripts/goldens.mjs`, `ZoteroLauncherTests/Fixtures/goldens/*.json`, `ZoteroLauncherTests/GoldenTests.swift`, `ZoteroLauncherTests/DecoderTests.swift`; callers of `Row` renamed.
- Tests first: `goldens.mjs --check` fails with no goldens; each golden equals the JSC output (canonical JSON); each decodes into its type; `DecoderTests` cover optional fields and a missing required field.

### Task 4: AppStore

- Files: `Store/AppStore.swift`, `Store/ViewLevel.swift`, `Store/ViewPrefs.swift`, `ZoteroLauncherTests/AppStoreTests.swift`.
- Tests first: push saves the level and starts the next view as the QML does; back restores it; back at the root returns false; back twice; goHome; resume after reopening; `view.json` read, a pref set and written atomically; refused while read-only.

### Task 5: KeyRouter

- Files: `Keys/KeyEvent.swift`, `Keys/KeyCommand.swift`, `Keys/KeyRouter.swift`, `ZoteroLauncherTests/KeyRouterTests.swift`.
- Tests first: one test per `handleKey` rule in order (from `reference/ZoteroSearch.qml:4522-4684`), the single-key window with an injected clock, `keyAction`'s letters that exist in 3a, Option letters through `charactersIgnoringModifiers`, Option dead keys, ⌘V.

### Task 6: the parity tracker

- Files: `scripts/parity.sh`, `parity-phases.tsv`, `Actions/ActionMap.swift`, `js/tests/parity.test.js`, `.github/workflows/macos.yml` (a step).
- Tests first: on a tiny QML with three cases and a map with one, the counts are right; `--phase` fails when that phase has an unported id; on the real tree, 164 ids, 0 ported.

### Task 7: verify, review, PR

- The whole Swift and JS suites; `make test` and `make lint` at the root; the app launched by hand (search, Enter, Shift+Enter, Esc).
- A fresh reviewer on the branch with this plan's review focus; one fix pass.
- Push, PR (outward: the user's go).
