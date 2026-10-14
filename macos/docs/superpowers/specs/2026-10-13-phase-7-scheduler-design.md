# Phase 7: background automation (design)

Phase 7 of [`macos/PLAN.md`](../../../PLAN.md): the `Service.qml` scheduler (lines 1078-1663) as
one scheduler in the Mac app, and the plan's decision 13 (`automationHost`) in both launchers. 4 row
ids: `set-catchup set-catchup-stop set-auto-prompt pe-auto`; and the Defaults rows 6b showed
unavailable (`defaults.extractOnOpen`, `autoExtractNew`, `autoTagNew`, Prompts to run on new
papers, Bring papers up to date) made real. Conventions: `macos/docs/ux-conventions.md`.

## 1. The scheduler

- **One timer, two minutes**, while something is on (new papers' text, tags or prompts, a
  catch-up of the text, a catch-up job list): the ticks of the QML's `extractTimer`
  (`extractTick`, `tagTick`, `promptTick`), and every tick when Zotero answers again (`status`
  becomes ready; a tick pings `/sync/status` first when it isn't, since a menu-bar app may not
  have searched yet). It runs while the app runs; nothing is scheduled when it's quit (the plan).
- **New papers' text** (`autoExtractNew`, extract.json's `since`): three a tick, `extract-batch`.
- **New papers' taxonomies** (`autoTagNew`, `tagSince`, `tagged`): three a tick from
  `/papers/select` (after their text when that's extracted too: `textFirst`, `textless`), through
  the classify queue (`classify --items … [--taxonomies …]`, one run at a time, the papers
  marked "Tagging…" meanwhile).
- **Prompts on new papers** (`defaults.autoPrompts`, extract.json's `autoPrompts`): per prompt
  its `since` and what it ran on; one run at a time, a paper at least three minutes old,
  `run <id> --key … --library … --extract-first`. Settings › Defaults › Prompts to run on new
  papers (`set-auto-prompt`) and the editor's `pe-auto` turn them on and off.
- **Bring papers up to date** (`catchup-plan`, extract.json's `update`): the plan counted when
  Defaults opens; `set-catchup` (taxonomies, prompts, recent) starts its jobs, one at a time
  (extract, classify, run); `set-catchup-stop`; the waiting ones shown in Processes ("pending").
- **A paper opened** (`defaults.extractOnOpen`): its text extracted in the background when it has
  a PDF and no text (tagging on open is phase 9's, with the taxonomies).
- **Background runs don't pass `--quiet`**: the runner's notifications tell how they went, as on
  Omarchy; the launcher's own flashes are for what you started.
- **extract.json** written as one object (several keys at once), its other keys kept.

## 2. automationHost (decision 13), both launchers

`general.automationHost` (shared through the sync folder): empty, every machine runs the
automation (as today); a name, only the machine whose name (`Paths.resolve`'s `machine`:
`machineName`, else the hostname) is that one, case-insensitively. Elsewhere the automatic ticks
(new papers' text, tags, prompts) don't run; what you start yourself (a catch-up, extract every
paper's text, a prompt) still runs where you start it. Settings › Defaults › New papers says so:
`New papers are handled on “X”, not here` (naming this machine), `… handled here (“X”)` on that
machine, and with a sync folder and no name, `Every machine handles new papers`. While another
machine handles them, this one's `since` dates move on with the clock (named later, it starts
from then). The same in
`Service.qml` (its ticks) and `lib/Settings.js` (the row, in both copies).

## Testing

Goldens for the new wrappers and the Defaults rows (automation here or elsewhere); XCTest with the
fake runner and bridge: each tick's bodies and argv, the once-each bookkeeping in extract.json,
the classify queue, the catch-up jobs to their end, a tick waiting for Zotero, the host rule;
node tests for `Settings.buildDefaults`' host row in both trees; the consistency tests over the
new pages; parity `--phase 7` complete.
