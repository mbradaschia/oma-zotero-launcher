# The Mac app's UX conventions

What every view follows, settled by the first UX consistency review (after phase 6a) and pinned by
`ZoteroLauncherTests/ConsistencyTests.swift`. The reviewer (`.claude/agents/ux-consistency-reviewer.md`)
checks new phases against this page. Where the Mac differs from the Omarchy launcher on purpose, it
says so.

## Keys

- **Notation: the Mac's.** Modifiers are symbols everywhere a key is written (hints, flashes,
  placeholders, settings rows): ⌥ ⇧ ⌃ ⌘. Named keys are lowercase words or symbols: esc, tab, del,
  pgup, pgdn, home, ↵, ⌫, ↑↓, ←→. Examples: `⌥→← status`, `⇧⌥→← task`, `⌘V paste`, `⌘-/+ size`,
  `⌃↵ new tag`, `⌃⇧↑↓ moves the section`. The view logic's own texts ("Alt+→", "Shift+↑↓") go
  through `Glue.macKeys` before Swift shows them.
- **A single key is written by `keyName`, never literally:** `t` in single-key mode, `⌥t` in Alt
  mode, a capital as `⌥⇧W` (Option+Shift and a letter reach that capital's action).
- **Mac keys beside the QML's:** ⌘V pastes as Ctrl+V does; ⌘S saves a search as Ctrl+S does;
  ⌥⌫ deletes a word in both modes (the QML's Alt+Backspace cleared the box: Ctrl+U does that).
- **Hints:** the help key first (`? keys`, or `F1 keys` while typing; always `? keys` in the
  reader); `/ search` first only where `/` gives the box the keys; then key and a lowercase verb
  (`↵ open`, `p pin`); the back keys last (`⌫ esc back`, `⇧esc home`; `esc close` at the top).
- **Places in the hints** are the ones the Mac has; a place of a later phase isn't hinted (its
  key still says it isn't on the Mac yet).
- **Which keys act where:** a paper's letters (o, w, n, #, p, l, z) act only in the paper's own
  views (`paperViews`: its menu and what opens from it), never on a paper left behind; a note's
  keys (w, y, s, z, ⇧↵) wherever the highlighted row is a note (a menu, Notes, Processes); on a
  page whose rows are fixed (a task's page, the prompt editor) a letter that does nothing types
  nothing.
- **Rows' own texts** follow the notation too: modifiers as symbols with ↵ (`⇧↵`, `⌃↵`), a bare
  "Enter" stays a word in a sentence. Every Glue wrapper that returns the launcher's rows passes
  through `macKeys` (settings rows whole; a menu's, tags', prompts' details), never a note's, a
  task's or a chat's own text.

## Words

- **The AI features** are named that way (never the runner, the prompt runner or
  oma-zotero-prompt), and the place is *Settings › Setup*.
- **Names:** a *task* is a to-do, a *process* is a runner job; a *saved search*; a *paper*, not
  an item; the *Zotero Omarchy Bridge*; the *Keychain* (not a keyring) on the Mac; *Homebrew*
  commands (`brew install …`), copied for Terminal, where Omarchy runs `omarchy …`.
- **Not on the Mac yet**, one shape: `Not on the Mac yet: chat (c) comes in a later version`
  (`notYet(what, key:)`); a page: `Not on the Mac yet: this page comes in a later version`.
- **Flashes:** sentence case, no final period; `Not saved: why`, `Couldn't <verb> “X”: why`,
  `Now: <status>`; curly quotes around names; paths with `~`.
- **The sync folder away**, one sentence (after `Not saved: `): `the sync folder ~/Sync isn't
  there: what's synced stays as it was until it's back (Settings › General)`. A damaged file is
  named by its path: `~/…/pins.json isn't valid: not changed, so your pins aren't lost …`.
- **Settings the Mac doesn't read aren't offered** (General's PDF app and Zotero command: the Mac
  opens both through Launch Services).

## Placeholders and the context bar

- `‹ Place · what to type`; Settings pages `‹ Settings › Page` (a provider:
  `‹ Settings › Models & providers › OpenAI`). Every view under a paper's menu is in `paperViews`,
  so the bar reads `paper  ›  view`. The bar shows the part before
  ` · `, the box the last part when it starts with type/pick/choose/name/↵.
- Pages whose rows are fixed (a task's page, the prompt editor) ignore typing, and the box says
  what does work there (`↵ on a row changes it`).

## States

- **An empty list says what happened and what to do**, with Enter doing what it says (Zotero not
  installed or its plugin missing: Settings › Setup; Zotero not running: start it).
- **The footer doesn't repeat** what an empty list already says; every list view has its own
  empty state, and the count never contradicts the list.
- **Unavailable rows** hint only the row keys and back, never `↵ verb`.
- **Rows of a later phase on a page the Mac has** are shown unavailable, their detail
  `Not on the Mac yet: this comes in a later version`.
- **A failure after the launcher closed** (a PDF, a note in Zotero, a sync, an editor that didn't
  open) goes through `notify`: said when it opens next (the QML posts a notification).
- **The sync folder away:** the runner's writes (prompts, your instructions) are refused with the
  same sentence as the app's own, and nothing is made inside the sync folder while it's away.
- **Counts beside the box** as the QML has them (results with their grouping, Tasks
  `3 open · 12 tasks`, notes, the reader's date, tags, styles, models, `…` while loading).

## Pills

Three ways, as the QML: **on** (filled: the one chosen), **tag** (a tinted outline: something the
paper has, its status, its extracted text), **off** (faint: a choice, a rank); each in its kind's
colour (status orange, priority red, rank purple, taxonomy teal, task green, else the accent); in
white on a selected row.

## Known gaps

- The empty states have no icons yet (the QML's are Nerd Font glyphs; the font waits for its
  download, phase 3b's note).
- The results' "· N items" at the top level needs the bridge's GET `/ping`, which the Mac's client
  doesn't make yet.
