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
- **Mac keys beside the QML's:** Home and End go to a list's first and last row (the box's caret takes them while
  you type there); ⌘V pastes as Ctrl+V does; ⌘S saves a search as Ctrl+S does;
  ⌥⌫ deletes a word in both modes (the QML's Alt+Backspace cleared the box: Ctrl+U does that).
- **Hints:** the help key first (`? keys`, or `F1 keys` while typing; always `? keys` in the
  reader; none in the keys view itself); `/ search` first only where `/` gives the box the keys; then key and a lowercase verb
  (`↵ open`, `p pin`); the back keys last (`⌫ esc back`, `⇧esc home`; `esc close` at the top).
- **Places in the hints** are the ones the Mac has; a place of a later phase isn't hinted (its
  key still says it isn't on the Mac yet).
- **Which keys act where:** a paper's letters (o, w, n, #, p, l, z) act only in the paper's own
  views (`paperViews`: its menu and what opens from it), never on a paper left behind; a note's
  keys (w, y, s, z, ⇧↵) wherever the highlighted row is a note (a menu, Notes, Processes); on a
  page whose rows are fixed (a task's page, the prompt editor) a letter that does nothing types
  nothing.
- **An on/off checkbox hints `↵ change`** (a setting, a rule, a prompt on new papers, the
  editor's Plans it first and Run on new papers); `↵ choose` is for picking one of several.
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
- **Flashes for what you start:** `On: <what now happens>`, `Off: <what stops>`, `Started: …`,
  `Stopped: …` (and what still finishes); a job's end is one sentence, `X is done: 2 done, 1
  failed (in Processes)`. Background runs keep the runner's own notifications (no `--quiet`);
  the launcher's flashes are for what you started.
- **Places:** `Settings › Page › Row`, never a page's section (`Settings › General › Automation
  runs on`, `Settings › Defaults › Prompts to run on new papers`).
- **One machine's setting** (automationHost): every row that turns on what only that machine runs
  ends `· on “X”, the machine automation runs on`, its flash says `on “X”`, and Defaults says
  where new papers are handled, naming this machine (`this machine is “Y”`); General shows this
  machine's real name.
- **One setting, one label** on every page it shows on (`Tag new papers by taxonomies`).
- **The sync folder away**, one sentence (after `Not saved: `): `the sync folder ~/Sync isn't
  there: what's synced stays as it was until it's back (Settings › General)`. A damaged file is
  named by its path: `~/…/pins.json isn't valid: not changed, so your pins aren't lost …`.
- **Settings the Mac doesn't read aren't offered** (General's PDF app and Zotero command: the Mac
  opens both through Launch Services).

- **Deleting your content:** the question `Delete the <thing> “T”?`, the answers `Delete it (to Zotero's trash)`
  and `Keep it`, a detail saying how to undo it; afterwards `The <thing> is in Zotero's trash`, and every view
  that showed only that thing is left (the reader, its menu, its window). `del delete` is hinted wherever Delete
  acts, after the row's letters, before `/` and back; the keys view writes `del` too.
- **Deleting what isn't in Zotero** (a chat, an artifact): `Delete the <thing> “T”?`, `Delete it (<what goes>)` /
  `Keep it`, a detail saying what stays or that it can't be undone; afterwards `Deleted the <thing> “T”`, and its
  window leaves it (a chat window starts anew). Failures name it: `Couldn't delete “T”: why`.
- **The missing AI features**, one shape: `<what> needs the AI features: Settings › Setup installs them`.
- **Windows** (a note's, a chat's) say what a key did in their own footer or top bar, never through the hidden
  launcher; their keys panel lists their keys in the Mac's notation (↵ ⇧↵ esc ⌥M F1 ? ⌘W).
- **The submenu arrow (›)** is on a row exactly when Enter on it opens another list in the launcher: results (a paper,
  a collection, a tag, a note under a paper, a Go to place with a view) and menus alike, drawn by one `SubmenuArrow`.
  Not on rows that act at once or ask first (the confirm view), nor on a paper while picking one (Enter picks it).
  A row whose Enter goes outside the launcher says where on its right instead: `window` (a chat), `browser` (an
  artifact), `editor` (your instructions). `NavConsistencyTests` presses Enter on every row to keep it so.
- **A row with its own menu on ⇧↵** (a chat, an artifact, a saved search) says so in the hints (`⇧↵ rename or
  delete`), in every view it shows in.
- **The breadcrumb** (the bar above the box, below the top level): each level by name, where you came from first; the
  results by what's typed (“resil”), what they're in, or the saved search's badge; a paper by its authors and year
  (in full where you are); a tag by `#name`, a task by what it says, a chat or an artifact by its title (its paper
  first when no paper's menu is below); a page by its own title. The line under it never repeats the crumb. A click on an earlier level goes back there; past five levels it keeps the first and the last three.
- **Moving between lists** slides: the new list from the right going in, from the left going back, 0.18 s; typing,
  ↑↓ and toggles don't move anything. None with Reduce Motion.
- **A key that works in a view is hinted there** (`c chat` wherever c opens a chat).
- **Whole-chat outputs** are named after the chat's title, else its first question.
- **Forms on the Mac** (a taxonomy's page, a label's): a text field is typed on Settings' typing page (↵ on the field;
  ↵ there keeps it, esc clears then goes back unsaved; a multi-line field is one line there). The form itself ignores
  typing; its box says `↵ on a field types it, on a pill changes it`; a new taxonomy or label opens its name's typing
  page at once. Pills change with `tab ⇧tab ↵`, on the pill rows only: elsewhere on a form, Tab does nothing.
- **Enter's verb in a hint is what the row does** (`↵ turn it off`, `↵ make one`); an inert row (a proposal's item, a
  taxonomy with no labels yet) does nothing, without a word, and hints no ↵.
- **The taxonomy strip:** a `Taxonomies` caption, each taxonomy's name before its pills; shown where the footer's
  pills are (a paper's menu, its notes, files, tags, prompts, its own note), only for the paper in view.
- **Writes refused up front** while the sync folder is away, before any work starts (an AI draft, the editor, tagging).
- **A loading row** becomes `Couldn't read <thing>: why` on failure, never stays loading.
- **A bridge failure** is worded the same in both launchers (the Mac's `BridgeResult.message`), never a raw kind.
- **A place names its row:** `Settings › Setup › Read scans by OCR`, not just `Settings › Setup`.
- **Optional Setup rows:** the outcome and `(optional)`, never a `missing` badge; installed, the detail starts
  `Installed: …`.
- **A retry row** counts only what retrying can fix now, and Enter does what its label says (just those papers).
- **Note titles** the runner writes are plain, printable text within Zotero's 120 characters, the prompt's name and
  version kept whole (`lib/titles.mjs`).

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
- **Every text setting can be cleared:** the empty box saves `Save: back to the default`.
- **What a page counts is counted again** when a setting it depends on changes (Bring papers up
  to date while Defaults or Prompts to run on new papers is open); without the AI features it
  says `Settings › Setup installs the AI features` rather than counting for ever.
- **Pending rows** (Processes) wait their turn; the footer's `N pending` counts the rows the list
  shows (Extract every paper's text is one row, its papers in its detail), in both launchers.
- **Rows of a later phase on a page the Mac has** are shown unavailable, their detail
  `Not on the Mac yet: this comes in a later version`.
- **A failure after the launcher closed** (a PDF, a note in Zotero, a sync, an editor that didn't
  open) goes through `notify`: said when it opens next (the QML posts a notification).
- **The sync folder away:** the runner's writes (prompts, your instructions) are refused with the
  same sentence as the app's own, and nothing is made inside the sync folder while it's away.
- **The bottom bar's processes** (right, before the sync): `N running · N pending · N failed`, Views.taskSummary's
  words; failures count until Processes is opened (those from before the app started never); a click opens Processes.
- **Counts beside the box** as the QML has them (results with their grouping, Tasks
  `3 open · 12 tasks`, notes, the reader's date, tags, styles, models, `…` while loading).

## The keys view, the menu bar, accessibility

- **The keys view** (`?`, or F1 anywhere) lists `Here · <where you are>` first, then every section, all in the Mac's
  notation: ⌘ for what the Mac binds to ⌘ (⌘S, ⌘V, ⌘W, ⌘-/+/0), the app's hotkey for Omarchy's, ⌃U for clearing the
  box. In the ⌥-key mode, Here writes keys as `keyName` does (`⌥t`, `⌥⇧W`). Typing finds a key by the words shown
  and the symbols' names (cmd, option, control, shift), never by Omarchy's words.
- **A window's keys** (a note's, a chat's: `?` or F1) come from `windowKeys` and end with ⌘W, which closes it. ⌘W in
  the launcher does what esc at the top does.
- **One name per place** in Go to, the menu bar, the keys view and the hints (*Sync Zotero*, *Processes*). "Settings"
  alone is always the launcher's; the app's window is always *Hotkey and Login…*.
- **The menu bar menu** names the launcher's places as Go to names them (Chats…, Processes…, Settings…, Sync
  Zotero); the app's own window (the hotkey, Open at login) is *Hotkey and Login…*, so the two Settings never share
  a name.
- **VoiceOver:** a row is one element, read as its label, detail and keys; its value says `checked`, `opens a list`,
  `dimmed`; the highlighted row is selected, its hint the footer's first keys for it. A pill reads as `kind: text`
  (`status: reading`). The search box reads its placeholder.
- **Reduce Motion:** nothing animates (the badges' scroll is the one animation the launcher has).

## The results' sort

- **Named at the badges' right** (`SortChip`) wherever papers are sorted (typed, or in a scope): `By relevance`,
  `↓ Newest published` / `↑ Oldest published` (the arrow is the direction), `Grouped by paper status`; a click is
  `g`. The count beside the box doesn't repeat it.

## Settings

- **Where a setting lives:** what runs by default (extraction, tagging, prompts on new papers, catching up) in
  *Defaults*; every model and key, the classifier's (Jev) too, in *Models & providers*; a page that used to hold
  one says where it went with a `set-nav` row to it.
- **An on/off row** draws a switch on its right (`SwitchMark`, from the row's `checked`); its detail still starts
  `On ·` / `Off ·`.
- **A setting found from the search** opens its page on its row and does what Enter there does (a switch flips, an
  edit opens its editor, a choice its list), so the change is seen where it lives; a row that clears, removes or
  reads the clipboard (`set-key`, `*-reset`, `*-remove`, `*-delete`) is only shown, and its hint says `↵ show it`.

## Saved searches in the results

- **Found as you type**, by a word of the name or of the query (the name ranks first), under their own
  *Saved searches* heading above the collections; at most five; never while picking a paper. Enter (and the arrow,
  `↵ its papers`) opens one as the saved searches list does.

## Pills

Three ways, as the QML: **on** (filled: the one chosen), **tag** (a tinted outline: something the
paper has, its status, its extracted text), **off** (faint: a choice, a rank); each in its kind's
colour (status orange, priority red, rank purple, taxonomy teal, task green, else the accent); in
white on a selected row.

## Known gaps

- The empty states have no icons yet (the QML's are Nerd Font glyphs; the font waits for its
  download, phase 3b's note).
