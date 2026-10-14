# Phase 8: chat and artifacts, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Each task is test first.

**Goal:** the chat window, the launcher's chats and artifacts, and their 19 ids.

**Spec:** `macos/docs/superpowers/specs/2026-10-14-phase-8-chat-artifacts-design.md`.

**Constraints:** the same as phase 7's, and:
- `marked` is vendored, MIT, recorded in `VENDORED.md`.
- No library content in fixtures.

## Tasks

1. **Streaming:** `Runner.stream` and `RunnerStream`. `ProcessRunner`'s, read line by line, then stop.
   `FakeRunner`'s, with lines and hold. RunnerClient tests.
2. **The vendored `marked`:**
   - `js/vendor/marked.umd.js`, bundled, loaded by JSCore as `Marked`.
   - New Glue wrappers:
     - The chat window: `chatHtml` (messages → the page's body), `streamView`, `chatTitle`,
       `modelLabel`, `transcript`.
     - The launcher's rows: `chatRows`, `chatMenuRows`, `artifactMenu`, `artifactChangeRows`.
   - Goldens.
3. **The lists:** `refreshChats` and `refreshArtifacts` (`chats --all`, `artifacts --all`). Menu extras
   (chats, artifacts), `searchBody`'s chats, the root's Chats row, and Go to's Chats and New chat.
4. **The launcher's ids:**
   - Chats and the chat menu; rename; delete asked first.
   - The artifact menu, its change and rename pages, delete asked first.
   - `c` routing; the task row's and the task context's chat; hints, placeholders and counts.
5. **The chat window:**
   - `ChatWindowModel`: the session, messages, events, send and stop, the source, model and effort,
     prompts, the outputs, rename, and the extract.
   - `ChatWindowView`: the top bar, the banner, the sidebar, the conversation web view, the composer,
     and the pickers.
   - `ChatWindows`: one per paper, ⌘W.
6. **Omarchy:** the chat and artifact deletes ask first (the conventions); the QML reference copied
   again; the views tests.
7. **Verify and review:**
   - Every suite, goldens `--check`, parity `--phase 8`.
   - A code review and a UX consistency review, then a fix pass.
   - Push, and a PR stacked on #14.
