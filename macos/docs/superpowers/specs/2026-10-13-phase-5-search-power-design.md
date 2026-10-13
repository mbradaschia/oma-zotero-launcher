# Phase 5: search power (design)

Phase 5 of [`macos/PLAN.md`](../../../PLAN.md). 13 row ids: `search search-open search-pin
search-rename search-query search-delete search-save search-save-pin search-rename-save
search-query-save pick-field pick-op pick-value`. It ends tier 1 (77 of 164). Ported with the QML
open (`ZoteroSearch.qml` 1497-1609 for the rows, 2392-2555 for the functions, 4840-4950 for the
chrome, 5680-5725 for the badges; `Service.qml` 765-812 for Zotero's sync).

## 1. Saved searches

- **`searches.json`** through Paths (`SearchesFile`, as `PinsFile` and `TodosFile`): read through
  `Views.parseSearches`, every write stamped by `Merge.stamp` (its `updated` times and
  tombstones, for the other machine's copy) and written atomically; refused while the sync folder
  is away, or over a file that is there but isn't searches. It joins the files merged and reloaded
  after a conflict (`reloadSyncedFiles`).
- **Save** (`s` in the results, Ctrl+S while typing; `saveSearchPrompt`): what the results show
  (`Views.combinedQuery` of the scope's query and the typed text) into `search-edit`
  (`Views.buildSearchEditRows`, mode `save`): `search-save`, `search-save-pin` (pinned, and at the
  top level its badge becomes the active one, the box emptied).
- **The Searches view** (`f`, Go to › Searches): `Views.buildSearchRows`; Enter opens one
  (`openSavedSearch`: a `search` scope, `Views.searchScope`); Shift+Enter its menu
  (`Views.searchMenuRows`: `search-open`, `search-pin`, `search-rename`, `search-query`,
  `search-delete`); `search-rename`/`search-query` open `search-edit` with the name or the query,
  saved by `search-rename-save`/`search-query-save`; `p` pins, Shift+↑↓ reorders
  (`Views.moveSearch`).
- **Badges** above the results at the top level: All, each pinned search, and "+ Save …"
  (a click saves). The active one scopes the search (`searchScope`: the opened scope, else the
  badge); Tab/Shift+Tab move between them (`Views.nextSearch`). A saved search's scope sends
  `within` (`Glue.searchBody` already does); an answer for another scope is dropped.

## 2. The @ pickers

`@` in the results opens `picker` (`Views.buildPickerRows`; taxonomies `[]` until phase 9).
`pick-field` opens `picker-values` for that field: dates from `Views.buildDateValueRows`, saved
searches from `Views.savedSearchValues` (ranked here), every other field from the bridge's
`/facets` (`facetsBody`; ranked there): the newest answer wins, the rows shown stay until it
comes, and the untyped page is kept for this opening. Typing in `picker-values` asks again.
`pick-op` and `pick-value` put the term in at the caret (`Views.insertAt`, `addToSearch`, one or
two levels back), the search box keeping the keys.

## 3. The search box shows its blocks (decision)

`StyledTextField` (an `NSTextField`, its field editor an `NSTextView`): composed text, the
services, word moves and the caret are AppKit's. The query's runs from `Views.querySegments`
(a new task's line: `Todos.taskSegments`) are tinted in place: filters in the accent, operators
orange, negation red, quotes green, a finished block on a faint fill. **The QML draws a finished
block as a chip with a short label ("A: smith"); the Mac keeps the typed text and tints it**,
because replacing text with a label inside an editable field fights the caret and the undo
stack. The caret is reported back (`caretBack`, in UTF-16 units, as the JS counts) so `@` inserts
where you were; a term put in moves the caret after it.

## 4. Go to, scope counts, Sync Zotero

- **Go to** (`Views.commandRows` in the results, while typing at the top level or in a badge):
  only the places the Mac has by now: Tasks, New task, Searches, Sync Zotero, Settings, General
  settings (`Glue.results` drops the rest, and the Papers heading when nothing is left above
  them). Enter on one opens it.
- **Scope counts:** the context bar of a saved search ("Saved search  <name>") with the count,
  as for a collection or a tag; the empty state of a search with no papers shows its query.
- **Sync Zotero** (`S`, Go to's row): `/sync/status` on each opening, `/sync/start`, then
  `/sync/status` every 1.5 s until it ends: a flash when done or Zotero's error, and the results
  asked again. Not set up: says where (Zotero › Settings › Sync). The footer at the top level
  shows `Views.syncFooter` ("synced 5 min ago", "syncing…"). The Processes view that lists the
  sync in the QML is phase 6's.

## 5. Chrome

Placeholders, counts, hints and empty states for `searches`, `search-menu`, `search-edit`,
`picker`, `picker-values` as the QML has them (4846-4950); the results' placeholder inside a
badge ("Search in “…”…"); `tab next search` and `@ filters · ctrl+s save` among the typing hints.

## Testing

- Goldens for each new Glue wrapper (`GlueSearch.js`), with the fixed clock.
- XCTest with the fake bridge: each of the 13 ids on the model; `s`/Ctrl+S with and without text
  and inside a scope; badges and Tab; `within` in the body; a late answer for another scope
  dropped; facets (the newest answer wins, the untyped page cached, dates and saved searches
  without the bridge); `@` at the caret; Go to rows and their Enter; sync started, followed and
  finished; `searches.json` refused read-only and over a damaged file, stamped otherwise.
- `StyledTextField`: the tint runs for a query, the caret reported in UTF-16 units.
- A snapshot of the results with badges and a styled query.
- `scripts/parity.sh --phase 3b --phase 4a --phase 4b --phase 5` in CI.
