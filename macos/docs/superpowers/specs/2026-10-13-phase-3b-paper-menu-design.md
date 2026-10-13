# Phase 3b: a paper's menu (design)

Phase 3b of [`macos/PLAN.md`](../../../PLAN.md): the launcher stops being a search box with Enter and
becomes the Omarchy launcher's shape. The store from 3a drives it, the key router takes the keys,
and a paper's menu works. 9 of the 164 row ids: `open reveal external window pick pin cite-copy
confirm-yes confirm-no`.

## 1. Files and settings (`Files/`)

- **`AppPaths`**: `Paths.resolve` through JSCore, twice as the contract says: once with the machine
  settings file, then with `probe.syncMarker` (does `<syncDir>/shared/oma-zotero-sync.json` exist).
  The environment is the process's (`HOME`, `XDG_*`, `OMA_ZOTERO_*`, the host name). Decoded:
  `settings, sharedSettings?, sharedSettingsCache?, pins, view, machine, readOnly, problems`.
- **`AppSettings`**: the machine file and the shared one (its cache while read-only), combined by
  `Paths.combineSettings` and normalized by `Client.normalizeSettings`, through one Glue wrapper.
  Typed for what 3b reads: `keys`, `keysStart`, `keyDelay`, `citationStyle`, `paperStatuses`,
  `emptyQuery`, `maxResults`; the rest kept as JSON for the builders. Read on each open, as the
  QML's `refreshSettings`.
- **`PinsFile`**: `pins.json` (`{ pins: [...] }`), read whole through `Views.parsePins`, written
  atomically from the file as it is now, refused while read-only, as `ViewPrefs`.

## 2. Glue wrappers (each with goldens)

- `settings(machineRaw, sharedRaw)` → `{ settings, problems }`.
- `searchBody(query, scope, settings, pins)` → the `/search` body `Service._sendSearch` sends.
- `menu(details, extras, prefs, filter)` → `{ ordered, rows }`: `buildActions` → `orderRows` →
  `pinRows` → `otherRows` → `filterRows` → `orderSections`, in the QML's order
  (ZoteroSearch.qml:946-960). `ordered` is `menuRows` (for moving a row in its section).
- `fileRows(details, purpose, filter)`, `confirmRows(ask)`.
- Pins and arrangement: `parsePins`, `togglePin`, `isPinned`, `movePin`, `toggleIdentity`,
  `moveIdentity`, `moveSection`, `rowIdentity`.
- Text: `contextLabel`, `typeHint`, `rankLabels`, `paperFooter`, `usableFiles`.

## 3. The launcher (`Launcher/`)

`LauncherModel` (`@MainActor`) owns the `AppStore`, the bridge, JSCore, the files, and what is
shown: `.search([SearchRow])` or `.list([ListRow])`, the details of the paper whose menu is open,
the flash line and the last error. Split by concern, each file under 400 lines:

- **search:** one request in flight, the newest wins (`Client.enqueue`/`done`); the body from
  `searchBody`; rows through `searchRows` then `orderSections` (`sectionKey`), the selection
  through `selectionAfter`.
- **menu:** `enterActions` → `enterActionsFor` → `/item` (8 s) → `rebuildList`; `runQuick` for
  `o`/`w`; `refreshDetails` on resume; `selectRow`; `finish` (close, then act).
- **actions** (`Actions/`): `ActionMap.handlers[rowId]` for the 9 ids, each a function of an
  `ActionTarget` (the model; a fake in tests) and the row:
  - `open`, `reveal`: `/open`, `/reveal`, then Zotero to the front
  - `external`: `/attachment` target `path` → `NSWorkspace.open`; `window`: target `window`
  - a submenu (several files): the `files` view; `pick`: the file for `filePurpose`
  - `pin`: `togglePin` on `pins.json`, the menu rebuilt in place
  - `cite-copy`: `/cite` (`mode` from the row's value, `format: text`, the style from settings),
    the text to `NSPasteboard`, the cite preview cached per paper and style as `loadCitePreview`
  - `confirm-yes`/`confirm-no`: `askConfirm`'s `run`/`cancel`, after `back()`
  An unavailable row does nothing. Each handler has a test with the fake target.
- **arrangement:** `p`/`P` (menu pins, Other), Shift+↑↓ (`moveMenuRow`, `movePinned` in the
  results), Ctrl+Shift+↑↓ (`moveSectionOf`), all through `view.json` and `pins.json`.
- **keys:** a local key monitor on the panel turns each `NSEvent` into a `KeyEvent`, builds the
  `KeyState` from the store and the rows, and runs `store.keys.handle`; the commands run in
  `execute`. Commands for a phase not built yet show nothing and are not consumed beyond the QML's
  ("Not on the Mac yet" in the footer for a key action whose view comes later).
  - **The search box is AppKit's:** while it has the keys, `.editSearch`, `.append` and `.pass`
    go to the field, so composed text (dead keys, ABNT2's ~ a, input methods) is the system's.
    ⌥←/⌥→ stay word jumps there; they change a paper's status only when the list has the keys
    (decision 9). This settles the two questions 3a left.
  - **The single-key wait:** the buffer's deadline schedules one tick; a view change clears it.
- **chrome:** the context bar (`contextInfo` for these views: the paper's "Authors, Year ·
  Title", its ranks), the search box's placeholder (`placeholder`/`headerPlaceholder` for search,
  `actions`, `files`, `confirm`), the footer: flash, then the error, then the paper's pills
  (`paperFooter`), then the hints (`hints`/`hintsFor` for these views) fitted to the width by
  `fitHints` ported to Swift with `NSFont` metrics.
- **icons:** rows draw their Nerd Font glyph in the bundled Symbols Nerd Font when the app has it
  (`Resources/Fonts`, registered at launch); without it, an SF Symbol from a table of the glyphs
  these views use, and a dot for the rest. Decision 4 stands: the font is added once its download
  is approved.
- **`W`:** the launcher as a regular window and back (`toggleWindowed`): the same view moved
  between the panel and an `NSWindow`; a window stays when you click elsewhere.

## 4. Behavior kept from phase 2

Search as you type, ↑↓, Enter (now the paper's menu, as on Omarchy), Shift+Enter (in Zotero),
Esc (the ladder). Enter on a collection or a tag shows "Not on the Mac yet" (phase 4a).

## Testing

- Goldens for every new wrapper, on the scrubbed and synthetic fixtures.
- XCTest: `AppPaths` (a temp HOME, with and without a sync folder, read-only without its marker);
  `AppSettings` (defaults, machine and shared combined, a broken file reported); `PinsFile`;
  each action handler on a fake target; `LauncherModel` with a fake bridge (search, the queue,
  enter a menu, a failed `/item`, the confirm view, pins, menu pins and order, `fitHints`);
  `execute` for every command 3b handles; the hints and placeholders per view.
- `scripts/parity.sh --phase 3b` in CI: 9 of 9.
- The checklist on your Mac: full-screen apps, Stage Manager, two displays, a password field
  focused behind the panel (secure input), and the menu's rows on real papers.
