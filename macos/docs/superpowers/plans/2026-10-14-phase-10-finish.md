# Phase 10: finish, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Each task is test first.

**Goal:** the app complete as a Mac app (the keys view, Open at login, the menu bar, accessibility, the keystroke
budget) and the release `macos-v0.3.0` prepared.

**Spec:** `macos/docs/superpowers/specs/2026-10-14-phase-10-finish-design.md`.

**Constraints:** the same as phase 9's. The login item is tested with a fake service, never the real one. Publishing
the release is outward: prepared here, published only with the user's OK.

## Tasks

1. **The keys view:**
   - Glue's `keysContext`, `keyRows` and `windowKeys`, in the Mac's notation (`MAC_KEY_COLUMN`, `MAC_KEY_LINES`).
   - `openKeys()` on ? and F1 (and the reader's ?); the `keys` view's rows, placeholder and hints; `key-info` inert.
   - The note window's ? / F1 overlay (`WindowKeys`).
   - Goldens (`keyRows` here, typed, ⌥ mode; `keysContext`; `windowKeys`); XCTest (F1 from the results, while
     typing, in a menu; typing finds a key; Esc clears, then goes back; the notation).
2. **Open at login, the menu bar:**
   - `LoginItem` over a `LoginService` protocol (`SMAppService.mainApp` in the app, a fake in the tests).
   - Its toggle in the app's Settings window (This Mac) and in the menu bar menu; `requiresApproval` opens Login Items.
   - `MenuBarMenu`: Open the Launcher (its hotkey), Chats…, Processes…, Settings…, Sync Zotero
     (`LauncherController.show(place:)`), Open at Login, Hotkey and Login…, Quit.
3. **Accessibility:**
   - `Access`: a row's label, value and hint; a pill's label; `rowAccess` on both row views.
   - The search box's label (its placeholder); the badges' labels and selected trait.
   - `Motion.animation(reduce:)`: the badges' scroll honours Reduce Motion.
4. **Performance:** `PerformanceTests` (200 made-up results, under 10 ms); JSCore's fast path for values that hold
   no RawJSON.
5. **The release:**
   - `MARKETING_VERSION` 0.3.0; `install.sh`'s `TAG` overridable; CI's release step on a `macos-v*` tag (notes from
     `docs/releases/<tag>.md`, the app's version checked against the tag, an `install.sh` that installs that tag).
   - README, a Mac section in CHANGELOG, the release notes, the conventions.
6. **Verify and review:**
   - Every suite, goldens `--check`, parity (166 of 166, inert 8).
   - A code review and a UX consistency review, then a fix pass.
   - Push, and a PR stacked on #16.
