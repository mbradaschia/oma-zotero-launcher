# Phase 6b: prompts, processes, extraction, rules (design)

The second half of phase 6 of [`macos/PLAN.md`](../../../PLAN.md) (6a: the runner, setup,
providers). 27 row ids: `extract ext-read ext-again ext-zotero ext-delete task tasks-clear
set-extract-all set-extract-retry set-rule set-rules-reset set-system-edit set-system-reset prompts
prompt prompt-new pe-title pe-title-save pe-title-ai pe-model pe-effort pe-output pe-brief
pe-output-opt pe-model-opt pe-effort-opt pe-text`. Ported with the QML open (`ZoteroSearch.qml`
1218-1316, 1612-1672, 1874-1925, 3383-3400, 3856-3930, 4201; `Service.qml` 930-1130, 1700-1840).
Conventions: `macos/docs/ux-conventions.md`.

## 1. Prompts

- **The list** (`list --json`, `Client.parsePromptList`): asked when a paper's menu opens (with the
  models), after every change; `null` until listed, and the runner missing gives
  `promptsProblem`. The menu gets the real prompts (its Prompts and Chat rows replace Set up once
  a model is on).
- **`prompts`** (`Views.buildPromptRows`), **`prompt`** (`run <id> --key K --library L`,
  launched: the runner's task says how it goes; "Running “T”: it's in Processes (.)"),
  **`prompt-new`** and **`pe-title`** (the `prompt-title` view, `Views.buildTitleRows`),
  **`pe-title-save`** (create: `new <title> --json --no-edit`, then the editor; rename: `set`),
  **`pe-title-ai`** (`new-ai --describe <D> --json`, one at a time), the editor
  (`Views.buildPromptEditor`: `pe-model`, `pe-effort`, `pe-output` and their `*-opt` rows,
  `pe-brief`, `pe-text`: `edit <id>`, which opens it in the Mac's text editor). `e` on a prompt
  opens its editor. Changes are shown at once and saved by `set <id> …` (a queue, one at a time);
  the list read again confirms them.

## 2. Processes

- **The runner's tasks:** `tasks.json` in its tasks folder (Paths' `runnerTasks`), watched
  (`FolderWatcher`), read again 1.5 s after a launch (a first write missed); `tasks` / `tasks
  --clear` asked on opening and on `.`.
- **`tasks`** (`.`, Go to › Processes; `Views.buildTaskRows`, `tasks-clear` on top when any
  finished), **`task`** (its note, its file, its prompt; a chat's comes with phase 8),
  **`tasks-clear`**. A task about the paper whose menu is open, finished since it was read: the
  menu asks Zotero again. Zotero's sync shows here as a process too (phase 5's flash stays).

## 3. A paper's extracted text

`extract` (read it, or `extract --key K --library L`, launched), the menu's extract row (busy
while a task extracts it), `x` (extract, or its menu once extracted), Shift+Enter on it, the
`extract-menu` (`Views.buildExtractMenu`): `ext-read`, `ext-again` (`--force`), `ext-zotero`,
`ext-delete` (asked first; `/notes/trash`).

## 4. Settings › Defaults › the paper's text

`extract.json` (machine-only; its other keys kept as they are): `skipped`, `catchup`. The count
left (`/extract/pending`, `limit: 0`). **`set-extract-all`** starts or stops the catch-up: three at
a time (`/extract/pending` then `extract-batch --items … --max-mb N`, waited), the counts kept in
`catchup`, a flash when every paper is done; it goes on while the app runs (phase 7's scheduler
takes the new papers). **`set-extract-retry`** forgets the skipped ones.

## 5. Settings › Rules

The rules from the installed runner's `lib/rules.json` (else the app's bundled one), your
instructions from Paths' `instructions` (its comments left out, the file watched).
**`set-rule`** (`Settings.withRuleToggled`, through `settingsChange`), **`set-rules-reset`**,
**`set-system-edit`** (`system edit`, launched: the file opens in the text editor),
**`set-system-reset`** (`system clear`).

## 6. Chrome

Placeholders, counts ("N prompts", the processes' summary, "loading models…"), hints and empty
states as the QML has them, in the Mac's notation; `.` opens Processes and joins the places in the
hints.

## Testing

Goldens for `GlueRunner.js`; XCTest with the fake runner for each id (the argv of every run and
launch, the queue's order, the optimistic editor and its failure flash, the draft's two ends, the
tasks file read and watched, the catch-up's three steps and its end, the rules' saves); snapshots
of Prompts, the editor and Processes; the consistency tests extended to the new views; parity
`--phase 6` complete.
