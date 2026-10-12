# Zotero Launcher for macOS: the full implementation plan

Where the app is now, what "done" means, how it gets there, and in what order. The Omarchy
launcher ([oma-zotero-launcher](https://github.com/mbradaschia/oma-zotero-launcher)) is the
reference: same features, same keys, same files, on macOS.

This is revision 2. An independent review of revision 1 against both codebases found the work was
about twice as large as estimated and that several claims were wrong. Its corrections are folded in
below; [what changed](#what-changed-from-revision-1) is at the end.

## Where it stands (phase 2, done)

Verified on a real Mac (Apple silicon, by hand) and in CI (12 unit tests, universal build, installer):

- Menu-bar app, ⌃⌥Z (rebindable), Spotlight-style panel that takes the keys without stealing focus
- Zotero found through its handshake in `$TMPDIR`; Bearer-token calls to the bridge
- `lib/*.js` from the Omarchy launcher running in JavaScriptCore: search rows, sections, highlights
- Search as you type; ↑↓; Enter opens in Zotero; Shift+Enter shows it in the library; Esc closes
- CI: tests, universal ad-hoc-signed build, nightly release, `scripts/install.sh`

About 650 lines of Swift. What it ports: `ZoteroSearch.qml` (6,832 lines: the views, the key
handling, `activateAction`'s ~800 lines over 216 row ids), `Service.qml` (1,945: bridge, runner,
files, background automation), `ChatWindow.qml` (1,394), `NoteWindow.qml` (529). What it reuses:
`lib/*.js` (5,315 lines).

## What "done" means

Feature parity with the Omarchy launcher v0.2.x, in a Mac-native shape:

| Area | Done on macOS when |
|---|---|
| Search | fuzzy search and every filter; `@` pickers; saved searches, pinned badges, Tab; grouping (`g`/`G`); the search box's styled filter blocks; Go to; settings found from the search |
| Places | collections, tags, their papers; pins (papers, collections, tags) with Shift+↑↓; open papers; recent |
| A paper | every row of its menu: open in Zotero, in its own Zotero window, in the default PDF app; show in library; copy citation / bibliography; files; status (Alt+→/←); default task; menu pins, Other and row order (`p`, `P`, Shift+↑↓) |
| Notes | list, reader, note window (paper header with APA citation and rankings, its keys), copy as Markdown, save `.md`, open in Zotero, trash, note order and text size |
| Tags | editor (add, remove, create; colors, counts), tag menu (rename, delete, papers), status tags; paper/task status tags kept in sync with Zotero |
| Tasks (to-dos) | Tasks view, a task's page, quick add (`#status !priority @due`), due-date calendar, statuses |
| AI | runner setup and install, providers and keys, prompts (run, new, new with AI, edit, model, effort, output), Processes, extraction, chat window (full), artifacts, taxonomies (tag, review, audit, edit, AI drafts), rules |
| Automation | auto-extract new papers, auto-tag, auto prompts on new papers, catch-up, Sync Zotero (`S`) |
| Settings | every page in `lib/Settings.js`; the settings file shared with Omarchy |
| Keys | single-key mode with the 0.3 s typing window, Alt mode, 1–9, the Esc ladder, `?`/F1 panel |
| Distribution | `install.sh` now; a notarized, auto-updating app if you decide to pay for it |

**Parity tracker.** "Every row" is checkable: `scripts/parity.sh` lists the 216 row ids
`activateAction` handles in `shared/ZoteroSearch.qml` and marks the ones the Swift action map
handles. Each phase's PR says which ids it covers. "Done" means the list is all marked or each
gap is written down as out of scope.

Out of scope: the Hyprland binding and layer rule, `omarchy-shell`, the Super+W rebinding, and the
Linux argv settings (`zoteroCommand`, `externalPdfCommand`, `uwsm-app`): ignored on macOS, which opens
with `NSWorkspace`.

## Architecture

```
┌────────────────────── ZoteroLauncher.app (Swift) ──────────────────────┐
│  App/        menu bar, hotkey, login item, windows (panel, note, chat) │
│  Store/      AppStore: view stack, resume, the shared files            │
│  Views/      SwiftUI rows and pages; StyledTextField (search blocks)   │
│  Keys/       KeyRouter: single-key, Alt, 0.3 s window, Esc ladder      │
│  Actions/    rowId → Action, dispatched by the store                   │
│  Core/       JSCore + Glue.js (lib/*.js), StyledText, NoteHTML, icons  │
│  Bridge/     BridgeClient (+ queue: one search in flight, newest wins) │
│  Runner/     RunnerClient, installer, chat stream; Scheduler (ticks)   │
│  Files/      directory watchers for the shared state files             │
└───────────────┬──────────────────────────┬──────────────────────────────┘
                │ HTTP 127.0.0.1           │ spawn + JSON lines
        Zotero + bridge (.xpi)     oma-zotero-prompt (Node runner)
```

### Decisions

1. **Rows come from `lib/*.js`; behavior is ported to Swift.** The view's rows are built by the
   same JS the QML calls. What a row does (`activateAction`), which view comes next, the key handling
   (`handleKey`), the footer hints (`hintsFor`), and the search box and header text (`placeholder`,
   `headerPlaceholder`) are ported view by view. They're imperative QML tied to view state, not
   worth extracting. No `Nav.js`: revision 1 proposed one, and the review showed what's extractable
   is either already in `lib/` (`selectionAfter`, `orderRows`) or too small to matter.
2. **`Glue.js`: one JS context, JSON in and out.** Many builders take functions or live objects:
   - `rank` (= `Fuzzy.filter`): `buildNoteRows`, `buildTagRows`, `buildPromptRows`, `buildChatRows`,
     `buildTaskRows`, `buildSearchRows`
   - `row` (= `Views.listRow`): every `Settings.build*`
   - `Todos.buildTodoRows`: `rank`, `row`, a `Date`, `highlight`, `rangesFrom`

   The app evaluates all of `lib/*.js` into one context, then an app-side `Glue.js` that binds those
   arguments and exposes JSON-only wrappers. Swift calls only the wrappers. `fitHints` takes a
   text-measuring callback and is 12 lines, so it's ported to Swift with `NSFont` metrics.
3. **Rows decode by shape.** Search rows (`kind`) and list rows (`rowId`, `label`, `detail`,
   `icon`, `badge`, `available`, `ok`…) are separate Swift types. Each builder the app calls has a
   decoding test with a real fixture. A JS change that breaks a decoder fails CI here, not at runtime.
4. **Icons:** every row's `icon` is a Nerd Font glyph. The app bundles the Symbols Nerd Font (MIT/OFL)
   and draws the same glyphs. This is exact parity with no mapping table to maintain. SF Symbols stay
   for the app's own chrome.
5. **Rich text:**
   - Row titles: `StyledText` (the `<b>`/`<font>` subset).
   - Notes (`Views.noteHtml`) and chat answers: one `WKWebView` style with JavaScript off, a CSP with
     no network (`img-src data:` only), page CSS for light and dark (`noteHtml` emits a `<div>` with
     no background), and `zotero://` and `http(s)` links routed by the navigation delegate.
   - Chat Markdown: rendered to HTML in JavaScriptCore with `marked`, the runner's own dependency,
     vendored as a single pinned file. It goes through `safeMarkdown` first. Qt parsed the Markdown
     itself in `ChatWindow.qml`; this is its replacement.
6. **The runner is the only AI path.** The app spawns `oma-zotero-prompt` (`Client.promptArgv`, so
   `settings.promptCommand` is honored) and reads JSON. Keys go to the Keychain only through
   `secret set` on stdin. The app never touches them, so the runner reads them without prompts.
7. **Installing the runner from the app:**
   - **Bundle:** the app ships `shared/daemon` (with `package-lock.json`) and `shared/scripts/{install-runner,safe-dest}.sh`
     in the same `scripts/` + `daemon/` layout the script expects (`$ROOT/daemon`).
   - **Before running it:** the app resolves `node` ≥ 22 itself (Homebrew, nvm, Volta,
     `/usr/local`), then runs the script with an explicit PATH (node's directory, `/opt/homebrew/bin`,
     `/usr/local/bin`, the system dirs), never `bash -l`. On a Mac the login shell often doesn't load
     Homebrew's environment. `npm ci` needs the network; the setup checklist says so.
   - **Updates:** the app compares the installed runner's `package.json` version with the bundled one.
     After an app update moves the pin, it offers a reinstall.
8. **Shared files, same paths and the same meaning:**
   - **The settings file:** `~/.config/omarchy/oma-zotero-launcher.json`.
   - **Arrangement preferences:** `~/.config/omarchy/oma-zotero-launcher/view.json` holds grouping, note
     order and size, section order, menu pins, Other and menu order. It is **not** where you left off.
     Resume (reopen in the same view, query, row) is in memory, as on Omarchy.
   - **The other shared files:** `pins.json`, `searches.json`, `todos.json`, `extract.json`,
     `instructions.md`, and `~/.local/state/oma-zotero/tasks/tasks.json`.
   - The "omarchy" folder name is cosmetic on a Mac. Renaming it is a later cross-repo change, behind a
     migration.
   - **Watching for changes:** writers replace these files atomically (rename). A file-descriptor
     watch loses them, so the watchers watch the directory and re-read on any change to the name.
9. **Keys:** `KeyRouter` reads `charactersIgnoringModifiers`, since Option+letter types `ø`, `∫` and
   so on. Alt mode maps to Option. Option+←/→ in a text field stays word-jump while the search box
   has the keys; paper status moves only when the list has the keys. `Views.KEYBINDINGS` is filtered
   (no Super+Shift+Z, Super+W) and renamed (Alt → ⌥) for the `?` panel.
10. **Windows:** the launcher is the floating `NSPanel` and `W` toggles it into a regular window and
    back. The note and chat windows are ordinary `NSWindow`s (tile, full screen, Stage Manager).
11. **No sandbox, no hardened runtime until notarization.** The app reads `$TMPDIR`, talks to
    localhost and spawns Node, which a sandbox forbids. The hardened runtime comes with notarization
    and allows all three.

### Shared-code contract

`shared/` is pinned to a commit of oma-zotero-launcher. Moving the pin is its own PR, with CI
running the decoding tests against the new `lib/*.js`.

**The pin must move before phase 3.** Today it points at master `1de84ed`, which lacks the macOS
runner fixes (handshake in `$TMPDIR`, Keychain, Homebrew paths, BSD `stat` in `safe-dest.sh`).
They're in [oma-zotero-launcher#4](https://github.com/mbradaschia/oma-zotero-launcher/pull/4)
(branch `claude/pensive-maxwell-mpzso2`). Merge #4, then the pin moves to master.

## Phases

Each phase is several PRs. Each PR is green in CI and ships to the nightly on merge, and each
phase ends with a ~10-minute checklist you run on your Mac. Estimates are focused working days.

### Tier 1: the daily driver (phases 3–5, about 22–27 days)

#### Phase 3: the foundation and a paper's menu (8–10 days)

Everything later phases stand on.

- Pin bump past #4. `JSCore`: all modules in one context, `Glue.js`, list-row decoding with fixtures.
- **`AppStore`:** view stack (push / pop / replace), in-memory resume, `view.json` arrangement preferences.
- **Search post-processing:**
  - pass paper statuses to `buildRows`
  - the status overlay, `pinnedFirst`, `withNoteRows`, `selectionAfter`
  - the `searchMarks` request body
- **`KeyRouter`:**
  - the list vs. the search box; the 0.3 s window
  - Alt (Option) mode; 1–9; the Esc ladder (Esc, Shift+Esc)
  - `/`, Backspace, ←, j/k, PgUp/PgDn
- **`Actions`:** the `rowId` → action map, the parity tracker script, the `confirm` view.
- **A paper's menu:**
  - `/item` details → `Views.buildActions`
  - open in Zotero (`/open`), in its own Zotero window (`/attachment` target `window`), in the
    default app (`/attachment` target `path` → `NSWorkspace`)
  - show in library (`/reveal`); copy citation / bibliography (`/cite` → `NSPasteboard`)
  - files (`buildFileRows`); pin / unpin (`pins.json`)
- **Menu arrangement:** menu pins, Other, row and section order (`orderRows`, `pinRows`,
  `otherRows`, `orderSections`); pins reordered with Shift+↑↓.
- **Chrome:**
  - footer hints (`hintsFor` ported, `fitHints` in Swift), placeholder, header, context bar
  - Nerd Font icons
  - `W` window toggle

Done when: the paper-menu row ids that don't need the runner are all marked in the tracker, and the
checklist passes. It covers full-screen apps, Stage Manager, two displays, and a password field
focused behind the panel (secure input).

#### Phase 4: notes, tags, collections, statuses, tasks (10–12 days)

- **Notes:**
  - list (`buildNoteRows`), reader (`noteHtml` in the web view), Space to fold notes under a paper
  - note window: paper header (APA citation, rankings), its keys (status, default task, `c`, `m`)
  - copy as Markdown, save `.md` to Downloads as on Omarchy, open in Zotero, trash (`/notes/trash`)
  - note order and text size
- **Tags:**
  - editor (`buildTagRows`, `/tags/update`), create, colors, counts
  - tag menu: rename (`/tags/rename`), delete (`/tags/delete`), papers (`/tags/items`), count (`/tags/count`)
  - status tags
- **Tag sync:** paper/task status tags kept in sync with Zotero (`/tags/prefixed`, `/tags/changes`, `Todos.taskTagSync`).
- **Collections:** open one, subcollections, reveal (`/collection/reveal`).
- **Paper statuses:** Alt+→/← (debounced save); the default task (Shift+Alt+→/←); Settings › Paper status.
- **Arrangement:** grouping (`g`/`G`, `groupRows`); section reorder (Ctrl+Shift+↑↓).
- **Tasks (to-dos), no runner needed:**
  - Tasks view, a task's page, new task, quick add
  - the edit, text, status, priority and due (calendar) views
  - a paper's Tasks section (`itemTodoRows`), Settings › Tasks

#### Phase 5: search power (4–5 days)

- `@` pickers (`/facets`, `buildPickerRows`, `buildPickerValueRows`, dates). Taxonomy pickers get `[]` until phase 9.
- Saved searches: save (Ctrl+S), the Searches view, menu, edit; pinned badges; Tab / Shift+Tab.
- Scoped search inside a collection, a tag, a saved search; scope counts.
- **`StyledTextField`** (an `NSTextView`-backed field) drawing `Views.querySegments` and
  `Todos.taskSegments` blocks; a plain `TextField` can't.
- Go to (`commandRows`) for the places that exist so far.
- **Sync Zotero:** `S`, `/sync/status`, `/sync/start`, the footer's sync word.

**Checkpoint after tier 1.** Decide whether the AI tiers are worth the next 4–6 weeks, or whether
the runner's CLI and the Omarchy machine cover your AI work.

### Tier 2: AI (phases 6–9, about 25–31 days)

#### Phase 6: the runner, prompts, processes (8–10 days)

- **`RunnerClient`:** `Client.promptArgv`, a clean environment with the explicit PATH, timeouts,
  JSON, stderr surfaced.
- **Install from the app** (decision 7) and the reinstall offer.
- **Setup checklist** (`Settings.setupItems`): Node, runner, pdftotext (`brew install poppler`), the
  Zotero plugin (download and install steps), Zotero running.
- **Models & providers:** `providers`, `models`, `provider-test`, keys (`secret set`), defaults, effort.
- **Prompts:** list, run (a paper, a scope), new, new with AI (`new-ai`), edit (`edit`, opens in
  TextEdit), title, model, effort, output; `/notes/by-prompt`.
- **Processes:** `tasks.json` watched; open what a task made.
- **Extraction:** a paper's text (`extract`, `/fulltext`, `/annotations`), the extract menu,
  Settings › Defaults › the paper's text.
- **Rules:** Settings › Rules from `daemon/lib/rules.json` and `instructions.md`; `system` / `system edit`.
- **Settings found from the search** (`settingsIndex`, `settingRows`, `settingMenuRows`), with every
  page that exists by now.

#### Phase 7: background automation (4–5 days)

The `Service.qml` scheduler (lines ~940–1520), ported to one Swift `Scheduler`:
- extract new papers; tag new papers; auto prompts on new papers
- the catch-up loop (`extract-batch`, `catchup-plan`, `Settings.catchUpRows`)
- the `extract.json` state machine; `/papers/select` and `/extract/pending` polling; waiting for
  text before tagging

Runs while the app runs; nothing scheduled when it's quit.

#### Phase 8: chat and artifacts (8–10 days)

- **Chat window** (`ChatWindow.qml`, 1,394 lines):
  - streaming `chat` events (`session`, `delta`, `status`, `note`, `artifact`, `context`, `quotes`, `done`, `error`); stop
  - source (extracted note or PDF), auto-extract before chatting
  - switch paper; use a prompt; per-chat model and effort
  - context meter, tokens and cost; quote check
  - history (`chats`, `chat-show`, `chat-rename`, `chat-delete`); chat menu
  - save an answer or the chat to Zotero (`note`), the clipboard, a file
- **Artifacts:** list, open in the browser, rename, undo, delete, change with AI (`artifact-edit`),
  `artifact-libs`.

#### Phase 9: taxonomies (5–6 days)

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

**Total: about 51–63 focused days.** At part-time pace that's roughly 3–4 months. Tier 1 alone
is about 5–6 weeks part-time.

## Testing

| Layer | How | Where |
|---|---|---|
| Shared JS (`lib/*.js`) | node tests | oma-zotero-launcher CI (Linux + macOS) |
| `Glue.js` + decoding: every builder the app calls → Swift types | XCTest with real fixtures | this repo's CI |
| Bridge client, runner client (a fake runner script), file watchers, key router, scheduler | XCTest | this repo's CI |
| Parity tracker | `scripts/parity.sh` report on every PR | this repo's CI |
| Views | SwiftUI previews with fixtures; a few XCUITest smoke flows | CI, best effort, never gating on a flaky test |
| The real thing | per-phase checklist on your Mac, your library | you, ~10 minutes per phase |

## Risks

| Risk | Likelihood | What we do |
|---|---|---|
| `activateAction` / `handleKey` hide behavior that only shows when ported | high | the parity tracker; port with the QML open; the per-phase checklist |
| The estimate is still low (the first one was half the real size) | medium | re-estimate at the end of each phase from actual days; tier checkpoints |
| A `lib/*.js` change on the Omarchy side breaks the Mac app | medium | nothing changes until the pin moves; the pin PR runs the decoding tests |
| `NSPanel` focus edge cases (full screen, Stage Manager, displays, secure input) | medium | phase 3's checklist; fall back to a key window where a case can't be fixed |
| Node from a GUI app (Homebrew, nvm, Volta, none) | medium | the app resolves node itself and passes an explicit PATH (decision 7) |
| Web view styling of `noteHtml` (written for Qt's rich text) | low | page CSS; fixtures of real notes in the checklist |
| Gatekeeper gets stricter for unsigned apps | medium | `install.sh` clears quarantine; notarization if it gets worse |
| Scope creep (it's not the PhD) | high | tiers with a checkpoint; stop after tier 1 if it covers your days |

## Process

- Branch per PR, CI green before merge, nightly on merge, `install.sh` to update
- Shared-code changes go to oma-zotero-launcher first, then a pin bump PR here
- Each phase ends with what changed, the checklist, the parity tracker's count, actual vs. estimated days

## What changed from revision 1

- **Estimate:** 23–28 → 51–63 days. Six phases became eight, split into three tiers with a checkpoint.
- **Wrong facts fixed:**
  - `/attachment` has no `reader` target; open in Zotero is `/open`.
  - The menu needs `/item`.
  - Rows act by `rowId`, not `kind`/`action`.
  - Resume is in memory, not in `view.json`.
  - `lib/*.js` is 5,315 lines.
  - `safeMarkdown` doesn't render Markdown.
- **Architecture:**
  - `Glue.js` for builders that take functions or dates; `fitHints` in Swift.
  - No `Nav.js`.
  - Nerd Font bundled.
  - `marked` for chat.
  - Directory watchers.
  - Option-key handling.
  - Runner install with an explicit PATH and a version check.
  - The pin moves before phase 3.
- **Added:**
  - background automation (phase 7)
  - status and task tag sync
  - Sync Zotero
  - menu pins, Other, row order
  - note order and size
  - the note window's header and keys
  - the chat window's full feature set
  - Rules data
  - `catchup-plan`
  - the styled search field
  - footer, header and placeholder text
  - the `W` toggle, `confirm` and `keys` views
  - the parity tracker
- **Moved:**
  - tasks (to-dos) from the AI phase to phase 4, since they need no runner
  - settings search from phase 5 to phase 6, since it needs every page
