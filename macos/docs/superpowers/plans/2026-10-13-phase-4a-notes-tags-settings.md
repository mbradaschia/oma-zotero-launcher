# Phase 4a: notes, tags, collections, statuses, settings, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Each task is test first.

**Goal:** the 24 ids of phase 4a, with the views they need. **Spec:**
`macos/docs/superpowers/specs/2026-10-13-phase-4a-notes-tags-settings-design.md`.

Global constraints as in phase 3b's plan (macos/ only, files under 400 lines, the QML open, no em
dashes, Co-Authored-By). Swift tests from the internal disk (`-derivedDataPath /private/tmp/zl-dd`):
a failing test's symbolication from the external drive takes minutes.

## Tasks

1. **Glue and goldens:** `noteRows` (rank = `Fuzzy.filter`), `ownNotes`, `orderNotes`, `noteHtml`,
   `tagRows`, `tagMap`, `tagMenuRows`, `tagStatusRows`, `groupRows`/`nextGrouping`/`groupingName`,
   `withNoteRows`, the settings pages (`settingsPage(page, state)` with `row` = `Views.listRow`),
   `settingsSave`, `withValue`, `generalItem`, the todo helpers the default task needs.
2. **Files:** `TodosFile` (read, `Todos.setDefaultTask`, write atomically, refused read-only),
   settings save to the machine and shared files (`Paths.settingsSave`).
3. **Collections and tags as places:** `openCollection`, the scoped search, the context bar, the
   count; Shift+Enter reveal.
4. **Paper status and the default task:** the debounced saves with an injected clock; `paper-status`,
   `default-task`; the router's `statusTarget`/`taskTarget` filled in.
5. **Notes:** list, reader (`NoteView` with `WKWebView`), its keys, export, trash, Space folding,
   order, text size; `notes`, `read`, `note`.
6. **Note windows:** `NoteWindowController`, header, keys, `m`.
7. **Tags:** editor, create, tag menu, rename, delete, convert; 9 ids.
8. **Settings engine:** pages, rows, save; 9 `set-*` ids, `tags-status`.
9. **Grouping:** `g`/`G`.
10. **Verify and review:** every suite, snapshots, parity `--phase 3b --phase 4a`, a fresh reviewer,
    one fix pass, push, PR.
