# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The Omarchy plugin, the Zotero
bridge and the prompt runner share one version.

## [Unreleased]

First release.

### Added

- **Search.** Fuzzy search over your Zotero library from anywhere in Omarchy (SUPER+SHIFT+Z):
  titles, authors, years, tags, with fzf-style terms (`a:`, `t:`, `y:2019..2021`, `#tag`, `!`, `|`).
  Before you type: your pinned papers and collections, the papers open in Zotero, then recently added ones.
- **Collections.** Matching collections listed by their full path as you type; open one to list and
  search its papers (subcollections included), pin it, or select it in Zotero.
- **Item menu** (`Enter`; `Shift+Enter` opens the item in Zotero): pin to the top, open in Zotero, open
  the PDF externally or in its own Zotero window, the item's notes, prompts, tags, show in library.
- **Notes.** Listed under the item; read them in the launcher or in their own resizable window with the
  paper cited APA 7 style ("Sirmon et al. (2007)"), its journal and rankings; open them in Zotero, copy
  them as Markdown, or save them as `.md` files. Plain keys while reading (`z`, `w`, `c`, `s`, `j`/`k`).
- **Prompts (Claude).** Run a prompt on a paper and get the answer saved as a child note. Two prompts
  included: *Literature Review* and *Findings and Takeaways*, with verbatim quotes, APA 7 citations with
  pages and an APA 7 reference list. Add and edit prompts in the launcher, with model and effort
  picked from the models your Claude account offers. Runs through the Claude Agent SDK with a Claude
  subscription (your Claude Code login); other models and providers are not supported yet.
- **Chat with a paper.** A chat window grounded in the paper's text (its extracted-text note, else the
  PDF), with past chats per paper, streamed answers that quote with pages, and Copy / Save to Zotero /
  Download for each answer and for the whole chat. Claude (Agent SDK sessions, resumed per turn).
- **Tasks and chats.** A task queue (prompt runs, extractions: running, finished, failed) in the footer
  and at the top of the results (`Alt+Q` from anywhere); a finished task opens its note. A Chats list
  reopens any chat; *New chat…* picks the paper, in the launcher or in the chat window. The chat window
  shows whether the text is extracted (and extracts it), grounds new chats in the `.md` note or the PDF,
  and renames chats.
- **Extract the text.** The PDF's text as a note, page by page with the journal's printed page numbers
  (pdftotext); chats and prompts ground on it.
- **Tags.** Add, remove and create tags, with colors and counts; undoable in Zotero.
- **Journal rankings.** ABS (Chartered ABS *Academic Journal Guide* 2024), ABDC (*Journal Quality List*
  2025), FT50 and UTD24 labels on results and in the note window, matched by ISSN or journal name.
- **One set of keys everywhere:** `Enter` the main action, `Shift+Enter` open in Zotero, `Alt+letter` in
  lists = the bare letter while reading (`W` window, `C` copy, `S` save, `P` pin, …), `Esc` back.
- **Zotero bridge** (`.xpi`, Zotero 10): token-protected local routes for search, items, notes (read,
  create), full text, annotations, citations (CSL, APA 7), tags and tabs. Updates itself from the
  GitHub releases.

[Unreleased]: https://github.com/mbradaschia/oma-zotero-launcher/commits/HEAD
