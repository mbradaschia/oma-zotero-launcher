# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The Omarchy plugin, the Zotero
bridge and the prompt runner share one version.

## [Unreleased]

### Changed

- **A paper's row, more compact**: its status over its task, its journal rankings on two lines; no pin icon (pinned
  papers are in Pinned). The task icon only for tasks beyond its default one (which has its own pill).
- **The footer, in two rows.** The keys for where you are on one line, whole hints only (as many as fit, going back
  always; `? keys` lists the rest), the keys brighter than what they do; under it what's going on: a confirmation
  or an error on the left, your open tasks, Zotero's last sync and the processes on the right (failures in red).

- **Pills, one standard everywhere.** Filled: the one chosen among choices (a status on the status line, a task's
  priority, the active search); tinted: something the item has (a result's status or task, a top journal grade, a
  taxonomy label); a faint outline: the other choices. Each kind has its colour from your theme (status in the
  accent, task, ranking, taxonomy, scope, priority), kept apart from the others and readable on the background.

- **A context bar above the search box**, below the top level: the paper and the submenu (with its rankings, which
  moved up from the status line), a note's paper, a task and its paper, a collection, tag or saved search (and its
  papers while you type), or the Settings path. The search box then holds only what you type, and its placeholder
  says what typing does there ("Type to filter", "Type to search in it"); the scope chip gave way to the bar.
- **The extracted text is behind its row, not among the notes.** It no longer crowds your notes (a paper's menu,
  `n`, the notes under a result, the other notes above the one you read; a result's note count leaves it out
  too). On *Text extracted ✓*, `Enter` reads it, and `Shift+Enter` (or `x`) offers *Read it*, *Extract it again*,
  *Open in Zotero* and *Delete it*. Prompts and chat use it as before, and it stays a note in Zotero.
- **Keys: one key acts, no Alt.** The search box has the keys when the launcher opens; `Esc` hands them to the
  list, where one key acts (after a short wait, 300 ms by default, so two quick keys are typing and go back to the
  search box); `/` or `Tab` returns to the search box. New keys: `c` chat, `.` processes, `;` settings, `#` tags,
  `x` extract text, `y` copy a note (was `c`). The old Alt keys stay available: *Settings › General › How keys
  act*. The header shows where the keys go (a caret) and what the search is limited to (a chip).
- **Settings**: every choice opens as a page (Enter picks, Esc goes back unchanged), in Settings and the prompt
  editor; *General* is grouped in sections.

### Security

- **Answers load nothing by themselves.** The chat window rendered a model's Markdown as is, so an image in an
  answer (which a paper could steer) loaded its URL on display, even with Ollama. Answers, streaming or saved, and
  the notes prompts write now have their images turned into links and raw HTML tags shown as text: a zero-width
  space between `!` and `[`, and after a `<` opening a tag, with no Markdown parsing that could disagree with the
  renderer (code spans, fences, escapes).
- **ChatGPT (subscription) reads only the paper.** Codex's "read-only" sandbox could still read every file you
  can, so a paper carrying instructions could have pulled other files (credentials) into the conversation. Its
  commands now run under a permission profile that reads only the system and Codex itself (no writes, no
  network), without the `--sandbox` flag that would override it; the tools that act outside the sandbox are off.
  Tested end to end against the bundled `codex`. A codex of your own (`OMA_CODEX_BIN`) gets its own files only (the
  binary, its code-mode helper, its packaged `codex-resources`), never the folders around it such as `~/bin`
  or `~/.local`; a wrapper script is refused.
- **Installers never write through a link.** `install-runner.sh` and `dev-sync.sh` replace a directory wholesale
  (`rsync --delete`); before that they check it (`scripts/safe-dest.sh`): no symbolic link at it or on the way to
  it, inside its base once resolved, yours, and empty or already ours (the runner, this plugin). Otherwise they
  stop and touch nothing. `~/.local/bin/oma-zotero-prompt` is only ever replaced if it is a link.

### Added

- **Settings from any menu's search**: typing in a menu lists the matching settings in a Settings section below its
  own rows; `Enter` opens the page on the setting.
- **Search by when a paper was added or changed**: `added:`, `modified:` and `recent:` (either), with `7d`, `2w`, `3m`, `1y`
  (the last days, weeks, months, years), `today`, `>2026-01-01`, `<2026`, `2026-01..2026-03` (a year or a month is all of
  it); in the @ picker, Added, Modified and Recent offer the usual spans, and After, Before and Between a date of your own.
- **A paper's menu, its footer**: whether its text is extracted and whether it's tagged by taxonomies (how many labels,
  being tagged), as pills in the status row; a warning when its taxonomies need an update (never tagged, out of date).
- **Change a paper's taxonomy labels by hand from the audit**: a check on the labels it has; `Enter` cycles one through
  auto → on, by you → off, by you → auto (`classify-decide --auto`); yours are kept on later passes. A refreshed list
  keeps its place. Dismissing a label now also takes its tag off the paper.
- **Move a paper's menu row out of the way**: `P` (`Shift+p`) puts the highlighted row in *Other*, at the bottom of every
  paper's menu; `P` again puts it back.
- **A paper's taxonomies** (its menu › Taxonomies): every taxonomy in a section, its labels on the paper. A taxonomy
  can be hidden on papers (its page › On papers); the pills under the status line wrap onto as many lines as needed.
- **Audit the taxonomies** (a paper's menu): every label's probability and what became of it; `Enter` tags one,
  `Delete` dismisses it. Every label's probability is kept with the result. `oma-zotero-prompt classify-show`.
- **Edit taxonomies in the launcher.** *Settings › Taxonomies* opens a page for each, a form like a task's (its fields
  typed in place): name, tag prefix, unique (one label per paper) or several, question, thresholds; its labels (add,
  rename, define, move, delete), with an offer to rename or delete their tags on papers; turn a bundled one off (and
  back on), delete yours, back to the bundled one. `oma-zotero-prompt taxonomy-show`, `taxonomy-save` (checked:
  valid, its prefix not another's; `--new`), `taxonomy-remove`.
- **Taxonomies with AI.** *New taxonomy with AI…* and *Change it with AI…*: your prompts model proposes it, each
  change marked; discuss it (it revises its proposal), then accept it or discard it. `oma-zotero-prompt taxonomy-draft`.
- **Unique taxonomies keep one label per paper**: a label put on by hand wins over the classifier's (which goes to
  Review), an accepted suggestion replaces the paper's label, and the tag editor replaces the other one.
- **Scripted keys and typing go into a form's field** (`omarchy-shell oma-zotero-launcher type` / `key`), for tests.
- **Taxonomy filters in the @ picker**: each taxonomy, its labels with how many papers have each.
- **Every setting from the search**: typing part of a setting's name lists it under *Go to*; `Enter` opens its page
  on it.
- **Extract and tag a paper when you open it.** *Settings › Defaults › Extract a paper's text when you open it* and
  *Settings › Taxonomies › Tag a paper when you open it*: opening a paper's menu extracts its text when it has a PDF
  and none, and tags it by the taxonomies it isn't up to date with (never tagged, or tagged by an earlier version
  of one: each result keeps the taxonomy's fingerprint), after its text. `oma-zotero-prompt classify-status`.
- **A paper's taxonomy labels as pills**, under its status line in its menu and submenus (a click: the papers with
  that label), with a word when they're being tagged, out of date or missing.
- **Pin a menu's rows, and order them.** In a paper's menu, `p` pins the highlighted row into a *Pinned* section
  on top of every paper's menu; `Shift+↑`/`↓` moves any row within its section (kept for every paper's menu).
- **The keys for where you are.** `?` (and `F1`, from anywhere, while you type too) opens Keybindings with a
  *Here* section first: the keys of the view you're in; the footer always starts with `? keys`. The note window
  (`?`, `F1`, a *Keys* button) and the chat window (`F1`) show theirs in a panel. The keybindings list is complete
  (the note reader's, the tag editor's, Settings', the chat window's keys were missing).
- **Whether each API key works.** A key is tested when you set it, and once when Settings opens if it hasn't been
  (or not since it changed); the provider's line, its key row and *Settings › Taxonomies › Test the Jev key* say
  *✓ Works · tested 10 min ago*, *✗ Failed: …* or *Not tested yet*. The last test is kept
  (`~/.local/state/oma-zotero/key-tests.json`, with the masked key only). `oma-zotero-prompt provider-test jev`.
- **Tag papers by taxonomies.** Paper type, ontology, epistemology, method and theories come bundled, as tags
  (`type/…`, `ont/…`, `epi/…`, `method/…`, `theory/…`); add your own or edit them (JSON files, a definition per
  label) in *Settings › Taxonomies*. One paper (its menu), a collection, a tag or a saved search (*Go to*, asking
  first), or each new paper as it arrives. Classified by Jev (TypeSafe's System One model, key in the keyring),
  else your prompts model, from the title, the abstract and the extracted text. Labels under the threshold
  are suggested, in a review list (accept or dismiss); a later pass replaces only the tags an earlier one added.
  `g` groups the results by any taxonomy. The Literature Review prompt's *Type of paper* uses the same labels.
- **Automatic text extraction**: *Settings › Defaults › Extract new papers' text* extracts a paper's text when its PDF
  arrives in Zotero, in the background (launcher open or not); *Extract every paper's text* (or Go to › *Extract…*,
  for a collection, a tag or a saved search too) catches up on the rest, a few at a time, resumable, with how many
  are left. PDFs over *Skip PDFs larger than* (40 MB) and scans are skipped after one try (*Try the skipped again*).
  New: the bridge's `/extract/pending` (and each paper's newest PDF date in its index), the runner's
  `extract-batch`, `extract.json` for the queue's state.
- **Group and sort the results' papers** (`g`, `G` back): by paper status, task status, task group, newest added,
  changed or published, or relevance; a heading per group, the papers' relevance kept within each. Collections,
  tags, Go to and pinned papers stay put. The header names it, and it's remembered (`view.json`). The bridge's
  results carry their dates added and changed.
- **A tag into a status**: the tag editor's `Shift+Enter` on a tag offers *Make it a paper status…* and *Make it a task
  status…*: a new status named after it, or merged into one of yours. The tag is renamed on every paper (`s/…`,
  `t/…`), after asking with the count; a task status gives each of its papers its default task in it (the bridge's
  `/tags/items` lists them).
- **Status tags out of the tag editor**: `s/…` and `t/…` tags aren't listed or counted there; two *Statuses* rows
  say the paper's status and its tasks' statuses and open their Settings page.
- **Statuses from the note view and the note window**: `Alt+→` / `Alt+←` change the paper's status and
  `Shift+Alt+→` / `Shift+Alt+←` its default task while you read one of its notes; the header's pills move at once
  and Zotero gets the tags a second later. The note window shows both pills under the paper. A note on no paper
  (or on another paper than the one whose details are loaded) shows none.
- **A paper's default task**: a task status applied to the paper itself ("this paper: Reading"). `Shift+Alt+→` /
  `Shift+Alt+←` on a paper (the results, its menu) moves it along the task statuses: the first press makes it
  ("Read {cite}", *Settings › Tasks › A paper's default task*), past either end it's done, not deleted; saved a
  second after the last press, its `t/` tag following. Its status is an outlined pill on the paper's row and in its
  menu's top line; *This paper* has a *Task* row. It's a task like the others, one per paper (marked `isDefault`).
- **Sync Zotero** from the launcher: under Go to (type *sync*) or `S`, Zotero's own sync starts without switching to
  Zotero (the bridge's `/sync/start` and `/sync/status`). It shows in Processes with what Zotero is doing, then
  *Synced* or Zotero's error, and the results are searched again; the footer says when Zotero last synced. Until
  Zotero sync is set up, it says so instead of starting.
- **Copy a citation or a bibliography entry**: in a paper's menu, *Copy citation* ("(Adner & Helfat, 2003)") and
  *Copy bibliography entry* show what they copy; `i` and `r` copy them from the results, the paper's menu and the
  note reader. Zotero formats them in your style, *Settings › General › Citation style* (the styles installed in
  Zotero; APA 7th edition by default, `citationStyle` in the file). The bridge lists the styles (`/styles`).
- **Artifacts**: a prompt can make a diagram (Mermaid), a mind map (markmap), an image (SVG), an HTML page or a
  Markdown file instead of a note (*Makes* in the prompt editor; `output:` in the file). A chat makes and changes
  them when asked, with `<artifact>` blocks any model can write; answers link to them and the chat's sidebar lists
  them. The paper's menu lists them: open, change it with AI (a new version), edit it yourself, undo, rename,
  delete. Every version is kept, in *Settings › General › Artifacts folder*, a folder per paper. What the model
  writes is checked (asked once more with what was wrong), stripped of scripts and outside links, and shown under a
  policy that blocks scripts and the network; the drawing libraries are fetched once, pinned by SHA-256.
- **Saved searches.** `s` (or `Ctrl+S` while typing) saves what the results show, the typed search within the
  collection, tag or saved search it's in, under a name. `f` lists them (also *Searches* under Go to): `Enter`
  opens one (type to search within it), `Shift+Enter` opens, pins, renames, edits or deletes it, `p` pins it,
  `Shift+↑`/`↓` reorders. **Pinned searches are badges above the results**: `Alt+→` / `Alt+←` move along them
  (*All* first), and the results search within the selected one. Kept in
  `~/.config/omarchy/oma-zotero-launcher/searches.json`.
- **`@` in a new task's line**: a menu of actions, the paper's citation, statuses, quick due dates and priorities,
  each put in as a block; a kind already in the line isn't offered again. The actions are yours to edit in
  *Settings › Tasks* (add, rename, remove, reorder).
- **The list has the keys** in menus, going back and on opening, unless something is typed in the search box;
  pages for typing (names, a task's line, dates, the `@` pickers, the tag editor) start in the search box. A
  setting, *General › Where the keys start*, brings back the search box first.
- **Statuses in Zotero, with a prefix**: paper statuses are `s/…` tags and task statuses `t/…` tags on the task's
  paper, kept in step as tasks change. Renaming or removing a paper status offers to rename or delete its tag on
  every paper (with the count); task statuses' tags follow theirs. *Settings › Paper status* moves older,
  unprefixed status tags to `s/`. The tag editor renames or deletes a tag everywhere (`Shift+Enter`). And back: `s/…` and
  `t/…` tags made in Zotero become statuses, and renames made in Zotero rename them (the bridge logs Zotero's
  tag changes); renaming a status renames its tag, removing one deletes it (asked first).
- **Reading a note**: select text with the mouse and it's copied (a short "Copied N words" in the footer).
- **A paper's tasks show their status as a pill** in its menu.
- **Pinned in saved searches**: in a saved search, what you pinned and it matches comes first, under *Pinned*;
  elsewhere in the results a pin marks it.
- **A task icon on papers in the results** when they have open tasks; red when one is overdue.
- **One look for every list**: the same icon size, row height (a little more compact) and fonts in the results,
  menus, tasks, processes and settings; every icon outlined (books, reports, notes, folders, tags, settings… were
  solid and looked black next to the others).
- **Reading a note**: the paper's other notes are listed above it, and `Shift+↑` / `Shift+↓` moves to the
  previous / next one; `t` starts a task about the note (and its own paper, wherever you opened it from).
- **A paper's notes under it**: `Space` on a paper in the results shows its notes as indented rows below it
  (`Enter` or `→` reads one; `Space` or `←` hides them).
- **Keybindings** (`?`, or *Keybindings* under Go to): every key, by section, with search.
- **`Alt+Backspace`** clears the search box.
- **The launcher as a window**: `W` moves it into a regular window (it stays when you click elsewhere); `W` again
  puts it back as the overlay. `closeIfOpen` (IPC) lets Super+W close the launcher when it's open.
- **A task's page is a form**: the description and notes are edited in place (notes: `Enter` is a new line),
  status and priority are pills that `Tab` / `Shift+Tab` change on their row, and the due date opens a calendar.
  `Enter` adds a task and opens its page; `Shift+Enter` just adds it.
- **Keys swapped**: `Tab` / `Shift+Tab` move along the pinned searches' badges; `Alt+→` / `Alt+←` change a
  paper's status (Tab still changes a task's).
- **Search titles and abstracts**: `ta:"…"` (title or abstract) and `ab:"…"` (abstract only); in the `@` picker,
  *Title* and *Title and abstract* put the prefix and its quotes in, the cursor inside. Dead keys (US intl.:
  `"` `'` `^` `~` `` ` ``) now type in the search box.
- **Search by status, tasks, chats and more**: `status:reading` / `status:none` (a paper status), `task:waiting`
  (a task's status or group), `has:task`, `has:chat`, `has:collection` and their `!has:` opposites, and years
  compared: `y:>=2020`, `y:<2010`. The `@` picker has *Paper status*, *Tasks* and each *Has* both ways, counted.
- **`@` in the search box**: a picker for tags, authors, publications, years, collections, item types, *has a
  PDF / notes / files*, your saved searches, the operators and the syntax; `Enter` puts its term in the search at
  the caret.
- **The search box**: operators and finished terms show as blocks labelled by what they are (*A: Smith, John*,
  *P: …*, *# risk*, *OR*), deleted and stepped over whole; the rest is text in the theme's colours. It has a caret
  (`←` `→` `Home` `End`), and `(` and `"` close themselves around it.
- **Boolean search**: `AND`, `OR`, `NOT` (uppercase) and `( )`, e.g. `(#risk OR #resilience) NOT y:..2010`;
  quoted names (`#"supply chain"`, `a:"Smith, John"`) match the whole name; new filters `c:collection` (with its
  subcollections), `type:book`, `has:pdf` / `has:notes` / `has:files`, and `p:`, `journal:`, `tag:` aliases.
  The bridge's `/search` takes `within` (a saved search), and the new `/facets` matches the picker's values as
  you type (in the bridge, a few milliseconds even over 10,000 authors) and sends the best 100.
- **Development**: `scripts/dev-sync.sh --as NAME` installs a checkout as a second plugin,
  `io.github.mbradaschia.oma-zotero-NAME`, answering IPC as `oma-zotero-launcher-NAME`, next to the installed one.
- **Write a prompt with AI**: in *New prompt…*, type what the prompt should do and pick *Write it with AI*; your
  default prompts model drafts its title and text from a meta prompt (modeled on the bundled prompts, following
  your rules) and it opens in the editor to review. From a terminal: `oma-zotero-prompt new-ai --describe "…"`.
- **Rules for prompts and chat** (*Settings*): the rules the model follows are no longer hard-coded but a
  checklist to turn on and off: grounded in the paper, academic rigor, APA 7 in-text citations with pages, an APA 7
  reference list, and the format; all on by default. Plus your own instructions, added after them
  (`instructions.md`, edited from the same page). From a terminal: `oma-zotero-prompt system [--chat]` prints the
  system prompt as sent; `system edit|clear` your instructions.
- **Prompts in the chat window**: *Prompts ▾* next to the model puts one of your prompts in the question box.
- **Paper status**: your status tags (to read, reading, read to start with; *Settings › Paper status*) as a badge
  on each result and a *Status* row in a paper's menu. `Tab` / `Shift+Tab` on a paper cycles it; Zotero gets the
  new tag and loses the old one a second after the last press. The bridge's search takes `statusTags` and says
  each result's status.
- **Tasks**: a to-do list about your papers. `t` lists them by status (Backlog, Next, Active, Waiting, Completed:
  your statuses, in *Settings › Tasks*: add, rename, remove, reorder); `a` adds one about the highlighted paper
  and note or chat; each has a description, status, priority, due date, notes, and its paper, note or chat.
  `Tab` / `Shift+Tab` cycles the status, `Shift+↑`/`Shift+↓` reorders (into the next status past the ends); a
  paper's menu lists its tasks; the footer shows a badge per group.
  Adding is one line (`#status !priority @due`, previewed; `Enter` adds and stays, `Shift+Enter` opens it), or
  typed straight into Tasks; `d` done, `!` priority, `Delete` (`u` undoes) act on a task without opening it.
- **Go to**: what you type also finds Chats, Processes, Settings and its pages, and New chat…, on top of the results;
  the cursor still starts on the first paper that matches.
- **Processes in the footer**: running, finished and failed, always in view. *Tasks* is now called *Processes*,
  `.` opens it, and it's grouped under Running, Finished and Failed.
- The results before you type are only your papers: the Processes, Chats and Settings rows are gone (keys `.`, `c`,
  `;`, and *Go to* when you type their names).
- The note window's *Chat* (`c`).
- **Setup in Settings**: a checklist (Zotero, the Zotero plugin, the keybinding, Node.js, the AI features, a model,
  pdftotext, the keyring) with each step's state, and `Enter` to do it: start Zotero, download the latest Zotero
  plugin (checked) with the steps to install it, add the keybinding, run an install command in a terminal. When
  Zotero or its plugin isn't working, the results show those steps.
- **Zotero command** (*General › Advanced*): how to start Zotero, `zotero` by default.
- **Reorder pins**: `Shift+↑` / `Shift+↓` on a pinned item.
- **Chats by paper**: the Chats list groups chats under their paper, the paper with the newest chat first.
- **A paper's chats in its menu**: `Enter` continues one; `Shift+Enter` renames or deletes it (`chat-delete` in the
  runner).
- **Extract the text first** (*Settings › Defaults*): a chat or prompt on a paper without extracted text extracts it
  first. The extraction row shows it running and updates when it's done (it used to keep its old state).
- **Reorder**: `Shift+↑`/`Shift+↓` moves a note in a paper's menu; `Ctrl+Shift+↑`/`Ctrl+Shift+↓` moves a whole section
  in any menu or the results. Both are kept (`~/.config/omarchy/oma-zotero-launcher/view.json`).
- Every menu starts with the search box (reopening keeps where the keys were); the setup steps show a
  checkmark when done, starting with *Install Zotero*.
- A blinking block cursor in the search box while it has the keys; `/ search` first in the footer when the list
  has them.

### Fixed

- **Inside a saved search, only what you type is highlighted**: its own terms aren't (every paper in it has them). The
  Zotero plugin's search takes the query to highlight apart from the one searched.
- **Several-label taxonomies (Method, Theories) tagged nothing**: Jev's yes/no answers (`{ noul: p }`) were read as 0.
  Results from before count as out of date, so papers are tagged again.
- *Edit* on a bundled taxonomy and *New taxonomy…* failed: the runner wrote the file with a function it didn't import.

- **Room between a row's two lines.** Each line is as tall as its font's own line (its metrics, so a font with
  tall ones no longer overflows), with a fixed gap between them; pills on the second line (a task's status and
  priority) are sized to it and no longer run into the line above. The row height stays 38 px with the theme's
  fonts, and only grows when a font needs it.

## [0.1.0] - 2026-09-30

First release.

### Added

- **Search.** Fuzzy search over your Zotero library from anywhere in Omarchy (SUPER+SHIFT+Z):
  titles, authors, years, tags, with fzf-style terms (`a:`, `t:`, `y:2019..2021`, `#tag`, `!`, `|`).
  Before you type: your pinned papers and collections, the papers open in Zotero, then the most recent
  ones (each by the newer of its added and modified dates).
- **Collections.** Matching collections listed by their full path as you type; open one to list and
  search its papers (subcollections included), pin it, or select it in Zotero.
- **Tags in the search.** Up to three tags matching what you type, under *Tags*; `Enter` lists a tag's
  papers (search among them), `Alt+P` pins it.
- **Picks up where you left off.** Reopening the launcher returns to the same view, submenu, query, row and
  collection, tag or paper; `Esc` still goes back a level.
- **Note text size.** `Ctrl+-` / `Ctrl++` (and `Ctrl+0`) in the note reader and the note windows; the
  size is kept for the next notes. A small gap between paragraphs, and none between bullets.
- **Compact rows.** Smaller type in the results and the paper's menu, and a taller window: more fits.
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

[Unreleased]: https://github.com/mbradaschia/oma-zotero-launcher/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mbradaschia/oma-zotero-launcher/releases/tag/v0.1.0
