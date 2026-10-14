# Phase 6b: prompts, processes, extraction, rules, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Each task is test first.

**Goal:** 6b's 27 ids. **Spec:** `macos/docs/superpowers/specs/2026-10-13-phase-6b-prompts-processes-rules-design.md`.
Constraints as 6a's (the fake runner only; `js/lib` vendored; files under 400 lines; the QML open;
the UX conventions; no em dashes; Co-Authored-By).

## Tasks

1. **`GlueRunner.js`** (prompts' rows and editor, `set`'s flags, tasks' rows and summary, the
   extract menu, the rules page) and `settingsChange`'s `rule` op; goldens.
2. **Paths:** `runnerTasks`, `extract`, `instructions`, `prompts` on `AppPaths`.
3. **Prompts:** `refreshPrompts`, the job queue, the draft; the views and their ids; `e`.
4. **Processes:** `TasksFile` (read, watched), `refreshTasks`, the view, `task`, `tasks-clear`,
   `.`; the menu refreshed when its paper's task ends; the extracting badge.
5. **Extraction:** `extract`, `x`, Shift+Enter, the extract menu and its four ids.
6. **Defaults:** `ExtractFile` (`extract.json`), the count, the catch-up loop, retry.
7. **Rules:** `rules.json` and the instructions (watched), the four ids.
8. **Chrome, keys** for the new views; the consistency tests over them.
9. **Verify and review:** every suite, goldens, parity `--phase 6`, snapshots, a code review, a
   UX consistency review over the whole app, one fix pass, push, PR stacked on 6a.
