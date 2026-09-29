# Zotero Launcher for Omarchy

[![CI](https://github.com/mbradaschia/oma-zotero-launcher/actions/workflows/ci.yml/badge.svg)](https://github.com/mbradaschia/oma-zotero-launcher/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mbradaschia/oma-zotero-launcher?sort=semver)](https://github.com/mbradaschia/oma-zotero-launcher/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Search your Zotero library from anywhere in [Omarchy](https://omarchy.org). Press **SUPER+SHIFT+Z**, type a
few letters of a title, author or year, and press **Shift+Enter**: Zotero jumps to the paper, in its open tab
or its PDF. Press **Enter** instead for the paper's menu: its notes, prompts that have Claude write notes for
you, tags, and more, without leaving the keyboard.

![Search results, and the menu for one of them](preview.png)

## Features

- **Fuzzy search** over titles, authors, years and tags, with fzf-style filters. Before you type: your
  pinned papers and collections, the papers open in Zotero, then recently added ones.
- **Collections**: they show up as you type, by their full path ("Topics / SCM / Power"); open one to see
  and search its papers (subcollections included), pin it, or show it in Zotero.
- **Jump to Zotero**: switch to the paper's tab, or open its PDF in Zotero's reader, in its own Zotero
  window, or in your PDF app.
- **Notes**: read them in the launcher or in their own resizable window, next to the paper; open them in
  Zotero, copy them as Markdown, or save them as `.md` files.
- **Prompts**: have Claude write a literature review, the findings and takeaways, or anything you write a
  prompt for, and save it as a note on the paper, with verbatim quotes and APA 7 citations and references.
  *Needs a Claude subscription; see [Prompts](#prompts).*
- **Tags**: add, remove and create them, with Zotero's colors; undoable in Zotero.
- **Journal rankings**: ABS (AJG 2024), FT50 and UTD24 labels on every paper from a ranked journal.
- **Local and private**: the launcher talks only to Zotero on your machine, through a token only you can
  read.

## Requirements

- [Omarchy](https://omarchy.org) (its shell with plugin support).
- [Zotero 10](https://www.zotero.org).
- For prompts (optional): [Node.js](https://nodejs.org) 22 or newer, and
  [Claude Code](https://docs.claude.com/en/docs/claude-code) logged in with a **Claude subscription**
  (Pro or Max).

## Install

The launcher has three parts: a small **Zotero plugin** (the bridge), the **Omarchy plugin** (the launcher
itself) and, optionally, the **prompt runner**.

### 1. The Zotero bridge

1. Download `oma-zotero-launcher-<version>.xpi` from the
   [latest release](https://github.com/mbradaschia/oma-zotero-launcher/releases/latest).
2. In Zotero: *Tools → Plugins*, then the ⚙ menu → *Install Plugin From File…*, and pick the file.

Zotero keeps it up to date from then on (it checks this repository's releases).

### 2. The Omarchy plugin

```bash
omarchy plugin add https://github.com/mbradaschia/oma-zotero-launcher --enable
```

### 3. The keybinding

Add this to `~/.config/hypr/bindings.lua`, then run `hyprctl reload`:

```lua
o.bind("SUPER + SHIFT + Z", "Zotero launcher", { panel = "io.github.mbradaschia.oma-zotero" })
```

Any free key works; `omarchy-shell shell toggle io.github.mbradaschia.oma-zotero` opens it from a script.

### 4. Prompts (optional)

> [!IMPORTANT]
> In this version, prompts run on **Claude only**, through the Claude Agent SDK with your **Claude
> subscription** (the account Claude Code is logged in to). Runs count against your plan's usage.
> Other models and providers are planned; see the [roadmap](#roadmap).

1. Install [Claude Code](https://docs.claude.com/en/docs/claude-code) and log in with your Claude account
   (`claude`, then `/login`).
2. Install the runner from the plugin's folder:
   ```bash
   make -C ~/.config/omarchy/plugins/io.github.mbradaschia.oma-zotero prompts-install
   ```
   It copies the runner to `~/.local/share/oma-zotero-launcher/runner`, installs its packages there, and
   links `~/.local/bin/oma-zotero-prompt`.

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
- **Prompt runner**: run the `prompts-install` command again after updating the plugin.

The three parts share one version. The launcher works with an older bridge, but new features may need
the new one: update both.

## Uninstall

```bash
omarchy plugin remove io.github.mbradaschia.oma-zotero
rm -rf ~/.local/bin/oma-zotero-prompt ~/.local/share/oma-zotero-launcher ~/.cache/oma-zotero-launcher
rm -rf ~/.config/omarchy/oma-zotero-launcher ~/.config/omarchy/oma-zotero-launcher.json  # your settings, pins and prompts
```

In Zotero, *Tools → Plugins* → *Omarchy Zotero Bridge* → *Remove*. Remove the keybinding from
`bindings.lua`. Notes the prompts created stay in Zotero (they are tagged `oma-prompt`).

## Usage

### Search

| Key | |
|---|---|
| type | search |
| `↑` `↓`, `Ctrl+K` `Ctrl+J`, `PgUp` `PgDn` | move |
| `Enter` (or `Tab`, `→`) | the paper's menu |
| `Shift+Enter` | open it in Zotero |
| `Alt+O` / `Alt+W` | open the PDF in your PDF app / in its own Zotero window |
| `Alt+N` / `Alt+T` / `Alt+P` / `Alt+L` | its notes / its tags / pin or unpin it / show it in your library |
| `Esc` | clear the query, then close |

Inside a menu or a collection, `Esc` (once what you typed is cleared) and `Backspace` go back one level;
only the top-level results close on `Esc`.

### Collections

As you type, matching collections are listed first, under **Collections**, by their full path
("_Topics / SCM / Public SCM"; the match can be anywhere in it), then the papers.

| On a collection | |
|---|---|
| `Enter` | open it: its papers, and those of its subcollections, listed by title with its subcollections first; type to search inside it |
| `Shift+Enter`, `Alt+L` | select it in Zotero's library |
| `Alt+P` | pin it: pinned collections come first before you type, with the pinned papers |
| `Esc`, `Backspace` | (inside it) back to where you were |

Search terms (all must match):

| Term | Matches |
|---|---|
| `resil`, `stev resil` | fuzzy, in titles and authors; first authors and whole title phrases rank higher |
| `a:smith`, `t:resilience` | authors only, title only |
| `2020`, `y:2019..2021` | year (a bare 4-digit term is a year) |
| `#tag` | tag |
| `'exact`, `^prefix`, `suffix$` | exact, prefix and suffix matches |
| `!term` | exclude |
| `a \| b` | either |

### The paper's menu

- **Notes**, with the paper's notes listed right under it (see [Notes](#notes)).
- **Prompts** (see [Prompts](#prompts)).
- **Pin to the top** / **Unpin**: pinned papers come first before you type, in a *Pinned* section.
- **Open in Zotero**: its detail says what it does, such as "Switch to its open tab".
- **Open PDF externally**, in your default PDF app or `externalPdfCommand`; **Open PDF in a new Zotero
  window**, one you can tile. With several files, you pick one; missing files are listed with the reason.
- **Tags** (see [Tags](#tags)).
- **Show in library**.

Type to filter the menu.

### Notes

The paper's notes, newest first. In a list, `Enter` reads one, `Alt+W` opens it in its own window,
`Alt+Enter` opens it in Zotero, `Ctrl+C` copies it as Markdown and `Ctrl+S` saves it as a `.md` file in your
Downloads folder (never over an existing file).

While reading, there is nothing to edit, so plain keys act:

| Key | |
|---|---|
| `z` (or `Enter`) | open it in Zotero's note editor |
| `w` | open it in its own window |
| `c` / `s` | copy it as Markdown / save it as a `.md` file |
| `↑` `↓` `j` `k`, `Space` `b`, `PgUp` `PgDn`, `g` `G` | scroll |
| `Backspace`, `Esc` | back |

**The note window** is a normal window: tile it, float it, resize it, keep it next to the PDF. Its header
cites the paper APA 7 style, "Sirmon et al. (2007)", with the title, the journal and its rankings; its top
bar has *Zotero* (`z`), *Copy .md* (`c`) and *Save .md* (`s`). Select text to copy a passage (`Ctrl+C`).
Close it like any window (SUPER+W) or with its ✕.

Copies and saved files are the note as Zotero's *Export Note → Markdown* gives it.

### Prompts

> [!NOTE]
> Prompts need the optional [prompt runner](#4-prompts-optional) and a **Claude subscription**. They run
> on Claude only in this version.

The paper's menu → **Prompts** lists them. `Enter` runs one: Claude reads the paper and its answer is saved
as a new note on it, usually within a few minutes. It runs in the background; a notification says when it
starts and when the note is saved.

Two prompts come with it:

- **Literature Review**: overview, research question, theoretical framework, method, findings, contributions,
  limitations and future research, key quotes, connections to your notes.
- **Findings and Takeaways**: the central finding, the key findings with evidence, takeaways, how to cite it,
  key quotes.

Both quote the paper verbatim with APA 7 in-text citations and page numbers, and end with an APA 7 reference
list. Claude is given the paper's APA 7 reference (formatted by Zotero), your highlights and comments with
their pages, your existing notes, and the full text Zotero indexed, and is told never to invent a quote, page
or reference. Still, check quotes against the paper before you cite them.

**Your own prompts.** `Alt+E` on a prompt edits it in the launcher: its title, its **model** and **effort**
(dropdowns listing the models your Claude account offers and the effort levels each supports), and its text,
which opens in your editor. *New prompt…* creates one. Prompts are Markdown files in
`~/.config/omarchy/oma-zotero-launcher/prompts/`:

```markdown
---
title: Methods Critique
model: opus[1m]
effort: high
---
Critique the paper's method: design, sample, measures, analysis. Quote the passages you discuss,
with APA 7 citations and pages, and end with a "## References" section in APA 7.
```

From a terminal: `oma-zotero-prompt list`, `run <prompt> --key <item key>` (`--dry-run` shows what Claude
would get), `new`, `edit <prompt>`, `set <prompt> --model sonnet --effort medium`, `models`. Runs are logged
to `~/.local/state/oma-zotero/prompts.log`.

### Tags

Every tag in the paper's library: its own tags first and checked, colored tags in their color, how many
papers use each, `auto` on automatic ones. Type to find one, `Enter` adds or removes it; a new name gets a
*Create tag* row (`Ctrl+Enter` adds exactly what you typed). Edits go through Zotero, so *Edit → Undo* in
Zotero reverts them.

### Journal rankings

Papers from ranked journals show labels on the right of the results and in the note window:

- **ABS 1** to **ABS 4\***: the Chartered ABS [*Academic Journal Guide* 2024](https://charteredabs.org/academic-journal-guide/academic-journal-guide-2024).
- **FT50**: the Financial Times research journal list.
- **UTD24**: the UT Dallas list.

Journals are matched by ISSN, else by name or abbreviation.

## Configuration

`~/.config/omarchy/oma-zotero-launcher.json`; every setting is optional. An invalid setting falls back to its
default, and the launcher's footer names it.

```json
{
  "enterAction": "reader",
  "externalPdfCommand": ["zathura"],
  "maxResults": 60,
  "accelerators": true,
  "emptyQuery": { "showOpen": true, "tabOrder": "mru", "recent": "added", "recentLimit": 15 },
  "port": 23119,
  "promptCommand": ["oma-zotero-prompt"]
}
```

| Setting | |
|---|---|
| `enterAction` | `"reader"` (default): Shift+Enter opens the paper's PDF in Zotero's reader if it isn't open. `"select"`: it only selects the paper in your library. |
| `externalPdfCommand` | Open PDFs in this app instead of your default one. |
| `maxResults` | Results per search, 10–200 (default 60). |
| `accelerators` | `false` turns off the `Alt` keys in the results. |
| `emptyQuery.showOpen` | List the papers open in Zotero before you type (default `true`). |
| `emptyQuery.tabOrder` | `"mru"`: most recently used first (default); `"tabbar"`: Zotero's tab order. |
| `emptyQuery.recent` | Then the recently `"added"` (default) or `"modified"` papers, or `"none"`. |
| `emptyQuery.recentLimit` | How many of those, 0–50 (default 15). |
| `port` | Zotero's HTTP port, if you changed it (default 23119). |
| `promptCommand` | How to start the prompt runner if `oma-zotero-prompt` isn't on your `PATH`. |

### Files

| Path | |
|---|---|
| `~/.config/omarchy/oma-zotero-launcher.json` | settings |
| `~/.config/omarchy/oma-zotero-launcher/pins.json` | pinned papers and collections |
| `~/.config/omarchy/oma-zotero-launcher/prompts/` | your prompts |
| `~/.local/share/oma-zotero-launcher/runner/` | the prompt runner |
| `~/.cache/oma-zotero-launcher/models.json` | Claude's model list, refreshed daily |
| `~/.local/state/oma-zotero/prompts.log` | prompt runs |
| `$XDG_RUNTIME_DIR/oma-zotero/bridge.json` | the bridge's port and token (0600) |

## Privacy and security

- The bridge adds routes under `/oma-zotero/` to Zotero's own local HTTP server (127.0.0.1). Every request
  needs a token only your user can read, and requests from web pages are refused.
- The launcher changes your library only when you ask it to: tags, and notes the prompts create.
- **Prompts send data to Anthropic**: when you run a prompt, the paper's metadata, full text, your highlights
  and your notes on it go to Claude through Claude Code, under your Claude account's terms. Nothing else
  leaves your machine.

## Troubleshooting

| The launcher says | |
|---|---|
| *The Zotero bridge isn't installed* | Install the `.xpi` ([step 1](#1-the-zotero-bridge)), or restart Zotero after installing it. |
| *Zotero isn't running* | Press `Enter` to start it. |
| *Zotero rejected the bridge token* | Restart Zotero. |
| *oma-zotero-prompt isn't installed* | Run the [prompt runner install](#4-prompts-optional). |

A prompt that fails says why in a notification; `~/.local/state/oma-zotero/prompts.log` has the details. If
it's a login or usage-limit problem, check `claude` in a terminal.

## Development

```bash
make help         # every target
make test         # unit tests (Node)
make lint         # JavaScript, QML and shell syntax
make bridge-link  # load zotero-bridge/ unpacked into Zotero (quit Zotero first), with dev routes
make bridge-reload  # reload the bridge's code without restarting Zotero
make dev          # sync the Omarchy plugin on every change (QML changes: make plugin-reload)
make e2e          # end-to-end, in the live shell and Zotero
```

The live tests (`make e2e`, `make smoke`, `make fresh-install`) put everything back: Zotero's tabs and
selection, your focused window, the clipboard, settings and your installed plugin. The launcher takes the
keyboard while they run, so don't type. Only `make e2e-write` and `make smoke-write` edit your library: they
add and remove the tag `oma-zotero-test` on one paper.

| Path | |
|---|---|
| `ZoteroSearch.qml`, `NoteWindow.qml`, `Service.qml`, `lib/` | the Omarchy plugin |
| `zotero-bridge/` | the Zotero plugin (built into the `.xpi`) |
| `daemon/` | the prompt runner (`oma-zotero-prompt`, Claude Agent SDK) and the bundled prompts |
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

## Roadmap

- **More models for prompts.** Prompts run on Claude only today. Other providers (OpenAI and other APIs, local
  models) are planned behind the same prompt files.
- Tag papers in Zotero with their journal rankings.

## Credits

- Journal rankings: the Chartered Association of Business Schools' *Academic Journal Guide* 2024, the
  Financial Times research list (FT50) and the UT Dallas list (UTD24), from the snapshots in
  [wosaide-journal-lists](https://github.com/wosaide/wosaide-journal-lists). Their lists remain theirs.
- Built on [Zotero](https://www.zotero.org), [Omarchy](https://omarchy.org) and its
  [Quickshell](https://quickshell.org) shell, and the
  [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview).

## License

[MIT](LICENSE)
