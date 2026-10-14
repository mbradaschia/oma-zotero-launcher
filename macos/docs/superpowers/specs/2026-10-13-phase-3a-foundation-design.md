# Phase 3a: the foundation (design)

Phase 3a of [`macos/PLAN.md`](../../../PLAN.md) (revision 4). Nothing visible changes: the app
behaves as in phase 2. What lands is everything phase 3b's paper menu stands on, each piece
tested in CI.

## 1. Loading the view logic

- `JSCore` evaluates `js/lib/{Fuzzy,Client,Views,Settings,Todos}.js` and `contracts/Paths.js`
  (bundled from `../contracts/Paths.js`) into one `JSContext`, each in its own wrapper as today,
  then binds each module's exports as a global (`Fuzzy`, `Client`, `Views`, `Settings`, `Todos`,
  `Paths`) and evaluates `Core/Glue.js` in the same context.
- **`Glue.js`** exposes JSON-only wrappers. Swift calls nothing else. A wrapper supplies the
  arguments JSON can't carry: `rank` (`Fuzzy.filter`), `row` (`Views.listRow`), real `Date`s from
  epoch milliseconds.
- **Wrappers in 3a** are the ones phase 3b's paper menu needs, plus `Paths.resolve`:
  `searchRows(response, color, extras)`, `actions(details, viewerName, prompts, promptsProblem,
  pinned, setup, extras)`, `orderRows(rows, order)`, `pinRows(rows, pins)`, `otherRows(rows,
  others)`, `filterRows(rows, text)`, `orderSections(rows, order)`, `fileRows(details, purpose)`,
  `selectionAfter(rows, previousKey, followTop)`, `resolvePaths(env, machineSettings, probe)`.
  Later phases add theirs, each with a golden.
- `fitHints` is ported to Swift in 3b (it measures text), not wrapped.

## 2. Decoders

Four `Decodable` structs, chosen by the wrapper that made the rows, never by sniffing fields:
- `SearchRow` (today's `Row`, renamed): `section, kind, key, libraryID, itemType, icon, title,
  titleHtml, subtitle, openState, pdfCount, noteCount, tagsText, ranks, status`.
- `ListRow`: the 35 fields of `Views.listRow`.
- `SetupItem`: `id, icon, label, detail, ok, action, rowId?, badge?, submenu?, steps?`.
- `Pill`: `text, kind, mode`.

Fields the JS may omit or null are optionals; a missing required field fails the golden test.

## 3. Fixtures from your library, scrubbed

`scripts/capture-fixtures.mjs` reads the bridge handshake (`$TMPDIR/oma-zotero/bridge.json`), calls
`/search` (empty, and a typed query), `/item` and `/note` (for the first paper with a note),
`/tags/list` and `/facets` (`tag`, `year`), and writes `ZoteroLauncherTests/Fixtures/bridge/*.json`.

**Scrubbing, by default** (`scripts/scrub.mjs`):
- Every string becomes lowercase letters and spaces from an HMAC keyed by 32 random bytes made for
  the run and never written: the same value scrubs the same way within a capture, and nobody can
  compute the fake of a guessed title. No word lengths, capitals or punctuation survive.
- Lengths: `title`, `name`, `query` and a tag row's `key` keep theirs (`titleRanges` index them);
  every other string is padded to a multiple of 8. Empty stays empty.
- Metadata that narrows a paper down is coarsened: dates keep only their year; a journal's `rank`
  (grades, subject area, FT50, UTD24) becomes one fixed value.
- HTML keeps only known tag names, bare (no attributes); text, stray `<`, comments are scrubbed.
- Kept: ids in Zotero's 8-character key format, `field` only when it names a facet, numbers,
  booleans, and a string under a safe key only when it has that key's shape (an identifier, a
  number, a version); anything else there is scrubbed. A paper's `status` is your own word:
  scrubbed. A date keeps its year and nothing after it.
- The script refuses to write if any original string, any of its words of 6 letters or more, or
  any object key that isn't an identifier survives in its output.

Because scrubbed text is all `[a-z ]`, `Fixtures/synthetic/` holds hand-written answers (accents,
CJK, emoji, capitals, markup) so the goldens exercise real text in both engines.

## 4. Goldens

`scripts/goldens.mjs` runs each wrapper on the fixtures in Node, with the same `Glue.js` and the
same `js/lib`, and writes `ZoteroLauncherTests/Fixtures/goldens/cases.json`: one case per call,
with its name, wrapper, arguments and answer. The Swift tests run each case through `JSCore`,
compare canonical JSON text (sorted keys; `true` and `1` differ), and
decode it into the struct the wrapper promises. A difference is either a JavaScriptCore/V8
difference or a change to the JS; a decoding failure is a shape change. Both fail CI.
`contracts/fixtures/paths.json` runs through `JSCore` too: every case's expected paths.

## 5. `AppStore`

An `@MainActor ObservableObject`:
- **The view stack:** `push(_ view:)` saves the current level (`view, filterText, caretBack,
  selectedIndex, followTop, scope, pickFor, searchFocus`) and starts the new view as
  ZoteroSearch.qml:759–772 does; `back()` restores the last saved level and returns `false` at
  the root (ZoteroSearch.qml:775–813). No replace: callers `back()` twice, as the QML does.
  `goHome()` backs out to the root.
- **Resume:** reopening restores view, stack, filter, selection and scope, in memory
  (ZoteroSearch.qml:261–408); a fresh launch starts at search.
- **Arrangement:** `view.json` (through `Paths.resolve`'s `view`), read and written whole, atomic
  write; read-only while `Paths` says so.

## 6. `KeyRouter`

A pure function from (key event, router state) to a `KeyCommand` (an enum: `close`, `back`,
`home`, `clearFilter`, `focusSearch`, `leaveSearch`, `move(Int)`, `page(Int)`, `pick(Int)`,
`activate`, `openMenu`, `typing(String)`, `keyAction(Character)`, `pass`, and so on). It implements
`handleKey`'s order (ZoteroSearch.qml:4545–4707), the single-key buffer and its `keyDelay` window
(`queueKey`/`flushKeys`, 2062–2087), and `keyAction`'s letters (1971–2029) for what exists in 3a.
- **State** it reads: `keysMode` (single or alt), whether the search box has focus, the filter
  text, at root or not, text-entry view or not, note view or not.
- **Mac:** `charactersIgnoringModifiers` for letters (Option types other characters), Option is
  Alt, ⌘V pastes as Ctrl+V does, Option dead keys (⌥E, ⌥U, ⌥N, ⌥I, ⌥`) resolve to their letter.
- **Tests:** one per rule, in order, plus the timer window (a second key inside `keyDelay` is
  typing, outside it is a key action), with an injected clock.
- ⌘ shortcuts pass to the Mac (⌘←/⌘→ move the caret) except ⌘V in a page for typing; AppKit's
  function keys (F2-F12) type nothing.
- The store executes commands from 3b on; in 3a the launcher keeps its current key handling, so
  nothing changes for you.
- **For 3b to decide when it wires the router:** ⌥←/⌥→ cycle a paper's status (the QML's) where a
  Mac text field jumps a word; and dead keys without ⌥ type the accent alone (the QML's), so 3b's
  search box should take composed text from the input system (ABNT2's ~ then a gives ã).

## 7. The parity tracker

- `scripts/parity.sh` lists `activateAction`'s `case` labels in `reference/ZoteroSearch.qml`
  (the tested awk recipe), the ids `Actions/ActionMap.swift` handles, and the inert-by-design ids,
  and prints `ported / inert / out of scope / remaining` per phase from `parity-phases.tsv` (the
  plan's appendix as data).
- `--phase <name>` fails if any of that phase's ids is unported. The Mac workflow runs it on every
  PR; 3a only reports (0 of 164 ported).
- `Actions/ActionMap.swift` starts as an empty map: `[String: ActionHandler]`.

## Testing

- XCTest: `JSCoreTests` (load, globals, Glue, errors), `GoldenTests` (every wrapper × fixture,
  plus `paths.json` through JSC), `DecoderTests` (each shape, optional fields), `AppStoreTests`,
  `KeyRouterTests`, all in the Swift job.
- Node: `js/tests/capture-scrub.test.js` (the scrubber: lengths kept, offsets valid, every
  original gone, deterministic), `js/tests/parity.test.js` (the counts on a tiny QML).
- `scripts/goldens.mjs --check` in CI: regenerating gives the committed files (no drift).
- The app run by hand: search, Enter, Shift+Enter, Esc as before.
