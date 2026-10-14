# Deleting notes, prompt version numbers, scans read by OCR (design)

Three things reported from daily use, fixed in both launchers, the bridge and the runner (its copy
in `macos/runner/` kept equal). Conventions: `macos/docs/ux-conventions.md`.

## 1. Deleting a note

**Before:** only the extracted-text note could be deleted (`ext-delete`); the bridge's `/notes/trash`
refuses any note the launcher didn't write (403 `not-ours`), on purpose: the runner replaces its own
notes with it.

**Now:**
- The bridge gains `POST /notes/delete` `{ key, libraryID? }` → `{ trashed, key, libraryID, parentKey }`.
  Any note, yours too, goes to Zotero's trash (restorable there, emptied after 30 days); 400
  `not-a-note`, 409 `read-only`. `/notes/trash` stays companion-only for the runner.
- **Where:**
  - `Delete` on a note row (a paper's menu, Notes) with nothing typed (typing, `Delete` edits the box).
  - `Delete` while reading it.
  - A note's own menu: *Delete this note* (`note-delete`, a new row id, phase 4a).
  - In the note window, `Delete` opens the launcher on that menu, on that row: the question is asked
    in one place.
- **Always asked first**, the confirm page:
  - The question: `Delete the note “T”?`, with the answers `Delete it (to Zotero's trash)` and `Keep it`.
  - The detail: `You can restore it from Zotero's trash`.
  - After it: `The note is in Zotero's trash`. Its window closes, the reader leaves it, the menu is read
    again.
  - An older plugin, without the route, answers as missing: `Couldn't delete the note: the Zotero
    plugin is older than the launcher (update it: Settings › Setup)`.
- Hints and key help: `del delete` on note rows, in the reader and in the note window.

## 2. Prompt version numbers

**Before:**
- A text got its number the first time the runner *saw* it, and `list` (which both launchers run after
  every prompt edit) saved it. A new prompt's placeholder took v1, each saved edit the next number, so
  a first note said v2 or v3.
- The numbers were this machine's (an unsynced file), while the notes sync. Two machines gave one text
  two numbers, or two texts one number.
- The same version run again gave the same title.

**Now:**
- `versionsFor` only reads, unless a run asks it to save (`{ save, use, seen }`).
- **The notes decide.** A run reads `/notes/by-prompt`; `promptNotes` gives the versions they name and
  the notes per paper and version. A text its notes name keeps their number. Else a text this machine
  wrote notes with keeps its own, unless a note from elsewhere took that number for another text. Else
  it gets the next after every number taken (texts only listed don't count).
- **A second note of the same version on a paper** says so: `Findings v2 (2): …` (`noteTitle`'s `run`).
- Bringing papers up to date still compares hashes, not numbers: unchanged.

## 3. Scans read by OCR

**Before:**
- pdftotext only. A PDF with no page over 40 characters was "a scan", skipped once with *OCR it first*
  (and Zotero has no OCR).
- A scan behind one page of text (a cover sheet) was extracted almost empty, without a word.
- With *Extract a paper's text when you open it*, a scan was tried, with a critical notification, at
  every opening.

**Now:**
- **Per page:**
  - `rawPages` keeps the empty pages; `pagesToOcr` lists those under 40 characters.
  - When Tesseract is installed, each is read: `pdftoppm -r 300 -gray` draws it into `tesseract stdin
    stdout`, with one thread and 120 s a page.
  - The languages: English and up to two more installed (`pickLanguages` over `tesseract --list-langs`).
- **Limits:** 80 pages at most; a longer scan is left alone (`a scan of N pages, over the 80 read by
  OCR`). A blank or unreadable scan: `OCR found no text in it`. Without Tesseract: `reading it needs
  Tesseract (Settings › Setup)`. All of these still match `isScan`; `scanReason` words what's recorded.
- **The note:**
  - The pages keep their `p. N` headings, so quotes cite them as any other.
  - The provenance line says `p. 3–12 read by OCR (Tesseract)`, and the extractor is `pdftotext and
    Tesseract OCR`.
  - The task's detail adds `, 10 read by OCR`.
- **Setup:** an optional row, *Read scans by OCR (optional)*.
  - Installed: `Tesseract is installed: it reads scanned PDFs…`.
  - Missing: Enter runs `omarchy pkg add tesseract tesseract-data-eng` in a terminal; on the Mac it
    copies `brew install tesseract`.
  - Never a "missing" badge.
  - The runner's `providers`, `setup-check.sh`, `reqProc` and the Mac's `Requirements` probe for
    `tesseract`.
- **Settings › Defaults › The paper's text:**
  - *Skip PDFs larger than* says `scans … are read by OCR, Tesseract` or `scans … need Tesseract to be
    read (Settings › Setup)`.
  - *Try the skipped again* drops "OCR a scan in Zotero first".
  - With Tesseract and skipped scans: *Read the N skipped scans by OCR* (`set-extract-scans`, phase 6).
    It clears the scans from `skipped` and goes through the catch-up of every paper's text.
- **On opening:** the paper's text is extracted as `extract-batch --items <id>` (waited, recorded), so a
  scan or a large PDF is left alone once like the others.
- **Timeouts:** the Mac's `extract-batch` runs get an hour (OCR takes minutes a scan).

## After the reviews

A code review and a UX consistency review, fixed before the PR:
- **OCR, the runner:**
  - `ocrPage` settles only once both processes have ended. When tesseract stops reading early, pdftoppm is
    killed rather than left blocked on a full pipe (the runner would never exit); the page's time-out kills
    both.
  - A page OCR can't read keeps pdftotext's text; only a whole scan with nothing read is an error.
  - A paper's OCR is bounded by `OCR_PAPER_SECONDS` (10 minutes): past it, a scan is `too long to read by OCR`,
    left alone like the others. So a batch of three stays well inside the Mac's hour.
  - Chats and prompts don't OCR on the fly (`extractPages(…, { ocr: false })`): extracting saves it once.
  - The languages: English and your system's (`LANG`, given on the Mac from its locale when the app has none),
    not every one installed.
  - `tesseract --list-langs` times out after 10 s, and is read on stderr too (Tesseract 3).
- **Versions:**
  - An entry from before `used` was kept counts as used when the notes couldn't be read, so nothing is
    renumbered on a time-out.
  - One text with two numbers (machines apart) takes the smallest.
  - The number is taken (`commit()`) once the note or artifact is saved, not before.
- **Scans, the launchers:**
  - *Read the N skipped scans by OCR* reads just those papers, a few at a time (a queue before the tick's
    other work, a pending row in Processes), not a catch-up of every paper.
  - It counts only the scans OCR can read now (`Settings.isRetryableScan`), not the ones it gave up on.
  - A paper's menu says why it was left alone (`Left alone: … · Enter tries it again`).
  - The QML tick holds `extractRunning` while it asks, so a paper opened meanwhile can't start a second batch.
- **Deleting:**
  - From a note's own menu (the note window's Delete lands there), the launcher goes back to the results and
    searches again.
  - The question names the note, not the row.
  - Delete on the extracted text asks its own question.
  - The note window has a Delete button on Omarchy.
  - Failures are worded the same in both launchers (the bridge's name, the place with its row).
- **Note titles** (asked during the reviews): `lib/titles.mjs`'s `cleanTitle` and `fitTitle` give Zotero only
  plain, printable text within its 120 characters: a paper's rich text as its words; no control or invisible
  characters; the paper's title shortened first. They apply to prompt notes, extracted text and saved chats.

## Testing

- **Bridge:** `trashAny`, the routes.
- **Runner** (both trees):
  - The OCR helpers, and `ocrPage` with a fake spawn (the argv, one thread).
  - Versions: listing takes none; the notes' numbers win; the next after every number taken; the run
    suffix.
- **Settings and Views** (both trees): the Setup row, the Defaults wording, the scans row, the note's
  delete row.
- **Mac** (XCTest, fake bridge and runner): Delete asks then trashes, Keep it, the reader, an older
  plugin, typing; the scans retried through the catch-up; extract on open as a batch of one.
- **Parity:** 166 ids (`note-delete`, `set-extract-scans`), the QML reference refreshed.
