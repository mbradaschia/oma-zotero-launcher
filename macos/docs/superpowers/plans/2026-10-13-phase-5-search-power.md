# Phase 5: search power, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Each task is test first.

**Goal:** the 13 ids of phase 5, the badges, the styled search box, Go to and Zotero's sync.
**Spec:** `macos/docs/superpowers/specs/2026-10-13-phase-5-search-power-design.md`.

Global constraints as in phase 3b's plan (macos/ only, files under 400 lines, the QML open, no em
dashes, Co-Authored-By). `js/lib` is vendored and stays byte for byte the root's: Mac-only logic
goes in the Glue files. Swift tests from the internal disk (`-derivedDataPath /private/tmp/zl-dd`).

## Tasks

1. **Glue and goldens:** `GlueSearch.js` (saved searches, pickers, segments, `editQuery`,
   `commandRows` with `have`, sync words), loaded by `JSCore` and merged into `core`;
   `Glue.results` filtering Go to to `extras.have`; a golden per wrapper.
2. **`SearchesFile`:** load, `update` stamped and atomic, refused read-only or damaged; the
   `saved` messages; reloaded after a merge.
3. **Scope:** `Scope.query` for a saved search, `scopeJSON` with it, `searchScopeJSON` (the
   opened scope, else the badge) in the body and in `answerFitsHere`.
4. **Saved searches:** the Searches view, its menu, `search-edit` and its saves, `p`, Shift+↑↓,
   `s`/Ctrl+S; the 10 `search*` ids in `activateAction`.
5. **Badges:** `SearchState.active`, Tab/Shift+Tab (`KeyState.pinnedSearches`), the badge bar in
   `LauncherView`, a click selects or saves.
6. **Pickers:** `picker`, `picker-values`, facets with the serial and cache, `setFilter` asking
   again in `picker-values`, `pick-field`, `pick-op`, `pick-value`; `addToSearch` in UTF-16.
7. **`StyledTextField`** in `LauncherView` for the search box: segments for the results and
   `search-edit` (query mode), task segments for `todo-new`; the caret reported back.
8. **Go to and sync:** `noCommands` off at the top level with `have`; Enter on `todos`,
   `todo-new`, `searches`, `sync`, `settings`, `settings-general`; `S`; `/sync/status` on open,
   follow-up timer, footer word.
9. **Chrome:** placeholders, counts, hints, empty states, the saved search's context bar.
10. **Verify and review:** every suite, goldens `--check`, parity through phase 5, a snapshot, a
    fresh reviewer, one fix pass, push, PR stacked on 4b.
