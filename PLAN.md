# Zotero Launcher for macOS: the full implementation plan

Where the app is now, what "done" means, how it gets there, and in what order. The Omarchy
launcher ([oma-zotero-launcher](https://github.com/mbradaschia/oma-zotero-launcher)) is the
reference: same features, same keys, same files, on macOS. You use both machines equally, so the
same keys and the same data on both are part of "done", not a nice-to-have.

This is revision 3: a review of revision 2 against the code of both repositories. It fixes the
facts revision 2 got wrong, adds syncing your data between the two machines, splits the two
phases that were too large to review, and ties every phase to a count of ported rows.
[What changed](#what-changed-from-revision-2) is at the end.

## Where it stands (phase 2, done)

Verified on a real Mac (Apple silicon, by hand) and in CI (12 unit tests, universal build, installer):

- Menu-bar app, ⌃⌥Z (rebindable), Spotlight-style panel that takes the keys without stealing focus
- Zotero found through its handshake in `$TMPDIR`; Bearer-token calls to the bridge
- `lib/*.js` from the Omarchy launcher running in JavaScriptCore: search rows, sections, highlights
- Search as you type; ↑↓; Enter opens in Zotero; Shift+Enter shows it in the library; Esc closes
- CI: tests, universal ad-hoc-signed build, nightly release, `scripts/install.sh`
- `shared/` pinned at `8f36c1a` (oma-zotero-launcher#4 merged: the macOS runner fixes)

About 650 lines of Swift. What it ports: `ZoteroSearch.qml` (6,832 lines: the views, the key
handling, `activateAction`'s 787 lines over 164 row ids), `Service.qml` (1,945: bridge, runner,
files, background automation), `ChatWindow.qml` (1,394), `NoteWindow.qml` (529). What it reuses:
`lib/*.js` (5,315 lines: Views 2,813, Settings 958, Todos 843, Client 531, Fuzzy 170).

**Before phase 3a:** Xcode and XcodeGen on the Mac you develop on (`brew install xcodegen`, Xcode
from the App Store, `sudo xcode-select -s /Applications/Xcode.app`). TDD that runs only in CI makes
every red-green step cost a push.

## What "done" means

Feature parity with the Omarchy launcher v0.2.x, in a Mac-native shape, with your data the same on
both machines:

| Area | Done on macOS when |
|---|---|
| Search | fuzzy search and every filter; `@` pickers; saved searches, pinned badges, Tab; grouping (`g`/`G`); the search box's styled filter blocks; Go to; settings found from the search |
| Places | collections, tags, their papers; pins (papers, collections, tags) with Shift+↑↓; open papers; recent |
| A paper | every row of its menu: open in Zotero, in its own Zotero window, in the default PDF app; show in library; copy citation / bibliography; files; status (Alt+→/←); default task; menu pins, Other and row order (`p`, `P`, Shift+↑↓) |
| Notes | list, reader, note window (paper header with APA citation and rankings, its keys), copy as Markdown, save `.md`, open in Zotero, trash, note order and text size |
| Tags | editor (add, remove, create; colors, counts), tag menu (rename, delete, papers), status tags; paper/task status tags kept in sync with Zotero |
| Tasks (to-dos) | Tasks view, a task's page, quick add (`#status !priority @due`), due-date calendar, statuses |
| AI | runner setup and install, providers and keys, prompts (run, new, new with AI, edit, model, effort, output), Processes, extraction, chat window (full), artifacts, taxonomies (tag, review, audit, edit, AI drafts), rules |
| Automation | auto-extract new papers, auto-tag, auto prompts on new papers, catch-up, Sync Zotero (`S`); on one machine only (decision 13) |
| Sync | pins, saved searches, to-dos, arrangement, prompts, taxonomies, rules, chats and artifacts the same on both machines through a synced folder; offline edits on both merge without losing a deletion |
| Settings | every page in `lib/Settings.js`; the settings shared with Omarchy, split into shared and per-machine keys |
| Keys | single-key mode with the `keyDelay` typing window (0.3 s by default), Alt mode, 1–9, the Esc ladder, `?`/F1 panel; the same behavior as on Omarchy, rule for rule |
| Distribution | `install.sh` now; a notarized, auto-updating app if you decide to pay for it |

**Parity tracker.** `activateAction` (ZoteroSearch.qml:1149–1935) is one `switch (row.rowId)` with
164 `case` labels, exact string matches, no `default`, no prefixes. `scripts/parity.sh` lists them
and puts each in one of three states:

- **ported:** a key in the Swift action map (`Actions/ActionMap.swift`)
- **inert by design:** see below
- **out of scope:** written down with the reason

The [appendix](#appendix-row-ids-by-phase) assigns each id to the phase that ports it. A phase's PR
fails CI if any of its ids is still unported. "Done" means all 164 are ported or written down as
out of scope.

**Inert by design** (outside the 164; the tracker lists them so nobody ports them by mistake):
rows the JS builds that no `case` handles, so Enter does nothing on Omarchy either (`notes-empty`,
`set-info`, `tax-none`, `tax-audit-info`), and ids the QML compares but never handles
(`tax-ai-ask`, `tax-edit`).

The extraction, tested on BSD and GNU awk (don't use `\s` in `sed`: BSD `sed` lacks it, which is how
revision 2 counted 216):

```bash
awk '/^  function activateAction\(/{f=1} f&&/^  }$/{f=0}
 f&&match($0,/^[ \t]*case "[^"]+"/){s=substr($0,RSTART,RLENGTH);sub(/^[ \t]*case "/,"",s);sub(/"$/,"",s);print s"\t"NR}' \
 shared/ZoteroSearch.qml
```

Out of scope: the Hyprland binding and layer rule, `omarchy-shell`, the Super+W rebinding, and the
Linux argv settings (`zoteroCommand`, `externalPdfCommand`, `uwsm-app`): ignored on macOS, which opens
with `NSWorkspace`.

## Architecture

```
┌────────────────────── ZoteroLauncher.app (Swift) ──────────────────────┐
│  App/        menu bar, hotkey, login item, windows (panel, note, chat) │
│  Store/      AppStore: view stack, resume, the shared files            │
│  Views/      SwiftUI rows and pages; StyledTextField (search blocks)   │
│  Keys/       KeyRouter: handleKey's rules, in order                    │
│  Actions/    ActionMap: rowId → action, dispatched by the store        │
│  Core/       JSCore + Glue.js (lib/*.js), decoders, StyledText, icons  │
│  Bridge/     BridgeClient (+ queue: one search in flight, newest wins) │
│  Runner/     RunnerClient, installer, chat stream; Scheduler (ticks)   │
│  Files/      Paths (lib/Paths.js), directory watchers, conflict merge  │
└───────────────┬──────────────────────────┬──────────────────────────────┘
                │ HTTP 127.0.0.1           │ spawn + JSON lines
        Zotero + bridge (.xpi)     oma-zotero-prompt (Node runner)
                                           │
                     the synced folder ────┘ (Syncthing or similar, both machines)
```

### Decisions

1. **Rows come from `lib/*.js`; behavior is ported to Swift.** The view's rows are built by the
   same JS the QML calls. What a row does (`activateAction`), which view comes next, the key handling
   (`handleKey`), the footer hints (`hintsFor`), and the search box and header text (`placeholder`,
   `headerPlaceholder`) are ported view by view, ported only for the views that exist in each phase.
   They're imperative QML tied to view state, not worth extracting.
2. **`Glue.js`: one JS context, JSON in and out.**
   - **Loading:** `JSCore` already runs every file in one `JSContext`, each in its own function
     wrapper with its own `module`. Keep that: concatenating the files would break, because `ICON`
     (Settings, Todos) and `TASK_TAG_PREFIX` (Client, Todos) are declared twice with different
     values. The files never reference each other; every cross-module dependency is an argument.
   - **Binding:** bind the five `module.exports` objects as globals (`Fuzzy`, `Client`, `Views`,
     `Settings`, `Todos`), then evaluate `Glue.js` in the same context. Swift calls only its wrappers.
   - **The wrapped builders**, which take functions, live objects or dates:
     - `rank` (= `Fuzzy.filter`, whose `fields` hold `get` functions): `buildNoteRows`,
       `buildTagRows`, `buildPromptRows`, `buildChatRows`, `buildTaskRows`, `buildSearchRows`,
       `buildPickerValueRows` (`rank` may be null)
     - `row` (= `Views.listRow`): every `Settings.build*`
     - `row` and a `Date`: `Todos.itemTodoRows`, `Todos.buildTaskTagRows`
     - `rank`, `row`, a `Date`, `highlight`, `rangesFrom`: `Todos.buildTodoRows`
     - `statusOf` (= `Todos.statusOfTodo`): `Client.searchMarks`
   - **Dates** cross as epoch milliseconds. `Views` takes the number as is (`ago()` computes
     `(now || Date.now()) - t`); `Glue.js` makes a real `new Date(ms)` for Todos, which calls
     `getFullYear()`. A JSON date string gives "NaN d ago".
   - `fitHints(hints, widthOf, width, gap)` takes a measuring callback and is 11 lines (plus
     `hintParts`): ported to Swift with `NSFont` metrics.
   - `Views.buildRows` keeps module state (`BUILD_STATUSES`): harmless in one single-threaded context.
     All `JSCore` calls stay on the main thread.
3. **Four row shapes, decoded by the builder that made them.** Never by sniffing fields: pills
   carry a `kind` that means something else.
   - `SearchRow` (from `buildRows`, `withNoteRows`): `section, kind, key, libraryID, itemType, icon,
     title, titleHtml, subtitle, openState, pdfCount, noteCount, tagsText, ranks, status`; `status`
     `"\u0000"` means unknown.
   - `ListRow` (from `Views.listRow`, 35 fields, always present): `rowId, icon, label, labelHtml,
     detail, available, submenu, showCheck, checked, swatch, badge, trailing, attKey, attLibraryID,
     attContentType, noteKey, noteLibraryID, tag, section, promptId, value, itemKey, itemLibraryID,
     itemTitle, path, session, field, editText, pills, pillOn, pill, pillKind, chips, chipKind,
     decision`. No `ok`.
   - `SetupItem` (`Settings.setupItems`): `id, icon, label, detail, ok, action, rowId?, badge?,
     submenu?, steps?`.
   - `Pill` (`paperFooter`): `text, kind, mode`.
   - A row's identity is `rowId[:noteKey|value|promptId]` (Views.js:1028).
   - Each builder the app calls has a golden test (see Testing). A JS change that breaks a decoder
     fails CI here, not at runtime.
4. **Icons:** every row's `icon` is a Nerd Font glyph. The app bundles the Symbols Nerd Font (MIT/OFL)
   and draws the same glyphs: exact parity with no mapping table. SF Symbols stay for the app's own
   chrome. Today's `Row.swift` maps to SF Symbols; that goes in 3b.
5. **Rich text:**
   - Row titles: `StyledText` (the `<b>`/`<font>` subset).
   - Notes (`Views.noteHtml`) and chat answers: one `WKWebView` style with JavaScript off, a CSP with
     no network (`img-src data:` only), page CSS for light and dark (`noteHtml` emits a `<div>` with
     no background), and `zotero://` and `http(s)` links routed by the navigation delegate.
   - Chat Markdown: rendered to HTML in JavaScriptCore with `marked`, the runner's own dependency,
     vendored as a single pinned file. It goes through `Views.safeMarkdown` first, which sanitizes
     and doesn't render. Qt parsed the Markdown itself in `ChatWindow.qml`; this is its replacement.
6. **The runner is the only AI path.** The app spawns `oma-zotero-prompt` (`Client.promptArgv`, so
   `settings.promptCommand` is honored) and reads JSON. Keys go to the Keychain only through
   `secret set` on stdin, never `SecItemAdd`: an item the app wrote would prompt on every runner
   read. The runner confirms a key by reading it back.
7. **Installing the runner from the app:**
   - **Bundle:** the app ships `shared/daemon` (with `package-lock.json`) and `shared/scripts/{install-runner,safe-dest}.sh`
     in the same `scripts/` + `daemon/` layout the script expects (`$ROOT/daemon`).
   - **Before running it:** the app resolves `node` ≥ 22 itself (Homebrew, nvm, Volta,
     `/usr/local`), then runs the script with an explicit PATH (node's directory, `/opt/homebrew/bin`,
     `/usr/local/bin`, the system dirs), never `bash -l`. On a Mac the login shell often doesn't load
     Homebrew's environment. `npm ci` needs the network; the setup checklist says so.
   - **Updates:** the app compares the installed runner's `package.json` version with the bundled one.
     After an app update moves the pin, it offers a reinstall.
8. **Shared files: one path contract, `lib/Paths.js`.**
   - **Today** every program hardcodes its paths: `Service.qml` (settings, `pins.json`,
     `searches.json`, `view.json`, `todos.json`, `extract.json`, `instructions.md`, the runner's
     `tasks.json`), and the runner (`prompts/`, `taxonomies/`, `chats/`, `artifacts/`,
     `taxonomy.json`, its state dir). Only `OMA_ZOTERO_PROMPTS_DIR` overrides anything.
   - **Phase 2.5** moves every location into `lib/Paths.js` (ES5, like the rest of `lib/`):
     `resolve(env, machineSettings)` returns every path. QML imports it, Swift calls it through
     `JSCore`, the runner loads it with `createRequire`. Three programs, one answer. It honors
     `OMA_ZOTERO_PROMPTS_DIR` and the XDG variables as today.
   - **Arrangement preferences** (`view.json`: grouping, note order and size, section order, menu
     pins, Other and menu order) are **not** where you left off. Resume (reopen in the same view,
     query, row) is in memory, as on Omarchy.
   - **Watching for changes:** writers replace these files atomically (rename). A file-descriptor
     watch loses them, so the watchers watch the directory and re-read on any change to the name.
   - The "omarchy" folder name is cosmetic on a Mac. `Paths.js` makes renaming it later one change.
9. **Keys:** `KeyRouter` is `handleKey`'s decision order (ZoteroSearch.qml:4522–4684) as an ordered
   rule table, one rule per step, each with a test:
   1. dead keys rewritten
   2. Shift+Esc: home, never closes
   3. the Esc ladder: leave the search box (single-key mode), clear the filter, `back()`, close
   4. F1; note views to `handleNoteKey`
   5. a pending key buffer flushed unless this key is another printable list key
   6. Delete, Tab/Backtab, the calendar, Alt+Shift+←/→ (default task), Alt+←/→ (status), Shift+Enter,
      Alt+Backspace, Alt+1–9, Alt+letter, Ctrl+V, Ctrl+Enter (tags), Ctrl+S, `@`
   7. single-key mode: the buffer and the `keyDelay` timer (default 300 ms, 100–1000,
      Settings.js:11); a second key before it fires means typing
   8. editing the query; Tab gives the box focus; `prompt-edit` swallows typing
   9. Backspace or ← with an empty filter, Backtab, Shift+Tab: `back()` (with text, Backspace edits)
   10. Ctrl+Shift+↑/↓ moves a section; Shift+↑/↓ per view (pins, menu rows, notes, todos, statuses)
   11. ↑/↓, Ctrl+K/P/J/N (wrapping), PgUp/PgDn
   12. Enter/Tab/→: the paper's menu in search, `activateAction` elsewhere; other printables to the filter

   Mac specifics:
   - `KeyRouter` reads `charactersIgnoringModifiers`, since Option+letter types `ø`, `∫` and so on.
     Option dead keys (⌥E, ⌥U, ⌥N, ⌥I, ⌥\`) have tests.
   - Alt mode maps to Option. Option+←/→ in a text field stays word-jump while the search box has
     the keys; paper status moves only when the list has the keys.
   - ⌘V pastes, as well as Ctrl+V.
   - `Views.KEYBINDINGS` (86 entries) is filtered (no Super+Shift+Z, Super+W) and renamed (Alt → ⌥)
     for the `?` panel.
10. **Windows:** the launcher is the floating `NSPanel` and `W` toggles it into a regular window and
    back. The note and chat windows are ordinary `NSWindow`s (tile, full screen, Stage Manager).
11. **No sandbox, no hardened runtime until notarization.** The app reads `$TMPDIR`, talks to
    localhost and spawns Node, which a sandbox forbids. The hardened runtime comes with notarization
    and allows all three.
12. **Sync: a synced folder.** Your data follows you through a folder you sync between the two
    machines. Syncthing is suggested: peer to peer, free, on macOS and Linux. Dropbox works the same
    way. The apps don't sync anything themselves.
    - **The setting:** `syncDir` in the per-machine settings file. Unset, every path stays where it
      is today, with no migration.
    - **Under `syncDir/shared/`:** `pins.json`, `searches.json`, `todos.json`, `view.json`,
      `prompts/`, `taxonomies/`, `instructions.md`, `chats/`, `artifacts/`, `taxonomy.json`, and
      `settings.json` for the shared settings.
    - **Stays on each machine:** the machine settings file (it holds `syncDir`, the machine's name,
      `promptCommand`, the hotkey, the Linux argv settings), `extract.json`, the runner's `tasks.json`,
      and every secret.
    - **Settings scopes:** each setting in `Settings.js` gets `scope: "shared"` or `"machine"`. Both
      apps read the two files and write each key to its own.
    - **Writes:** a temp file in the same folder, then rename. The repository ships a `.stignore`
      for the temp names. Check that Quickshell's `FileView.setText` replaces by rename; where it
      doesn't, write through a temp file.
    - **Conflicts:** two machines editing the same file while apart leave a conflict copy
      (Syncthing: `<name>.sync-conflict-<date>-<time>-<device>.<ext>`; Dropbox: `<name> (<host>'s
      conflicted copy <date>).<ext>`). `lib/Merge.js`, pure and deterministic, merges it into the
      file; whichever app sees it first does, and if both do at once they write the same bytes.
      The copy is deleted only after the merge is written.

      | File | Merge |
      |---|---|
      | `todos.json` | by `id`; the newer `updated` wins |
      | `pins.json` | by `type:libraryID:key`; pins gain `updated` |
      | `searches.json` | by `id`; searches gain `updated` |
      | `view.json` | per top-level key and per view inside it; the newer file wins a key both changed |
      | `settings.json` (shared) | per key, as `view.json` |
      | Markdown, a chat, an artifact's `meta.json` | the newer file wins; the other is kept as `<name>.conflict-<machine>.<ext>` and listed in Settings › Sync |

    - **Deletions are tombstones** (`{…, deleted: <ISO date>}`), pruned after 30 days. Without
      them, a pin removed on one machine comes back from the other's copy.
13. **One automation host.** With both machines in daily use, background automation on both would
    extract, tag and run prompts on every new paper twice: duplicate notes and a double bill.
    `automationHost` (a machine's name) is a shared setting. Only that machine runs the scheduler
    (phase 7); the other says "automation runs on <name>" where the Omarchy launcher shows its
    automation state. Switching hosts is a deliberate change in Settings › Sync. No lease protocol.

### Shared-code contract

`shared/` is pinned to a commit of oma-zotero-launcher. Moving the pin is its own PR, with CI
running the golden tests and `scripts/parity.sh` against the new `lib/*.js`: new row ids show up
as unported.

Shared-code work goes to oma-zotero-launcher first, then a pin bump here. Planned so far:
phase 2.5 (`Paths.js`, settings scopes, atomic writes, `.stignore`), phase 4b (`Merge.js`,
tombstones, `updated` on pins and searches), phase 7 (`automationHost` in `Service.qml`), and
retiring `PLAN-macos.md` (below).

**`shared/PLAN-macos.md` is superseded by this file.** It contradicts it on icons (SF Symbols),
Markdown (swift-markdown-ui), watchers (`DispatchSource` on files), the schedule and the layout.
A banner at its top, in a small oma-zotero-launcher PR during phase 2.5, points here.

## Phases

Each phase starts with a design spec and an implementation plan, written with the superpowers
skills (brainstorming, then writing-plans) and saved in `docs/superpowers/specs/` and
`docs/superpowers/plans/`. Each phase is one or more PRs, each green in CI and shipped to the
nightly on merge. Each phase ends with a ~10-minute checklist you run on your Mac, and a line in
[the record](#the-record). Estimates are focused working days.

### Tier 1: the daily driver (phases 2.5–5, about 28–32 days, 77 of 164 ids)

#### Phase 2.5: one path contract (3 days, both repositories, 0 ids)

In oma-zotero-launcher, then a pin bump here:
- `lib/Paths.js` (decision 8) with node tests that pin every path, with and without `syncDir`
- `Service.qml` and the runner (`prompts.mjs`, `chat.mjs`, `artifacts.mjs`, `taxonomies.mjs`,
  `providers/index.mjs`, the tasks file) read their paths from it
- settings scopes in `Settings.js`; the shared and machine settings files (decision 12)
- atomic writes checked; the `.stignore`
- the superseded banner on `PLAN-macos.md`

Done when: the Omarchy launcher runs unchanged with no `syncDir`, and with one set it reads and
writes the new layout.

#### Phase 3a: the foundation (5 days, 0 ids, nothing visible)

- **`JSCore` + `Glue.js`** (decision 2), including `Paths.resolve`.
- **The four decoders** (decision 3); today's `Row` becomes `SearchRow`.
- **Fixtures and goldens** (see Testing): `scripts/capture-fixtures.sh` and the golden script.
- **`AppStore`:**
  - push and pop as `pushView`/`back()` do them (ZoteroSearch.qml:759–813). There is no replace:
    the QML calls `back()` twice, so the port does too.
  - a saved level: `view, filterText, caretBack, selectedIndex, followTop, scope, pickFor, searchFocus`
  - in-memory resume (ZoteroSearch.qml:261–408); `view.json` through `Paths`
- **`KeyRouter`** (decision 9): every rule, each with its test.
- **`scripts/parity.sh`** in CI, printing the three counts on every PR.

Done when: CI runs the goldens, the decoders, the key rules and the tracker, and the app behaves
exactly as in phase 2.

#### Phase 3b: a paper's menu (4–5 days, 9 ids)

- **The menu:** `/item` (8 s) → `Views.buildActions(details, viewerName, prompts, promptsProblem,
  pinned, setup, extras)` → `orderRows` → `pinRows`/`otherRows` → `filterRows` →
  `orderSections`, in the QML's order (ZoteroSearch.qml:932–947).
- **Its rows:**
  - open in Zotero (`/open`), in its own Zotero window (`/attachment` target `window`), in the
    default app (`/attachment` target `path` → `NSWorkspace`); the bridge has no other targets
  - show in library (`/reveal`); copy citation / bibliography (`/cite`, `mode` citation or
    bibliography, `format` text → `NSPasteboard`)
  - files (`buildFileRows`, rows `pick`); pin / unpin (`pins.json` through `Paths`)
  - the `confirm` view (`askConfirm`, ZoteroSearch.qml:4242)
- **Menu arrangement:** menu pins, Other, row and section order; pins reordered with Shift+↑↓.
- **Chrome:**
  - footer hints (`hintsFor` ported for these views, `fitHints` in Swift), placeholder, header,
    context bar
  - Nerd Font icons
  - `W` window toggle

Done when: the tracker shows 9 of 164 ported, and the checklist passes. It covers full-screen
apps, Stage Manager, two displays, and a password field focused behind the panel (secure input).

**Then re-estimate** (see [the record](#the-record)): ids per day and infrastructure days from
3a and 3b, applied to every phase left.

#### Phase 4a: notes, tags, collections, statuses, settings (6–7 days, 24 ids)

- **Notes:**
  - list (`buildNoteRows`), reader (`noteHtml` in the web view), Space to fold notes under a paper
  - note window: paper header (APA citation, rankings), its keys (status, default task, `c`, `m`)
  - copy as Markdown, save `.md` to Downloads as on Omarchy, open in Zotero, trash (`/notes/trash`)
  - note order and text size
- **Tags:**
  - editor (`buildTagRows`, `/tags/update`), create, colors, counts
  - tag menu: rename (`/tags/rename`), delete (`/tags/delete`), papers (`/tags/items`), count (`/tags/count`)
  - status tags
- **Collections:** open one, subcollections, reveal (`/collection/reveal`).
- **Paper statuses:** Alt+→/← (debounced save); the default task (Shift+Alt+→/←).
- **The settings engine:** the generic pages and fields (`set-nav`, `set-toggle`, `set-choice`,
  `set-opt`, `set-edit`, `set-save`, `set-styles`, `set-style-opt`, `set-link`), with Settings ›
  General, Settings › Paper status and Settings › Sync. Every later settings page uses it.
- **Arrangement:** grouping (`g`/`G`, `groupRows`); section reorder (Ctrl+Shift+↑↓).

#### Phase 4b: tasks and merging (6–7 days, 31 ids)

- **Tasks (to-dos), no runner needed:**
  - Tasks view, a task's page, new task, quick add
  - the edit, text, status, priority and due (calendar) views
  - a paper's Tasks section (`itemTodoRows`), Settings › Tasks, the status lists
- **Tag sync:** paper/task status tags kept in sync with Zotero (`/tags/prefixed`, `/tags/changes`,
  `Todos.taskTagSync`).
- **Merging** (decision 12), first in oma-zotero-launcher: `lib/Merge.js` with node tests,
  tombstones, `updated` on pins and searches; then the app runs it on every conflict copy its
  watchers see.

Done when: the two-machine checklist passes: Syncthing between the Mac and the Omarchy machine,
edits made on both while apart (a to-do changed on one and deleted on the other, a pin added on
one, a search renamed on both), reconnected, the same result on both.

#### Phase 5: search power (4–5 days, 13 ids)

- `@` pickers (`/facets`, `buildPickerRows`, `buildPickerValueRows`, dates). Taxonomy pickers get `[]` until phase 9.
- Saved searches: save (Ctrl+S), the Searches view, menu, edit; pinned badges; Tab / Shift+Tab.
- Scoped search inside a collection, a tag, a saved search; scope counts.
- **`StyledTextField`** (an `NSTextView`-backed field) drawing `Views.querySegments` and
  `Todos.taskSegments` blocks; a plain `TextField` can't.
- Go to (`commandRows`) for the places that exist so far.
- **Sync Zotero:** `S`, `/sync/status`, `/sync/start`, the footer's sync word.

**Checkpoint after tier 1** (77 of 164). Decide whether the AI tiers are worth the next 6–7 weeks part-time,
or whether the runner's CLI and the Omarchy machine cover your AI work.

### Tier 2: AI (phases 6–9, about 26–32 days, 87 of 164 ids)

#### Phase 6: the runner, prompts, processes (9–11 days, 41 ids)

- **`RunnerClient`:** `Client.promptArgv`, a clean environment with the explicit PATH, timeouts,
  JSON, stderr surfaced.
- **Install from the app** (decision 7) and the reinstall offer.
- **Setup checklist** (`Settings.setupItems`): Node, runner, pdftotext (`brew install poppler`), the
  Zotero plugin (download and install steps), Zotero running.
- **Models & providers:** `providers`, `models`, `provider-test`, keys (`secret set`), endpoints,
  defaults, effort.
- **Prompts:** list, run (a paper, a scope), new, new with AI (`new-ai`), edit (`edit`, opens in
  TextEdit), title, model, effort, output; `/notes/by-prompt`.
- **Processes:** `tasks.json` watched; open what a task made; clear.
- **Extraction:** a paper's text (`extract`, `/fulltext`, `/annotations`), the extract menu,
  Settings › Defaults › the paper's text.
- **Rules:** Settings › Rules from `daemon/lib/rules.json` and `instructions.md`; `system` / `system edit`.
- **Settings found from the search** (`settingsIndex`, `settingRows`, `settingMenuRows`, `setting-go`),
  with every page that exists by now.

#### Phase 7: background automation (4–5 days, 4 ids)

The `Service.qml` scheduler (lines ~940–1520), ported to one Swift `Scheduler`:
- extract new papers; tag new papers; auto prompts on new papers (Settings › Auto prompts)
- the catch-up loop (`extract-batch`, `catchup-plan`; its rows come from `Settings.buildDefaults`)
- the `extract.json` state machine; `/papers/select` and `/extract/pending` polling; waiting for
  text before tagging
- **`automationHost`** (decision 13), in both launchers: a machine that isn't the host schedules
  nothing and says so.

Runs while the app runs; nothing scheduled when it's quit.

#### Phase 8: chat and artifacts (8–10 days, 19 ids)

- **Chat window** (`ChatWindow.qml`, 1,394 lines):
  - streaming `chat` events (`session`, `delta`, `status`, `note`, `artifact`, `context`, `quotes`, `done`, `error`); stop
  - source (extracted note or PDF), auto-extract before chatting
  - switch paper; use a prompt; per-chat model and effort
  - context meter, tokens and cost; quote check
  - history (`chats`, `chat-show`, `chat-rename`, `chat-delete`); chat menu
  - save an answer or the chat to Zotero (`note`), the clipboard, a file
- **Artifacts:** list, open in the browser, rename, undo, delete, change with AI (`artifact-edit`),
  `artifact-libs`.

#### Phase 9: taxonomies (5–6 days, 23 ids)

- Tag a paper or a scope (`classify`), status, review (accept / dismiss, `classify-review`, `classify-decide`).
- The audit (`classify-show`, `tax-audit`); a paper's Taxonomies page; taxonomy pills and pickers.
- Settings › Taxonomies: list, a taxonomy's form, labels, AI drafts (`taxonomy-draft`), new, save, remove, on/off.

### Tier 3: finish (phase 10, 4–5 days, part your decision)

- Keybindings panel (`?`/F1, filtered `KEYBINDINGS`); login item (`SMAppService`); the menu bar menu
- Accessibility: VoiceOver labels, larger text, Reduce Motion
- Performance: under 50 ms per keystroke on a 5,000-paper library, the app adding ≤ 10 ms
- **Your call:** Apple Developer Program (99 USD/year) for a signed, notarized build with
  auto-update (Sparkle). Without it, `install.sh` keeps working for you.
- README, CHANGELOG, version aligned with oma-zotero-launcher (`0.3.0` = parity)

**Total: about 58–69 focused days**, sync included (phase 2.5, the merging in 4b, the host rule
in 7: about 6–8 days). At part-time pace that's roughly 3½–4 months. Tier 1 alone is about 6–7
weeks part-time.

### The record

One line per phase, filled in when it ends. After 3b, the re-projection replaces the estimates
above.

| Phase | Estimated | Actual | Ids ported (total) | Notes |
|---|---|---|---|---|
| 2.5 | 3 | | 0 (0) | |
| 3a | 5 | | 0 (0) | |
| 3b | 4–5 | | 9 (9) | |
| 4a | 6–7 | | 24 (33) | |
| 4b | 6–7 | | 31 (64) | |
| 5 | 4–5 | | 13 (77) | |
| 6 | 9–11 | | 41 (118) | |
| 7 | 4–5 | | 4 (122) | |
| 8 | 8–10 | | 19 (141) | |
| 9 | 5–6 | | 23 (164) | |
| 10 | 4–5 | | 0 (164) | |

## Testing

| Layer | How | Where |
|---|---|---|
| Shared JS (`lib/*.js`, `Paths.js`, `Merge.js`) | node tests (`make test`) | oma-zotero-launcher CI (Linux + macOS) |
| `Glue.js` + decoders: every builder the app calls | goldens: the same fixture through node and through JavaScriptCore, outputs compared, then decoded | this repo's CI |
| `KeyRouter` | one XCTest per rule, in order; dead keys, ⌘V | this repo's CI |
| Bridge client, runner client (a fake runner script), directory watchers, conflict handling, scheduler | XCTest | this repo's CI |
| Parity tracker | `scripts/parity.sh` on every PR; a phase PR fails if its ids aren't ported | this repo's CI |
| Views | SwiftUI previews with fixtures; a few XCUITest smoke flows | CI, best effort, never gating on a flaky test |
| The real thing | per-phase checklist on your Mac, your library; the two-machine sync checklist from 4b on | you, ~10 minutes per phase |

**Fixtures and goldens.**
- **Capture:** `shared/` has no fixtures: its node tests use inline literals. So
  `scripts/capture-fixtures.sh` records real `/search` (empty and typed), `/item`, `/note`,
  `/tags/list` and `/facets` answers from your Zotero.
- **Scrub:** before anything is written it replaces titles, creators, publications, abstracts,
  note text and tag names with deterministic fakes of the same length and shape (ranges still
  line up). It refuses to write an answer it couldn't scrub.
- **Goldens:** `scripts/goldens.mjs` runs each builder on each fixture in node and writes the
  expected output. The Swift test runs the same builder through `JSCore` and compares. That
  catches JavaScriptCore vs V8 differences (`String.prototype.normalize`, `Date.parse`, sort
  stability) as well as decoder breaks.

**Merge tests** (node, oma-zotero-launcher): Syncthing and Dropbox conflict names; each file's rule;
tombstones (deleted on one, edited on the other); pruning; two machines merging the same conflict
write identical bytes.

## Risks

| Risk | Likelihood | What we do |
|---|---|---|
| `activateAction` / `handleKey` hide behavior that only shows when ported | high | the parity tracker; the rule table with a test per rule; port with the QML open; the per-phase checklist |
| The estimate is still low (revision 1 was half the real size) | medium | the re-projection after 3b from ids per day; the record; tier checkpoints |
| A `lib/*.js` change on the Omarchy side breaks the Mac app | medium | nothing changes until the pin moves; the pin PR runs the goldens and the tracker |
| The 164 drifts when the Omarchy side adds rows | medium | the pin PR reruns `parity.sh`; new ids land unported in a named phase |
| Sync loses an edit or brings back a deletion | medium | tombstones; merge by record; the conflict copy kept until the merge is written; the two-machine checklist |
| Automation runs on both machines | high without decision 13 | `automationHost`; the other machine schedules nothing and says why |
| A program disagrees about where a file lives | medium | one `Paths.js` for QML, Swift and the runner; a node test pins every path |
| Fixtures leak library content into git | low | scrubbed before writing; the capture script refuses what it can't scrub |
| `NSPanel` focus edge cases (full screen, Stage Manager, displays, secure input) | medium | 3b's checklist; fall back to a key window where a case can't be fixed |
| Node from a GUI app (Homebrew, nvm, Volta, none) | medium | the app resolves node itself and passes an explicit PATH (decision 7) |
| Web view styling of `noteHtml` (written for Qt's rich text) | low | page CSS; fixtures of real notes in the checklist |
| Gatekeeper gets stricter for unsigned apps | medium | `install.sh` clears quarantine; notarization if it gets worse |
| Scope creep (it's not the PhD) | high | tiers with a checkpoint; stop after tier 1 if it covers your days |

## Process

- A phase starts with its spec and plan (superpowers brainstorming, then writing-plans) in
  `docs/superpowers/`; shared-code work gets its own in oma-zotero-launcher
- Branch per PR, CI green before merge, nightly on merge, `install.sh` to update
- Shared-code changes go to oma-zotero-launcher first, then a pin bump PR here
- Each phase ends with what changed, the checklist, its line in the record (estimated vs. actual
  days, ids ported), and after 3b the re-projection

## Appendix: row ids by phase

The 164 `case` labels of `activateAction`, each in the phase that ports it. `scripts/parity.sh`
reads this table (3a moves it to `docs/parity-phases.tsv`).

| Phase | Count | Ids |
|---|---|---|
| 3b | 9 | open reveal external window pick pin cite-copy confirm-yes confirm-no |
| 4a | 24 | notes read note paper-status default-task tags-status tag-to-paper tag-to-task tag-status-opt tag-rename tag-name-save tag-delete tags tag create set-nav set-toggle set-choice set-opt set-edit set-save set-styles set-style-opt set-link |
| 4b | 31 | task-default todo todo-new todo-new-save todo-quick todo-save todo-edit todo-text-save todo-status todo-priority todo-desc todo-notes todo-due todo-status-opt todo-priority-opt todo-item todo-context todo-pick todo-unlink todo-delete pstatus pstatus-add status task-action task-action-add status-add status-rename status-name-save status-remove pstatus-migrate task-tag |
| 5 | 13 | search search-open search-pin search-rename search-query search-delete search-save search-save-pin search-rename-save search-query-save pick-field pick-op pick-value |
| 6 | 41 | extract ext-read ext-again ext-zotero ext-delete task tasks-clear setup set-extract-all set-extract-retry set-rule set-rules-reset set-system-edit set-system-reset set-models set-use set-model set-provider set-quick set-test set-key set-key-remove setting-go set-endpoint-new set-endpoint-remove set-setup set-install prompts prompt prompt-new pe-title pe-title-save pe-title-ai pe-model pe-effort pe-output pe-brief pe-output-opt pe-model-opt pe-effort-opt pe-text |
| 7 | 4 | set-catchup set-catchup-stop set-auto-prompt pe-auto |
| 8 | 19 | chat chat-new chat-session chat-menu-open chat-menu-rename chat-rename-save chat-menu-delete chat-open artifact art-open art-change art-change-go art-brief art-source art-folder art-undo art-rename art-rename-save art-delete |
| 9 | 23 | classify classify-audit tax-open tax-on tax-new tax-show tax-kind tax-label tax-label-add tax-paper tax-label-papers tax-audit tax-ai-new tax-ai-edit tax-ai-accept tax-ai-discard tax-label-delete tax-editor tax-reset tax-off tax-delete tax-review tax-suggestion |

Notes on the less obvious placements: `task` and `tasks-clear` are Processes (runner jobs), not
to-dos, so phase 6. `task-default`, `pstatus*`, `status*` and `task-action*` are Settings pages
for statuses and tasks, so phase 4b. `pe-auto` is auto prompts, so phase 7.

## What changed from revision 2

- **Facts fixed:**
  - 164 row ids, not 216. The 216 counted the `case` labels and the comparison literals separately,
    because BSD `sed` has no `\s`.
  - The pin already moved: `shared/` is at `8f36c1a`, with #4 merged. Phase 3 no longer bumps it.
  - List rows have no `ok` (setup items do). There are four row shapes, not two.
  - Decision 2 missed four builders that take functions or dates (`buildPickerValueRows`,
    `Todos.itemTodoRows`, `Todos.buildTaskTagRows`, `Client.searchMarks`) and one with its own
    row shape (`Settings.setupItems`). Todos needs a real `Date`, not a string.
  - The view stack has no replace primitive; the QML calls `back()` twice.
  - `JSCore` already shares one context; the files must stay wrapped (`ICON` and
    `TASK_TAG_PREFIX` collide).
  - `shared/` has no fixtures; real ones need capturing and scrubbing.
- **Added:**
  - sync between the two machines through a synced folder (decisions 8, 12): phase 2.5, merging in
    4b, Settings › Sync
  - one automation host (decision 13)
  - the inert-by-design ids and the three tracker states; the tracker's recipe; the id-to-phase
    appendix; CI failing a phase PR with unported ids
  - goldens through node and JavaScriptCore; the scrubbing capture script
  - `KeyRouter` as `handleKey`'s 12 rules with a test each; Option dead keys; ⌘V
  - Xcode and XcodeGen as a prerequisite; the record and the re-projection after 3b
  - a spec and a plan per phase, with the superpowers skills
  - `PLAN-macos.md` marked superseded
- **Split:** phase 3 into 3a (foundation) and 3b (the paper menu); phase 4 into 4a and 4b at the
  tasks boundary. `paper-status` and `default-task` moved from the paper menu to 4a, since they
  need the status lists.
- **Moved:** the generic settings engine from phase 6 to 4a, since phase 4 needs settings pages.
- **Estimate:** 51–63 → 58–69 days, sync included.

Revision 1 → 2's changes are in the git history (`e928ae2`).
