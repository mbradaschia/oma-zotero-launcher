# Phase 3b: a paper's menu, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Each task is test first.

**Goal:** the launcher in the Omarchy launcher's shape, driven by the store and the key router, with
a paper's menu and its 9 row ids. **Spec:** `macos/docs/superpowers/specs/2026-10-13-phase-3b-paper-menu-design.md`.

## Global constraints

- Work under `macos/`; `js/lib` and `contracts/` unchanged.
- One type per file where it fits, files under 400 lines, `// ` comments in the codebase's voice,
  no force unwraps outside tests. No em dashes. Commits end with the Co-Authored-By line.
- Port with the QML open; each ported function names its QML lines.
- Commands: `xcodegen generate && xcodebuild test …`; `node --test js/tests/*.test.js`;
  `node scripts/goldens.mjs --check`; `scripts/parity.sh --phase 3b`.

## Tasks

1. **Glue wrappers and goldens:** `settings`, `searchBody`, `menu`, `fileRows` (with the filter),
   `confirmRows`, the pins and identity wrappers, the text helpers; goldens for each.
2. **Files:** `Files/AppPaths.swift`, `Files/AppSettings.swift`, `Files/PinsFile.swift`, tests on a
   temp HOME.
3. **A bridge seam:** `Bridge` protocol (`post`), `BridgeClient` conforming, `FakeBridge` in tests.
4. **The model:** `LauncherModel` on the store: search (queue, body, rows, selection), the menu
   (`enterActionsFor`, `/item`, `rebuildList`, `runQuick`, `selectRow`, `finish`), `askConfirm`,
   the cite preview; tests with `FakeBridge`.
5. **Actions:** `ActionTarget`, `ActionMap.handlers` for the 9 ids, `activateAction`'s unavailable
   rule; a test per id with a fake target; `parity.sh --phase 3b` passes.
6. **Arrangement:** `p`, `P`, Shift+↑↓ in the menu and on pinned results, Ctrl+Shift+↑↓; tests.
7. **Keys:** `KeyState` from the model, `execute(KeyCommand)`, the local monitor, the buffer tick;
   tests for each command 3b handles.
8. **Chrome:** `Hints` (hints/hintsFor for these views), `Placeholder`, `ContextInfo`, `FitHints`
   (NSFont), `Icons` (Nerd Font when bundled, SF Symbols otherwise); tests.
9. **Views and `W`:** `LauncherView` split into header, list rows (search and list), footer;
   `LauncherController` moves the view between the panel and a window.
10. **Verify and review:** every suite, the app run, a fresh reviewer, one fix pass, the CI step
    `parity.sh --phase 3b`, push, PR.
