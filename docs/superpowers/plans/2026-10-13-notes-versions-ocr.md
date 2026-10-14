# Deleting notes, prompt version numbers, scans read by OCR: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Each task is test first.

**Spec:** `docs/superpowers/specs/2026-10-13-notes-versions-ocr-design.md`. Constraints:
- No library content in fixtures or output.
- Tests never run the installed runner, reach Zotero or the network, or use real keys.
- `daemon/` and `macos/runner/` stay equal (but `lib/paths.mjs`), and so do `lib/` and `macos/js/lib/`.

## Tasks

1. **Versions:**
   - `catchup.mjs`: `versionOf(reg, p, now, { seen, use })`, `versionsFor(…, { save, use, seen })`,
     `promptNotes`.
   - `prompts.mjs`: `noteTitle`'s `run`.
   - The runner's `run` reads `/notes/by-prompt` (`promptVersion`); `list` and `catchup-plan` only read.
   - Tests in both trees.
2. **The bridge:** `OmaNotes.trashAny` and `/notes/delete`; tests.
3. **Note delete, Omarchy:**
   - `Views.buildActions`' *Delete this note*, and the key help.
   - `Service.deleteNote`; `askDeleteNote`, Delete on note rows and in the reader.
   - The note window's Delete opens the menu; the hints.
4. **Note delete, Mac:**
   - `KeyCommand.deleteNote` and `KeyRouter`; `askDeleteNote`; `ActionMap["note-delete"]`.
   - The reader's and the note window's Delete; `NoteWindows.close`; the hints.
   - `NotesAndScansTests`.
5. **OCR, runner:**
   - `extract.mjs`: `rawPages`, `pagesToOcr`, `pickLanguages`, `ocrLine`, `scanReason`, `tesseractHint`,
     `ocrLanguages`, `ocrPage`, and `buildNote`'s `ocr`.
   - `extractPages` reads the empty pages; `extract-batch` records `scanReason`; `providers` reports
     `tesseract`.
   - Tests in both trees.
6. **OCR, launchers:**
   - `Settings.js`: the Setup row, the Defaults wording, *Read the N skipped scans by OCR*.
   - `setup-check.sh` and `reqProc`; the Mac's `Requirements` and `BREW`.
   - `retryScans` / `set-extract-scans`; extract on open as a batch of one; the Mac's timeout.
   - Goldens; tests.
7. **Verify:**
   - Every suite, goldens `--check`, parity (166 ids; the QML reference refreshed).
   - README, CHANGELOG.
   - A code review and a UX consistency review, then a fix pass.
   - Push, and a PR stacked on phase 7.
