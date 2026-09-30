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
  Before you type: your pinned papers and collections, the papers open in Zotero, then the most recent
  ones (each by the newer of its added and modified dates).
- **Collections.** Matching collections listed by their full path as you type; open one to list and
  search its papers (subcollections included), pin it, or select it in Zotero.
- **Item menu** (`Enter`; `Shift+Enter` opens the item in Zotero), in sections: its notes; prompts, chat
  and text extraction; the paper (pin, open in Zotero, the PDF externally or in its own Zotero window,
  tags, show in library).
- **Notes.** Listed under the item; read them in the launcher or in their own resizable window with the
  paper cited APA 7 style ("Sirmon et al. (2007)"), its journal and rankings; open them in Zotero, copy
  them as Markdown, or save them as `.md` files. Plain keys while reading (`z`, `w`, `c`, `s`, `j`/`k`).
- **Prompts.** Run a prompt on a paper and get the answer saved as a child note. Two prompts
  included: *Literature Review* and *Findings and Takeaways*, with verbatim quotes, APA 7 citations with
  pages and an APA 7 reference list. Add and edit prompts in the launcher, with a model (grouped by
  provider, or the default) and an effort; prompt files name models as `provider:model`.
- **Chat with a paper.** A chat window grounded in the paper's text (its extracted-text note, else the
  PDF), with past chats per paper, streamed answers that quote with pages, and Copy / Save to Zotero /
  Download for each answer and for the whole chat. A chat can switch models and providers between questions.
- **Model providers, for anyone.** Prompts and chat run on the Claude or ChatGPT subscription you already
  have (Claude Agent SDK, Codex SDK), an API key (OpenAI, Anthropic, Google Gemini, OpenRouter, through the
  Vercel AI SDK), a private model on your computer (Ollama, with the context each request needs), or an
  OpenAI-compatible endpoint (LM Studio, vLLM, llama.cpp, institutional gateways). A settings file from
  before providers keeps using Claude.
- **Settings in the launcher.** A *Settings* row at the top of the results, in sections: *Models &
  providers* (what's already on your computer under *Ready to use*, one `Enter` to turn it on; a page per
  provider with Test connection, its key, base URL and context size, what leaves your computer and what a
  run costs), *Defaults* (model and effort for prompts and for chat, a fallback model), *General* (every
  launcher setting, from a schema) and *Requirements* (Node.js, the AI features, pdftotext, the keyring).
  Every change is validated and saved at once, in a sectioned settings file.
- **Onboarding.** Without a model, the paper's menu shows *Set up an AI model*; *Install AI features*
  installs the prompt runner from the launcher, with its progress in Tasks.
- **Keys in the keyring.** API keys go from the clipboard straight to the system keyring (secret-tool),
  and the clipboard is cleared; never to a file. Keys in the environment work too.
- **Quote check.** Every quotation in an answer or a note is looked up in what the model was given;
  the ones not found word for word are flagged under the answer and listed at the end of the note.
- **Costs and tokens.** Tasks show each run's model, tokens and cost (subscriptions: in your plan); chat
  answers show their model and cost.
- **Fitting the model.** The paper, highlights and notes are fitted to each model's context (notes left
  out first, then the text cut from the end, and the output says so).
- **Chat context.** A meter of the model's context window in use; long chats summarize their earlier
  exchanges (quotes and pages kept, the paper never summarized) before the window fills, and retry after
  a prompt-too-long error.
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
  lists = the bare letter while reading (`W` window, `C` copy, `S` save, `P` pin, …), `Alt+1…9` picks the
  numbered row, `Esc` back.
- **Zotero bridge** (`.xpi`, Zotero 10): token-protected local routes for search, items, notes (read,
  create), full text, annotations, citations (CSL, APA 7), tags and tabs. Updates itself from the
  GitHub releases.

[Unreleased]: https://github.com/mbradaschia/oma-zotero-launcher/commits/HEAD
