# Phase 4a: notes, tags, collections, statuses, settings (design)

Phase 4a of [`macos/PLAN.md`](../../../PLAN.md). 24 row ids: `notes read note paper-status
default-task tags-status tag-to-paper tag-to-task tag-status-opt tag-rename tag-name-save tag-delete
tags tag create set-nav set-toggle set-choice set-opt set-edit set-save set-styles set-style-opt
set-link`. Each is ported with the QML open; each function names its lines.

## 1. Notes

- **List and reader:** `notes` (one note opens straight in the reader, several get the list,
  `buildNoteRows` through Glue with `Fuzzy.filter` as `rank`), `read`/`note` open the `note` view.
  The reader asks `/note` (`format: html`), caches by key, and lists the paper's other notes
  (`/item` of the parent, `orderNotes`), so Shift+↑↓ cycles them and, from the results, that
  paper becomes the one in view.
- **Rendering (decision 5):** `Views.noteHtml` in a `WKWebView`: JavaScript off, a CSP with no
  network (`img-src data:`), page CSS for light and dark, the text size from `view.json`
  (`noteFontSize`, Ctrl+-/+/0). Links: `http(s)`/`mailto` to the default browser (the launcher
  closes), `zotero://` to Zotero. Selecting text copies it, as the QML does.
- **The reader's keys** (`handleNoteKey`, 4713): Shift+↑↓ other notes, ⌫ ← h back, y copy, s
  save, z or Shift+Enter in Zotero, w window, j k ↑↓ PgUp PgDn b Space scroll, i r cite, ⌥→← status,
  ⇧⌥→← default task; keys for later phases say so.
- **Export:** `/note` `format: export` → the clipboard (y) or `~/Downloads/<title>.md` (s), the
  name made unique as `saveMarkdown` does; open in Zotero (`/open` with the note's key); trash
  (`/notes/trash`, behind `askConfirm`).
- **Note windows** (`NoteWindow.qml`): an ordinary `NSWindow` per note (focused if open), the
  paper's header (APA citation from `/cite`, rankings, status and task pills), the same reader,
  its keys, and "the paper's menu" (`m`) bringing the launcher back on that paper's menu.
- **Notes under a paper in the results** (Space, `toggleNotes`, `withNoteRows`), ← to fold them.
- **Note order** (Shift+↑↓ on notes: `saveNoteOrder` in `view.json`).

## 2. Tags

- **The editor** (`tags`, `enterTags`): the library's tags (`/tags/list`, cached per library), the
  paper's own (`tagMap`), `buildTagRows` with the filter; Enter adds or removes (`tag`), Ctrl+Enter
  or the create row adds a new one (`create`), shown at once and undone if Zotero refuses
  (`/tags/update`); read-only libraries say so.
- **The tag menu** (Shift+Enter on a tag): rename (`tag-rename` → `tag-name` → `tag-name-save`,
  `/tags/rename`), delete (`tag-delete`, `askConfirm` with the count from `/tags/count`,
  `/tags/delete`), make it a paper status or a task status (`tag-to-paper`, `tag-to-task`,
  `tag-status-opt`: `convertTag`, with `/tags/items` and the default tasks for the task case).
- **Status tags** (`tags-status`: the settings page for the statuses).

## 3. Collections and tags as places

Enter on a collection or a tag in the results opens its papers (`openCollection`: a scoped
search, `collection` or `tag` in the body, the context bar, its count); Shift+Enter shows a
collection in Zotero (`/collection/reveal`). Pins of collections and tags open the same way.

## 4. Paper status and the default task

- **Status:** Alt+→/← on a paper (result or menu), `paper-status` (Enter: the next one): shown at
  once, saved a second after the last press (`/tags/update`: the old status tag off, the new
  one on), undone if Zotero refuses (`cyclePaperStatus`, `flushStatuses`).
- **The default task:** Shift+Alt+→/← and `default-task`: `Todos.nextDefaultStatus`, saved a
  second after the last press (`Todos.setDefaultTask` into `todos.json` through `Paths`, written
  atomically, refused while read-only), its `t/` tag following (`Todos.taskTagChanges` →
  `/tags/update`). This brings `TodosFile` and the task statuses (`Todos.statusesOf`) in now;
  the Tasks views are 4b's.

## 5. The settings engine

- **Pages:** `settings` (root, the rows that exist), `settings-general` (with the rows that stay on
  this machine marked when a sync folder is set), `settings-paper-status`, `settings-styles`,
  `settings-choice`, `settings-edit`, Sync on General; the other pages' rows say they come later.
- **Rows:** `set-nav`, `set-toggle`, `set-choice`/`set-opt`, `set-edit`/`set-save` (the edit
  view, ⌘V/Ctrl+V paste), `set-styles`/`set-style-opt` (`/styles`), `set-link` (the browser).
- **Saving** (`Service.saveSettings`): `Settings.toFile`, validated by `normalizeSettings`, split
  by `Paths.settingsSave` into the machine file and the shared one (and its cache), each written
  atomically; a sync folder change goes through `Paths.syncPlan` (4a shows the plan's problems and
  refuses; applying a plan is in the settings page "Sync", with the same probe as the Omarchy
  launcher).
- The Settings row in the results (the workspace extras: Settings only, until later phases add
  theirs) and `;`.

## 6. Arrangement

`g`/`G` (grouping, `Views.groupRows` with `Views.GROUPINGS`, kept in `view.json`), section order
in the results (Ctrl+Shift+↑↓, already in 3b) and pinned searches' order later (phase 5).

## Testing

- Goldens for each new wrapper (notes, tags, settings pages, grouping, the settings save split).
- XCTest with the fake bridge: each id on the model; the reader's keys; export (the Downloads
  name); the tag editor's optimistic update and its undo; the status debounce with an injected
  clock; `TodosFile`; settings saved to the two files (temp HOME, with and without a sync
  folder); the note window's header.
- Snapshots of the note reader, the tag editor, Settings › General.
- `scripts/parity.sh --phase 3b --phase 4a` in CI.
