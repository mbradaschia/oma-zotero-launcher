# Phase 4b: tasks, statuses and merging, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Each task is test first.

**Goal:** the 31 ids of phase 4b and the conflict merging both launchers share. **Spec:**
`macos/docs/superpowers/specs/2026-10-13-phase-4b-tasks-merging-design.md`.

Global constraints as in phase 3b's plan (the QML open, files under 400 lines, no em dashes,
Co-Authored-By). This phase also touches the root (`contracts/Merge.js`, `Service.qml`,
`scripts/sync-conflicts.sh`): root code never names `macos/` (`check-boundaries.sh`). Swift tests
from the internal disk (`-derivedDataPath /private/tmp/zl-dd`).

## Tasks

1. **`contracts/Merge.js` and its node tests:** `conflictOf` (Syncthing and Dropbox names),
   `kindOf`, `keptName`, `stamp` (the `updated` and tombstone bookkeeping on every write),
   `merge` (lists by record, keyed files per key, the rest newer wins with the other kept);
   tombstones pruned after 30 days; the same bytes from either side. `SYNC-FORMAT.md` "Conflicts".
2. **The Omarchy launcher:** every write of `searches.json`, `todos.json`, `pins.json` through
   `Merge.stamp`; `scripts/sync-conflicts.sh` lists the copies (never a link, nothing over 20 MB);
   `mergeConflicts` on open and resume; `dev-sync.sh` ships the new files; node tests.
3. **Glue and goldens:** `GlueTodos.js` (todo rows, the editor, quick add, due, the calendar month,
   entry rows, status menus, `tasksWith`, `moveTasks`, `merge`, `stamp`, `conflictOf`, `keptName`),
   `Glue.menu` with the paper's Tasks; a golden per wrapper except `addTodo` (a random id).
4. **Files:** `TodosFile.update` (stamped, atomic, refused read-only or damaged), `PinsFile.save`
   stamped, `ConflictMerger` (plain files only, inside the folder), `FolderWatcher` (FSEvents).
5. **Tasks:** the Tasks view, quick add, a task's page and its rows, keys (`tabTodoId`), the
   calendar, pick and unlink, delete and undo, a paper's Tasks, new task with `@` blocks.
6. **Tag sync:** `applyTaskTags`, `syncTaskTags` on the first answer, `syncStatusLists` on open.
7. **Settings › Tasks and Paper status:** statuses by group, add, rename, remove moving tasks,
   actions, the default task's text, reorder; paper statuses with rename, remove (asked first),
   migrate.
8. **Verify and review:** every suite, goldens `--check`, parity `--phase 3b --phase 4a --phase 4b`,
   a fresh reviewer and a security review, one fix pass, push, PR stacked on 4a.

## Review fixes (done in the fix pass)

- Merge.js: malformed and prototype-named ids ignored, dateless tombstones dropped, whole
  seconds, `null` when there is nothing to merge.
- Links never followed (copies, base files, folders), reported; copies over 20 MB skipped.
- The kept copy written first, named for whose file it was; the copy removed after both writes.
- A copy beside a missing file waits 30 s; the watcher waits 2 s for a burst to settle.
- The Omarchy loop: blocking reads and writes, failures honoured, files reloaded before removal.
- Status sync one at a time; a status removed this session not brought back by its tag.

## Left for the two-machine checklist

The Omarchy merge loop is lint-checked and its pieces node-tested, but Quickshell does not run on
the Mac: the two-machine Syncthing checklist in the spec is where it is exercised end to end.
