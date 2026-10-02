# Zotero Launcher for Omarchy

[![CI](https://github.com/mbradaschia/oma-zotero-launcher/actions/workflows/ci.yml/badge.svg)](https://github.com/mbradaschia/oma-zotero-launcher/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mbradaschia/oma-zotero-launcher?sort=semver)](https://github.com/mbradaschia/oma-zotero-launcher/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Your whole Zotero library, one keystroke away.** Press **SUPER+SHIFT+Z** anywhere in
[Omarchy](https://omarchy.org), type a few letters, and you're in the paper: its PDF, its notes, its tags,
and an AI model of your choice, ready to review it, chat about it and quote it with page numbers. All from the keyboard, without
hunting through Zotero's windows.

![Search results with matching tags and journal rankings, and the menu for one paper: its notes, prompts and chat](preview.png)

**At a glance**

| | |
|---|---|
| ⚡ **Instant search** | Fuzzy search over 1,000s of papers as you type, in milliseconds, right inside Zotero |
| 📚 **Everything about a paper** | Its notes, PDF, tags, collections and journal ranking in one menu |
| 🤖 **AI, grounded in the paper** | Literature reviews, findings and takeaways, and a chat that quotes the paper with page numbers, on the model you choose |
| 🔌 **Any model you have** | Your Claude or ChatGPT subscription, an API key (OpenAI, Anthropic, Gemini, OpenRouter), your institution's endpoint, or a private model on your computer (Ollama) |
| 🏅 **Journal quality at a glance** | ABS, ABDC, FT50 and UTD24 labels on every result |
| ⌨️ **Keyboard first** | One consistent set of keys across every view, numbered rows, no mouse needed |
| 🔒 **Local and private** | Talks only to Zotero on your machine; nothing leaves it unless you ask a cloud model (or none at all, with a local one) |

## Features

### Find anything, fast

- **Fuzzy search** over titles, authors, years and tags, ranked like fzf: first authors and whole title
  phrases first. Filters when you need them: `a:smith`, `t:resilience`, `y:2019..2021`, `#tag`, `c:collection`,
  `has:pdf`, `!exclude`, `either | or`, and `AND` / `OR` / `NOT` / `( )`; `@` picks a tag, an author, a year, a
  collection… for you.
- **Saved searches**: save a search, open it later, and pin the ones you use as badges above the results;
  `Tab` switches between them.
- **Before you type**, the list is already useful: your pinned papers and collections, the papers open in
  Zotero, then the most recent ones (newest added or changed first).
- **Collections** by their full path ("Topics / SCM / Power"): open one to browse and search its papers,
  subcollections included. **Tags** the same way: the matching tags, and a tag's papers in one keystroke.
- **Pin** the papers, collections and tags you keep coming back to.
- **Picks up where you left off**: reopen the launcher and you're back in the same view, menu, query and row.
- **Journal rankings** on every result: **ABS** (Chartered ABS *Academic Journal Guide* 2024), **ABDC**
  (*Journal Quality List* 2025), **FT50** and **UTD24**, with the top grades highlighted.

### Get to the paper

- **Jump into Zotero**: its open tab, or its PDF in Zotero's reader, in a Zotero window of its own you can
  tile, or in your own PDF app.
- **Show it in your library**, or select a collection in Zotero's tree.

### Read and reuse your notes

- **Read notes** right in the launcher, nicely typeset, or open one in its **own window** to keep next to
  the PDF, with the paper cited APA 7 style ("Sirmon et al. (2007)"), its journal and ranking.
- **Copy** a note as Markdown, **save** it as a `.md` file, or open it in Zotero's editor, with a key.

### Think with AI, on the model you choose

- **Bring what you have**: a **Claude** or **ChatGPT** subscription, an **API key** (OpenAI, Anthropic, Google
  Gemini, OpenRouter's hundreds of models, some free), your institution's **OpenAI-compatible endpoint**, or a
  **private model on your computer** with Ollama. The launcher's **Settings** finds what you already have and
  gets you going in one keystroke; keys go to your system keyring, never to a file.
- **Prompts** that write notes for you: a complete **Literature Review** and **Findings and Takeaways**
  come included, and you can write your own (each with its own model and effort, or your default), or describe
  what you want and let the model **write the prompt for you**.
- **Rules you pick**: what the model must do with every prompt and chat, as a checklist in Settings (grounded
  in the paper, academic rigor, APA 7 in-text citations with pages, an APA 7 reference list, the format), plus
  instructions of your own.
- **Artifacts, not only notes**: a prompt or a chat can make a **diagram**, a **mind map**, an **image** (SVG),
  an **HTML page** or a **Markdown file** about the paper, kept with it, every version saved; ask the AI to change
  one and it writes a new version. They open in your browser, offline.
- **Chat with a paper** in its own window: ask anything, get answers that **quote the paper verbatim with
  APA 7 citations and page numbers**, keep and rename past chats, and save any answer, or the whole chat, to
  Zotero, the clipboard or a file. Start a chat about any paper in your library.
- **Grounded, not guessed**: the model reads the paper's text, your highlights (with their pages) and your
  notes, and is told never to invent a quote, a page or a reference. A **quote check** looks every quotation up
  in the paper and flags any it can't find word for word.
- **Fits any model**: long chats are summarized before they overflow the model's context (the paper itself is
  always sent whole); smaller models get the text cut to fit, and say so.
- **Extract the text** of a PDF into a page-numbered note, with the page numbers printed in the journal, so
  quotes cite the right page; choose whether a chat reads that text or the PDF.
- **A task queue** shows what's running and what's done, with the model, tokens and cost of each run; open the
  note a task wrote in one keystroke. The launcher stays open while the model works.

### Organize

- **Tags**: add, remove and create them, with Zotero's colors and counts; undoable in Zotero.
- **Pins** and **collections** keep your current work at the top; chats, processes and settings are a key away.

### Made for the keyboard

- **One set of keys everywhere**: `Enter` does the main thing, `Shift+Enter` opens in Zotero, `Alt+letter`
  acts (`W` window, `C` copy, `S` save, `P` pin, `N` notes, `T` tags…), `Alt+1…9` picks a numbered row, `Esc`
  goes back.
- **Looks like Omarchy**: it follows your theme, fonts and window rules, and opens from its own keybinding.

### Private by design

- The launcher talks only to Zotero on your computer, through a token only you can read. Your library never
  leaves your machine, except what you send to a cloud model when you run a prompt or chat, and with a local
  model, not even that (see [Privacy and security](#privacy-and-security)).

## Requirements

- [Omarchy](https://omarchy.org) (its shell with plugin support).
- [Zotero 10](https://www.zotero.org) (the Zotero plugin accepts 10.x; earlier versions aren't supported).
- For prompts and chat (optional): [Node.js](https://nodejs.org) 22 or newer (`omarchy install dev-env node`),
  and one AI model: see [Choosing a provider](#choosing-a-provider).
- For extracting text: `pdftotext`, from Poppler (`omarchy pkg add poppler` if `pdftotext -v` doesn't run).

## Install

The launcher has three parts: a small **Zotero plugin** (the bridge), the **Omarchy plugin** (the launcher
itself) and, optionally, the **prompt runner**.

### 1. The Zotero bridge

1. Download `oma-zotero-launcher-<version>.xpi` from the
   [latest release](https://github.com/mbradaschia/oma-zotero-launcher/releases/latest).
2. In Zotero: *Tools → Plugins*, then the ⚙ menu → *Install Plugin From File…*, and pick the file.

Zotero keeps it up to date from then on (it checks this repository's releases).

Or let the launcher fetch it: once the Omarchy plugin is installed (step 2), open the launcher; without the
Zotero plugin its results show **Install the Zotero plugin** (also in *Settings › Setup*), and `Enter` downloads
it, checked, to Downloads, starts Zotero and lists the three clicks.

### 2. The Omarchy plugin

```bash
omarchy plugin add https://github.com/mbradaschia/oma-zotero-launcher --enable
```

Or find it in the [Omarchy Plugin Marketplace](https://plugins.omarchy.org/#catalog) once it's listed there; it
gives the same command.

### 3. The keybinding

Add this to `~/.config/hypr/bindings.lua`, then run `hyprctl reload`:

```lua
o.bind("SUPER + SHIFT + Z", "Zotero launcher", { panel = "io.github.mbradaschia.oma-zotero" })
hl.layer_rule({ match = { namespace = "oma-zotero" }, no_anim = true, animation = "none" })
```

The second line is optional: it lets the launcher open with its own animation, growing from the middle,
instead of Hyprland's layer animation sliding it in from the corner (as Omarchy does for its own menus).

Any free key works; `omarchy-shell shell toggle io.github.mbradaschia.oma-zotero` opens it from a script.

**Super+W** (Omarchy's *close window*) acts on the window behind the launcher: the launcher is an overlay, not a
window. To have it close the launcher when it's open, and the window otherwise, rebind it (after any other
binding of the key):

```lua
o.rebind("SUPER + W", "Close the launcher or the window",
  [=[test "$(omarchy-shell oma-zotero-launcher closeIfOpen 2>/dev/null)" = closed || hyprctl dispatch killactive]=])
```

`closeIfOpen` closes the launcher and prints `closed` if it was open, else prints `not-open`; put your own
command after `||` if Super+W does something else for you.

### 4. Prompts, chat and text extraction (optional)

Open the launcher, press `Esc` then `;` (or type *settings*) for **Settings**, then:

1. **Setup › Install AI features**: installs the prompt runner (it copies it to
   `~/.local/share/oma-zotero-launcher/runner`, installs its packages there and links
   `~/.local/bin/oma-zotero-prompt`; the progress is in Processes). From a terminal, the same:
   ```bash
   make -C ~/.config/omarchy/plugins/io.github.mbradaschia.oma-zotero prompts-install
   ```
2. **Models & providers**: what you already have is under *Ready to use* (Claude Code signed in, Codex signed
   in with ChatGPT, Ollama running, an API key in your environment): `Enter` turns it on and makes it the
   default. Or pick a provider under *Add a provider* and follow its page (see
   [Choosing a provider](#choosing-a-provider)).

That's it: **Prompts** and **Chat with the paper** in a paper's menu now work. Until a model is set up, the
paper's menu shows **Set up an AI model** instead, which opens the same page.

### From a checkout (development)

```bash
git clone https://github.com/mbradaschia/oma-zotero-launcher && cd oma-zotero-launcher
make xpi              # dist/oma-zotero-launcher-<version>.xpi, to install in Zotero as above
make install          # copies the Omarchy plugin into ~/.config/omarchy/plugins and enables it
make prompts-install  # optional
```

## Update

- **Zotero bridge**: automatic. To force it: *Tools → Plugins → ⚙ → Check for Updates*.
- **Omarchy plugin**: `omarchy plugin update io.github.mbradaschia.oma-zotero`.
- **Prompt runner**: *Settings › Setup › AI features installed* (`Enter` installs it again) after
  updating the plugin, or the `prompts-install` command.

The three parts share one version. The launcher works with an older bridge, but new features may need
the new one: update both.

## Uninstall

```bash
omarchy plugin remove io.github.mbradaschia.oma-zotero
rm -rf ~/.local/bin/oma-zotero-prompt ~/.local/share/oma-zotero-launcher ~/.cache/oma-zotero-launcher
rm -rf ~/.config/omarchy/oma-zotero-launcher ~/.config/omarchy/oma-zotero-launcher.json  # your settings, pins and prompts
secret-tool clear service oma-zotero-launcher provider openai   # each API key you stored (openai, anthropic, google, openrouter, …)
```

In Zotero, *Tools → Plugins* → *Omarchy Zotero Bridge* → *Remove*. Remove the keybinding from
`bindings.lua`. Notes the prompts created stay in Zotero (they are tagged `oma-prompt`).

## Usage

### Keys

The same keys mean the same thing everywhere: in the results, inside a collection or a tag, in a paper's
menus, in Settings, in the note reader and in the note window.

**The search box has the keys first.** When the launcher opens, typing searches; `↑` `↓` move and `Enter`
opens what's highlighted. `Esc` hands the keys to the list: then **one key acts** on the highlighted row, and
`/` or `Tab` gives them back to the search box. A key waits a moment (0.3 s) before it acts: type two keys
within that and they're a search, which goes to the search box. Every menu and list you open starts with the
search box too; reopening the launcher keeps where the keys were. The header shows which: a blinking block
cursor while the search box has the keys, and what the search is limited to (a collection, a tag) in a chip
before it.

| Key (once the list has the keys) | |
|---|---|
| `/` | back to the search box (`Tab` too, where there are no pinned searches or task to change) |
| `↑` `↓`, `j` `k`, `PgUp` `PgDn` | move |
| `1` … `9` | the row with that number (rows show 1–9, counted from the top of what's in view) |
| `Enter` (or `→`) | the highlighted row's main action: a paper's menu, into a collection or a tag, run, read, choose |
| `Shift+Enter`, `z` | open it in Zotero: the paper (its tab or PDF), the collection, the note |
| `t` / `a` | your tasks / a new task (about the highlighted paper, and the note or chat highlighted in its menu) |
| `c` | chat about the highlighted paper (or the one whose menu this is); elsewhere, your chats |
| `.` | Processes: prompt runs and text extractions, running, finished and failed |
| `f` | your saved searches (see [Saved searches](#saved-searches)) |
| `s` (`Ctrl+S` while typing) | save the search the results show |
| `@` (also while typing) | add a filter to the search: a tag, an author, a year, a collection… or an operator |
| `Tab` `Shift+Tab` | (with pinned searches, in the results) the next / previous search badge, even while you type; on a task: its status |
| (an icon on a paper) | it has open tasks (with how many, past one); red when one is overdue |
| `Space` | on a paper: show or hide its notes right under it (`Enter` or `→` reads one; `Space` or `←` on one hides them) |
| `?` | **Keybindings**: every key, by section; type to find one (also *Keybindings* under Go to) |
| `Alt+Backspace` | clear the search box (and give it the keys), from anywhere |
| `;` | Settings |
| `W` (`Shift+w`) | the launcher as a regular window (it stays when you click elsewhere, and tiles like any window); `W` again puts it back as the overlay. Closing the window closes the launcher |
| `o` / `w` | a paper's PDF in your PDF app / in its own Zotero window; a note in its own window |
| `n` / `#` / `x` | a paper's notes / its tags / extract its text |
| `p` / `l` | pin or unpin a paper, a collection or a tag / show it in your library |
| `Shift+↑` `Shift+↓` | move a pinned item (before you type, in *Pinned*) or a note (in a paper's menu) up or down |
| `Alt+→` `Alt+←` | on a paper: its next or previous [status](#paper-status) (saved to Zotero a second later), even while you type |
| `Ctrl+Shift+↑` `Ctrl+Shift+↓` | move the highlighted row's whole section up or down, in any menu or the results; each menu keeps your order |
| `y` / `s` | copy a note as Markdown / save it as a `.md` file in Downloads |
| `e` | edit a prompt (in Prompts) |
| `Esc` | leave the search box; then clear what you typed, then back a level; it closes the launcher only from the top |
| `Shift+Esc` | straight back to the results from anywhere (every level at once); from the results, closes the launcher. Back in the results (or reopening there) with nothing typed, the list has the keys (`/` for the search box) |
| `Backspace` | with nothing typed: back a level |

**Alt keys, if you prefer them**: *Settings › General › How keys act* → *Alt+key*: typing always searches, and
the same letters act with `Alt` (`Alt+C` chat, `Alt+.` processes, `Alt+;` settings, `Alt+O`, `Alt+1`…). *Typing or a
key* sets the wait (100–1000 ms). The Alt keys work in single-key mode too.

In the note reader and the note window there's nothing to type, so the keys act at once: `z` (or
`Shift+Enter`) Zotero, `w` window, `c` chat about the note's paper, `y` copy, `s` save, `m` back to the launcher
(note window), `j` `k` scroll; `Ctrl+-` and `Ctrl++` change the text size. The chat window keeps typing for
your questions: `Alt+M` goes back to the launcher there.

The launcher picks up where you left it: close it and reopen it, and you're back in the same view, menu,
query and row.

### Paper status

A paper's reading status is one of your tags: **to read**, **reading**, **read** to start with (*Settings › Paper
status*: add, rename, remove, `Shift+↑`/`Shift+↓` to reorder). The one a paper has shows as a badge on its row in the
results. In its menu (and its submenus), the top line names the paper ("Sirmon et al., 2007 · Managing Firm
Resources…") and, under it, every status is a pill, *no status* first, the paper's own filled in: `Alt+→` /
`Alt+←` moves along them. On the right of the same line, its journal's rankings in full (ABS, ABDC, FT50, UTD24). *This paper* has a *Status* row too.

`Alt+→` / `Alt+←` on a paper (in the results or its menu) moves it to the next or previous status: none, then
yours in order, round again. The badge changes at once; a second after your last press, Zotero gets the new tag
and loses the old one (so pressing it three times makes one change). Renaming or removing a status only changes
the list: papers keep their tags. Statuses need the Zotero plugin from this version or later.

### Tasks

A to-do list for your research, next to your library. **Tasks** (`t`, or type *tasks*) lists them under their
status, grouped **Backlog**, **Next**, **Active**, **Waiting** and **Completed**; the footer shows a badge per group
with its open tasks.

- **Add one in one line** with `a`: on a paper in the results or in its menu, the task is about that paper; on a
  note or a chat in its menu (or while reading a note), about that note or chat too; anywhere else, about nothing
  in particular (its page can pick a paper later). Type it, with, if you like, `#status` (`#read`, `#waiting`: a
  name's start will do), `!` `!!` `!!!` (or `!low` `!med` `!high`) for the priority and `@fri`, `@tomorrow`,
  `@+3d` or `@2026-10-03` for the due date: `Read the method section #read !! @fri`. The line under it shows what
  it will set. `Enter` adds it and opens its page; `Shift+Enter` just adds it, as it is, and leaves you where you were.
- **`@` in that line** opens a menu of what you can add, each as a block in the line (like the search box's):
  an **action** (*Read*, *Skim*, *Full review*, *Download the PDF*…), the paper's **citation** ("Adner & Helfat
  (2003)"), a **status**, a **due date** (today, tomorrow, end of the week, next Monday, in a week, the month's
  end…) and a **priority**. Type to find one; once a kind is in the line, the menu leaves it out. Actions and the
  citation become words of the description ("Read Adner & Helfat (2003)"); the rest set the task's fields.
- **Or type it in Tasks**: what you type there that isn't a task yet shows as *Add “…”* at the top (the cursor
  stays on the first task it matches, if any); `Enter` on it adds it and opens its page, `Shift+Enter` just adds it.
- **Change a task without opening it**, in Tasks, in a paper's menu or on its page: `Tab` / `Shift+Tab` its status,
  `d` done (again: back to where it was), `!` its priority (none, low, medium, high), `Delete` deletes it (`u`
  brings it back).
- **Its page** (`Enter`) is a form. The **description** and the **notes** are edited right there: on their row,
  just type (the notes take several lines: `Enter` is a new line, `Ctrl+Enter` goes back; `↑` / `↓` leave them from
  their first or last line). **Status** and **priority** show every choice as a pill, the task's filled: on their
  row, `Tab` / `Shift+Tab` move along them (elsewhere on the page Tab does nothing). **Due** opens a calendar:
  arrows move the day, `PgUp` / `PgDn` the month, `Home` today, `Delete` no date, `Enter` picks (or type `fri`,
  `+3d`, `2026-10-03` and `Enter`); a click picks a day too. Then what it's about: the paper (`Enter` opens its
  menu), the note or chat (`Enter` opens it), *Another paper…*, *No paper*, *Delete this task*. `Enter` on the
  description, status or priority keeps it and goes back; every change is saved as you make it (a description or
  notes when you leave the row).
- **Order**: `Shift+↑` / `Shift+↓` moves a task within its status; past the first or last one, into the
  neighbouring status.
- **A paper's menu** lists its tasks under *Tasks*, with *New task…*.
- **Your actions** for `@`: *Settings › Tasks*, under the statuses: add, rename, remove, `Shift+↑` / `Shift+↓` to
  reorder (kept in the settings file as `tasks.actions`).
- **Your statuses**: *Settings › Tasks*. Each belongs to one of the five groups; add one to a group, rename or
  remove one (its tasks move to another of its group), and `Shift+↑` / `Shift+↓` reorders them, across groups
  too. They start as To read and Idea (Backlog), Next, Reading and Writing (Active), Waiting, and Done.

Tasks are kept in `~/.config/omarchy/oma-zotero-launcher/todos.json`; your statuses in the settings file
(`tasks.statuses`).

### Processes, chats and settings

They're a key away from anywhere (once the list has the keys: `Esc`), and typing their name finds them too,
under **Go to** at the top of the results (the cursor still starts on the first paper that matches):

- **Processes** (`.`) is the queue of prompt runs and text extractions, under *Running*, *Finished* and *Failed*; the footer
  always shows how many are running, finished and failed. Running a prompt or extracting
  text keeps the launcher open. `Enter` on a finished task reads the note it made (`Shift+Enter`, `w`,
  `y`, `s` work as on any note); `Esc` comes back to the queue. *Clear finished processes* forgets them
  (the notes stay in Zotero).
- **Chats** (`c`, on anything but a paper) lists your chats grouped by paper, the paper with the newest chat
  first: `Enter` reopens one in its window. *New chat…*
  asks for the paper (search as usual, `Enter` picks it) and opens a chat about it.
- **Settings** (`;`): models and providers, defaults, the launcher's own settings, and what the AI features need
  (see [Settings](#settings)).

### Search

### Collections

As you type, the best three matching collections are listed first, under **Collections**, by their full path
("_Topics / SCM / Public SCM"; the match can be anywhere in it), then the papers.

| On a collection | |
|---|---|
| `Enter` | open it: its subcollections, then its papers and those of its subcollections, newest first (added or changed); type to search inside it |
| `Shift+Enter` | select it in Zotero's library |
| `p` | pin it: pinned collections come first before you type, with the pinned papers |
| `Esc`, `Backspace` | (inside it) back to where you were |

### Tags in the search

Tags work the same way: as you type, up to three tags whose names contain your words are listed under **Tags**
(after the collections), with how many papers carry each; `#` is optional. `Enter` lists that tag's papers,
newest first (type to search among them), `p` pins the tag, and `Esc` goes back.

Search terms (all must match):

| Term | Matches |
|---|---|
| `resil`, `stev resil` | fuzzy, in titles and authors; first authors and whole title phrases rank higher |
| `a:smith`, `t:resilience` | authors only, title only |
| `ta:"supply chain"`, `ab:resilience` | title or abstract, abstract only (in an abstract, the words as written, not fuzzy); `@` › *Title* / *Title and abstract* puts `t:""` / `ta:""` in with the cursor inside |
| `2020`, `y:2019..2021`, `y:>=2020`, `y:<2010` | year (a bare 4-digit term is a year); a range, or compared with `>`, `<`, `=`, `>=`, `<=` |
| `#tag`, `tag:name` | tag |
| `p:journal` (`journal:`) | publication |
| `c:scm` | papers in a collection whose path holds the words, and in its subcollections |
| `type:book`, `has:pdf`, `has:notes`, `has:files` | item type (a prefix: `type:book` is books and book sections); what it has |
| `has:task`, `has:chat`, `has:collection` (`has:list`) | a paper with a task, a chat, in a collection; `!has:…` without |
| `status:reading`, `status:none` | a paper status (*Settings › Paper status*; a name's start will do), or none |
| `task:waiting`, `task:active` | a paper with a task in that status, or in that group (backlog, next, active, waiting, completed) |
| `"exact phrase"` | an exact phrase; quoted, a tag, author, publication, collection or type is the whole name: `#"supply chain"`, `a:"Smith, John"`, `c:"Topics / SCM"`, `type:"book"` |
| `'exact`, `^prefix`, `suffix$` | exact, prefix and suffix matches |
| `!term` | exclude |
| `a \| b` | either |
| `AND`, `OR`, `NOT`, `( )` | boolean search, in capitals: `(#risk OR #resilience) NOT y:..2010`. `NOT` binds tightest, then `AND` (a space does the same), then `OR`; `\|` joins only its neighbours (`a \| b c` is `(a OR b) c`) |

`@` lists what you can add: your tags, authors, publications, years, collections and item types (each with how
many papers it holds; type to find one), *has a PDF, notes or files*, your saved searches, the operators and the
rest of the syntax (`!`, `t:`, `'`, `^`, `$`…; type what one does, like *exclude*, to find it). `Enter` puts its
term in the search where the caret is.

**The search box** shows the operators and each finished term as a block, by what it is: **A:** an author,
**T:** the title, **Y:** a year, **P:** a publication, **C:** a collection, **#** a tag, **Type:**, **Has:**, and
**NOT** before an excluded one. The words you type, and phrases in quotes, stay text, in colour. A term becomes a
block once you finish it (a space, a `)`, or moving on); `Backspace` after a block, or `Delete` before one,
removes it whole, and `←` `→` step over it. `(` and `"` close themselves with the caret inside, typing the
closing one steps over it, and `Backspace` in an empty pair removes both. `←` `→` `Home` `End` move the caret
(`→` at the end still opens the highlighted paper's menu).

### Saved searches

`s` (`Ctrl+S` while typing) saves the search the results show, what you typed within the collection, tag or saved
search you're in (as `c:"…"`, `#"…"` or its search); type a name, or `Enter` names it after the search. *Save and
pin it* makes it a badge right away.

`f` (or *Searches* under Go to) lists them, pinned first:

| On a saved search | |
|---|---|
| `Enter` | open it: its papers, newest first when it only filters; type to search within it |
| `Shift+Enter` | its menu: *Open*, *Pin* / *Unpin*, *Rename…*, *Edit the search…*, *Delete this search* |
| `p` | pin or unpin it |
| `Shift+↑` `Shift+↓` | move it (pinned ones: their badges too) |

In a saved search, the papers (and collections, tags) you pinned that match it come first, under *Pinned*;
anywhere else in the results, a pin marks them. **Pinned searches are badges** above the results, after *All* (your whole library). `Tab` and `Shift+Tab` move
along them, and a click picks one: the results, and what you type, are then within that search. They're kept in
`~/.config/omarchy/oma-zotero-launcher/searches.json`.

### The paper's menu

`Enter` on a paper opens its menu, in sections like the results:

- **Notes**: the paper's notes, newest first (its [extracted text](#extracted-text) among them), or in your
  order (`Shift+↑`/`Shift+↓` moves one); see [Notes](#notes). `n` opens them as a list of their own.
- **Chats**: your chats about the paper, newest first. `Enter` continues one in its window; `Shift+Enter` opens
  its menu: *Open*, *Rename…*, *Delete this chat* (the notes you saved from it stay in Zotero).
- **Prompts and chat**: **Prompts** (see [Prompts](#prompts)), **Chat with the paper** (see
  [Chat with a paper](#chat-with-a-paper)) or, until an AI model is set up, **Set up an AI model** (it opens
  *Settings › Models & providers*), and the text extraction: **Text not extracted** or **Text
  extracted ✓**; `Enter` extracts it, or extracts it again and replaces the note (see
  [Extracted text](#extracted-text)).
- **This paper**:
  - **Pin to the top** / **Unpin**: pinned papers come first before you type, in a *Pinned* section.
  - **Open in Zotero**: its detail says what it does, such as "Switch to its open tab".
  - **Open PDF externally**, in your default PDF app or `externalPdfCommand`; **Open PDF in a new Zotero
    window**, one you can tile. With several files, you pick one; missing files are listed with the reason.
  - **Tags** (see [the tag editor](#tags)), **Show in library**.

Type to filter the menu.

### Notes

The paper's notes, newest first. In a list, `Enter` reads one, `Shift+Enter` opens it in Zotero, `w` in
its own window, `y` copies it as Markdown and `s` saves it as a `.md` file in your Downloads folder
(never over an existing file).

While reading, there is nothing to edit, so the same keys work without `Alt`:

| Key | |
|---|---|
| `z`, `Shift+Enter` | open it in Zotero's note editor |
| `w` | open it in its own window |
| `y` / `s` | copy it as Markdown / save it as a `.md` file |
| `c` | chat about the paper |
| `t` (or `a`) | a new task about this note and its paper |
| select with the mouse | copies the selection to the clipboard as soon as you let go ("Copied 12 words" in the footer) |
| `Shift+↑` / `Shift+↓` | the paper's previous / next note (its notes are listed above the one you read, in your order; a click opens one) |
| `↑` `↓` `j` `k`, `Space` `b`, `PgUp` `PgDn`, `g` `G` | scroll |
| `Ctrl+-` / `Ctrl++` | smaller / larger text (`Ctrl+0`: the theme's size); kept for the next notes, here and in note windows |
| `Backspace`, `Esc` | back |

**The note window** is a normal window: tile it, float it, resize it, keep it next to the PDF. Its header
cites the paper APA 7 style, "Sirmon et al. (2007)", with the title, the journal and its rankings; its top
bar has *Menu* (`m`: back to the launcher, on the paper's menu with this note highlighted), *Zotero* (`z`,
`Shift+Enter`), *Chat* (`c`), *Copy .md* (`y`) and *Save .md* (`s`). Select text to copy a passage
(`Ctrl+C`). `Ctrl+-` and `Ctrl++` change the text size, as in the reader.
Close it like any window (SUPER+W) or with its ✕.

Copies and saved files are the note as Zotero's *Export Note → Markdown* gives it.

### Prompts

> [!NOTE]
> Prompts need the optional [prompt runner](#4-prompts-chat-and-text-extraction-optional) and an AI model
> ([Choosing a provider](#choosing-a-provider)).

The paper's menu → **Prompts** lists them. `Enter` runs one: the model reads the paper and its answer is saved
as a new note on it, usually within a few minutes. It runs in the background, the launcher stays open, and the
run shows in [Processes](#processes-chats-and-settings) (`.`); a notification says when the note is saved.

Two prompts come with it:

- **Literature Review**: overview, research question, theoretical framework, method, findings, contributions,
  limitations and future research, key quotes, connections to your notes.
- **Findings and Takeaways**: the central finding, the key findings with evidence, takeaways, how to cite it,
  key quotes.

With the default [rules](#rules-for-prompts-and-chat), both quote the paper verbatim with APA 7 in-text citations and page numbers, and end with an APA 7 reference
list. The model is given the paper's APA 7 reference (formatted by Zotero), your highlights and comments with
their pages, your existing notes, and the paper's text, and is told never to invent a quote, page or reference.
The note ends with the model that wrote it and a **quote check**: every quotation is looked up in the paper's
text, and any that isn't there word for word is listed, so you know what to verify. Still, check quotes
against the paper before you cite them. When a paper and its notes don't fit a smaller model, the notes are
left out first, then the text is cut from the end, and the note says so.

**Your own prompts.** `e` on a prompt edits it in the launcher: its title, its **model** and **effort**
(dropdowns listing every model your providers offer, grouped by provider, and the effort levels each takes;
*Default model* follows *Settings › Defaults*), and its text, which opens in your editor. *New prompt…* creates
one: type its name and `Enter`, or type **what it should do** ("critique the methods and threats to validity for
my dissertation") and pick *Write it with AI*: your default prompts model writes the title and text, modeled on
the two prompts above and following your [rules](#rules-for-prompts-and-chat), and it opens in the
editor to review. Prompts are Markdown files in `~/.config/omarchy/oma-zotero-launcher/prompts/`:

```markdown
---
title: Methods Critique
model: default
effort: high
---
Critique the paper's method: design, sample, measures, analysis. Quote the passages you discuss,
with APA 7 citations and pages, and end with a "## References" section in APA 7.
```

A model is named `provider:model`: `claude:opus[1m]`, `chatgpt:gpt-5.5`, `openai:gpt-5.5`,
`anthropic:claude-sonnet-5`, `google:gemini-2.5-pro`, `openrouter:deepseek/deepseek-r1`, `ollama:qwen3:8b`, or
`<endpoint id>:<model>` for your own endpoints. A name without a provider is a Claude model (prompt files from
0.1 keep working), and `default` is your default for prompts. A prompt whose model's provider is off runs on
the default, and says so.

From a terminal: `oma-zotero-prompt list`, `run <prompt> --key <item key>` (`--dry-run` shows the model and
what it would get), `new`, `new-ai --describe "what it should do"`, `edit <prompt>`, `set <prompt> --model
ollama:qwen3:8b --effort medium`, `system [--chat]` (the system prompt as sent), `system edit|clear` (your own instructions), `models`, `providers`, `provider-test <provider>`. Runs are
logged to `~/.local/state/oma-zotero/prompts.log`.

#### Rules for prompts and chat

Nothing about quoting, citing or formatting is hard-coded: every prompt run and every chat turn gets the rules
you leave on in **Settings › Rules for prompts and chat**, a checklist (`Enter` turns one on or off):

- **Grounded in the paper**: answer from the paper; say when it doesn't cover something; label your own
  reading and general knowledge; never invent quotes, pages or references.
- **Academic rigor**: claims no stronger than the evidence; say when the evidence limits a claim.
- **Citations (APA 7)**: in-text citations for everything taken from the paper; verbatim quotes with their page;
  the works the paper cites, cited as it cites them.
- **References (APA 7)**: end with an APA 7 reference list; nothing added to its entries.
- **Format**: Markdown; only the note (prompts); concise answers (chat).

All are on to start with; the settings file keeps only what you change (`"rules": { "concise": false }`), and
*Reset the rules to the defaults* clears that. Below the rules, *Write your own instructions* opens
`~/.config/omarchy/oma-zotero-launcher/instructions.md` in your editor: they're added after the rules, and win
where the two differ (e.g. "Use Harvard style"). `oma-zotero-prompt system` (or `system --chat`) prints exactly
what the model is told.

### Chat with a paper

> [!NOTE]
> Chat needs the optional [prompt runner](#4-prompts-chat-and-text-extraction-optional) and an AI model
> ([Choosing a provider](#choosing-a-provider)).

The paper's menu → **Chat with the paper** opens a chat window: a normal window you can tile next to the PDF.

- **Grounded in the paper.** The model gets the paper's text (its [extracted text](#extracted-text) when you've
  saved it, page by page; else the PDF, read when you ask), its APA 7 reference, your highlights and your
  notes. Answers quote the paper verbatim with APA 7 citations and page numbers, e.g.
  "(Sirmon et al., 2007, p. 282)", and say when something isn't in it. The line under the top bar says what
  the chat is grounded in; *Extract text* there saves the text first.
- **Extracted or not.** The line under the top bar says whether the paper's text is extracted, with
  *Extract text* when it isn't, and **Ground in: .md / PDF** chooses what new chats read: the extracted text
  (the page-numbered `.md` note) or the PDF, read fresh. A chat keeps the source it started with, so
  switching starts a new chat.
- **Past chats** are in a list on the left, collapsed at first: `☰` shows or hides it. Click one to continue it, and rename it with its ✎
  (or a double-click). Each chat keeps its
  context: follow-up questions build on the earlier answers. Closed chat windows reopen from the paper's
  menu or from **Chats** in the launcher.
- **Context window.** The banner shows how much of the model's context the chat uses (*context 32k / 200k*).
  Before a question would fill it, the earlier questions and answers are summarized (their quotes and pages
  kept) and the chat goes on with the paper in full, that summary and the last two exchanges verbatim; a
  line in the chat marks where. Long papers are cut to fit smaller models.
- **Under each answer**: the model that wrote it, what it cost (on a paid API), and the **quote check**: ✓ when
  every quotation was found in the paper, ⚠ with the ones that weren't.
- **New chat ▾**: about this paper, or *about another paper…*, which searches your library and switches the
  window to the paper you pick.
- **Prompts ▾** (next to the model, under the question): one of your prompts (*Literature Review*, *Findings and
  Takeaways*, your own) into the question box, to edit or send as it is.
- **Outputs.** Under every answer: *Copy* (Markdown), *Save to Zotero* (a note on the paper, tagged
  `oma-chat`) and *Download* (a `.md` file in Downloads). The top bar does the same for the whole chat.
- **Back to the launcher.** *Menu* in the top bar (`Alt+M`) opens the launcher on the paper's menu, with *Chat
  with the paper* highlighted; the chat window stays open.
- **Keys.** `Enter` sends, `Shift+Enter` starts a new line, `Esc` stops an answer (or closes a menu; so does a
  click elsewhere). The model and effort (the button under the question) come from the same list as the
  prompts', grouped by provider; *Default* follows *Settings › Defaults › Chat*. A chat can switch models, and
  providers, between questions: the new model gets the conversation so far.

Chats are kept in `~/.local/state/oma-zotero/chats/`, one folder per paper.

### Artifacts: diagrams, mind maps, images, pages

A prompt makes a Zotero note by default. In the prompt editor, **Makes** picks something else:

| Makes | What the model writes | How it opens |
|---|---|---|
| Markdown file | a `.md` document | a page in your browser; the `.md` file is next to it |
| HTML page | one self-contained page (no scripts) | your browser |
| Diagram | [Mermaid](https://mermaid.js.org): flowchart, sequence, timeline, quadrant… | drawn in your browser |
| Mind map | a Markdown outline | [markmap](https://markmap.js.org), folds and unfolds |
| Image | SVG | your browser; labels stay sharp and spelled right |

*Write it with AI* picks one too when you describe, say, "a mind map of the theory". A **chat** makes them when you
ask ("draw the process as a diagram"), and changes them ("make the map deeper", "left to right"): each answer's
artifact is a link in the chat, and the chat's sidebar (☰) lists the paper's artifacts; ✎ on one asks for a change.

The paper's menu lists them under **Artifacts**: `Enter` opens one; `Shift+Enter` shows **Change it with AI…**
(type what to change: a new version, from the paper and the current one, in Processes), **Edit it yourself** (its
source in your editor), **Undo the last change**, **Rename…**, **Show the folder** and **Delete it**.

How it's built, and why:
- **Text formats a model writes well**, drawn by the browser: Mermaid, a Markdown outline, SVG, HTML. No image
  generator: they misspell labels and invent detail, which a figure you'll cite can't have.
- **Checked before it's saved**: a diagram's first line must name its type and its labels be quoted, an image must
  be one SVG with a viewBox, a mind map needs a centre and branches; when something is wrong, the model is told
  what and asked once more.
- **Planned, then drawn**: the model first writes a brief from the whole paper (the core message, the concepts
  and how they relate, the numbers that matter and where they are, the takeaways, one visual idea), then draws
  from the brief. *Read the brief* in the artifact's menu shows it; *Plans it first* in the prompt editor turns
  it off (`brief: off`) for a quicker, single pass.
- **Images measured where they'll be seen**: an image is laid out in a headless Chromium (the one Omarchy ships,
  or Chrome, Brave, Edge, Vivaldi; `OMA_ZOTERO_BROWSER` picks one, `none` turns it off) with your fonts, and
  every label is checked against the others, the lines, the shapes' edges and the canvas. The model gets the
  list with positions for its one retry; what's left, small moves fix (a label with its badge), and a line
  that still runs through a label passes behind it, under a halo. Without such a browser, or where its
  sandbox can't start (Ubuntu 23.10 and later block it for browsers without an AppArmor profile; the log says
  so), the layout is estimated from the text instead.
- **Nothing runs or calls out**: scripts, event handlers and outside links are taken out of what the model
  writes (it read a paper that could say anything), and every page carries a policy that blocks scripts (the
  diagram and mind map libraries aside) and the network.
- **Offline**: the diagram and mind map libraries (Mermaid 12, markmap, d3) are fetched once, checked against
  pinned SHA-256 sums, into the artifacts folder's `.lib/`. Until then a page shows the diagram's text.
- **Every version kept**, so a change you don't like is one *Undo* away.
- **The paper's rules apply**: grounded in the paper, citations in the nodes they support; *Settings › Rules*
  has a references rule for artifacts that have room for a list.

They live in **Settings › General › Artifacts folder** (default `~/.local/state/oma-zotero/artifacts`), a folder
per paper (`sirmon-et-al-2007_1-ABCD1234/`), one per artifact inside: its versions (`v1.mmd`, `v2.mmd`…), the
current one (`orchestration-flow.mmd`) and its page (`orchestration-flow.html`). Point it at a synced folder to
keep them with your research.

From a terminal: `oma-zotero-prompt artifacts --key <item key>` (or `--all`), `artifact-edit --key K --id A
--instruction "…"`, `artifact-undo`, `artifact-rename --title T`, `artifact-delete`, `artifact-libs` (fetch the
libraries), and `set <prompt> --output mindmap`.

### Extracted text

In the paper's menu, `Enter` on **Text not extracted** saves the PDF's text as a note on the paper, with
`pdftotext`: one section per page, headed with the page number the journal printed on it ("p. 275"), or else
the item's page range, or else the PDF's page numbers. The note is tagged `oma-fulltext`, and it's listed with the
paper's notes. Once it exists, the row reads **Text extracted ✓** with the date; `Enter` then extracts the text
again and replaces the note (the old one goes to Zotero's trash, where you can restore it).

With *Settings › Defaults › Extract the text first* on, a chat or a prompt on a paper without it extracts it
first (the chat window as it opens), so every answer can cite pages. The extraction row shows *Extracting…*
while it runs and switches to *Text extracted ✓* when it's done.

Chats and prompts use this note when it's there, so their quotes carry the right page numbers; without it they
read the PDF each time (and, without `pdftotext` or a PDF, Zotero's own full-text index, which has no page
numbers). A scanned PDF with no text layer can't be extracted. Very long papers are cut to stay within
Zotero's note size (about 240,000 characters).

From a terminal: `oma-zotero-prompt extract --key <item key>` (`--force` extracts again).

### Tags

Every tag in the paper's library: its own tags first and checked, colored tags in their color, how many
papers use each, `auto` on automatic ones. Type to find one, `Enter` adds or removes it; a new name gets a
*Create tag* row (`Ctrl+Enter` adds exactly what you typed). Edits go through Zotero, so *Edit → Undo* in
Zotero reverts them.

### Journal rankings

Papers from ranked journals show labels on the right of the results and in the note window:

- **ABS 1** to **ABS 4\***: the Chartered ABS [*Academic Journal Guide* 2024](https://charteredabs.org/academic-journal-guide/academic-journal-guide-2024).
- **ABDC C** to **ABDC A\***: the Australian Business Deans Council [*Journal Quality List*](https://abdc.edu.au/abdc-journal-quality-list/) (2025).
- **FT50**: the Financial Times research journal list.
- **UTD24**: the UT Dallas list.

On a result they're compact: the list's first letter and the grade (**A 4\*** for ABS 4\*, **D A** for ABDC A, **F** for
FT50, **U** for UTD24); the note window spells them out.

Journals are matched by ISSN, else by name or abbreviation. The top grades (ABS 4 and 4\*, ABDC A and A\*,
FT50, UTD24) are highlighted.

## Choosing a provider

Prompts and chat run on the model you choose. Set it up in the launcher: **Settings › Models & providers**.
Each provider's page has **Test connection** (it lists the models, or says exactly what's wrong), its key,
what leaves your computer and what it costs; **Use for prompts and chat** makes one of its models the default.

| If you have… | Provider | How | Cost |
|---|---|---|---|
| a Claude Pro or Max plan | **Claude (subscription)** | [Claude Code](https://docs.claude.com/en/docs/claude-code), signed in (`claude`, then `/login`) | in your plan (its usage limits) |
| a ChatGPT Plus, Pro or Team plan | **ChatGPT (subscription)** | the [Codex CLI](https://github.com/openai/codex) (`npm i -g @openai/codex`), signed in with ChatGPT (`codex login`) | in your plan (its usage limits) |
| an API key | **OpenAI API**, **Anthropic API**, **Google Gemini API** | copy the key, then *Set the API key from the clipboard* | per token |
| one key for many models | **OpenRouter** | the same, with an [OpenRouter key](https://openrouter.ai/settings/keys) | per token; some models are free |
| nothing to pay | **Gemini's free tier**, **OpenRouter's free models** | an API key as above | free, with limits |
| papers that must stay private | **Ollama**, on your computer | `omarchy pkg add ollama`, then `ollama pull qwen3:8b` | free (your hardware) |
| your institution's gateway, LM Studio, vLLM, llama.cpp | **OpenAI-compatible endpoint** | *Add an OpenAI-compatible endpoint…*: a name, its base URL, a key if it needs one | the endpoint's |

- **Keys** go to your system keyring (the Secret Service Omarchy unlocks at login), never to a file: copy the
  key, then `Enter` on *Set the API key from the clipboard*; the key goes straight from the clipboard to the
  keyring, and the clipboard is cleared. Keys in the environment work too (`OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`).
- **Which model?** A paper is often 30–60k tokens: pick a model with a large context (the pickers show each
  model's, and flag small ones). Small local models (under ~8B) quote less faithfully; the quote check shows
  it. On a paid API, a provider's page estimates what a run costs.
- **Defaults** (*Settings › Defaults*): the model and effort for prompts and for chat, and a **fallback model**
  that answers when the first one fails (the answer says so).
- **Local models** read slowly on a CPU: a whole paper can take minutes before the first word. Ollama's page
  has a *Context size* to cap how much the model reads (and the memory it takes).

## Settings

In the launcher: **Settings**, `;` once the list has the keys, or type *settings* (or `omarchy-shell oma-zotero-launcher
settings`). *General* holds the launcher's own settings; *Models & providers* and *Defaults* the AI's (above);
*Setup* is the checklist,
in the order you'd do it, each step with its state and, where the launcher can do it, `Enter` to do it:
install Zotero (10 or newer; `Enter` opens zotero.org), start it, the Zotero plugin (downloads the latest `.xpi`, checked against its SHA-256, to Downloads,
starts Zotero and shows the three clicks that install it; the same when it's older than the launcher), the
keybinding and the open-from-the-middle rule (added to `~/.config/hypr/bindings.lua`, backed up first and undone
if Hyprland complains; a SUPER+SHIFT+Z already in use is left alone), Node.js and `pdftotext` (their install
commands, run in a terminal), the AI features, a model, and the keyring. When Zotero or its plugin isn't
working, the launcher's results show those first steps instead of an empty list. Every change is checked and
saved at once; a value that isn't valid is refused, and the footer says why.

The file is `~/.config/omarchy/oma-zotero-launcher.json`, in sections. You can edit it by hand too; an invalid
setting falls back to its default, and the launcher's footer names it. A file from before sections (the
general settings at the top level) still works, and moves into `general` the first time Settings saves.

```json
{
  "general": {
    "enterAction": "reader",
    "externalPdfCommand": ["zathura"],
    "maxResults": 60,
    "accelerators": true,
    "keys": "single",
    "keyDelay": 300,
    "emptyQuery": { "showOpen": true, "tabOrder": "mru", "recent": "latest", "recentLimit": 15 },
    "port": 23119,
    "promptCommand": ["oma-zotero-prompt"],
    "zoteroCommand": ["zotero"]
  },
  "providers": {
    "claude": { "enabled": true },
    "ollama": { "enabled": true, "baseURL": "http://localhost:11434/v1", "context": 32768 },
    "compatible": [{ "id": "lab", "name": "Lab gateway", "baseURL": "https://gateway.example.edu/v1", "enabled": true }]
  },
  "defaults": {
    "prompts": { "model": "claude:opus[1m]", "effort": "high" },
    "chat": { "model": "ollama:qwen3:8b", "effort": "" },
    "fallback": "openrouter:deepseek/deepseek-r1"
  }
}
```

Without a `providers` section, Claude is used through Claude Code, as in 0.1. The general settings:

| Setting | |
|---|---|
| `enterAction` | `"reader"` (default): Shift+Enter opens the paper's PDF in Zotero's reader if it isn't open. `"select"`: it only selects the paper in your library. |
| `externalPdfCommand` | Open PDFs in this app instead of your default one. |
| `maxResults` | Results per search, 10–200 (default 60). |
| `keys` | `"single"` (default): once you leave the search box (`Esc`), one key acts; `"alt"`: typing always searches, and keys act with `Alt`. |
| `keyDelay` | Milliseconds a single key waits to tell it from typing, 100–1000 (default 300). |
| `accelerators` | `false` turns off the paper keys (`o`, `w`, `n`, `#`, `p`, `l`) in the results. |
| `emptyQuery.showOpen` | List the papers open in Zotero before you type (default `true`). |
| `emptyQuery.tabOrder` | How the papers open in Zotero are listed before you type: `"mru"`, the one you used last first (default); `"tabbar"`, in the order of Zotero's tabs. |
| `emptyQuery.recent` | Then the most recent papers: `"latest"` (default; each paper by the newer of when it was added and when it was last changed), `"added"`, `"modified"`, or `"none"`. |
| `emptyQuery.recentLimit` | How many of those, 0–50 (default 15). |
| `port` | Zotero's HTTP port, if you changed it (default 23119). |
| `zoteroCommand` | How to start Zotero (default `["zotero"]`), for example `["flatpak", "run", "org.zotero.Zotero"]` or a path. |
| `promptCommand` | How the launcher starts the AI features' runner, only needed if `oma-zotero-prompt` isn't on your `PATH` (for example `["node", "/path/to/daemon/bin/oma-zotero-prompt.mjs"]` for a runner you run from a checkout). |

### Files

| Path | |
|---|---|
| `~/.config/omarchy/oma-zotero-launcher.json` | settings |
| `~/.config/omarchy/oma-zotero-launcher/pins.json` | pinned papers and collections |
| `~/.config/omarchy/oma-zotero-launcher/prompts/` | your prompts |
| `~/.local/share/oma-zotero-launcher/runner/` | the prompt runner |
| `~/.cache/oma-zotero-launcher/models*.json` | each provider's model list, refreshed daily |
| `~/.local/state/oma-zotero/context-windows.json` | the context windows models reported |
| the system keyring (service `oma-zotero-launcher`) | your API keys |
| `~/.local/state/oma-zotero/prompts.log` | prompt, chat and extraction runs |
| `~/.local/state/oma-zotero/chats/` | chats, one folder per paper |
| `~/.local/state/oma-zotero/tasks/` | the task queue (`tasks.json` is its index) |
| `$XDG_RUNTIME_DIR/oma-zotero/bridge.json` | the bridge's port and token (0600) |

## Privacy and security

- The bridge adds routes under `/oma-zotero/` to Zotero's own local HTTP server (127.0.0.1). Every request
  needs a token only your user can read, and requests from web pages are refused.
- The launcher changes your library only when you ask it to: tags, and notes the prompts create.
- **Prompts and chat send the paper to the provider you chose**: when you run a prompt or ask a question, the
  paper's metadata, its text, your highlights and your notes on it go to that provider (Anthropic for Claude,
  OpenAI for ChatGPT and the OpenAI API, Google for Gemini, OpenRouter and the model's host, or your
  endpoint's owner), under its terms; each provider's page in Settings says which. With **Ollama** (or an
  endpoint on your computer), nothing leaves it. Extracting text is always local.
- **Only the paper, not your files.** The two subscriptions run agents (Claude Code, Codex), and a paper's text
  could carry instructions. Claude's runs with no tools. Codex's commands run in a sandbox that can read only the
  system and Codex's own files (not your home or any other file; with a codex of your own, `OMA_CODEX_BIN`, the
  binary and its helpers file by file, never the folder it sits in), with no writes and no network; its tools that would
  act outside that sandbox (images read from disk, MCP servers, apps, plugins, hooks, a browser, other agents) are
  off. A paper that tells the model to read your files gets "No such file"
  (`tests/codex-paper-only.test.js`).
- **Answers load nothing by themselves.** A model's answer is Markdown, and a paper could steer it into an image
  whose URL carries text out as soon as it's shown. So before an answer is shown in the chat window or saved as a
  note, its images become plain links (they open only when you click them) and raw HTML tags show as text: an
  invisible zero-width space goes between `!` and `[`, and after a `<` that would open a tag, so neither can
  form anywhere, code included, and nothing visible changes (`tests/safe-markdown.test.js`).
- **API keys** stay in your system keyring; the launcher reads one from the clipboard straight into it and
  never writes a key to a file.

## Troubleshooting

| The launcher says | |
|---|---|
| *Install the Zotero plugin* | `Enter` downloads it and shows the three clicks in Zotero ([step 1](#1-the-zotero-bridge)); restart Zotero after installing it. |
| *Zotero isn't running* | Press `Enter` to start it. |
| *Zotero rejected the bridge token* | Restart Zotero. |
| *oma-zotero-prompt isn't installed* | *Settings › Setup › Install AI features* ([step 4](#4-prompts-chat-and-text-extraction-optional)). |
| *Set up an AI model* | *Settings › Models & providers*: turn a provider on ([Choosing a provider](#choosing-a-provider)). |
| *pdftotext isn't installed* | `omarchy pkg add poppler` |
| *the PDF has no text layer* | It's a scan: run OCR on it first (for example `ocrmypdf`), then extract again. |

A prompt that fails says why in a notification (and in Processes); `~/.local/state/oma-zotero/prompts.log` has the
details. A provider's **Test connection** says what's wrong with it:

| Provider | Test connection says | |
|---|---|---|
| Claude (subscription) | *Claude Code isn't installed* / *didn't answer* | Install Claude Code, then `claude` and `/login`; a usage limit shows in `claude` too. |
| ChatGPT (subscription) | *not signed in* / *signed in with an API key* | `codex login` with your ChatGPT account (`codex logout` first if it uses a key). |
| OpenAI, Anthropic, Gemini, OpenRouter | *no API key* / *the API key was refused (401)* | Set the key again from the clipboard (a fresh one from the provider's page), or check the environment variable. |
| any API | *rate limited or out of credit (429)* | Wait, or add credit with the provider; set a fallback model in Defaults. |
| Ollama | *isn't answering* / *has no models* | `omarchy pkg add ollama`, start it (`ollama serve`, or its service), then `ollama pull qwen3:8b`. |
| an endpoint | *can't reach …* / *answered 404* | Check the base URL ends where its `/models` lives (usually `/v1`), and its key. |

Include what Test connection says when you [report an issue](https://github.com/mbradaschia/oma-zotero-launcher/issues).

## Development

```bash
make help         # every target
make test         # unit tests (Node)
make lint         # JavaScript, QML and shell syntax
make bridge-link  # load zotero-bridge/ unpacked into Zotero (quit Zotero first), with dev routes
make bridge-reload  # reload the bridge's code without restarting Zotero
make dev          # sync the Omarchy plugin on every change (QML changes: make plugin-reload)
make e2e          # end-to-end, in the live shell and Zotero (Settings included)
OMA_LIVE_PROVIDERS=claude:haiku,ollama:qwen3:8b OMA_SMOKE_KEY=<item key> make providers-smoke
                  # live: one grounded answer per model, checked for a quote and a page (opt-in, never in CI)
```

The providers' unit and contract tests (`tests/providers.test.js`) run against fakes, with no keys or network;
they need the runner's packages (`npm ci --prefix daemon`).

The live tests (`make e2e`, `make smoke`, `make fresh-install`) put everything back: Zotero's tabs and
selection, your focused window, the clipboard, settings and your installed plugin. The launcher takes the
keyboard while they run, so don't type. Only `make e2e-write` and `make smoke-write` edit your library: they
add and remove the tag `oma-zotero-test` on one paper.

| Path | |
|---|---|
| `ZoteroSearch.qml`, `NoteWindow.qml`, `Service.qml`, `lib/` | the Omarchy plugin |
| `zotero-bridge/` | the Zotero plugin (built into the `.xpi`) |
| `ChatWindow.qml` | the chat window |
| `daemon/` | the prompt runner (`oma-zotero-prompt`): prompts, chat, text extraction; `daemon/lib/providers/` holds one module per provider (Claude Agent SDK, Codex SDK, the Vercel AI SDK, Ollama) |
| `scripts/` | build, release, rankings update and live tests |
| `tests/` | unit tests |

`PLAN.md` has the design; `spikes/` the measurements behind it.

## Releases and versioning

The project follows [Semantic Versioning](https://semver.org): the Omarchy plugin, the Zotero bridge and the
prompt runner share one version (`make version`). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

To release, add the changes under *[Unreleased]* in the changelog, then on `master`:

```bash
make release VERSION=1.2.0
git push origin master v1.2.0
```

`make release` sets the version everywhere, dates the changelog, runs the tests, builds the `.xpi` and
`zotero-bridge/updates.json`, commits and tags. The pushed tag runs the [release workflow](.github/workflows/release.yml),
which rebuilds the `.xpi` from the tag, checks it is byte-identical to the one `updates.json` describes (the
build is reproducible), and publishes the GitHub release with the `.xpi`, its SHA-256 and the changelog
notes. Installed bridges then update themselves, and `omarchy plugin update` brings the launcher to `master`.

The journal lists come with the bridge: `scripts/update-rankings.sh` downloads them again.

### The Omarchy Plugin Marketplace

The launcher is listed in the community [Omarchy Plugin Marketplace](https://plugins.omarchy.org/#catalog)
([its repository](https://github.com/omacom/omarchy-plugin-marketplace)). The listing reads this repository:
`manifest.json` (id, name, version, author, description, kinds, entry points), this README (install and
removal), `LICENSE` and `preview.png` (the card image, resized by the marketplace).

- **First listing**: the repository must be public. Open a *[Plugin]: Zotero Launcher* issue with the
  [submission form](https://github.com/omacom/omarchy-plugin-marketplace/issues/new?template=submit-plugin.yml)
  (category *Productivity*; tags `launcher`, `ai`, `education`) or from the CLI as its
  [SUBMISSION.md](https://github.com/omacom/omarchy-plugin-marketplace/blob/main/SUBMISSION.md) describes.
  Automated validation and a static security baseline run on the exact commit; a maintainer then approves it.
  Expect *review required* rather than *passed*: the runner's installer (`scripts/install-runner.sh`)
  and the CI workflow's package install are reported as capabilities for a maintainer to accept.
- **After each release**: the marketplace notices a newer commit and shows *Update unverified* until you ask
  it to verify the new one with the
  [verification form](https://github.com/omacom/omarchy-plugin-marketplace/issues/new?template=verify-plugin.yml)
  (*Verify and publish a newer upstream commit*: the plugin id `io.github.mbradaschia.oma-zotero`, this
  repository's URL and the release commit's full SHA).
- The plugin id is permanent there: never change `id` in `manifest.json`.

## Roadmap

- More providers as users ask: Mistral, xAI and DeepSeek directly; Azure OpenAI, Amazon Bedrock, Google Vertex
  ([the plan](PLAN-providers.md), phase 6).
- Summarize-then-answer, for papers too long for a small model's context.
- Tag papers in Zotero with their journal rankings.

## Credits

- Journal rankings: the Chartered Association of Business Schools' *Academic Journal Guide* 2024, the
  Financial Times research list (FT50) and the UT Dallas list (UTD24), from the snapshots in
  [wosaide-journal-lists](https://github.com/wosaide/wosaide-journal-lists); the Australian Business Deans
  Council's [*Journal Quality List*](https://abdc.edu.au/abdc-journal-quality-list/), from its official
  workbook. The lists remain their publishers'.
- Built on [Zotero](https://www.zotero.org), [Omarchy](https://omarchy.org) and its
  [Quickshell](https://quickshell.org) shell, the
  [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview), the
  [Codex SDK](https://github.com/openai/codex/tree/main/sdk/typescript), the [Vercel AI SDK](https://ai-sdk.dev)
  and [Ollama](https://ollama.com).

## License

[MIT](LICENSE)
