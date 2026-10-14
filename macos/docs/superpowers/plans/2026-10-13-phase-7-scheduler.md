# Phase 7: background automation, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Each task is test first.

**Goal:** the scheduler, the 4 ids, automationHost in both launchers. **Spec:**
`macos/docs/superpowers/specs/2026-10-13-phase-7-scheduler-design.md`. Constraints as 6b's.

## Tasks

1. **`lib/Settings.js` (both trees):** the New papers row saying where automation runs; node tests.
2. **`Service.qml`:** `automationHere()`, the three ticks gated; `ZoteroSearch.qml`'s
   settingsState passes it. `make test`, `make lint`.
3. **`ExtractFile.update([key: value])`** (several keys, one write).
4. **`LauncherModel+Scheduler.swift`:** the timer, the ping, `extractTick`'s new-papers path,
   `tagTick` and the classify queue, `promptTick`, `paperOpened`, the turned-on hooks, the host rule.
5. **`LauncherModel+CatchUp.swift`:** the plan, start/stop/tick, the pending rows in Processes,
   `catchUp` in Settings' context.
6. **Settings:** the `auto-prompts` page, `set-auto-prompt`, `pe-auto`, `set-catchup(-stop)`; the
   LATER list emptied; set-nav and openSettings ask for the plan.
7. **Verify and review:** every suite, goldens, parity `--phase 7`, a code review, a UX
   consistency review over the whole app, one fix pass, push, PR stacked on 6b.
