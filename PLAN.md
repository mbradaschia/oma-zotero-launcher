# Zotero Launcher for macOS: the full implementation plan

Where the app is now, what "done" means, how it gets there, and in what order. The Omarchy
launcher ([oma-zotero-launcher](https://github.com/mbradaschia/oma-zotero-launcher)) is the
reference: same features, same keys, same files, on macOS.

## Where it stands (phase 2, done)

Verified on a real Mac (Apple silicon, by hand) and in CI (12 unit tests, universal build, installer):

- Menu-bar app, ⌃⌥Z (rebindable), Spotlight-style panel that takes the keys without stealing focus
- Zotero found through its handshake in `$TMPDIR`; Bearer-token calls to the bridge
- `lib/*.js` from the Omarchy launcher running in JavaScriptCore: search rows, sections, highlights
- Search as you type; ↑↓; Enter opens in Zotero; Shift+Enter shows it in the library; Esc closes
- CI: tests, universal ad-hoc-signed build, nightly release, `scripts/install.sh`

About 650 lines of Swift. The Omarchy launcher's UI is ~11k lines of QML over ~4.5k lines of
shared JS; this plan ports the QML's behavior, not its code.

## What "done" means

Feature parity with the Omarchy launcher v0.2.x, in a Mac-native shape:

| Area | Omarchy (reference) | Done on macOS when |
|---|---|---|
| Search | fuzzy search, filters (`a:` `t:` `y:` `#` `c:` `added:`…), `@` pickers, saved searches + pinned badges, grouping (`g`) | every filter and picker works; saved searches shared with Omarchy's `searches.json` |
| Places | collections, tags, a tag's / collection's papers, pins, open papers, recent | same, with the same `pins.json` |
| A paper | its menu: open PDF (Zotero / own window / external app), show in library, copy citation / bibliography, pin, status, files | every row of `Views.buildActions` acts |
| Notes | read (typeset), own window, copy as Markdown, save `.md`, open in Zotero, trash | note window tiles next to the PDF |
| Tags | add / remove / create, colors and counts, tag menu: rename, delete, statuses | same, undoable in Zotero |
| Statuses and tasks | paper statuses, tasks (to-dos) by status, due dates, priorities, quick add | same `todos.json` |
| AI | prompts (run, edit, new, new with AI, per-prompt model and effort), chat window with streaming, artifacts, quote check, extraction, taxonomies (tag, audit, review, edit, AI drafts) | everything the runner offers, through the same runner |
| Settings | General, Defaults, Models & providers (setup, keys to the Keychain), Rules, Taxonomies, Tasks, Paper statuses, Styles, Auto prompts, Setup checklist | every page; settings file shared with Omarchy |
| Processes | the task queue: running, pending, done, failed; open what a task made | same `tasks.json` |
| Keys | single-key mode with the 0.3 s typing window, Alt mode, 1–9, `?` / F1 keybindings panel, Esc ladder | the same table (`Views.KEYBINDINGS`), with macOS names |
| State | reopen where you left off (`view.json`), section order, menu pins | same files |
| Distribution | `omarchy plugin add` | `install.sh` now; a notarized, auto-updating app later (your call: 99 USD/year) |

Out of scope: the Omarchy-only bits (Hyprland binding and layer rule, `omarchy-shell`, Super+W
rebinding, the `W` overlay-as-window toggle becomes a native window toggle instead).

## Architecture

```
┌────────────────────── ZoteroLauncher.app (Swift) ──────────────────────┐
│  App/        menu bar, hotkey, login item, windows (panel, note, chat) │
│  Store/      AppStore: one ObservableObject per window; the files      │
│  Views/      SwiftUI: List + rows, forms, pickers, note, chat, panes   │
│  Keys/       KeyRouter: the key model (single-key, alt, 0.3 s window)  │
│  Core/       JSCore (lib/*.js), StyledText, NoteHTML, Row/Action types │
│  Bridge/     BridgeClient (+ queue: one search in flight, newest wins) │
│  Runner/     RunnerClient: Process, JSON out, chat stream (JSON lines) │
│  Files/      FileWatcher (DispatchSource) for the shared state files   │
└───────────────┬──────────────────────────┬──────────────────────────────┘
                │ HTTP 127.0.0.1           │ spawn + JSON lines
        Zotero + bridge (.xpi)     oma-zotero-prompt (Node runner)
```

### Decisions

1. **Rows come from `lib/*.js`, behavior lives in Swift.** Every view's rows are built by the
   same JS functions the QML calls (`Views.buildActions`, `buildNoteRows`, `buildTagRows`,
   `Settings.*`, `Todos.*`...). What happens on Enter, which view comes next, and the key model are
   ported to Swift, view by view.
2. **Shared decision logic moves into `lib/` when it's worth it.** Where `ZoteroSearch.qml` holds
   non-trivial pure logic (key resolution, the Esc ladder, which view a row opens, selection after a
   refresh), it's extracted into a new `lib/Nav.js` in oma-zotero-launcher, with node tests, used by
   both frontends. That's a PR there first, then the submodule pin moves. Rule of thumb: logic that
   would take more than ~50 lines of Swift and doesn't touch AppKit is extracted, not ported.
3. **One `JSCore` per process, called on the main thread.** Rows are built synchronously (they
   already are, in QML). If profiling ever shows a stall, move it to a serial queue.
4. **Rich text:** row titles keep using `StyledText` (the `<b>`/`<font>` subset). Notes
   (`Views.noteHtml`) render in a `WKWebView` with JavaScript off and a strict CSP (no network), the
   only place HTML is shown; chat answers render from Markdown with the same `safeMarkdown`
   sanitizer the runner uses, in the same kind of web view.
5. **The runner is the only AI path.** The app never calls a model itself. It spawns
   `oma-zotero-prompt` (installed from the pinned `shared/daemon` by `shared/scripts/install-runner.sh`,
   which the app ships as resources) and reads JSON. Keys go to the Keychain only through
   `oma-zotero-prompt secret set` on stdin, so the runner can read them without prompts.
6. **Shared files, same paths.** `~/.config/omarchy/oma-zotero-launcher.json` and
   `~/.config/omarchy/oma-zotero-launcher/{pins,searches,todos,view,extract}.json`,
   `~/.local/state/oma-zotero/tasks/tasks.json`: the runner already reads these, and Omarchy users
   keep one format. The "omarchy" folder name on a Mac is cosmetic; renaming it is a cross-repo
   change for later, behind a migration.
7. **Windows:** the launcher is the floating `NSPanel`; the note and chat windows are ordinary
   `NSWindow`s (tile, full screen, Stage Manager), one per note / chat, reopened on demand.
8. **No sandbox, no hardened runtime until notarization.** The app reads `$TMPDIR`, talks to
   localhost and spawns Node: a sandbox forbids all three. Hardened runtime comes with
   notarization (phase 8) and is compatible with all of it.

### Shared-code contract

`shared/` is pinned to a commit of oma-zotero-launcher. Moving the pin is its own PR here, with CI
running the Swift tests against the new `lib/*.js`. A JS change that breaks a Swift decoder fails
CI here, never at runtime: every builder the app calls gets a decoding test with a real fixture.

## Phases

Each phase is one or more PRs; each PR is green in CI and ships to the nightly on merge; each phase
ends with a short checklist you run on your Mac. Estimates are focused working days.

### Phase 3: the navigation core and a paper's menu (4–5 days)

The foundation every later view stands on.

- `AppStore` + a view stack (push / pop / replace), restoring `view.json` on open
- `KeyRouter`: single-key mode (the list has the keys) vs the search box; the 0.3 s window that
  turns two quick keys into a search; Alt mode (setting); 1–9; Esc ladder; `/`; Backspace / ←
- `Nav.js` (oma-zotero-launcher PR): key resolution and the Esc ladder, tested in node
- Row actions: a typed `Action` from each row's `kind` / `action`, dispatched by the store
- A paper's menu (`Views.buildActions`): open PDF in Zotero (`/attachment` target `reader`), in its own
  Zotero window (`window`), in the default PDF app (`path` → `NSWorkspace`), show in library, copy
  citation / bibliography (`/cite`, `NSPasteboard`), pin / unpin (`pins.json`), files (`buildFileRows`)
- Pins and before-you-type sections (pinned, open, recent), Shift+↑↓ to reorder pins
- Footer: key hints that fit (`Views.fitHints`) and the status line

Done when: every row of a paper's menu that doesn't need the runner works, with the same keys.

### Phase 4: notes, tags, collections, statuses (4–5 days)

- Notes list (`buildNoteRows`), reader (`noteHtml` in the web view), note window, copy as Markdown,
  save `.md` (`NSSavePanel`), open in Zotero, trash (`/notes/trash`), Space to fold notes under a paper
- Tags: the editor (`buildTagRows`, `/tags/update`), create, colors and counts; tag menu: rename,
  delete, its papers (`/tags/items`); status tags
- Collections: open one, its papers and subcollections, reveal in Zotero (`/collection/reveal`)
- Paper statuses: Alt+→/← (debounced save), Settings › Paper status
- Grouping (`g`/`G`, `Views.groupRows`), section reorder (Ctrl+Shift+↑↓)

### Phase 5: search power: filters, pickers, saved searches (3 days)

- `@` pickers (`/facets`, `buildPickerRows`, `buildPickerValueRows`, dates)
- Saved searches: save (Ctrl+S), the Searches view, pinned badges, Tab / Shift+Tab, edit, delete
- Scoped search inside a collection, a tag, a saved search (context bar, `Views.contextLabel`)
- Go to (`commandRows`) and settings found from the search (`settingRows`)

### Phase 6: the runner: setup, prompts, processes (4–5 days)

Needs oma-zotero-launcher#4 merged and the pin moved past it.

- `RunnerClient`: find the runner (`~/.local/bin/oma-zotero-prompt`, else the installed runner dir),
  run commands with a clean environment and a timeout, parse JSON, surface stderr
- Setup checklist (Settings › Setup): Node, the runner (install from the app: ship
  `shared/daemon` + `install-runner.sh`, progress in Processes), pdftotext (`brew install poppler`),
  the Zotero plugin (download + install steps), Zotero running
- Models & providers: `providers`, `models`, `provider-test`, API keys (`secret set` on stdin),
  defaults, effort
- Prompts: list, run (on a paper, on a scope), new, new with AI, edit (`$EDITOR` / TextEdit),
  per-prompt model, effort, output; auto prompts
- Processes (`tasks.json` watched): running, pending, done, failed; open the note a task wrote
- Extraction: extract a paper's text, extract every paper (catch-up), Settings › Defaults › text

### Phase 7: chat, artifacts, taxonomies (5–6 days)

- Chat window: `chat` streaming JSON lines (`session`, `delta`, `status`, `note`, `artifact`,
  `context`, `quotes`, `done`, `error`), history (`chats`, `chat-show`, rename, delete), save an
  answer / the chat to Zotero, the clipboard, a file; the quote check shown
- Artifacts: list, open in the browser, rename, undo, delete, change with AI (`artifact-edit`)
- Taxonomies: tag a paper / a scope (`classify`), status, review (accept / dismiss), audit, a
  paper's Taxonomies page, Settings › Taxonomies (edit forms, labels, AI drafts, on/off)
- Tasks (to-dos): the Tasks view, a task's page, new task (quick add with `#status !priority @due`),
  due-date calendar, task statuses as Zotero tags

### Phase 8: polish and distribution (3–4 days, part of it your decision)

- Keybindings panel (`?` / F1) from `Views.KEYBINDINGS`, macOS names
- Login item (`SMAppService`), the menu bar menu (recent papers, Processes, Settings, Quit)
- Accessibility: VoiceOver labels on rows and buttons, Dynamic Type sizes, Reduce Motion
- Performance: search under 50 ms per keystroke on a 5,000-paper library (the bridge does the work;
  the app must not add more than ~10 ms to build rows)
- **Your call:** Apple Developer Program (99 USD/year) for a signed, notarized build with
  auto-update (Sparkle). Without it, `install.sh` keeps working for you; others need the
  quarantine step.
- README and a CHANGELOG; version numbers aligned with oma-zotero-launcher (`0.3.0` = parity)

**Total: about 23–28 focused days.** At part-time pace that's 6–10 weeks.

## Testing

| Layer | How | Where |
|---|---|---|
| Shared JS (`lib/*.js`, `Nav.js`) | node tests | oma-zotero-launcher CI (Linux + macOS) |
| Decoding: every JS builder the app calls → Swift structs | XCTest with real fixtures | this repo's CI |
| Bridge client, runner client (fake runner script), file watcher, key router | XCTest | this repo's CI |
| Views | SwiftUI previews with fixtures; a few XCUITest smoke flows (open panel, search, menu, back) | CI, best effort (UI tests on a hosted runner can be flaky; never gate on a flaky one) |
| The real thing | per-phase checklist on your Mac, against your library | you, ~10 minutes per phase |

## Risks

| Risk | Likelihood | What we do |
|---|---|---|
| The QML controller (`ZoteroSearch.qml`, 6.8k lines) hides behavior that isn't obvious until ported | high | port view by view with the QML open; extract to `Nav.js` with tests; your per-phase checklist catches the rest |
| A `lib/*.js` change on the Omarchy side breaks the Mac app | medium | the pin: nothing changes until the pin moves, and moving it runs the decoding tests |
| `NSPanel` focus edge cases (full-screen apps, Stage Manager, multiple displays, secure input) | medium | test matrix in phase 3's checklist; fall back to a regular key window if a case can't be fixed |
| Runner environment from a GUI app (PATH, Node from Homebrew / nvm / Volta) | medium | the runner's `toolPath` (oma-zotero-launcher#4); the app also passes a PATH with Homebrew dirs and resolves `node` itself |
| Keychain prompts when the app and the runner both touch keys | low | only the runner touches keys (decision 5) |
| Gatekeeper changes make unsigned builds harder to run | medium | `install.sh` clears quarantine; notarization if it gets worse |
| Scope creep (it's not the PhD) | high | phases ship usable increments; stop after any phase that covers your daily use |

## Process

- Branch per PR, CI green before merge, nightly on merge, `install.sh` to update
- Changes to shared code go to oma-zotero-launcher first, then a pin bump PR here
- Each phase ends with: what changed, the checklist, what's next; nothing merges with red CI
