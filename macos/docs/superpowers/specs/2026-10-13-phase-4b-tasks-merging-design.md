# Phase 4b: tasks and merging (design)

Phase 4b of [`macos/PLAN.md`](../../../PLAN.md). 31 row ids: `task-default todo todo-new
todo-new-save todo-quick todo-save todo-edit todo-text-save todo-status todo-priority todo-desc
todo-notes todo-due todo-status-opt todo-priority-opt todo-item todo-context todo-pick todo-unlink
todo-delete pstatus pstatus-add status task-action task-action-add status-add status-rename
status-name-save status-remove pstatus-migrate task-tag`. Ported with the QML open.

## 1. Tasks (to-dos)

- **The Tasks view** (`t`, `openTodos`): `Todos.buildTodoRows` (rank, row, a real `Date`,
  `highlight`, `rangesFrom`: one Glue wrapper supplies them); typing finds a task or offers the
  quick add (`todo-quick`, `#status !priority @due`, `Todos.parseQuick`); Enter opens a task,
  Shift+Enter just adds.
- **A task's page** (`todo-edit`, `Todos.buildTodoEditor`): its rows, each with its action:
  status and priority choices (`todo-status-opt`, `todo-priority-opt`), Tab/Shift+Tab on them,
  the description and notes edited in place (a form: what is typed is kept when you leave the
  row, the page or the launcher, `commitField`), the due date (`todo-due`: the calendar view,
  arrows/PgUp/PgDn/Home/Delete/Enter, or a typed date, `Todos.parseDue`), its paper
  (`todo-item` opens its menu, `todo-pick` picks one from the results, `todo-unlink`), its
  context (`todo-context`: the note or chat it came from), delete (`todo-delete`, `u` brings it
  back).
- **Keys on tasks** anywhere they show (`tabTodoId`): Tab/Shift+Tab status, `d` done, `!`
  priority, Delete, `u` undo, Shift+↑↓ moves within its status (`Todos.moveTodo`); `a` a new task
  about what is highlighted (`addTodoKey`: a paper, a note, a chat).
- **New task** (`todo-new`, `entryRows`, `@` for blocks: `Todos.buildTaskTagRows`, `task-tag`).
- **A paper's Tasks** in its menu (`Todos.itemTodoRows`, spliced before "Prompts and chat").
- **Settings › Tasks** (`settings-tasks`): statuses by group (`status`, `status-add`,
  `status-rename`, `status-name-save`, `status-remove` moving its tasks), the actions `@` offers
  (`task-action`, `task-action-add`), the default task's description (`task-default`), Shift+↑↓
  reorders. **Settings › Paper status**: `pstatus`, `pstatus-add`, rename and remove (its tag
  deleted everywhere, asked first), `pstatus-migrate`.

## 2. Tag sync

- `saveTodos` applies `Todos.taskTagChanges` (each paper's `t/` tags follow its tasks) once Zotero
  answers; at the first answer of a session, `Todos.taskTagSync` sets them from scratch.
- Each opening, `syncStatusLists`: `/tags/prefixed` and `/tags/changes` → `statusListsFromZotero`
  (a status tag renamed or made in Zotero becomes a status here), saved to the settings.

## 3. Merging (decision 12), a sync format change for both launchers

- **`contracts/Merge.js`** (ES5, pure, deterministic), with node tests in `contracts/tests/`:
  - conflict copies recognised by name: Syncthing (`<name>.sync-conflict-<date>-<time>-<device>.<ext>`)
    and Dropbox (`<name> (<host>'s conflicted copy <date>).<ext>`);
  - `todos.json` by `id`, the newer `updated` wins; `pins.json` by `type:libraryID:key`;
    `searches.json` by `id` (pins and searches gain `updated`); `view.json` and the shared
    `settings.json` per top-level key (and per view inside `view.json`), the newer file wins a
    key both changed; Markdown, a chat, an artifact's `meta.json`: the newer file wins, the
    other kept as `<name>.conflict-<machine>.<ext>`;
  - deletions are tombstones (`{ …, deleted: <ISO date> }`), pruned after 30 days, never shown;
  - two machines merging the same pair write the same bytes.
- **The Mac app** watches the sync folder (a directory watcher: writers replace by rename, so a
  descriptor watch would lose them), merges each conflict copy it sees, writes the merge
  atomically, then deletes the copy. Every reader leaves tombstones out.
- **The Omarchy launcher** runs the same merge (its `Service.qml` and runner), in the same PR,
  with its tests. Nothing else crosses between the two (`check-boundaries.sh`).
- `SYNC-FORMAT.md` gains the tombstone and `updated` fields and the merge rules.

## Testing

- Goldens for the task builders (with a fixed `now`), quick add, due parsing, the editor, the
  status settings.
- XCTest: each id on the model with the fake bridge; the form's commit on leaving; the calendar;
  undo; tag sync calls; the directory watcher (a temp folder, a conflict copy appearing).
- Node: `contracts/tests/merge.test.js` (each file's rule, tombstones, pruning, same bytes on
  both sides, the conflict names), run by both workflows.
- The two-machine checklist (on your machines): Syncthing between the Mac and the Omarchy
  machine, edits on both while apart, reconnected, the same result on both.
